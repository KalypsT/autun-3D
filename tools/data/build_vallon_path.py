"""Le plan d'eau du Vallon, lot 1 (D244, plan `docs/plans/vallon-lac.md`) : le chemin du tour du lac.

Deux temps :

1. `python3 tools/data/build_vallon_path.py --trace` : le tracé. L'axe OSM de la boucle (relevé du lot 0, `vallon_survey.json`) est recalé sur le
   milieu du chemin mesuré à l'orthophotographie : décalage lissé (médiane glissante de 5 stations), interpolé sous les arbres, borné à ± 4,5 m,
   appliqué tous les 2 m. Les allées du sud (Jacques de la Comble, Émile Château) viennent d'OSM telles quelles. Sortie : `vallon_path.json`
   (versionné : le tracé ne dépend plus ensuite d'OSM, qui change).
2. `python3 tools/data/build_vallon_path.py` : la pose, d'après `vallon_path.json` et `vallonPath` de `manual.json` :
   - sol : couche `path_gravel` (stabilisé clair) des tuiles touchées, entièrement réécrite (cette étape en est seule propriétaire) : chaque
     tronçon élargi à sa largeur, moins l'eau (marge 0,4 m) et les bâtiments, arrondi à 5 cm ;
   - arbres : un arbre à moins de largeur / 2 + 0,6 m de l'axe est poussé à largeur / 2 + 1,2 m, perpendiculairement ;
   - lampadaires : sur les tronçons de `lamps`, un tous les `step` m, côté terre, crosse vers le chemin ; identifiants −(871 000 000 + n), retirés
     puis reposés ;
   - roseaux (`reeds` des ouvrages de la tuile) : le long du bord du lac, là où le chemin passe à moins de 18 m, sauf près des pontons, de la cale,
     de la base et des pelouses de pêche (`noReeds`) ; par plages de 12 m, dont `share` sont gardées (tirage fixe) ;
   - grillages : les clôtures de `meshFences` (identifiant de la tuile) prennent l'aspect « grillage vert » et leur hauteur vue sur les photos ;
   - navigation : les arêtes piétonnes des tronçons OSM du tour prennent la largeur du chemin.
   Une deuxième passe ne change rien. `bytes` des tuiles réécrites est mis à jour dans world.json.

Ordre : après build_public_space.py et build_courts.py (qui réécrivent les sols des tuiles), après build_structures.py et build_water.py (ouvrages),
après build_nav.py (arêtes piétonnes) ; puis build_map.py --images.
"""

import glob
import json
import math
import os
import sys

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

import config as c

TRACE = c.ROOT / "tools" / "data" / "vallon_path.json"
SURVEY = c.ROOT / "tools" / "data" / "vallon_survey.json"
LAMP_ID = 871_000_000
REED_STEP = 0.8
REED_CHUNK = 12.0


def rings_of(poly):
    out = [[round(v, 2) for p in list(poly.exterior.coords)[:-1] for v in p]]
    for h in poly.interiors:
        out.append([round(v, 2) for p in list(h.coords)[:-1] for v in p])
    return out


def polys(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    return [g for g in getattr(geom, "geoms", []) if g.geom_type == "Polygon"]


def hash01(*v):
    h = 2166136261
    for ch in ",".join(str(x) for x in v).encode():
        h = ((h ^ ch) * 16777619) & 0xFFFFFFFF
    return h / 0xFFFFFFFF


# --- 1. Le tracé --------------------------------------------------------------------------------------------------------------------
def trace():
    import survey_vallon as sv

    spec = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())["vallonPath"]
    survey = json.loads(SURVEY.read_text())
    axis = LineString(survey["axis"]["points"])
    st = survey["stations"]
    s_all = np.array([s["s"] for s in st], dtype=float)
    seen = [(s["s"], s["off"]) for s in st if "off" in s]
    ss = np.array([a for a, _ in seen], dtype=float)
    oo = np.array([b for _, b in seen], dtype=float)
    smooth = np.array([np.median(oo[max(0, k - 2):k + 3]) for k in range(len(oo))])
    smooth = np.clip(smooth, -4.5, 4.5)
    off_at = np.interp(s_all, ss, smooth)

    def offset(s):
        return float(np.interp(s, s_all, off_at))

    def shifted(s0, s1):
        pts = []
        for s in list(np.arange(s0, s1, 2.0)) + [s1]:
            p = axis.interpolate(s)
            a, b = axis.interpolate(max(0.0, s - 1)), axis.interpolate(min(axis.length, s + 1))
            dx, dy = b.x - a.x, b.y - a.y
            n = math.hypot(dx, dy)
            o = offset(s)
            pts.append((p.x - dy / n * o, p.y + dx / n * o))
        line = LineString(pts).simplify(0.15)
        return [round(v, 2) for q in line.coords for v in q]

    out = []
    for sec in spec["sections"]:
        out.append({"name": sec["name"], "w": sec["w"], "p": shifted(sec["s"][0], min(sec["s"][1], axis.length))})
    nodes, ways = sv.osm()
    for extra in spec["osmWays"]:
        line = LineString([nodes[n] for n in ways[extra["osm"]]["nodes"]])
        out.append({"name": extra["name"], "w": extra["w"], "osm": extra["osm"], "p": [round(v, 2) for q in line.coords for v in q]})
    TRACE.write_text(json.dumps({"_": "Tracé du chemin du tour du lac (build_vallon_path.py --trace, D244) : axe recalé sur l'orthophotographie, "
                                      "largeur (m), points x, y.", "paths": out}, ensure_ascii=False, indent=1) + "\n")
    for p in out:
        print(f"  {p['name']} : {LineString(list(zip(p['p'][::2], p['p'][1::2]))).length:.0f} m, {p['w']} m de large")


# --- 2. La pose ---------------------------------------------------------------------------------------------------------------------
def lake_polygon():
    parts = []
    for f in sorted(glob.glob(str(c.OUT / "structures" / "*.json"))):
        for p in json.loads(open(f).read()).get("water", []):
            r = p[0]
            g = Polygon(list(zip(r[::2], r[1::2])), [list(zip(h[::2], h[1::2])) for h in p[1:]]).buffer(0)
            if not g.is_empty:
                parts.append(g)
    seed = Point(1245, 360)
    lake = [g for g in parts if g.distance(seed) < 400]
    u = unary_union(lake).buffer(0.05).buffer(-0.05)
    return max(polys(u), key=lambda g: g.area if g.contains(seed) else 0)


def lay():
    manual = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())
    spec = manual["vallonPath"]
    paths = json.loads(TRACE.read_text())["paths"]
    lines = [(p, LineString(list(zip(p["p"][::2], p["p"][1::2])))) for p in paths]
    world = json.loads((c.OUT / "world.json").read_text())
    lake = lake_polygon()
    band = unary_union([ln.buffer(p["w"] / 2, cap_style=2, join_style=1) for p, ln in lines])
    # Bouts arrondis là où un tronçon s'arrête sans rejoindre un autre (allées du sud).
    band = unary_union([band] + [Point(q).buffer(p["w"] / 2) for p, ln in lines for q in (ln.coords[0], ln.coords[-1])])
    area = band.bounds
    metas = [m for m in world["tiles"] if not (m["bounds"][2] < area[0] - 30 or m["bounds"][0] > area[2] + 30
                                               or m["bounds"][3] < area[1] - 30 or m["bounds"][1] > area[3] + 30)]
    tiles = {m["id"]: json.loads((c.OUT / "tiles" / f"{m['id']}.json").read_text()) for m in metas}
    texts = {tid: json.dumps(t, separators=(",", ":"), ensure_ascii=False) for tid, t in tiles.items()}
    buildings = []
    for t in tiles.values():
        for b in t["buildings"]:
            r = b["ring"]
            g = Polygon(list(zip(r[::2], r[1::2]))).buffer(0)
            if g.intersects(band):
                buildings.append(g)
    # Passerelles (tabliers piétons) : le chemin s'arrête à leurs culées, le tablier a son propre dessus.
    decks = []
    for tid in tiles:
        sp = c.OUT / "structures" / f"{tid}.json"
        if sp.exists():
            for d in json.loads(sp.read_text())["decks"]:
                q = d["p"]
                decks.append(LineString([(q[i], q[i + 1]) for i in range(0, len(q), 3)]).buffer(d["w"] / 2 + 0.1, cap_style=2))
    if decks:
        band = band.difference(unary_union(decks))
    band = band.difference(lake.buffer(0.4))
    if buildings:
        band = band.difference(unary_union(buildings).buffer(0.2))
    stats = {"m2": 0.0, "trees": 0, "lamps": 0, "reeds": 0.0, "nav": 0, "fences": 0}

    for tid, t in tiles.items():
        x0, y0, x1, y1 = t["bounds"]
        part = band.intersection(box(x0, y0, x1, y1))
        found = [g.simplify(0.05) for g in polys(part) if g.area > 0.5]
        if found:
            t["ground"]["path_gravel"] = [rings_of(g) for g in found]
            stats["m2"] += sum(g.area for g in found)
        else:
            t["ground"].pop("path_gravel", None)

        # Arbres poussés hors du chemin.
        for tr in t["trees"]:
            pt = Point(tr[0], tr[1])
            for p, ln in lines:
                lim = p["w"] / 2 + 0.6
                d = ln.distance(pt)
                if d < lim:
                    q = ln.interpolate(ln.project(pt))
                    dx, dy = pt.x - q.x, pt.y - q.y
                    if math.hypot(dx, dy) < 1e-3:
                        a, b = ln.interpolate(max(0, ln.project(pt) - 1)), ln.interpolate(ln.project(pt) + 1)
                        dx, dy = -(b.y - a.y), b.x - a.x
                        if lake.distance(Point(q.x + dx, q.y + dy)) < lake.distance(Point(q.x - dx, q.y - dy)):
                            dx, dy = -dx, -dy
                    n = math.hypot(dx, dy)
                    want = p["w"] / 2 + 1.2
                    tr[0], tr[1] = round(q.x + dx / n * want, 2), round(q.y + dy / n * want, 2)
                    pt = Point(tr[0], tr[1])
                    stats["trees"] += 1

        t["furniture"] = [f for f in t["furniture"] if not (-LAMP_ID - 999_999 <= f["id"] <= -LAMP_ID)]

        # Grillages verts (photos de la rive est) : aspect et hauteur.
        for w in t["walls"]:
            for mf in spec["meshFences"]:
                if w["id"] == mf["id"]:
                    w["look"] = "mesh"
                    w["height"] = mf["height"]
                    stats["fences"] += 1

    # Lampadaires.
    by_name = {p["name"]: ln for p, ln in lines}
    width = {p["name"]: p["w"] for p, _ in lines}
    k = 0
    for run in spec["lamps"]:
        ln = by_name[run["path"]]
        s0, s1 = run["s"]
        for s in np.arange(s0, min(s1, ln.length) + 1e-6, run["step"]):
            p = ln.interpolate(s)
            a, b = ln.interpolate(max(0, s - 1)), ln.interpolate(min(ln.length, s + 1))
            dx, dy = b.x - a.x, b.y - a.y
            n = math.hypot(dx, dy)
            nx, ny = -dy / n, dx / n
            if lake.distance(Point(p.x + nx * 3, p.y + ny * 3)) < lake.distance(Point(p.x - nx * 3, p.y - ny * 3)):
                nx, ny = -nx, -ny  # côté terre
            d = width[run["path"]] / 2 + run["off"]
            x, y = p.x + nx * d, p.y + ny * d
            tid = next((tid for tid, t in tiles.items() if t["bounds"][0] <= x < t["bounds"][2] and t["bounds"][1] <= y < t["bounds"][3]), None)
            if tid is None:
                continue
            k += 1
            tiles[tid]["furniture"].append({"kind": "street_lamp", "x": round(x, 2), "y": round(y, 2), "name": None, "id": -(LAMP_ID + k),
                                            "rot": round(math.atan2(-ny, -nx), 3)})
    stats["lamps"] = k

    # Roseaux le long du bord du lac.
    paths_union = unary_union([ln for _, ln in lines])
    holes = [Point(x, y).buffer(r) for x, y, r in spec["noReeds"]["circles"]] + [box(*b) for b in spec["noReeds"]["boxes"]]
    no = unary_union(holes)
    ring = lake.exterior
    runs, cur = [], []
    for s in np.arange(0, ring.length, REED_STEP):
        p = ring.interpolate(s)
        chunk = int(s // REED_CHUNK)
        keep = paths_union.distance(p) < spec["reedsNearPath"] and not no.contains(p) and hash01("reeds", chunk) < spec["share"]
        if keep:
            cur.append((round(p.x, 2), round(p.y, 2)))
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    reeds_by_tile = {}
    for r in runs:
        if len(r) < 3:
            continue
        for tid, t in tiles.items():
            x0, y0, x1, y1 = t["bounds"]
            seg = [q for q in r if x0 <= q[0] < x1 and y0 <= q[1] < y1]
            if len(seg) >= 3:
                reeds_by_tile.setdefault(tid, []).append({"p": [v for q in seg for v in q]})
                stats["reeds"] += LineString(seg).length
    changed_structures = []
    for tid in tiles:
        sp = c.OUT / "structures" / f"{tid}.json"
        if not sp.exists():
            if tid in reeds_by_tile:
                raise SystemExit(f"{tid} : roseaux sans fichier d'ouvrages")
            continue
        text = sp.read_text()
        st = json.loads(text)
        if tid in reeds_by_tile:
            st["reeds"] = reeds_by_tile[tid]
        else:
            st.pop("reeds", None)
        new = json.dumps(st, ensure_ascii=False, separators=(",", ":"))
        if new != text:
            sp.write_text(new)
            changed_structures.append(tid)

    # Tuiles réécrites.
    changed = []
    for tid, t in tiles.items():
        new = json.dumps(t, separators=(",", ":"), ensure_ascii=False)
        if new != texts[tid]:
            (c.OUT / "tiles" / f"{tid}.json").write_text(new)
            changed.append(tid)
            for m in world["tiles"]:
                if m["id"] == tid:
                    m["bytes"] = len(new.encode())
                    m["furniture"] = len(t["furniture"])
    if changed:
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))

    # Navigation : largeur des arêtes piétonnes du tour.
    refs = {}
    for sec in spec["sections"]:
        for ref in sec["osm"]:
            refs[ref] = sec["w"]
    for extra in spec["osmWays"]:
        refs[extra["osm"]] = extra["w"]
    for f in sorted(glob.glob(str(c.OUT / "nav" / "s*.json"))):
        text = open(f).read()
        nav = json.loads(text)
        e = nav["ped"]["e"]
        hits = 0
        for i in range(0, len(e), 11):
            if e[i + 2] == 5 and e[i + 8] in refs:
                w = round(refs[e[i + 8]] * 10)
                if e[i + 4] != w:
                    e[i + 4] = w
                    hits += 1
        if hits:
            open(f, "w").write(json.dumps(nav, separators=(",", ":"), ensure_ascii=False))
            stats["nav"] += hits

    print(f"chemin : {stats['m2']:.0f} m² dans {sum(1 for t in tiles.values() if 'path_gravel' in t['ground'])} tuiles ; {stats['trees']} arbres poussés ; "
          f"{stats['lamps']} lampadaires ; {stats['fences']} grillage(s) ; {stats['reeds']:.0f} m de roseaux ; {stats['nav']} arêtes piétonnes élargies")
    print(f"tuiles réécrites : {changed or 'aucune'} ; ouvrages : {changed_structures or 'aucun'}")


if __name__ == "__main__":
    if "--trace" in sys.argv:
        trace()
    else:
        lay()
