"""Constantes communes de la chaîne de données.

Repère de travail : Lambert-93 (EPSG:2154), mètres. Le jeu reçoit des coordonnées
locales : x vers l'est, y vers le nord, z vers le haut, origine au centre de la zone.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache"
OUT = ROOT / "public" / "data"

# Zone de la maquette (WGS84).
LAT_MIN, LON_MIN, LAT_MAX, LON_MAX = 46.9488040, 4.2964430, 46.9516020, 4.3009710
# Même zone en Lambert-93, arrondie au mètre.
ZONE = (798601.0, 6650654.0, 798940.0, 6650970.0)

# Origine locale (centre de la zone, au mètre).
ORIGIN = (798770.0, 6650812.0)
# Altitude de référence (IGN69) : tous les z exportés sont relatifs à elle.
ORIGIN_Z = 330.0

# Grille des rasters IGN : les bords de pixels tombent sur n × 0,5 m + 0,25 m.
# Marge de 20 m autour de la zone pour que le terrain et le bâti ne s'arrêtent pas net.
RES = 0.5
GRID_X0, GRID_Y0 = 798580.75, 6650634.25
GRID_W, GRID_H = 760, 712
GRID_X1 = GRID_X0 + GRID_W * RES
GRID_Y1 = GRID_Y0 + GRID_H * RES
MARGIN_BOX = (GRID_X0, GRID_Y0, GRID_X1, GRID_Y1)

# Emprise WGS84 élargie pour OSM.
OSM_BBOX = (46.9484, 4.2958, 46.9520, 4.3016)  # sud, ouest, nord, est

LAZ_URL = (
    "https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/"
    "NUALHD_1-0__LAZ_LAMB93_NI_2025-10-20/LHD_FXX_0798_6651_PTS_LAMB93_IGN69.copc.laz"
)

USER_AGENT = "Autun3DMockup/0.1 (https://github.com/kalypst/autun-3d)"


def to_local(x: float, y: float) -> tuple[float, float]:
    return x - ORIGIN[0], y - ORIGIN[1]


def pixel_center(col, row):
    """Centre d'un pixel de la grille IGN en Lambert-93."""
    return GRID_X0 + (col + 0.5) * RES, GRID_Y1 - (row + 0.5) * RES
