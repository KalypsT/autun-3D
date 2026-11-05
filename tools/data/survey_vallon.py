"""Le plan d'eau du Vallon, lot 0 (D243, plan `docs/plans/vallon-lac.md`) : relevés du chemin du tour du lac et des pontons, avant de rien dessiner.

Ne modifie rien. Lit OpenStreetMap (API, gardé dans `.cache/shared/raw/vallon/`), l'orthophotographie IGN (20 cm), le modèle de surface LiDAR HD (0,5 m)
et les données publiées (`public/data/` : relief fin, eau, arbres, mobilier, murs).

Le chemin : la boucle OSM (allée Marcel Lucotte, quatre tronçons, et le raccord par la base nautique), échantillonnée tous les `STEP` m. À chaque station,
profil en travers de ± `HALF` m sur l'orthophotographie : le chemin est la bande la plus proche de l'axe qui est claire et peu saturée (stabilisé : clair et
beige, voir `classify`). On en tire le décalage du milieu de la bande par rapport à l'axe OSM, et sa largeur ; une station sans bande
(ombre d'un arbre, herbe) est « masquée ». Relief publié le long de l'axe recalé : hauteur au-dessus du lac, dévers (pente en travers sur 3 m), distance à l'eau.

Les pontons : géométrie OSM (longueur, cap par rapport à la rive), hauteur du modèle de surface au-dessus du lac le long de chaque ponton (médiane : le
tablier, si le LiDAR l'a vu) et largeur claire sur l'orthophotographie.

Usage : python3 tools/data/survey_vallon.py
Sortie : un résumé lisible, `tools/data/vallon_survey.json` (tous les chiffres, pour le lot 1), et des vignettes d'orthophotographie dans
`.cache/shared/raw/vallon/` (pontons, base, skatepark).
"""

import io
import json
import math
import time

import numpy as np
import requests
import tifffile
from PIL import Image
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

import config as c
from survey_water import Relief, load_structures

CACHE = c.SHARED / "raw" / "vallon"
REPORT = c.ROOT / "tools" / "data" / "vallon_survey.json"
WMS = "https://data.geopf.fr/wms-r"
BOX = (900.0, -120.0, 1620.0, 760.0)
LAKE_Z = -25.41
STEP = 10.0
HALF = 8.0
RES = 0.2
CHUNK = 200.0
# La boucle, dans l'ordre : de l'angle sud-est vers l'ouest et le nord, la digue, la base, puis la rive est jusqu'au départ.
LOOP = [223427553, 1548131445, 842375498, 1525431705]
PIERS = [422698578, 842375499, 842375500, 842375502, 1227421196]
# Vignettes à regarder à l'œil (nom, emprise).
THUMBS = {
    "base": (1260, 540, 1380, 660),
    "skatepark": (1350, 500, 1450, 600),
    "aire-de-jeux": (1475, 125, 1535, 185),
    "parking-sud-ouest": (980, 200, 1050, 270),
    "gue-brisecou": (1320, -40, 1390, 60),
}


def osm():
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / "osm.json"
    if not path.exists():
        to_wgs = Transformer.from_crs(2154, 4326, always_xy=True).transform
        lon0, lat0 = to_wgs(c.ORIGIN[0] + BOX[0], c.ORIGIN[1] + BOX[1])
        lon1, lat1 = to_wgs(c.ORIGIN[0] + BOX[2], c.ORIGIN[1] + BOX[3])
        r = requests.get("https://api.openstreetmap.org/api/0.6/map.json", params={"bbox": f"{lon0:.6f},{lat0:.6f},{lon1:.6f},{lat1:.6f}"},
                         headers={"User-Agent": c.USER_AGENT}, timeout=180)
        r.raise_for_status()
        path.write_text(r.text)
    els = json.loads(path.read_text())["elements"]
    to_l93 = Transformer.from_crs(4326, 2154, always_xy=True).transform
    nodes = {}
    for e in els:
        if e["type"] == "node":
            x, y = to_l93(e["lon"], e["lat"])
            nodes[e["id"]] = (x - c.ORIGIN[0], y - c.ORIGIN[1])
    ways = {e["id"]: e for e in els if e["type"] == "way"}
    return nodes, ways


def wms(layer, fmt, box, res, name):
    f = CACHE / name
    if not f.exists():
        x0, y0, x1, y1 = box
        for attempt in range(5):
            try:
                r = requests.get(WMS, timeout=180, headers={"User-Agent": c.USER_AGENT}, params={
                    "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "", "FORMAT": fmt, "CRS": "EPSG:2154",
                    "BBOX": f"{c.ORIGIN[0] + x0},{c.ORIGIN[1] + y0},{c.ORIGIN[0] + x1},{c.ORIGIN[1] + y1}",
                    "WIDTH": round((x1 - x0) / res), "HEIGHT": round((y1 - y0) / res)})
                r.raise_for_status()
                f.write_bytes(r.content)
                break
            except requests.RequestException:
                time.sleep(4 * 2**attempt)
        else:
            raise RuntimeError(f"WMS {layer} {box}")
    return f


class Ortho:
    """Orthophotographie à 20 cm, par carrés de `CHUNK` m chargés à la demande."""

    def __init__(self):
        self.chunks = {}

    def chunk(self, i, j):
        if (i, j) not in self.chunks:
            box = (i * CHUNK, j * CHUNK, (i + 1) * CHUNK, (j + 1) * CHUNK)
            f = wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", box, RES, f"ortho_{i}_{j}.jpg")
            self.chunks[(i, j)] = np.asarray(Image.open(f).convert("RGB")).astype(np.int16)
        return self.chunks[(i, j)]

    def at(self, x, y):
        i, j = math.floor(x / CHUNK), math.floor(y / CHUNK)
        a = self.chunk(i, j)
        col = int((x - i * CHUNK) / RES)
        row = int(((j + 1) * CHUNK - y) / RES)
        n = a.shape[0]
        return a[min(max(row, 0), n - 1), min(max(col, 0), a.shape[1] - 1)]


def classify(rgb):
    """1 chemin clair (stabilisé : luminance 230 à 245 au soleil, 180 à 205 à l'ombre légère), 0 autre.

    L'enrobé ne se distingue pas de la pelouse sur cette orthophotographie (gris moyen peu saturé, comme l'herbe rase grillée de l'été) :
    il n'est pas classé, la matière vient d'OSM et des photos."""
    r, g, b = (int(v) for v in rgb)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return 1 if lum >= 180 and max(r, g, b) - min(r, g, b) < 45 else 0


def band(cls, offsets):
    """Bande de chemin la plus proche de l'axe (trous d'au plus deux échantillons) : (milieu, largeur, matière) ou None."""
    runs, cur, gap = [], None, 0
    for k, v in enumerate(cls):
        if v:
            if cur is None:
                cur = [k, k, [v]]
            else:
                cur[1] = k
                cur[2].append(v)
            gap = 0
        elif cur is not None:
            gap += 1
            if gap > 2:
                runs.append(cur)
                cur, gap = None, 0
    if cur is not None:
        runs.append(cur)
    best = None
    for k0, k1, vs in runs:
        o0, o1 = offsets[k0], offsets[k1]
        width = o1 - o0 + RES
        if width < 0.8 or width > 9:
            continue
        d = 0 if o0 <= 0 <= o1 else min(abs(o0), abs(o1))
        if d > 4:
            continue
        mat = "clair"
        if best is None or d < best[0]:
            best = (d, (o0 + o1) / 2, width, mat)
    return None if best is None else best[1:]


def loop_axis(nodes, ways):
    parts = [LineString([nodes[n] for n in ways[i]["nodes"]]) for i in LOOP]
    # Raccord par la base nautique : du bout de la digue au départ de la rive est (42 m, sur les allées en enrobé de la base).
    gap = LineString([parts[2].coords[-1], parts[3].coords[0]])
    coords = list(parts[0].coords)
    for p in (parts[1], parts[2], gap, parts[3]):
        coords += list(p.coords)[1:]
    return LineString(coords), [(i, round(p.length)) for i, p in zip(LOOP, parts)] + [("raccord base", round(gap.length))]


def survey_path(axis, ortho, relief, lake, trees):
    stations = []
    offsets = np.arange(-HALF, HALF + 1e-6, RES)
    n = int(axis.length // STEP)
    for k in range(n + 1):
        s = min(k * STEP, axis.length)
        p = axis.interpolate(s)
        q = axis.interpolate(min(s + 1, axis.length)) if s + 1 <= axis.length else axis.interpolate(s - 1)
        dx, dy = q.x - p.x, q.y - p.y
        if s + 1 > axis.length:
            dx, dy = -dx, -dy
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L  # à gauche du sens de parcours
        cls = [classify(ortho.at(p.x + nx * o, p.y + ny * o)) for o in offsets]
        b = band(cls, offsets)
        st = {"s": round(s), "x": round(p.x, 1), "y": round(p.y, 1)}
        cx, cy = p.x, p.y
        if b:
            off, w, mat = b
            st.update(off=round(off, 1), w=round(w, 1), mat=mat)
            cx, cy = p.x + nx * off, p.y + ny * off
        else:
            st["mat"] = "masque"
        z = relief.at(cx, cy)
        zl, zr = relief.at(cx + nx * 1.5, cy + ny * 1.5), relief.at(cx - nx * 1.5, cy - ny * 1.5)
        st.update(z=round(z, 2), above=round(z - LAKE_Z, 2), slope=round((zl - zr) / 3 * 100, 1),
                  water=round(lake.exterior.distance(Point(cx, cy)), 1), tree=round(min(t.distance(Point(cx, cy)) for t in trees), 1))
        stations.append(st)
    return stations


def survey_piers(nodes, ways, mns, lake):
    out = []
    for i in PIERS:
        w = ways[i]
        line = LineString([nodes[n] for n in w["nodes"]])
        pts = [line.interpolate(d) for d in np.arange(0, line.length + 0.01, 0.5)]
        zs = np.array([mns(p.x, p.y) for p in pts])
        # Cap de chaque segment par rapport à la normale à la rive la plus proche (0° : droit vers le large).
        segs = []
        cs = list(line.coords)
        for a, b in zip(cs, cs[1:]):
            m = Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            shore = lake.exterior.interpolate(lake.exterior.project(m))
            ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]) - math.atan2(m.y - shore.y, m.x - shore.x))
            ang = (ang + 180) % 360 - 180
            segs.append({"len": round(math.dist(a, b), 1), "vsShoreNormal": round(abs(ang) if abs(ang) <= 90 else 180 - abs(ang))})
        inside = [lake.contains(p) for p in pts]
        out.append({"osm": f"w{i}", "floating": w["tags"].get("floating") == "yes", "length": round(line.length, 1),
                    "start": [round(v, 1) for v in cs[0]], "end": [round(v, 1) for v in cs[-1]], "segments": segs,
                    "inWater": round(sum(inside) / len(inside) * 100),
                    "mnsAboveLake": {"median": round(float(np.median(zs - LAKE_Z)), 2), "p10": round(float(np.percentile(zs - LAKE_Z, 10)), 2),
                                     "p90": round(float(np.percentile(zs - LAKE_Z, 90)), 2)}})
    return out


def thumbs():
    for name, box in THUMBS.items():
        wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", box, 0.1, f"vignette_{name}.jpg")
    for i, (x, y) in enumerate([(1280, 632), (1029, 302), (1129, 169), (1292, 117), (1306, 606)]):
        wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", (x - 40, y - 40, x + 40, y + 40), 0.1, f"vignette_ponton_{i}.jpg")


def main():
    nodes, ways = osm()
    polys, _, _ = load_structures()
    lake = max((g for _, g in polys if g.intersects(Point(1240, 420))), key=lambda g: g.area)
    lake = unary_union([g for _, g in polys if g.distance(lake) < 0.5])
    if lake.geom_type != "Polygon":
        lake = max(lake.geoms, key=lambda g: g.area)
    relief = Relief()
    trees = []
    for f in sorted((c.OUT / "tiles").glob("*.json")):
        t = json.loads(f.read_text())
        b = t["bounds"]
        if b[2] < BOX[0] or b[0] > BOX[2] or b[3] < BOX[1] or b[1] > BOX[3]:
            continue
        trees += [Point(tr[0], tr[1]) for tr in t["trees"]]
    axis, parts = loop_axis(nodes, ways)
    ortho = Ortho()
    stations = survey_path(axis, ortho, relief, lake, trees)

    x0, y0, x1, y1 = BOX
    mf = wms("IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", "image/geotiff", BOX, 0.5, "vallon_MNS.tif")
    M = tifffile.imread(io.BytesIO(mf.read_bytes())).astype(np.float64) - c.ORIGIN_Z

    def mns(x, y):
        return float(M[int((y1 - y) / 0.5), int((x - x0) / 0.5)])

    piers = survey_piers(nodes, ways, mns, lake)
    thumbs()

    seen = [s for s in stations if s["mat"] != "masque"]
    offs = np.array([abs(s["off"]) for s in seen])
    report = {"axis": {"length": round(axis.length), "parts": parts, "points": [[round(x, 1), round(y, 1)] for x, y in axis.coords]},
              "stations": stations, "piers": piers}
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n")

    print(f"Boucle : {axis.length:.0f} m, {len(stations)} stations tous les {STEP:.0f} m ; tronçons {parts}")
    print(f"Vues à l'orthophotographie : {len(seen)} ({len(seen) / len(stations) * 100:.0f} %), masquées : {len(stations) - len(seen)}")
    print(f"Écart de l'axe OSM au milieu du chemin : médiane {np.median(offs):.1f} m, 90 % {np.percentile(offs, 90):.1f} m, max {offs.max():.1f} m ;"
          f" > 1 m : {int((offs > 1).sum())} stations")
    for name, lo, hi in (("sud et ouest", 0, 982), ("digue", 982, 982 + 146 + 77), ("base", 982 + 223, 982 + 223 + 42), ("est", 982 + 265, 1e9)):
        part = [s for s in seen if lo <= s["s"] < hi]
        if part:
            ws = [s["w"] for s in part]
            print(f"  {name} : {len(part)} stations vues, largeur médiane {np.median(ws):.1f} m (10 % {np.percentile(ws, 10):.1f}, 90 % {np.percentile(ws, 90):.1f})")
    ab = np.array([s["above"] for s in stations])
    sl = np.array([abs(s["slope"]) for s in stations])
    print(f"Hauteur au-dessus du lac : min {ab.min():.2f}, médiane {np.median(ab):.2f}, max {ab.max():.2f} ; à moins de 0,3 m : {int((ab < 0.3).sum())}")
    print(f"Dévers : médiane {np.median(sl):.1f} %, > 4 % : {int((sl > 4).sum())} stations ; à moins de 1 m de l'eau : {sum(1 for s in stations if s['water'] < 1)}")
    print(f"Arbres à moins de 1,5 m du milieu du chemin : {sum(1 for s in stations if s['tree'] < 1.5)} stations")
    for p in piers:
        print(f"Ponton {p['osm']} ({'flottant' if p['floating'] else 'fixe'}) : {p['length']} m, segments {[(s['len'], s['vsShoreNormal']) for s in p['segments']]},"
              f" dans l'eau {p['inWater']} %, modèle de surface au-dessus du lac {p['mnsAboveLake']}")


if __name__ == "__main__":
    main()
