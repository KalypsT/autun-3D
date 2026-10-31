"""Sols des cours du lycée Bonaparte (D152) : ce que l'enceinte laisse libre entre les bâtiments (cour d'honneur, cour nord, cour sud, parking sud) reçoit son
revêtement d'après l'orthophotographie, comme les places de la tuile.

Usage : python3 tools/data/build_courts.py     (après build_public_space.py, qui réécrit les sols des tuiles ; avant build_nav.py)
Entrées : `courts` de tools/data/manual.json (contour OpenStreetMap du lycée, way 80175797, et, pour chaque cour, un point et la classe de sol lus
          à l'orthophotographie), tiles/<tuile>.json (contours BD TOPO, sols).
Sortie : la classe de sol (`plaza_gravel`, `plaza_asphalt`…) de la tuile reçoit le polygone de chaque cour : l'enceinte moins les bâtiments (marge de
          40 cm), moins la grille, arrondie à 25 cm. Une deuxième passe ne change rien (les polygones déjà posés sont retirés puis reposés) ; `bytes` de
          la tuile est mis à jour dans world.json. Le sol vectoriel est tendu sur le relief par le client comme celui des places.
"""

import json

from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

import config as c


def rings_of(poly):
    """[anneau extérieur, trous…] en listes plates x, y (sans répéter le premier point)."""
    out = [[round(v, 2) for p in list(poly.exterior.coords)[:-1] for v in p]]
    for h in poly.interiors:
        out.append([round(v, 2) for p in list(h.coords)[:-1] for v in p])
    return out


def main():
    spec = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())["courts"]
    world = json.loads((c.OUT / "world.json").read_text())
    tid = spec["tile"]
    path = c.OUT / "tiles" / f"{tid}.json"
    text = path.read_text()
    tile = json.loads(text)
    x0, y0, x1, y1 = tile["bounds"]
    site = Polygon(spec["site"])
    buildings = []
    for m in world["tiles"]:
        if not m.get("buildings"):
            continue
        bx0, by0, bx1, by1 = m["bounds"]
        if bx1 < x0 - 5 or bx0 > x1 + 5 or by1 < y0 - 5 or by0 > y1 + 5:
            continue
        for b in json.loads((c.OUT / "tiles" / f"{m['id']}.json").read_text())["buildings"]:
            r = b["ring"]
            p = Polygon([(r[i], r[i + 1]) for i in range(0, len(r), 2)])
            if p.is_valid and p.intersects(site):
                buildings.append(p)
    free = site.difference(unary_union(buildings).buffer(0.4))
    if spec.get("grille"):
        free = free.difference(LineString(spec["grille"]).buffer(0.8))
    free = free.buffer(-0.25).buffer(0.25).intersection(box(x0, y0, x1, y1))
    parts = list(free.geoms) if free.geom_type == "MultiPolygon" else [free]
    added = {}
    for court in spec["courts"]:
        pt = Point(court["at"])
        hit = [q for q in parts if q.contains(pt)]
        if not hit:
            raise SystemExit(f"cour en {court['at']} : aucun espace libre")
        poly = hit[0].simplify(0.25)
        added.setdefault(court["class"], []).extend([rings_of(poly)])
        print(f"  cour en {court['at']} : {poly.area:.0f} m², classe {court['class']}")
    ground = tile["ground"]
    for cls, polys in added.items():
        keep = [g for g in ground.get(cls, []) if g not in polys]
        ground[cls] = keep + polys
    new = json.dumps(tile, separators=(",", ":"), ensure_ascii=False)
    if new == text:
        print("rien à réécrire")
        return
    path.write_text(new)
    for m in world["tiles"]:
        if m["id"] == tid:
            m["bytes"] = len(new.encode())
    (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"{tid} : {sum(len(v) for v in added.values())} cours posées")


if __name__ == "__main__":
    main()
