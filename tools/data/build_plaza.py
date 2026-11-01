"""Parvis de l'Hexagone (D167, lot 3 de docs/plans/hexagone.md) : dallage géométrique et clôtures de parcelle.

Usage : python3 tools/data/build_plaza.py      (après build_public_space.py et build_streetscape.py, qui réécrivent les sols ; avant build_nav.py)
Entrées : `plazas` de tools/data/manual.json (formes lues sur l'orthophotographie IGN, tools/data/survey_plaza.py : fond clair, motifs d'ardoise,
          losange de brique), tiles/<tuile>.json, world.json.
Sortie : dans les tuiles listées, trois classes de sol : `plaza_filet` (fond clair et filets), `plaza_brick` (rose brique), `plaza_slate` (gris ardoise).
  - les motifs sont disjoints (l'ardoise l'emporte sur la brique, la brique sur le fond) : le fond est ce qui reste de l'emprise, les filets sont ses vides ;
  - l'emprise est retirée des sols qu'elle recouvrait (`clear` : chaussée, trottoirs, pelouses, places) : deux sols au même niveau se disputent l'écran ;
  - `fences` : plus de clôture de parcelle (D94) dans le disque donné (même mécanisme que D156, `remove_fences` de build_streetscape.py).
Idempotent : les polygones de ces trois classes sont toujours reposés tels quels ; `bytes` de world.json est mis à jour.
"""

import json

from shapely.geometry import Polygon, box
from shapely.ops import unary_union

import build_streetscape as BS
import config as c

NEW = ("plaza_filet", "plaza_brick", "plaza_slate")


def poly(flat):
    return Polygon([(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]).buffer(0)


def shapes(spec):
    base = poly(spec["base"])
    slate = unary_union([poly(p) for p in spec["slate"]])
    brick = unary_union([poly(p) for p in spec["brick"]]).difference(slate)
    base = base.union(slate).union(brick)
    filet = base.difference(slate).difference(brick)
    return base, {"plaza_filet": filet, "plaza_brick": brick, "plaza_slate": slate}


def main():
    specs = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text()).get("plazas", [])
    world = json.loads((c.OUT / "world.json").read_text())
    changed = []
    for spec in specs:
        base, classes = shapes(spec)
        for tid in spec["tiles"]:
            path = c.OUT / "tiles" / f"{tid}.json"
            text = path.read_text()
            tile = json.loads(text)
            window = box(*tile["bounds"])
            ground = tile["ground"]
            # Les sols recouverts : l'emprise en est retirée.
            for layer in spec["clear"] + list(NEW):
                out = []
                for p in ground.get(layer, []):
                    g = BS.decode(p)
                    if g.intersects(base) and g.intersection(base).area > 0.05:
                        out += [BS.encode(q) for q in BS.polys(g.difference(base)) if q.area > 0.3]
                    else:
                        out.append(p)
                if len(out) != len(ground.get(layer, [])) or out != ground.get(layer, []):
                    ground[layer] = out
            for cls, g in classes.items():
                have = ground.setdefault(cls, [])
                for q in BS.polys(g.intersection(window)):
                    if q.area > 0.08:
                        have.append(BS.encode(q))
            for layer in list(ground):
                if layer in spec["clear"] + list(NEW) and not ground[layer]:
                    del ground[layer]
            new = json.dumps(tile, separators=(",", ":"), ensure_ascii=False)
            if new != text:
                path.write_text(new)
                changed.append(tid)
                for m in world["tiles"]:
                    if m["id"] == tid:
                        m["bytes"] = len(new.encode())
        print(f"  {spec['name'][:60]} : fond {classes['plaza_filet'].area:.0f} m², brique {classes['plaza_brick'].area:.0f} m², ardoise {classes['plaza_slate'].area:.0f} m²")
    if changed:
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"tuiles réécrites : {sorted(set(changed)) or 'aucune'}")
    for spec in specs:
        if spec.get("fences"):
            world = json.loads((c.OUT / "world.json").read_text())
            n, metres, ch = BS.remove_fences(spec["fences"], world)
            if ch:
                (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
            print(f"clôtures de parcelle : {n} tronçons ({metres:.0f} m) retirés dans {ch or 'aucune tuile'}")


if __name__ == "__main__":
    main()
