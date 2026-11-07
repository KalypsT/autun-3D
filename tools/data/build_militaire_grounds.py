"""Sols et parterres du Lycée militaire (D261, lot 4 de docs/plans/lycee-militaire.md) : place d'armes, allée du grand portail, cours,
parterres à la française, bordures de buis.

Usage : python3 tools/data/build_militaire_grounds.py     (après build_public_space.py, build_courts.py et build_militaire_gates.py ; avant build_nav.py)
Entrées : `militaireGrounds` de tools/data/manual.json, tiles/<tuile>.json (contours BD TOPO et leurs trous, sols, murs).
Sortie : - dans les sols des tuiles touchées, par classe : `path_gravel` (stabilisé clair : place d'armes, allée), `plaza_gravel` (gravier :
           cour d'honneur et cour sud-ouest, bande des parterres, intérieur des ovales), `lawn` (gazon des compartiments) ; chaque polygone est
           découpé à la tuile, les bâtiments en sont retirés (marge de 40 cm) ;
         - une haie de buis de `box.height` m autour de chaque ovale (murs `hedge`, identifiants à partir de `box.id`).
Les parterres sont décrits dans le repère de la façade nord-est (`frame` : origine sur le mur, `d` le long de la façade, `n` vers l'extérieur).
Idempotent : les polygones posés sont notés dans tools/data/militaire_grounds.json et retirés à la passe suivante, les haies aussi ; `bytes` et
`walls` de world.json sont mis à jour.
"""

import json
import math

from shapely.affinity import rotate, scale, translate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

import config as c


def rings_of(poly):
    out = [[round(v, 2) for p in list(poly.exterior.coords)[:-1] for v in p]]
    for h in poly.interiors:
        out.append([round(v, 2) for p in list(h.coords)[:-1] for v in p])
    return out


def parts(geom):
    if geom.is_empty:
        return []
    return [g for g in (geom.geoms if hasattr(geom, "geoms") else [geom]) if g.geom_type == "Polygon" and g.area > 0.5]


def main():
    spec = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())["militaireGrounds"]
    world = json.loads((c.OUT / "world.json").read_text())
    tiles = {m["id"]: json.loads((c.OUT / "tiles" / f"{m['id']}.json").read_text()) for m in world["tiles"] if m["id"] in spec["tiles"]}
    texts = {tid: json.dumps(t, separators=(",", ":"), ensure_ascii=False) for tid, t in tiles.items()}
    buildings, holes = [], []
    for t in tiles.values():
        for b in t["buildings"]:
            r = b["ring"]
            hs = [[(h[i], h[i + 1]) for i in range(0, len(h), 2)] for h in b["holes"]]
            p = Polygon([(r[i], r[i + 1]) for i in range(0, len(r), 2)], hs)
            if p.is_valid:
                buildings.append(p)
            if b["id"] == spec["main"]:
                holes += [Polygon([(h[i], h[i + 1]) for i in range(0, len(h), 2)]) for h in b["holes"]]
    built = unary_union(buildings).buffer(0.4)

    # Repère de la façade nord-est : X(u, v) = o + d·u + n·v.
    (ox, oy), (dx, dy) = spec["frame"]["o"], spec["frame"]["d"]
    nx, ny = dy, -dx
    if nx * spec["frame"]["out"][0] + ny * spec["frame"]["out"][1] < 0:
        nx, ny = -nx, -ny
    X = lambda u, v: (ox + dx * u + nx * v, oy + dy * u + ny * v)
    rect = lambda u0, u1, v0, v1: Polygon([X(u0, v0), X(u1, v0), X(u1, v1), X(u0, v1)])
    angle = math.degrees(math.atan2(dy, dx))

    def oval(u, v, a, b):
        e = scale(Point(0, 0).buffer(1, 16), a, b)
        cx, cy = X(u, v)
        return translate(rotate(e, angle, origin=(0, 0)), cx, cy)

    P = spec["parterres"]
    band = rect(P["u"][0], P["u"][1], P["v"][0], P["v"][1])
    comps = [rect(u0, u1, P["v"][0] + P["margin"], P["v"][1] - P["margin"]) for u0, u1 in P["compartments"]]
    ovals = [oval(u, P["ov"], a, b) for u, a, b in P["ovals"]]
    place = Polygon(spec["place"])
    alley = LineString(spec["alley"]["line"]).buffer(spec["alley"]["w"] / 2, cap_style=2)
    layers = {
        "path_gravel": [place.difference(band), alley],
        "plaza_gravel": [h.buffer(-0.4) for h in holes] + [band.difference(unary_union(comps))] + ovals,
        "lawn": [cm.difference(unary_union(ovals).buffer(0.3)) for cm in comps],
    }
    added = {}
    for m in world["tiles"]:
        tid = m["id"]
        if tid not in tiles:
            continue
        tb = box(*tiles[tid]["bounds"])
        for cls, geoms in layers.items():
            for g in geoms:
                for p in parts(g.difference(built).intersection(tb)):
                    added.setdefault(tid, {}).setdefault(cls, []).append(rings_of(p.simplify(0.1)))

    # Haies de buis autour des ovales (dans la tuile qui contient leur centre).
    hedges = {}
    for k, o in enumerate(ovals):
        ring = [round(v, 2) for q in list(o.exterior.coords) for v in q]
        cx, cy = o.centroid.x, o.centroid.y
        tid = next(m["id"] for m in world["tiles"] if m["id"] in tiles and box(*m["bounds"]).contains(Point(cx, cy)))
        hedges.setdefault(tid, []).append({"id": spec["box"]["id"] - k, "kind": "hedge", "height": spec["box"]["height"],
                                           "measured": spec["box"]["height"], "pts": ring})

    memo = c.ROOT / "tools" / "data" / "militaire_grounds.json"
    old = json.loads(memo.read_text()) if memo.exists() else {}
    for tid, t in tiles.items():
        ground = t["ground"]
        for cls in layers:
            prev = old.get(tid, {}).get(cls, [])
            ground[cls] = [g for g in ground.get(cls, []) if g not in prev and g not in added.get(tid, {}).get(cls, [])] + added.get(tid, {}).get(cls, [])
        ids = {spec["box"]["id"] - k for k in range(len(ovals))}
        t["walls"] = [w for w in t["walls"] if w["id"] not in ids] + hedges.get(tid, [])
    # Mémoire des polygones posés (pour les retirer à la passe suivante, même s'ils ont changé).
    laid = {tid: {cls: v for cls, v in d.items()} for tid, d in added.items()}
    changed = []
    for tid, t in tiles.items():
        new = json.dumps(t, separators=(",", ":"), ensure_ascii=False)
        if new != texts[tid]:
            (c.OUT / "tiles" / f"{tid}.json").write_text(new)
            changed.append(tid)
            for m in world["tiles"]:
                if m["id"] == tid:
                    m["bytes"] = len(new.encode())
                    m["walls"] = len(t["walls"])
    if changed:
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    memo.write_text(json.dumps(laid, separators=(",", ":")))
    for tid, d in sorted(added.items()):
        print(f"  {tid} : " + ", ".join(f"{cls} {len(v)}" for cls, v in sorted(d.items())))
    print(f"{len(changed)} tuile(s) réécrite(s)" if changed else "rien à faire")


if __name__ == "__main__":
    main()
