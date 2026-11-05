"""Parkings lus à l'orthophotographie : Hexagone (D169, lot 5 de docs/plans/hexagone.md), collège du Vallon (D177), gare (D230), Eduen (D233) : les rangées de places lues à l'orthophotographie redressée (survey_parking.py).

Usage : python3 tools/data/build_parking.py      (après build_public_space.py, build_streetscape.py et build_plaza.py ; avant build_nav.py)
Entrées : `parkings` de tools/data/manual.json (même format que `streetscape.lots`, D154 : repère redressé, zone de nettoyage, rangées {premier trait,
          pas, nombre, tronçons de traits, ligne de fond} ; plus `tiles` et `clip`), tiles/<tuile>.json.
D177 (collège du Vallon) : plusieurs entrées peuvent se partager un parking dont les rangées n'ont pas toutes la même direction (la première porte la zone de
         nettoyage, les suivantes une zone vide) ; `arrows` : flèches de sens peintes [x, y, cap] ; `furniture` : mobilier ajouté [{kind, x, y, rot, id}].
D230 (gare) : `grounds` : bandes de sol posées dans leur classe (rectangle `u`, `v` du repère, ou polygone `poly`), retirées des autres sols, dans l'ordre ;
         `yellow` : polylignes (u, v) peintes en jaune (`marks_yellow` : zigzag des arrêts de bus).
D236 (McDonald's et bowling de la route de Chalon) : `blue` : polygones (u, v) peints en bleu (`marks_blue` : places PMR) ; un parking sans
         rangée (`rows` vide) ne fait que nettoyer sa zone et poser ses bandes de sol (dalle de béton du bowling, sans marquage).
Sortie : dans les tuiles listées, les anciennes marques de la zone (traits de D94 posés le long d'allées, flèches, passages piétons tombés sur les
         allées) sont remplacées par les traits des rangées, découpés aux bâtiments et au sol des couches `clip` (asphalte du parking), de sorte que
         `findStalls` (src/core/parking.ts) retrouve les places. Idempotent : toute marque de la zone est retirée avant la pose ; `bytes` de world.json
         est mis à jour.
"""

import json
import math

from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

import build_streetscape as BS
import config as c


def arrow(x, y, cap):
    """Flèche de sens peinte (D177) : fût de 0,3 m × 2,2 m et pointe triangulaire de 0,9 m, centrée en (x, y), pointant au cap (degrés depuis le nord)."""
    pts = [(-0.15, -1.55), (0.15, -1.55), (0.15, 0.6), (0.45, 0.6), (0, 1.55), (-0.45, 0.6), (-0.15, 0.6)]
    a = math.radians(cap)
    # (px, py) : py le long de la flèche (vers le cap), px à sa droite.
    return Polygon([(x + px * math.cos(a) + py * math.sin(a), y - px * math.sin(a) + py * math.cos(a)) for px, py in pts])


def strip_polygons(lot):
    """Bandes de sol d'un parking (D230) : [(classe, polygone)], dans l'ordre (une bande posée après une autre la recoupe). Une bande est un
    rectangle du repère (`u`, `v` : intervalles, `v` en liste d'intervalles possible) ou un polygone (`poly` : points (u, v))."""
    fr = lot["frame"]
    out = []
    for st in lot.get("grounds", []):
        if "poly" in st:
            out.append((st["class"], Polygon([BS.frame_point(fr, u, v) for u, v in st["poly"]]).buffer(0)))
            continue
        a0, a1 = st["u"]
        vs = st["v"] if isinstance(st["v"][0], list) else [st["v"]]
        for b0, b1 in vs:
            out.append((st["class"], Polygon([BS.frame_point(fr, a0, b0), BS.frame_point(fr, a1, b0), BS.frame_point(fr, a1, b1), BS.frame_point(fr, a0, b1)])))
    return out


def blue_marks(lot):
    """Marques bleues (D236 : fond des places PMR) : polygones (u, v) du repère."""
    fr = lot["frame"]
    return [Polygon([BS.frame_point(fr, u, v) for u, v in poly]).buffer(0) for poly in lot.get("blue", [])]


def yellow_marks(lot):
    """Marques jaunes (D230 : zigzag des arrêts de bus) : polylignes (u, v) du repère, en bandes de 12 cm."""
    fr = lot["frame"]
    return [LineString([BS.frame_point(fr, u, v) for u, v in line]).buffer(0.06, cap_style="flat", join_style="mitre") for line in lot.get("yellow", [])]


GROUND_LAYERS = ("road_asphalt", "plaza_asphalt", "plaza_paving", "plaza_sett", "plaza_gravel", "plaza_granite", "plaza_pavers", "plaza_concrete",
                 "plaza_brick", "plaza_slate", "plaza_filet", "walk", "lawn")


def lay_strips(ground, strips, window):
    """Pose les bandes dans leur classe et retire leur emprise des autres sols ; une bande déjà posée n'est pas remise. Rend le nombre posé."""
    n = 0
    for cls, g in strips:
        g = g.intersection(window)
        if g.is_empty or g.area < 0.3:
            continue
        for layer in GROUND_LAYERS:
            out, changed = [], False
            for p in ground.get(layer, []):
                q = BS.decode(p)
                if q.intersects(g) and q.intersection(g).area > 0.6 and not (layer == cls and q.equals_exact(g, 0.02)):
                    changed = True
                    out += [BS.encode(r) for r in BS.polys(q.difference(g)) if r.area > 0.3]
                else:
                    out.append(p)
            if changed:
                ground[layer] = out
        have = ground.setdefault(cls, [])
        for r in BS.polys(g):
            e = BS.encode(r)
            if r.area > 0.3 and e not in have:
                have.append(e)
                n += 1
    return n


def main():
    specs = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text()).get("parkings", [])
    world = json.loads((c.OUT / "world.json").read_text())
    changed = []
    for lot in specs:
        marks, zone, _ = BS.lot_geometry(lot)
        placed = unary_union(marks + [arrow(*a) for a in lot.get("arrows", [])])
        removed = added = 0
        for tid in lot["tiles"]:
            path = c.OUT / "tiles" / f"{tid}.json"
            text = path.read_text()
            tile = json.loads(text)
            window = box(*tile["bounds"])
            ground = tile["ground"]
            # Les bâtiments masqués (D230 : l'abri de parking de la gare, que BD TOPO figure en boîte) ne coupent pas les traits.
            kp = c.OUT / "kinds" / f"{tid}.json"
            hidden = {bid for bid, e in json.loads(kp.read_text())["buildings"].items() if e.get("k") == "hidden"} if kp.exists() else set()
            buildings = unary_union([Polygon([(b["ring"][i], b["ring"][i + 1]) for i in range(0, len(b["ring"]), 2)]).buffer(0)
                                     for b in tile["buildings"] if b["id"] not in hidden])
            # Bandes de sol (D230), posées avant les traits : allée pavée, gravier, quai de bus.
            laid = lay_strips(ground, strip_polygons(lot), window)
            surface = unary_union([BS.decode(p) for layer in lot["clip"] for p in ground.get(layer, [])]).buffer(0.1)
            geom = placed.difference(buildings.buffer(0.3)).intersection(surface).intersection(window)
            kept = []
            for p in ground.get("marks", []):
                if zone.contains(BS.decode(p).centroid):
                    removed += 1
                else:
                    kept.append(p)
            mine = [BS.encode(q) for q in BS.polys(geom) if q.area > 0.02]
            added += len(mine)
            ground["marks"] = kept + [q for q in mine if q not in kept]
            # Marques jaunes (D230) : toutes celles de la zone sont retirées puis reposées.
            if lot.get("yellow"):
                ygeom = unary_union(yellow_marks(lot)).intersection(window)
                ykept = [p for p in ground.get("marks_yellow", []) if not zone.contains(BS.decode(p).centroid)]
                ground["marks_yellow"] = ykept + [BS.encode(q) for q in BS.polys(ygeom) if q.area > 0.01]
            # Marques bleues (D236) : toutes celles de la zone sont retirées puis reposées.
            if lot.get("blue") or ground.get("marks_blue"):
                bgeom = unary_union(blue_marks(lot)).intersection(window) if lot.get("blue") else Polygon()
                bkept = [p for p in ground.get("marks_blue", []) if not zone.contains(BS.decode(p).centroid)]
                bnew = bkept + [BS.encode(q) for q in BS.polys(bgeom) if q.area > 0.01]
                if bnew:
                    ground["marks_blue"] = bnew
                else:
                    ground.pop("marks_blue", None)
            if laid:
                print(f"  {tid} : {laid} bande(s) de sol posée(s)")
            # Mobilier ajouté au parking (lampadaires) : retiré puis reposé, identifiants négatifs propres à ce lot.
            if lot.get("furniture"):
                ids = {f["id"] for f in lot["furniture"]}
                tile["furniture"] = [f for f in tile["furniture"] if f["id"] not in ids] + [{"name": None, **f} for f in lot["furniture"]]
            new = json.dumps(tile, separators=(",", ":"), ensure_ascii=False)
            if new != text:
                path.write_text(new)
                changed.append(tid)
                for m in world["tiles"]:
                    if m["id"] == tid:
                        m["bytes"] = len(new.encode())
        places = sum((r["n"] - 1) * len(r["v"]) for r in lot["rows"])
        print(f"  {lot['name'][:60]} : {places} places tracées, {removed} anciennes marques retirées, {added} polygones posés")
    if changed:
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"tuiles réécrites : {sorted(set(changed)) or 'aucune'}")


if __name__ == "__main__":
    main()
