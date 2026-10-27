"""Relief : MNT LiDAR HD 0,5 m -> grille 1 m en centimètres (uint16) dans .cache/work/global/terrain.bin (pack.py la découpe par tuile).

Usage : python3 tools/data/build_terrain.py
Format : terrain.json (métadonnées) + terrain.bin (uint16 little-endian, ligne 0 = nord).
  z (m, relatif à ORIGIN_Z) = base + valeur / 100
  le nœud (col, row) est au centre du carré de 1 m : x = x0 + (col + 0.5) * res, y = y1 - (row + 0.5) * res
"""

import json

import numpy as np
from scipy import ndimage

import common
import config as c

mnt = common.raster("MNT")
holes = np.isnan(mnt)
if holes.any():
    idx = ndimage.distance_transform_edt(holes, return_distances=False, return_indices=True)
    mnt = mnt[tuple(idx)]

# Moyenne par blocs de 2 x 2 : 0,5 m -> 1 m.
h, w = mnt.shape
coarse = mnt.reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3))
base = float(np.floor(coarse.min()))
cm = np.round((coarse - base) * 100).astype("<u2")

c.GLOBAL.mkdir(parents=True, exist_ok=True)
(c.GLOBAL / "terrain.bin").write_bytes(cm.tobytes())
x0, y0 = c.to_local(c.GRID_X0, c.GRID_Y0)
meta = {
    "cols": int(w // 2), "rows": int(h // 2), "res": 1.0,
    "x0": x0, "y0": y0, "y1": y0 + h * c.RES,
    "base": base - c.ORIGIN_Z, "unit": 0.01,
    "zmin": float(coarse.min() - c.ORIGIN_Z), "zmax": float(coarse.max() - c.ORIGIN_Z),
    "holes_filled": int(holes.sum()),
}
(c.GLOBAL / "terrain.json").write_text(json.dumps(meta, indent=1))
print(meta, f"{cm.nbytes / 1e3:.0f} ko")
