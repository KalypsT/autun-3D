"""Magasins d'après photo (D143) : plan du toit mesuré au LiDAR et modèle du magasin (Lidl, pharmacie) dans public/data/kinds.

Usage : python3 tools/data/build_stores.py     (après build_kinds.py puis build_carts.py, qui réécrivent kinds ; puis relancer celle-ci)
Entrées : `stores` de tools/data/manual.json (lecture des photos), tiles/*.json (contours), kinds/*.json (le type du bâtiment : grande
          surface, posée par build_kinds.py ou imposée à la main), modèles de surface et de terrain LiDAR HD (WMS, 0,5 m).
Sortie : dans l'entrée de chaque bâtiment de kinds/<tuile>.json, `store` (la lecture de la photo, sans le texte) et `roof` : plan du toit
          z = a·x + b·y + c (repère local) et hauteur de l'acrotère ; rien d'autre ne change (une deuxième passe ne réécrit rien).

Mesure du toit : cellules du modèle de surface à plus de 1,5 m des murs, plan ajusté aux moindres carrés en écartant (trois fois) ce qui
s'en éloigne de plus de 25 cm (équipements, vitrages de toit) ; acrotère : médiane de l'écart au plan sur une bande de 40 cm le long des murs
(entre 15 et 70 cm).
"""

import json
import math

import numpy as np
from shapely.geometry import Point, Polygon

import config as c
from build_monuments import Raster

KINDS = c.OUT / "kinds"
MARGIN = 6.0


def fit_roof(ring, mns):
    poly = Polygon([(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)])
    inner = poly.buffer(-1.5)
    x0, y0, x1, y1 = poly.bounds
    cells = [(x, y) for x in np.arange(math.floor(x0), x1, 0.5) for y in np.arange(math.floor(y0), y1, 0.5) if inner.contains(Point(x, y))]
    P = np.array([(x, y, mns(x, y)) for x, y in cells])
    keep = np.ones(len(P), bool)
    for _ in range(3):
        A = np.c_[P[keep, 0], P[keep, 1], np.ones(keep.sum())]
        (a, b, k), *_ = np.linalg.lstsq(A, P[keep, 2], rcond=None)
        res = P[:, 2] - (a * P[:, 0] + b * P[:, 1] + k)
        keep = np.abs(res) < 0.25
    band = poly.buffer(-0.2).difference(poly.buffer(-0.6)).buffer(0)
    edge = [(x, y) for x in np.arange(math.floor(x0), x1, 0.25) for y in np.arange(math.floor(y0), y1, 0.25) if band.contains(Point(x, y))]
    over = [mns(x, y) - (a * x + b * y + k) for x, y in edge]
    par = float(np.clip(np.median(over), 0.15, 0.7)) if over else 0.4
    return [round(a, 5), round(b, 5), round(k, 3), round(round(par / 0.05) * 0.05, 2)], float(np.sqrt(np.mean(res[keep] ** 2))), int(keep.sum())


def main():
    specs = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text()).get("stores", {})
    world = json.loads((c.OUT / "world.json").read_text())
    done = 0
    for m in world["tiles"]:
        if not m.get("buildings"):
            continue
        tid = m["id"]
        tile = json.loads((c.OUT / "tiles" / f"{tid}.json").read_text())
        mine = [b for b in tile["buildings"] if b["id"] in specs]
        if not mine:
            continue
        path = KINDS / f"{tid}.json"
        kinds = json.loads(path.read_text())
        changed = False
        for b in mine:
            e = kinds["buildings"].get(b["id"])
            if not e or e["k"] != "retail":
                print(f"  {b['id']} : pas une grande surface dans kinds (lancer build_kinds.py puis build_carts.py)")
                continue
            xs, ys = b["ring"][0::2], b["ring"][1::2]
            box = (math.floor(min(xs) - MARGIN), math.floor(min(ys) - MARGIN), math.ceil(max(xs) + MARGIN), math.ceil(max(ys) + MARGIN))
            mns = Raster("MNS", b["id"], *box)
            roof, rms, n = fit_roof(b["ring"], mns)
            store = {k: v for k, v in specs[b["id"]].items() if k != "photo"}
            new = dict(e, roof=roof, store=store)
            print(f"  {e.get('n')} : toit z = {roof[0]}·x + {roof[1]}·y + {roof[2]}, acrotère {roof[3]} m (écart {rms * 100:.0f} cm sur {n} cellules)")
            if kinds["buildings"][b["id"]] != new:
                kinds["buildings"][b["id"]] = new
                changed = True
        if changed:
            path.write_text(json.dumps(kinds, ensure_ascii=False, separators=(",", ":")))
            done += 1
    print(f"{len(specs)} magasins d'après photo ; {done} fichiers de tuile réécrits")


if __name__ == "__main__":
    main()
