"""Gendarmerie de l'avenue André Frenaud (D238) : volumes à toit plat mesurés sur les modèles de surface et de terrain LiDAR HD (WMS, 0,5 m).

Repère commun (`FRAME`) : origine au coin nord-ouest du bâtiment principal (sommet BD TOPO), s le long de ses grands côtés vers l'est-sud-est,
t vers le nord-nord-est (la cour). Les bâtiments voisins (annexe au nord de la cour, collectif de logements au sud) sont parallèles à lui.

Chaque volume part d'un rectangle lu à l'œil sur le modèle de surface (`BLOCKS` : s0, s1, t0, t1 approchés, point de départ des mesures) :
- bords : passage à `DROP` sous le toit le long de six profils depuis le milieu du volume, médiane (1,5 m pour le bâtiment principal et les
  logements : le sol, ou le toit d'un voisin plus bas d'un niveau ; 0,3 m pour l'annexe, dont les trois toits ne diffèrent que de 0,3 à 0,8 m) ;
- toit : médiane du modèle de surface à plus d'un mètre des bords ;
- sol : médiane du modèle de terrain sur une bande de 2 à 4 m autour.
Un bord partagé avec un volume voisin de même hauteur, ou plus haut, n'a pas de chute : il est recollé au bord opposé du voisin (`glue`),
mesuré avant lui.

Usage : python3 tools/data/survey_gendarmerie.py
Sortie : les volumes (JSON, à recopier dans `blocks` de l'entrée de la gendarmerie de `monuments`, tools/data/manual.json).
"""

import io
import json
import math

import numpy as np
import requests
import tifffile

import config as c

CACHE = c.SHARED / "raw" / "monuments"
WMS = "https://data.geopf.fr/wms-r"
BOX = (1720.0, 470.0, 1920.0, 680.0)
# Coin nord-ouest du bâtiment principal et direction de son grand côté nord (sommets BD TOPO (1765,3 ; 602,1) → (1790,9 ; 588,7)).
FRAME = ((1765.3, 602.1), math.atan2(588.7 - 602.1, 1790.9 - 1765.3))
DROP = {"hq": 1.5, "flats": 1.5, "annex": 0.3}
# Nom, rôle, niveaux, rectangle approché (s0, s1, t0, t1), recollements (bord : volume voisin).
BLOCKS = [
    ("corps", "hq", 2, (15, 24, -9.5, -0.5), {}),
    ("accueil", "hq", 1, (0.5, 5.5, -12, 0), {"s1": "corps"}),
    ("corps-nord", "hq", 2, (7, 13.5, 0.5, 1.5), {"t0": "corps"}),
    ("aile-est", "hq", 1, (27, 38, -9.5, -0.5), {"s0": "corps"}),
    ("garages", "annex", 1, (14, 33, 36.5, 48), {}),
    ("ateliers", "annex", 1, (-2.5, 12, 40, 47.5), {"s1": "garages"}),
    ("local", "annex", 1, (1, 13, 49.5, 53.5), {"t0": "ateliers"}),
    ("logements-ouest", "flats", 2, (56, 66.5, -28, -17.5), {}),
    ("logements-est", "flats", 2, (69, 80, -29.5, -19.5), {"s0": "logements-ouest"}),
]


def wms(layer, name):
    f = CACHE / name
    if not f.exists():
        x0, y0, x1, y1 = BOX
        r = requests.get(WMS, timeout=180, headers={"User-Agent": c.USER_AGENT}, params={
            "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "", "FORMAT": "image/geotiff", "CRS": "EPSG:2154",
            "BBOX": f"{c.ORIGIN[0] + x0},{c.ORIGIN[1] + y0},{c.ORIGIN[0] + x1},{c.ORIGIN[1] + y1}", "WIDTH": int((x1 - x0) / 0.5), "HEIGHT": int((y1 - y0) / 0.5)})
        r.raise_for_status()
        CACHE.mkdir(parents=True, exist_ok=True)
        f.write_bytes(r.content)
    return tifffile.imread(io.BytesIO(f.read_bytes())).astype(np.float64) - c.ORIGIN_Z


MNS = wms("IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", "gendarmerie_MNS.tif")
MNT = wms("IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", "gendarmerie_MNT.tif")


def sample(A, s, t):
    (ox, oy), a = FRAME
    x, y = ox + math.cos(a) * s - math.sin(a) * t, oy + math.sin(a) * s + math.cos(a) * t
    cc, rr = (x - BOX[0]) / 0.5 - 0.5, (BOX[3] - y) / 0.5 - 0.5
    c0, r0 = int(math.floor(cc)), int(math.floor(rr))
    fc, fr = cc - c0, rr - r0
    return float(A[r0, c0] * (1 - fc) * (1 - fr) + A[r0, c0 + 1] * fc * (1 - fr) + A[r0 + 1, c0] * (1 - fc) * fr + A[r0 + 1, c0 + 1] * fc * fr)


def crossing(p0, p1, thr, step=0.05):
    """Premier point de p0 vers p1 où le modèle de surface passe sous `thr` (None s'il n'y en a pas)."""
    n = max(1, int(math.dist(p0, p1) / step))
    for i in range(n + 1):
        u = i / n
        s, t = p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u
        if sample(MNS, s, t) < thr:
            return s, t
    return None


def measure(r, drop, pad=10.0):
    s0, s1, t0, t1 = r
    roof = float(np.median([sample(MNS, s, t) for s in np.linspace(s0, s1, 8) for t in np.linspace(t0, t1, 8)]))
    ring = [(s, t) for s in np.linspace(s0 - 4, s1 + 4, 12) for t in (t0 - 4, t0 - 2, t1 + 2, t1 + 4)]
    ground = float(np.median([sample(MNT, s, t) for s, t in ring]))
    thr = roof - drop
    cs, ct = (s0 + s1) / 2, (t0 + t1) / 2
    ts = [t0 + (t1 - t0) * (k + 0.5) / 6 for k in range(6)]
    ss = [s0 + (s1 - s0) * (k + 0.5) / 6 for k in range(6)]

    def med(points, i):
        v = [p[i] for p in points if p is not None]
        return round(float(np.median(v)), 2) if v else None

    e = {"s0": med([crossing((cs, t), (s0 - pad, t), thr) for t in ts], 0), "s1": med([crossing((cs, t), (s1 + pad, t), thr) for t in ts], 0),
         "t0": med([crossing((s, ct), (s, t0 - pad), thr) for s in ss], 1), "t1": med([crossing((s, ct), (s, t1 + pad), thr) for s in ss], 1)}
    return e, round(roof, 2), round(ground, 2)


def main():
    out, done = [], {}
    for name, role, levels, r, glue in BLOCKS:
        e, roof, ground = measure(r, DROP[role])
        for edge, other in glue.items():
            e[edge] = done[other][{"s0": "s1", "s1": "s0", "t0": "t1", "t1": "t0"}[edge]]
        done[name] = e
        out.append({"n": name, "role": role, "levels": levels, "r": [e["s0"], e["s1"], e["t0"], e["t1"]], "z": roof, "g": ground})
        print(f"  {name:16s} s {e['s0']:6.2f} .. {e['s1']:6.2f}  t {e['t0']:6.2f} .. {e['t1']:6.2f}  toit {roof - ground:4.1f} m au-dessus du sol ({ground:.2f})")
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
