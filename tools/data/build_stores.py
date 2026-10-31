"""Magasins d'après photo (D143, D144, D145) : plan du toit mesuré au LiDAR et modèle du magasin (Lidl, pharmacie, But, Bricomarché, Intermarché, Jardinerie, galeries marchandes de Bellevue, GiFi, Action) dans public/data/kinds.

Usage : python3 tools/data/build_stores.py     (après build_kinds.py puis build_carts.py, qui réécrivent kinds ; puis relancer celle-ci)
Entrées : `stores` de tools/data/manual.json (lecture des photos), tiles/*.json (contours), kinds/*.json (le type du bâtiment : grande
          surface, posée par build_kinds.py ou imposée à la main), modèles de surface et de terrain LiDAR HD (WMS, 0,5 m).
Sortie : dans l'entrée de chaque bâtiment de kinds/<tuile>.json, `store` (la lecture de la photo, sans le texte) et `roof` : plan du toit
          z = a·x + b·y + c (repère local) et hauteur de l'acrotère ; rien d'autre ne change (une deuxième passe ne réécrit rien).
          `carports` (D144, liste de centres approchés, d'après la photo aérienne de l'Intermarché) : abris de parking solaires mesurés au LiDAR
          (rectangle orienté et plan du dessus), écrits dans le `store` du magasin de la tuile qui les contient.

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


def fit_roof(ring, mns, half=None):
    """`half` = [px, py, nx, ny] : ne garde que les cellules du côté de la normale (n) de la droite qui passe par p (toit à plusieurs niveaux, D144)."""
    poly = Polygon([(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)])
    inner = poly.buffer(-1.5)
    x0, y0, x1, y1 = poly.bounds
    cells = [(x, y) for x in np.arange(math.floor(x0), x1, 0.5) for y in np.arange(math.floor(y0), y1, 0.5) if inner.contains(Point(x, y))
             and (half is None or (x - half[0]) * half[2] + (y - half[1]) * half[3] >= 0)]
    P = np.array([(x, y, mns(x, y)) for x, y in cells])
    keep = np.ones(len(P), bool)
    for _ in range(3):
        A = np.c_[P[keep, 0], P[keep, 1], np.ones(keep.sum())]
        (a, b, k), *_ = np.linalg.lstsq(A, P[keep, 2], rcond=None)
        res = P[:, 2] - (a * P[:, 0] + b * P[:, 1] + k)
        keep = np.abs(res) < 0.25
    band = poly.buffer(-0.2).difference(poly.buffer(-0.6)).buffer(0)
    edge = [(x, y) for x in np.arange(math.floor(x0), x1, 0.25) for y in np.arange(math.floor(y0), y1, 0.25) if band.contains(Point(x, y))
            and (half is None or (x - half[0]) * half[2] + (y - half[1]) * half[3] >= 0)]
    over = [mns(x, y) - (a * x + b * y + k) for x, y in edge]
    par = float(np.clip(np.median(over), 0.15, 0.7)) if over else 0.4
    return [round(a, 5), round(b, 5), round(k, 3), round(round(par / 0.05) * 0.05, 2)], float(np.sqrt(np.mean(res[keep] ** 2))), int(keep.sum())


def measure_carport(cx, cy, polys):
    """Abri de parking solaire autour de (cx, cy) : composante des cellules à 2,3 – 7,5 m au-dessus du sol (hors bâtiments BD TOPO) qui contient ce
    point ; rectangle orienté et plan du dessus ajusté (trois passes à 25 cm). Rend [x, y, angle du grand côté en degrés (repère x vers l'est),
    longueur, largeur, a, b, c] (z = a·x + b·y + c), ou None."""
    from scipy import ndimage
    from shapely import contains_xy
    from shapely.geometry import MultiPoint
    from shapely.ops import unary_union

    R = 20
    box = (math.floor(cx - R), math.floor(cy - R), math.ceil(cx + R), math.ceil(cy + R))
    mns, mnt = Raster("MNS", f"carport_{cx:.0f}_{cy:.0f}", *box), Raster("MNT", f"carport_{cx:.0f}_{cy:.0f}", *box)
    xs, ys = np.arange(box[0] + 1, box[2] - 1, 0.5), np.arange(box[1] + 1, box[3] - 1, 0.5)
    X, Y = np.meshgrid(xs, ys)
    M = np.array([[mns(x, y) for x in xs] for y in ys])
    H = M - np.array([[mnt(x, y) for x in xs] for y in ys])
    mask = (H > 2.3) & (H < 7.5) & ~contains_xy(unary_union(polys), X, Y)
    mask = ndimage.binary_opening(mask, iterations=2)
    lab, n = ndimage.label(mask)
    if not n:
        return None
    j0, i0 = np.unravel_index(np.argmin((X - cx) ** 2 + (Y - cy) ** 2 + np.where(mask, 0, 1e6)), mask.shape)
    jj, ii = np.where(lab == lab[j0, i0])
    P = np.c_[xs[ii], ys[jj]]
    rect = MultiPoint([tuple(p) for p in P]).minimum_rotated_rectangle
    cc = list(rect.exterior.coords)[:4]
    sides = [math.dist(cc[k], cc[(k + 1) % 4]) for k in range(4)]
    k = 0 if sides[0] >= sides[1] else 1
    ang = math.degrees(math.atan2(cc[k + 1][1] - cc[k][1], cc[k + 1][0] - cc[k][0])) % 180
    A = np.c_[P, np.ones(len(P))]
    keep = np.ones(len(P), bool)
    for _ in range(3):
        co = np.linalg.lstsq(A[keep], M[jj, ii][keep], rcond=None)[0]
        keep = np.abs(M[jj, ii] - A @ co) < 0.25
    ctr = rect.centroid
    return [round(ctr.x, 1), round(ctr.y, 1), round(ang, 1), round(max(sides[0], sides[1]) + 0.5, 1), round(min(sides[0], sides[1]) + 0.5, 1),
            round(co[0], 4), round(co[1], 4), round(co[2], 2)]


def main():
    manual = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())
    specs = manual.get("stores", {})
    world = json.loads((c.OUT / "world.json").read_text())
    gx, gy = world["gridOrigin"]
    size = world["tileSize"]
    done = 0
    # Abris solaires : chaque centre approché, mesuré, est rangé dans la tuile qui le contient.
    carports = {}
    if manual.get("carports"):
        polys = []
        for m in world["tiles"]:
            if m.get("buildings"):
                polys += [Polygon([(b["ring"][i], b["ring"][i + 1]) for i in range(0, len(b["ring"]), 2)]).buffer(0.8)
                          for b in json.loads((c.OUT / "tiles" / f"{m['id']}.json").read_text())["buildings"]
                          if abs(sum(b["ring"][0::2]) / (len(b["ring"]) // 2) - manual["carports"]["at"][0][0]) < 400]
        for cx, cy in manual["carports"]["at"]:
            r = measure_carport(cx, cy, polys)
            if r is None:
                print(f"  abri solaire en ({cx}, {cy}) : rien mesuré")
                continue
            tid = f"{math.floor((r[0] - gx) / size)}_{math.floor((r[1] - gy) / size)}"
            carports.setdefault(tid, []).append(r)
            print(f"  abri solaire ({cx}, {cy}) : centre ({r[0]}, {r[1]}), {r[3]} × {r[4]} m, grand côté à {r[2]}°, pente {math.hypot(r[5], r[6]) * 100:.0f} %, tuile {tid}")
    designated = {}
    for m in world["tiles"]:
        if not m.get("buildings"):
            continue
        tid = m["id"]
        tile = json.loads((c.OUT / "tiles" / f"{tid}.json").read_text())
        mine = [b for b in tile["buildings"] if b["id"] in specs]
        if not mine:
            if tid in carports:
                print(f"  tuile {tid} : abris solaires sans magasin d'après photo pour les porter")
            continue
        designated[tid] = mine[0]["id"]
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
            roof, rms, n = fit_roof(b["ring"], mns, specs[b["id"]].get("fit", {}).get("half"))
            if "par" in specs[b["id"]]:
                roof[3] = specs[b["id"]]["par"]  # D145 : l'auvent vitré au bord du contour fausse la bande de mesure de l'acrotère
            store = {k: v for k, v in specs[b["id"]].items() if k not in ("photo", "fit", "par")}
            if tid in carports and designated[tid] == b["id"]:
                store["carports"] = sorted(carports[tid], key=lambda q: (q[1], q[0]))
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
