"""Rues du centre-ville redessinées sur les sols des tuiles (D153) : la chaussée de la place du Champ de Mars.

Usage : python3 tools/data/build_streetscape.py     (après build_public_space.py, qui réécrit les sols ; avant build_nav.py)
Entrées : `streetscape` de tools/data/manual.json, public/data/streets.json (axes et largeurs des voies, les mêmes que pour la navigation),
          tiles/<tuile>.json (bâtiments, mobilier, sols).
Sortie : dans les tuiles listées, pour chaque voie de `streetscape.roads` :
  - sa chaussée (`road_asphalt`) à la largeur de la voie, coupée aux bâtiments, et retirée des places (`plaza_*`) qu'elle traversait ;
  - les traits de places de stationnement posés le long de la voie (D94 la prenait pour une allée de parking) sont retirés ;
  - l'axe discontinu (voie à double sens d'au moins 5,4 m et de 20 m au moins) et les passages piétons du mobilier OpenStreetMap
    (`crossing` à moins de 3 m de l'axe), dans `marks`.
Idempotent : une polygone déjà posé n'est jamais remis, une place déjà coupée n'est pas réécrite ; `bytes` de world.json est mis à jour.
"""

import json
import math

from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import substring, unary_union

import config as c

PLAZA_LAYERS = ("plaza_asphalt", "plaza_paving", "plaza_sett", "plaza_gravel")
STALL_MAX_WIDTH, STALL_MAX_LEN = 0.3, 5.3
CROSSING_BAR, CROSSING_GAP = (3.0, 0.5), 0.9


def decode(poly):
    ring = lambda r: [(r[i], r[i + 1]) for i in range(0, len(r), 2)]
    return Polygon(ring(poly[0]), [ring(h) for h in poly[1:]]).buffer(0)


def encode(p):
    rings = [[round(v, 2) for xy in list(p.exterior.coords)[:-1] for v in xy]]
    rings += [[round(v, 2) for xy in list(h.coords)[:-1] for v in xy] for h in p.interiors]
    return rings


def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [p for part in getattr(g, "geoms", []) for p in polys(part)]


def stall_trait(p):
    """Trait de place de stationnement, entier (4,8 m × 0,1 m) ou recoupé par le parking : rectangle étroit de moins de 5,3 m."""
    if p.area > 1.5:
        return False
    rect = p.minimum_rotated_rectangle
    pts = list(rect.exterior.coords)
    sides = sorted([math.dist(pts[0], pts[1]), math.dist(pts[1], pts[2])])
    return sides[0] < STALL_MAX_WIDTH and 0.8 < sides[1] < STALL_MAX_LEN


def road_marks(line, width, oneway, kind):
    """Axe discontinu de D94 (`markings`)."""
    out = []
    if line.length >= 20 and width >= 5.4 and oneway == 0 and kind != "service":
        d = 4.0
        while d + 2.0 < line.length - 4.0:
            seg = substring(line, d, d + 2.0)
            if seg.geom_type == "LineString" and seg.length > 1:
                out.append(seg.buffer(0.07, cap_style="flat"))
            d += 6.0
    return out


def crossing_bars(line, width, f):
    """Bandes d'un passage piétonné posées en travers de la voie au droit de `f` (comme `across` de build_public_space.py)."""
    d = line.project(Point(f["x"], f["y"]))
    q = line.interpolate(d)
    q2, q1 = line.interpolate(min(d + 1.0, line.length)), line.interpolate(max(d - 1.0, 0))
    tx, ty = q2.x - q1.x, q2.y - q1.y
    n = math.hypot(tx, ty)
    if n < 1e-6:
        return []
    tx, ty = tx / n, ty / n
    nx, ny = -ty, tx
    half = width / 2 - 0.3
    out, u = [], -half + 0.25
    while u < half:
        cx, cy = q.x + nx * u, q.y + ny * u
        out.append(Polygon([(cx - tx * 1.5 - nx * 0.25, cy - ty * 1.5 - ny * 0.25), (cx + tx * 1.5 - nx * 0.25, cy + ty * 1.5 - ny * 0.25),
                            (cx + tx * 1.5 + nx * 0.25, cy + ty * 1.5 + ny * 0.25), (cx - tx * 1.5 + nx * 0.25, cy - ty * 1.5 + ny * 0.25)]))
        u += CROSSING_GAP
    return out


def main():
    spec = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())["streetscape"]
    streets = {s["id"]: s for s in json.loads((c.OUT / "streets.json").read_text())}
    world = json.loads((c.OUT / "world.json").read_text())
    tiles = {tid: json.loads((c.OUT / "tiles" / f"{tid}.json").read_text()) for tid in spec["tiles"]}
    texts = {tid: (c.OUT / "tiles" / f"{tid}.json").read_text() for tid in tiles}
    buildings = unary_union([Polygon([(b["ring"][i], b["ring"][i + 1]) for i in range(0, len(b["ring"]), 2)]).buffer(0) for t in tiles.values() for b in t["buildings"]])

    lines = {}
    for sid in spec["roads"]:
        s = streets[sid]
        lines[sid] = (LineString(list(zip(s["pts"][0::2], s["pts"][1::2]))), s)
    road = unary_union([ln.buffer(s["width"] / 2, cap_style="flat", join_style="round") for ln, s in lines.values()])
    road = road.buffer(1.0, join_style="round").buffer(-1.0, join_style="round").difference(buildings)
    keep = road.buffer(0.5)  # les traits de stationnement qui touchent la chaussée
    marks = []
    for ln, s in lines.values():
        marks += road_marks(ln, s["width"], s["oneway"], s["kind"])
        for t in tiles.values():
            for f in t["furniture"]:
                if f["kind"] == "crossing" and ln.distance(Point(f["x"], f["y"])) < 3.0:
                    marks += crossing_bars(ln, s["width"], f)
    mark_geom = unary_union(marks).intersection(road.buffer(-0.1)) if marks else Polygon()
    print(f"chaussée {road.area:.0f} m², {len(marks)} marques")

    stats = {"chaussée": 0, "place coupée": 0, "traits retirés": 0, "marques": 0}
    for tid, tile in tiles.items():
        bx0, by0, bx1, by1 = tile["bounds"]
        window = box(bx0, by0, bx1, by1)
        ground = tile["ground"]
        # Places : la chaussée en est retirée ; une place que la chaussée ne touche pas n'est pas réécrite.
        for layer in PLAZA_LAYERS:
            out, changed = [], False
            for p in ground.get(layer, []):
                g = decode(p)
                if g.intersects(road) and g.intersection(road).area > 0.5:
                    changed = True
                    stats["place coupée"] += 1
                    out += [encode(q) for q in polys(g.difference(road)) if q.area > 0.6]
                else:
                    out.append(p)
            if changed:
                ground[layer] = out
        # Chaussée.
        add = [encode(p) for p in polys(road.intersection(window)) if p.area > 0.05]
        have = ground.setdefault("road_asphalt", [])
        for p in add:
            if p not in have:
                have.append(p)
                stats["chaussée"] += 1
        # Traits de stationnement le long de la voie.
        kept = []
        for p in ground.get("marks", []):
            if stall_trait(decode(p)) and decode(p).intersects(keep):
                stats["traits retirés"] += 1
                continue
            kept.append(p)
        for p in (encode(q) for q in polys(mark_geom.intersection(window)) if q.area > 0.02):
            if p not in kept:
                kept.append(p)
                stats["marques"] += 1
        if kept:
            ground["marks"] = kept
    print(stats)
    changed = []
    for tid, tile in tiles.items():
        new = json.dumps(tile, separators=(",", ":"), ensure_ascii=False)
        if new != texts[tid]:
            (c.OUT / "tiles" / f"{tid}.json").write_text(new)
            changed.append(tid)
            for m in world["tiles"]:
                if m["id"] == tid:
                    m["bytes"] = len(new.encode())
    if changed:
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"tuiles réécrites : {changed or 'aucune'}")


if __name__ == "__main__":
    main()
