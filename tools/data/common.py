"""Chargement partagé des données brutes."""

import json

import numpy as np
from PIL import Image, ImageDraw
from shapely import force_2d
from shapely.geometry import shape

import config as c


def raster(name):
    """Grille 0,5 m (lignes du nord au sud), float32, NaN pour les trous : MNT, MNS ou MNH."""
    return np.load(c.CACHE / "raw" / f"{name}.npy")


def ortho():
    """Orthophoto ramenée à la grille 0,5 m : (H, W, 3) uint8."""
    return np.load(c.CACHE / "raw" / "ortho.npy")


def bdtopo_buildings():
    """[(propriétés, polygone Lambert-93 en 2D)] ; les MultiPolygon sont éclatés."""
    out = []
    for f in json.load(open(c.CACHE / "raw" / "bdtopo_batiment.json"))["features"]:
        geom = shape(f["geometry"])
        geoms = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
        for i, g in enumerate(geoms):
            out.append((f["properties"] | {"part": i}, force_2d(g)))
    return out


def world_to_pixel(x, y):
    return (np.asarray(x) - c.GRID_X0) / c.RES, (c.GRID_Y1 - np.asarray(y)) / c.RES


def sample_raster(arr, x, y):
    """Valeur de la grille 0,5 m au plus proche voisin pour des coordonnées Lambert-93."""
    col, row = world_to_pixel(x, y)
    col = np.clip(np.asarray(col).astype(int), 0, arr.shape[1] - 1)
    row = np.clip(np.asarray(row).astype(int), 0, arr.shape[0] - 1)
    return arr[row, col]


def points(classes=None):
    """Points LiDAR de toutes les dalles : dict x, y, z (relatifs à ORIGIN / ORIGIN_Z), cls."""
    parts = []
    for kx, ky in c.LIDAR_TILES:
        d = np.load(c.CACHE / f"points_{kx}_{ky}.npz")
        parts.append({k: d[k] for k in d.files})
    pts = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
    if classes is not None:
        keep = np.isin(pts["cls"], classes)
        pts = {k: v[keep] for k, v in pts.items()}
    return pts


class PointIndex:
    """Index spatial de points par cellules de `cell` mètres : interroger une boîte ne parcourt que ses cellules."""

    def __init__(self, x, y, z, cell=16.0):
        self.cell = cell
        self.x0 = float(x.min()) - 1.0
        self.y0 = float(y.min()) - 1.0
        ix = ((x - self.x0) / cell).astype(np.int64)
        iy = ((y - self.y0) / cell).astype(np.int64)
        self.ny = int(iy.max()) + 2
        key = ix * self.ny + iy
        order = np.argsort(key, kind="stable")
        self.xyz = np.stack([x[order], y[order], z[order]], axis=1)
        self.keys = key[order]
        self.starts = {}
        uniq, first = np.unique(self.keys, return_index=True)
        last = np.append(first[1:], len(self.keys))
        self.starts = dict(zip(uniq.tolist(), zip(first.tolist(), last.tolist())))

    def box(self, minx, miny, maxx, maxy):
        """Points (N, 3) dont (x, y) est dans la boîte."""
        cx0, cx1 = int((minx - self.x0) // self.cell), int((maxx - self.x0) // self.cell)
        cy0, cy1 = int((miny - self.y0) // self.cell), int((maxy - self.y0) // self.cell)
        chunks = []
        for ix in range(cx0, cx1 + 1):
            for iy in range(cy0, cy1 + 1):
                span = self.starts.get(ix * self.ny + iy)
                if span:
                    chunks.append(self.xyz[span[0]:span[1]])
        if not chunks:
            return np.empty((0, 3), np.float32)
        pts = np.concatenate(chunks)
        m = (pts[:, 0] >= minx) & (pts[:, 0] <= maxx) & (pts[:, 1] >= miny) & (pts[:, 1] <= maxy)
        return pts[m]


def polygon_mask(polys, local=False):
    """Masque booléen (H, W) de la grille 0,5 m couvert par des polygones (Lambert-93, ou locaux si local=True).

    Dessin PIL des contours puis des trous : des milliers de polygones en une seconde.
    """
    img = Image.new("1", (c.GRID_W, c.GRID_H), 0)
    d = ImageDraw.Draw(img)
    ox, oy = (c.ORIGIN if local else (0.0, 0.0))

    def ring(coords):
        return [((x + ox - c.GRID_X0) / c.RES, (c.GRID_Y1 - (y + oy)) / c.RES) for x, y in coords]

    for g in polys:
        for part in (g.geoms if hasattr(g, "geoms") else [g]):
            if part.is_empty or part.geom_type != "Polygon":
                continue
            d.polygon(ring(part.exterior.coords), fill=1)
            for hole in part.interiors:
                d.polygon(ring(hole.coords), fill=0)
    return np.asarray(img, dtype=bool)
