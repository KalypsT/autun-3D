"""Parking de l'Hexagone (D169, lot 5 de docs/plans/hexagone.md) : les rangées de places lues à l'orthophotographie redressée (survey_parking.py).

Usage : python3 tools/data/build_parking.py      (après build_public_space.py, build_streetscape.py et build_plaza.py ; avant build_nav.py)
Entrées : `parkings` de tools/data/manual.json (même format que `streetscape.lots`, D154 : repère redressé, zone de nettoyage, rangées {premier trait,
          pas, nombre, tronçons de traits, ligne de fond} ; plus `tiles` et `clip`), tiles/<tuile>.json.
Sortie : dans les tuiles listées, les anciennes marques de la zone (traits de D94 posés le long d'allées, flèches, passages piétons tombés sur les
         allées) sont remplacées par les traits des rangées, découpés aux bâtiments et au sol des couches `clip` (asphalte du parking), de sorte que
         `findStalls` (src/core/parking.ts) retrouve les places. Idempotent : toute marque de la zone est retirée avant la pose ; `bytes` de world.json
         est mis à jour.
"""

import json

from shapely.geometry import Polygon, box
from shapely.ops import unary_union

import build_streetscape as BS
import config as c


def main():
    specs = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text()).get("parkings", [])
    world = json.loads((c.OUT / "world.json").read_text())
    changed = []
    for lot in specs:
        marks, zone, _ = BS.lot_geometry(lot)
        placed = unary_union(marks)
        removed = added = 0
        for tid in lot["tiles"]:
            path = c.OUT / "tiles" / f"{tid}.json"
            text = path.read_text()
            tile = json.loads(text)
            window = box(*tile["bounds"])
            ground = tile["ground"]
            buildings = unary_union([Polygon([(b["ring"][i], b["ring"][i + 1]) for i in range(0, len(b["ring"]), 2)]).buffer(0) for b in tile["buildings"]])
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
            ground["marks"] = kept + mine
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
