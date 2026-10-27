"""Découpe le relief et les cartes de sol en fichiers par tuile : plus rien de global à charger au démarrage.

Usage : python3 tools/data/pack.py [--src DOSSIER]
  --src : dossier des grilles globales (défaut .cache/work/global, écrit par build_terrain.py et build_streets.py).
          Pour convertir l'ancien format versionné : --src public/data (puis supprimer terrain.*, ground*.* et lod.json).

Entrées (dans --src) : terrain.bin + terrain.json (uint16 en cm, ligne 0 = nord, 1 m), ground_a.png + ground_b.png + ground.json
(poids de mélange à 1 m, même grille). Entrée complémentaire : public/data/world.json (liste des tuiles), écrit par build_tiles.py.
Sorties (public/data) :
  terrain/<id>.bin      relief fin d'une tuile : float32[4] = base, x0, y1, côté N, puis N × N uint16 (cm au-dessus de base, ligne 0 = nord)
  terrain/coarse.bin    relief de toute la zone à 8 m (même format que l'ancien terrain.bin, métadonnées dans world.json)
  ground/<id>_{a,b}.png sols fins d'une tuile : poids de mélange à 1 m, N × N pixels
  ground/s<i>_<j>_{a,b}.png sols grossiers d'une super-tuile de 4 × 4 tuiles : 4 m par pixel, 252 × 252 pixels
  world.json            complété de `lattice` (phase de la grille fine), `coarse` (relief grossier) et `super`
Les blocs fins débordent de la tuile d'un mètre ou deux : l'interpolation bilinéaire ne sort jamais de son fichier, sans couture.
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
SUPER = 4  # côté d'une super-tuile, en tuiles
SUPER_RES = 4.0
SUPER_N = 252  # 250 m × 4 / 4 m + 2 pixels de marge
COARSE_RES = 8.0
UNIT = 0.01


def frac(v):
    return v - math.floor(v)


def cut(arr, x0g, y1g, ox, oy, n, res=1.0):
    """Sous-grille n × n dont le coin nord-ouest est (ox, oy), prise dans la grille globale (coin nord-ouest x0g, y1g) ; bords prolongés."""
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


def coarse_terrain(out, zone, cm, meta):
    """Relief de toute la zone à 8 m : échantillons bilinéaires de la grille fine, aux centres des cellules."""
    x0g, y1g, base_g = meta["x0"], meta["y1"], meta["base"]
    zx0, zy0, zx1, zy1 = zone
    cols = int(math.ceil((zx1 - zx0) / COARSE_RES)) + 2
    rows = int(math.ceil((zy1 - zy0) / COARSE_RES)) + 2
    x0, y1 = zx0 - COARSE_RES, zy1 + COARSE_RES
    cx = x0 + (np.arange(cols) + 0.5) * COARSE_RES
    cy = y1 - (np.arange(rows) + 0.5) * COARSE_RES
    fc = (cx - x0g) / meta["res"] - 0.5
    fr = (y1g - cy) / meta["res"] - 0.5
    rr, cc = np.meshgrid(fr, fc, indexing="ij")
    z = ndimage.map_coordinates(cm.astype(np.float32), [rr, cc], order=1, mode="nearest")
    lo = int(np.floor(z.min()))
    data = np.round(z - lo).astype("<u2")
    (out / "terrain" / "coarse.bin").write_bytes(data.tobytes())
    return {"cols": cols, "rows": rows, "res": COARSE_RES, "x0": x0, "y0": y1 - rows * COARSE_RES, "y1": y1,
            "base": base_g + lo * UNIT, "unit": UNIT, "zmin": base_g + float(z.min()) * UNIT, "zmax": base_g + float(z.max()) * UNIT, "holes_filled": 0}, data.nbytes


def save_png(arr, path):
    Image.fromarray(arr).save(path, optimize=True)


def write_ground(out, tiles, zone, a, b, meta):
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
    cols = max(t["col"] for t in tiles) // SUPER + 1
    rows = max(t["row"] for t in tiles) // SUPER + 1
    supers = []
    for sj in range(rows):
        for si in range(cols):
            sx0, sy0 = zone[0] + si * SUPER * c.TILE, zone[1] + sj * SUPER * c.TILE
            ox, oy = sx0 - SUPER_RES, sy0 + SUPER * c.TILE + SUPER_RES
            cx = ox + (np.arange(SUPER_N) + 0.5) * SUPER_RES
            cy = oy - (np.arange(SUPER_N) + 0.5) * SUPER_RES
            rr, cc = np.meshgrid((y1g - cy) / meta["res"] - 0.5, (cx - x0g) / meta["res"] - 0.5, indexing="ij")
            for name, arr in (("a", smooth[0]), ("b", smooth[1])):
                img = np.stack([ndimage.map_coordinates(arr[..., k], [rr, cc], order=1, mode="nearest") for k in range(3)], axis=-1)
                p = out / "ground" / f"s{si}_{sj}_{name}.png"
                save_png(np.clip(np.round(img), 0, 255).astype(np.uint8), p)
                total += p.stat().st_size
            supers.append({"id": f"s{si}_{sj}", "x0": ox, "y1": oy})
    return supers, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(c.CACHE / "work" / "global"))
    src = Path(ap.parse_args().src)
    out = c.OUT
    world = json.loads((out / "world.json").read_text())
    tiles = world["tiles"]
    zone = world["zone"]

    meta = json.loads((src / "terrain.json").read_text())
    cm = np.frombuffer((src / "terrain.bin").read_bytes(), dtype="<u2").reshape(meta["rows"], meta["cols"])
    fx, fy, nbytes = write_terrain(out, tiles, cm, meta)
    coarse, cbytes = coarse_terrain(out, zone, cm, meta)

    gmeta = json.loads((src / "ground.json").read_text())
    assert (gmeta["cols"], gmeta["rows"], gmeta["x0"], gmeta["y1"]) == (meta["cols"], meta["rows"], meta["x0"], meta["y1"]), "relief et sols sur des grilles différentes"
    a = np.asarray(Image.open(src / "ground_a.png").convert("RGB"))
    b = np.asarray(Image.open(src / "ground_b.png").convert("RGB"))
    supers, gbytes = write_ground(out, tiles, zone, a, b, gmeta)

    world["lattice"] = [fx, fy]
    world["blockSize"] = N
    world["coarse"] = coarse
    world["super"] = {"tiles": SUPER, "res": SUPER_RES, "size": SUPER_N, "cells": supers}
    (out / "world.json").write_text(json.dumps(world, indent=1))
    print(f"relief : {len(tiles)} blocs {nbytes / 1e6:.1f} Mo + grossier {cbytes / 1e3:.0f} ko ; sols : {gbytes / 1e6:.1f} Mo ({len(supers)} super-tuiles)")


if __name__ == "__main__":
    main()
