"""Îlots des ronds-points d'après photo (D142) : bordure, pelouse bombée, massif et arbre au centre, mesurés à l'orthophoto et au LiDAR.

Usage : python3 tools/data/build_roundabouts.py      (après build_kinds.py, qui réécrit public/data/kinds ; puis relancer celle-ci)
Entrées : `roundabouts` de tools/data/manual.json (lecture des photos de l'utilisateur), orthophotographie HR (WMS, 0,25 m), modèles de
          surface et de terrain LiDAR HD de l'IGN (WMS, 0,5 m), tiles/*.json (arbres et mobilier posés dans l'îlot).
Sortie : site `roundabout` dans kinds/<tuile>.json (créé au besoin et ajouté à l'index) ; rien d'autre. build_public_space.py (D94), qui
          dessine déjà les îlots en pelouse d'après l'orthophoto, réécrit toutes les tuiles : on ne le relance pas pour un rond-point.
          Une deuxième passe ne change rien.

Mesures :
- bordure : sur des rayons tous les 2,5° depuis le point donné, le pixel le plus clair (> 195) entre 11 et 16,5 m, s'il a de l'herbe juste
  à l'intérieur (les rayons dans l'ombre du cèdre n'en ont pas) ; cercle ajusté aux moindres carrés, points à plus de 2,5 fois l'écart
  médian écartés ; le rayon est celui du milieu de la bordure ;
- bombé : médiane du terrain dans l'îlot (à plus de 2 m du bord) moins celle de la chaussée autour (de 0,5 à 2,5 m du bord) ;
- arbre : hauteur du MNS au-dessus du terrain ; tronc au centre de la couronne ; rayon de la couronne tous les mètres de hauteur
  (95ᵉ centile des distances au centre des cellules plus hautes que ce palier) ;
- arbres de la carte dans l'îlot (le relevé avait mis trois arbres de 13 m dans la couronne du cèdre) et mobilier dans l'îlot (un lampadaire
  posé par la chaîne au bord de l'îlot, absent des photos) : retirés à l'affichage par le site, sans réécrire la tuile.
"""

import io
import json
import math

import numpy as np
from PIL import Image

import config as c
import fetch
from build_monuments import CACHE, KINDS, Raster

R_MIN, R_MAX = 11.0, 16.5


def ortho(key, x0, y0, x1, y1, res=0.25):
    w = int(round((x1 - x0) / res))
    png = fetch.wms_block("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/png", x0 + c.ORIGIN[0], y0 + c.ORIGIN[1], x1 + c.ORIGIN[0], y1 + c.ORIGIN[1],
                          w, w, CACHE / f"{key}_ortho_{x0:.0f}_{y0:.0f}_{w}.png")
    a = np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(float)
    return lambda x, y: a[int((y1 - y) / res), int((x - x0) / res)]


def fit_circle(P):
    A = np.c_[2 * P, np.ones(len(P))]
    (a, b, k), *_ = np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)
    return a, b, math.sqrt(k + a * a + b * b)


def measure(spec):
    key = "roundabout_" + spec["name"].replace(" ", "_")
    x, y = spec["at"]
    W = 24
    px = ortho(key, x - W, y - W, x + W, y + W)
    pts = []
    for k in range(144):
        a = math.radians(k * 2.5)
        prof = []
        for r in np.arange(R_MIN, R_MAX, 0.1):
            p = px(x + r * math.cos(a), y + r * math.sin(a))
            prof.append((r, p.mean(), p[1] - (p[0] + p[2]) / 2))
        bright = [(b, r) for r, b, _ in prof if b > 195]
        if not bright:
            continue
        _, rb = max(bright)
        grass = [v for r, _, v in prof if rb - 1.0 < r < rb - 0.3]
        if grass and np.mean(grass) >= 6:
            pts.append((x + rb * math.cos(a), y + rb * math.sin(a)))
    P = np.array(pts)
    for _ in range(4):
        cx, cy, R = fit_circle(P)
        d = np.abs(np.hypot(P[:, 0] - cx, P[:, 1] - cy) - R)
        P = P[d < max(0.3, 2.5 * float(np.median(d)))]
    cx, cy, R = fit_circle(P)
    spread = float(np.median(np.abs(np.hypot(P[:, 0] - cx, P[:, 1] - cy) - R)))
    # Terrain, arbre (MNS et MNT à 0,5 m).
    x0, y0 = math.floor(cx - W), math.floor(cy - W)
    mns, mnt = Raster("MNS", key, x0, y0, x0 + 2 * W, y0 + 2 * W), Raster("MNT", key, x0, y0, x0 + 2 * W, y0 + 2 * W)
    X, Y = np.meshgrid(x0 + 0.25 + 0.5 * np.arange(mns.a.shape[1]), mns.y1 - 0.25 - 0.5 * np.arange(mns.a.shape[0]))
    D = np.hypot(X - cx, Y - cy)
    nd = mns.a - mnt.a
    g = float(np.median(mnt.a[(D > R + 0.5) & (D < R + 2.5)]))
    mound = float(np.median(mnt.a[D < R - 2])) - g
    isl = D < R + 3
    top = float(nd[isl].max())
    tiers = []
    for h in np.arange(1.5, top, 1.0):
        m = isl & (nd > h)
        tx, ty = float(X[m].mean()), float(Y[m].mean())
        tiers.append([round(float(h), 1), round(float(np.percentile(np.hypot(X[m] - tx, Y[m] - ty), 95)), 2), tx, ty])
    # Tronc : centre de la couronne sur ses deux premiers tiers (le sommet, plus étroit, peut pencher).
    low = [q for q in tiers if q[0] < top * 2 / 3]
    trunk = (float(np.mean([q[2] for q in low])), float(np.mean([q[3] for q in low])))
    r2 = lambda v: round(float(v), 2)
    return {"t": "roundabout", "n": spec["name"], "c": [r2(cx), r2(cy)], "r": r2(R), "curb": spec["curb"], "g": r2(g), "mound": r2(mound),
            "fit": [len(P), r2(spread)],
            "tree": {"k": spec["tree"], "x": r2(trunk[0]), "y": r2(trunk[1]), "top": r2(top), "tiers": [q[:2] for q in tiers]},
            "bed": spec["bed"], "flowers": spec["flowers"]}


def main():
    specs = json.load(open(c.ROOT / "tools" / "data" / "manual.json")).get("roundabouts", [])
    world = json.load(open(c.OUT / "world.json"))
    index = json.loads((KINDS / "index.json").read_text())
    changed = 0
    for spec in specs:
        site = measure(spec)
        cx, cy = site["c"]
        tid = f"{int((cx + c.ORIGIN[0]) // c.TILE) - c.GRID_I0}_{int((cy + c.ORIGIN[1]) // c.TILE) - c.GRID_J0}"
        # Arbres et mobilier de la carte dans l'îlot (toutes les tuiles qui le touchent).
        trees, drop = 0, []
        for m in world["tiles"]:
            path = c.OUT / "tiles" / f"{m['id']}.json"
            if not path.exists():
                continue
            t = json.loads(path.read_text())
            bx0, by0, bx1, by1 = t["bounds"]
            if not (bx0 - 20 < cx < bx1 + 20 and by0 - 20 < cy < by1 + 20):
                continue
            trees += sum(1 for q in t["trees"] if math.hypot(q[0] - cx, q[1] - cy) < site["r"] + 0.5)
            drop += [f["id"] for f in t["furniture"] if math.hypot(f["x"] - cx, f["y"] - cy) < site["r"] + 0.5]
        site["drop"] = sorted(drop)
        tr = site["tree"]
        print(f"  {site['n']} : îlot de {site['r']} m de rayon au milieu de la bordure, centre ({cx}, {cy}) ({site['fit'][0]} rayons,"
              f" écart médian {site['fit'][1]} m) ; bombé de {site['mound']} m ; {tr['k']} de {tr['top']} m, tronc en ({tr['x']}, {tr['y']}),"
              f" couronne de {tr['tiers'][0][1]} m de rayon à {tr['tiers'][0][0]} m ; {trees} arbre(s) et {len(drop)} objet(s) retirés de l'îlot")
        kp = KINDS / f"{tid}.json"
        k = json.loads(kp.read_text()) if kp.exists() else {"v": 1, "buildings": {}, "sites": []}
        sites = [q for q in k["sites"] if not (q.get("t") == "roundabout" and q.get("n") == site["n"])] + [site]
        if sites == k["sites"]:
            continue
        k["sites"] = sites
        kp.write_text(json.dumps(k, ensure_ascii=False, separators=(",", ":")))
        if tid not in index["tiles"]:
            index["tiles"] = sorted(index["tiles"] + [tid])
        index["stats"]["sites"]["roundabout"] = sum(1 for q in specs)
        (KINDS / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
        changed += 1
    print(f"{len(specs)} rond(s)-point(s) d'après photo ; {changed} fichier(s) de types réécrit(s)")


if __name__ == "__main__":
    main()
