"""Sols en vecteurs : chaussées, trottoirs, places et parkings, marquages, passages piétons, lampadaires.

Usage : python3 tools/data/build_ground.py       (après build_streets.py et build_roofs.py)
Entrées : public/data/streets.json, .cache/work/{buildings_clean,props,ground}.npy|json, .cache/raw/osm.json
Sortie  : .cache/work/ground_vec.json   {layers: {nom: [polygone, ...]}, lamps: [[x, y], ...]}
Un polygone est une liste d'anneaux (extérieur puis trous) en coordonnées locales aplaties [x0, y0, x1, y1, …].
build_tiles.py découpe ces polygones par tuile ; le client les triangule et les pose sur le relief.
"""

import json
import math

import numpy as np
from scipy import ndimage
from shapely.affinity import translate
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import substring, unary_union
from shapely.prepared import prep

import build_streets as bs
import common
import config as c

WALK_W = 2.2  # largeur des trottoirs le long des chaussées
LAMP_STEP = 30.0
SURFACE = {"asphalt": "asphalt", "concrete": "paving", "sett": "sett", "paving_stones": "paving", "unhewn_cobblestone": "sett",
           "cobblestone": "sett", "compacted": "gravel", "gravel": "gravel", "fine_gravel": "gravel"}


def parts(geom):
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


def clean(geom, min_area=0.6):
    """Polygones valides, sans éclats."""
    out = []
    for p in parts(geom.buffer(0)):
        if p.area >= min_area:
            out.append(p)
    return out


def encode(p):
    def ring(r):
        return [round(v, 2) for xy in list(r.coords)[:-1] for v in xy]
    return [ring(p.exterior)] + [ring(r) for r in p.interiors]


def raster_polygons(mask, res):
    """Vectorise un masque booléen (origine : coin nord-ouest de la grille, pixel = res mètres) en polygones locaux.
    Rectangles par lignes fusionnés verticalement, puis union."""
    H, W = mask.shape
    x0 = c.GRID_X0 - c.ORIGIN[0]
    y1 = c.GRID_Y1 - c.ORIGIN[1]
    boxes = []
    open_runs = {}
    for r in range(H + 1):
        row = mask[r] if r < H else np.zeros(W, bool)
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
        cur = {(s, e) for s, e in zip(starts, ends)}
        for key in list(open_runs):
            if key not in cur:
                r0 = open_runs.pop(key)
                boxes.append((key[0], key[1], r0, r))
        for key in cur:
            open_runs.setdefault(key, r)
    polys = [box(x0 + s * res, y1 - e_row * res, x0 + e * res, y1 - r0 * res) for s, e, r0, e_row in boxes]
    return unary_union(polys) if polys else Polygon()


def main():
    import time
    t0 = time.time()
    streets = json.load(open(c.OUT / "streets.json"))
    osm = json.load(open(c.CACHE / "raw" / "osm.json"))["elements"]
    ways = [e for e in osm if e["type"] == "way" and "geometry" in e and "tags" in e]
    props = json.load(open(c.CACHE / "work" / "props.json"))
    b_raw = json.load(open(c.CACHE / "work" / "buildings_clean.json"))
    B = unary_union([Polygon([(b["ring"][i], b["ring"][i + 1]) for i in range(0, len(b["ring"]), 2)],
                             [[(h[i], h[i + 1]) for i in range(0, len(h), 2)] for h in b["holes"]]).buffer(0) for b in b_raw])
    Bp = prep(B)

    def line(s):
        return LineString(np.array(s["pts"]).reshape(-1, 2))

    # --- Chaussées ----------------------------------------------------------------------
    drivable = [s for s in streets if s["kind"] in bs.DRIVABLE and s["motor"] and not s["tunnel"]]
    by_surface = {"asphalt": [], "sett": [], "gravel": [], "paving": []}
    for s in drivable:
        cls = SURFACE.get(s["surface"] or "asphalt", "asphalt")
        by_surface[cls].append(line(s).buffer(s["width"] / 2, cap_style="flat", join_style="round"))
    roads = {}
    taken = Polygon()
    for cls in ("asphalt", "sett", "paving", "gravel"):
        if not by_surface[cls]:
            continue
        g = unary_union(by_surface[cls])
        g = g.buffer(1.0, join_style="round").buffer(-1.0, join_style="round")  # remplit les angles des carrefours
        g = g.difference(B).difference(taken)
        roads[cls] = g
        taken = taken.union(g)
    R = unary_union(list(roads.values()))

    # --- Places, rues piétonnes, parkings -------------------------------------------------
    ground = np.load(c.CACHE / "work" / "ground.npy")
    plazas = {"paving": [], "sett": [], "gravel": [], "asphalt": []}
    parkings = []
    for s in streets:
        if s["kind"] in ("pedestrian", "living_street") and not s["motor"]:
            cls = SURFACE.get(s["surface"] or "paving", "paving")
            plazas.setdefault(cls, []).append(line(s).buffer(max(s["width"], 3.0) / 2 + 1.0))
    for e in ways:
        t = e["tags"]
        if t.get("highway") == "pedestrian" and t.get("area") == "yes" and len(e["geometry"]) >= 4:
            plazas[SURFACE.get(t.get("surface"), "paving")].append(Polygon(bs.way_line(e)).buffer(0))
        if t.get("amenity") == "parking" and len(e["geometry"]) >= 4:
            poly = Polygon(bs.way_line(e)).buffer(0)
            parkings.append(poly)
            plazas["gravel" if t.get("surface") in ("gravel", "compacted", "fine_gravel") else "asphalt"].append(poly)
    # Le reste du sol minéral de la carte : places, cours, parkings non cartographiés.
    k = 4  # blocs de 4 x 4 pixels de 0,5 m : cellules de 2 m, assez fines pour des places, assez grosses pour rester légères
    H4, W4 = ground.shape[0] // k, ground.shape[1] // k
    blocks = ground[: H4 * k, : W4 * k].reshape(H4, k, W4, k).transpose(0, 2, 1, 3).reshape(H4, W4, k * k)
    counts = np.stack([(blocks == cid).sum(axis=2) for cid in range(8)])
    major = counts.argmax(axis=0).astype(np.uint8)
    # L'asphalte hors chaussée vient surtout de l'ombre et des toits sombres : seuls les parkings d'OSM le dessinent.
    for name, cls_id in (("sett", 3), ("gravel", 4), ("paving", 0)):
        m = ndimage.binary_opening(ndimage.binary_closing(major == cls_id, iterations=1), iterations=1)
        lab, n = ndimage.label(m)
        if n:
            sizes = ndimage.sum(m, lab, range(1, n + 1))
            m = np.isin(lab, [i + 1 for i, sz in enumerate(sizes) if sz >= 20])  # au moins ~50 m²
        g = raster_polygons(m, c.RES * k).buffer(0.8).buffer(-0.8)
        plazas[name].append(g)
    print("places brutes", round(time.time() - t0), "s", flush=True)
    # Trottoirs d'abord (bande régulière le long des chaussées) : les places s'arrêtent à leur bord, pas l'inverse.
    PK = unary_union(parkings) if parkings else Polygon()
    W = R.buffer(WALK_W, join_style="round").difference(R).difference(B.buffer(0.2)).difference(PK.buffer(0.5))  # pas de trottoir dans un parking
    W = W.buffer(-0.35).buffer(0.35)  # retire les éclats trop étroits
    P = {}
    taken = unary_union([R, B, W])
    for name in ("sett", "gravel", "paving", "asphalt"):
        if not plazas[name]:
            continue
        g = unary_union(plazas[name]).difference(taken).buffer(-0.4).buffer(0.4)
        g = g.difference(taken)
        P[name] = g
        taken = taken.union(g)

    print("places", round(time.time() - t0), "s", flush=True)
    # --- Trottoirs : bande le long des chaussées, hors bâtiments et places ------------------
    layers = {}
    for cls, g in roads.items():
        layers[f"road_{cls}"] = clean(g.simplify(0.12))
    for cls, g in P.items():
        layers[f"plaza_{cls}"] = clean(g.buffer(2.0, join_style="round").buffer(-2.0, join_style="round").simplify(1.2), 40.0)
    layers["walk"] = clean(W.simplify(0.1))

    # --- Marquages ---------------------------------------------------------------------
    marks = []
    for s in drivable:
        if s["width"] < 5.4 or s["oneway"] != 0 or s["kind"] == "service":
            continue
        ln = line(s)
        if ln.length < 20:
            continue
        d = 4.0
        while d + 2.0 < ln.length - 4.0:
            seg = substring(ln, d, d + 2.0)
            if seg.geom_type == "LineString" and seg.length > 1:
                marks.append(seg.buffer(0.07, cap_style="flat"))
            d += 6.0
    Rp = prep(R)
    cross = [f for f in props["furniture"] if f["kind"] == "crossing"]
    n_cross = 0
    for f in cross:
        p = Point(f["x"], f["y"])
        best = None
        for s in drivable:
            ln = line(s)
            dist = ln.distance(p)
            if dist < 3.0 and (best is None or dist < best[0]):
                best = (dist, ln, s)
        if not best:
            continue
        _, ln, s = best
        d = ln.project(p)
        q = ln.interpolate(d)
        q2 = ln.interpolate(min(d + 1.0, ln.length))
        q1 = ln.interpolate(max(d - 1.0, 0))
        tx, ty = q2.x - q1.x, q2.y - q1.y
        L = math.hypot(tx, ty)
        if L < 1e-6:
            continue
        tx, ty = tx / L, ty / L
        nx, ny = -ty, tx
        half = s["width"] / 2 - 0.3
        u = -half + 0.25
        while u < half:
            cx, cy = q.x + nx * u, q.y + ny * u
            bar = Polygon([(cx - tx * 1.5 - nx * 0.25, cy - ty * 1.5 - ny * 0.25), (cx + tx * 1.5 - nx * 0.25, cy + ty * 1.5 - ny * 0.25),
                           (cx + tx * 1.5 + nx * 0.25, cy + ty * 1.5 + ny * 0.25), (cx - tx * 1.5 + nx * 0.25, cy - ty * 1.5 + ny * 0.25)])
            marks.append(bar)
            u += 0.9
        n_cross += 1
    mk = unary_union(marks).intersection(R.buffer(-0.1))
    # Places de stationnement : traits perpendiculaires aux allées intérieures des parkings.
    bays = []
    if not PK.is_empty:
        for s in drivable:
            ln = line(s)
            if ln.length < 8 or ln.intersection(PK).length < 0.6 * ln.length:
                continue
            d = 2.0
            while d < ln.length - 1.5:
                q = ln.interpolate(d)
                q2 = ln.interpolate(min(d + 0.5, ln.length))
                tx, ty = q2.x - q.x, q2.y - q.y
                L = math.hypot(tx, ty) or 1.0
                nx, ny = -ty / L, tx / L
                for side in (1, -1):
                    a = (q.x + nx * side * (s["width"] / 2 + 0.1), q.y + ny * side * (s["width"] / 2 + 0.1))
                    b = (a[0] + nx * side * 4.8, a[1] + ny * side * 4.8)
                    bays.append(LineString([a, b]).buffer(0.05, cap_style="flat"))
                d += 2.5
    if bays:
        mk = mk.union(unary_union(bays).intersection(PK).difference(R.buffer(0.05)).difference(B.buffer(0.3)))
    layers["marks"] = clean(mk, 0.05)

    # --- Lampadaires : le long des chaussées, sur les trottoirs ----------------------------
    lamps = []
    Wp = prep(W)
    for s in drivable:
        if s["kind"] in ("service",) or s["width"] < 3.0:
            continue
        ln = line(s)
        side = 1
        d = 12.0
        while d < ln.length - 6.0:
            q = ln.interpolate(d)
            q2 = ln.interpolate(min(d + 1.0, ln.length))
            tx, ty = q2.x - q.x, q2.y - q.y
            L = math.hypot(tx, ty) or 1.0
            nx, ny = -ty / L, tx / L
            for off_side in (side, -side):
                px, py = q.x + nx * off_side * (s["width"] / 2 + 0.7), q.y + ny * off_side * (s["width"] / 2 + 0.7)
                pt = Point(px, py)
                if Wp.contains(pt) and not Bp.intersects(pt.buffer(0.6)) and all(math.hypot(px - l[0], py - l[1]) > 12 for l in lamps[-40:]):
                    lamps.append((round(px, 2), round(py, 2), round(math.atan2(-ny * off_side, -nx * off_side), 3)))
                    break
            side = -side
            d += LAMP_STEP

    out = {"layers": {k: [encode(p) for p in v] for k, v in layers.items()}, "lamps": [list(p) for p in lamps]}
    (c.CACHE / "work" / "ground_vec.json").write_text(json.dumps(out, separators=(",", ":")))
    print({k: (len(v), round(sum(p.area for p in v))) for k, v in layers.items()}, f"{len(lamps)} lampadaires, {n_cross} passages piétons")


if __name__ == "__main__":
    main()
