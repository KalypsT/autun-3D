"""Le plan d'eau du Vallon, lot 5 (D249, plan `docs/plans/vallon-lac.md`, §7 et §18) : la vie du lac.

Usage : python3 tools/data/build_vallon_life.py
D'après `vallonLife` de `manual.json`, le contour du lac (ouvrages publiés), le chemin du tour (vallon_path.json), les pontons et le relief :
- pêcheurs à la carpe, toujours là (`life` des ouvrages : `bivvy`, `rodpod`, `angler`) : chaque groupe est recalé sur le bord de l'eau,
  biwys à 5 m de l'eau, supports à cannes au bord, pêcheurs assis entre les deux ; le pêcheur du ponton est posé sur son tablier (`z`) ;
- boucles des voiliers (`sail` des ouvrages de la tuile qui contient leur centre) : ellipses de 32 points, vérifiées (fond, éloignement du bord,
  des îles et des pontons) ; l'étape s'arrête si une boucle sort de l'eau ;
- herbes hautes du sud (`tall` des ouvrages : polygones par tuile) : la zone `tallGrass`, entre l'eau et le chemin, moins le chemin et sa marge,
  les pelouses de pêche, les pontons et la base nautique.
Cette étape est seule propriétaire de `life`, `sail` et `tall` : une deuxième passe ne change rien.

Ordre : après build_vallon_piers.py, build_vallon_path.py et build_vallon_leisure.py.
"""

import glob
import json
import math

from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

import config as c
from survey_water import Relief

MANUAL = c.ROOT / "tools" / "data" / "manual.json"
TRACE = c.ROOT / "tools" / "data" / "vallon_path.json"
LAKE_Z = -25.41


def r2(v):
    return round(v, 2)


def polys(g):
    return [q for q in getattr(g, "geoms", [g]) if q.geom_type == "Polygon" and not q.is_empty]


def lake_polygon():
    parts = []
    for f in sorted(glob.glob(str(c.OUT / "structures" / "*.json"))):
        for p in json.loads(open(f).read()).get("water", []):
            g = Polygon(list(zip(p[0][::2], p[0][1::2])), [list(zip(h[::2], h[1::2])) for h in p[1:]]).buffer(0)
            if not g.is_empty:
                parts.append(g)
    seed = Point(1245, 360)
    u = unary_union([g for g in parts if g.distance(seed) < 400]).buffer(0.05).buffer(-0.05)
    return max(polys(u), key=lambda g: g.area if g.contains(seed) else 0)


def tile_of(world, x, y):
    for m in world["tiles"]:
        x0, y0, x1, y1 = m["bounds"]
        if x0 <= x < x1 and y0 <= y < y1:
            return m["id"]
    return None


def all_decks():
    out = {}
    for f in sorted(glob.glob(str(c.OUT / "structures" / "*.json"))):
        for d in json.loads(open(f).read()).get("decks", []):
            out[d["id"]] = d
    return list(out.values())


def main():
    spec = json.loads(MANUAL.read_text())["vallonLife"]
    world = json.loads((c.OUT / "world.json").read_text())
    relief = Relief()
    lake = lake_polygon()
    edge = lake.exterior
    decks = all_decks()
    piers = [d for d in decks if d.get("st") == "pier"]
    pier_lines = unary_union([LineString([(d["p"][i], d["p"][i + 1]) for i in range(0, len(d["p"]), 3)]).buffer(d["w"] / 2) for d in piers])
    paths = json.loads(TRACE.read_text())["paths"]
    path_band = unary_union([LineString(list(zip(p["p"][::2], p["p"][1::2]))).buffer(p["w"] / 2) for p in paths])

    # Pêcheurs.
    life, report = [], []
    for g in spec["anglers"]:
        if "deck" in g:
            d = next(q for q in piers if q.get("n") == g["deck"])
            pts = [(d["p"][i], d["p"][i + 1], d["p"][i + 2]) for i in range(0, len(d["p"]), 3)]
            line = LineString([(x, y) for x, y, _ in pts])
            q, q2 = line.interpolate(g["s"]), line.interpolate(g["s"] + 1)
            tx, ty = q2.x - q.x, q2.y - q.y
            n = math.hypot(tx, ty)
            # Côté large du ponton : celui qui s'éloigne de la rive.
            nx, ny = ty / n, -tx / n
            if lake.exterior.distance(Point(q.x + nx * 5, q.y + ny * 5)) < lake.exterior.distance(Point(q.x - nx * 5, q.y - ny * 5)):
                nx, ny = -nx, -ny
            z = pts[-1][2]
            a = math.atan2(ny, nx)
            # Assis au bord, jambes au-dessus de l'eau : le passage reste libre (0,9 m sur 1,5 m de large ; un promeneur en demande 0,7).
            off = d["w"] / 2 - 0.3
            ax_, ay_ = q.x + nx * off, q.y + ny * off
            life.append({"k": "angler", "x": r2(ax_), "y": r2(ay_), "a": r2(a), "z": r2(z), "n": g["name"]})
            life.append({"k": "rodpod", "x": r2(ax_ + nx * 0.55 + tx / n * 0.8), "y": r2(ay_ + ny * 0.55 + ty / n * 0.8), "a": r2(a), "z": r2(z), "n": g["name"]})
            report.append(f"  {g['name']} : sur le ponton, z {z:.2f}")
            continue
        ax, ay = g["at"]
        s0 = edge.project(Point(ax, ay))
        k = g["bivvies"]
        for i in range(k):
            s = s0 + (i - (k - 1) / 2) * g["spread"]
            p, p2 = edge.interpolate(s), edge.interpolate(s + 1)
            tx, ty = p2.x - p.x, p2.y - p.y
            n = math.hypot(tx, ty)
            nx, ny = -ty / n, tx / n
            if lake.contains(Point(p.x + nx, p.y + ny)):
                nx, ny = -nx, -ny  # vers la terre
            a = math.atan2(-ny, -nx)  # face à l'eau
            life.append({"k": "bivvy", "x": r2(p.x + nx * 5.0), "y": r2(p.y + ny * 5.0), "a": r2(a), "n": g["name"]})
            life.append({"k": "rodpod", "x": r2(p.x + nx * 1.4), "y": r2(p.y + ny * 1.4), "a": r2(a), "n": g["name"]})
            if i < g["anglers"]:
                life.append({"k": "angler", "x": r2(p.x + nx * 2.8 + tx / n * 0.9), "y": r2(p.y + ny * 2.8 + ty / n * 0.9), "a": r2(a), "n": g["name"]})
        report.append(f"  {g['name']} : {k} biwy(s), {g['anglers']} pêcheur(s)")
    for e in life:
        if "z" not in e and path_band.buffer(0.8).contains(Point(e["x"], e["y"])):
            raise SystemExit(f"{e['n']} : {e['k']} sur le chemin ({e['x']}, {e['y']})")

    # Voiliers.
    sail = []
    sp = spec["sail"]
    holes = unary_union([Polygon(h) for h in lake.interiors]) if lake.interiors else Polygon()
    for r in sp["routes"]:
        a = math.radians(r["a"])
        pts = []
        for i in range(32):
            t = 2 * math.pi * i / 32
            u, v = r["rx"] * math.cos(t), r["ry"] * math.sin(t)
            pts.append((r["c"][0] + u * math.cos(a) - v * math.sin(a), r["c"][1] + u * math.sin(a) + v * math.cos(a)))
        for x, y in pts:
            pt = Point(x, y)
            depth = LAKE_Z - relief.at(x, y)
            bad = (not lake.contains(pt) or lake.exterior.distance(pt) < sp["margin"] or holes.distance(pt) < sp["margin"]
                   or pier_lines.distance(pt) < sp["margin"] + 8 or depth < sp["minDepth"])
            if bad:
                raise SystemExit(f"{r['name']} : point ({x:.0f}, {y:.0f}) hors de l'eau navigable (fond {depth:.1f} m)")
        sail.append({"tile": tile_of(world, *r["c"]), "rec": {"p": [r2(v) for q in pts for v in q], "z": LAKE_Z, "n": r["name"]}})
        report.append(f"  voiliers, {r['name']} : {LineString(pts + pts[:1]).length:.0f} m")

    # Herbes hautes du sud.
    tg = spec["tallGrass"]
    area = Polygon(list(zip(tg["area"][::2], tg["area"][1::2]))).buffer(0)
    keep_out = unary_union([lake.buffer(0.5), path_band.buffer(tg["pathClear"]), pier_lines.buffer(3.0),
                            unary_union([Point(e["x"], e["y"]).buffer(9.0) for e in life])])
    tall = area.intersection(lake.buffer(12.0)).difference(keep_out)
    tall_area = sum(g.area for g in polys(tall))

    # Écriture.
    by_tile = {}
    for e in life:
        by_tile.setdefault(tile_of(world, e["x"], e["y"]), {}).setdefault("life", []).append(e)
    for s_ in sail:
        by_tile.setdefault(s_["tile"], {}).setdefault("sail", []).append(s_["rec"])
    for m in world["tiles"]:
        part = tall.intersection(box(*m["bounds"]))
        found = [g.simplify(0.1) for g in polys(part) if g.area > 2.0]
        if found:
            by_tile.setdefault(m["id"], {})["tall"] = [[[r2(v) for q in list(ring.coords)[:-1] for v in q] for ring in (g.exterior, *g.interiors)] for g in found]
    changed = []
    for m in world["tiles"]:
        tid = m["id"]
        sp_ = c.OUT / "structures" / f"{tid}.json"
        if not sp_.exists():
            if tid in by_tile:
                raise SystemExit(f"{tid} : vie du lac sans fichier d'ouvrages")
            continue
        text = sp_.read_text()
        if tid not in by_tile and not any(f'"{k}"' in text for k in ("life", "sail", "tall")):
            continue
        st = json.loads(text)
        for k in ("life", "sail", "tall"):
            if k in by_tile.get(tid, {}):
                st[k] = by_tile[tid][k]
            else:
                st.pop(k, None)
        new = json.dumps(st, ensure_ascii=False, separators=(",", ":"))
        if new != text:
            sp_.write_text(new)
            changed.append(tid)
    print("\n".join(report))
    print(f"{sum(1 for e in life if e['k'] == 'bivvy')} biwys, {sum(1 for e in life if e['k'] == 'angler')} pêcheurs ; herbes hautes : {tall_area:.0f} m²")
    print(f"ouvrages réécrits : {changed or 'aucun'}")


if __name__ == "__main__":
    main()
