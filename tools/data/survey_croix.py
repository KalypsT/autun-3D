"""Relevés du lot 0 de la Croix de la Libération (docs/plans/croix-liberation.md) : OpenStreetMap, nuage de points LiDAR HD, MNT et MNS,
orthophotographie, relief publié du jeu, et côte que donnerait l'extension de la carte.

Sortie : un rapport texte (stdout) et, avec --images DOSSIER, des vues annotées. Données téléchargées gardées dans .cache/croix/ (hors git).
Aucun fichier du jeu n'est modifié (region.json n'est pas touché : l'extension est simulée en mémoire).

Usage : python3 tools/data/survey_croix.py [--images DOSSIER]
Repère : local du jeu (x est, y nord, z au-dessus de ORIGIN_Z) ; caps en degrés depuis le nord, sens horaire.
"""

import array
import io
import json
import math
import sys

import laspy
import numpy as np
import requests
import shapely
import tifffile
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon

import config as c

OX, OY = c.ORIGIN
Z0 = c.ORIGIN_Z
CACHE = c.ROOT / ".cache" / "croix"
DATA = c.ROOT / "public" / "data"
WMS = "https://data.geopf.fr/wms-r"
WFS = "https://data.geopf.fr/wfs/ows"
TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
TO_WGS = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)

CROSS_NODE = 936333171
RD256 = (149380971, 149380970)  # route de la Chicolle et Montjeu, de la ville au carrefour
ACCESS = (1053943801, 80229499)  # du carrefour au parking (voie non classée)
PARKING = 80229518
TAKEOFF = 1232988033  # aire de décollage FFVL
# Emprise des relevés raster (local) : la croix, la RD 256, la route d'accès et le bord sud de la ville.
BOX = (-1150.0, -2650.0, 450.0, -1250.0)
# Repères de la vue (local) : lieux de la carte (public/data/map/places.json), cherchés par nom.
VIEW_TARGETS = ("Tour des Ursulines", "Cathédrale Saint-Lazare", "Pyramide de Couhard", "Lycée militaire d'Autun", "Centre hospitalier d'Autun - Site Parpas",
                "Porte Saint-André", "Gare routière", "Collège du Vallon")


def local(lat, lon):
    x, y = TO_L93.transform(lon, lat)
    return x - OX, y - OY


def get(url, name, **kw):
    f = CACHE / name
    if not f.exists():
        r = requests.get(url, timeout=300, headers={"User-Agent": c.USER_AGENT}, **kw)
        r.raise_for_status()
        CACHE.mkdir(parents=True, exist_ok=True)
        f.write_bytes(r.content)
    return f.read_bytes()


# --- OpenStreetMap ------------------------------------------------------------------------------------------------------------
def osm():
    x0, y0, x1, y1 = BOX
    lon0, lat0 = TO_WGS.transform(OX + x0, OY + y0)
    lon1, lat1 = TO_WGS.transform(OX + x1, OY + y1)
    d = json.loads(get("https://api.openstreetmap.org/api/0.6/map.json", "osm.json",
                       params={"bbox": f"{lon0:.5f},{lat0:.5f},{lon1:.5f},{lat1:.5f}"}))
    nodes = {e["id"]: e for e in d["elements"] if e["type"] == "node"}
    pos = {k: local(n["lat"], n["lon"]) for k, n in nodes.items()}
    ways = {e["id"]: (e, [pos[n] for n in e["nodes"] if n in pos]) for e in d["elements"] if e["type"] == "way"}
    return nodes, pos, ways


def length(pts):
    return sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))


def chain(ways, ids):
    """Polyligne continue des voies `ids`, raccordées bout à bout, du premier bout libre au dernier."""
    segs = [list(ways[i][1]) for i in ids]
    line = segs.pop(0)
    while segs:
        for k, s in enumerate(segs):
            if math.dist(line[-1], s[0]) < 0.5:
                line += s[1:]
            elif math.dist(line[-1], s[-1]) < 0.5:
                line += s[::-1][1:]
            elif math.dist(line[0], s[-1]) < 0.5:
                line = s[:-1] + line
            elif math.dist(line[0], s[0]) < 0.5:
                line = s[::-1][:-1] + line
            else:
                continue
            segs.pop(k)
            break
        else:
            raise SystemExit(f"voies {ids} non raccordées")
    return line


def resample(line, step):
    g = LineString(line)
    n = max(2, int(g.length / step) + 1)
    return [(p.x, p.y) for p in (g.interpolate(g.length * i / (n - 1)) for i in range(n))]


# --- Rasters IGN --------------------------------------------------------------------------------------------------------------
class Grid:
    def __init__(self, a, bx, res):
        self.a, self.box, self.res = a, bx, res

    def at(self, x, y):
        i = int((self.box[3] - y) / self.res)
        j = int((x - self.box[0]) / self.res)
        if 0 <= i < self.a.shape[0] and 0 <= j < self.a.shape[1]:
            return float(self.a[i, j])
        return float("nan")

    def xy(self):
        h, w = self.a.shape
        xs = self.box[0] + (np.arange(w) + 0.5) * self.res
        ys = self.box[3] - (np.arange(h) + 0.5) * self.res
        return np.meshgrid(xs, ys)


def wms(layer, fmt, bx, res, name):
    x0, y0, x1, y1 = bx
    return get(WMS, name, params={
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "", "FORMAT": fmt, "CRS": "EPSG:2154",
        "BBOX": f"{OX + x0},{OY + y0},{OX + x1},{OY + y1}", "WIDTH": int(round((x1 - x0) / res)), "HEIGHT": int(round((y1 - y0) / res))})


def dem(kind, bx, res):
    layer = f"IGNF_LIDAR-HD_{kind}_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
    a = tifffile.imread(io.BytesIO(wms(layer, "image/geotiff", bx, res, f"{kind}-{int(bx[0])}-{int(bx[1])}-{res}.tif"))).astype(np.float32)
    a[a < -100] = np.nan
    return Grid(a - Z0, bx, res)


def ortho(bx, res):
    data = wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", bx, res, f"ortho-{int(bx[0])}-{int(bx[1])}-{res}.jpg")
    return Image.open(io.BytesIO(data)).convert("RGB")


# --- Nuage de points ----------------------------------------------------------------------------------------------------------
def cloud(cx, cy, half):
    f = CACHE / f"points-{half:.0f}.npz"
    if not f.exists():
        X, Y = OX + cx, OY + cy
        meta = json.loads(get(WFS, "lidar-meta.json", params={
            "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "IGNF_LIDAR-HD_METADONNEE:metadata",
            "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154", "COUNT": 10,
            "BBOX": f"{X - half},{Y - half},{X + half},{Y + half},urn:ogc:def:crs:EPSG::2154"}))["features"]
        xs, ys, zs, cs = [], [], [], []
        for m in meta:
            with laspy.CopcReader.open(m["properties"]["url_npl"]) as r:
                p = r.query(laspy.copc.Bounds(mins=np.array([X - half, Y - half]), maxs=np.array([X + half, Y + half])))
            xs.append(np.array(p.x) - OX); ys.append(np.array(p.y) - OY); zs.append(np.array(p.z) - Z0); cs.append(np.array(p.classification))
        CACHE.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(f, x=np.concatenate(xs), y=np.concatenate(ys), z=np.concatenate(zs), c=np.concatenate(cs))
    d = np.load(f)
    return d["x"], d["y"], d["z"], d["c"]


# --- Relief publié du jeu -----------------------------------------------------------------------------------------------------
def game_coarse():
    W = json.loads((DATA / "world.json").read_text())
    C = W["coarse"]
    a = array.array("H")
    a.frombytes((DATA / "terrain" / "coarse.bin").read_bytes())

    def h(x, y):
        col, row = int((x - C["x0"]) / C["res"]), int((C["y1"] - y) / C["res"])
        if not (0 <= col < C["cols"] and 0 <= row < C["rows"]):
            return float("nan")
        return a[row * C["cols"] + col] * C["unit"] + C["base"]
    return W, h


def tile_of(x, y):
    return (math.floor((x - c.GRID_X) / c.TILE), math.floor((y - c.GRID_Y) / c.TILE))


# --- Rapport ------------------------------------------------------------------------------------------------------------------
def main():
    images = sys.argv[sys.argv.index("--images") + 1] if "--images" in sys.argv else None
    nodes, pos, ways = osm()
    X0 = pos[CROSS_NODE]
    print(f"== Croix (OSM node {CROSS_NODE}) : ({X0[0]:.1f} ; {X0[1]:.1f}), tuile {'_'.join(map(str, tile_of(*X0)))} ; tags {nodes[CROSS_NODE].get('tags')}")

    # Objets OSM autour de la croix.
    print("\n== OSM : objets à moins de 120 m de la croix")
    for k, (w, pts) in ways.items():
        t = w.get("tags", {})
        if not t or not pts or min(math.dist(p, X0) for p in pts) > 120 or "highway" in t and k not in ACCESS + RD256:
            continue
        closed = len(pts) > 3 and pts[0] == pts[-1]
        g = Polygon(pts) if closed else LineString(pts)
        cc = g.centroid
        print(f"  way {k:>10} centre ({cc.x:7.1f} ; {cc.y:7.1f}) {'aire ' + str(round(g.area)) + ' m²' if closed else 'long. ' + str(round(g.length)) + ' m'} {t}")
    for k, n in nodes.items():
        if n.get("tags") and math.dist(pos[k], X0) < 120 and k != CROSS_NODE:
            print(f"  node {k:>10} ({pos[k][0]:7.1f} ; {pos[k][1]:7.1f}) à {math.dist(pos[k], X0):5.1f} m {n['tags']}")
    print("  chemins (highway) qui passent à moins de 60 m :")
    for k, (w, pts) in ways.items():
        t = w.get("tags", {})
        if "highway" in t and pts and min(math.dist(p, X0) for p in pts) < 60:
            print(f"    way {k:>10} {t.get('highway'):12} long. {length(pts):6.0f} m, au plus près {min(math.dist(p, X0) for p in pts):5.1f} m "
                  f"{ {kk: v for kk, v in t.items() if kk in ('name', 'surface', 'tracktype', 'width', 'access', 'motor_vehicle', 'ref')} }")

    # Rasters.
    mnt, mns = dem("MNT", BOX, 1.0), dem("MNS", BOX, 1.0)
    W, game_h = game_coarse()

    # Routes.
    rd = chain(ways, RD256)
    acc = chain(ways, ACCESS)
    for name, ids, line in (("RD 256", RD256, rd), ("route d'accès", ACCESS, acc)):
        tags = [ways[i][0].get("tags", {}) for i in ids]
        print(f"\n== {name} (ways {', '.join(map(str, ids))}) : {length(line):.0f} m, de ({line[0][0]:.0f} ; {line[0][1]:.0f}) à ({line[-1][0]:.0f} ; {line[-1][1]:.0f})")
        print(f"  tags : {[{k: v for k, v in t.items() if k not in ('source',)} for t in tags]}")
        pts = resample(line, 5.0)
        z = np.array([mnt.at(*p) for p in pts])
        s = np.arange(len(pts)) * length(line) / (len(pts) - 1)
        g20 = np.abs(np.diff(z[::4])) / np.maximum(np.diff(s[::4]), 1e-6) * 100
        print(f"  altitude (MNT) de {np.nanmin(z) + Z0:.1f} à {np.nanmax(z) + Z0:.1f} m ; dénivelé {np.nanmax(z) - np.nanmin(z):.0f} m ; "
              f"pente moyenne {abs(z[-1] - z[0]) / length(line) * 100:.1f} % ; pente maximale sur 20 m {np.nanmax(g20):.1f} %")
        tiles = sorted({tile_of(*p) for p in pts})
        print(f"  tuiles : {' '.join(f'{a}_{b}' for a, b in tiles)}")
        print("  profil (tous les ~200 m) : s, x, y, MNT, jeu (relief grossier), écart")
        for i in range(0, len(pts), 40):
            gz = game_h(*pts[i])
            print(f"    {s[i]:6.0f} ({pts[i][0]:7.1f} ; {pts[i][1]:7.1f}) {z[i] + Z0:6.1f} m  jeu {gz + Z0:6.1f} m  {gz - z[i]:+7.1f}")
        # Virages serrés (lacets) : rayon de courbure sur 3 points espacés de 10 m.
        q = resample(line, 10.0)
        radii = []
        for i in range(1, len(q) - 1):
            a, b, cc = map(np.array, (q[i - 1], q[i], q[i + 1]))
            cross = abs((b - a)[0] * (cc - a)[1] - (b - a)[1] * (cc - a)[0])
            radii.append((math.dist(q[i - 1], q[i]) * math.dist(q[i], q[i + 1]) * math.dist(q[i - 1], q[i + 1]) / max(cross, 1e-6) / 2, q[i]))
        tight = [r for r in radii if r[0] < 20]
        print(f"  virages de rayon < 20 m : {len(tight)}" + "".join(f"\n    r = {r:4.1f} m en ({p[0]:7.1f} ; {p[1]:7.1f})" for r, p in tight))
    print(f"\n  raccord RD 256 / route d'accès : bout de la RD 256 le plus proche de la route d'accès à "
          f"{min(math.dist(a, b) for a in (rd[0], rd[-1]) for b in (acc[0], acc[-1])):.1f} m")
    # Largeur de la trouée de la route d'accès (MNS - MNT < 2 m de part et d'autre de l'axe).
    widths = []
    for p, q2 in zip(resample(acc, 25.0)[1:-1], resample(acc, 25.0)[2:]):
        dx, dy = q2[0] - p[0], q2[1] - p[1]
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        open_ = [o for o in np.arange(-15, 15.5, 0.5) if mns.at(p[0] + nx * o, p[1] + ny * o) - mnt.at(p[0] + nx * o, p[1] + ny * o) < 2.0]
        widths.append(len(open_) * 0.5)
    print(f"  route d'accès : trouée sans arbres (MNS − MNT < 2 m, sur ± 15 m) médiane {np.median(widths):.1f} m (de {min(widths):.1f} à {max(widths):.1f})")

    # Parking, aire de décollage, clairière.
    print("\n== Clairière, parking et aire de décollage")
    half = 90.0
    bx = (X0[0] - half, X0[1] - half, X0[0] + half, X0[1] + half)
    t2, s2 = dem("MNT", bx, 0.5), dem("MNS", bx, 0.5)
    XX, YY = t2.xy()
    h = s2.a - t2.a
    clear = h < 1.5
    for k, label in ((PARKING, "parking"), (TAKEOFF, "aire de décollage")):
        P = Polygon(ways[k][1])
        m = shapely.contains_xy(P, XX, YY)
        print(f"  {label} (OSM way {k}) : {P.area:.0f} m², centre ({P.centroid.x:.1f} ; {P.centroid.y:.1f}), "
              f"dégagé (MNS − MNT < 1,5 m) {clear[m].mean() * 100:.0f} %, sol de {np.nanmin(t2.a[m]) + Z0:.1f} à {np.nanmax(t2.a[m]) + Z0:.1f} m, "
              f"pente moyenne {np.nanmean(np.hypot(*np.gradient(t2.a, 0.5))[m]) * 100:.0f} %")
    # Clairière d'un seul tenant autour de la croix (remplissage depuis la croix).
    from scipy import ndimage
    lab, _ = ndimage.label(clear)
    i0, j0 = int((bx[3] - X0[1]) / 0.5), int((X0[0] - bx[0]) / 0.5)
    k0 = lab[i0, j0] or np.bincount(lab[max(0, i0 - 10):i0 + 10, max(0, j0 - 10):j0 + 10].ravel())[1:].argmax() + 1
    cl = lab == k0
    print(f"  clairière d'un seul tenant autour de la croix : {cl.sum() * 0.25:.0f} m², x {XX[cl].min():.0f}..{XX[cl].max():.0f}, y {YY[cl].min():.0f}..{YY[cl].max():.0f}")
    # Lisière par caps : distance de la croix au premier arbre (MNS − MNT > 4 m).
    print("  lisière (premier arbre de plus de 4 m) par cap, depuis la croix :")
    row = []
    for cap in range(0, 360, 30):
        d = next((r for r in np.arange(3, half, 0.5) if s2.at(X0[0] + r * math.sin(math.radians(cap)), X0[1] + r * math.cos(math.radians(cap))) -
                  t2.at(X0[0] + r * math.sin(math.radians(cap)), X0[1] + r * math.cos(math.radians(cap))) > 4), float("nan"))
        row.append(f"{cap:3d}° {d:5.1f} m")
    print("    " + " ; ".join(row))

    # Nuage de points : la croix et sa plate-forme.
    print("\n== Nuage de points LiDAR HD (fenêtre de 60 m autour du point OSM)")
    x, y, z, cls = cloud(X0[0], X0[1], 30.0)
    print(f"  {len(x)} points ; classes {dict(zip(*map(lambda v: v.tolist(), np.unique(cls, return_counts=True))))}")
    r0 = np.hypot(x - X0[0], y - X0[1])
    stone = (cls <= 2) | (cls == 6) | (cls == 9) | (cls >= 17)
    # La croix : points de « pierre » à plus de 4 m au-dessus du sol local (MNT), à moins de 15 m du point OSM.
    gz = np.array([t2.at(a, b) for a, b in zip(x, y)])
    hh = z - gz
    tall = stone & (hh > 4) & (r0 < 15)
    if tall.sum() < 20:  # la croix peut être classée en végétation ou « autre » : on prend toutes les classes, hors arbres éloignés.
        tall = (hh > 4) & (r0 < 8)
    print(f"  points à plus de 4 m au-dessus du MNT, à moins de 15 m : {tall.sum()} (classes {np.unique(cls[tall]).tolist()})")
    cx, cy = float(np.median(x[tall])), float(np.median(y[tall]))
    # Axe des bras : orientation principale des points hauts (ACP), recentrée.
    top = float(z[tall].max())
    sel = tall & (np.hypot(x - cx, y - cy) < 8)
    P = np.c_[x[sel] - cx, y[sel] - cy]
    w, v = np.linalg.eigh(np.cov(P.T))
    ax = v[:, -1]
    if math.degrees(math.atan2(ax[0], ax[1])) % 360 >= 180:  # le vecteur propre a un signe arbitraire : on le tourne vers le cap < 180°
        ax = -ax
    cap = math.degrees(math.atan2(ax[0], ax[1])) % 360
    u = P @ ax
    t = P @ np.array([-ax[1], ax[0]])
    hz = z[sel]
    print(f"  axe de la croix (médiane des points hauts) : ({cx:.2f} ; {cy:.2f}), à {math.dist((cx, cy), X0):.1f} m du point OSM")
    print(f"  bras orientés au cap {cap:.0f}° / {(cap + 180) % 360:.0f}° (la croix regarde au cap {(cap + 90) % 360:.0f}° ou {(cap + 270) % 360:.0f}°)")
    base = float(np.median(z[(cls == 2) & (np.hypot(x - cx, y - cy) > 2) & (np.hypot(x - cx, y - cy) < 4)])) if np.any((cls == 2) & (np.hypot(x - cx, y - cy) < 4)) else float("nan")
    ground = float(np.median(z[(cls == 2) & (np.hypot(x - cx, y - cy) > 18) & (np.hypot(x - cx, y - cy) < 25)]))
    print(f"  sol autour (classe 2, 18 à 25 m) : z = {ground:.2f} ({ground + Z0:.1f} m) ; pied du fût (sol à 2-4 m) : {base:.2f} ({base - ground:+.2f})")
    print(f"  sommet : z = {top:.2f}, soit {top - ground:.1f} m au-dessus du sol alentour, {top - base:.1f} m au-dessus du pied")
    print("  sections (par tranche de 0,5 m) : étendue le long des bras (u) et en travers (t), 2ᵉ-98ᵉ centile")
    for lv in np.arange(math.floor(top - ground) - 0.25, 0, -0.5):
        m = np.abs(hz - ground - lv) < 0.25
        if m.sum() < 5:
            continue
        uu, tt = u[m], t[m]
        print(f"    h {lv:5.2f} : u {np.percentile(uu, 2):6.2f} .. {np.percentile(uu, 98):6.2f} ({np.percentile(uu, 98) - np.percentile(uu, 2):5.2f}) ; "
              f"t {np.percentile(tt, 2):6.2f} .. {np.percentile(tt, 98):6.2f} ({np.percentile(tt, 98) - np.percentile(tt, 2):5.2f}) ; {m.sum()} pts")

    # Plate-forme : niveau du parking, contour des cellules du MNT fin au-dessus de lui, sections nord-sud et est-ouest.
    park = shapely.contains_xy(Polygon(ways[PARKING][1]), XX, YY)
    pz = float(np.nanmedian(t2.a[park]))
    print(f"  niveau du parking (médiane du MNT dans le contour OSM) : z = {pz:.2f} ({pz + Z0:.1f} m) ; pied du fût {base - pz:+.2f} au-dessus")
    up = (t2.a > pz + 0.6) & (np.hypot(XX - cx, YY - cy) < 25)
    lab3, _ = ndimage.label(up)
    k3 = lab3[int((bx[3] - cy) / 0.5), int((cx - bx[0]) / 0.5)]
    if k3:
        m = lab3 == k3
        pts = shapely.MultiPoint(np.c_[XX[m], YY[m]])
        rect = pts.convex_hull.minimum_rotated_rectangle
        xy = list(rect.exterior.coords)[:4]
        sides = [math.dist(xy[i], xy[(i + 1) % 4]) for i in range(4)]
        a0 = math.degrees(math.atan2(xy[1][0] - xy[0][0], xy[1][1] - xy[0][1])) % 180
        print(f"  plate-forme (MNT plus de 0,6 m au-dessus du parking, d'un seul tenant) : {m.sum() * 0.25:.0f} m², rectangle minimal "
              f"{sides[0]:.1f} × {sides[1]:.1f} m, côtés aux caps {a0:.0f}° et {(a0 + 90) % 180:.0f}°, centre ({rect.centroid.x:.1f} ; {rect.centroid.y:.1f}), "
              f"dessus (90ᵉ centile hors fût) {np.nanpercentile(t2.a[m & (np.hypot(XX - cx, YY - cy) > 2.5)], 90) - pz:+.2f} m")
    # Le LiDAR range la plate-forme en « sol » (classe 2), mais le MNT à 0,5 m l'adoucit : on la lit sur les points, dans le repère de la croix.
    U = (x - cx) * ax[0] + (y - cy) * ax[1]
    T = -(x - cx) * ax[1] + (y - cy) * ax[0]
    g2 = cls == 2

    def cell(uu, tt):
        m = g2 & (np.abs(U - uu) < 0.25) & (np.abs(T - tt) < 0.25)
        return float(np.median(z[m])) - pz if m.any() else float("nan")
    print("  points du sol (classe 2) par cellules de 0,5 m, au-dessus du parking ; u le long des bras (vers le cap "
          f"{cap:.0f}°), t en travers (vers le cap {(cap + 270) % 360:.0f}°) :")
    for label, fn in (("t = +1 (le long de u)", lambda d: cell(d, 1.0)), ("u = 0 (le long de t)", lambda d: cell(0.25, d))):
        print(f"    {label}, de −9 à +9 m : " + " ".join(f"{fn(d):+.1f}" for d in np.arange(-9, 9.5, 0.5)))
    top_u = [d for d in np.arange(-9, 9.5, 0.5) if cell(d, 1.0) > -0.15]
    top_t = [d for d in np.arange(-9, 9.5, 0.5) if cell(0.25, d) > -0.15]
    print(f"  dessus de la plate-forme (à moins de 15 cm du plus haut) : u {min(top_u):+.1f} .. {max(top_u):+.1f}, t {min(top_t):+.1f} .. {max(top_t):+.1f}")
    plinth = g2 & (z - pz > 0.25) & (np.abs(U) < 4) & (np.abs(T) < 4)
    if plinth.any():
        print(f"  marche du pied du fût (sol à plus de 25 cm au-dessus du dessus) : u {U[plinth].min():+.1f} .. {U[plinth].max():+.1f}, "
              f"t {T[plinth].min():+.1f} .. {T[plinth].max():+.1f}, haut {np.percentile(z[plinth] - pz, 90):.2f} m")
    print(f"  la croix au-dessus du dessus de la plate-forme : sommet {top - pz:.1f} m")

    # Mâts et poteaux : points hauts isolés (MNS) à moins de 60 m.
    print("  objets hauts et minces près de la croix (MNS − MNT > 5 m sur moins de 4 cellules de 0,5 m, à moins de 40 m) :")
    tallg = (h > 5) & (np.hypot(XX - cx, YY - cy) < 40) & (np.hypot(XX - cx, YY - cy) > 6)
    lab2, n2 = ndimage.label(tallg)
    for k in range(1, n2 + 1):
        m = lab2 == k
        if m.sum() <= 4:
            print(f"    ({XX[m].mean():7.1f} ; {YY[m].mean():7.1f}) haut de {h[m].max():.1f} m")

    # Vue : repères de la ville, distance, cap, et ce qui la cache (MNS, du regard à 1,7 m au-dessus de la plate-forme).
    print("\n== La vue depuis la plate-forme (œil à 1,7 m au-dessus du pied du fût)")
    places = json.loads((DATA / "map" / "places.json").read_text())["places"]
    eye = (base if not math.isnan(base) else ground) + 1.7
    big = dem("MNS", (-2000.0, -2000.0, 3000.0, 4700.0), 10.0)
    for name in VIEW_TARGETS:
        p = next((q for q in places if isinstance(q, dict) and q.get("name") == name), None)
        if not p:
            print(f"  {name} : absent de la carte")
            continue
        tx, ty = p["x"], p["y"]
        D = math.hypot(tx - cx, ty - cy)
        capt = math.degrees(math.atan2(tx - cx, ty - cy)) % 360
        tz = big.at(tx, ty)
        ang = math.degrees(math.atan2(tz - eye, D))
        worst, where = -90.0, 0.0
        for r in np.arange(5, D - 30, 2.0):
            px, py = cx + (tx - cx) * r / D, cy + (ty - cy) * r / D
            zz = s2.at(px, py) if r < half - 2 else big.at(px, py)
            a = math.degrees(math.atan2(zz - eye, r))
            if a > worst:
                worst, where = a, r
        print(f"  {p['name']} : {D:5.0f} m au cap {capt:3.0f}°, vu {ang:+5.1f}° ; obstacle le plus haut {worst:+5.1f}° à {where:4.0f} m "
              f"{'→ caché' if worst > ang else '→ visible'}")

    # Relief publié et côte d'aujourd'hui.
    coast = W["sea"]["coast"]
    ring = Polygon(list(zip(coast[0::2], coast[1::2])))
    print("\n== Le jeu aujourd'hui")
    print(f"  côte : la croix est à {ring.exterior.distance(Point(cx, cy)):.0f} m du trait de côte ; relief du jeu à la croix {game_h(cx, cy) + Z0:.1f} m (MNT {mnt.at(cx, cy) + Z0:.1f} m)")
    prof = []
    for d in range(-200, 101, 20):
        prof.append(f"{d:+4d} m : jeu {game_h(cx, cy + d) + Z0:5.0f} / MNT {mnt.at(cx, cy + d) + Z0:5.0f}")
    print("  profil nord-sud par la croix (y relatif) :\n    " + "\n    ".join(prof))
    trees = json.loads((DATA / "tiles" / "22_28.json").read_text())["trees"]
    near = [tr for tr in trees if math.hypot(tr[0] - cx, tr[1] - cy) < 40]
    print(f"  arbres du jeu à moins de 40 m de la croix : {len(near)} (hauteurs {sorted(round(tr[3], 1) for tr in near)})")
    inclear = [tr for tr in trees if math.hypot(tr[0] - cx, tr[1] - cy) < 90 and s2.at(tr[0], tr[1]) - t2.at(tr[0], tr[1]) < 1.5]
    print(f"  arbres du jeu posés dans la clairière réelle (MNS − MNT < 1,5 m) à moins de 90 m : {len(inclear)}"
          + "".join(f"\n    ({tr[0]:.1f} ; {tr[1]:.1f}) {tr[3]:.1f} m" for tr in inclear))

    # L'extension simulée.
    extension(ways, rd, acc, (cx, cy), mnt)

    if images:
        draw_images(images, ways, rd, acc, (cx, cy), cap)


def extension(ways, rd, acc, X, mnt):
    import coast_lib
    reg = json.loads((c.ROOT / "tools" / "data" / "region.json").read_text())
    play = {tuple(map(int, t.split("_"))) for t in reg["playable"]}
    border = {tuple(map(int, t.split("_"))) for t in reg["border"]}
    need = set()
    for line in (rd, acc, ways[PARKING][1], ways[TAKEOFF][1]):
        for p in resample(line, 5.0):
            need.add(tile_of(*p))
    for dx in range(-60, 61, 10):  # derrière la croix : 150 m de terre jouable au sud
        for dy in range(0, -151, 10):
            need.add(tile_of(X[0] + dx, X[1] + dy))
    new = sorted(need - play)
    play2 = play | set(new)
    border2 = (border | {(a + i, b + j) for a, b in play2 for i in (-1, 0, 1) for j in (-1, 0, 1)}) - play2
    print("\n== Extension simulée (region.json n'est pas modifié)")
    print(f"  nouvelles tuiles jouables ({len(new)}) : {' '.join(f'{a}_{b}' for a, b in new)}")
    added_b = sorted(border2 - border)
    print(f"  nouvelles tuiles de bordure ({len(added_b)}) : {' '.join(f'{a}_{b}' for a, b in added_b)}")
    print(f"  blocs touchés : {sorted({(a // c.BLOCK, b // c.BLOCK) for a, b in new + added_b})}")
    old_land = coast_lib.land()
    c.PLAYABLE, c.BORDER, c.REGION_TILES = play2, border2, play2 | border2
    coast_lib.land.cache_clear()
    coast_lib._prepared.cache_clear()
    land2 = coast_lib.land()
    gained = land2.difference(old_land)
    lost = old_land.difference(land2)
    print(f"  terre : {old_land.area / 1e6:.2f} → {land2.area / 1e6:.2f} km² (+{gained.area / 1e6:.2f}, perdue ailleurs {lost.area:.0f} m²)")
    for name, line in (("RD 256", rd), ("route d'accès", acc)):
        pts = resample(line, 5.0)
        d = [land2.exterior.distance(Point(p)) * (1 if land2.contains(Point(p)) else -1) for p in pts]
        print(f"  {name} : distance à la côte au plus près {min(d):.0f} m (négatif : en mer) ; points à moins de 40 m : {sum(v < 40 for v in d)} sur {len(d)}")
    print(f"  croix : {land2.exterior.distance(Point(X)):.0f} m de la nouvelle côte (aujourd'hui {old_land.exterior.distance(Point(X)):.0f} m)")
    # Sud de la croix : relief MNT et distance à la côte le long du méridien.
    s = [(d, land2.exterior.distance(Point(X[0], X[1] + d))) for d in range(0, -401, -50)]
    print("  au sud de la croix (y relatif : distance à la côte) : " + " ; ".join(f"{d} : {v:.0f} m" for d, v in s))
    x0, y0, x1, y1 = land2.bounds
    print(f"  emprise de la terre : y min {y0:.0f} (zone actuelle : y min {-2062})")
    (CACHE / "land2.json").write_text(json.dumps([list(p) for p in land2.exterior.coords]))
    (CACHE / "land1.json").write_text(json.dumps([list(p) for p in old_land.exterior.coords]))
    (CACHE / "tiles2.json").write_text(json.dumps({"new": [f"{a}_{b}" for a, b in new], "border": [f"{a}_{b}" for a, b in added_b]}))


def draw_images(out, ways, rd, acc, X, cap):
    from pathlib import Path
    Path(out).mkdir(parents=True, exist_ok=True)
    land1 = json.loads((CACHE / "land1.json").read_text())
    land2 = json.loads((CACHE / "land2.json").read_text())
    tiles2 = json.loads((CACHE / "tiles2.json").read_text())
    # Vue d'ensemble : orthophoto à 2 m, tuiles, côtes, routes.
    bx = (-1300.0, -2800.0, 700.0, -1100.0)
    res = 2.0
    im = ortho(bx, res)
    d = ImageDraw.Draw(im, "RGBA")
    P = lambda p: ((p[0] - bx[0]) / res, (bx[3] - p[1]) / res)
    for t in tiles2["new"] + tiles2["border"]:
        a, b = map(int, t.split("_"))
        x0, y0, x1, y1 = c.tile_bounds_local(a, b)
        d.rectangle([P((x0, y1)), P((x1, y0))], outline=(255, 255, 255, 160) if t in tiles2["new"] else (120, 180, 255, 120), width=2)
    d.line([P(p) for p in land1], fill=(255, 60, 60, 255), width=3)
    d.line([P(p) for p in land2], fill=(60, 160, 255, 255), width=3)
    d.line([P(p) for p in rd], fill=(255, 220, 0, 255), width=3)
    d.line([P(p) for p in acc], fill=(255, 140, 0, 255), width=3)
    for k in (PARKING, TAKEOFF):
        d.polygon([P(p) for p in ways[k][1]], outline=(255, 255, 255, 255))
    cx, cy = P(X)
    d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(255, 0, 255, 255))
    d.text((8, 8), "rouge : côte actuelle ; bleu : côte après extension ; jaune : RD 256 ; orange : route d'accès ; blanc : tuiles ajoutées", fill=(255, 255, 255, 255))
    im.save(Path(out) / "croix-extension.jpg", quality=85)
    # Le site : orthophoto à 0,2 m, 120 m de côté.
    half, res = 60.0, 0.2
    bx = (X[0] - half, X[1] - half, X[0] + half, X[1] + half)
    im = ortho(bx, res)
    d = ImageDraw.Draw(im, "RGBA")
    P = lambda p: ((p[0] - bx[0]) / res, (bx[3] - p[1]) / res)
    for k in (PARKING, TAKEOFF):
        d.polygon([P(p) for p in ways[k][1]], outline=(255, 255, 0, 255))
    d.line([P(p) for p in acc], fill=(255, 140, 0, 255), width=3)
    cx, cy = P(X)
    L = 40
    a = math.radians(cap)
    d.line([(cx - L * math.sin(a), cy + L * math.cos(a)), (cx + L * math.sin(a), cy - L * math.cos(a))], fill=(255, 0, 255, 255), width=3)
    im.save(Path(out) / "croix-site.jpg", quality=85)
    # Relief ombré du site (MNS à 0,5 m).
    s2 = dem("MNS", (X[0] - 90, X[1] - 90, X[0] + 90, X[1] + 90), 0.5).a
    gy, gx = np.gradient(s2, 0.5)
    shade = np.clip(0.6 + 0.4 * (-gx * 0.7 + gy * 0.7) / np.sqrt(1 + gx ** 2 + gy ** 2), 0, 1)
    Image.fromarray((np.nan_to_num(shade) * 255).astype(np.uint8)).save(Path(out) / "croix-mns.jpg", quality=85)


if __name__ == "__main__":
    main()
