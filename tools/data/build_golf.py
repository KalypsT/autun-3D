"""Le golf municipal d'Autun (D288, chemin des Ragots) : les sols du parcours (lot 1 du plan du golf).

OpenStreetMap n'a que le contour du golf (relation 6332293) ; greens, départs et bunkers sont relevés sur l'orthophotographie de l'IGN (été :
greens arrosés vert vif sur l'herbe sèche, bunkers de sable clair) ; les photos de l'utilisateur servent seulement à décrire.

    --trace   relève greens (à partir d'un point posé à la main au centre de chacun, la tache grandit selon le vert local), départs (petites
              taches vert vif hors des greens) et bunkers (taches claires et compactes) ; écrit tools/data/golf.json. Contour du golf :
              OpenStreetMap (téléchargé dans .cache/golf).
    (rien)    pose dans les tuiles : fairways (`golf_fairway` et `golf_fairway2`, bandes de tonte de 9 m dans l'axe de chaque trou), greens
              (`golf_green`), départs (`golf_tee`), bunkers (`golf_bunker`), drapeau sur chaque green (mobilier `golf_flag`) ; puis les images
              de carte des kilomètres touchés. Relançable : les couches golf_* et les drapeaux sont d'abord retirés.

Le rough reste le sol d'origine : le bord du golf (8 m), le pied des arbres, les abords des bâtiments, des routes et de l'eau.
"""

import io
import json
import math
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import shapely
from PIL import Image
from scipy import ndimage
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box
from shapely.ops import unary_union, voronoi_diagram

import config as c
from build_streetscape import decode, encode, polys

HERE = Path(__file__).parent
OUT = c.OUT
DATA = HERE / "golf.json"
CACHE = c.ROOT / ".cache" / "golf"
RELATION = 6332293
BOX = (1700.0, -350.0, 2700.0, 450.0)  # emprise locale de l'orthophotographie relevée
RES = 0.25
LAYERS = ("golf_fairway", "golf_fairway2", "golf_green", "golf_tee", "golf_bunker")
STRIPE = 9.0          # largeur d'une bande de tonte (m)
EDGE = 8.0            # rough au bord du golf (m)
TREE_GAP = 3.0        # rough au pied des arbres (m, au-delà du tronc)
FLAG_ID0 = -960_000_000
# Centre de chaque green, posé à la main sur l'orthophotographie (repère local, m).
GREEN_SEEDS = [(1830, 365), (1970, 185), (2143, 157), (2125, 120), (1900, 100), (2128, 35), (1830, -55), (2052, -77), (1815, -145),
               (2230, -95), (2423, 52), (2555, -130), (2460, -205), (2305, -200)]


# --- Relevé ---------------------------------------------------------------------------------------------------------------------
def golf_outline():
    p = CACHE / "relation.xml"
    if not p.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(f"https://api.openstreetmap.org/api/0.6/relation/{RELATION}/full", headers={"User-Agent": "autun-3d-tools"})
        p.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    from pyproj import Transformer

    t = Transformer.from_crs(4326, 2154, always_xy=True)
    r = ET.fromstring(p.read_bytes())
    nodes = {n.get("id"): t.transform(float(n.get("lon")), float(n.get("lat"))) for n in r.iter("node")}
    rings = []
    for w in r.iter("way"):
        pts = [(nodes[n.get("ref")][0] - c.ORIGIN[0], nodes[n.get("ref")][1] - c.ORIGIN[1]) for n in w.iter("nd")]
        if len(pts) > 3:
            rings.append(Polygon(pts).buffer(0))
    return unary_union(rings)


def ortho():
    import fetch

    x0, y0, x1, y1 = BOX
    w, h = int((x1 - x0) / RES), int((y1 - y0) / RES)
    big = Image.new("RGB", (w, h))
    for bx in range(2):
        for by in range(2):
            ax0, ay0 = x0 + bx * 500, y0 + by * 400
            data = fetch.wms_block("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", ax0 + c.ORIGIN[0], ay0 + c.ORIGIN[1], ax0 + 500 + c.ORIGIN[0],
                                   ay0 + 400 + c.ORIGIN[1], int(500 / RES), int(400 / RES), CACHE / f"o_{bx}_{by}.jpg")
            big.paste(Image.open(io.BytesIO(data)).convert("RGB"), (bx * int(500 / RES), (1 - by) * int(400 / RES)))
    return np.asarray(big).astype(float)


def mask_polygons(m, ox, oy, res):
    import rasterio.features as rf

    out = []
    for g, _ in rf.shapes(m.astype(np.uint8), mask=m):
        out.append(Polygon([(ox + px * res, oy - py * res) for px, py in g["coordinates"][0]]).buffer(0))
    return out


def trace():
    A = ortho()
    R, G, B = A[..., 0], A[..., 1], A[..., 2]
    x0, _, _, y1 = BOX
    golf = golf_outline()
    # Greens : la tache autour de chaque point, au-dessus de la moitié du contraste entre le point et son voisinage.
    idx = ndimage.gaussian_filter(G - R, 2) + 0.5 * ndimage.gaussian_filter(G - B, 2)
    greens = []
    for sx, sy in GREEN_SEEDS:
        cx, cy, r = int((sx - x0) / RES), int((y1 - sy) / RES), int(26 / RES)
        win = idx[cy - r:cy + r, cx - r:cx + r]
        sv, bg = np.median(idx[cy - 8:cy + 8, cx - 8:cx + 8]), np.median(win)
        yy, xx = np.mgrid[-r:r, -r:r]
        m = (win > (sv + bg) / 2) & ((xx ** 2 + yy ** 2) < (22 / RES) ** 2)
        lab, _ = ndimage.label(m)
        m = ndimage.binary_fill_holes(ndimage.binary_opening(lab == lab[r, r], iterations=3))
        lab, _ = ndimage.label(m)
        m = lab == lab[r, r]
        p = max(mask_polygons(m, x0 + (cx - r) * RES, y1 - (cy - r) * RES, RES), key=lambda q: q.area)
        greens.append(p.buffer(1.5).buffer(-1.5).simplify(0.3))
    # Départs et bunkers : à 0,5 m.
    small = np.asarray(Image.fromarray(A.astype(np.uint8)).resize((A.shape[1] // 2, A.shape[0] // 2), Image.LANCZOS)).astype(float)
    R, G, B = small[..., 0], small[..., 1], small[..., 2]
    H, W = R.shape
    yy, xx = np.mgrid[0:H, 0:W]
    inside = shapely.contains_xy(golf.buffer(3), x0 + (xx + 0.5) * 0.5, y1 - (yy + 0.5) * 0.5)
    lum = (R + G + B) / 3

    def comps(m, amin, amax, cmin):
        m = ndimage.binary_fill_holes(ndimage.binary_closing(ndimage.binary_opening(m, iterations=1), iterations=2))
        return [p for p in mask_polygons(m, x0, y1, 0.5) if amin <= p.area <= amax and 4 * math.pi * p.area / p.length ** 2 >= cmin]

    built = built_mask()
    gu = unary_union(greens)
    tees = [p.minimum_rotated_rectangle for p in comps((G - R > 15) & (lum > 85) & (G - B > 12) & inside, 40, 300, 0.3)
            if p.distance(gu) > 8 and not p.intersects(built)]
    bunkers = [p.buffer(0.8).buffer(-0.8).simplify(0.3) for p in comps((lum > 175) & (R - B > 20) & (R - B < 90) & inside, 12, 600, 0.3)
               if not p.intersects(built)]
    rnd = lambda p: [[round(x, 2), round(y, 2)] for x, y in p.exterior.coords][:-1]
    DATA.write_text(json.dumps({
        "_doc": "Golf municipal d'Autun (build_golf.py --trace, D288) : contour OpenStreetMap, greens, départs et bunkers relevés sur l'orthophotographie de l'IGN.",
        "outline": [rnd(p) for p in polys(golf)], "greens": [rnd(p) for p in greens], "tees": [rnd(p) for p in tees], "bunkers": [rnd(p) for p in bunkers],
    }, ensure_ascii=False, indent=1))
    print(f"golf : {golf.area / 1e4:.1f} ha ; {len(greens)} greens, {len(tees)} départs, {len(bunkers)} bunkers ; écrit {DATA}")


def built_mask():
    """Bâtiments (+ 3 m), chaussées, trottoirs, places et eau publiés autour du golf : jamais de sol de golf dessus."""
    world = json.loads((OUT / "world.json").read_text())
    area = box(*BOX)
    geoms = []
    for t in world["tiles"]:
        if not area.intersects(box(*t["bounds"])):
            continue
        d = json.loads((OUT / "tiles" / f"{t['id']}.json").read_text())
        for b in d["buildings"]:
            r = b["ring"]
            geoms.append(Polygon([(r[i], r[i + 1]) for i in range(0, len(r), 2)]).buffer(3.0))
        for layer, ps in d["ground"].items():
            if layer.startswith(("road_", "plaza_")) or layer in ("walk", "water"):
                geoms += [decode(p).buffer(2.0) for p in ps]
    return unary_union(geoms)


# --- Pose -----------------------------------------------------------------------------------------------------------------------
def poly_of(r):
    return Polygon(r).buffer(0)


def layout(spec):
    golf = unary_union([poly_of(r) for r in spec["outline"]])
    greens = [poly_of(r) for r in spec["greens"]]
    tees = [poly_of(r) for r in spec["tees"]]
    bunkers = [poly_of(r) for r in spec["bunkers"]]
    built = built_mask()
    trees = []
    world = json.loads((OUT / "world.json").read_text())
    for t in world["tiles"]:
        if golf.intersects(box(*t["bounds"])):
            trees += [Point(tr[0], tr[1]).buffer(TREE_GAP) for tr in json.loads((OUT / "tiles" / f"{t['id']}.json").read_text())["trees"]]
    special = unary_union(greens + tees + bunkers)
    fair = golf.buffer(-EDGE).difference(built).difference(unary_union(trees)).difference(special.buffer(0.3))
    fair = fair.buffer(-1.5).buffer(1.5)  # pas de lanières entre deux arbres
    fair = unary_union([p for p in polys(fair) if p.area > 150])
    # Un trou par green : cellules de Voronoï des greens ; la tonte suit l'axe du green au départ le plus loin de sa cellule (sinon au
    # point le plus loin de la cellule).
    centers = MultiPoint([g.centroid for g in greens])
    cells = voronoi_diagram(centers, envelope=golf.envelope.buffer(200))
    a, b = [], []
    for cell in cells.geoms:
        g = next(gr for gr in greens if cell.contains(gr.centroid))
        gc = g.centroid
        part = fair.intersection(cell)
        if part.is_empty:
            continue
        own = [t.centroid for t in tees if cell.contains(t.centroid)]
        far = max(own, key=gc.distance) if own else max((Point(q) for p in polys(part) for q in p.exterior.coords), key=gc.distance)
        ax, ay = far.x - gc.x, far.y - gc.y
        L = math.hypot(ax, ay) or 1.0
        nx, ny = -ay / L, ax / L  # bandes parallèles à l'axe : on les compte à travers lui
        s = [nx * x + ny * y for p in polys(part) for x, y in p.exterior.coords]
        k0, k1 = math.floor(min(s) / STRIPE), math.ceil(max(s) / STRIPE)
        big = 2000.0
        for k in range(k0, k1):
            o0, o1 = k * STRIPE, (k + 1) * STRIPE
            band = Polygon([(nx * o0 - ny * big, ny * o0 + nx * big), (nx * o1 - ny * big, ny * o1 + nx * big),
                            (nx * o1 + ny * big, ny * o1 - nx * big), (nx * o0 + ny * big, ny * o0 - nx * big)])
            piece = part.intersection(band)
            (a if k % 2 == 0 else b).extend(q for q in polys(piece) if q.area > 2)
    return {"golf_fairway": a, "golf_fairway2": b, "golf_green": greens, "golf_tee": tees, "golf_bunker": bunkers}, golf


def flag_point(g):
    """Le trou : un peu décentré sur le green, côté est (comme le drapeau des photos)."""
    c0 = g.centroid
    p = Point(c0.x + 3.0, c0.y + 1.5)
    return p if g.buffer(-1.5).contains(p) else c0


def apply():
    spec = json.loads(DATA.read_text())
    layers, golf = layout(spec)
    world = json.loads((OUT / "world.json").read_text())
    manifest = {t["id"]: t for t in world["tiles"]}
    flags = [flag_point(poly_of(r)) for r in spec["greens"]]
    touched = []
    for t in world["tiles"]:
        tb = box(*t["bounds"])
        p = OUT / "tiles" / f"{t['id']}.json"
        d = json.loads(p.read_text())
        had = any(k in d["ground"] for k in LAYERS) or any(f["kind"] == "golf_flag" for f in d["furniture"])
        if not tb.intersects(golf) and not had:
            continue
        for k in LAYERS:
            d["ground"].pop(k, None)
        for k, ps in layers.items():
            clipped = [encode(q) for g in ps for q in polys(g.intersection(tb)) if q.area > 0.5]
            if clipped:
                d["ground"][k] = clipped
        d["furniture"] = [f for f in d["furniture"] if f["kind"] != "golf_flag"]
        for i, f in enumerate(flags):
            if tb.contains(f):
                d["furniture"].append({"kind": "golf_flag", "x": round(f.x, 2), "y": round(f.y, 2), "name": None, "id": FLAG_ID0 - i})
        text = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
        if text != p.read_text():
            p.write_text(text)
            manifest[t["id"]].update(furniture=len(d["furniture"]), bytes=len(text))
            touched.append(t["id"])
    (OUT / "world.json").write_text(json.dumps(world, indent=1))
    from build_dead_ends import apply_map

    kms = apply_map(touched)
    n = {k: len(v) for k, v in layers.items()}
    area = {k: round(sum(g.area for g in v)) for k, v in layers.items()}
    print(f"golf : tuiles {touched} ; polygones {n} ; aires (m²) {area} ; drapeaux {len(flags)} ; carte {kms}")


if __name__ == "__main__":
    trace() if "--trace" in sys.argv else apply()
