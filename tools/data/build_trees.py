"""Arbres réels : sommets et couronnes détectés dans le LiDAR HD, élargis avec l'orthophoto d'été.

Usage : python3 tools/data/build_trees.py

Le vol LiDAR date de mars : les arbres sont sans feuilles et les couronnes sont sous-estimées.
On prend donc la hauteur et la position au LiDAR, et le rayon sur l'union du LiDAR et des pixels
verts de l'orthophoto de juillet (là où le LiDAR voit de la végétation à plus de 2 m).

Sortie : public/data/trees.json, tableau de [x, y, z_sol, hauteur, rayon, hauteur_du_tronc].
"""

import json

import numpy as np
from PIL import Image
from scipy import ndimage
from shapely.affinity import translate
from shapely.ops import unary_union

import common
import config as c

H, W = c.GRID_H, c.GRID_W
raw = common.points()
mnt = common.raster("MNT")
mnt = np.where(np.isnan(mnt), np.nanmean(mnt), mnt)

col, row = common.world_to_pixel(raw["x"], raw["y"])
col, row = col.astype(int), row.astype(int)
inb = (col >= 0) & (col < W) & (row >= 0) & (row < H)

# Végétation : classes 4 et 5 du nuage (moyenne et haute).
veg = inb & np.isin(raw["cls"], (4, 5))
height = raw["z"][veg] - mnt[row[veg], col[veg]]
chm = np.zeros((H, W), np.float32)
np.maximum.at(chm, (row[veg], col[veg]), height.astype(np.float32))
chm[chm < 1.5] = 0

# On retire ce qui est dans l'emprise d'un bâtiment (cheminées, antennes mal classées).
cols = c.GRID_X0 + (np.arange(W) + 0.5) * c.RES
rows = c.GRID_Y1 - (np.arange(H) + 0.5) * c.RES
import shapely
bld = unary_union([g for _, g in common.bdtopo_buildings()]).buffer(0.3)
gx, gy = np.meshgrid(cols, rows)
bmask = shapely.contains_xy(bld, gx.ravel(), gy.ravel()).reshape(H, W)
chm[bmask] = 0

# Couronne = présence de végétation LiDAR (fermée sur 1 m) + pixels verts d'été au même endroit.
present = ndimage.binary_closing(chm > 0, iterations=2)
ortho = np.asarray(Image.open(c.CACHE / "raw" / "ortho.jpg").convert("RGB").resize((W, H), Image.BOX)).astype(np.float32)
green = (2 * ortho[..., 1] - ortho[..., 0] - ortho[..., 2] > 15) & (ortho[..., 1] > ortho[..., 0])
mnh = np.nan_to_num(common.raster("MNH"))
crown = (present | (green & (mnh > 2.0) & ~bmask)) & ~bmask

# Sommets : maxima locaux du modèle de canopée lissé, à plus de 3 m de haut, au moins 2,5 m l'un de l'autre.
smooth = ndimage.gaussian_filter(chm, 1.2)
peaks = (smooth == ndimage.maximum_filter(smooth, size=11)) & (smooth > 3.0)
labels, n = ndimage.label(peaks)
centers = ndimage.center_of_mass(peaks, labels, range(1, n + 1))
seeds = np.zeros((H, W), bool)
for r, q in centers:
    seeds[int(round(r)), int(round(q))] = True

# Chaque cellule de couronne va au sommet le plus proche (limite 8 m), le rayon vient de l'aire obtenue.
_, idx = ndimage.distance_transform_edt(~seeds, return_indices=True)
dist = ndimage.distance_transform_edt(~seeds) * c.RES
owner = np.where(crown & (dist < 8.0), idx[0] * W + idx[1], -1)

trees = []
for r, q in zip(*np.nonzero(seeds)):
    area = (owner == r * W + q).sum() * c.RES**2
    radius = float(np.clip(np.sqrt(max(area, 1.0) / np.pi), 1.2, 7.0))
    h = float(max(chm[max(r - 2, 0):r + 3, max(q - 2, 0):q + 3].max(), smooth[r, q]))
    x, y = c.GRID_X0 + (q + 0.5) * c.RES - c.ORIGIN[0], c.GRID_Y1 - (r + 0.5) * c.RES - c.ORIGIN[1]
    zg = float(mnt[r, q]) - c.ORIGIN_Z
    trees.append([round(x, 2), round(y, 2), round(zg, 2), round(h, 1), round(radius, 1),
                  round(float(np.clip(h * 0.35, 1.8, 4.5)), 1)])

(c.OUT / "trees.json").write_text(json.dumps(trees, separators=(",", ":")))
hs = np.array([t[3] for t in trees]); rs = np.array([t[4] for t in trees])
print(f"{len(trees)} arbres ; hauteur médiane {np.median(hs):.1f} m (max {hs.max():.1f}), rayon médian {np.median(rs):.1f} m")
