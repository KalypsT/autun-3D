"""Constantes communes de la chaîne de données.

Repère de travail : Lambert-93 (EPSG:2154), mètres. Le jeu reçoit des coordonnées
locales : x vers l'est, y vers le nord, z vers le haut, origine près de la mairie.
La zone est une grille de tuiles de 250 m alignées sur le Lambert-93.
"""

import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
OUT = ROOT / "public" / "data"

# --- Zone : TILES_NX × TILES_NY tuiles de TILE mètres -----------------------------------------
TILE = 250.0
# Indices (absolus, en Lambert-93 / 250 m) de la tuile sud-ouest : x = i × 250, y = j × 250.
TILE_I0, TILE_J0 = 3193, 26600
TILES_NX, TILES_NY = 6, 6
# Englobe le quartier de la mairie, la cathédrale Saint-Lazare et la rue du Théâtre romain.
ZONE = (TILE_I0 * TILE, TILE_J0 * TILE, (TILE_I0 + TILES_NX) * TILE, (TILE_J0 + TILES_NY) * TILE)

# Origine locale : conservée depuis la première maquette (mairie), pour que les coordonnées restent stables.
ORIGIN = (798770.0, 6650812.0)
# Altitude de référence (IGN69) : tous les z exportés sont relatifs à elle.
ORIGIN_Z = 330.0

# --- Grille des rasters IGN (0,5 m) -------------------------------------------------------------
# Les bords de pixels des rasters LiDAR tombent sur n × 0,5 m + 0,25 m. Marge de 20 m autour de la zone
# pour que le terrain et le bâti ne s'arrêtent pas net.
RES = 0.5
MARGIN = 20.0
GRID_X0 = math.floor((ZONE[0] - MARGIN - 0.25) / RES) * RES + 0.25
GRID_Y0 = math.floor((ZONE[1] - MARGIN - 0.25) / RES) * RES + 0.25
# Nombres de pixels pairs (le relief est ramené à 1 m par blocs de 2 × 2).
GRID_W = 2 * math.ceil((ZONE[2] + MARGIN - GRID_X0) / (2 * RES))
GRID_H = 2 * math.ceil((ZONE[3] + MARGIN - GRID_Y0) / (2 * RES))
GRID_X1 = GRID_X0 + GRID_W * RES
GRID_Y1 = GRID_Y0 + GRID_H * RES
MARGIN_BOX = (GRID_X0, GRID_Y0, GRID_X1, GRID_Y1)

# Dalles LiDAR HD de 1 km (nom = coin nord-ouest en km) qui touchent la zone.
LIDAR_TILES = [
    (kx, ky)
    for ky in range(math.floor(ZONE[1] / 1000) + 1, math.floor((ZONE[3] - 1e-6) / 1000) + 2)
    for kx in range(math.floor(ZONE[0] / 1000), math.floor((ZONE[2] - 1e-6) / 1000) + 1)
]

USER_AGENT = "Autun3DMockup/0.1 (https://github.com/kalypst/autun-3d)"
INSEE_AUTUN = "71014"


def to_local(x: float, y: float) -> tuple[float, float]:
    return x - ORIGIN[0], y - ORIGIN[1]


def pixel_center(col, row):
    """Centre d'un pixel de la grille IGN en Lambert-93."""
    return GRID_X0 + (col + 0.5) * RES, GRID_Y1 - (row + 0.5) * RES


def tile_bounds_local(col: int, row: int) -> tuple[float, float, float, float]:
    """Emprise locale (x0, y0, x1, y1) de la tuile (col, row), col vers l'est et row vers le nord depuis le coin sud-ouest."""
    x0 = ZONE[0] + col * TILE - ORIGIN[0]
    y0 = ZONE[1] + row * TILE - ORIGIN[1]
    return x0, y0, x0 + TILE, y0 + TILE


def tile_of_local(x: float, y: float) -> tuple[int, int] | None:
    """Tuile (col, row) qui contient le point local, ou None hors zone."""
    col = math.floor((x + ORIGIN[0] - ZONE[0]) / TILE)
    row = math.floor((y + ORIGIN[1] - ZONE[1]) / TILE)
    if 0 <= col < TILES_NX and 0 <= row < TILES_NY:
        return col, row
    return None


def tile_id(col: int, row: int) -> str:
    return f"{col}_{row}"


def osm_bbox(margin: float = 40.0):
    """Emprise WGS84 (sud, ouest, nord, est) de la zone élargie de `margin` mètres."""
    from pyproj import Transformer

    t = Transformer.from_crs(2154, 4326, always_xy=True)
    lon0, lat0 = t.transform(ZONE[0] - margin, ZONE[1] - margin)
    lon1, lat1 = t.transform(ZONE[2] + margin, ZONE[3] + margin)
    return lat0, lon0, lat1, lon1
