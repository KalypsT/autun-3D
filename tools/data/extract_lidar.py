"""Extrait de la dalle LiDAR HD les points de la zone (marge comprise) dans .cache/points.npz.

Usage : python3 tools/data/extract_lidar.py
"""

import laspy
import numpy as np

import config as c

x0, y0, x1, y1 = c.MARGIN_BOX
las = laspy.read(c.CACHE / "raw" / "lidar_0798_6651.copc.laz")
keep = (las.x >= x0) & (las.x < x1) & (las.y >= y0) & (las.y < y1)
np.savez_compressed(
    c.CACHE / "points.npz",
    x=np.asarray(las.x[keep]), y=np.asarray(las.y[keep]), z=np.asarray(las.z[keep]),
    cls=np.asarray(las.classification[keep], dtype=np.uint8),
    ret=np.asarray(las.return_number[keep], dtype=np.uint8),
    nret=np.asarray(las.number_of_returns[keep], dtype=np.uint8),
)
print(f"{int(keep.sum())} points gardés sur {len(las.x)}")
