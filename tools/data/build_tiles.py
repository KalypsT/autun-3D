"""Découpe le monde en tuiles de 250 m et écrit ce que le jeu charge.

Usage : python3 tools/data/build_tiles.py

Entrées (.cache/work) : buildings.json, facades.json, trees.json, props.json.
Sorties (public/data) :
  world.json         origine, grille de tuiles, effectifs
  tiles/<c>_<r>.json bâtiments complets, fiches façade, arbres, murs, mobilier d'une tuile (c vers l'est, r vers le nord)
  lod.json           silhouettes simplifiées de tous les bâtiments, pour les tuiles lointaines
Un bâtiment, un arbre ou un mur appartient à la tuile de son centre (ou de son premier point).
"""

import json
import shutil
import zlib

from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

import config as c

WORK = c.CACHE / "work"
TILES = c.OUT / "tiles"


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


def main():
    buildings = load("buildings_clean.json")
    fiches = {f["id"]: f for f in load("facades.json")}
    trees = load("trees.json")
    props = load("props.json")

    tiles = {}

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

    shutil.rmtree(TILES, ignore_errors=True)
    TILES.mkdir(parents=True)
    manifest = []
    total = 0
    for row in range(c.TILES_NY):
        for col in range(c.TILES_NX):
            rec = tiles.get((col, row), {"buildings": [], "fiches": [], "trees": [], "walls": [], "furniture": []})
            text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
            (TILES / f"{c.tile_id(col, row)}.json").write_text(text)
            total += len(text)
            manifest.append({"id": c.tile_id(col, row), "col": col, "row": row, "bounds": [round(v, 1) for v in c.tile_bounds_local(col, row)],
                             "buildings": len(rec["buildings"]), "trees": len(rec["trees"]), "walls": len(rec["walls"]),
                             "furniture": len(rec["furniture"]), "bytes": len(text)})
    (c.OUT / "lod.json").write_text(json.dumps(lod, separators=(",", ":")))
    world = {
        "origin": list(c.ORIGIN), "originZ": c.ORIGIN_Z, "tileSize": c.TILE, "cols": c.TILES_NX, "rows": c.TILES_NY,
        "zone": [round(v, 1) for v in (c.ZONE[0] - c.ORIGIN[0], c.ZONE[1] - c.ORIGIN[1], c.ZONE[2] - c.ORIGIN[0], c.ZONE[3] - c.ORIGIN[1])],
        "tiles": manifest,
    }
    (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"{len(manifest)} tuiles, {total / 1e6:.1f} Mo de JSON (plus gros : {max(m['bytes'] for m in manifest) / 1e3:.0f} ko), "
          f"lod.json {(c.OUT / 'lod.json').stat().st_size / 1e3:.0f} ko, "
          f"{sum(m['buildings'] for m in manifest)} bâtiments, {sum(m['trees'] for m in manifest)} arbres")


if __name__ == "__main__":
    main()
