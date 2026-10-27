"""Constantes communes de la chaîne de données.

Repère de travail : Lambert-93 (EPSG:2154), mètres. Le jeu reçoit des coordonnées
locales : x vers l'est, y vers le nord, z vers le haut, origine près de la mairie.

Le monde est une grille de tuiles de 250 m alignées sur le Lambert-93 (grille mondiale, qui couvre la commune entière).
La chaîne travaille par **blocs** de 8 × 8 tuiles (2 km), pour que la mémoire ne dépende pas de la taille du monde :
`AUTUN_BLOCK=bi,bj python3 build_all.py` fabrique le bloc (bi, bj) ; sans variable, on retombe sur le bloc central.
Chaque bloc ne fabrique que les tuiles de REGION qu'il contient ; ses rasters et ses données brutes débordent de MARGIN mètres.
"""

import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "data"

# --- Grille mondiale ----------------------------------------------------------------------------
TILE = 250.0
BLOCK = 8  # côté d'un bloc, en tuiles
SUPER = 4  # côté d'une super-tuile de sols grossiers, en tuiles (divise BLOCK)
# Indices absolus (Lambert-93 / 250 m) de la tuile sud-ouest de la grille mondiale : le bloc central (3, 4) commence à la tuile
# (3193, 26600), coin sud-ouest de la première zone de 6 × 6 tuiles, que ce découpage conserve entière.
GRID_I0, GRID_J0 = 3169, 26568
GRID_NX, GRID_NY = 56, 56  # 7 × 7 blocs : couvre la commune d'Autun (10,4 × 12,5 km) avec marge

# Tuiles à fabriquer : (colonne, ligne, nombre de colonnes, nombre de lignes) dans la grille mondiale.
# Anneau actuel : 12 × 12 tuiles (3 km) autour de la mairie. La commune entière viendra ensuite.
REGION = (20, 28, 12, 12)

# Origine locale : conservée depuis la première maquette (mairie), pour que les coordonnées restent stables.
ORIGIN = (798770.0, 6650812.0)
# Altitude de référence (IGN69) : tous les z exportés sont relatifs à elle.
ORIGIN_Z = 330.0

# Les rasters et le nuage LiDAR débordent du bloc de cette marge (m), pour que relief, toits et sols ne s'arrêtent pas net.
MARGIN = 20.0
RES = 0.5

USER_AGENT = "Autun3DMockup/0.1 (https://github.com/kalypst/autun-3d)"
INSEE_AUTUN = "71014"


def _region_tiles():
    c0, r0, nx, ny = REGION
    return {(c, r) for r in range(r0, r0 + ny) for c in range(c0, c0 + nx)}


def block_of_tile(col, row):
    return col // BLOCK, row // BLOCK


def block_tiles(bi, bj):
    """Tuiles (colonne, ligne) de la grille mondiale que fabrique le bloc (bi, bj) : celles de REGION qu'il contient."""
    return sorted(t for t in _region_tiles() if block_of_tile(*t) == (bi, bj))


def region_blocks():
    return sorted({block_of_tile(*t) for t in _region_tiles()})


_env = os.environ.get("AUTUN_BLOCK")
# Bloc central par défaut : celui de la première maquette.
BLOCK_ID = tuple(int(v) for v in _env.split(",")) if _env else (3, 4)
BLOCK_NAME = f"{BLOCK_ID[0]}_{BLOCK_ID[1]}"

# Données brutes volumineuses et communes à plusieurs blocs (dalles LiDAR, blocs OpenStreetMap, BDNB) : jamais versionnées.
SHARED = ROOT / ".cache" / "shared"
# Données propres au bloc (rasters, WFS, travail intermédiaire).
CACHE = ROOT / ".cache" / "blocks" / BLOCK_NAME
# Grilles globales du bloc (relief, poids des sols) : pack.py les découpe par tuile dans OUT.
GLOBAL = CACHE / "work" / "global"
# Fragments de manifeste et de relief grossier écrits par pack.py, réunis par assemble.py.
PARTS = ROOT / ".cache" / "parts"

_tiles = block_tiles(*BLOCK_ID)
if not _tiles:
    raise SystemExit(f"le bloc {BLOCK_ID} ne contient aucune tuile de REGION {REGION}")
_cols = [t[0] for t in _tiles]
_rows = [t[1] for t in _tiles]
TILE_COL0, TILE_ROW0 = min(_cols), min(_rows)
TILES_NX, TILES_NY = max(_cols) - TILE_COL0 + 1, max(_rows) - TILE_ROW0 + 1
# Indices absolus (Lambert-93 / 250 m) de la tuile sud-ouest du bloc, et emprise Lambert-93 de ses tuiles.
TILE_I0, TILE_J0 = GRID_I0 + TILE_COL0, GRID_J0 + TILE_ROW0
ZONE = (TILE_I0 * TILE, TILE_J0 * TILE, (TILE_I0 + TILES_NX) * TILE, (TILE_J0 + TILES_NY) * TILE)

# Origine de la grille mondiale en repère local.
GRID_X, GRID_Y = GRID_I0 * TILE - ORIGIN[0], GRID_J0 * TILE - ORIGIN[1]

# --- Grille des rasters IGN (0,5 m) -------------------------------------------------------------
# Les bords de pixels des rasters LiDAR tombent sur n × 0,5 m + 0,25 m.
GRID_X0 = math.floor((ZONE[0] - MARGIN - 0.25) / RES) * RES + 0.25
GRID_Y0 = math.floor((ZONE[1] - MARGIN - 0.25) / RES) * RES + 0.25
# Nombres de pixels pairs (le relief est ramené à 1 m par blocs de 2 × 2).
GRID_W = 2 * math.ceil((ZONE[2] + MARGIN - GRID_X0) / (2 * RES))
GRID_H = 2 * math.ceil((ZONE[3] + MARGIN - GRID_Y0) / (2 * RES))
GRID_X1 = GRID_X0 + GRID_W * RES
GRID_Y1 = GRID_Y0 + GRID_H * RES
MARGIN_BOX = (GRID_X0, GRID_Y0, GRID_X1, GRID_Y1)

# Dalles LiDAR HD de 1 km (nom = coin nord-ouest en km) qui touchent la grille du bloc.
LIDAR_TILES = [
    (kx, ky)
    for ky in range(math.floor(MARGIN_BOX[1] / 1000) + 1, math.floor((MARGIN_BOX[3] - 1e-6) / 1000) + 2)
    for kx in range(math.floor(MARGIN_BOX[0] / 1000), math.floor((MARGIN_BOX[2] - 1e-6) / 1000) + 1)
]


def to_local(x: float, y: float) -> tuple[float, float]:
    return x - ORIGIN[0], y - ORIGIN[1]


def pixel_center(col, row):
    """Centre d'un pixel de la grille IGN du bloc en Lambert-93."""
    return GRID_X0 + (col + 0.5) * RES, GRID_Y1 - (row + 0.5) * RES


def tile_bounds_local(col: int, row: int) -> tuple[float, float, float, float]:
    """Emprise locale (x0, y0, x1, y1) de la tuile (col, row) de la grille mondiale (col vers l'est, row vers le nord)."""
    x0 = GRID_X + col * TILE
    y0 = GRID_Y + row * TILE
    return x0, y0, x0 + TILE, y0 + TILE


def tile_of_local(x: float, y: float) -> tuple[int, int] | None:
    """Tuile (col, row) de la grille mondiale qui contient le point local, si le bloc la fabrique ; sinon None."""
    col = math.floor((x - GRID_X) / TILE)
    row = math.floor((y - GRID_Y) / TILE)
    return (col, row) if (col, row) in _TILE_SET else None


_TILE_SET = set(_tiles)


def tile_id(col: int, row: int) -> str:
    return f"{col}_{row}"


def osm_bbox(margin: float = 40.0):
    """Emprise WGS84 (sud, ouest, nord, est) du bloc élargie de `margin` mètres."""
    from pyproj import Transformer

    t = Transformer.from_crs(2154, 4326, always_xy=True)
    lon0, lat0 = t.transform(MARGIN_BOX[0] - margin, MARGIN_BOX[1] - margin)
    lon1, lat1 = t.transform(MARGIN_BOX[2] + margin, MARGIN_BOX[3] + margin)
    return lat0, lon0, lat1, lon1
