"""Toits-terrasses des barres voisines de l'Hexagone (D170, lot 6 de docs/plans/hexagone.md) : niveau du toit et édicules mesurés au MNS LiDAR HD (50 cm).

Le jeu dessinait ces deux immeubles à croupes (pente 0,70) alors que le LiDAR est plat (relief de 0,3 à 0,7 m contre 1,2 m pour le toit dessiné).
Niveau du toit : médiane du MNS dans l'emprise (rétrécie de 1 m), recalculée sans les cellules à plus de 0,8 m au-dessus ; …848377 a deux niveaux de part
et d'autre d'un redan (`SPLITS`, droite perpendiculaire à l'axe du bâtiment lue sur les médianes par tranche de 2 m : +8,43 au sud, +7,28 au nord).
Édicules : composantes connexes (8 voisins) des cellules à plus de 0,6 m au-dessus du toit de leur niveau, de 3 m² au moins (rectangle orienté), hors du bord (parapet) ;
rectangle orienté minimal, haut au 90ᵉ centile.

Usage : python3 tools/data/survey_roofs.py     Sortie : JSON à recopier dans `flatRoofs` de tools/data/manual.json.
"""

import io
import json
import math

import numpy as np
import tifffile
from shapely.geometry import MultiPoint, Point, Polygon, box as sbox
from shapely.ops import unary_union

import config as c
import survey_hexagone as S

BOX = (230.0, 60.0, 530.0, 330.0)
RES = 0.5
IDS = [("27_36", "BATIMENT0000000348848387"), ("27_36", "BATIMENT0000000348848377")]
# Redan : point et direction de la droite, point du niveau bas.
SPLITS = {"BATIMENT0000000348848377": {"p": (408.0, 275.4), "d": (0.995, 0.100), "lo": (407.0, 290.0)}}


def mns():
    layer = "IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
    a = tifffile.imread(io.BytesIO(S.wms(layer, "image/geotiff", BOX, int(300 / RES), int(270 / RES), "MNS_large.tif"))).astype(np.float32)
    a[a < -100] = np.nan
    return a - c.ORIGIN_Z


def side(split, x, y):
    return (split["d"][0] * (y - split["p"][1]) - split["d"][1] * (x - split["p"][0])) > 0


def measure(Z, tid, bid):
    t = json.loads((c.OUT / "tiles" / f"{tid}.json").read_text())
    b = next(x for x in t["buildings"] if x["id"] == bid)
    P = Polygon(list(zip(b["ring"][0::2], b["ring"][1::2]))).buffer(0)
    inner = P.buffer(-1.0)
    split = SPLITS.get(bid)
    x0, y0, x1, y1 = P.bounds
    cells = {}
    for x in np.arange(x0, x1, RES):
        for y in np.arange(y0, y1, RES):
            if inner.contains(Point(x + RES / 2, y + RES / 2)):
                h = Z[int((BOX[3] - y - RES / 2) / RES), int((x + RES / 2 - BOX[0]) / RES)]
                if np.isfinite(h):
                    cells[(round(x, 2), round(y, 2))] = float(h)

    def part(q):
        return 0 if not split else (1 if side(split, q[0] + RES / 2, q[1] + RES / 2) == side(split, *split["lo"]) else 0)  # 1 : niveau bas

    levels = {}
    for k in sorted({part(q) for q in cells}):
        vals = np.array([v for q, v in cells.items() if part(q) == k])
        roof = float(np.median(vals))
        levels[k] = round(float(np.median(vals[vals < roof + 0.8])), 2)
    high = {q for q, v in cells.items() if v > levels[part(q)] + 0.6}
    seen, comps = set(), []
    for k in sorted(high):
        if k in seen:
            continue
        stack, comp = [k], []
        seen.add(k)
        while stack:
            q = stack.pop()
            comp.append(q)
            for dx in (-RES, 0, RES):
                for dy in (-RES, 0, RES):
                    n = (round(q[0] + dx, 2), round(q[1] + dy, 2))
                    if n in high and n not in seen and part(n) == part(q):
                        seen.add(n)
                        stack.append(n)
        comps.append(comp)
    out = []
    for comp in comps:
        if len(comp) * RES * RES < 1.0:
            continue
        g = unary_union([sbox(x, y, x + RES, y + RES) for x, y in comp]).minimum_rotated_rectangle
        pts = list(g.exterior.coords)[:4]
        e1 = (pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        e2 = (pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
        sx, sy = math.hypot(*e1), math.hypot(*e2)
        if sx * sy < 3.0:
            continue
        ang = math.degrees(math.atan2(e1[1], e1[0])) % 180
        z0 = levels[part(comp[0])]
        top = float(np.percentile([cells[q] for q in comp], 90))
        out.append([round(g.centroid.x, 2), round(g.centroid.y, 2), round(sx, 2), round(sy, 2), z0, round(top, 2), round(ang, 1)])
    rec = {"id": bid, "tile": tid, "top": levels[0], "rooftop": out}
    if split:
        rec["split"] = {"p": list(split["p"]), "d": list(split["d"]), "lo": list(split["lo"]), "loTop": levels[1]}
    return rec


def main():
    Z = mns()
    res = [measure(Z, tid, bid) for tid, bid in IDS]
    for r in res:
        lo = f", niveau bas {r['split']['loTop']:+.2f}" if "split" in r else ""
        print(f"{r['id'][-6:]} : toit à {r['top']:+.2f}{lo}, {len(r['rooftop'])} édicule(s)")
        for e in r["rooftop"]:
            print(f"    ({e[0]:.1f} ; {e[1]:.1f}) {e[2]:.1f} × {e[3]:.1f} m, de {e[4]:+.2f} à {e[5]:+.2f}, angle {e[6]:.0f}°")
    print(json.dumps(res))


if __name__ == "__main__":
    main()
