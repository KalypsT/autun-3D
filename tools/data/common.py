"""Chargement partagé des données brutes."""

import json

import numpy as np
import tifffile
from shapely.geometry import shape

import config as c


def raster(name):
    """Grille 0,5 m (lignes du nord au sud), float32, NaN pour les trous."""
    a = tifffile.imread(c.CACHE / "raw" / f"{name}.tif").astype(np.float32)
    a[a < -100] = np.nan
    return a


def points():
    d = np.load(c.CACHE / "points.npz")
    return {k: d[k] for k in d.files}


def bdtopo_buildings():
    """[(propriétés, polygone Lambert-93 en 2D)] ; les MultiPolygon sont éclatés."""
    out = []
    for f in json.load(open(c.CACHE / "raw" / "bdtopo_batiment.json"))["features"]:
        geom = shape(f["geometry"])
        geoms = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
        for i, g in enumerate(geoms):
            from shapely import force_2d
            out.append((f["properties"] | {"part": i}, force_2d(g)))
    return out


def world_to_pixel(x, y):
    return (np.asarray(x) - c.GRID_X0) / c.RES, (c.GRID_Y1 - np.asarray(y)) / c.RES
