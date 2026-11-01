"""Entrée du collège du Vallon (D174, lot 3 de docs/plans/college-vallon.md) : ouvre l'enceinte à la grille et élargit le pont d'accès.

Usage : python3 tools/data/build_school_gate.py      (après build_tiles.py, build_public_space.py et build_structures.py ; avant build_nav.py)
Entrée : `schoolGate` de tools/data/manual.json (tuile, mur d'enceinte OSM, extrémités A et B de la grille, hauteur de l'enceinte, tablier à élargir),
         tiles/<tuile>.json, structures/<tuile>.json.
Sortie : - le mur d'enceinte (un seul tracé de 498 m, qui coupait le bout du pont) est coupé en deux tracés, de part et d'autre de la grille [A, B] ;
           la hauteur de 3,5 m (mesurée 5,8 m au LiDAR : les arbres et les bâtiments voisins faussaient la mesure) est ramenée à `height` ;
         - le tablier d'accès passe à `deck.w` de large (6 m à l'orthophotographie, 4,5 m par défaut dans OpenStreetMap).
Idempotent : un mur déjà coupé (le second tracé existe) est laissé tel quel ; `bytes` de world.json est mis à jour.
"""

import json
import math

import config as c


def main():
    spec = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())["schoolGate"]
    tid = spec["tile"]
    path = c.OUT / "tiles" / f"{tid}.json"
    tile = json.loads(path.read_text())
    walls = tile["walls"]
    w = next(x for x in walls if x["id"] == spec["wall"])
    changed = False
    if not any(x["id"] == spec["second"] for x in walls):
        pts = [(w["pts"][i], w["pts"][i + 1]) for i in range(0, len(w["pts"]), 2)]
        A, B = spec["cut"]
        # Le tracé passe de l'extrémité sud-est à l'extrémité nord-ouest de la grille : tout ce qui précède le sommet `at` est gardé, puis A ; B, puis la suite.
        at = spec["at"]
        first = pts[:at] + [tuple(A)]
        second = [tuple(B)] + pts[at + 1:]
        flat = lambda p: [round(v, 2) for q in p for v in q]
        w["pts"] = flat(first)
        walls.append({**w, "id": spec["second"], "pts": flat(second)})
        changed = True
        print(f"  enceinte coupée à la grille : {len(first)} et {len(second)} sommets, grille de {math.dist(A, B):.1f} m")
    for x in walls:
        if x["id"] in (spec["wall"], spec["second"]) and x["height"] != spec["height"]:
            x["height"] = spec["height"]
            changed = True
    if changed:
        new = json.dumps(tile, separators=(",", ":"), ensure_ascii=False)
        path.write_text(new)
        world = json.loads((c.OUT / "world.json").read_text())
        for m in world["tiles"]:
            if m["id"] == tid:
                m["bytes"] = len(new.encode())
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    sp = c.OUT / "structures" / f"{tid}.json"
    st = json.loads(sp.read_text())
    near = spec["deck"]["near"]
    deck = min(st["decks"], key=lambda d: min(math.dist(near, d["p"][i:i + 2]) for i in range(0, len(d["p"]), 3)))
    if deck["w"] != spec["deck"]["w"]:
        print(f"  tablier d'accès : {deck['w']} m -> {spec['deck']['w']} m")
        deck["w"] = spec["deck"]["w"]
        sp.write_text(json.dumps(st, separators=(",", ":")))
        changed = True
    print("tuile réécrite" if changed else "rien à faire")


if __name__ == "__main__":
    main()
