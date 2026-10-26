"""Extrait de chaque dalle LiDAR HD les points utiles de la zone (marge comprise) dans .cache/points_<kx>_<ky>.npz.

Garde les classes 6 (bâtiment) et 3, 4, 5 (végétation). Coordonnées relatives à ORIGIN (float32).

Usage : python3 tools/data/extract_lidar.py
"""

import laspy
import numpy as np

import config as c

KEEP = (3, 4, 5, 6)
x0, y0, x1, y1 = c.MARGIN_BOX

for kx, ky in c.LIDAR_TILES:
    out = c.CACHE / f"points_{kx}_{ky}.npz"
    if out.exists():
        print(f"= {out.name}")
        continue
    las = laspy.read(c.CACHE / "raw" / f"lidar_{kx}_{ky}.copc.laz")
    cls = np.asarray(las.classification)
    keep = np.isin(cls, KEEP) & (las.x >= x0) & (las.x < x1) & (las.y >= y0) & (las.y < y1)
    np.savez_compressed(
        out,
        x=(np.asarray(las.x[keep]) - c.ORIGIN[0]).astype(np.float32),
        y=(np.asarray(las.y[keep]) - c.ORIGIN[1]).astype(np.float32),
        z=(np.asarray(las.z[keep]) - c.ORIGIN_Z).astype(np.float32),
        cls=cls[keep].astype(np.uint8),
    )
    print(f"+ {out.name} : {int(keep.sum())} points gardés sur {len(cls)}")
    del las
