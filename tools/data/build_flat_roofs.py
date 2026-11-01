"""Toits-terrasses des barres voisines de l'Hexagone (D170, lot 6 de docs/plans/hexagone.md).

Usage : python3 tools/data/build_flat_roofs.py      (après build_roofs.py, build_shop_fronts.py ; avant build_nav.py)
Entrées : `flatRoofs` de tools/data/manual.json (niveau du toit, redan éventuel, édicules, mesurés au MNS LiDAR par survey_roofs.py), tiles/<tuile>.json,
          lod/<tuile>.json.
Sortie : pour chaque bâtiment listé, le toit à croupes est remplacé par un toit plat (`roofKind` « flat », une face par niveau, murs montés à leur niveau) ;
  - un redan (`split` : droite et point du niveau bas) coupe l'emprise en deux faces, ajoute un mur de raccord (`steps`) et deux sommets à l'emprise
    (le second à 2 cm du premier, pour qu'aucun côté ne soit de longueur nulle) ;
  - les édicules (`rooftop` : x, y, côtés, bas, haut, angle) sont posés sur le toit ; la fiche passe en matériau « terrasse » ; la silhouette lointaine
    (lod/<tuile>.json) prend le niveau du toit.
Non idempotent par construction du redan : un bâtiment qui porte déjà `rooftop` est laissé tel quel ; `bytes` de world.json est mis à jour.
"""

import json
import math
import zlib

from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import split

import config as c


def coords(ring):
    return [round(v, 2) for xy in ring.coords for v in xy]


def face(top, poly):
    """Face plate au niveau `top` (même format que `face_record` de build_roofs.py, qu'on n'importe pas : il demande scipy)."""
    poly = orient(poly, 1.0)
    return {"p": [0.0, 0.0, round(top, 3)], "r": coords(poly.exterior), "h": [coords(r) for r in poly.interiors]}


def convert(b, spec):
    ring = [(b["ring"][i], b["ring"][i + 1]) for i in range(0, len(b["ring"]), 2)]
    P = Polygon(ring).buffer(0)
    top = spec["top"]
    steps, faces = [], []
    if "split" not in spec:
        new_ring, tops = ring, [top] * len(ring)
        faces = [face(top, P)]
    else:
        sp = spec["split"]
        p, d, lo_pt, lo = sp["p"], sp["d"], sp["lo"], sp["loTop"]
        line = LineString([(p[0] - 200 * d[0], p[1] - 200 * d[1]), (p[0] + 200 * d[0], p[1] + 200 * d[1])])
        parts = list(split(P, line).geoms)
        if len(parts) != 2:
            raise SystemExit(f"{b['id']} : le redan ne coupe pas l'emprise en deux")
        low = next(g for g in parts if g.contains(Point(lo_pt)))
        high = next(g for g in parts if g is not low)
        faces = [face(top, high), face(lo, low)]
        cuts = [(pt.x, pt.y) for pt in P.exterior.intersection(line).geoms]
        if len(cuts) != 2:
            raise SystemExit(f"{b['id']} : le redan coupe l'emprise en {len(cuts)} points")
        in_low = lambda q: low.buffer(1e-6).contains(Point(q))
        new_ring, tops = [], []
        for i, v in enumerate(ring):
            w = ring[(i + 1) % len(ring)]
            new_ring.append(v)
            tops.append(lo if in_low(v) else top)
            for cx, cy in cuts:
                if LineString([v, w]).distance(Point(cx, cy)) < 1e-6 and Point(v).distance(Point(cx, cy)) > 1e-6 and Point(w).distance(Point(cx, cy)) > 1e-6:
                    ln = math.dist(v, w)
                    new_ring.append((cx, cy))
                    tops.append(lo if in_low(v) else top)
                    new_ring.append((cx + (w[0] - v[0]) / ln * 0.02, cy + (w[1] - v[1]) / ln * 0.02))
                    tops.append(lo if in_low(w) else top)
        steps = [[round(cuts[0][0], 2), round(cuts[0][1], 2), lo, top, round(cuts[1][0], 2), round(cuts[1][1], 2), lo, top]]
    b["ring"] = [round(v, 2) for q in new_ring for v in q]
    b["top"] = [round(t, 2) for t in tops]
    b["holes"], b["holeTop"] = [], []
    b["faces"], b["steps"], b["chim"] = faces, steps, []
    b["roofKind"], b["eave"], b["ridge"] = "flat", round(top, 2), round(top, 2)
    b["rooftop"] = spec["rooftop"]


def main():
    specs = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text()).get("flatRoofs", [])
    world = json.loads((c.OUT / "world.json").read_text())
    changed = set()
    for spec in specs:
        tid = spec["tile"]
        path = c.OUT / "tiles" / f"{tid}.json"
        text = path.read_text()
        tile = json.loads(text)
        b = next(x for x in tile["buildings"] if x["id"] == spec["id"])
        if "rooftop" in b:
            continue
        before = b["roofKind"]
        convert(b, spec)
        for f in tile["fiches"]:
            if f["id"] == b["id"]:
                f["materials"]["roof"] = "terrasse"
        new = json.dumps(tile, separators=(",", ":"), ensure_ascii=False)
        path.write_text(new)
        for m in world["tiles"]:
            if m["id"] == tid:
                m["bytes"] = len(new.encode())
        lp = c.OUT / "lod" / f"{tid}.json"
        lod = json.loads(lp.read_text())
        key = zlib.crc32(b["id"].encode())
        for e in lod:
            if e["k"] == key:
                e["e"] = e["g"] = round(spec["top"], 1)
                e["m"] = "terrasse"
        lp.write_text(json.dumps(lod, separators=(",", ":")))
        changed.add(tid)
        print(f"  {b['id'][-6:]} : {before} -> flat à {spec['top']:+.2f}" + (f" (niveau bas {spec['split']['loTop']:+.2f})" if "split" in spec else "") + f", {len(spec['rooftop'])} édicule(s)")
    if changed:
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"tuiles réécrites : {sorted(changed) or 'aucune'}")


if __name__ == "__main__":
    main()
