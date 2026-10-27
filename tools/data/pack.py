"""Découpe le relief et les cartes de sol du bloc en fichiers par tuile, et fusionne le bloc dans public/data/world.json.

Usage : AUTUN_BLOCK=3,4 python3 tools/data/pack.py [--src DOSSIER]
  --src : dossier des grilles globales du bloc (défaut .cache/blocks/<bloc>/work/global, écrit par build_terrain.py et build_streets.py).

Entrées : grilles du bloc, terrain.bin + terrain.json (uint16 en cm, ligne 0 = nord, 1 m), ground_a.png + ground_b.png + ground.json
(poids de mélange à 1 m, même grille) ; liste des tuiles du bloc .cache/blocks/<bloc>/work/tiles.json (écrite par build_tiles.py).
Sorties (public/data) :
  terrain/<id>.bin      relief fin d'une tuile : float32[4] = base, x0, y1, côté N, puis N × N uint16 (cm au-dessus de base, ligne 0 = nord)
  terrain/coarse.bin    relief de toute la zone fabriquée à 8 m, fusionné bloc après bloc (métadonnées dans world.json)
  ground/<id>_{a,b}.png sols fins d'une tuile : poids de mélange à 1 m, N × N pixels
  ground/s<i>_<j>_{a,b}.png sols grossiers d'une super-tuile de SUPER × SUPER tuiles : 4 m par pixel, 252 × 252 pixels
  world.json            plan du monde : tuiles de tous les blocs déjà fabriqués, `lattice`, `coarse`, `super`
Les blocs fins débordent de la tuile d'un mètre ou deux : l'interpolation bilinéaire ne sort jamais de son fichier, sans couture.
Les blocs, les super-tuiles et les cellules du relief grossier sont alignés sur la grille mondiale : chaque bloc écrit ses propres fichiers,
sans jamais toucher à ceux d'un autre.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

import config as c

N = 254  # côté (pixels de 1 m) d'un bloc fin : tuile de 250 m + marge
SUPER_RES = 4.0
SUPER_N = 252  # SUPER × 250 m / 4 m = 250 pixels, plus 2 de marge
COARSE_RES = 8.0
UNIT = 0.01


def frac(v):
    return v - math.floor(v)


def cut(arr, x0g, y1g, ox, oy, n, res=1.0):
    """Sous-grille n × n dont le coin nord-ouest est (ox, oy), prise dans la grille du bloc (coin nord-ouest x0g, y1g) ; bords prolongés."""
    col0 = round((ox - x0g) / res)
    row0 = round((y1g - oy) / res)
    rows = np.clip(np.arange(row0, row0 + n), 0, arr.shape[0] - 1)
    cols = np.clip(np.arange(col0, col0 + n), 0, arr.shape[1] - 1)
    return arr[np.ix_(rows, cols)]


def tile_origin(bounds, fx, fy):
    """Coin nord-ouest (ox, oy) du bloc fin d'une tuile, sur la grille fine de phase (fx, fy)."""
    bx0, _, _, by1 = bounds
    return fx + math.floor(bx0 - fx) - 1, fy + math.ceil(by1 - fy) + 1


def write_terrain(out, tiles, cm, meta):
    x0g, y1g, base_g = meta["x0"], meta["y1"], meta["base"]
    fx, fy = frac(x0g), frac(y1g)
    (out / "terrain").mkdir(parents=True, exist_ok=True)
    total = 0
    for t in tiles:
        ox, oy = tile_origin(t["bounds"], fx, fy)
        block = cut(cm, x0g, y1g, ox, oy, N).astype(np.int64)
        lo = int(block.min())
        data = (block - lo).astype("<u2")
        head = np.array([base_g + lo * UNIT, ox, oy, N], dtype="<f4")
        (out / "terrain" / f"{t['id']}.bin").write_bytes(head.tobytes() + data.tobytes())
        total += 16 + data.nbytes
    return fx, fy, total


def coarse_patch(tiles, cm, meta):
    """Altitudes (m) des cellules de 8 m du bloc, marge d'une cellule comprise : (u0, v0, tableau lignes du nord au sud).

    Cellule (u, v) : x de GRID_X + 8 u à GRID_X + 8 (u + 1), y de GRID_Y + 8 v ; échantillons bilinéaires de la grille fine à son centre.
    """
    x0g, y1g, base_g = meta["x0"], meta["y1"], meta["base"]
    tx0 = min(t["bounds"][0] for t in tiles)
    ty0 = min(t["bounds"][1] for t in tiles)
    tx1 = max(t["bounds"][2] for t in tiles)
    ty1 = max(t["bounds"][3] for t in tiles)
    u0, u1 = math.floor((tx0 - c.GRID_X) / COARSE_RES) - 1, math.ceil((tx1 - c.GRID_X) / COARSE_RES) + 1
    v0, v1 = math.floor((ty0 - c.GRID_Y) / COARSE_RES) - 1, math.ceil((ty1 - c.GRID_Y) / COARSE_RES) + 1
    cx = c.GRID_X + (np.arange(u0, u1) + 0.5) * COARSE_RES
    cy = c.GRID_Y + (np.arange(v1 - 1, v0 - 1, -1) + 0.5) * COARSE_RES  # du nord au sud
    rr, cc = np.meshgrid((y1g - cy) / meta["res"] - 0.5, (cx - x0g) / meta["res"] - 0.5, indexing="ij")
    z = ndimage.map_coordinates(cm.astype(np.float32), [rr, cc], order=1, mode="nearest")
    return u0, v0, base_g + z * UNIT


def merge_coarse(out, world, patch):
    """Place le patch dans le relief grossier déjà publié (s'il existe) ; renvoie les métadonnées et écrit coarse.bin."""
    u0, v0, z = patch
    rows, cols = z.shape
    boxes = [(u0, v0, u0 + cols, v0 + rows)]
    old = world.get("coarse")
    if old:
        ou0 = round((old["x0"] - c.GRID_X) / COARSE_RES)
        ov0 = round((old["y1"] - c.GRID_Y) / COARSE_RES) - old["rows"]
        boxes.append((ou0, ov0, ou0 + old["cols"], ov0 + old["rows"]))
    U0, V0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    U1, V1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    grid = np.full((V1 - V0, U1 - U0), np.nan, np.float32)  # ligne 0 = nord

    def paste(u, v, arr):
        h, w = arr.shape
        r0 = (V1 - V0) - (v - V0 + h)
        grid[r0:r0 + h, u - U0:u - U0 + w] = arr

    if old:
        raw = np.frombuffer((out / "terrain" / "coarse.bin").read_bytes(), dtype="<u2").reshape(old["rows"], old["cols"])
        paste(boxes[1][0], boxes[1][1], old["base"] + raw.astype(np.float32) * UNIT)
    paste(u0, v0, z)
    holes = np.isnan(grid)
    if holes.any():  # cellules d'un bloc non fabriqué : valeur du plus proche voisin connu (elles ne servent qu'aux bords)
        idx = ndimage.distance_transform_edt(holes, return_distances=False, return_indices=True)
        grid = grid[tuple(idx)]
    lo = math.floor(float(grid.min()))
    data = np.round((grid - lo) / UNIT).astype("<u2")
    (out / "terrain").mkdir(parents=True, exist_ok=True)
    (out / "terrain" / "coarse.bin").write_bytes(data.tobytes())
    y1 = c.GRID_Y + (V1) * COARSE_RES
    return {"cols": int(U1 - U0), "rows": int(V1 - V0), "res": COARSE_RES, "x0": c.GRID_X + U0 * COARSE_RES, "y0": c.GRID_Y + V0 * COARSE_RES, "y1": y1,
            "base": float(lo), "unit": UNIT, "zmin": float(grid.min()), "zmax": float(grid.max()), "holes_filled": 0}, data.nbytes


def save_png(arr, path):
    Image.fromarray(arr).save(path, optimize=True)


def write_ground(out, tiles, a, b, meta):
    x0g, y1g = meta["x0"], meta["y1"]
    fx, fy = frac(x0g), frac(y1g)
    (out / "ground").mkdir(parents=True, exist_ok=True)
    total = 0
    for t in tiles:
        ox, oy = tile_origin(t["bounds"], fx, fy)
        for name, arr in (("a", a), ("b", b)):
            p = out / "ground" / f"{t['id']}_{name}.png"
            save_png(cut(arr, x0g, y1g, ox, oy, N), p)
            total += p.stat().st_size
    # Super-tuiles : poids lissés sur 4 m, échantillonnés aux centres des pixels de 4 m.
    smooth = [ndimage.uniform_filter(x.astype(np.float32), size=(int(SUPER_RES), int(SUPER_RES), 1), mode="nearest") for x in (a, b)]
    supers = {}
    for t in tiles:
        supers.setdefault((t["col"] // c.SUPER, t["row"] // c.SUPER), []).append(t)
    cells = []
    for (si, sj), group in sorted(supers.items()):
        span = c.SUPER * c.TILE
        sx0, sy0 = c.GRID_X + si * span, c.GRID_Y + sj * span
        ox, oy = sx0 - SUPER_RES, sy0 + span + SUPER_RES
        cx = ox + (np.arange(SUPER_N) + 0.5) * SUPER_RES
        cy = oy - (np.arange(SUPER_N) + 0.5) * SUPER_RES
        rr, cc = np.meshgrid((y1g - cy) / 1.0 - 0.5, (cx - x0g) / 1.0 - 0.5, indexing="ij")
        for name, arr in (("a", smooth[0]), ("b", smooth[1])):
            img = np.stack([ndimage.map_coordinates(arr[..., k], [rr, cc], order=1, mode="nearest") for k in range(3)], axis=-1)
            p = out / "ground" / f"s{si}_{sj}_{name}.png"
            save_png(np.clip(np.round(img), 0, 255).astype(np.uint8), p)
            total += p.stat().st_size
        cells.append({"id": f"s{si}_{sj}", "x0": ox, "y1": oy})
    return cells, total


def new_world():
    return {
        "origin": list(c.ORIGIN), "originZ": c.ORIGIN_Z, "tileSize": c.TILE, "cols": c.GRID_NX, "rows": c.GRID_NY,
        "gridOrigin": [c.GRID_X, c.GRID_Y], "zone": [0, 0, 0, 0], "tiles": [],
        "lattice": [0, 0], "blockSize": N, "coarse": None,
        "super": {"tiles": c.SUPER, "res": SUPER_RES, "size": SUPER_N, "cells": []},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(c.GLOBAL))
    src = Path(ap.parse_args().src)
    out = c.OUT
    out.mkdir(parents=True, exist_ok=True)
    tiles = json.loads((c.CACHE / "work" / "tiles.json").read_text())

    meta = json.loads((src / "terrain.json").read_text())
    cm = np.frombuffer((src / "terrain.bin").read_bytes(), dtype="<u2").reshape(meta["rows"], meta["cols"])
    fx, fy, nbytes = write_terrain(out, tiles, cm, meta)

    gmeta = json.loads((src / "ground.json").read_text())
    assert (gmeta["cols"], gmeta["rows"], gmeta["x0"], gmeta["y1"]) == (meta["cols"], meta["rows"], meta["x0"], meta["y1"]), "relief et sols sur des grilles différentes"
    a = np.asarray(Image.open(src / "ground_a.png").convert("RGB"))
    b = np.asarray(Image.open(src / "ground_b.png").convert("RGB"))
    cells, gbytes = write_ground(out, tiles, a, b, gmeta)

    wpath = out / "world.json"
    world = json.loads(wpath.read_text()) if wpath.exists() else new_world()
    if world["tiles"]:
        assert [round(v, 6) for v in world["lattice"]] == [round(fx, 6), round(fy, 6)], "grille fine incompatible avec les blocs déjà fabriqués"
    mine = {t["id"] for t in tiles}
    world["tiles"] = sorted([t for t in world["tiles"] if t["id"] not in mine] + tiles, key=lambda t: (t["row"], t["col"]))
    world["lattice"] = [fx, fy]
    world["gridOrigin"] = [c.GRID_X, c.GRID_Y]
    world["cols"], world["rows"] = c.GRID_NX, c.GRID_NY
    world["zone"] = [min(t["bounds"][0] for t in world["tiles"]), min(t["bounds"][1] for t in world["tiles"]),
                     max(t["bounds"][2] for t in world["tiles"]), max(t["bounds"][3] for t in world["tiles"])]
    world["coarse"], cbytes = merge_coarse(out, world, coarse_patch(tiles, cm, meta))
    keep = [s for s in world["super"]["cells"] if s["id"] not in {s2["id"] for s2 in cells}]
    world["super"]["cells"] = sorted(keep + cells, key=lambda s: s["id"])
    wpath.write_text(json.dumps(world, indent=1))
    print(f"bloc {c.BLOCK_NAME} : relief {len(tiles)} blocs {nbytes / 1e6:.1f} Mo ; sols {gbytes / 1e6:.1f} Mo ({len(cells)} super-tuiles) ; "
          f"relief grossier {cbytes / 1e3:.0f} ko ; monde : {len(world['tiles'])} tuiles")


if __name__ == "__main__":
    main()
