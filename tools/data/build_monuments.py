"""Monuments modélisés d'après photo (hôtel de ville D123, cathédrale D127, fontaine Saint-Lazare D131) : volumes mesurés au LiDAR, dessinés à pans nets par le client.

Usage : python3 tools/data/build_monuments.py      (après build_kinds.py, qui réécrit public/data/kinds ; puis relancer celle-ci)
Entrées : `monuments` de tools/data/manual.json (lecture des photos de l'utilisateur : façade principale, travées, pavillons, niveaux),
          tiles/*.json (emprise BD TOPO), modèles de surface et de terrain LiDAR HD de l'IGN (WMS, fenêtre autour du bâtiment, 0,5 m,
          gardée dans .cache/shared/raw/monuments).
Sortie : kinds/<tuile>.json, champ `hall` du bâtiment (repère, contour et cour dans ce repère, hauteurs mesurées) ; `sign: false` retire
          l'inscription (`n`) ; cathédrale (modèle `cathedral`, D127) : champ `cath`, clocher lointain (`tower` et kinds/index.json) ;
          silhouettes lointaines (lod/<tuile>.json) ; fontaine (modèle `fountain`, D131) : site `fountain` de la tuile où elle se trouve.
          Rien d'autre n'est réécrit, et une deuxième passe ne change rien.

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
import zlib

import numpy as np
import tifffile

import config as c
import fetch

KINDS = c.OUT / "kinds"
LOD = c.OUT / "lod"
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
    # Toits : lucarnes des travées données (haut = point le plus haut qui dépasse le pan avant de plus de 50 cm), lucarne-fronton de l'avant-corps
    # central (modèle de surface à 0,75-1,75 m du mur, où il dépasse le pan raide du pavillon), épis et paratonnerre (point le plus haut du
    # plateau, s'il dépasse de 80 cm), cheminées repérées par la chaîne (`chim` du bâtiment).
    roof = lambda t: z0 + slope * t
    dormers = []
    for i in spec.get("dormers", []):
        sc = (i + 0.5) * p
        hi = [S(s, t) for s in np.arange(sc - 0.75, sc + 0.8, 0.25) for t in np.arange(0.5, 4.01, 0.25) if S(s, t) - roof(t) > 0.5]
        if hi:
            dormers.append([r2(sc), r2(max(hi))])
    if centre and spec.get("fronton"):
        cs = (centre[0][0] + centre[0][1]) / 2
        extra["fronton"] = r2(np.median([S(s, t) for s in np.arange(cs - 1.2, cs + 1.25, 0.25) for t in (0.75, 1.0, 1.25, 1.5, 1.75)]))
    tips = []
    for a, b_, s0, s1, t0, t1, top in pavs:
        tip = max(S(s, t) for s in np.arange(s0 - 0.25, s1 + 0.3, 0.25) for t in np.arange(t0 - 0.25, t1 + 0.3, 0.25))
        tips.append(r2(tip) if tip - top > 0.8 else None)
    chim = []
    for cx, cy, sx, sy, cz0, cz1 in b.get("chim", []):
        cs_, ct_ = st((cx, cy))
        chim.append([r2(cs_), r2(ct_), r2(max(sx, sy)), r2(cz1)])
    extra.update({"dormers": dormers, "oculi": bool(spec.get("oculi")), "tips": tips, "chim": chim})
    return {
        "o": [r2(ox), r2(oy)], "a": round(math.atan2(uy, ux), 5), "l": r2(L), "d": r2(depth),
        "ring": [r2(v) for q in R for v in q], "court": [r2(v) for q in H for v in q],
        "g": r2(g), "eave": r2(eave), "ridge": r2(ridge), "wingEave": r2(np.median(eaves)), "wingRidge": r2(np.median(ridges)),
        "bays": bays, "pav": pavs, "levels": spec["levels"], **extra,
    }


def run(f, x0, step, limit, test):
    """Première abscisse depuis x0 (par pas `step`, jusqu'à `limit`) où test(f(x), f(x - step)) est vrai, ou None."""
    x = x0 + step
    while (x - limit) * step <= 0:
        if test(f(x), f(x - step)):
            return x - step / 2
        x += step
    return None


def measure_cathedral(bid, b, spec, mon):
    """Volumes de la cathédrale (D127) dans le repère de `mon` (build_kinds.py : axe de la nef, s vers le chevet, t vers l'est-nord-est) :
    porche, nef, bas-côtés, chapelles par travée, transept et bloc carré au bout du bras ouest, tour de croisée et flèche, chœur, bas-côtés du
    chœur, abside. Profils médians du modèle de surface (ce qui écarte pinacles, lucarnes et arbres) ; murs = chutes de plus de 3 m entre
    deux échantillons (0,5 m), égouts = droite du pan ramenée au mur ; débords des chapelles = emprise BD TOPO."""
    from shapely.geometry import LineString, Polygon
    (cx, cy), a, t0 = mon["c"], mon["a"], mon["t0"]
    ca, sa = math.cos(a), math.sin(a)
    xy = lambda s, t: (cx + ca * s - sa * t, cy + sa * s + ca * t)
    ring = pairs(b["ring"])
    P = Polygon([((x - cx) * ca + (y - cy) * sa, -(x - cx) * sa + (y - cy) * ca) for x, y in ring])
    xs, ys = [q[0] for q in ring], [q[1] for q in ring]
    box = (math.floor(min(xs) - MARGIN), math.floor(min(ys) - MARGIN), math.ceil(max(xs) + MARGIN), math.ceil(max(ys) + MARGIN))
    mns = Raster("MNS", bid, *box)
    g = b["ground"]
    H = lambda s, t: mns(*xy(s, t)) - g
    med = lambda vals: float(np.median(list(vals)))
    r2 = lambda v: round(float(v), 2)
    rng = lambda u0, u1, d=0.5: np.arange(u0, u1 + 1e-6, d)
    s_min, t_min, s_max, t_max = P.bounds

    def extent(s0, s1, side):
        """Débord de l'emprise sur un côté (−1 : ouest-sud-ouest, 1 : est-nord-est), médiane entre s0 et s1."""
        out = []
        for s in rng(s0, s1, 0.5):
            cut = LineString([(s, t0), (s, t0 + side * 60)]).intersection(P)
            pts = [q[1] for gg in getattr(cut, "geoms", [cut]) for q in gg.coords]
            if pts:
                out.append(max(pts) if side > 0 else min(pts))
        return med(out)

    # Profil en long sur l'axe : tour de croisée (au-dessus du faîtage de la nef de plus de 4 m), faîtage de la nef, pignon ouest, porche.
    along = lambda s: med(H(s, t) for t in rng(t0 - 1, t0 + 1))
    sx = mon["cross"]
    ridge = med(along(s) for s in rng(sx - 30, sx - 10))
    k0 = run(along, sx, -0.5, s_min, lambda z, zp: z < ridge + 4)
    k1 = run(along, sx, 0.5, s_max, lambda z, zp: z < ridge + 4)
    nave0 = run(along, k0 - 3, -0.5, s_min, lambda z, zp: z < ridge - 3)
    porch0 = run(along, s_min - 3, 0.5, nave0, lambda z, zp: z > 8)
    # Coupes en travers (médianes sur une plage de s) ; murs = chute de plus de 3 m entre deux échantillons, de part et d'autre de l'axe.
    def section(s0, s1):
        return lambda t: med(H(s, t) for s in rng(s0, s1))

    def walls(cut, tc, lim=25):
        return run(cut, tc, -0.5, tc - lim, lambda z, zp: zp - z > 3), run(cut, tc, 0.5, tc + lim, lambda z, zp: zp - z > 3)

    def eave(cut, tw, tr):
        """Droite du pan entre 1 m du mur et 1 m du faîtage, ramenée au mur tw."""
        ts = rng(min(tw, tr) + 1, max(tw, tr) - 1) if abs(tr - tw) > 2.5 else [tw + (tr - tw) * 0.3]
        if len(ts) < 2:
            return cut(ts[0])
        k, z0 = np.polyfit(ts, [cut(t) for t in ts], 1)
        return float(k * tw + z0)

    def vessel(cut, tc):
        tA, tB = walls(cut, tc)
        zr = max(cut(t) for t in rng(tA + 0.5, tB - 0.5))
        tr = (tA + tB) / 2
        return tA, tB, (eave(cut, tA, tr) + eave(cut, tB, tr)) / 2, zr

    pc = section(porch0 + 1, porch0 + 5)  # largeur à l'avant (en arrière, bas-côtés et tours la masquent)
    pA, pB = run(pc, t0, -0.5, t0 - 20, lambda z, zp: z < 8), run(pc, t0, 0.5, t0 + 20, lambda z, zp: z < 8)
    # Hauteurs du porche sur sa moitié arrière : à l'avant, une arête fine monte à 30 m le long du bord ouest (non identifiée).
    pk = section(nave0 - 5, nave0 - 1)
    pm = (pA + pB) / 2
    porch = [r2(porch0), r2(nave0), r2(pA), r2(pB), r2(g + (eave(pk, pA, pm) + eave(pk, pB, pm)) / 2), r2(g + max(pk(t) for t in rng(pA + 1, pB - 1)))]
    nc = section(nave0 + 3, k0 - 3)
    nA, nB, ne, nr = vessel(nc, t0)
    # Bas-côtés : appentis du mur de la nef au premier ressaut de plus d'1,5 m sur 1 m (côté ouest), même largeur de l'autre côté s'il n'y en a pas.
    widths = []
    for side, tw in ((-1, nA), (1, nB)):
        w = run(nc, tw + side * 1.5, side * 1.0, tw + side * 9, lambda z, zp: zp - z > 1.5)
        widths.append(abs(w - tw) if w is not None else None)
    aw = next(w for w in widths if w is not None)
    widths = [w if w is not None else aw for w in widths]
    aisles = [[r2(tw - side * 0 + side * w), r2(g + nc(tw + side * 0.75)), r2(g + nc(tw + side * (w - 0.5)))] for side, tw, w in ((-1, nA, widths[0]), (1, nB, widths[1]))]
    # Transept (pignons au bout des bras), bloc carré au bout du bras ouest (ressaut du profil), tour de croisée carrée centrée sur la flèche.
    row = lambda t: (lambda s: H(s, t))
    tA_ = aisles[1][0] - 2
    tr0 = run(lambda s: med(H(s, t) for t in rng(tA_ - 1, tA_ + 1)), sx, -0.5, nave0, lambda z, zp: z < aisles[1][1] - g + 3)
    tr1 = run(lambda s: med(H(s, t) for t in rng(tA_ - 1, tA_ + 1)), sx, 0.5, s_max, lambda z, zp: z < aisles[1][1] - g + 3)
    tc = section(tr0 + 1.5, tr1 - 1.5)
    tE = extent(tr0 + 1, tr1 - 1, 1)
    tW = extent(tr0 + 1, tr1 - 1, -1)
    armE = [t for t in rng(nB + 2, tE - 1)]
    # Ressaut du côté ouest : fin du bras (pan du transept), début du bloc.
    blk = run(tc, nA - 2, -0.5, tW + 1, lambda z, zp: zp - z > 3)
    arm_cut = lambda s: med(H(s, t) for t in armE)
    sm = (tr0 + tr1) / 2
    te = (eave(arm_cut, tr0, sm) + eave(arm_cut, tr1, sm)) / 2
    t_ridge = max(arm_cut(s) for s in rng(tr0 + 1, tr1 - 1))
    blk_cut = lambda s: med(H(s, t) for t in rng(tW + 2, blk - 2))
    blk_top = float(np.percentile([H(s, t) for s in rng(tr0 + 1, tr1 - 1) for t in rng(tW + 1, blk - 1)], 98))
    blk_eave = eave(blk_cut, tr0, sm)
    side = nB - nA - 2
    ring_t = [H(s, t) for s in rng(sx - side / 2 + 0.5, sx + side / 2 - 0.5) for t in (t0 - side / 2 + 0.75, t0 + side / 2 - 0.75)]
    ring_s = [H(s, t) for t in rng(t0 - side / 2 + 0.5, t0 + side / 2 - 0.5) for s in (sx - side / 2 + 0.75, sx + side / 2 - 0.75)]
    body = med(ring_t + ring_s)
    tip = max(H(s, t) for s in rng(sx - 2, sx + 2) for t in rng(t0 - 2, t0 + 2))
    # Flèche (D129) : rayon de l'octogone de même aire que les cellules au-dessus de z, droite en z entre 8 m au-dessus de la tour et 6 m
    # sous la pointe (au-dessous, gâbles et clochetons l'élargissent), ramenée au haut de la tour.
    spire_cells = [H(s, t) for s in rng(sx - 9, sx + 9) for t in rng(t0 - 9, t0 + 9)]
    zs = np.arange(body + 8, tip - 6, 1.0)
    radii = [math.sqrt(sum(z_ > z for z_ in spire_cells) * 0.25 / (2 * math.sqrt(2))) for z in zs]
    kr, r0 = np.polyfit(zs, radii, 1)
    spire_r = float(kr * body + r0)
    # Chœur et abside : coupe derrière la croisée ; abside en demi-polygone de rayon la demi-largeur, au bout de l'emprise (le toit déborde
    # au-delà) ; corniche de l'abside = toit relevé à 75 cm du mur, sur l'axe.
    cc = section(tr1 + 1, tr1 + 7)
    cA, cB, ce, cr = vessel(cc, t0)
    r = (cB - cA) / 2
    end = min(s_max, run(along, k1 + 2, 0.5, s_max + 2, lambda z, zp: zp - z > 3))
    sc = end - r
    ae = along(end - 0.75)
    choir_aisles = [[r2(extent(tr1 + 1, sc - 1, side)), r2(g + cc(tw + side * 0.75)), r2(g + cc(tw + side * 3))] for side, tw in ((-1, cA), (1, cB))]
    # Chapelles le long des bas-côtés, par travée : débord de l'emprise, haut médian.
    bays = spec["bays"]
    p = (tr0 - nave0) / bays
    chapels = []
    for i in range(bays):
        s0, s1 = nave0 + i * p, nave0 + (i + 1) * p
        row_ = [r2(s0), r2(s1)]
        for k, (sd, a_) in enumerate(((-1, aisles[0]), (1, aisles[1]))):
            out = extent(s0 + 0.5, s1 - 0.5, sd)
            if abs(out - a_[0]) < 1:
                row_ += [r2(a_[0]), 0]
            else:
                row_ += [r2(out), r2(g + med(H(s, t) for s in rng(s0 + 0.5, s1 - 0.5) for t in rng(min(a_[0], out) + 0.5, max(a_[0], out) - 0.5)))]
        chapels.append(row_)
    # Tourelle au coin du bloc et du bas-côté du chœur (photo du chevet) : point le plus haut juste derrière le transept, centre = moyenne des
    # cellules à moins de 1,5 m de ce haut ; côté d'après la photo.
    win = [(s, t, H(s, t)) for s in rng(tr1 + 0.25, tr1 + 4) for t in rng(blk - 2.5, blk + 2.5)]
    top = max(z for *_, z in win)
    hi = [(s, t) for s, t, z in win if z > top - 1.5]
    turret = [r2(med(q[0] for q in hi)), r2(med(q[1] for q in hi)), spec["turret"], r2(g + top)]
    # Entrée (D132) : parvis = terrain médian sur la largeur de la façade 2,5 m devant elle ; palier sous le porche = parvis + les trois
    # marches de la photo (48 cm) ; seuil des portes = sol du bâtiment (BD TOPO : le relevé ne voit pas sous le porche).
    mnt = Raster("MNT", bid, *box)
    t_ext = [t for t in rng(pA - 5, pB + 5, 0.5)]
    z_parvis = med(mnt(*xy(porch0 - 2.5, t)) - g for t in t_ext)
    entry = [r2(g + z_parvis), r2(g + z_parvis + spec["entrySteps"] * 0.16), r2(g)]
    tw = spec["towers"]
    return {
        "entry": entry,
        "c": [r2(cx), r2(cy)], "a": a, "t0": r2(t0), "g": r2(g),
        "porch": porch,
        "towers": [r2(min(tw["w"], pA - extent(porch0 + 0.5, nave0 - 0.5, -1))), r2(min(tw["w"], extent(porch0 + 0.5, nave0 - 0.5, 1) - pB)), r2(g + tw["body"]), r2(g + tw["tip"])],
        "nave": [r2(nave0), r2(tr0), r2(nA), r2(nB), r2(g + ne), r2(g + nr)],
        "aisles": aisles, "chapels": chapels,
        "transept": [r2(tr0), r2(tr1), r2(tW), r2(tE), r2(g + te), r2(g + t_ridge)],
        "block": [r2(blk), r2(g + blk_eave), r2(g + blk_top)],
        "tower": [r2(sx), r2(side), r2(g + body), r2(g + tip), r2(spire_r)],
        "spire": [r2(g + body + spec["spire"]["pinnacles"]), spec["spire"]["gables"]],
        "choir": [r2(sc), r2(cA), r2(cB), r2(g + ce), r2(g + cr)],
        "choirAisles": choir_aisles,
        "apse": [r2(r), r2(g + ae), spec["apse"]],
        "turret": turret,
    }


def measure_fountain(spec, f, a):
    """Fontaine (D131) : centre de l'édicule (cellules à plus de 2 m au-dessus du sol, à moins de 3 m du point OpenStreetMap), sol (médiane du
    terrain à 3,5-4,5 m), haut (point le plus haut), rayon du bassin (premier rayon où la médiane du relevé sur le cercle retombe à moins
    de 10 cm du sol). Orientation : celle du bâtiment `align` (l'axe de la cathédrale)."""
    x, y = f["x"], f["y"]
    key = "fountain_" + str(f["id"])
    mns = Raster("MNS", key, math.floor(x - 12), math.floor(y - 12), math.ceil(x + 12), math.ceil(y + 12))
    mnt = Raster("MNT", key, math.floor(x - 12), math.floor(y - 12), math.ceil(x + 12), math.ceil(y + 12))
    ring = [(x + r * math.cos(th), y + r * math.sin(th)) for r in (3.5, 4.0, 4.5) for th in np.arange(0, 2 * math.pi, math.pi / 16)]
    g = float(np.median([mnt(*q) for q in ring]))
    cells = [(x + dx, y + dy, mns(x + dx, y + dy) - g) for dx in np.arange(-3, 3.01, 0.25) for dy in np.arange(-3, 3.01, 0.25) if dx * dx + dy * dy <= 9]
    hi = [q for q in cells if q[2] > 2]
    cx, cy = float(np.mean([q[0] for q in hi])), float(np.mean([q[1] for q in hi]))
    top = max(q[2] for q in cells)
    rb = next(float(r) for r in np.arange(1.5, 6, 0.25)
              if np.median([mns(cx + r * math.cos(th), cy + r * math.sin(th)) - g for th in np.arange(0, 2 * math.pi, math.pi / 24)]) < 0.1)
    r2 = lambda v: round(float(v), 2)
    return {"t": "fountain", "st": spec["style"], "n": f["name"], "x": r2(cx), "y": r2(cy), "a": round(a, 4), "id": f["id"],
            "g": r2(g), "top": r2(g + top), "rb": r2(rb)}


def fountain(name, spec, world, kinds_mon):
    """Écrit le site `fountain` dans kinds/<tuile de la fontaine>.json (le même identifiant OpenStreetMap remplace l'ancien) et le compte
    des sites de kinds/index.json. Vrai si le fichier change."""
    for m in world["tiles"]:
        path = c.OUT / "tiles" / f"{m['id']}.json"
        if not path.exists():
            continue
        tile = json.loads(path.read_text())
        f = next((q for q in tile.get("furniture", []) if q["id"] == spec["osm"]), None)
        if f:
            break
    else:
        print(f"  monument : {name} absent du mobilier")
        return False
    tid = m["id"]
    site = measure_fountain(spec, f, kinds_mon(spec["align"])["a"])
    print(f"  {name} : {site['n']}, haut {site['top'] - site['g']:.1f} m, bassin de {site['rb']} m de rayon")
    kp = KINDS / f"{tid}.json"
    k = json.loads(kp.read_text()) if kp.exists() else {"v": 1, "buildings": {}, "sites": []}
    sites = [q for q in k["sites"] if not (q.get("t") == "fountain" and q.get("id") == site["id"])] + [site]
    if sites == k["sites"]:
        return False
    k["sites"] = sites
    kp.write_text(json.dumps(k, ensure_ascii=False, separators=(",", ":")))
    index = json.loads((KINDS / "index.json").read_text())
    n = sum(1 for t in index["tiles"] + ([tid] if tid not in index["tiles"] else [])
            for q in json.loads((KINDS / f"{t}.json").read_text())["sites"] if q.get("t") == "fountain")
    index["stats"]["sites"]["fountain"] = n
    if tid not in index["tiles"]:
        index["tiles"] = sorted(index["tiles"] + [tid])
    (KINDS / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    return True


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
    changed, changed_lod = set(), set()
    kinds = {}

    def kinds_mon(bid):
        tid = found[bid][0]
        return kinds.setdefault(tid, json.loads((KINDS / f"{tid}.json").read_text()))["buildings"][bid]["mon"]

    for bid, spec in manual.items():
        if spec["model"] == "fountain":
            if fountain(bid, spec, world, kinds_mon):
                print(f"  site de {bid} réécrit")
            continue
        if bid not in found:
            print(f"  monument : {bid} absent des tuiles")
            continue
        tid, b = found[bid]
        k = kinds.setdefault(tid, json.loads((KINDS / f"{tid}.json").read_text()))
        if spec["model"] == "cathedral":
            if cathedral(tid, bid, b, spec, k):
                changed.add(tid)
            continue
        if spec["model"] != "townhall":
            raise SystemExit(f"{bid} : modèle inconnu {spec['model']}")
        hall = measure_hall(bid, b, spec)
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
        if lod_silhouette(tid, bid, hall):
            changed_lod.add(tid)
    for tid in changed:
        (KINDS / f"{tid}.json").write_text(json.dumps(kinds[tid], ensure_ascii=False, separators=(",", ":")))
    print(f"{len(manual)} monument(s) d'après photo ; {len(changed)} fichier(s) de types et {len(changed_lod)} de silhouettes réécrit(s)")


def cathedral(tid, bid, b, spec, k):
    """Cathédrale (D127) : champ `cath` du bâtiment, clocher lointain (`tower` et repère de kinds/index.json) à la tour et à la flèche
    mesurées, silhouette lointaine ; `mon` (repère, build_kinds.py) est gardé. Vrai si kinds/<tuile>.json change."""
    e = dict(k["buildings"][bid])
    cath = measure_cathedral(bid, b, spec, e["mon"])
    e["cath"] = cath
    sx, side, body, tip, _ = cath["tower"]
    ca, sa = math.cos(cath["a"]), math.sin(cath["a"])
    t0 = cath["t0"]
    e["tower"] = [round(cath["c"][0] + ca * sx - sa * t0, 2), round(cath["c"][1] + sa * sx + ca * t0, 2), side, body, tip]
    g = cath["g"]
    print(f"  {bid} : porche {cath['porch'][5] - g:.1f} m, nef {cath['nave'][4] - g:.1f} / {cath['nave'][5] - g:.1f} m,"
          f" transept {cath['transept'][4] - g:.1f} / {cath['transept'][5] - g:.1f} m, chœur {cath['choir'][3] - g:.1f} / {cath['choir'][4] - g:.1f} m,"
          f" tour de croisée {body - g:.1f} m, flèche {tip - g:.1f} m")
    index = json.loads((KINDS / "index.json").read_text())
    marks = [dict(m, t=e["tower"]) if m["id"] == bid else m for m in index["landmarks"]]
    if marks != index["landmarks"]:
        index["landmarks"] = marks
        (KINDS / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    if lod_cathedral(tid, bid, cath):
        print(f"  silhouette lointaine de {bid} réécrite")
    if k["buildings"][bid] == e:
        return False
    k["buildings"][bid] = e
    return True


def lod_cathedral(tid, bid, m):
    """Silhouette lointaine de la cathédrale : porche et tours, nef, bas-côtés, transept et bloc, tour de croisée, chœur et abside, bas-côtés
    du chœur, chacun avec son égout et son haut (la flèche reste le clocher lointain). Vrai si lod/<tuile>.json est réécrit."""
    ca, sa = math.cos(m["a"]), math.sin(m["a"])
    xy = lambda s, t: [round(m["c"][0] + ca * s - sa * t, 1), round(m["c"][1] + sa * s + ca * t, 1)]
    rect = lambda s0, s1, t0, t1: [(s0, t0), (s1, t0), (s1, t1), (s0, t1)]
    p0, p1, pA, pB, pe, pr = m["porch"]
    w0, w1, tb, tt = m["towers"]
    n0, n1, nA, nB, ne, nr = m["nave"]
    tr0, tr1, tW, tE, te, trr = m["transept"]
    blk, be, bt = m["block"]
    sx, side, body, *_ = m["tower"]
    sc, cA, cB, ce, cr = m["choir"]
    r, ae, _ = m["apse"]
    c0 = m["t0"]
    out = [min(q[2] for q in m["chapels"]), max(q[4] for q in m["chapels"])]
    polys = [(rect(p0, n0, pA, pB), pe, pr), (rect(p0, p0 + w0, pA - w0, pA), tb, tt), (rect(p0, p0 + w1, pB, pB + w1), tb, tt),
             (rect(n0, tr0, nA, nB), ne, nr), (rect(p0 + max(w0, w1), tr0, out[0], nA), m["aisles"][0][2], m["aisles"][0][1]),
             (rect(p0 + max(w0, w1), tr0, nB, out[1]), m["aisles"][1][2], m["aisles"][1][1]),
             (rect(tr0, tr1, blk, tE), te, trr), (rect(tr0, tr1, tW, blk), be, bt),
             (rect(sx - side / 2, sx + side / 2, c0 - side / 2, c0 + side / 2), body, body),
             ([(tr1, cA), (sc, cA), *[(sc + r * math.sin(math.pi * i / 4), c0 - r * math.cos(math.pi * i / 4)) for i in range(1, 4)], (sc, cB), (tr1, cB)], max(ce, ae), cr),
             (rect(tr1, sc, m["choirAisles"][0][0], cA), m["choirAisles"][0][2], m["choirAisles"][0][1]),
             (rect(tr1, sc, cB, m["choirAisles"][1][0]), m["choirAisles"][1][2], m["choirAisles"][1][1])]
    return replace_lod(tid, bid, [([xy(*q) for q in pts], e, top) for pts, e, top in polys])


def replace_lod(tid, bid, polys):
    """Remplace les prismes du bâtiment (même clé) dans lod/<tuile>.json par `polys` (contour en [x, y], égout, haut), à la place du premier ;
    le reste du fichier est inchangé. Vrai si réécrit."""
    path = LOD / f"{tid}.json"
    if not path.exists():
        return False
    lod = json.loads(path.read_text())
    key = zlib.crc32(bid.encode())
    mine = [e for e in lod if e["k"] == key]
    if not mine:
        return False
    base = {k: v for k, v in mine[0].items() if k not in ("r", "e", "g")}
    new = [{"r": [v for q in pts for v in q], "e": round(e, 1), "g": round(g, 1), **base} for pts, e, g in polys]
    if mine == new:
        return False
    i = lod.index(mine[0])
    rest = [e for e in lod if e["k"] != key]
    path.write_text(json.dumps(rest[:i] + new + rest[i:], separators=(",", ":")))
    return True


def lod_silhouette(tid, bid, h):
    """Silhouette lointaine (lod/<tuile>.json) : le prisme unique du bâtiment devient corps principal, pavillons et ailes basses, chacun
    avec son égout et son haut ; les entrées du bâtiment (même clé) sont remplacées, le reste du fichier est inchangé. Vrai si réécrit."""
    a, (ox, oy) = h["a"], h["o"]
    ca, sa = math.cos(a), math.sin(a)
    xy = lambda s, t: [round(ox + ca * s - sa * t, 1), round(oy + sa * s + ca * t, 1)]
    R = [(h["ring"][i], h["ring"][i + 1]) for i in range(0, len(h["ring"]), 2)]
    d = h["d"]
    edge = lambda p0, p1, t: p0[0] + (p1[0] - p0[0]) * t / p1[1]
    sL, sR = (lambda t: edge(R[0], R[-1], t)), (lambda t: edge(R[1], R[2], t))
    polys = [([(0, 0), (h["l"], 0), (sR(d), d), (sL(d), d)], h["eave"], h["ridge"]),
             ([(sL(d), d), (sR(d), d), *R[2:]], h["wingEave"], h["wingRidge"])]
    for s0, s1, *_rest, top in h["pav"]:
        a0 = sL(0) if s0 < 0.05 else s0
        a1 = sR(0) if s1 > h["l"] - 0.05 else s1
        b0 = sL(d) if s0 < 0.05 else s0
        b1 = sR(d) if s1 > h["l"] - 0.05 else s1
        polys.append(([(a0, -0.35), (a1, -0.35), (b1, d), (b0, d)], h["eave"], top))
    return replace_lod(tid, bid, [([xy(*q) for q in pts], e, g) for pts, e, g in polys])


if __name__ == "__main__":
    main()
