"""Relevés de l'enquête du Lycée militaire d'Autun (docs/plans/lycee-militaire.md) : OpenStreetMap, LiDAR HD (MNS, MNT), orthophotographie.

Sortie : un rapport texte (stdout) et, avec --images DOSSIER, des vues annotées. Données téléchargées gardées dans .cache/militaire/ (hors git).
Aucun fichier du jeu n'est modifié.

Usage : python3 tools/data/survey_militaire.py [--images DOSSIER] [--crop NOM x0 y0 x1 y1 [res]]
Repère : local du jeu (x est, y nord, z au-dessus de ORIGIN_Z).
"""

import io
import json
import math
import sys
from pathlib import Path

import numpy as np
import requests
import tifffile
from PIL import Image, ImageDraw
from pyproj import Transformer

import config as c

OX, OY = c.ORIGIN
CACHE = c.ROOT / ".cache" / "militaire"
WMS = "https://data.geopf.fr/wms-r"
BOX = (400.0, -250.0, 950.0, 350.0)
TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
TO_WGS = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)
TILES = ["27_34", "27_35", "27_36", "28_34", "28_35", "28_36", "29_34", "29_35", "29_36"]


def local(lat, lon):
    x, y = TO_L93.transform(lon, lat)
    return x - OX, y - OY


def wms(layer, fmt, box, w, h, name):
    f = CACHE / name
    if f.exists():
        return f.read_bytes()
    x0, y0, x1, y1 = box
    r = requests.get(WMS, timeout=180, headers={"User-Agent": c.USER_AGENT}, params={
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "", "FORMAT": fmt, "CRS": "EPSG:2154",
        "BBOX": f"{OX + x0},{OY + y0},{OX + x1},{OY + y1}", "WIDTH": w, "HEIGHT": h})
    r.raise_for_status()
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_bytes(r.content)
    return r.content


def dem(kind, box=BOX, res=0.5):
    x0, y0, x1, y1 = box
    layer = f"IGNF_LIDAR-HD_{kind}_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
    a = tifffile.imread(io.BytesIO(wms(layer, "image/geotiff", box, int((x1 - x0) / res), int((y1 - y0) / res), f"{kind}-{int(x0)}-{int(y0)}-{res}.tif"))).astype(np.float32)
    a[a < -100] = np.nan
    return a - c.ORIGIN_Z


def ortho(box, res, name):
    x0, y0, x1, y1 = box
    data = wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", box, int((x1 - x0) / res), int((y1 - y0) / res), name)
    return Image.open(io.BytesIO(data)).convert("RGB")


class Grid:
    def __init__(self, a, box, res):
        self.a, self.box, self.res = a, box, res

    def at(self, x, y):
        i = int((self.box[3] - y) / self.res)
        j = int((x - self.box[0]) / self.res)
        if 0 <= i < self.a.shape[0] and 0 <= j < self.a.shape[1]:
            return float(self.a[i, j])
        return float("nan")

    def mask(self, poly):
        """Masque des cellules dont le centre est dans le polygone [(x, y), …]."""
        import shapely
        h, w = self.a.shape
        xs = self.box[0] + (np.arange(w) + 0.5) * self.res
        ys = self.box[3] - (np.arange(h) + 0.5) * self.res
        X, Y = np.meshgrid(xs, ys)
        return shapely.contains_xy(shapely.Polygon(poly), X, Y)


def osm():
    d = json.loads((CACHE / "osm-api.json").read_text())
    nodes = {e["id"]: e for e in d["elements"] if e["type"] == "node"}
    ways = [e for e in d["elements"] if e["type"] == "way"]
    out = []
    for wy in ways:
        pts = [local(nodes[n]["lat"], nodes[n]["lon"]) for n in wy["nodes"] if n in nodes]
        out.append((wy, pts))
    tagged = [(n, local(n["lat"], n["lon"])) for n in nodes.values() if n.get("tags")]
    return out, tagged


def area(pts):
    return 0.5 * abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts))))


def inside(pt, poly):
    x, y = pt
    r = False
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i - 1], poly[i]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            r = not r
    return r


def report_osm():
    ways, nodes = osm()
    site = next((p for w, p in ways if w["id"] == 80374605), None)
    print("== OSM : enceinte du lycée (way 80374605)")
    if site:
        xs, ys = [p[0] for p in site], [p[1] for p in site]
        print(f"  {len(site)} sommets, {area(site):.0f} m², x {min(xs):.0f}..{max(xs):.0f}, y {min(ys):.0f}..{max(ys):.0f}")
    print("== OSM : chemins et objets dans l'enceinte ou à moins de 15 m")
    near = lambda p: site and (inside(p, site) or min(math.dist(p, q) for q in site) < 15)
    for w, pts in ways:
        t = w.get("tags", {})
        if not t or w["id"] == 80374605 or not pts:
            continue
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        if not near((cx, cy)):
            continue
        keys = {k: v for k, v in t.items() if k in ("building", "highway", "barrier", "leisure", "landuse", "amenity", "natural", "sport", "name", "access", "service", "man_made", "surface", "water", "height", "building:levels", "roof:shape", "historic")}
        L = sum(math.dist(pts[i], pts[i - 1]) for i in range(1, len(pts)))
        closed = pts[0] == pts[-1] and len(pts) > 3
        print(f"  way {w['id']:>10} ({cx:6.1f} ; {cy:6.1f}) {'aire ' + str(round(area(pts))) + ' m²' if closed else 'long. ' + str(round(L)) + ' m'} {keys}")
    for n, p in nodes:
        if near(p):
            print(f"  node {n['id']:>10} ({p[0]:6.1f} ; {p[1]:6.1f}) {n['tags']}")


def tile_buildings():
    root = c.ROOT / "public" / "data"
    out = []
    for t in TILES:
        f = root / "tiles" / f"{t}.json"
        k = root / "kinds" / f"{t}.json"
        if not f.exists():
            continue
        d = json.loads(f.read_text())
        kinds = json.loads(k.read_text())["buildings"] if k.exists() else {}
        for b in d["buildings"]:
            r = b["ring"]
            pts = list(zip(r[0::2], r[1::2]))
            out.append((t, b, pts, kinds.get(b["id"], {})))
    return out


def report_buildings(dsm, dtm):
    ways, _ = osm()
    site = next(p for w, p in ways if w["id"] == 80374605)
    print("== Bâtiments du jeu dans l'enceinte (BD TOPO) : sol, sommet LiDAR (percentile 98), médiane, jeu")
    for t, b, pts, k in tile_buildings():
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        if not inside((cx, cy), site):
            continue
        m = dsm.mask(pts)
        z = dsm.a[m]
        z = z[~np.isnan(z)]
        g = dtm.a[m]
        g = g[~np.isnan(g)]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        print(f"  {t} …{b['id'][-6:]} {area(pts):6.0f} m² {len(pts):2d} s. centre ({cx:5.1f} ; {cy:5.1f}) bbox {max(xs) - min(xs):4.0f}×{max(ys) - min(ys):3.0f}"
              f" | sol {np.nanmedian(g) if g.size else float('nan'):5.1f} | LiDAR p98 {np.percentile(z, 98) if z.size else float('nan'):5.1f} méd {np.median(z) if z.size else float('nan'):5.1f}"
              f" | jeu égout {b.get('eave')} faîte {b.get('ridge')} {b.get('roofKind')} | BD {b['bd']['height']} m, {b['bd']['year']}, {b['bd']['use']} | {k}")


def profile(dsm, dtm, a, b, step=1.0, label=""):
    L = math.dist(a, b)
    n = int(L / step) + 1
    print(f"== Profil {label} ({a[0]:.0f} ; {a[1]:.0f}) → ({b[0]:.0f} ; {b[1]:.0f}), {L:.0f} m : d, MNT, MNS")
    row = []
    for i in range(n):
        x, y = a[0] + (b[0] - a[0]) * i / max(n - 1, 1), a[1] + (b[1] - a[1]) * i / max(n - 1, 1)
        row.append(f"{i * step:.0f}:{dtm.at(x, y):.1f}/{dsm.at(x, y):.1f}")
    for i in range(0, len(row), 10):
        print("  " + "  ".join(row[i:i + 10]))


def images(folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    x0, y0, x1, y1 = BOX
    img = ortho(BOX, 0.25, "ortho-overview.jpg")
    d = ImageDraw.Draw(img)
    s = 1 / 0.25
    P = lambda p: ((p[0] - x0) * s, (y1 - p[1]) * s)
    ways, _ = osm()
    for w, pts in ways:
        t = w.get("tags", {})
        col = None
        if w["id"] == 80374605:
            col = (255, 0, 0)
        elif "barrier" in t:
            col = (255, 255, 0)
        elif "highway" in t:
            col = (0, 200, 255)
        if col and len(pts) > 1:
            d.line([P(p) for p in pts], fill=col, width=3)
    for _t, _b, pts, _k in tile_buildings():
        d.line([P(p) for p in pts + pts[:1]], fill=(255, 0, 255), width=2)
    for gx in range(int(x0 // 50 * 50), int(x1) + 1, 50):
        d.line([P((gx, y0)), P((gx, y1))], fill=(255, 255, 255), width=1)
        d.text(P((gx + 1, y1 - 2)), str(gx), fill=(255, 255, 255))
    for gy in range(int(y0 // 50 * 50), int(y1) + 1, 50):
        d.line([P((x0, gy)), P((x1, gy))], fill=(255, 255, 255), width=1)
        d.text(P((x0 + 1, gy + 4)), str(gy), fill=(255, 255, 255))
    img.save(folder / "militaire-ortho.jpg", quality=85)
    dsm = dem("MNS")
    dtm = dem("MNT")
    h = np.clip(np.nan_to_num(dsm - dtm), 0, 25) / 25
    Image.fromarray((h * 255).astype(np.uint8)).save(folder / "militaire-mnh.png")
    g = np.nan_to_num(dtm)
    lo, hi = np.percentile(g, 1), np.percentile(g, 99)
    Image.fromarray((np.clip((g - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8)).save(folder / "militaire-mnt.png")
    print(f"images écrites dans {folder} (MNT de {lo:.1f} à {hi:.1f})")


def crop(folder, name, x0, y0, x1, y1, res=0.1):
    box = (x0, y0, x1, y1)
    img = ortho(box, res, f"ortho-{name}.jpg")
    d = ImageDraw.Draw(img)
    s = 1 / res
    step = 10 if x1 - x0 <= 120 else 25
    for gx in range(int(math.ceil(x0 / step) * step), int(x1) + 1, step):
        d.line([((gx - x0) * s, 0), ((gx - x0) * s, img.height)], fill=(255, 255, 255), width=1)
        d.text(((gx - x0) * s + 2, 2), str(gx), fill=(255, 255, 0))
    for gy in range(int(math.ceil(y0 / step) * step), int(y1) + 1, step):
        d.line([(0, (y1 - gy) * s), (img.width, (y1 - gy) * s)], fill=(255, 255, 255), width=1)
        d.text((2, (y1 - gy) * s + 2), str(gy), fill=(255, 255, 0))
    Path(folder).mkdir(parents=True, exist_ok=True)
    img.save(Path(folder) / f"militaire-{name}.jpg", quality=88)


def main():
    args = sys.argv[1:]
    if "--crop" in args:
        i = args.index("--crop")
        name, *nums = args[i + 1:i + 7]
        folder = args[args.index("--images") + 1] if "--images" in args else "."
        crop(folder, name, *map(float, nums[:4]), *(map(float, nums[4:5]) if len(nums) > 4 else []))
        return
    dsm = Grid(dem("MNS"), BOX, 0.5)
    dtm = Grid(dem("MNT"), BOX, 0.5)
    report_osm()
    report_buildings(dsm, dtm)
    if "--images" in args:
        images(args[args.index("--images") + 1])


if __name__ == "__main__":
    main()
