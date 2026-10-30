"""Découpe le monde en tuiles de 250 m et écrit ce que le jeu charge.

Usage : python3 tools/data/build_tiles.py

Entrées (.cache/blocks/<bloc>/work) : buildings_clean.json, facades.json, trees.json, props.json, ground_vec.json.
Sorties : tuiles du bloc seulement (col, ligne = indices de la grille mondiale, cf. config.py), pour les tuiles de REGION qu'il contient ;
  .cache/blocks/<bloc>/work/tiles.json  liste des tuiles écrites et de leurs effectifs, que pack.py fusionne dans public/data/world.json
  public/data/tiles/<c>_<r>.json bâtiments complets, fiches façade, arbres, murs, mobilier d'une tuile (c vers l'est, r vers le nord)
  public/data/lod/<c>_<r>.json   silhouettes simplifiées des bâtiments d'une tuile, pour quand elle est loin (absent si la tuile n'a pas de bâtiment)
Le relief et les sols par tuile sont écrits ensuite par pack.py, qui crée ou complète world.json.
Un bâtiment, un arbre ou un mur appartient à la tuile de son centre (ou de son premier point).
"""

import json
from pathlib import Path
import shutil
import math
import zlib

from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.geometry.polygon import orient

import config as c
from roadside import settle as settle_roadside

WORK = c.CACHE / "work"
TILES = c.OUT / "tiles"
LODS = c.OUT / "lod"
# Les objets sans identifiant d'origine (lampadaires, haies, remparts) en reçoivent un négatif, unique d'un bloc à l'autre.
ID_BASE = (c.BLOCK_ID[1] * 10 + c.BLOCK_ID[0] + 1) * 1_000_000


def load(name):
    return json.loads((WORK / name).read_text())


def centroid(ring):
    xs, ys = ring[0::2], ring[1::2]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def lod_record(b, fiche):
    """Silhouette d'un bâtiment : contour simplifié à 0,6 m, hauteur d'égout et de toit, couleurs."""
    ring = Polygon([(b["ring"][i], b["ring"][i + 1]) for i in range(0, len(b["ring"]), 2)])
    if not ring.is_valid:
        ring = ring.buffer(0)
    if ring.is_empty or ring.geom_type != "Polygon":
        return None
    simple = orient(ring.simplify(0.6, preserve_topology=True), 1.0)
    pts = [round(v, 1) for xy in list(simple.exterior.coords)[:-1] for v in xy]
    if len(pts) < 6:
        return None
    wall = fiche["materials"]["wall"]["color"] if fiche else "#d4c4a4"
    roof = b.get("roofColor") or "#8a6a58"
    return {"r": pts, "e": round(b["eave"], 1), "g": round(b["ridge"], 1), "w": wall, "t": roof,
            "m": fiche["materials"]["roof"] if fiche else "tuile_plate",
            "a": fiche["era"] if fiche else "xix", "k": zlib.crc32(b["id"].encode()) & 0xFFFFFFFF}


def decode(poly):
    return Polygon(*[[(r[i], r[i + 1]) for i in range(0, len(r), 2)] for r in poly[:1]], [[(r[i], r[i + 1]) for i in range(0, len(r), 2)] for r in poly[1:]]).buffer(0)


def clip_layers(layers, bounds, holes=()):
    """Polygones de chaque couche, découpés à l'emprise de la tuile (moins les zones d'escalier, dessinées en relief)."""
    window = box(*bounds)
    for z in holes:
        window = window.difference(box(*z["bbox"]))
    out = {}
    for name, polys in layers.items():
        pieces = []
        for poly in polys:
            g = decode(poly)
            if not g.intersects(window):
                continue
            g = g.intersection(window)
            for p in ([g] if isinstance(g, Polygon) else list(getattr(g, "geoms", []))):
                if isinstance(p, Polygon) and p.area > 0.05:
                    enc = lambda r: [round(v, 2) for xy in list(r.coords)[:-1] for v in xy]
                    pieces.append([enc(p.exterior)] + [enc(r) for r in p.interiors])
        if pieces:
            out[name] = pieces
    return out


DRIVABLE = {"residential", "tertiary", "secondary", "unclassified", "service", "living_street", "primary"}


def roadside_signals(furniture):
    """Les feux d'OpenStreetMap sont des nœuds sur l'axe de la voie : on les pose de part et d'autre de la chaussée, sur le trottoir."""
    streets = json.loads((WORK / "streets.json").read_text())
    lines = [(LineString([(s["pts"][i], s["pts"][i + 1]) for i in range(0, len(s["pts"]), 2)]), s["width"]) for s in streets if s["kind"] in DRIVABLE]
    out = []
    for f in furniture:
        if f["kind"] != "traffic_signals":
            out.append(f)
            continue
        p = Point(f["x"], f["y"])
        best = min(lines, key=lambda l: l[0].distance(p), default=None)
        if best is None or best[0].distance(p) > 12:
            out.append(f)
            continue
        ln, w = best
        d = ln.project(p)
        q, q2 = ln.interpolate(d), ln.interpolate(min(d + 1.0, ln.length))
        q1 = ln.interpolate(max(d - 1.0, 0.0))
        tx, ty = q2.x - q1.x, q2.y - q1.y
        L = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / L, tx / L
        for side in (1, -1):
            off = w / 2 + 1.0
            out.append({**f, "x": round(q.x + nx * side * off, 2), "y": round(q.y + ny * side * off, 2), "id": f["id"] * 10 + (1 if side > 0 else 2),
                        "rot": round(math.atan2(-ny * side, -nx * side), 3)})
    return out


def main():
    manual = json.loads((Path(__file__).parent / "manual.json").read_text())
    buildings = load("buildings_clean.json")
    gv = load("ground_vec.json")
    fiches = {f["id"]: f for f in load("facades.json")}
    trees = load("trees.json")
    props = load("props.json")

    tiles = {}
    block = c.block_tiles(*c.BLOCK_ID)

    def tile(col, row):
        return tiles.setdefault((col, row), {"buildings": [], "fiches": [], "trees": [], "walls": [], "furniture": []})

    lod = {}
    for b in buildings:
        cx, cy = centroid(b["ring"])
        t = c.tile_of_local(cx, cy)
        if t is None:
            continue
        rec = tile(*t)
        rec["buildings"].append(b)
        if b["id"] in fiches:
            rec["fiches"].append(fiches[b["id"]])
        l = lod_record(b, fiches.get(b["id"]))
        if l:
            lod.setdefault(c.tile_id(*t), []).append(l)
    for tr in trees:
        t = c.tile_of_local(tr[0], tr[1])
        if t:
            tile(*t)["trees"].append(tr)
    for w in props["walls"]:
        t = c.tile_of_local(w["pts"][0], w["pts"][1])
        if t:
            tile(*t)["walls"].append(w)
    for f in props["furniture"]:
        t = c.tile_of_local(f["x"], f["y"])
        if t:
            tile(*t)["furniture"].append(f)

    for i, (x, y, rot) in enumerate(gv["lamps"]):
        t = c.tile_of_local(x, y)
        if t:
            tile(*t)["furniture"].append({"kind": "street_lamp", "x": x, "y": y, "name": None, "id": -(ID_BASE + i + 1), "rot": rot})

    for t_ in tiles.values():
        t_["furniture"] = roadside_signals(t_["furniture"])
        for w in t_["walls"]:
            if w["kind"] in manual["fenceHeights"] and w["measured"] < 0.8:
                w["height"] = manual["fenceHeights"][w["kind"]]  # les grilles fines échappent au LiDAR
    for kind, lines, height in (("hedge", gv["hedges"], 1.1), ("rampart", gv["ramparts"], 6.0)):
        for i, pts in enumerate(lines):
            t = c.tile_of_local(pts[0], pts[1])
            if t:
                tile(*t)["walls"].append({"id": -(ID_BASE + 100_000 * (1 if kind == "hedge" else 2) + i), "kind": kind, "height": height, "measured": height, "pts": pts})

    TILES.mkdir(parents=True, exist_ok=True)
    LODS.mkdir(parents=True, exist_ok=True)
    # Un bloc ne remplace que ses propres tuiles, et jamais celles de KEEP (contexte seulement, D105).
    block = c.write_tiles(*c.BLOCK_ID)
    for col, row in block:
        (TILES / f"{c.tile_id(col, row)}.json").unlink(missing_ok=True)
        (LODS / f"{c.tile_id(col, row)}.json").unlink(missing_ok=True)
    manifest = []
    total = 0
    for col, row in block:
        rec = tiles.get((col, row), {"buildings": [], "fiches": [], "trees": [], "walls": [], "furniture": []})
        bounds = [round(v, 1) for v in c.tile_bounds_local(col, row)]
        stairs = [z for z in manual["stairs"] if z["bbox"][0] < bounds[2] and z["bbox"][2] > bounds[0] and z["bbox"][1] < bounds[3] and z["bbox"][3] > bounds[1]]
        rec = {"bounds": bounds, "ground": clip_layers(gv["layers"], bounds, stairs), "stairs": stairs, **rec}
        settle_roadside(rec)  # feux et troncs hors de la chaussée, couronnes élaguées au-dessus
        text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        (TILES / f"{c.tile_id(col, row)}.json").write_text(text)
        total += len(text)
        silhouettes = lod.get(c.tile_id(col, row), [])
        if silhouettes:
            (LODS / f"{c.tile_id(col, row)}.json").write_text(json.dumps(silhouettes, separators=(",", ":")))
        manifest.append({"id": c.tile_id(col, row), "col": col, "row": row, "bounds": bounds,
                         "buildings": len(rec["buildings"]), "trees": len(rec["trees"]), "walls": len(rec["walls"]),
                         "furniture": len(rec["furniture"]), "lod": len(silhouettes), "bytes": len(text)})
    (WORK / "tiles.json").write_text(json.dumps(manifest))
    print(f"{len(manifest)} tuiles, {total / 1e6:.1f} Mo de JSON (plus gros : {max(m['bytes'] for m in manifest) / 1e3:.0f} ko), "
          f"silhouettes {sum(f.stat().st_size for f in LODS.glob('*.json')) / 1e3:.0f} ko, "
          f"{sum(m['buildings'] for m in manifest)} bâtiments, {sum(m['trees'] for m in manifest)} arbres")


if __name__ == "__main__":
    main()
