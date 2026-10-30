"""Monuments modélisés d'après photo (D123) : volumes mesurés au LiDAR, dessinés à pans nets par le client.

Usage : python3 tools/data/build_monuments.py      (après build_kinds.py, qui réécrit public/data/kinds ; puis relancer celle-ci)
Entrées : `monuments` de tools/data/manual.json (lecture des photos de l'utilisateur : façade principale, travées, pavillons, niveaux),
          tiles/*.json (emprise BD TOPO), modèles de surface et de terrain LiDAR HD de l'IGN (WMS, fenêtre autour du bâtiment, 0,5 m,
          gardée dans .cache/shared/raw/monuments).
Sortie : kinds/<tuile>.json, champ `hall` du bâtiment (repère, contour et cour dans ce repère, hauteurs mesurées) ; `sign: false` retire
          l'inscription (`n`). Rien d'autre n'est réécrit, et une deuxième passe ne change rien.

Mesures (hauteurs en altitudes locales, comme les tuiles) :
- sol devant la façade : médiane du terrain sur une bande de 2 à 4 m devant elle, hors du perron (travées des pavillons centraux) ;
- corps principal : profil en travers (médiane sur les parties entre pavillons, ce qui écarte lucarnes et cheminées) ; corniche = droite du pan
  avant ramenée au mur, faîtage = maximum, profondeur = première chute de plus de 0,8 m derrière le faîtage ;
- pavillons : haut = 90ᵉ centile du modèle de surface sur leur emprise, plateau = cellules à moins de 0,6 m de ce haut (5ᵉ-95ᵉ centiles) ;
- ailes basses autour de la cour : faîtage = médiane sur la ligne médiane de chaque aile, égout = pente entre 1,5 et 4,5 m du mur extérieur.
Le relevé ne sert qu'à mesurer : le client dessine des pans plans (un toit maillé sur le relevé paraît bosselé, D122).
"""

import io
import json
import math

import numpy as np
import tifffile

import config as c
import fetch

KINDS = c.OUT / "kinds"
CACHE = c.SHARED / "raw" / "monuments"
LAYER = "IGNF_LIDAR-HD_{}_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
MARGIN = 20.0


class Raster:
    """Fenêtre de 0,5 m du WMS (MNS ou MNT) en altitudes locales, échantillonnée en bilinéaire."""

    def __init__(self, kind, key, x0, y0, x1, y1):
        w, h = int(round((x1 - x0) / c.RES)), int(round((y1 - y0) / c.RES))
        X0, Y0 = x0 + c.ORIGIN[0], y0 + c.ORIGIN[1]
        data = fetch.wms_block(LAYER.format(kind), "image/geotiff", X0, Y0, X0 + w * c.RES, Y0 + h * c.RES, w, h,
                               CACHE / f"{key}_{kind}_{x0:.0f}_{y0:.0f}_{w}x{h}.tif")
        self.a = tifffile.imread(io.BytesIO(data)).astype(np.float64) - c.ORIGIN_Z
        self.x0, self.y1 = x0, y0 + h * c.RES

    def __call__(self, x, y):
        cc = (x - self.x0) / c.RES - 0.5
        rr = (self.y1 - y) / c.RES - 0.5
        c0, r0 = int(math.floor(cc)), int(math.floor(rr))
        fc, fr = cc - c0, rr - r0
        a = self.a
        return float(a[r0, c0] * (1 - fc) * (1 - fr) + a[r0, c0 + 1] * fc * (1 - fr) + a[r0 + 1, c0] * (1 - fc) * fr + a[r0 + 1, c0 + 1] * fc * fr)


def pairs(flat):
    return [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]


def area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def measure_hall(bid, b, spec):
    ring = pairs(b["ring"])
    if area(ring) < 0:
        ring = ring[::-1]
    n = len(ring)
    k0 = spec["front"] % n
    ring = ring[k0:] + ring[:k0]
    (ox, oy), (ex, ey) = ring[0], ring[1]
    L = math.hypot(ex - ox, ey - oy)
    ux, uy = (ex - ox) / L, (ey - oy) / L
    vx, vy = -uy, ux  # vers l'intérieur (contour dans le sens trigonométrique)
    st = lambda p: ((p[0] - ox) * ux + (p[1] - oy) * uy, (p[0] - ox) * vx + (p[1] - oy) * vy)
    xy = lambda s, t: (ox + ux * s + vx * t, oy + uy * s + vy * t)
    R = [st(p) for p in ring]
    # Cour : mêmes sommets que le contour, dans le même sens, chacun en face de son coin.
    holes = [pairs(h) for h in b.get("holes", [])]
    if len(holes) != 1 or len(holes[0]) != n:
        raise SystemExit(f"{bid} : il faut une cour à {n} sommets")
    H = [st(p) for p in holes[0]]
    if area(H) < 0:
        H = H[::-1]
    k = min(range(n), key=lambda i: math.dist(H[i], R[0]))
    H = H[k:] + H[:k]

    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    box = (math.floor(min(xs) - MARGIN), math.floor(min(ys) - MARGIN), math.ceil(max(xs) + MARGIN), math.ceil(max(ys) + MARGIN))
    mns, mnt = Raster("MNS", bid, *box), Raster("MNT", bid, *box)
    S = lambda s, t: mns(*xy(s, t))

    bays = spec["bays"]
    p = L / bays
    pav = [(a * p, b_ * p) for a, b_ in spec["pavilions"]]
    centre = [r for r in pav if r[0] > 0.5 and r[1] < L - 0.5]
    # Sol devant la façade, hors du perron.
    g = float(np.median([mnt(*xy(s, t)) for s in np.arange(1, L - 1, 0.5) for t in (-2.0, -3.0, -4.0)
                         if not any(a - 1 < s < b_ + 1 for a, b_ in centre)]))
    # Profil du corps principal entre les pavillons.
    between = [s for s in np.arange(0, L, 0.5) if not any(a - 1 < s < b_ + 1 for a, b_ in pav)]
    ts = np.arange(0.5, 22, 0.5)
    prof = np.array([np.median([S(s, t) for s in between]) for t in ts])
    ir = int(np.argmax(prof))
    ridge, tr = float(prof[ir]), float(ts[ir])
    front = (ts >= 1.0) & (ts <= tr - 1.5)
    slope, z0 = np.polyfit(ts[front], prof[front], 1)
    depth = next((float(ts[i]) + 0.25 for i in range(ir, len(ts) - 1) if prof[i] - prof[i + 1] > 0.8), 2 * tr)
    eave = float(z0)
    pavs = []
    for a, b_ in pav:
        cells = [(s, t, S(s, t)) for s in np.arange(a + 0.25, b_, 0.5) for t in np.arange(0.25, depth, 0.5)]
        top = float(np.percentile([z for *_, z in cells], 90))
        hi = [(s, t) for s, t, z in cells if z >= top - 0.6]
        s0, s1 = np.percentile([q[0] for q in hi], [5, 95])
        t0, t1 = np.percentile([q[1] for q in hi], [5, 95])
        pavs.append([round(a, 2), round(b_, 2), round(float(s0), 2), round(float(s1), 2), round(float(t0), 2), round(float(t1), 2), round(top, 2)])
    # Ailes basses : toutes sauf l'avant (corps principal).
    ridges, eaves = [], []
    for i in range(1, n):
        O0, O1, I0, I1 = R[i], R[(i + 1) % n], H[i], H[(i + 1) % n]
        M0, M1 = ((O0[0] + I0[0]) / 2, (O0[1] + I0[1]) / 2), ((O1[0] + I1[0]) / 2, (O1[1] + I1[1]) / 2)
        ln = math.dist(O0, O1)
        nx, ny = -(O1[1] - O0[1]) / ln, (O1[0] - O0[0]) / ln  # vers l'intérieur
        for f in np.arange(0.2, 0.8, 0.02):
            ridges.append(S(M0[0] + (M1[0] - M0[0]) * f, M0[1] + (M1[1] - M0[1]) * f))
            ps, pt = O0[0] + (O1[0] - O0[0]) * f, O0[1] + (O1[1] - O0[1]) * f
            z1, z2 = S(ps + nx * 1.5, pt + ny * 1.5), S(ps + nx * 4.5, pt + ny * 4.5)
            eaves.append(z1 - 1.5 * (z2 - z1) / 3)
    # Portique et perron, devant l'avant-corps central : bord avant du balcon (modèle de surface au-dessus de l'étage noble), haut de sa
    # balustrade ; palier (terrain sous le portique), début de la volée (terrain 25 cm sous le palier), pied (terrain revenu à 10 cm du sol
    # relevé 12 à 16 m plus loin), largeur à mi-volée.
    r2 = lambda v: round(float(v), 2)
    extra = {}
    if centre and spec.get("perron"):
        c0, c1 = centre[0]
        mids = np.arange(c0 + 1.5, c1 - 1.5, 0.5)
        Sm = lambda t: float(np.median([S(s, t) for s in mids]))
        Tm = lambda t: float(np.median([mnt(*xy(s, t)) for s in mids]))
        noble = g + spec["levels"][1] - 1.5
        tf = next(float(t) for t in np.arange(-0.25, -6, -0.25) if Sm(t) < noble)
        balcony = float(np.median([Sm(t) for t in np.arange(tf + 0.5, -0.4, 0.25)] or [Sm(tf + 0.5)]))
        zl = float(np.median([Tm(t) for t in np.arange(-0.5, tf + 0.25, -0.25)]))
        tl = next(float(t) for t in np.arange(tf, -20, -0.25) if Tm(t) < zl - 0.25) + 0.25
        far = float(np.median([Tm(t) for t in np.arange(tl - 12, tl - 16, -0.5)]))
        tfoot = next(float(t) for t in np.arange(tl, -30, -0.25) if Tm(t) < far + 0.1)
        tm = (tl + tfoot) / 2
        thr = far + 0.25 * (zl - far)
        inside = [float(s) for s in np.arange(c0 - 6, c1 + 6, 0.25) if mnt(*xy(s, tm)) > thr]
        extra = {"portico": [r2(tf), r2(balcony)], "perron": [r2(min(inside)), r2(max(inside)), r2(tl), r2(tfoot), r2(zl)], "stairs": spec["perron"]}
    return {
        "o": [r2(ox), r2(oy)], "a": round(math.atan2(uy, ux), 5), "l": r2(L), "d": r2(depth),
        "ring": [r2(v) for q in R for v in q], "court": [r2(v) for q in H for v in q],
        "g": r2(g), "eave": r2(eave), "ridge": r2(ridge), "wingEave": r2(np.median(eaves)), "wingRidge": r2(np.median(ridges)),
        "bays": bays, "pav": pavs, "levels": spec["levels"], **extra,
    }


def main():
    manual = json.load(open(c.ROOT / "tools" / "data" / "manual.json")).get("monuments", {})
    world = json.load(open(c.OUT / "world.json"))
    found = {}
    for m in world["tiles"]:
        if not m.get("buildings"):
            continue
        for b in json.loads((c.OUT / "tiles" / f"{m['id']}.json").read_text())["buildings"]:
            if b["id"] in manual:
                found[b["id"]] = (m["id"], b)
    changed = set()
    kinds = {}
    for bid, spec in manual.items():
        if bid not in found:
            print(f"  monument : {bid} absent des tuiles")
            continue
        tid, b = found[bid]
        if spec["model"] != "townhall":
            raise SystemExit(f"{bid} : modèle inconnu {spec['model']}")
        hall = measure_hall(bid, b, spec)
        k = kinds.setdefault(tid, json.loads((KINDS / f"{tid}.json").read_text()))
        e = dict(k["buildings"].get(bid, {"k": "townhall"}))
        e["hall"] = hall
        if spec.get("sign") is False:
            e.pop("n", None)
        if k["buildings"].get(bid) != e:
            k["buildings"][bid] = e
            changed.add(tid)
        tops = ", ".join(f"{q[6] - hall['g']:.1f}" for q in hall["pav"])
        print(f"  {bid} : façade {hall['l']} m, corniche {hall['eave'] - hall['g']:.1f} m et faîtage {hall['ridge'] - hall['g']:.1f} m au-dessus du sol devant,"
              f" corps de {hall['d']} m, pavillons {tops} m,"
              f" ailes {hall['wingEave'] - hall['g']:.1f} / {hall['wingRidge'] - hall['g']:.1f} m")
    for tid in changed:
        (KINDS / f"{tid}.json").write_text(json.dumps(kinds[tid], ensure_ascii=False, separators=(",", ":")))
    print(f"{len(manual)} monument(s) d'après photo ; {len(changed)} fichier(s) de tuile réécrit(s)")


if __name__ == "__main__":
    main()
