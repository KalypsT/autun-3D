"""Base nautique du plan d'eau du Vallon (D245, lot 2 de `docs/plans/vallon-lac.md`) : toits mesurés sur les modèles de surface et de terrain LiDAR HD
(WMS, 0,5 m).

Repère (`FRAME`) : origine au coin sud-ouest du hangar du sud (sommet BD TOPO (1306,7 ; 553,4)), s le long de son côté sud (18,4° au nord de l'est),
t vers le nord-nord-ouest. Tous les murs du bâtiment BD TOPO …847357 sont parallèles à ces axes (sommets à 0,3 m près).

Chaque volume part d'un rectangle lu sur l'orthophotographie et le contour BD TOPO (`BLOCKS`), avec la forme de son toit (lue sur les profils du
modèle de surface) ; les cotes viennent du modèle de surface à plus de 0,8 m des bords :
- `flat` : médiane ;
- `mono` (un pan) : plan ajusté, haut et bas aux deux bords opposés le long de l'axe de la pente ;
- `gable` (deux pans) et `hip` (pavillon, quatre pans jusqu'à un sommet) : égout au 10e centile, faîtage au 97e centile.
Sol : médiane du modèle de terrain sur une bande de 2 à 4 m autour du bâtiment.

Usage : python3 tools/data/survey_nautique.py
Sortie : les volumes (JSON, à recopier dans `blocks` de l'entrée de la base nautique de `monuments`, tools/data/manual.json).
"""

import io
import json
import math

import numpy as np
import tifffile

import config as c
from survey_vallon import wms

BOX = (1270.0, 540.0, 1350.0, 620.0)
FRAME = ((1306.7, 553.4), math.atan2(556.3 - 553.4, 1315.4 - 1306.7))
# Nom, forme, rectangle (s0, s1, t0, t1), pente ou faîtage : axe du faîtage (gable) ou côté haut (mono).
BLOCKS = [
    ("hangar", "hip", (0.8, 9.2, 0.0, 11.3), {}),
    ("porche", "flat", (-0.2, 2.9, 11.3, 14.7), {}),
    ("ouest", "flat", (-5.9, 0.3, 15.0, 27.1), {}),
    ("centre-sud", "flat", (0.3, 12.0, 14.7, 23.0), {}),
    ("centre-nord-ouest", "flat", (0.3, 5.5, 23.0, 32.4), {}),
    ("centre-nord", "flat", (5.5, 12.0, 23.0, 32.4), {}),
    ("milieu", "gable", (12.0, 19.8, 15.5, 32.4), {"axis": "s"}),
    ("liaison", "flat", (19.8, 23.5, 20.7, 32.4), {}),
    ("nord-est", "mono", (23.5, 29.3, 20.7, 32.9), {"high": "s0"}),
]


def load(layer, name):
    f = wms(layer, "image/geotiff", BOX, 0.5, name)
    return tifffile.imread(io.BytesIO(f.read_bytes())).astype(np.float64) - c.ORIGIN_Z


MNS = load("IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", "base_MNS.tif")
MNT = load("IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", "base_MNT.tif")


def xy(s, t):
    (ox, oy), a = FRAME
    return ox + math.cos(a) * s - math.sin(a) * t, oy + math.sin(a) * s + math.cos(a) * t


def sample(A, s, t):
    x, y = xy(s, t)
    return float(A[int((BOX[3] - y) / 0.5), int((x - BOX[0]) / 0.5)])


def main():
    out = []
    for name, roof, (s0, s1, t0, t1), opt in BLOCKS:
        pts = [(s, t, sample(MNS, s, t)) for s in np.arange(s0 + 0.8, s1 - 0.79, 0.5) for t in np.arange(t0 + 0.8, t1 - 0.79, 0.5)]
        S, T, Z = (np.array(v) for v in zip(*pts))
        b = {"n": name, "roof": roof, "r": [s0, s1, t0, t1]}
        if roof == "flat":
            b["z"] = round(float(np.median(Z)), 2)
        elif roof == "mono":
            A = np.c_[np.ones_like(S), S, T]
            k, *_ = np.linalg.lstsq(A, Z, rcond=None)
            side = opt["high"]
            if side[0] == "s":
                lo, hi = k[0] + k[1] * s1 + k[2] * (t0 + t1) / 2, k[0] + k[1] * s0 + k[2] * (t0 + t1) / 2
                if side == "s1":
                    lo, hi = hi, lo
            else:
                lo, hi = k[0] + k[2] * t1 + k[1] * (s0 + s1) / 2, k[0] + k[2] * t0 + k[1] * (s0 + s1) / 2
                if side == "t1":
                    lo, hi = hi, lo
            b.update(high=side, z=round(float(lo), 2), ridge=round(float(hi), 2))
        else:
            b["z"] = round(float(np.percentile(Z, 10)), 2)
            b["ridge"] = round(float(np.percentile(Z, 97)), 2)
            if roof == "gable":
                b["axis"] = opt["axis"]
                # Position du faîtage : le maximum des médianes par tranche en travers.
                cross = T if opt["axis"] == "s" else S
                bins = np.round(cross)
                best = max(set(bins.tolist()), key=lambda v: float(np.median(Z[bins == v])))
                b["at"] = round(float(best), 1)
        out.append(b)
    ring = [(s, t) for s in np.arange(-9, 33, 1.0) for t in (-3.0, 36.0)] + [(s, t) for t in np.arange(-3, 36, 1.0) for s in (-9.0, 32.0)]
    g = float(np.median([sample(MNT, s, t) for s, t in ring]))
    print(f"sol autour : {g:.2f}")
    for b in out:
        extra = f", faîtage {b['ridge'] - g:.1f} m" if "ridge" in b else ""
        print(f"  {b['n']:18s} {b['roof']:5s} {b['r'][1] - b['r'][0]:4.1f} × {b['r'][3] - b['r'][2]:4.1f} m, égout {b['z'] - g:.1f} m{extra}")
    print(json.dumps({"g": round(g, 2), "blocks": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
