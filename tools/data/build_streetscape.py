"""Rues du centre-ville redessinées sur les sols des tuiles (D153) : la chaussée de la place du Champ de Mars.

Usage : python3 tools/data/build_streetscape.py     (après build_public_space.py, qui réécrit les sols ; avant build_nav.py)
Entrées : `streetscape` de tools/data/manual.json, public/data/streets.json (axes et largeurs des voies, les mêmes que pour la navigation),
          tiles/<tuile>.json (bâtiments, mobilier, sols).
Sortie : dans les tuiles listées, pour chaque voie de `streetscape.roads` :
  - sa chaussée (`road_asphalt`) à la largeur de la voie, coupée aux bâtiments, et retirée des places (`plaza_*`) qu'elle traversait ;
  - les traits de places de stationnement posés le long de la voie (D94 la prenait pour une allée de parking) sont retirés ;
  - l'axe discontinu (voie à double sens d'au moins 5,4 m et de 20 m au moins) et les passages piétons du mobilier OpenStreetMap
    (`crossing` à moins de 3 m de l'axe), dans `marks`.
D154 : pour chaque parking de `streetscape.lots`, les traits de stationnement sont retirés de sa zone et remplacés par les rangées lues à
l'orthophotographie (premier trait, pas, nombre, tronçons de traits et ligne de fond, dans un repère tourné), et les bandes de sol (allée piétonne
centrale) retirent leur emprise des places pour la poser dans leur classe.
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


def frame_point(fr, u, v):
    """Point local du repère (u le long de `angle`, v vers sa droite : (sin a, −cos a))."""
    a = math.radians(fr["angle"])
    return (fr["o"][0] + u * math.cos(a) + v * math.sin(a), fr["o"][1] + u * math.sin(a) - v * math.cos(a))


def lot_geometry(lot):
    """(traits et lignes de fond, zone de nettoyage, [(classe, polygone)]) d'un parking."""
    fr = lot["frame"]
    marks = []
    for row in lot["rows"]:
        for k in range(row["n"]):
            u = row["u0"] + k * row["step"]
            for v0, v1 in row["v"]:
                # Les traits s'arrêtent à 7 cm de la ligne de fond : la fusion des polygones en ferait un peigne que `findStalls` ne reconnaît pas.
                if "base" in row:
                    v0 += 0.07 if abs(v0 - row["base"]) < 1e-6 else 0
                    v1 -= 0.07 if abs(v1 - row["base"]) < 1e-6 else 0
                marks.append(LineString([frame_point(fr, u, v0), frame_point(fr, u, v1)]).buffer(0.05, cap_style="flat"))
        if "base" in row:
            u1 = row["u0"] + (row["n"] - 1) * row["step"]
            marks.append(LineString([frame_point(fr, row["u0"], row["base"]), frame_point(fr, u1, row["base"])]).buffer(0.05, cap_style="flat"))
    u0, v0, u1, v1 = lot["zone"]
    zone = Polygon([frame_point(fr, u0, v0), frame_point(fr, u1, v0), frame_point(fr, u1, v1), frame_point(fr, u0, v1)])
    strips = []
    for st in lot.get("strips", []):
        (a0, a1), (b0, b1) = st["u"], st["v"]
        strips.append((st["class"], Polygon([frame_point(fr, a0, b0), frame_point(fr, a1, b0), frame_point(fr, a1, b1), frame_point(fr, a0, b1)])))
    return marks, zone, strips


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
    lot_marks, lot_zones, lot_strips = [], [], []
    for lot in spec.get("lots", []):
        m, z, st = lot_geometry(lot)
        lot_marks += m
        lot_zones.append(z)
        lot_strips += st
    lot_zone = unary_union(lot_zones) if lot_zones else Polygon()
    lot_mark_geom = unary_union(lot_marks).difference(buildings).difference(road) if lot_marks else Polygon()
    strip_geom = [(cls, g.difference(buildings).difference(road)) for cls, g in lot_strips]
    print(f"chaussée {road.area:.0f} m², {len(marks)} marques, parkings : {len(lot_marks)} traits, {len(lot_strips)} bande(s)")

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
        # Bandes de sol des parkings (allée piétonne) : retirées des places, posées dans leur classe.
        for cls, g in strip_geom:
            for layer in PLAZA_LAYERS:
                out, changed = [], False
                for p in ground.get(layer, []):
                    q = decode(p)
                    if layer != cls and q.intersects(g) and q.intersection(g).area > 0.5:
                        changed = True
                        out += [encode(r) for r in polys(q.difference(g)) if r.area > 0.6]
                    else:
                        out.append(p)
                if changed:
                    ground[layer] = out
            have = ground.setdefault(cls, [])
            for r in polys(g.intersection(window)):
                if r.area > 0.5 and encode(r) not in have:
                    have.append(encode(r))
                    stats["bande"] = stats.get("bande", 0) + 1
        # L'asphalte des places ne recouvre ni le dallage, ni le gravier, ni les trottoirs voisins (D94 en laissait des recouvrements de 0,1 à 12 m²) :
        # deux sols au même niveau se disputent l'écran et la tache change avec la triangulation.
        if lot_zone.is_empty is False:
            others = [decode(q) for layer in ("plaza_paving", "plaza_sett", "plaza_gravel", "walk") for q in ground.get(layer, [])]
            others = unary_union(others) if others else Polygon()
            out, changed = [], False
            for q in ground.get("plaza_asphalt", []):
                g = decode(q)
                if not others.is_empty and g.intersects(others) and g.intersection(others).area > 0.3:
                    changed = True
                    out += [encode(r) for r in polys(g.difference(others)) if r.area > 0.6]
                else:
                    out.append(q)
            if changed:
                ground["plaza_asphalt"] = out
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
            q = decode(p)
            # Dans la zone d'un parking, toute marque ancienne part : traits, mais aussi les « passages piétons » de D94 posés sur les allées.
            if lot_zone.contains(q.centroid) or (stall_trait(q) and q.intersects(keep)):
                stats["traits retirés"] += 1
                continue
            kept.append(p)
        # Nos propres marques sont retirées puis reposées dans le même ordre : une deuxième passe ne change rien.
        mine = [encode(q) for q in polys(mark_geom.intersection(window)) if q.area > 0.02]
        mine_lots = [encode(q) for q in polys(lot_mark_geom.intersection(window)) if q.area > 0.02]
        before = len(kept)
        kept = [p for p in kept if p not in mine and p not in mine_lots]
        stats["marques"] += len(mine)
        stats["traits de parking"] = stats.get("traits de parking", 0) + len(mine_lots)
        kept += mine + mine_lots
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
