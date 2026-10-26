"""Contrôle qualité des toits : compare buildings.json au MNS LiDAR (0,5 m).

Usage : python3 tools/data/check_buildings.py [image.png]
Affiche l'écart (m) sur les cellules de toit : médiane, 90e centile, part à moins de 0,5 m.
L'image montre l'écart signé : bleu = modèle trop bas, rouge = trop haut.
"""

import json
import sys

import numpy as np
import shapely
from PIL import Image

import common
import config as c

mns = common.raster("MNS") - c.ORIGIN_Z
H, W = mns.shape
model = np.full((H, W), np.nan, dtype=np.float32)
cols = c.GRID_X0 - c.ORIGIN[0] + (np.arange(W) + 0.5) * c.RES
rows = c.GRID_Y1 - c.ORIGIN[1] - (np.arange(H) + 0.5) * c.RES

for b in json.load(open(c.CACHE / "work" / "buildings.json")):
    for f in b["faces"]:
        if "e" in f:  # toit maillé : l'altitude est dans f["z"], pas dans un plan
            continue
        ring = np.array(f["r"]).reshape(-1, 2)
        poly = shapely.Polygon(ring, [np.array(h).reshape(-1, 2) for h in f["h"]])
        x0, y0, x1, y1 = poly.bounds
        ci = np.nonzero((cols >= x0) & (cols <= x1))[0]
        ri = np.nonzero((rows >= y0) & (rows <= y1))[0]
        if len(ci) == 0 or len(ri) == 0:
            continue
        gx, gy = np.meshgrid(cols[ci], rows[ri])
        m = shapely.contains_xy(poly, gx.ravel(), gy.ravel()).reshape(gx.shape)
        a, bb, cc = f["p"]
        z = a * gx + bb * gy + cc
        sub = model[np.ix_(ri, ci)]
        sub[m] = z[m]
        model[np.ix_(ri, ci)] = sub

ok = ~np.isnan(model) & ~np.isnan(mns)
d = (model - mns)[ok]
print(f"cellules de toit : {ok.sum()} ; écart absolu médian {np.median(np.abs(d)):.2f} m, "
      f"90e centile {np.percentile(np.abs(d), 90):.2f} m ; < 0,5 m : {(np.abs(d) < 0.5).mean():.0%} ; biais {d.mean():+.2f} m")
if len(sys.argv) > 1:
    diff = np.where(ok, model - mns, 0)
    t = np.clip(diff / 2, -1, 1)
    img = np.zeros((H, W, 3), np.uint8) + 40
    img[..., 0] = np.where(ok, 128 + 127 * np.clip(t, 0, 1), img[..., 0])
    img[..., 2] = np.where(ok, 128 + 127 * np.clip(-t, 0, 1), img[..., 2])
    img[..., 1] = np.where(ok, 128 - 100 * np.abs(t), img[..., 1])
    Image.fromarray(img).save(sys.argv[1])
