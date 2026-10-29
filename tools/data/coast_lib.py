"""La côte de la mer qui entoure le monde (D105) : forme de la terre, niveau de la mer, profil du rivage.

La terre est la zone jouable (`PLAYABLE` de region.json) élargie d'environ 125 m, lissée puis déformée par un bruit doux, et gardée dans
l'anneau `BORDER` : la côte passe toujours dans la bande de 250 m qui entoure la ville. Tout est déterministe : chaque étape qui en a
besoin (build_coast, build_nav, build_map) recalcule la même terre.

Le niveau de la mer est celui de la plaine de l'Arroux, au nord et à l'ouest (≈ 285 m) : on y a des plages. Au sud, les collines de
Montjeu (jusqu'à 590 m) tombent dans la mer en falaises.
"""

import math
from functools import lru_cache

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

import config as c

# Niveau de la mer (IGN69), et le même en z local.
SEA_ALTITUDE = 282.5
SEA_Z = SEA_ALTITUDE - c.ORIGIN_Z
# Largeur moyenne de terre ajoutée autour de la zone jouable, et amplitude du bruit (m).
OFFSET = 125.0
WOBBLE = 45.0
# Profil du rivage (m) : la terre est plafonnée à SEA_Z + BERM au trait de côte. Vers l'intérieur, une plage de BEACH_W mètres monte
# de SAND mètres par mètre, puis une falaise de CLIFF mètres par mètre (72°) ; vers le large, le fond descend de SHELF mètres par mètre,
# jusqu'à DEPTH sous la surface. Dans la plaine, on a une plage (et un petit talus derrière si la terre est plus haute) ; sur les
# collines, une plage au pied d'une falaise.
BERM = 1.6
BEACH_W = 35.0
SAND = 0.12
CLIFF = 3.0
SHELF = 0.22
DEPTH = 9.0


def _tile_box(col, row, pad=0.0):
    x0, y0, x1, y1 = c.tile_bounds_local(col, row)
    return box(x0 - pad, y0 - pad, x1 + pad, y1 + pad)


def _noise(s):
    """Bruit doux et déterministe le long du contour (s : abscisse en m), entre -1 et 1."""
    return (0.55 * math.sin(s / 173.0 + 0.7) + 0.3 * math.sin(s / 61.0 + 2.1) + 0.15 * math.sin(s / 29.0 + 4.4))


@lru_cache(maxsize=1)
def land():
    """La terre (Polygon, coordonnées locales) : la zone jouable, élargie, lissée, irrégulière, dans l'anneau de bordure."""
    playable = unary_union([_tile_box(col, row) for col, row in c.PLAYABLE])
    allowed = unary_union([_tile_box(col, row) for col, row in c.REGION_TILES]).buffer(-20.0, join_style="mitre")
    base = orient(playable.buffer(OFFSET).buffer(-90.0).buffer(90.0), 1.0)
    ring = max(getattr(base, "geoms", [base]), key=lambda g: g.area).exterior
    n = max(64, int(ring.length / 8.0))
    pts = []
    for i in range(n):
        s = ring.length * i / n
        p, q = ring.interpolate(s), ring.interpolate((s + 4.0) % ring.length)
        tx, ty = q.x - p.x, q.y - p.y
        L = math.hypot(tx, ty) or 1.0
        d = WOBBLE * _noise(s)
        pts.append((p.x + ty / L * d, p.y - tx / L * d))  # normale extérieure d'un anneau parcouru dans le sens trigonométrique
    shape = Polygon(pts)
    if not shape.is_valid:
        shape = shape.buffer(0)
    shape = shape.buffer(-25.0).buffer(25.0)
    shape = unary_union([shape.intersection(allowed), playable.buffer(40.0, join_style="mitre")]).intersection(allowed)
    shape = max(getattr(shape, "geoms", [shape]), key=lambda g: g.area)
    return Polygon(shape.exterior).simplify(1.0)


@lru_cache(maxsize=1)
def _prepared():
    g = land()
    shapely.prepare(g)
    return g


def on_land(x, y, margin=0.0):
    """Vrai si le point local (x, y) est à terre, à plus de `margin` mètres de la côte (margin < 0 : jusqu'à |margin| en mer)."""
    g = _prepared()
    inside = bool(shapely.contains_xy(g, x, y))
    if margin == 0.0:
        return inside
    d = g.exterior.distance(Point(x, y))
    return (inside and d >= margin) if margin > 0 else (inside or d <= -margin)


def clip_line(coords, stride=2):
    """Morceaux d'une polyligne aplatie (x, y[, z]…) qui restent à terre ; z interpolé le long des segments."""
    pts = [tuple(coords[i:i + stride]) for i in range(0, len(coords) - stride + 1, stride)]
    if len(pts) < 2:
        return [list(coords)] if pts and on_land(*pts[0][:2]) else []
    if all(on_land(*p[:2]) for p in pts):
        return [list(coords)]
    out = []
    part = LineString(pts).intersection(_prepared())
    for g in getattr(part, "geoms", [part]):
        if g.geom_type != "LineString" or g.length < 0.5:
            continue
        flat = []
        for p in g.coords:
            flat += [round(v, 2) for v in p[:stride]]
        out.append(flat)
    return out


def clip_polygon(rings):
    """Polygone (liste d'anneaux aplatis, le premier extérieur) découpé à la côte : liste de polygones au même format."""
    shell = rings[0]
    ext = [(shell[i], shell[i + 1]) for i in range(0, len(shell) - 1, 2)]
    if len(ext) < 3:
        return []
    if all(on_land(x, y) for x, y in ext) and all(on_land(r[i], r[i + 1]) for r in rings[1:] for i in range(0, len(r) - 1, 2)):
        return [rings]
    holes = [[(r[i], r[i + 1]) for i in range(0, len(r) - 1, 2)] for r in rings[1:]]
    poly = Polygon(ext, [h for h in holes if len(h) >= 3])
    if not poly.is_valid:
        poly = poly.buffer(0)
    part = poly.intersection(_prepared())
    out = []
    for g in getattr(part, "geoms", [part]):
        if g.geom_type != "Polygon" or g.area < 0.5:
            continue

        def flat(ring):
            v = []
            for x, y in list(ring.coords)[:-1]:
                v += [round(x, 2), round(y, 2)]
            return v

        out.append([flat(g.exterior)] + [flat(h) for h in g.interiors])
    return out


def shore_cap(signed):
    """Altitude locale maximale du sol selon la distance signée à la côte (m, positive en mer) : falaise, plage, berme, puis fond marin."""
    s = np.asarray(signed, dtype=np.float64)
    inland = np.maximum(-s, 0.0)
    land = SEA_Z + BERM + SAND * np.minimum(inland, BEACH_W) + CLIFF * np.maximum(inland - BEACH_W, 0.0)
    cap = np.where(s < 0, land, SEA_Z + BERM - SHELF * s)
    return np.maximum(cap, SEA_Z - DEPTH)


def shore_masks(z, signed):
    """Sur un sol déjà plafonné (`z`), le rivage : (sable, roche, mer). Sable : la bande de plage et le fond ; roche : la falaise, là où le
    sol suit le plafond au-delà de la plage. Ne dépend que du sol final : la même réponse à chaque passage."""
    s = np.asarray(signed, dtype=np.float64)
    sea = z < SEA_Z
    sand = (s >= -BEACH_W) | sea
    rock = (~sand) & (z >= shore_cap(s) - 0.05)
    return sand, rock, sea


class TerrainSampler:
    """Relief fin publié (public/data/terrain/<id>.bin), lu à la demande : pour les étapes qui suivent build_coast."""

    def __init__(self):
        self.blocks = {}

    def at(self, x, y):
        col = math.floor((x - c.GRID_X) / c.TILE)
        row = math.floor((y - c.GRID_Y) / c.TILE)
        key = (col, row)
        if key not in self.blocks:
            p = c.OUT / "terrain" / f"{col}_{row}.bin"
            if not p.exists():
                self.blocks[key] = None
            else:
                buf = p.read_bytes()
                base, ox, oy, n = np.frombuffer(buf, dtype="<f4", count=4)
                n = int(n)
                z = float(base) + np.frombuffer(buf, dtype="<u2", offset=16, count=n * n).reshape(n, n).astype(np.float64) * 0.01
                self.blocks[key] = (float(ox), float(oy), n, z)
        b = self.blocks[key]
        if b is None:
            return None
        ox, oy, n, z = b
        j = min(max(int(x - ox), 0), n - 1)
        i = min(max(int(oy - y), 0), n - 1)
        return float(z[i, j])


_SAMPLER = TerrainSampler()


def usable(x, y, margin=2.0):
    """Vrai si (x, y) est à terre, hors du rivage (plage, falaise) : là où passent les routes et les files de la navigation."""
    if not on_land(x, y, BEACH_W + margin):
        return False
    z = _SAMPLER.at(x, y)
    if z is None:
        return True
    s = float(signed_distance(np.array([x]), np.array([y]))[0])
    return z < float(shore_cap(np.array([s]))[0]) - 0.5  # le sol ne suit pas le plafond : pas une falaise


# Distance signée à la côte, calculée une fois sur toute la région à DIST_RES mètres, puis interpolée : les tuiles voisines voient le même
# champ, sans couture.
DIST_RES = 2.0
DIST_PAD = 400.0


@lru_cache(maxsize=1)
def _distance_field():
    from scipy import ndimage

    x0, y0, x1, y1 = land().bounds
    x0, y0, x1, y1 = x0 - DIST_PAD, y0 - DIST_PAD, x1 + DIST_PAD, y1 + DIST_PAD
    cols, rows = int(math.ceil((x1 - x0) / DIST_RES)), int(math.ceil((y1 - y0) / DIST_RES))
    xs = x0 + (np.arange(cols) + 0.5) * DIST_RES
    ys = y1 - (np.arange(rows) + 0.5) * DIST_RES
    inside = shapely.contains_xy(_prepared(), *np.meshgrid(xs, ys))
    d_in = ndimage.distance_transform_edt(inside).astype(np.float32) * DIST_RES
    d_out = ndimage.distance_transform_edt(~inside).astype(np.float32) * DIST_RES
    field = np.where(inside, -(d_in - 0.5 * DIST_RES), d_out - 0.5 * DIST_RES).astype(np.float32)
    return x0, y1, field


def signed_distance(xx, yy):
    """Distance signée à la côte (m, positive en mer) aux points locaux (xx, yy), tableaux de même forme ; loin de tout : DIST_PAD."""
    from scipy import ndimage

    x0, y1, field = _distance_field()
    xx, yy = np.asarray(xx, np.float64), np.asarray(yy, np.float64)
    cc = (xx - x0) / DIST_RES - 0.5
    rr = (y1 - yy) / DIST_RES - 0.5
    d = ndimage.map_coordinates(field, [rr.ravel(), cc.ravel()], order=1, mode="nearest").reshape(xx.shape)
    outside = (cc < 0) | (rr < 0) | (cc > field.shape[1] - 1) | (rr > field.shape[0] - 1)
    return np.where(outside, DIST_PAD, d)
