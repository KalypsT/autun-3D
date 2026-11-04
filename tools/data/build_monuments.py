"""Monuments modélisés d'après photo (hôtel de ville D123, théâtre municipal D223, gare D228, parc des expositions l'Eduen D231, cathédrale D127, fontaine Saint-Lazare D131, théâtre romain D133, portes romaines D137, temple de Janus D139, maison du 7 allée de l'Acaron D140) : volumes mesurés au LiDAR, dessinés à pans nets par le client.

Usage : python3 tools/data/build_monuments.py [modèle]      (après build_kinds.py, qui réécrit public/data/kinds ; puis relancer celle-ci)
Entrées : `monuments` de tools/data/manual.json (lecture des photos de l'utilisateur : façade principale, travées, pavillons, niveaux),
          tiles/*.json (emprise BD TOPO), modèles de surface et de terrain LiDAR HD de l'IGN (WMS, fenêtre autour du bâtiment, 0,5 m,
          gardée dans .cache/shared/raw/monuments).
Sortie : kinds/<tuile>.json, champ `hall` du bâtiment (repère, contour et cour dans ce repère, hauteurs mesurées) ; `sign: false` retire
          l'inscription (`n`) ; cathédrale (modèle `cathedral`, D127) : champ `cath`, clocher lointain (`tower` et kinds/index.json) ;
          silhouettes lointaines (lod/<tuile>.json) ; fontaine (modèle `fountain`, D131) : site `fountain` de la tuile où elle se trouve ;
          théâtre romain (modèle `theatre`, D133) : site `theatre`, bâtiment BD TOPO masqué ; revêtement des pistes (`tracks`, D133) ;
          portes romaines (modèle `gate`, D137, D138) : champ `gm` du site `gate` (écrit par build_kinds.py) et silhouette lointaine ;
          église accolée à une porte (modèle `chapel`, D138) : champ `chap` du bâtiment et silhouette lointaine ;
          temple de Janus (modèle `janus`, D139) : site `janus` (kinds/<tuile>.json créé au besoin) et silhouette lointaine ;
          Pierre de Couhard (modèle `couhard`, D222) : site `couhard` mesuré sur le nuage LiDAR (lu à distance), relief fin aplani sous le pied
          (terrain/<tuile>.bin) et silhouette lointaine ;
          maison (modèle `house`, D140) : type « house » et champ `house` du bâtiment (plan en L et toit mesurés), silhouette lointaine ;
          collège du Vallon (modèle `vallon`, D172, relevés de survey_college.py) : champ `vallon` du bâtiment (ailes à toit plat, gymnase, préau) et silhouette lointaine ;
          terrains du collège du Vallon (`pitches`, D176) : revêtement, rectangle de jeu et paniers de basket des sites `pitch` de kinds ;
          théâtre municipal (modèle `playhouse`, D223) : champ `play` du bâtiment (murs, toit brisé du corps avant, cage de scène, fronton D224, perron mesuré au relief D225) et silhouette lointaine ;
          gare (modèle `station`, D228) : champ `sta` du bâtiment (ailes, pavillon et frontons, retour vers le parvis) et silhouette lointaine ;
          quais de la gare (`quai` de son entrée, D229) : champ `quai` de `sta`, quais 1 et central de structures/<tuile>.json redessinés au bord
          mesuré (à relancer après build_structures.py), bâtiment BD TOPO de l'abri parapluie masqué ;
          parc des expositions l'Eduen (modèle `eduen`, D231) : champ `edu` du bâtiment (salle, blocs, édicules, hall courbe et annexe), bâtiments
          BD TOPO du hall et des blocs masqués (`hide`), silhouette lointaine ;
          Hexagone (modèle `hexagone`, D165-D168) : champ `hex` du bâtiment (pyramide à 12 pans, couronne de six terrasses, façades, mobilier du parvis) et silhouette lointaine.
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
import sys
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


def measure_playhouse(bid, b, spec):
    """Théâtre municipal (D223) : murs, toit brisé à croupes du corps avant et cage de scène à deux pans, lus sur le modèle de surface.

    Repère : façade tournée vers `faces` (arête BD TOPO la plus longue de ce côté) ; s le long de la façade, de gauche à droite vu de la place,
    t vers l'intérieur. Bords = là où le modèle de surface passe au-dessus de mi-hauteur (corniche comprise), murs `cornice` mètres en dedans.
    """
    ring = pairs(b["ring"])
    if area(ring) < 0:
        ring = ring[::-1]
    n = len(ring)
    th = math.radians(COMPASS[spec["faces"]])
    best = None
    for i in range(n):
        (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]
        ln = math.hypot(bx - ax, by - ay)
        if ln < 1:
            continue
        nx, ny = (by - ay) / ln, -(bx - ax) / ln  # normale sortante (contour trigonométrique)
        if nx * math.cos(th) + ny * math.sin(th) > math.cos(math.radians(30)) and (best is None or ln > best[0]):
            best = (ln, ax, ay, (bx - ax) / ln, (by - ay) / ln)
    if best is None:
        raise SystemExit(f"{bid} : aucun mur tourné vers {spec['faces']}")
    _, ox, oy, ux, uy = best
    vx, vy = -uy, ux
    st = lambda p: ((p[0] - ox) * ux + (p[1] - oy) * uy, (p[0] - ox) * vx + (p[1] - oy) * vy)
    xy = lambda s, t: (ox + ux * s + vx * t, oy + uy * s + vy * t)
    R = [st(p) for p in ring]
    smin, smax = min(p[0] for p in R), max(p[0] for p in R)
    tmin, tmax = min(p[1] for p in R), max(p[1] for p in R)
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    box = (math.floor(min(xs) - MARGIN), math.floor(min(ys) - MARGIN), math.ceil(max(xs) + MARGIN), math.ceil(max(ys) + MARGIN))
    mns, mnt = Raster("MNS", bid, *box), Raster("MNT", bid, *box)
    S = lambda s, t: mns(*xy(s, t))
    r2 = lambda v: round(float(v), 2)
    mid = (smin + smax) / 2
    # Sol devant la façade, hors du perron (tiers central).
    g0 = float(np.median([mnt(*xy(s, t)) for s in np.arange(smin, smax, 0.5) for t in (tmin - 4, tmin - 5, tmin - 6)
                          if abs(s - mid) > (smax - smin) / 3]))
    hot = lambda s, t: S(s, t) > g0 + 8
    first = lambda f, a, b_, d: next((float(x) for x in np.arange(a, b_, d) if f(x)), None)
    # Façade : premier passage au-dessus du seuil en venant de la place (médiane sur les deux tiers du milieu).
    tf = float(np.median([first(lambda t: hot(s, t), tmin - 6, tmax, 0.25) for s in np.arange(smin + 3, smax - 3, 0.5)]))
    # Arrière : la cage de scène dépasse de loin les bâtiments accolés derrière elle (seuil à 16 m).
    tr = float(np.median([first(lambda t: S(s, t) < g0 + 16, tf + 15, tmax + 6, 0.25) for s in np.arange(smin + 3, smax - 3, 0.5)]))
    # Côtés, ligne par ligne : bord gauche et droit.
    rows = np.arange(tf + 0.5, tr - 0.4, 0.5)
    left = [first(lambda s: hot(s, t), smin - 6, smax, 0.25) for t in rows]
    right = [first(lambda s: hot(s, t), smax + 6, smin, -0.25) for t in rows]
    near = rows < tf + 4
    farr = rows > tf + 10
    lF, lR = float(np.median(np.array(left)[near])), float(np.median(np.array(left)[farr]))
    rF, rR = float(np.median(np.array(right)[near])), float(np.median(np.array(right)[farr]))
    # Ressaut des côtés : fin du retour des pavillons (premier rang où les deux bords sont passés à mi-chemin).
    ts = float(next(t for t, a, b_ in zip(rows, left, right) if t > tf + 2 and a > (lF + lR) / 2 and b_ < (rF + rR) / 2))
    c = spec["cornice"]
    s0 = lF + c  # origine : coin gauche de la façade
    W = rF - lF - 2 * c
    iL, iR = lR - lF, rF - rR  # retrait des côtés derrière le ressaut
    sm = (lR + rR) / 2
    # Corps avant : haut de l'attique (juste derrière la façade, hors du milieu), profil en travers (toit brisé), faîtage.
    eave = float(np.median([S(s, t) for s in np.arange(lF + 1, rF - 1, 0.5) if abs(s - mid) > 3.5 for t in (tf + 0.5, tf + 0.75, tf + 1.0)]))
    # Fronton central de l'attique (photo : panneau à l'inscription sous un fronton cintré) : haut = 90e centile du modèle de surface sur
    # 2 m de large au milieu de la façade, dans le premier mètre derrière le bord.
    sc = (lF + rF) / 2
    fronton = float(np.percentile([S(s, t) for s in np.arange(sc - 1.0, sc + 1.01, 0.25) for t in np.arange(tf + 0.25, tf + 1.26, 0.25)], 90))
    # Perron (relief du MNT devant l'avant-corps) : palier = terrain contre le mur, sol = terrain 6 à 8 m devant, pied = premier point revenu
    # à 10 cm du sol, largeur = terrain au-dessus du quart de la hauteur, à mi-volée.
    tw = tf + c
    Tm = lambda t: float(np.median([mnt(*xy(s, t)) for s in np.arange(sc - 3, sc + 3.01, 0.5)]))
    zl = float(np.median([Tm(t) for t in np.arange(tw - 0.75, tw - 0.24, 0.25)]))
    far = float(np.median([Tm(t) for t in np.arange(tw - 8, tw - 5.99, 0.5)]))
    tfoot = first(lambda t: Tm(t) < far + 0.1, tw - 0.5, tw - 12, -0.25)
    tmid = (tw + tfoot) / 2
    inside = [float(s_) for s_ in np.arange(sc - 12, sc + 12.01, 0.25) if mnt(*xy(s_, tmid)) > far + 0.25 * (zl - far)]
    perron = [r2(min(inside) - s0), r2(max(inside) - s0), r2(tfoot - tw), r2(far), r2(zl)]
    # Cage de scène : sur l'axe, le toit monte d'un coup ; le corps avant s'arrête là.
    prof_t = np.arange(tf + 4, tr, 0.25)
    near_wall = [float(np.median([S(lR + 1.5, t), S(rR - 1.5, t)])) for t in prof_t]
    tower_eave_guess = float(np.median(near_wall[-12:]))
    tt = float(next(t for t, z in zip(prof_t, near_wall) if z > (tower_eave_guess + eave) / 2 + 0.5))
    band = np.arange(ts + 1.5, tt - 1.5, 0.5)
    half = np.arange(0.25, (rR - lR) / 2, 0.25)
    profile = np.array([np.median([S(lR + d, t) for t in band] + [S(rR - d, t) for t in band]) for d in half])
    ridge = float(profile.max())
    lo = (half >= 1.0) & (half <= 4.5)
    k1, z1 = np.polyfit(half[lo], profile[lo], 1)
    dr = float(half[int(np.argmax(profile))])
    up = (half >= dr - 3.0) & (half <= dr - 0.5)
    k2, z2 = np.polyfit(half[up], profile[up], 1)
    brk = (z2 - z1) / (k1 - k2)
    # Cage de scène : deux pans le long de t, faîtage sur l'axe.
    tband = np.arange(tt + 1.5, tr - 1.5, 0.5)
    tp = np.array([np.median([S(lR + d, t) for t in tband] + [S(rR - d, t) for t in tband]) for d in half])
    tridge = float(tp.max())
    tl = (half >= 1.0) & (half <= float(half[int(np.argmax(tp))]) - 1.0)
    k3, z3 = np.polyfit(half[tl], tp[tl], 1)
    out = {
        "o": [r2(xy(s0, tf + c)[0]), r2(xy(s0, tf + c)[1])], "a": round(math.atan2(uy, ux), 5),
        "w": r2(W), "ts": r2(ts - tf - 2 * c), "iL": r2(iL), "iR": r2(iR), "tt": r2(tt - tf - c), "tr": r2(tr - tf - c),
        "g": r2(g0), "eave": r2(eave),
        "roof": [r2(z1 + k1 * c), r2(brk - c), r2(z1 + k1 * brk), r2(ridge)],
        "tower": [r2(z3 + k3 * c), r2(tridge)], "fronton": r2(fronton), "perron": perron,
        "levels": spec["levels"], "pav": spec["pav"],
    }
    return out


def playhouse(tid, bid, b, spec, k):
    """Théâtre municipal (D223) : champ `play` du bâtiment et silhouette lointaine. Rend (kinds changé, lod changé)."""
    m = measure_playhouse(bid, b, spec)
    e = dict(k["buildings"].get(bid, {"k": "culture"}))
    e["play"] = m
    g = m["g"]
    print(f"  {bid} : façade {m['w']} m, ressaut à {m['ts']} m, cage de scène de {m['tt']} à {m['tr']} m ; attique {m['eave'] - g:.1f} m,"
          f" toit brisé {m['roof'][2] - g:.1f} m à {m['roof'][1]:.1f} m du mur, faîtage {m['roof'][3] - g:.1f} m ;"
          f" cage {m['tower'][0] - g:.1f} / {m['tower'][1] - g:.1f} m, fronton {m['fronton'] - g:.1f} m au-dessus du sol devant ;"
          f" perron de {m['perron'][1] - m['perron'][0]:.1f} m de large, {-m['perron'][2]:.1f} m de profondeur, palier à {m['perron'][4] - m['perron'][3]:.2f} m")
    ch = k["buildings"].get(bid) != e
    if ch:
        k["buildings"][bid] = e
    ca, sa = math.cos(m["a"]), math.sin(m["a"])
    xy = lambda s, t: [round(m["o"][0] + ca * s - sa * t, 1), round(m["o"][1] + sa * s + ca * t, 1)]
    W, ts, iL, iR, tt, tr = m["w"], m["ts"], m["iL"], m["iR"], m["tt"], m["tr"]
    rect = lambda a0, a1, b0, b1: [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
    polys = [(rect(0, W, 0, ts), m["eave"], m["eave"]), (rect(iL, W - iR, ts, tt), m["eave"], m["roof"][3]),
             (rect(iL, W - iR, tt, tr), m["tower"][0], m["tower"][1])]
    lod = replace_lod(tid, bid, [([xy(*q) for q in pts], e_, top) for pts, e_, top in polys])
    return ch, tid if lod else None


def measure_station(bid, b, spec):
    """Gare (D228) : ailes basses à croupes, pavillon central à deux niveaux (toit à croupes, frontons sur les deux faces), aile en retour
    vers le parvis au bout est, lus sur le modèle de surface. Le contour BD TOPO est décalé d'environ 1,2 m vers les voies : il ne sert qu'au
    repère (arête la plus longue tournée vers `faces`, le parvis) et à la fenêtre de lecture.

    Repère : s le long de la façade sur le parvis, de gauche à droite vu du parvis ; t vers l'intérieur (les voies). Bords des toits = passage
    du modèle de surface au-dessus d'un seuil, médianes sur les tronçons dégagés ; murs `overhang` (ailes) et `cornice` (pavillon) en dedans.
    """
    ring = pairs(b["ring"])
    if area(ring) < 0:
        ring = ring[::-1]
    n = len(ring)
    th = math.radians(COMPASS[spec["faces"]])
    best = None
    for i in range(n):
        (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]
        ln = math.hypot(bx - ax, by - ay)
        if ln < 1:
            continue
        nx, ny = (by - ay) / ln, -(bx - ax) / ln  # normale sortante (contour trigonométrique)
        if nx * math.cos(th) + ny * math.sin(th) > math.cos(math.radians(30)) and (best is None or ln > best[0]):
            best = (ln, ax, ay, (bx - ax) / ln, (by - ay) / ln)
    if best is None:
        raise SystemExit(f"{bid} : aucun mur tourné vers {spec['faces']}")
    _, ox, oy, ux, uy = best
    vx, vy = -uy, ux
    st = lambda p: ((p[0] - ox) * ux + (p[1] - oy) * uy, (p[0] - ox) * vx + (p[1] - oy) * vy)
    xy = lambda s, t: (ox + ux * s + vx * t, oy + uy * s + vy * t)
    R = [st(p) for p in ring]
    smin, smax = min(p[0] for p in R), max(p[0] for p in R)
    tmin, tmax = min(p[1] for p in R), max(p[1] for p in R)
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    box = (math.floor(min(xs) - MARGIN), math.floor(min(ys) - MARGIN), math.ceil(max(xs) + MARGIN), math.ceil(max(ys) + MARGIN))
    mns, mnt = Raster("MNS", bid, *box), Raster("MNT", bid, *box)
    S = lambda s, t: mns(*xy(s, t))
    r2 = lambda v: round(float(v), 2)
    med = lambda v: float(np.median(v))
    # Corps le long des voies : la bande de t où l'arête BD TOPO de la façade est droite (hors du retour, qui part vers le parvis).
    tb0 = min(p[1] for p in R if p[0] < smin + 1)  # façade de l'aile ouest (BD TOPO)
    tb1 = max(p[1] for p in R if p[0] < smin + 1)  # côté voies
    tmid = (tb0 + tb1) / 2
    # Sol du parvis devant l'aile ouest (hors des tilleuls : l'aile est longée par l'allée, les arbres sont plus loin).
    g0 = med([mnt(*xy(s, t)) for s in np.arange(smin + 2, smin + 15, 0.5) for t in (tb0 - 2.5, tb0 - 3.5)])
    edge = lambda f, a, b_, d, thr: next((float(x) for x in np.arange(a, b_, d) if f(x) < thr), None)
    low = g0 + 2.5
    # Ailes : bords avant et arrière du toit, de l'intérieur vers l'extérieur, sur des tronçons hors du pavillon et du retour.
    wing_s = [s for s in np.arange(smin + 2, smax - 2, 0.5)]
    fr, bk = [], []
    for s in wing_s:
        if S(s, tmid) > g0 + 8.6 or S(s, tmid) < g0 + 6:  # pavillon, ou hors du toit
            continue
        a_ = edge(lambda t: S(s, t), tmid, tmid - 8, -0.25, low)
        b_ = edge(lambda t: S(s, t), tmid, tmid + 8, 0.25, low)
        if a_ is not None and b_ is not None:
            fr.append(a_)
            bk.append(b_)
    tF, tB = med(fr), med(bk)
    tc = (tF + tB) / 2
    # Bouts du corps : ouest et est sur l'axe.
    sW = edge(lambda s: S(s, tc), smin + 6, smin - 8, -0.25, low)
    sE = edge(lambda s: S(s, tc), smax - 6, smax + 8, 0.25, low)
    # Pavillon : plus haut que le faîtage des ailes. Repérage grossier sur l'axe, puis bords à mi-hauteur de la marche entre l'égout des ailes
    # et la corniche du pavillon, sur des lignes juste derrière les murs (là où les ailes sont au plus bas).
    hiP = g0 + 8.6
    p0 = edge(lambda s: -S(s, tc), sW + 1, sE, 0.25, -hiP)
    p1 = edge(lambda s: -S(s, tc), sE - 1, sW, -0.25, -hiP)
    pm = (p0 + p1) / 2
    cols = lambda a_, b_: [s for s in np.arange(a_ + 1, b_ - 1, 0.5) if abs(s - pm) > 4.6]  # hors des frontons
    rough = med([S(s, t) for s in cols(p0, p1) for t in (tF + 1, tB - 1)])
    mid_t = lambda zz: (med([edge(lambda t: S(s, t), tc, tc - 9, -0.25, zz) for s in cols(p0, p1)]),
                       med([edge(lambda t: S(s, t), tc, tc + 9, 0.25, zz) for s in cols(p0, p1)]))
    pT0, pT1 = mid_t(g0 + (rough - g0) / 2)
    rowsP = [t for t in np.arange(tF + 0.4, tF + 1.6, 0.25)] + [t for t in np.arange(tB - 1.6, tB - 0.4, 0.25)]
    wing_lo = med([S(s, t) for s in np.arange(sW + 5, p0 - 5, 0.5) for t in rowsP])
    thrP = (wing_lo + rough) / 2
    pS0 = med([edge(lambda s: S(s, t), pm, sW, -0.25, thrP) for t in rowsP])
    pS1 = med([edge(lambda s: S(s, t), pm, sE, 0.25, thrP) for t in rowsP])
    pm = (pS0 + pS1) / 2
    # Retour vers le parvis au bout est : bords en s sur des lignes devant la façade, bout en t sur son axe.
    rowsR = np.arange(tF - 12, tF - 3, 0.5)
    rl = [edge(lambda s: -S(s, t), sE - 10, sE, 0.25, -low) for t in rowsR]  # les tilleuls du parvis sont plus à l'ouest
    rS0 = med([x for x in rl if x is not None])
    rm = (rS0 + sE) / 2
    rT = edge(lambda t: S(rm, t), tF - 3, tF - 30, -0.25, low)
    # Hauteurs : ailes (profil en travers, médiane sur les tronçons dégagés), pavillon, frontons.
    clear = [s for s in wing_s if sW + 4 < s < pS0 - 4 or pS1 + 4 < s < rS0 - 4]  # ailes hors des croupes, du pavillon et du retour
    halves = np.arange(0.25, (tB - tF) / 2, 0.25)
    prof = np.array([med([S(s, tc - h) for s in clear] + [S(s, tc + h) for s in clear]) for h in halves])
    ridge = float(prof.max())
    sl = (halves >= 1.0) & (halves <= (tB - tF) / 2 - 1.0)
    k1, z1 = np.polyfit(halves[sl], prof[sl], 1)
    oh, c = spec["overhang"], spec["cornice"]
    D = tB - tF - 2 * oh
    eave = z1 + k1 * (D / 2)  # égout au droit du mur
    pc = med([S(s, t) for s in cols(pS0, pS1) for t in (pT0 + 1.0, pT1 - 1.0)])  # haut de la corniche du pavillon
    along = np.arange(pS0, pS1, 0.25)
    rz = [S(s, tc) for s in along]
    pr_top = float(np.percentile(rz, 95))
    flat = [s for s, z in zip(along, rz) if z > pr_top - 0.2]
    ped = med([S(s, t) for s in np.arange(pm - 0.5, pm + 0.6, 0.25) for t in (pT0 + 1.0, pT1 - 1.0)])
    # Demi-largeur du fronton : là où la ligne derrière la façade du pavillon dépasse la corniche de 30 cm.
    hw = med([pm - edge(lambda s: S(s, t), pm, pS0, -0.25, pc + 0.3) for t in (pT0 + 1.0, pT1 - 1.0)]
             + [edge(lambda s: S(s, t), pm, pS1, 0.25, pc + 0.3) - pm for t in (pT0 + 1.0, pT1 - 1.0)])
    hw *= (ped - pc) / (ped - pc - 0.3)  # demi-largeur à la base du fronton (rampants droits)
    s0 = sW + oh  # origine : coin ouest de la façade des ailes sur le parvis
    t0 = tF + oh
    loc = lambda s: r2(s - s0)
    out = {
        "o": [r2(xy(s0, t0)[0]), r2(xy(s0, t0)[1])], "a": round(math.atan2(uy, ux), 5),
        "l": loc(sE - oh), "d": r2(D),
        "pav": [loc(pS0 + c), loc(pS1 - c), r2(pT0 + c - t0), r2(pT1 - c - t0)],
        "ret": [loc(rS0 + oh), r2(rT + oh - t0)],
        "g": r2(g0), "eave": r2(eave), "ridge": r2(ridge),
        "pv": [r2(pc), r2(pr_top), loc(min(flat)), loc(max(flat))], "ped": [r2(hw), r2(ped)],
        "bays": spec["bays"], "levels": spec["levels"],
    }
    return out


def measure_station_quais(tid, m, spec, k):
    """Quais de la gare (D229), dans le repère de la gare (s le long des voies, t vers elles) : bord des quais 1 et central lu sur le modèle
    de terrain (le relief porte déjà les quais, à la hauteur du parvis : les contours OpenStreetMap, décalés comme l'emprise BD TOPO et posés
    55 cm plus haut, sont redessinés au bord mesuré, le quai 1 jusqu'au mur), toit de l'abri parapluie du quai central lu sur le modèle de
    surface (le bâtiment BD TOPO qui le représentait est masqué). La marquise, translucide, n'apparaît pas au LiDAR : `marquise` de la photo.
    Rend (champ `quai` du modèle, contours des quais en coordonnées du monde, identifiant du bâtiment masqué)."""
    q = spec["quai"]
    a, (ox, oy) = m["a"], m["o"]
    ca, sa = math.cos(a), math.sin(a)
    xy = lambda s, t: (ox + ca * s - sa * t, oy + sa * s + ca * t)
    st = lambda x, y: ((x - ox) * ca + (y - oy) * sa, -(x - ox) * sa + (y - oy) * ca)
    path = c.OUT / "structures" / f"{tid}.json"
    struct = json.loads(path.read_text())
    plats = []
    for i, p in enumerate(struct["platforms"]):
        r0_ = p["osm"][0] if "osm" in p else p["r"]  # contour OpenStreetMap d'origine (gardé à côté du quai redessiné)
        P = [st(r0_[j], r0_[j + 1]) for j in range(0, len(r0_), 2)]
        plats.append((i, P, sum(v[1] for v in P) / len(P)))
    near = [x for x in plats if -60 < min(v[0] for v in x[1]) and max(v[0] for v in x[1]) < m["l"] + 120 and m["d"] < x[2] < m["d"] + 25]
    near.sort(key=lambda x: x[2])
    if len(near) < 2:
        raise SystemExit("gare : quais 1 et central introuvables dans les ouvrages")
    (i1, P1, _), (i2, P2, _) = near[0], near[1]
    S0 = min(v[0] for v in P1 + P2) - 2
    S1 = max(v[0] for v in P1 + P2) + 2
    corners = [xy(S0, m["d"] - 2), xy(S1, m["d"] - 2), xy(S1, m["d"] + 32), xy(S0, m["d"] + 32)]
    box = (math.floor(min(p[0] for p in corners)), math.floor(min(p[1] for p in corners)), math.ceil(max(p[0] for p in corners)), math.ceil(max(p[1] for p in corners)))
    mnt, mns = Raster("MNT", "gare-quais", *box), Raster("MNS", "gare-quais", *box)
    G = lambda s, t: mnt(*xy(s, t))
    med = lambda v: float(np.median(v))
    r2 = lambda v: round(float(v), 2)

    def centre(P, s):
        """Milieu en t du contour OpenStreetMap à l'abscisse s (None hors du quai)."""
        ts = []
        for j in range(len(P)):
            (sa_, ta), (sb, tb) = P[j], P[(j + 1) % len(P)]
            if (sa_ - s) * (sb - s) <= 0 and sa_ != sb:
                ts.append(ta + (tb - ta) * (s - sa_) / (sb - sa_))
        return (min(ts) + max(ts)) / 2 if len(ts) >= 2 else None

    def edge(s, t0, dirn, thr):
        for t in np.arange(t0, t0 + dirn * 9, dirn * 0.25):
            if G(s, t) < thr:
                return float(t) - dirn * 0.125
        return None

    # Quai 1 : du mur de la gare (prolongé à l'ouest et à l'est) au bord mesuré.
    s1a, s1b = min(v[0] for v in P1), max(v[0] for v in P1)
    outer = []
    for s in np.arange(s1a, s1b + 0.01, (s1b - s1a) / max(1, round((s1b - s1a) / 4))):
        top = med([G(s, t) for t in np.arange(m["d"] + 0.5, m["d"] + 2.5, 0.25)])
        low = min(G(s, t) for t in np.arange(m["d"] + 3, m["d"] + 10, 0.25))
        e = edge(s, m["d"] + 1.5, 1, (top + low) / 2) if top - low > 0.25 else None
        if e is not None:
            outer.append((float(s), e))
    # Médiane glissante sur trois points : le bord mesuré au pas de 0,25 m tremble de ±0,4 m.
    smooth = lambda pts: [(x, med([p[1] for p in pts[max(0, j - 1):j + 2]])) for j, (x, _) in enumerate(pts)]
    outer = smooth(outer)
    ring1 = [(outer[0][0], m["d"])] + outer + [(outer[-1][0], m["d"])]
    # Quai central : bords des deux côtés du milieu OpenStreetMap.
    s2a, s2b = min(v[0] for v in P2), max(v[0] for v in P2)
    lo, hi = [], []
    for s in np.arange(s2a + 0.5, s2b - 0.49, (s2b - s2a - 1) / max(1, round((s2b - s2a) / 4))):
        cm = centre(P2, s)
        if cm is None:
            continue
        top = med([G(s, t) for t in np.arange(cm - 1, cm + 1.01, 0.25)])
        low = min(G(s, t) for t in np.arange(cm - 9, cm + 9, 0.25))
        if top - low < 0.25:
            continue
        a_, b_ = edge(s, cm, -1, (top + low) / 2), edge(s, cm, 1, (top + low) / 2)
        if a_ is not None and b_ is not None:
            lo.append((float(s), a_))
            hi.append((float(s), b_))
    lo, hi = smooth(lo), smooth(hi)
    ring2 = lo + hi[::-1]
    w1 = med([t - m["d"] for _, t in outer])
    w2 = med([b_ - a_ for (_, a_), (_, b_) in zip(lo, hi)])
    # Abri parapluie : toit au-dessus de 2,2 m dans l'emprise BD TOPO élargie de 4 m.
    sid = q["shelter"]
    tile = json.loads((c.OUT / "tiles" / f"{tid}.json").read_text())
    sb_ = next(x for x in tile["buildings"] if x["id"] == sid)
    R = [st(sb_["ring"][j], sb_["ring"][j + 1]) for j in range(0, len(sb_["ring"]), 2)]
    rs0, rs1 = min(v[0] for v in R), max(v[0] for v in R)
    rt0, rt1 = min(v[1] for v in R), max(v[1] for v in R)
    H = lambda s, t: mns(*xy(s, t)) - m["g"]
    ms, mt = (rs0 + rs1) / 2, (rt0 + rt1) / 2
    scan = lambda f, x0, d: next(float(x) - d / 2 for x in np.arange(x0, x0 + 40 * np.sign(d), d) if f(x) < 2.2)
    sh_s0 = med([scan(lambda s: H(s, t), ms, -0.25) for t in np.arange(mt - 2, mt + 2.01, 0.5)])
    sh_s1 = med([scan(lambda s: H(s, t), ms, 0.25) for t in np.arange(mt - 2, mt + 2.01, 0.5)])
    sh_t0 = med([scan(lambda t: H(s, t), mt, -0.25) for s in np.arange(ms - 5, ms + 5.01, 0.5)])
    sh_t1 = med([scan(lambda t: H(s, t), mt, 0.25) for s in np.arange(ms - 5, ms + 5.01, 0.5)])
    rim = med([H(s, t) for s in np.arange(sh_s0 + 2, sh_s1 - 2, 0.5) for t in (sh_t0 + 0.75, sh_t1 - 0.75)])
    crown = float(np.percentile([H(s, t) for s in np.arange(sh_s0 + 2, sh_s1 - 2, 0.5) for t in np.arange(sh_t0 + 1, sh_t1 - 1, 0.25)], 95))
    top2 = med([G(s, t) for s, t in [(x, (a_ + b_) / 2) for (x, a_), (_, b_) in zip(lo, hi)] if sh_s0 < s < sh_s1]) - m["g"]
    near_t = lambda pts, s: min(pts, key=lambda p: abs(p[0] - s))[1]  # bord mesuré le plus proche de l'abscisse s
    out = {
        "plat": [r2(w1), r2(w2), r2(top2)],
        "mq": q["marquise"],
        "sh": [r2(sh_s0), r2(sh_s1), r2(sh_t0), r2(sh_t1), r2(m["g"] + rim), r2(m["g"] + crown)],
        "cross": [r2(sh_s0 + q["cross"]), r2(near_t(outer, sh_s0 + q["cross"])), r2(near_t(lo, sh_s0 + q["cross"]))],
        "glass": [q["glass"], r2((near_t(lo, q["glass"]) + near_t(hi, q["glass"])) / 2)],
        "edges": [r2(med([t for _, t in outer])), r2(med([t for _, t in lo]))],
    }
    rings = {i1: [v for p in ring1 for v in (round(xy(*p)[0], 2), round(xy(*p)[1], 2))],
             i2: [v for p in ring2 for v in (round(xy(*p)[0], 2), round(xy(*p)[1], 2))]}

    def lift(ring):
        """Hauteur du quai au-dessus du plus haut de ses sommets (le jeu pose la dalle là) : assez pour couvrir le relief à l'intérieur."""
        top_v = max(G(*p) for p in ring)
        inside = [G(s, t) for (s, ta), (_, tb) in zip(ring[1:len(ring) // 2], ring[::-1][1:len(ring) // 2]) for t in np.linspace(ta, tb, 6)[1:-1]]
        return r2(max(0.03, max(inside) - top_v + 0.06))
    inner1 = [(x, (m["d"] + t) / 2) for x, t in outer]  # milieu du quai 1, entre le mur et le bord
    hs = {i1: r2(max(0.03, max(G(*p) for p in inner1 + outer) - max(G(*p) for p in ring1) + 0.06)), i2: lift(ring2)}
    return out, rings, hs, path, struct, sid


def measure_station_parvis(m, spec):
    """Parvis de la gare (D230), dans le repère de la gare : mobilier lu sur les photos et l'orthophotographie (`parvis` de l'entrée), abri de
    parking en bois mesuré au LiDAR (cellules de 1,3 à 4,9 m au-dessus du sol autour du point donné ; rectangle orienté, réduit du flou du
    relevé, et plan du toit ajusté en trois passes à 25 cm). Rend le champ `parvis` du modèle."""
    from scipy import ndimage
    from shapely.geometry import MultiPoint

    pv = dict(spec["parvis"])
    pv.pop("hide", None)
    a, (ox, oy) = m["a"], m["o"]
    ca, sa = math.cos(a), math.sin(a)
    xy = lambda s, t: (ox + ca * s - sa * t, oy + sa * s + ca * t)
    cs, ct = pv.pop("carport")
    corners = [xy(cs - 14, ct - 14), xy(cs + 14, ct - 14), xy(cs + 14, ct + 14), xy(cs - 14, ct + 14)]
    box = (math.floor(min(p[0] for p in corners)), math.floor(min(p[1] for p in corners)), math.ceil(max(p[0] for p in corners)), math.ceil(max(p[1] for p in corners)))
    mns, mnt = Raster("MNS", "gare-abri", *box), Raster("MNT", "gare-abri", *box)
    ss, tt = np.arange(cs - 11, cs + 11, 0.5), np.arange(ct - 11, ct + 11, 0.5)
    M = np.array([[mns(*xy(s, t)) for s in ss] for t in tt])
    H = M - np.array([[mnt(*xy(s, t)) for s in ss] for t in tt])
    mask = ndimage.binary_opening((H > 1.3) & (H < 4.9), iterations=1)
    lab, n = ndimage.label(mask)
    j0, i0 = np.unravel_index(np.argmin((ss[None, :] - cs) ** 2 + (tt[:, None] - ct) ** 2 + np.where(mask, 0, 1e6)), mask.shape)
    jj, ii = np.where(lab == lab[j0, i0])
    P = [(float(ss[i]), float(tt[j])) for j, i in zip(jj, ii)]
    cc = list(MultiPoint(P).minimum_rotated_rectangle.exterior.coords)[:4]
    A = np.c_[[p[0] for p in P], [p[1] for p in P], np.ones(len(P))]
    z = M[jj, ii]
    keep = np.ones(len(P), bool)
    for _ in range(3):
        co = np.linalg.lstsq(A[keep], z[keep], rcond=None)[0]
        keep = np.abs(z - A @ co) < 0.25
    zc = lambda p: co[0] * p[0] + co[1] * p[1] + co[2]
    # Bord bas : le grand côté dont le milieu est le plus bas ; origine à son bout, u le long de lui, w vers l'intérieur.
    sides = [(cc[k], cc[(k + 1) % 4]) for k in range(4)]
    longs = [sd for sd in sides if math.dist(*sd) >= max(math.dist(*q) for q in sides) - 1e-6] or sides
    p0, p1 = min(longs, key=lambda sd: zc(((sd[0][0] + sd[1][0]) / 2, (sd[0][1] + sd[1][1]) / 2)))
    L = math.dist(p0, p1)
    u = ((p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L)
    W = min(math.dist(*sd) for sd in sides)
    inward = (-u[1], u[0]) if zc((p0[0] - u[1], p0[1] + u[0])) > zc(p0) else (u[1], -u[0])
    shrink = 0.25
    o = (p0[0] + u[0] * shrink + inward[0] * shrink, p0[1] + u[1] * shrink + inward[1] * shrink)
    L, W = L - 2 * shrink, W - 2 * shrink
    lo, hi = zc(o) , zc((o[0] + inward[0] * W, o[1] + inward[1] * W))
    r2 = lambda v: round(float(v), 2)
    pv["carport"] = [r2(o[0]), r2(o[1]), round(math.atan2(u[1], u[0]), 4), round(1 if inward == (-u[1], u[0]) else -1), r2(L), r2(W), r2(lo), r2(hi)]
    return pv


def station(tid, bid, b, spec, k):
    """Gare (D228) : champ `sta` du bâtiment et silhouette lointaine. Rend (kinds changé, lod changé)."""
    m = measure_station(bid, b, spec)
    hid = False
    if "quai" in spec:
        m["quai"], rings, hs, spath, struct, sid = measure_station_quais(tid, m, spec, k)
        qd = m["quai"]
        print(f"  quais : quai 1 de {qd['plat'][0]} m depuis le mur, quai central de {qd['plat'][1]} m (dessus à {qd['plat'][2]:+.2f} m du parvis) ;"
              f" abri parapluie de {qd['sh'][1] - qd['sh'][0]:.1f} × {qd['sh'][3] - qd['sh'][2]:.1f} m, rive {qd['sh'][4] - m['g']:.1f} m,"
              f" faîte {qd['sh'][5] - m['g']:.1f} m ; dalles relevées de {', '.join(str(v) for v in hs.values())} m")
        # Quais redessinés au bord mesuré, au niveau du relief (qui les porte déjà), sans l'abri générique (D229).
        new_p = [dict(p) for p in struct["platforms"]]
        for i, r in rings.items():
            p = struct["platforms"][i]
            new_p[i] = {"r": r, "h": hs[i], "bare": 1, "osm": p.get("osm", [p["r"], p["h"]])}
        if new_p != struct["platforms"]:
            struct["platforms"] = new_p
            spath.write_text(json.dumps(struct, separators=(",", ":")))
            print(f"  ouvrages {tid} : quais 1 et central réécrits")
        # L'abri parapluie est dessiné par la gare : le bâtiment BD TOPO qui le représentait est masqué.
        if k["buildings"].get(sid) != {"k": "hidden"}:
            k["buildings"][sid] = {"k": "hidden"}
            hid = True
    if "parvis" in spec:
        m["parvis"] = measure_station_parvis(m, spec)
        # L'abri de parking est dessiné par la gare : le bâtiment BD TOPO qui le figurait (une boîte à porte) est masqué.
        hide = spec["parvis"].get("hide")
        if hide and k["buildings"].get(hide) != {"k": "hidden"}:
            k["buildings"][hide] = {"k": "hidden"}
            hid = True
        c_ = m["parvis"]["carport"]
        print(f"  parvis : abri de parking de {c_[4]} × {c_[5]} m, bord bas {c_[6] - m['g']:.2f} m, haut {c_[7] - m['g']:.2f} m au-dessus du parvis")
    e = dict(k["buildings"].get(bid, {"k": "station"}))
    e["sta"] = m
    g = m["g"]
    p = m["pav"]
    print(f"  sol du parvis {g:.2f}")
    print(f"  {bid} : corps de {m['l']} × {m['d']} m (égout {m['eave'] - g:.1f}, faîtage {m['ridge'] - g:.1f}) ; pavillon de {p[1] - p[0]:.1f} × "
          f"{p[3] - p[2]:.1f} m à {p[0]} m (corniche {m['pv'][0] - g:.1f}, faîtage {m['pv'][1] - g:.1f}, fronton {m['ped'][1] - g:.1f} m, "
          f"demi-largeur {m['ped'][0]} m) ; retour de {m['l'] - m['ret'][0]:.1f} m jusqu'à {m['ret'][1]} m")
    ch = k["buildings"].get(bid) != e or hid
    if ch:
        k["buildings"][bid] = e
    ca, sa = math.cos(m["a"]), math.sin(m["a"])
    xy = lambda s, t: [round(m["o"][0] + ca * s - sa * t, 1), round(m["o"][1] + sa * s + ca * t, 1)]
    rect = lambda a0, a1, b0, b1: [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
    L, D = m["l"], m["d"]
    polys = [(rect(0, L, 0, D), m["eave"], m["ridge"]), (rect(m["ret"][0], L, m["ret"][1], 0), m["eave"], m["ridge"]),
             (rect(p[0], p[1], p[2], p[3]), m["pv"][0], m["pv"][1])]
    lod = replace_lod(tid, bid, [([xy(*q) for q in pts], e_, top) for pts, e_, top in polys])
    return ch, tid if lod else None


CANOPY_H = 2.8  # Eduen : un « bloc » plus bas est l'auvent de l'entrée côté parking (dalle sur poteaux)


def measure_eduen(bid, b, spec):
    """Parc des expositions l'Eduen (D231) : grande salle à toit plat (acrotère, lanterneaux), blocs bas en béton le long des deux grands
    côtés (édicules techniques sur leurs toits), hall en quart de cercle contre le petit côté sud-est (toit-auvent courbe qui déborde de
    `overhang` devant le mur), annexe plus basse au nord du hall. Tout est lu sur le modèle de surface : le contour BD TOPO (décalé
    d'environ 1 m vers le nord-ouest) ne sert qu'à la fenêtre de lecture et au premier repérage de l'arc.

    Repère : origine au coin ouest de la salle (mur), s le long du grand côté sur la route de Chalon (`faces`), vers le sud-est ; t vers
    l'intérieur (le parking). Murs de la salle = passage à mi-hauteur entre le toit du hall et l'acrotère, médianes sur les lignes.
    """
    from scipy import ndimage

    ring = pairs(b["ring"])
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    box = (math.floor(min(xs) - 25), math.floor(min(ys) - 25), math.ceil(max(xs) + 25), math.ceil(max(ys) + 25))
    mns, mnt = Raster("MNS", bid, *box), Raster("MNT", bid, *box)
    r2 = lambda v: round(float(v), 2)
    med = lambda v: float(np.median(v))
    # Sol : terrain médian autour de l'emprise ; la salle = cellules à plus de 9 m au-dessus (le hall courbe s'arrête vers 8 m).
    g0 = med([mnt(x, y) for x in np.arange(box[0] + 5, box[2] - 5, 2.0) for y in np.arange(box[1] + 5, box[3] - 5, 2.0)])
    gx, gy = np.arange(box[0] + 1, box[2] - 1, 0.5), np.arange(box[1] + 1, box[3] - 1, 0.5)
    hi = np.array([[mns(x, y) - mnt(x, y) > 9.0 for x in gx] for y in gy])
    lab, n = ndimage.label(hi)
    big = np.argmax(np.bincount(lab.ravel())[1:]) + 1  # la salle, pas les arbres
    jj, ii = np.where(lab == big)
    P = np.c_[gx[ii], gy[jj]]
    # Rectangle d'aire minimale des cellules hautes : direction du grand côté.
    best = None
    for deg in np.arange(0, 180, 0.1):
        th = math.radians(deg)
        su = P @ np.array([math.cos(th), math.sin(th)])
        tv = P @ np.array([-math.sin(th), math.cos(th)])
        ar = (su.max() - su.min()) * (tv.max() - tv.min())
        if (su.max() - su.min()) >= (tv.max() - tv.min()) and (best is None or ar < best[0]):
            best = (ar, th)
    th = best[1]
    ux, uy = math.cos(th), math.sin(th)
    # t vers l'intérieur depuis la façade `faces` : la normale gauche (-uy, ux) doit tourner le dos à `faces`.
    fx, fy = math.cos(math.radians(COMPASS[spec["faces"]])), math.sin(math.radians(COMPASS[spec["faces"]]))
    if -uy * fx + ux * fy > 0:
        ux, uy = -ux, -uy
    vx, vy = -uy, ux
    cx, cy = P.mean(axis=0)
    xy = lambda s, t: (cx + ux * s + vx * t, cy + uy * s + vy * t)
    H = lambda s, t: mns(*xy(s, t))
    su, tv = (P - (cx, cy)) @ (ux, uy), (P - (cx, cy)) @ (vx, vy)
    s_lo, s_hi, t_lo, t_hi = su.min(), su.max(), tv.min(), tv.max()
    edge = lambda f, a, b_, d, thr: next((float(x) for x in np.arange(a, b_, d) if f(x) < thr), None)
    roof_mid = med([H(s, t) for s in np.linspace(s_lo + 5, s_hi - 5, 25) for t in np.linspace(t_lo + 5, t_hi - 5, 15)])
    thr = g0 + 0.8 * (roof_mid - g0)
    sm, tm = (s_lo + s_hi) / 2, (t_lo + t_hi) / 2
    # Le rectangle d'aire minimale tourne d'un demi-degré selon la grille : on redresse l'axe sur les droites des deux grands murs.
    for _ in range(3):
        cs_ = np.arange(s_lo + 3, s_hi - 3, 1.0)
        k0 = np.polyfit(cs_, [edge(lambda t: H(s, t), tm, t_lo - 6, -0.05, thr) for s in cs_], 1)[0]
        k1 = np.polyfit(cs_, [edge(lambda t: H(s, t), tm, t_hi + 6, 0.05, thr) for s in cs_], 1)[0]
        dth = math.atan((k0 + k1) / 2)
        ux, uy = ux * math.cos(dth) - uy * math.sin(dth), ux * math.sin(dth) + uy * math.cos(dth)
        vx, vy = -uy, ux
    rows = np.arange(t_lo + 2, t_hi - 2, 0.5)
    cols = np.arange(s_lo + 2, s_hi - 2, 0.5)
    S0 = med([edge(lambda s: H(s, t), sm, s_lo - 6, -0.125, thr) for t in rows]) + 0.0625
    S1 = med([edge(lambda s: H(s, t), sm, s_hi + 6, 0.125, thr) for t in rows]) - 0.0625
    T0 = med([edge(lambda t: H(s, t), tm, t_lo - 6, -0.125, thr) for s in cols]) + 0.0625
    T1 = med([edge(lambda t: H(s, t), tm, t_hi + 6, 0.125, thr) for s in cols]) - 0.0625
    ox, oy = xy(S0, T0)
    L, D = S1 - S0, T1 - T0
    xy = lambda s, t: (ox + ux * s + vx * t, oy + uy * s + vy * t)
    H = lambda s, t: mns(*xy(s, t))
    G = lambda s, t: mnt(*xy(s, t))
    # Acrotère : haut des cellules du bord ; toit : médiane de l'intérieur ; lanterneaux : bosses de plus de 25 cm sur le toit lissé.
    rim = [H(s, t) for s in np.arange(1, L - 1, 1.0) for t in (0.25, D - 0.25)] + [H(s, t) for t in np.arange(1, D - 1, 1.0) for s in (0.25, L - 0.25)]
    top = float(np.percentile(rim, 75))
    gs, gt = np.arange(2, L - 2, 0.25), np.arange(2, D - 2, 0.25)
    R = np.array([[H(s, t) for s in gs] for t in gt])
    bump = R - ndimage.median_filter(R, size=17)
    lab, n = ndimage.label(bump > 0.15)
    sky, sizes = [], []
    for k in range(1, n + 1):
        ii, jj = np.where(lab == k)
        if len(ii) < 5:
            continue
        sky.append([r2(gs[jj].mean()), r2(gt[ii].mean())])
        sizes.append(((jj.max() - jj.min() + 1) * 0.25 + (ii.max() - ii.min() + 1) * 0.25) / 2)
    sky.sort()
    roof = med(R[np.abs(bump) < 0.1])
    # Blocs bas des deux grands côtés : bouts (s) lus une fois sur le modèle de surface (`blocks` de l'entrée, côté route `sw` et côté parking
    # `ne`) ; profondeur = médiane, sur les colonnes du bloc, du premier passage sous 1,6 m au-dessus du terrain depuis le mur ; toit =
    # 30ᵉ centile du modèle de surface sur le bloc (les édicules n'en couvrent qu'une partie), hors de la bande de 1,25 m où le relevé bave
    # depuis le mur de la salle.
    blocks, units = [], []
    for side, key in ((-1, "sw"), (1, "ne")):
        t_wall = 0.0 if side < 0 else D
        for s0, s1 in spec["blocks"][key]:
            deps, zs = [], []
            for s in np.arange(s0 + 0.5, s1 - 0.4, 0.5):
                run_ = 0.0
                for w in np.arange(0.25, 9, 0.25):
                    t = t_wall + side * w
                    if H(s, t) - G(s, t) < 1.6:
                        break
                    run_ = w
                    if w > 1.25:
                        zs.append(H(s, t))
                deps.append(run_ + 0.125)
            depth = med(deps)
            z = float(np.percentile(zs, 30))
            t0, t1 = sorted((t_wall, t_wall + side * depth))
            blocks.append([r2(s0), r2(s1), r2(t0), r2(t1), r2(z)])
            # Édicules : cellules à plus de 0,7 m au-dessus du toit du bloc, à plus de 1,25 m du mur de la salle (le relevé y bave), d'au
            # moins 1,2 m de côté (les panneaux d'affichage plaqués sur les blocs sont plus minces) et de moins de 45 % du toit du bloc.
            bs, bt = np.arange(s0 + 0.125, s1, 0.25), np.arange(t0 + 0.125, t1, 0.25)
            B = np.array([[H(s, t) if abs(t - t_wall) > 1.25 else -1e9 for s in bs] for t in bt])
            ul, un = ndimage.label(B > z + 0.7)
            for k in range(1, un + 1):
                ii, jj = np.where(ul == k)
                ws, wt = (jj.max() - jj.min() + 1) * 0.25, (ii.max() - ii.min() + 1) * 0.25
                if len(ii) < 16 or min(ws, wt) < 1.2 or ws * wt > 0.45 * (s1 - s0) * (t1 - t0) or z - g0 < CANOPY_H:  # rien sur l'auvent
                    continue
                units.append([r2(bs[jj.min()] - 0.125), r2(bs[jj.max()] + 0.125), r2(bt[ii.min()] - 0.125), r2(bt[ii.max()] + 0.125),
                              r2(np.percentile(B[ii, jj], 75))])
    # Hall courbe : bord de l'auvent sur des lignes de t, en partant du mur de la salle (au nord du bord sud de l'annexe, en partant du bout
    # de l'annexe), passage sous le toit du hall moins 2 m ; cercle ajusté sur ces points. Toit du hall : médiane près du mur de la salle.
    sA, tA = spec["annex"]
    zr = med([H(L + 3, t) for t in np.arange(D * 0.4, D - 1, 0.5)])
    pts = []
    for t in np.arange(2, tA + 10, 0.5):
        s_in = L + 1 if t < tA - 0.5 else sA + 1.5
        if H(s_in, t) < zr - 2.0:
            continue
        s_ = edge(lambda s: H(s, t), s_in, s_in + 40, 0.1, zr - 2.0)
        if s_ is not None:
            pts.append((s_ - 0.05, t))
    Q = np.array(pts)
    M = np.c_[2 * Q, np.ones(len(Q))]
    k_ = np.linalg.lstsq(M, (Q ** 2).sum(1), rcond=None)[0]
    cc = k_[:2]
    rc = math.sqrt(k_[2] + cc @ cc)
    res = np.hypot(Q[:, 0] - cc[0], Q[:, 1] - cc[1]) - rc
    keep = np.abs(res) < 0.6  # un arbre ou un mât devant l'auvent
    k_ = np.linalg.lstsq(M[keep], (Q[keep] ** 2).sum(1), rcond=None)[0]
    cc = k_[:2]
    rc = math.sqrt(k_[2] + cc @ cc)
    # Bord nord-est de l'auvent : droite ajustée sur les passages en t (lignes de s entre l'annexe et l'arc).
    ne = []
    for s in np.arange(sA + 1.5, cc[0] + rc - 4, 0.5):
        t_ = edge(lambda t: H(s, t), D + 2, D + 40, 0.1, zr - 2.0)
        if t_ is not None:
            ne.append((s, t_))
    ne = np.array(ne)
    kk, bb = np.polyfit(ne[:, 0], ne[:, 1], 1)
    ang = [math.atan2(t - cc[1], s - cc[0]) for s, t in Q[keep]]
    zfa = float(np.percentile([H(*(cc + np.array([math.cos(a), math.sin(a)]) * (rc - 0.4))) for a in np.linspace(min(ang), max(ang), 40)], 75))
    za = med([H(s, t) for s in np.arange(L + 1.5, sA - 1, 0.5) for t in np.arange(tA + 1, kk * s + bb - spec["overhang"] - 1.5, 0.5)])
    return {
        "o": [r2(ox), r2(oy)], "a": round(math.atan2(uy, ux), 5), "l": r2(L), "d": r2(D), "g": r2(g0),
        "top": r2(top), "roof": r2(roof),
        "sky": sky, "skyW": r2(min(2.4, max(1.2, med(sizes)))) if sizes else 1.6,
        "blocks": blocks, "units": units,
        "rot": {"c": [r2(cc[0]), r2(cc[1])], "r": r2(rc), "ov": spec["overhang"], "ne": [r2(kk), r2(bb)], "roof": r2(zr), "fascia": r2(zfa),
                "ann": [sA, tA, r2(za)]},
    }


def eduen(tid, bid, b, spec, k):
    """Parc des expositions l'Eduen (D231) : champ `edu` du bâtiment et silhouette lointaine. Rend (kinds changé, lod changé)."""
    m = measure_eduen(bid, b, spec)
    e = dict(k["buildings"].get(bid, {"k": "culture"}))
    e["edu"] = m
    g, r = m["g"], m["rot"]
    print(f"  sol {g:.2f} ; salle de {m['l']} × {m['d']} m, acrotère {m['top'] - g:.1f} m, toit {m['roof'] - g:.1f} m, {len(m['sky'])} lanterneaux "
          f"de {m['skyW']} m ; hall : auvent de rayon {r['r']} m (centre {r['c']}), toit {r['roof'] - g:.1f} m, rive {r['fascia'] - g:.1f} m, "
          f"annexe {r['ann'][2] - g:.1f} m")
    for q in m["blocks"]:
        print(f"    bloc s {q[0]}..{q[1]} t {q[2]}..{q[3]} : {q[4] - g:.1f} m")
    print(f"    {len(m['units'])} édicules")
    ch = k["buildings"].get(bid) != e
    if ch:
        k["buildings"][bid] = e
    # Les bâtiments BD TOPO qui découpaient le hall courbe, l'annexe et un bloc sont dessinés par le modèle : masqués, sans silhouette.
    lod_hid = False
    for sid in spec.get("hide", []):
        if k["buildings"].get(sid) != {"k": "hidden"}:
            k["buildings"][sid] = {"k": "hidden"}
            ch = True
        lod_hid = replace_lod(tid, sid, []) or lod_hid
    ca, sa = math.cos(m["a"]), math.sin(m["a"])
    xy = lambda s, t: [round(m["o"][0] + ca * s - sa * t, 1), round(m["o"][1] + sa * s + ca * t, 1)]
    rect = lambda a0, a1, b0, b1: [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
    L, D = m["l"], m["d"]
    polys = [(rect(0, L, 0, D), m["top"], m["top"])]
    polys += [(rect(*q[:4]), q[4], q[4]) for q in m["blocks"]]
    polys.append(([(s, t) for s, t in eduen_canopy(m)], r["roof"], r["roof"]))
    lod = replace_lod(tid, bid, [([xy(*q) for q in pts], e_, top) for pts, e_, top in polys])
    return ch, tid if lod or lod_hid else None


def eduen_canopy(m):
    """Contour (s, t) du toit-auvent du hall courbe (le même calcul que le client, `eduenCanopy`) : du mur de la salle le long de l'arc
    jusqu'au bord nord-est, puis ce bord jusqu'au-dessus de l'annexe, et l'annexe contournée."""
    r = m["rot"]
    (cs, ct), R = r["c"], r["r"]
    k_, b_ = r["ne"]
    L, D = m["l"], m["d"]
    sA, tA, _ = r["ann"]
    a0 = math.atan2(-math.sqrt(max(0.0, R * R - (L - cs) ** 2)), L - cs)
    # Fin de l'arc : intersection avec la droite t = k·s + b (par dichotomie sur l'angle).
    lo, hi = a0, math.pi / 2
    f = lambda a: (ct + R * math.sin(a)) - (k_ * (cs + R * math.cos(a)) + b_)
    for _ in range(60):
        mid = (lo + hi) / 2
        if f(lo) * f(mid) <= 0:
            hi = mid
        else:
            lo = mid
    a1 = lo
    n = max(8, int((a1 - a0) / math.radians(3)))
    pts = [(L, ct + R * math.sin(a0))] + [(cs + R * math.cos(a0 + (a1 - a0) * i / n), ct + R * math.sin(a0 + (a1 - a0) * i / n)) for i in range(1, n + 1)]
    pts += [(sA, k_ * sA + b_), (sA, tA), (L, tA)]
    return [(round(s, 2), round(t, 2)) for s, t in pts]


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


def osm_way(wid):
    """Contour d'une voie OpenStreetMap (API officielle, gardée dans .cache), en coordonnées locales."""
    from pyproj import Transformer
    path = CACHE / f"osm_way_{wid}.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(fetch.get(f"https://api.openstreetmap.org/api/0.6/way/{wid}/full.json").text)
    els = json.loads(path.read_text())["elements"]
    nodes = {e["id"]: (e["lon"], e["lat"]) for e in els if e["type"] == "node"}
    way = next(e for e in els if e["type"] == "way")
    tr = Transformer.from_crs(4326, 2154, always_xy=True)
    return [(X - c.ORIGIN[0], Y - c.ORIGIN[1]) for X, Y in (tr.transform(*nodes[n]) for n in way["nodes"])]


def fit_circle(pts):
    P = np.array(pts)
    sol = np.linalg.lstsq(np.c_[2 * P, np.ones(len(P))], (P ** 2).sum(1), rcond=None)[0]
    return float(sol[0]), float(sol[1]), float(math.sqrt(sol[2] + sol[0] ** 2 + sol[1] ** 2))


def measure_theatre(bid, b, spec):
    """Théâtre romain (D133) : cavea adossée à la pente, mesurée sur des profils radiaux du relevé LiDAR.
    - centre et rayon de l'orchestre : cercle ajusté sur le pied des gradins (premier rayon où le terrain dépasse l'orchestre de 60 cm), sur
      les directions où la pente monte de plus de 8 m ; axe = direction moyenne de ces directions ; orchestre = médiane du terrain au centre ;
    - profil médian du modèle de surface (MNS) sur l'axe ± 50° (le terrain lissé gomme gradins et ruines) : haut des gradins restaurés et
      précinction (premier palier), début de la terrasse haute (second palier), arbres du sommet (MNS plus de 4 m au-dessus du terrain) ;
    - gradins restaurés : droite du MNS entre le pied et la précinction ; nombre de rangs d'après les photos ; étendue angulaire sur
      l'orthophotographie (pierre grise peu saturée entre les rayons 29 et 37 m) ;
    - coins de la partie haute entre les escaliers rayonnants (OpenStreetMap) : hauteurs médianes du MNS au pied, au début de la terrasse et au
      bord des arbres ; massifs ruinés des extrémités : profil médian tous les 3 m ;
    - scène moderne : contour OpenStreetMap, dessus = médiane du MNS, marches côté orchestre jusqu'où le MNS atteint le dessus.
    Tout en angles relatifs à l'axe (radians, positifs vers la gauche en regardant le fond de la cavea depuis l'orchestre)."""
    ring = pairs(b["ring"])
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    box = (math.floor(min(xs) - 50), math.floor(min(ys) - 50), math.ceil(max(xs) + 50), math.ceil(max(ys) + 50))
    mns, mnt = Raster("MNS", bid, *box), Raster("MNT", bid, *box)
    # Centre approché : cellules les plus basses dans l'emprise BD TOPO élargie de 10 m (l'orchestre).
    sub = mnt.a[50 * 2 - 20:-(50 * 2 - 20), 50 * 2 - 20:-(50 * 2 - 20)]
    rr, cc = np.nonzero(sub < float(np.nanmin(sub)) + 0.4)
    cx, cy = box[0] + 40 + (cc.mean() + 0.5) * c.RES, mnt.y1 - 40 - (rr.mean() + 0.5) * c.RES
    pol = lambda R, th: (cx + R * math.cos(th), cy + R * math.sin(th))
    for _ in range(4):
        # Orchestre : le demi-disque côté cavea (la scène et le pré occupent l'autre moitié, plus haut).
        zo = float(np.percentile([mnt(cx + dx, cy + dy) for dx in range(-18, 19, 2) for dy in range(-18, 19, 2) if dx * dx + dy * dy < 324], 25))
        feet, dirs = [], []
        for th in np.radians(np.arange(0, 360, 3)):
            rs = np.arange(5, 60, 0.25)
            z = np.array([mnt(*pol(R, th)) for R in rs])
            if z[-1] - zo < 8:
                continue
            dirs.append(th)
            feet.append(pol(float(rs[int(np.argmax(z > zo + 0.6))]), th))
        # Les bouts de la cavea sont ruinés : on ajuste sur les directions du milieu.
        ax = math.atan2(np.mean(np.sin(dirs)), np.mean(np.cos(dirs)))
        mid = [p for p, th in zip(feet, dirs) if abs(math.remainder(th - ax, 2 * math.pi)) < math.radians(65)]
        cx, cy, ro = fit_circle(mid)
    span = max(abs(math.remainder(th - ax, 2 * math.pi)) for th in dirs)
    P = lambda R, rel: (cx + R * math.cos(ax + rel), cy + R * math.sin(ax + rel))
    rels = np.radians(np.arange(-50, 50.1, 2))
    rs = np.arange(ro - 1, ro + 55, 0.5)
    S = np.array([np.median([mns(*P(R, u)) for u in rels]) for R in rs])
    T = np.array([np.median([mnt(*P(R, u)) for u in rels]) for R in rs])
    grad = np.gradient(S, 0.5)
    # Paliers : pente moyenne inférieure à 0,12 sur 1,5 m, prolongés tant qu'elle reste sous 0,2.
    def flat(after):
        for i in range(len(rs) - 3):
            if rs[i] > after and np.mean(grad[i:i + 3]) < 0.12 and max(grad[i:i + 3]) < 0.2:
                j = i
                while j < len(rs) - 1 and grad[j] < 0.2:
                    j += 1
                return i, j
        raise SystemExit(f"{bid} : palier introuvable après {after:.1f} m")
    i1, i2 = flat(ro + 5)
    r1, r2, zp = float(rs[i1]), float(rs[i2]), float(np.median(S[i1:i2]))
    i3, _ = flat(r2 + 5)
    r3 = float(rs[i3])
    r4 = float(next(rs[i] for i in range(i3, len(rs)) if S[i] - T[i] > 4)) - 0.5
    r5 = float(next(rs[i] for i in range(len(rs) - 1) if rs[i] > r4 and T[i + 1] - T[i] < 0.02))
    z5 = float(T[list(rs).index(r5)])
    lower = (rs > ro + 0.75) & (rs < r1 - 0.25)
    slope, icpt = np.polyfit(rs[lower], S[lower], 1)
    n = spec["rows"]
    rw0 = ro + spec.get("podium", 0.5)
    dr = (r1 - rw0) / n
    rows = [n, rw0, r1, float(icpt + slope * (rw0 + dr / 2)), zp]
    # Étendue des gradins restaurés sur l'orthophotographie (0,25 m).
    from PIL import Image
    ox0, oy0, ox1, oy1 = math.floor(cx - 45), math.floor(cy - 45), math.ceil(cx + 45), math.ceil(cy + 45)
    w, h = (ox1 - ox0) * 4, (oy1 - oy0) * 4
    png = fetch.wms_block("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/png", ox0 + c.ORIGIN[0], oy0 + c.ORIGIN[1], ox1 + c.ORIGIN[0], oy1 + c.ORIGIN[1],
                          w, h, CACHE / f"{bid}_ortho_{ox0}_{oy0}_{w}x{h}.png")
    o = np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(float) / 255
    hi, lo = o.max(2), o.min(2)
    grey = (hi - lo < 0.13 * np.maximum(hi, 1e-3)) & (hi > 0.45)
    def stone(rel):
        v = []
        for R in np.arange(ro + 2.5, r1 - 1, 0.5):
            x, y = P(R, rel)
            v.append(grey[int((oy1 - y) * 4), int((x - ox0) * 4)])
        return np.mean(v) > 0.6
    rest = []
    for sign in (-1, 1):
        k = 0
        while stone(sign * math.radians(k + 1)):
            k += 1
        rest.append(sign * math.radians(k))
    # Escaliers (OpenStreetMap) : angle du milieu de chaque volée, rangés en bas (pied sous la précinction) et en haut.
    lanes_lo, lanes_up = [], []
    for wid in spec["stairs"]:
        pts = osm_way(wid)
        mx, my = np.mean([p[0] for p in pts]), np.mean([p[1] for p in pts])
        rel = math.remainder(math.atan2(my - cy, mx - cx) - ax, 2 * math.pi)
        (lanes_lo if math.hypot(mx - cx, my - cy) < r2 else lanes_up).append(round(rel, 4))
    lanes_lo.sort(); lanes_up.sort()
    lane = spec.get("lane", 2.4)
    # Haut de chaque escalier de la partie haute : terrain au bord des arbres (le pied est la précinction).
    tops_up = [round(float(np.median([mnt(*P(r4 - 0.5, u + d / r4)) for d in (-0.6, 0.0, 0.6)])), 2) for u in lanes_up]
    med = lambda f, R, a0, a1: float(np.median([f(*P(R, u)) for u in np.linspace(a0, a1, 12)]))
    # Haut d'un coin à R : médiane du MNS, au moins 30 cm au-dessus du terrain ; près de la lisière (3 m), quart bas du MNS et au plus 4 m
    # au-dessus du terrain (les cimes débordent sur la terrasse).
    def top(R, a0, a1):
        g = med(mnt, R, a0, a1)
        if R > r4 - 3:
            R = min(R, r4 - 1)
            g = med(mnt, R, a0, a1)
            return round(min(max(float(np.percentile([mns(*P(R, u)) for u in np.linspace(a0, a1, 12)], 25)), g + 0.3), g + 4), 2)
        return round(max(med(mns, R, a0, a1), g + 0.3), 2)
    # Coins de la partie haute : entre deux escaliers ; les deux coins extrêmes vont jusqu'au diamètre (massifs ruinés).
    edges = [-math.pi / 2] + lanes_up + [math.pi / 2]
    cun = []
    for a0, a1 in zip(edges[:-1], edges[1:]):
        m0, m1 = a0 + (0.0 if a0 == -math.pi / 2 else lane / 2 / r3 + 0.02), a1 - (0.0 if a1 == math.pi / 2 else lane / 2 / r3 + 0.02)
        ruin = a0 == -math.pi / 2 or a1 == math.pi / 2
        q0, q1 = (m0 + 0.05, m1 - 0.05)
        if ruin:
            prof = [top(R, q0, q1) for R in np.linspace(r2, r4, 9)]
        else:
            prof = [top(R, q0, q1) for R in (r2 + 0.5, r3, r4)]
        cun.append([round(a0, 4), round(a1, 4), int(ruin), prof, 0])
    # Coins du haut à gradins restaurés (photos, et rythme des rangs sur l'orthophotographie pour le coin de 12° à 33°) : sur la pente, de la
    # hauteur des rangs du bas.
    rise = (zp - rows[3]) / (n - 1)
    for i in spec.get("upperRows", []):
        q = cun[i]
        q[4] = max(2, round((q[3][1] - q[3][0]) / rise))
    # Massifs ruinés du bas, au-delà des gradins restaurés, jusqu'au diamètre.
    ends = []
    for a0, a1 in ((-math.pi / 2, rest[0]), (rest[1], math.pi / 2)):
        q0, q1 = a0 + 0.05, a1 - 0.05
        prof = [top(R, q0, q1) for R in np.linspace(ro, r2, 6)]
        ends.append([round(a0, 4), round(a1, 4), prof])
    # Scène moderne.
    sc = osm_way(spec["stage"])[:-1]
    sx, sy = np.mean([p[0] for p in sc]), np.mean([p[1] for p in sc])
    inner = [(sx + (p[0] - sx) * k, sy + (p[1] - sy) * k) for p in sc for k in (0.2, 0.5)]
    ztop = float(np.median([mns(*q) for q in inner]))
    # Marches : côté le plus proche du centre ; largeur = où le MNS atteint le dessus (à 15 cm près) en partant de ce côté.
    k0 = min(range(4), key=lambda i: math.hypot((sc[i][0] + sc[(i + 1) % 4][0]) / 2 - cx, (sc[i][1] + sc[(i + 1) % 4][1]) / 2 - cy))
    sc = sc[k0:] + sc[:k0]
    m0 = ((sc[0][0] + sc[1][0]) / 2, (sc[0][1] + sc[1][1]) / 2)
    m1 = ((sc[2][0] + sc[3][0]) / 2, (sc[2][1] + sc[3][1]) / 2)
    depth = math.dist(m0, m1)
    stepd = next(float(d) for d in np.arange(0.25, depth, 0.25)
                 if mns(m0[0] + (m1[0] - m0[0]) * d / depth, m0[1] + (m1[1] - m0[1]) * d / depth) > ztop - 0.15)
    # Poteaux d'éclairage et arbustes taillés (positions sur l'orthophotographie : ombres des poteaux, boules sombres des arbustes ; photos) :
    # haut = plus haut point du MNS au-dessus du terrain à moins d'1 m. Un poteau trop fin pour le relevé (moins de 4 m) prend la hauteur du
    # premier (ombres de même longueur).
    def peak(x, y, r=1.0):
        return max(mns(x + dx, y + dy) - mnt(x + dx, y + dy) for dx in np.arange(-r, r + 0.01, 0.25) for dy in np.arange(-r, r + 0.01, 0.25))
    poles = []
    for x, y in spec.get("poles", []):
        h = peak(x, y)
        poles.append([x, y, round(float(h if h > 4 or not poles else poles[0][2]), 2)])
    shrubs = [[x, y, round(float(min(1.4, max(0.6, peak(x, y, 0.75)))), 2)] for x, y in spec.get("shrubs", [])]
    r2f = lambda v: round(float(v), 2)
    return {
        "t": "theatre", "id": bid, "n": spec.get("name", "Théâtre romain"),
        "c": [r2f(cx), r2f(cy)], "a": round(ax, 4), "zo": r2f(zo), "ro": r2f(ro), "span": round(span, 3),
        "rows": [n, r2f(rw0), r2f(r1), r2f(rows[3]), r2f(zp)], "rest": [round(rest[0], 4), round(rest[1], 4)],
        "pr": [r2f(r1), r2f(r2), r2f(zp)], "up": [r2f(r2), r2f(r3), r2f(r4), r2f(r5), r2f(z5)],
        "lanes": [lanes_lo, [[u, z] for u, z in zip(lanes_up, tops_up)], lane], "cun": cun, "ends": ends,
        "stage": [v for p in sc for v in (r2f(p[0]), r2f(p[1]))] + [r2f(ztop), r2f(stepd)],
        "poles": poles, "shrubs": shrubs,
    }


def theatre(tid, bid, b, spec, k):
    """Théâtre romain (D133) : le bâtiment BD TOPO (un immeuble en fer à cheval) est masqué (`hidden`), le site `theatre` le remplace ; sa
    silhouette lointaine est retirée (la cavea est un creux du relief). Vrai si kinds/<tuile>.json change."""
    site = measure_theatre(bid, b, spec)
    g = site["zo"]
    print(f"  {bid} : orchestre de {site['ro']} m de rayon, axe {math.degrees(site['a']):.0f}°, ouverture {2 * math.degrees(site['span']):.0f}°,"
          f" {site['rows'][0]} rangs restaurés jusqu'à {site['rows'][2]} m ({site['pr'][2] - g:.1f} m), terrasse à {site['up'][1]} m,"
          f" arbres à {site['up'][2]} m, sommet à {site['up'][3]} m ({site['up'][4] - g:.1f} m) ; gradins sur"
          f" {math.degrees(site['rest'][0]):.0f}° à {math.degrees(site['rest'][1]):.0f}° ; escaliers {len(site['lanes'][0])} en bas,"
          f" {len(site['lanes'][1])} en haut ; scène : dessus à {site['stage'][8] - g:.1f} m, marches sur {site['stage'][9]} m")
    if replace_lod(tid, bid, []):
        print(f"  silhouette lointaine de {bid} retirée")
    e = {"k": "hidden"}
    sites = [q for q in k["sites"] if not (q.get("t") == "theatre" and q.get("id") == bid)] + [site]
    if k["buildings"].get(bid) == e and sites == k["sites"]:
        return False
    k["buildings"][bid] = e
    k["sites"] = sites
    index = json.loads((KINDS / "index.json").read_text())
    if tid not in index["tiles"]:
        index["tiles"] = sorted(index["tiles"] + [tid])
    index["stats"]["sites"]["theatre"] = 1
    (KINDS / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    return True


COMPASS = {"N": 90, "NNE": 67.5, "NE": 45, "ENE": 22.5, "E": 0, "ESE": -22.5, "SE": -45, "SSE": -67.5, "S": -90, "SSW": -112.5, "SW": -135,
           "WSW": -157.5, "W": 180, "WNW": 157.5, "NW": 135, "NNW": 112.5}


def side_of(site, name):
    """+1 si la direction `name` (rose des vents) est du côté t > 0 de la porte (v = u tourné d'un quart de tour), sinon −1."""
    th = math.radians(COMPASS[name])
    return 1 if -math.sin(site["a"]) * math.cos(th) + math.cos(site["a"]) * math.sin(th) > 0 else -1


def measure_gate(spec, site, ring_of):
    """Porte romaine d'après photo (D137) : l'orientation vient du contour OpenStreetMap (build_kinds.py, D95) ; on mesure au LiDAR le
    décalage en travers et l'épaisseur du corps (profil médian du MNS sur la partie de la longueur que le relevé contient, `mns` : cellules à
    plus de 4 m au-dessus de la rue), le haut du corps (médiane du MNS sur ce corps, pour contrôle), la rue (médiane du MNT sur l'axe) et le
    niveau de la rue de chaque côté (à 3 m des faces). Avec `ends` (D138), les bouts sont mesurés au lieu de la longueur des sources : bout
    libre là où le MNS retombe à mi-hauteur sur l'axe, bout contre un bâtiment là où l'axe entre dans son emprise BD TOPO. Tour (`tower`) :
    depuis le bout, cellules du MNS plus hautes que le faîtage du toit de 40 cm (on passe le bord flou) ; son haut au 90ᵉ centile. Toit (`roof`) : faîtage au
    90ᵉ centile du MNS sur le corps hors tour, égout au haut de l'entablement. Le reste vient de la photo de face (`manual.json`), en mètres
    mesurés depuis son bout gauche : travées (piles et arches, ramenées à la longueur, tour exclue), naissances, archivoltes, corniche,
    attique, galerie, profil du dessus ruiné, zones de blocage apparent ; rendu en abscisses s du repère de la porte."""
    x, y, a, l = site["x"], site["y"], site["a"], site["l"]
    u, v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    P = lambda s, t: (x + u[0] * s + v[0] * t, y + u[1] * s + v[1] * t)
    dot = lambda name: u[0] * math.cos(math.radians(COMPASS[name])) + u[1] * math.sin(math.radians(COMPASS[name]))
    key = f"gate_{spec['st']}"
    R = l / 2 + 16
    mns = Raster("MNS", key, math.floor(x - R), math.floor(y - R), math.ceil(x + R), math.ceil(y + R))
    mnt = Raster("MNT", key, math.floor(x - R), math.floor(y - R), math.ceil(x + R), math.ceil(y + R))
    g0 = float(np.median([mnt(*P(s, 0)) for s in np.arange(-l / 2, l / 2 + 0.01, 0.5)]))
    m0, m1 = spec["mns"]
    ts = np.arange(-6, 6.01, 0.25)
    prof = [float(np.median([mns(*P(s, t)) for s in np.arange(m0, m1 + 0.01, 0.5)])) - g0 for t in ts]
    i = int(np.argmax(prof))
    j0, j1 = i, i
    while j0 > 0 and prof[j0 - 1] > 4:
        j0 -= 1
    while j1 + 1 < len(ts) and prof[j1 + 1] > 4:
        j1 += 1
    t0, t1 = float(ts[j0]) - 0.125, float(ts[j1]) + 0.125
    dt, w = (t0 + t1) / 2, t1 - t0
    along = lambda s: float(np.median([mns(*P(s, t)) for t in np.arange(t0 + 0.5, t1 - 0.49, 0.5)])) - g0
    sA, sB = -l / 2, l / 2
    if "ends" in spec:
        from shapely.geometry import LineString, Polygon
        free = 1 if dot(spec["ends"]["free"]) > 0 else -1
        top0 = along(0)
        e = next(float(q) for q in np.arange(0, l, 0.25) if along(free * q) < top0 / 2) * free  # mi-hauteur (le relevé est flou au bout)
        poly = Polygon(pairs(ring_of(spec["ends"]["abut"])))
        hit = LineString([P(0, dt), P(-free * (l + 10), dt)]).intersection(poly)
        o = min((math.dist(P(0, dt), q) for q in (hit.coords if hit.geom_type == "LineString" else [c for g in hit.geoms for c in g.coords])))
        sA, sB = sorted((e, -free * o))
        l = sB - sA
    cx, cy = P((sA + sB) / 2, dt)
    sh = (sA + sB) / 2
    g = float(np.median([mnt(*P(sh + s, dt)) for s in np.arange(-l / 2, l / 2 + 0.01, 0.5)]))
    body = float(np.median([mns(*P(sh + s, t)) for s in np.arange(m0, m1 + 0.01, 0.5) for t in np.arange(t0 + 0.5, t1 - 0.49, 0.5)])) - g
    street = [float(np.median([mnt(*P(sh + s, dt + side * (w / 2 + 3))) for s in np.arange(-l / 2, l / 2 + 0.01, 1)])) for side in (-1, 1)]
    r2 = lambda q: round(float(q), 2)
    # Toit et tour (Saint-André) : en abscisses du nouveau centre.
    ridge = tower = None
    if spec.get("roof"):
        ridge = float(np.percentile([mns(*P(sh + s, t)) for s in np.arange(m0, m1 + 0.01, 0.5) for t in np.arange(t0 + 0.5, t1 - 0.49, 0.5)], 90)) - g
    tw = 0.0
    if "tower" in spec:
        side = 1 if dot(spec["tower"]["end"]) > 0 else -1
        hi = [along(sh + side * (l / 2 - q)) + g0 - g > (ridge or body) + 0.4 for q in np.arange(0, l / 2, 0.25)]
        tw = (hi.index(True) + hi[hi.index(True):].index(False)) * 0.25
        tz = float(np.percentile([mns(*P(sh + side * (l / 2 - q), t)) for q in np.arange(0.25, tw, 0.25) for t in np.arange(t0 + 0.25, t1 - 0.24, 0.25)], 90)) - g
        tower = sorted([side * (l / 2 - tw), side * l / 2]) + [r2(-w / 2 - 0.25), r2(w / 2 + 0.25), r2(tz)]
    # Photo : de quel côté (t) elle est prise, donc où est son bout gauche (en regardant vers −t depuis t > 0, la gauche est +s).
    left = side_of(site, spec["photoFrom"])
    tower_left = tower is not None and (tower[0] + tower[1]) * left > 0
    d0 = tw if tower_left else 0.0  # bout gauche de la partie en grand appareil
    la = l - tw
    S = lambda d: round(left * (l / 2 - d0 - min(max(d, 0), la)), 3)
    bays = spec["bays"]
    k = la / sum(bays)
    edges = [0.0]
    for b in bays:
        edges.append(edges[-1] + b * k)
    arches, piers = [], []
    for n in range(len(bays)):
        a0, a1 = sorted((S(edges[n]), S(edges[n + 1])))
        (arches if n % 2 else piers).append([a0, a1] + ([spec["springs"][n // 2]] if n % 2 else []))
    gal = spec["gallery"]
    pitch = gal.get("pitch") or (la - 2 * gal["from"]) / gal["n"]
    gs = [S(gal["from"] + pitch * n) for n in range(gal["n"] + 1)]
    if gal["face"] == "both":
        gt = [[r2(-w / 2), r2(-w / 2 + gal["depth"])], [r2(w / 2 - gal["depth"]), r2(w / 2)]]
    else:
        gt0 = -w / 2 if side_of(site, gal["face"]) < 0 else w / 2 - gal["depth"]
        gt = [[r2(gt0), r2(gt0 + gal["depth"])]]
    top = [[S(d), z] for d, z in spec["top"]]
    if left > 0:
        top.reverse()  # profil dans le sens des s croissants
    gm = {
        "c": [r2(cx), r2(cy)], "l": r2(l), "w": r2(w), "g": r2(g), "street": [r2(z) for z in street], "body": r2(body),
        "piers": [[round(q, 2) for q in p] for p in sorted(piers)], "arches": [[round(q, 2) for q in p] for p in sorted(arches)],
        "band": spec["band"], "cornice": spec["cornice"], "attic": spec["attic"],
        "gal": {"s": gs, "open": gal["open"], "crown": gal["crown"], "ent": gal["ent"], "keep": gal["keep"], "t": gt},
        "top": top, "rubble": [sorted([S(d0_), S(d1_)]) + [z0, z1] for d0_, d1_, z0, z1 in spec.get("rubble", [])],
    }
    if "block" in spec:
        b0, b1, bz = spec["block"]
        gm["block"] = sorted([S(b0), S(b1)]) + [bz]
    if ridge is not None:
        gm["roof"] = [gal["ent"][1], r2(ridge)]
    if tower:
        gm["tower"] = [r2(tower[0]), r2(tower[1])] + tower[2:]
    if "stone" in spec:
        gm["stone"] = spec["stone"]
    if spec.get("light"):
        gm["light"] = 1
    return gm


def gate(spec, kinds_all, ring_of):
    """Écrit le modèle `gm` dans le site `gate` de la porte (kinds/<tuile>.json, écrit par build_kinds.py, D95) et sa silhouette lointaine
    (lod/<tuile>.json) ; rend (tuile des types si elle change, tuile des silhouettes si elle change)."""
    for tid, k in kinds_all():
        site = next((q for q in k["sites"] if q.get("t") == "gate" and q.get("st") == spec["st"]), None)
        if site:
            break
    else:
        print(f"  porte {spec['st']} absente de public/data/kinds (lancer build_kinds.py)")
        return None, False
    gm = measure_gate(spec, site, ring_of)
    print(f"  {site['n']} : corps de {gm['w']} m d'épaisseur décalé au centre ({gm['c'][0]}, {gm['c'][1]}), rue à {gm['g']} m"
          f" ({gm['street'][0]} / {gm['street'][1]} de chaque côté), corps au relevé {gm['body']} m (attique d'après la photo : {gm['attic']} m),"
          f" arches {', '.join(f'{q[1] - q[0]:.2f}' for q in gm['arches'])} m")
    # Silhouette lointaine (aucune avant D137) : corps jusqu'au haut de son profil, galerie conservée jusqu'à l'entablement (ou toit), tour.
    a, l, (cx, cy), hw = site["a"], gm["l"], gm["c"], gm["w"] / 2
    xy = lambda s, t: [round(cx + math.cos(a) * s - math.sin(a) * t, 1), round(cy + math.sin(a) * s + math.cos(a) * t, 1)]
    rect = lambda s0, s1, t0, t1: [xy(s0, t0), xy(s1, t0), xy(s1, t1), xy(s0, t1)]
    zt = gm["g"] + float(np.median([q[1] for q in gm["top"]]))
    polys = [(rect(-l / 2, l / 2, -hw, hw), zt, zt)]
    gal = gm["gal"]
    if gal["keep"][1] >= gal["keep"][0]:
        ss = gal["s"][gal["keep"][0]:gal["keep"][1] + 2]
        ze = gm["g"] + gal["ent"][1]
        polys.append((rect(min(ss), max(ss), gal["t"][0][0], gal["t"][-1][1]), ze, gm["g"] + gm["roof"][1] if "roof" in gm else ze))
    if "tower" in gm:
        ts0, ts1, tt0, tt1, tz = gm["tower"]
        polys.append((rect(ts0, ts1, tt0, tt1), gm["g"] + tz, gm["g"] + tz))
    lod = tid if replace_lod(tid, f"gate-{spec['st']}", polys, {"w": "#cdc6b5", "t": "#cdc6b5", "m": "terrasse", "a": "medieval", "k": zlib.crc32(f"gate-{spec['st']}".encode())}) else None
    if site.get("gm") == gm:
        return None, lod
    site["gm"] = gm
    return tid, lod


def measure_chapel(bid, b, spec, site):
    """Église Saint-André accolée à la porte (D138), dans le repère de la porte (orientation du site, origine son centre OpenStreetMap) :
    nef = rectangle de l'emprise BD TOPO (côtés en s, pignon ouest-sud-ouest au bout t le plus grand), tour ronde = cercle ajusté sur les
    sommets de l'emprise au-delà du bout de la nef (côté est-nord-est). Au MNS : faîtage de la nef (90ᵉ centile sur la ligne de faîtage),
    égout (médiane à 60 cm des longs murs), égout de la tour (médiane sur le cercle à 70 cm du mur), pointe de son toit conique (point le plus
    haut à moins d'1 m du centre). Sol : médiane du terrain à 1,5-3 m de l'emprise. Portes et baies : photos (`manual.json`)."""
    from shapely.geometry import Polygon
    x, y, a = site["x"], site["y"], site["a"]
    u, v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    P = lambda s, t: (x + u[0] * s + v[0] * t, y + u[1] * s + v[1] * t)
    ring = pairs(b["ring"])
    st = [((px - x) * u[0] + (py - y) * u[1], (px - x) * v[0] + (py - y) * v[1]) for px, py in ring]
    tmin = min(q[1] for q in st)
    round_pts = [q for q in st if q[1] < tmin + 4.5]
    sc, tc, r = fit_circle(round_pts)
    s0 = min(q[0] for q in st if q[1] > tc + 1)
    s1 = max(q[0] for q in st if q[1] > tc + 1)
    s0 = max(s0, float(np.median([q[0] for q in st if q[1] > tc + 1 and q[0] < (s0 + s1) / 2 - 3])))
    t1 = max(q[1] for q in st)
    t0 = tc + 1.0
    key = "chapel_" + bid
    xs, ys = [q[0] for q in ring], [q[1] for q in ring]
    mns = Raster("MNS", key, math.floor(min(xs) - 6), math.floor(min(ys) - 6), math.ceil(max(xs) + 6), math.ceil(max(ys) + 6))
    mnt = Raster("MNT", key, math.floor(min(xs) - 6), math.floor(min(ys) - 6), math.ceil(max(xs) + 6), math.ceil(max(ys) + 6))
    poly = Polygon(ring)
    around = [q for q in pairs([cc for p in poly.buffer(3).exterior.coords for cc in p]) if not poly.buffer(1.5).contains(__import__("shapely.geometry", fromlist=["Point"]).Point(q))]
    g = float(np.median([mnt(*q) for q in around]))
    sm = (s0 + s1) / 2
    ridge = float(np.percentile([mns(*P(sm, t)) for t in np.arange(t0 + 2, t1 - 1, 0.5)], 90)) - g
    eave = float(np.median([mns(*P(sq, t)) for sq in (s0 + 0.6, s1 - 0.6) for t in np.arange(t0 + 2, t1 - 1, 0.5)])) - g
    reave = float(np.median([mns(*P(sc + (r - 0.7) * math.cos(th), tc + (r - 0.7) * math.sin(th))) for th in np.arange(-math.pi, 0.01, math.pi / 12)])) - g
    apex = max(mns(*P(sc + dx, tc + dy)) for dx in np.arange(-1, 1.01, 0.25) for dy in np.arange(-1, 1.01, 0.25)) - g
    r2 = lambda q: round(float(q), 2)
    out = {"o": [x, y], "a": a, "nave": [r2(s0), r2(s1), r2(t0), r2(t1)], "g": r2(g), "eave": r2(eave), "ridge": r2(ridge),
           "round": [r2(sc), r2(tc), r2(r), r2(reave), r2(apex)], "door": spec["door"], "windows": spec["windows"]}
    if spec.get("light"):
        out["light"] = 1
    return out


def chapel(tid, bid, b, spec, k, kinds_all):
    """Écrit le modèle `chap` de l'église (kinds/<tuile>.json) et sa silhouette lointaine (nef, tour ronde). Vrai si les types changent ;
    rend aussi la tuile des silhouettes si elle change."""
    site = next((q for _, kk in kinds_all() for q in kk["sites"] if q.get("t") == "gate" and q.get("st") == spec["gate"]), None)
    if not site:
        print(f"  {bid} : porte {spec['gate']} absente")
        return False, None
    m = measure_chapel(bid, b, spec, site)
    print(f"  {bid} : nef de {m['nave'][1] - m['nave'][0]:.1f} × {m['nave'][3] - m['nave'][2]:.1f} m, égout {m['eave']} m, faîtage {m['ridge']} m ;"
          f" tour ronde de {m['round'][2]} m de rayon, égout {m['round'][3]} m, pointe {m['round'][4]} m")
    a, (x, y) = m["a"], m["o"]
    xy = lambda s, t: [round(x + math.cos(a) * s - math.sin(a) * t, 1), round(y + math.sin(a) * s + math.cos(a) * t, 1)]
    s0, s1, t0, t1 = m["nave"]
    sc, tc, r, re_, ra = m["round"]
    polys = [([xy(s0, t0), xy(s1, t0), xy(s1, t1), xy(s0, t1)], m["g"] + m["eave"], m["g"] + m["ridge"]),
             ([xy(sc + r * math.cos(th), tc + r * math.sin(th)) for th in np.arange(0, 2 * math.pi, math.pi / 6)], m["g"] + re_, m["g"] + ra)]
    lod = tid if replace_lod(tid, bid, polys) else None
    e = dict(k["buildings"].get(bid, {"k": "church"}))
    e["chap"] = m
    if k["buildings"].get(bid) == e:
        return False, lod
    k["buildings"][bid] = e
    return True, lod


# --- L'Hexagone (D165) ---------------------------------------------------------------------------------------------------------------

HEX_SIDES = (35, 95, 155, 215, 275, 335)
HEX_COLORS = {"wall": "#dccab6", "roof": "#6c7b90", "deck": "#8c8d8b", "drum": "#56616f", "annex": "#4a5360",
              "band": "#d9c3ab", "glass": "#3a5662", "zinc": "#566377", "frame": "#ecebe6"}


def hexagone_shape(m):
    """Pied à 12 pans de la pyramide ; même calcul que `hexagoneShape` (src/core/landmarks.ts)."""
    R = m["apothem"] / math.cos(math.radians(15))
    d = lambda cap: (math.sin(math.radians(cap)), math.cos(math.radians(cap)))
    return [[m["c"][0] + R * d(m["hip"] + 30 * i)[0], m["c"][1] + R * d(m["hip"] + 30 * i)[1]] for i in range(12)]


def hexagone(tid, bid, b, spec, k):
    """L'Hexagone (D165) : champ `hex` du bâtiment (kinds/<tuile>.json) et silhouette lointaine (couronne, pyramide). Les mesures viennent des
    relevés du lot 0 (tools/data/survey_hexagone.py, docs/plans/hexagone.md §8), recopiés dans `manual.json` : sommet, pied et apothème de la
    pyramide, cap de ses arêtes, distance et niveau de chacun des six côtés, annexe ; le sol est celui du bâtiment BD TOPO. Rend (changé, silhouette)."""
    m = {"c": spec["c"], "g": round(b["ground"], 2), "apex": spec["apex"], "foot": spec["foot"], "apothem": spec["apothem"], "skirt": spec["skirt"], "hip": spec["hip"],
         "ring": b["ring"], "sides": spec["sides"], "colors": {**HEX_COLORS, **spec.get("colors", {})}}
    if spec.get("annex"):
        m["annex"] = spec["annex"]
    for key in ("front", "ne", "props"):
        if spec.get(key):
            m[key] = spec[key]
    foot = hexagone_shape(m)
    print(f"  {bid} : pyramide à 12 pans de {m['apex'] - m['g']:.1f} m (pente {(m['apex'] - m['skirt'][1]) / m['skirt'][0]:.3f}, jupon {(m['skirt'][1] - m['foot']) / (m['apothem'] - m['skirt'][0]):.2f}), couronne de six secteurs"
          f" à {', '.join(f'{s[0]:.1f}' for s in m['sides'])} m, terrasses à {', '.join(f'{s[1]:+.1f}' for s in m['sides'])}")
    r1 = lambda pts: [[round(x, 1), round(y, 1)] for x, y in pts]
    zs = [s[1] for s in m["sides"]]
    polys = [(r1(zip(b["ring"][0::2], b["ring"][1::2])), round(sum(zs) / 6, 1), round(max(zs) + 0.45, 1)), (r1(foot), m["foot"], m["apex"])]
    lod = tid if replace_lod(tid, bid, polys) else None
    e = dict(k["buildings"].get(bid, {"k": "culture"}))
    e["hex"] = m
    if k["buildings"].get(bid) == e:
        return False, lod
    k["buildings"][bid] = e
    return True, lod


# --- Collège du Vallon (D172) ---------------------------------------------------------------------------------------------------------

VALLON_COLORS = {"wall": "#d8d1c0", "roof": "#8d8a84", "parapet": "#cbc3b1", "vault": "#6f8c7c", "hall": "#c8cdd0"}


def vallon(tid, bid, b, spec, k):
    """Collège du Vallon (D172) : champ `vallon` du bâtiment (kinds/<tuile>.json) et silhouette lointaine. Les mesures (ailes, niveaux de toit, bandes du
    gymnase, voûtes du préau, dans le repère tourné de 17,5° du bloc principal) viennent des relevés du lot 0 (tools/data/survey_college.py,
    docs/plans/college-vallon.md §9), recopiés dans `manual.json` ; le type du bâtiment est celui de `kind` (« school » : l'ancien « culture » du bloc
    principal venait d'une étiquette OpenStreetMap). Rend (changé, silhouette)."""
    m = {"o": spec["o"], "rot": spec["rot"], "colors": {**VALLON_COLORS, **spec.get("colors", {})}}
    ca, sa = math.cos(math.radians(spec["rot"])), math.sin(math.radians(spec["rot"]))
    pt = lambda u, v: [round(spec["o"][0] + u * ca - v * sa, 1), round(spec["o"][1] + u * sa + v * ca, 1)]
    polys = []
    g = round(b["ground"], 1)
    if spec.get("wings"):
        m["wings"] = [{"n": w["n"], "r": w["r"], "z": w["z"]} for w in spec["wings"]]
        for key in ("faces", "bury", "gate", "props"):  # façades (D173) et volumes voisins qui masquent le pied des murs
            if spec.get(key):
                m[key] = spec[key]
        for w in m["wings"]:
            u0, u1, v0, v1 = w["r"]
            polys.append(([pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)], g, round(w["z"] + 0.45, 1)))
        print(f"  {bid} : {len(m['wings'])} ailes, toits à " + ", ".join(f"{w['n']} {w['z'] - g:+.1f}" for w in m["wings"]) + f" m du sol ({g})")
    if spec.get("gym"):
        m["gym"] = {"ring": b["ring"], "strips": spec["gym"]["strips"]}
        top = max(s.get("z", s.get("ridge", [0, -99])[1]) for s in spec["gym"]["strips"])
        polys.append(([[round(b["ring"][i], 1), round(b["ring"][i + 1], 1)] for i in range(0, len(b["ring"]), 2)], g, round(top, 1)))
        print(f"  {bid} : gymnase en {len(m['gym']['strips'])} bandes, faîtage à {top - g:.1f} m du sol ({g})")
    if spec.get("preau"):
        m["preau"] = spec["preau"]
        print(f"  {bid} : préau à {spec['preau']['crown'] - g:.1f} m du sol ({g}), {spec['preau']['n']} voûtes")
    lod = tid if polys and replace_lod(tid, bid, polys) else None
    e = dict(k["buildings"].get(bid, {"k": spec["kind"]}))
    e["k"] = spec["kind"]
    e["vallon"] = m
    if k["buildings"].get(bid) == e:
        return False, lod
    k["buildings"][bid] = e
    return True, lod


# --- Maison d'après photo (D140) -----------------------------------------------------------------------------------------------------

def house_frame(b, spec):
    """Repère de la maison : origine au sommet `o` du contour BD TOPO, s vers le sommet `s`, t du côté du contour. Rend (origine, angle,
    sommets en (s, t))."""
    ring = pairs(b["ring"])
    o, q = ring[spec["o"]], ring[spec["s"]]
    a = math.atan2(q[1] - o[1], q[0] - o[0])
    u, v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    st = [((x - o[0]) * u[0] + (y - o[1]) * u[1], (x - o[0]) * v[0] + (y - o[1]) * v[1]) for x, y in ring]
    sign = -1 if sum(p[1] for p in st) < 0 else 1  # t du côté du contour
    return o, a, sign, [(s, sign * t) for s, t in st]


def l_rects(st, notch):
    """Le contour en L comme réunion de deux rectangles du repère : corps [0, L] × [0, W1] et aile [sB, L] × [0, W2] ; `notch` est le
    sommet rentrant (B), précédé du bout du corps (A) et suivi du coin de l'aile (C)."""
    n = len(st)
    A, B, C = st[(notch - 1) % n], st[notch], st[(notch + 1) % n]
    D = st[(notch + 2) % n]
    L = max(p[0] for p in st)
    W1 = (A[1] + B[1]) / 2
    sB = (B[0] + C[0]) / 2
    W2 = (C[1] + D[1]) / 2
    return L, W1, sB, W2


def roof_union(rects, z0, p, ov):
    """Toit à croupes de pente constante `p` sur une réunion de rectangles (s0, s1, t0, t1) élargis du débord `ov` : chaque rectangle est
    un toit à quatre pans d'égout z0 − ov·p, et le toit est leur maximum (noues aux rencontres). Rend les pans : contour (s, t) et plan
    z = a·s + b·t + c."""
    from shapely.geometry import Polygon, box
    big = box(-100, -100, 100, 100)

    def half(a, b, c):  # a·s + b·t + c ≤ 0
        pts = []
        corners = [(-100, -100), (100, -100), (100, 100), (-100, 100)]
        for i in range(4):
            p0, p1 = corners[i], corners[(i + 1) % 4]
            f0, f1 = a * p0[0] + b * p0[1] + c, a * p1[0] + b * p1[1] + c
            if f0 <= 0:
                pts.append(p0)
            if (f0 < 0) != (f1 < 0) and abs(f0 - f1) > 1e-12:
                k = f0 / (f0 - f1)
                pts.append((p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k))
        return Polygon(pts) if len(pts) >= 3 else Polygon()

    ze = z0 - ov * p
    R = []
    for s0, s1, t0, t1 in rects:
        s0, s1, t0, t1 = s0 - ov, s1 + ov, t0 - ov, t1 + ov
        planes = [(p, 0, ze - p * s0), (-p, 0, ze + p * s1), (0, p, ze - p * t0), (0, -p, ze + p * t1)]
        R.append((box(s0, t0, s1, t1), planes))
    faces = []
    for i, (ri, pi) in enumerate(R):
        for k, (a, b, c) in enumerate(pi):
            reg = ri
            for j, (a2, b2, c2) in enumerate(pi):
                if j != k:
                    reg = reg.intersection(half(a - a2, b - b2, c - c2))
            for o, (ro, po) in enumerate(R):
                if o == i:
                    continue
                # Là où l'autre toit est plus haut que ce pan ; à égalité (pans coplanaires), le premier rectangle garde le pan.
                eps = -1e-4 if o < i else 1e-4
                above = ro
                for (a2, b2, c2) in po:
                    above = above.intersection(half(a - a2, b - b2, c - c2 + eps))
                reg = reg.difference(above)
            # Ouverture morphologique : la différence laisse des pointes sans surface le long des arêtiers communs.
            reg = reg.buffer(-0.002, join_style="mitre").buffer(0.002, join_style="mitre")
            for g in getattr(reg, "geoms", [reg]):
                if g.geom_type == "Polygon" and g.area > 0.05:
                    g = g.simplify(0.01)
                    faces.append({"r": [round(v, 3) for q in list(g.exterior.coords)[:-1] for v in q], "k": [a, b, round(c, 3)]})
    return faces


def house_fit(mns, P, g, rects0):
    """Toit en L mesuré au MNS. Le relevé est flou d'environ 25 cm au bord, et un bord de toit flou se confond avec un débord plus large et
    plus bas : on ajuste d'abord les pans sur le seul haut du toit (plus de 3 m) — contour du L à 3 m de haut (bords du corps s0, s1, t0, t1 ;
    de l'aile sw, tw) et pente, moindres carrés robustes puis chaque bord affiné à 10 cm près —, puis l'égout : la hauteur ze telle que le
    MNS vaille ze / 2 là où les pans prolongés descendent à ze (mi-hauteur, médiane sur les quatre grands bords). Le contour BD TOPO ne sert
    que de départ (il peut être décalé). Rend (bords du toit à l'égout, égout, pente, part du haut du toit à 30 cm près)."""
    from scipy.optimize import least_squares
    (s0, s1, t0, t1), (sw, _, _, tw) = rects0
    S, T = np.meshgrid(np.arange(s0 - 2, s1 + 2, 0.5), np.arange(t0 - 2, tw + 2, 0.5))
    S, T = S.ravel(), T.ravel()
    Z = np.array([mns(*P(a, b)) - g for a, b in zip(S, T)])
    top = Z > 3.0
    S, T, Z = S[top], T[top], Z[top]
    Z3 = 3.0

    def model(x):
        a0, a1, b0, b1, aw, bw, p = x
        rect = lambda u0, u1, v0, v1: (lambda d: np.where(d >= 0, Z3 + p * d, -np.inf))(np.minimum.reduce([S - u0, u1 - S, T - v0, v1 - T]))
        z = np.maximum(rect(a0, a1, b0, b1), rect(aw, a1, b0, bw))
        return np.where(np.isfinite(z), z, 0.0)

    x = list(least_squares(lambda x: model(x) - Z, [s0, s1, t0, t1, sw, tw, 1.0], loss="soft_l1", f_scale=0.3, diff_step=0.02).x)
    for _ in range(3):
        for k in range(6):
            cands = np.arange(x[k] - 1, x[k] + 1.01, 0.1)
            errs = [np.sum(np.minimum(np.abs(model(x[:k] + [c] + x[k + 1:]) - Z), 1.0)) for c in cands]
            x[k] = float(cands[int(np.argmin(errs))])
        x[6] = float(least_squares(lambda q: model(x[:6] + [q[0]]) - Z, [x[6]], loss="soft_l1", f_scale=0.3).x[0])
    a0, a1, b0, b1, aw, bw, p = x
    share = float(np.mean(np.abs(model(x) - Z) < 0.3))
    # Égout à mi-hauteur : profils perpendiculaires aux bords du corps (s0, s1, t0) et au bout de l'aile (tw).
    edges = [((a0, None), (-1, 0), (b0 + 1, b1 - 1)), ((a1, None), (1, 0), (b0 + 1, bw - 1)),
             ((None, b0), (0, -1), (a0 + 1, a1 - 1)), ((None, bw), (0, 1), (aw + 1, a1 - 1))]
    zes = []
    for (es, et), (ns, nt), (m0, m1) in edges:
        for m in np.arange(m0, m1, 0.5):
            def crossing(ze):
                d = (Z3 - ze) / p
                ps, pt = (es + ns * d, m) if es is not None else (m, et + nt * d)
                return mns(*P(ps, pt)) - g - ze / 2
            grid = np.arange(1.2, 4.0, 0.05)
            vals = [crossing(z) for z in grid]
            k = next((k for k in range(1, len(grid)) if vals[k - 1] < 0 <= vals[k]), None)
            if k is not None:
                zes.append(float(grid[k]))
    ze = float(np.median(zes))
    d = (Z3 - ze) / p
    return (a0 - d, a1 + d, b0 - d, b1 + d, aw - d, bw + d), ze, p, share


def house_roof_z(rects, z0, p, s, t):
    """Haut du toit (au nu des murs, sans débord) en (s, t), ou None hors des rectangles."""
    best = None
    for s0, s1, t0, t1 in rects:
        if s0 <= s <= s1 and t0 <= t <= t1:
            z = z0 + p * min(s - s0, s1 - s, t - t0, t1 - t)
            best = z if best is None else max(best, z)
    return best


def measure_house(bid, b, spec):
    """Maison (D140). Repère : orientation du contour BD TOPO (origine au sommet `o`, s vers le sommet `s`, t du côté du contour).
    Contour du toit en L et pente ajustés au MNS (`house_fit`) ; murs = ce contour moins le débord `ov` (photo : gouttière) ; égout au nu des
    murs = haut ajusté au bord + débord × pente. Sol : médiane du terrain à 1,5-3 m du contour. Le reste vient de la photo (`manual.json`), dont la cheminée, trop fine pour le relevé."""
    from shapely.geometry import Point, Polygon
    o, a, sign, st = house_frame(b, spec)
    u, v = (math.cos(a), math.sin(a)), (-math.sin(a) * sign, math.cos(a) * sign)
    P = lambda s, t: (o[0] + u[0] * s + v[0] * t, o[1] + u[1] * s + v[1] * t)
    L, W1, sB, W2 = l_rects(st, spec["notch"])
    ring = pairs(b["ring"])
    xs, ys = [q[0] for q in ring], [q[1] for q in ring]
    key = "house_" + bid
    box_ = (math.floor(min(xs) - 8), math.floor(min(ys) - 8), math.ceil(max(xs) + 8), math.ceil(max(ys) + 8))
    mns, mnt = Raster("MNS", key, *box_), Raster("MNT", key, *box_)
    poly = Polygon(ring)
    outer = poly.buffer(3).exterior
    g = float(np.median([mnt(*outer.interpolate(d).coords[0]) for d in np.arange(0, outer.length, 0.5)
                         if not poly.buffer(1.5).contains(Point(outer.interpolate(d).coords[0]))]))
    (s0, s1, t0, t1, sw, tw), zedge, p, share = house_fit(mns, P, g, [(0.0, L, 0.0, W1), (sB, L, 0.0, W2)])
    ov = spec["ov"]
    walls = [(s0 + ov, s1 - ov, t0 + ov, t1 - ov), (sw + ov, s1 - ov, t0 + ov, tw - ov)]
    e = zedge + ov * p
    r2 = lambda q: round(float(q), 2)
    out = {"o": [r2(o[0]), r2(o[1])], "a": round(a, 5), "sg": sign, "g": r2(g), "eave": r2(e), "pitch": round(float(p), 3), "ov": ov,
           "walls": [[r2(q) for q in r] for r in walls], "fit": round(share, 2),
           "roof": roof_union(walls, e, p, ov), **{k: spec[k] for k in ("porch", "dormers", "openings", "colors")}}
    # Cheminée (photo : trop fine pour le relevé à 0,5 m) : à `ds` du bout sud-ouest, `dt` du faîtage du corps, `dz` au-dessus de lui.
    ds, dt, dz = spec["chimney"]
    ridge = e + p * (walls[0][3] - walls[0][2]) / 2
    out["chim"] = [r2(walls[0][0] + ds), r2((walls[0][2] + walls[0][3]) / 2 + dt), r2(ridge + dz)]
    return out


def house(tid, bid, b, spec, k):
    """Écrit le modèle `house` de la maison (kinds/<tuile>.json, type « house ») et sa silhouette lointaine (corps et aile). Rend (types
    changés, tuile des silhouettes si elle change)."""
    m = measure_house(bid, b, spec)
    (s0, s1, t0, t1), (sw, _, _, tw) = m["walls"]
    ridge = m["eave"] + m["pitch"] * (t1 - t0) / 2
    wing = m["eave"] + m["pitch"] * (s1 - sw) / 2
    print(f"  {bid} : corps de {s1 - s0:.2f} × {t1 - t0:.2f} m, aile de {s1 - sw:.2f} m avançant de {tw - t1:.2f} m (repère BD TOPO :"
          f" s {s0:.2f}, t {t0:.2f}) ; sol {m['g']}, égout {m['eave']} m, pente {math.degrees(math.atan(m['pitch'])):.0f}°, faîtages {ridge:.2f}"
          f" et {wing:.2f} m ; {m['fit']:.0%} du relevé à 30 cm près")
    o, a, sg = m["o"], m["a"], m["sg"]
    xy = lambda s, t: [round(o[0] + math.cos(a) * s - math.sin(a) * sg * t, 1), round(o[1] + math.sin(a) * s + math.cos(a) * sg * t, 1)]
    polys = [([xy(s0, t0), xy(s1, t0), xy(s1, t1), xy(s0, t1)], m["g"] + m["eave"], m["g"] + ridge),
             ([xy(sw, t1), xy(s1, t1), xy(s1, tw), xy(sw, tw)], m["g"] + m["eave"], m["g"] + wing)]
    lod = tid if replace_lod(tid, bid, polys) else None
    e = dict(k["buildings"].get(bid, {"k": "house"}))
    e["house"] = m
    if k["buildings"].get(bid) == e:
        return False, lod
    k["buildings"][bid] = e
    return True, lod


def measure_college(bid, b, spec):
    """Ailes d'un collège (D148) : pour chaque aile lue dans `manual.json` (bouts du faîtage, demi-largeur, bouts), le faîtage est la médiane de
    la crête (maximum à ±0,75 m de l'axe) sur le milieu de l'aile (20 à 80 %) et chaque égout est la droite ajustée sur la pente du toit
    (de 1 m de l'axe à 0,7 m du mur, médiane le long de l'aile : les lucarnes sont écartées) prolongée jusqu'au mur."""
    pts = [q for w in spec["wings"] for q in (w["p"], w["q"])]
    mns = Raster("MNS", bid[-8:] + "c", min(p[0] for p in pts) - 10, min(p[1] for p in pts) - 10, max(p[0] for p in pts) + 10, max(p[1] for p in pts) + 10)
    wings = []
    for w in spec["wings"]:
        (px, py), (qx, qy) = w["p"], w["q"]
        L = math.hypot(qx - px, qy - py)
        ux, uy = (qx - px) / L, (qy - py) / L
        nx, ny = -uy, ux
        hw = w["hw"]
        # Demi-largeurs de chaque côté (D151) : distance de l'axe aux murs du contour BD TOPO parallèles à l'aile, médiane (l'axe du faîtage n'est pas
        # au milieu du bâtiment : 0,5 m d'écart sur l'aile centrale) ; à défaut de mur à moins de 1,2 m de `hw`, la demi-largeur lue.
        ring = b["ring"]
        side = {1: [], -1: []}
        n_ring = len(ring) // 2
        for e in range(n_ring):
            ax_, ay_ = ring[2 * e], ring[2 * e + 1]
            bx_, by_ = ring[2 * ((e + 1) % n_ring)], ring[2 * ((e + 1) % n_ring) + 1]
            le = math.hypot(bx_ - ax_, by_ - ay_)
            if le < 6 or abs((bx_ - ax_) * uy - (by_ - ay_) * ux) / le > 0.18:
                continue
            for fr in (0.25, 0.5, 0.75):
                x_, y_ = ax_ + (bx_ - ax_) * fr, ay_ + (by_ - ay_) * fr
                u_ = (x_ - px) * ux + (y_ - py) * uy
                v_ = -(x_ - px) * uy + (y_ - py) * ux
                if 2 < u_ < L - 2 and abs(abs(v_) - hw) < 1.2:
                    side[1 if v_ > 0 else -1].append(abs(v_))
        wl = round(float(np.median(side[1])), 2) if len(side[1]) >= 2 else hw
        wr = round(float(np.median(side[-1])), 2) if len(side[-1]) >= 2 else hw
        lo, hi = w.get("win", [0.2, 0.8])
        ss = [lo * L + 0.5 * i for i in range(int((hi - lo) * L / 0.5))]
        at = lambda s_, o: mns(px + ux * s_ + nx * o, py + uy * s_ + ny * o)
        ridge = float(np.median([max(at(s_, o / 4) for o in range(-3, 4)) for s_ in ss]))
        eaves = []
        for sign in (1, -1):
            wside = wl if sign == 1 else wr
            os_ = [1.0 + 0.25 * i for i in range(int((wside - 0.7 - 1.0) / 0.25) + 1)]
            zs = [float(np.median([at(s_, sign * o) for s_ in ss])) for o in os_]
            k, c0 = np.polyfit(os_, zs, 1)
            eaves.append(float(k * wside + c0))
        if "eave" in w:  # aile trop courte pour ajuster une pente : égout imposé (repris d'une aile voisine)
            eaves = [w["eave"], w["eave"]]
        wing = {"p": w["p"], "q": w["q"], "wl": wl, "wr": wr, "el": round(eaves[0], 2), "er": round(eaves[1], 2), "r": round(ridge, 2), "a": w["a"], "b": w["b"]}
        for key in ("dl", "dr"):
            if key in w:
                kind, pitch = w[key].split(":")
                wing[key] = [kind, float(pitch)]
        wings.append(wing)
        print(f"  {w['name']} : {L:.1f} m, faîtage {ridge:.2f}, demi-largeurs {wl} et {wr}, égouts {eaves[0]:.2f} (gauche) et {eaves[1]:.2f} (droite)")
    out = {"wings": wings}
    if "pavilions" in spec:
        out["pavilions"] = spec["pavilions"]
    if "roof" in spec:
        out["roof"] = spec["roof"]
    if "grille" in spec:
        out["grille"] = measure_grille(bid, spec["grille"])
    return out


def measure_grille(bid, g):
    """Grille d'honneur (D149) : le tracé et le portail sont lus dans `manual.json` (clôture OpenStreetMap, photos), les murs remplacés et les
    arbres taillés sont vérifiés dans les tuiles (identifiants et tuples recopiés tels quels)."""
    walls, trees = set(), []
    for p in sorted((c.OUT / "tiles").glob("*_*.json")):
        t = json.loads(p.read_text())
        walls |= {w["id"] for w in t["walls"]}
        for q in t["trees"]:
            if any(math.hypot(q[0] - x, q[1] - y) < 0.05 for x, y in g["trees"]):
                trees.append(q)
    missing = [w for w in g["walls"] if w not in walls]
    if missing or len(trees) != len(g["trees"]):
        raise SystemExit(f"{bid} : grille : murs absents {missing}, arbres trouvés {len(trees)} sur {len(g['trees'])}")
    return {"a": g["a"], "b": g["b"], "walls": g["walls"], "trees": trees, "portal": g["portal"]}


def college(tid, bid, b, spec, k):
    """Écrit le modèle `college` (kinds/<tuile>.json), le plan de toit mesuré des annexes (`roof`) et la silhouette lointaine. Rend (types
    changés, tuile des silhouettes si elle change)."""
    from build_stores import fit_roof

    m = measure_college(bid, b, spec)
    e = dict(k["buildings"].get(bid, {"k": "school"}))
    e["college"] = m
    changed = k["buildings"].get(bid) != e
    k["buildings"][bid] = e
    polys = []
    for w in m["wings"]:
        (px, py), (qx, qy) = w["p"], w["q"]
        L = math.hypot(qx - px, qy - py)
        ux, uy = (qx - px) / L, (qy - py) / L
        pt = lambda s_, v: [round(px + ux * s_ - uy * v, 1), round(py + uy * s_ + ux * v, 1)]
        polys.append(([pt(0, w["wl"]), pt(L, w["wl"]), pt(L, -w["wr"]), pt(0, -w["wr"])], (w["el"] + w["er"]) / 2, w["r"]))
    lod = tid if replace_lod(tid, bid, polys) else None
    for aid in spec.get("annexes", []):
        ab = next((q for q in json.loads((c.OUT / "tiles" / f"{tid}.json").read_text())["buildings"] if q["id"] == aid), None)
        if ab is None or aid not in k["buildings"]:
            print(f"  annexe {aid} absente de {tid}")
            continue
        ring = ab["ring"]
        xs, ys = ring[0::2], ring[1::2]
        am = Raster("MNS", aid[-8:], min(xs) - 3, min(ys) - 3, max(xs) + 3, max(ys) + 3)
        plane, rms, n = fit_roof(ring, am)
        print(f"  annexe {aid[-8:]} : plan de toit {plane} (écart {rms * 100:.0f} cm sur {n} cellules)")
        ae = dict(k["buildings"][aid])
        ae["roof"] = plane
        if "annexRoof" in spec:
            ae["zinc"] = spec["annexRoof"]
        if k["buildings"][aid] != ae:
            k["buildings"][aid] = ae
            changed = True
    return changed, lod


def notredame(tid, bid, b, spec, k):
    """Écrit le modèle `nd` de Notre-Dame (D150) : nef et transept mesurés comme les ailes d'un collège (`measure_college`), bas-côtés (pente de
    leur toit, du haut contre la nef à l'égout, ajustée sur le relevé et extrapolée aux deux bouts), sommet du clocheton ; le chevet (`part`,
    autre bâtiment BD TOPO) devient une partie du modèle. Rend (types changés, tuile des silhouettes si elle change)."""
    m = measure_college(bid, b, spec)
    a = spec["a"]
    ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
    o = spec["o"]
    mns = Raster("MNS", bid[-8:] + "n", o[0] - 70, o[1] - 50, o[0] + 20, o[1] + 20)
    at = lambda s_, t: mns(o[0] + ux * s_ + vx * t, o[1] + uy * s_ + vy * t)
    tops, eaves = [], []
    for tin, tout in ((spec["t0"] - spec["hw"], spec["aisles"]["tNW"]), (spec["t0"] + spec["hw"], spec["aisles"]["tSE"])):
        sg = 1 if tout > tin else -1
        width = abs(tout - tin)
        ds = [1.5 + 0.25 * i for i in range(int((width - 2.4) / 0.25) + 1)]
        zs = [float(np.median([at(s_, tin + sg * d) for s_ in np.arange(3, spec["aisles"]["s1"] - 3, 0.5)])) for d in ds]
        kk, c0 = np.polyfit(ds, zs, 1)
        tops.append(float(c0))
        eaves.append(float(kk * width + c0))
    tu = spec["turret"]
    top = max(mns(tu["x"] + dx * 0.5, tu["y"] + dy * 0.5) for dx in range(-5, 6) for dy in range(-5, 6))
    nd = {"o": o, "a": a, "wings": m["wings"], "t0": spec["t0"], "hw": spec["hw"], "transept": spec["transept"],
          "aisles": {"s1": spec["aisles"]["s1"], "tNW": spec["aisles"]["tNW"], "tSE": spec["aisles"]["tSE"], "top": round(sum(tops) / 2, 2), "eave": round(sum(eaves) / 2, 2)},
          "front": spec["front"], "turret": {"x": tu["x"], "y": tu["y"], "r": tu["r"], "lantern": tu["lantern"], "top": round(float(top), 2)}}
    print(f"  bas-côtés : haut {tops[0]:.2f} / {tops[1]:.2f}, égout {eaves[0]:.2f} / {eaves[1]:.2f} ; clocheton jusqu'à {top:.2f}")
    e = dict(k["buildings"].get(bid, {"k": "church"}))
    e["nd"] = nd
    changed = k["buildings"].get(bid) != e
    k["buildings"][bid] = e
    for pid in spec.get("part", []):
        pe = {"k": "church", "ndPart": 1}
        if k["buildings"].get(pid) != pe:
            k["buildings"][pid] = pe
            changed = True
    A = nd["aisles"]
    pt = lambda s_, t: [round(o[0] + ux * s_ + vx * t, 1), round(o[1] + uy * s_ + vy * t, 1)]
    nv, tr = nd["wings"]
    ne = (nv["el"] + nv["er"]) / 2
    sL = math.hypot(nv["q"][0] - o[0], nv["q"][1] - o[1])
    t0, hw = spec["t0"], spec["hw"]
    polys = [([pt(0, t0 - hw), pt(sL, t0 - hw), pt(sL, t0 + hw), pt(0, t0 + hw)], ne, nv["r"]),
             ([pt(spec["transept"][0], -12.2), pt(spec["transept"][1], -12.2), pt(spec["transept"][1], 11.0), pt(spec["transept"][0], 11.0)], (tr["el"] + tr["er"]) / 2, tr["r"]),
             ([pt(0, A["tNW"]), pt(A["s1"], A["tNW"]), pt(A["s1"], A["tSE"]), pt(0, A["tSE"])], A["eave"], A["top"])]
    lod = tid if replace_lod(tid, bid, polys) else None
    return changed, lod


def simplify(pts, tol):
    """Douglas-Peucker sur une polyligne (d, z)."""
    if len(pts) < 3:
        return list(pts)
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    L = math.hypot(x1 - x0, y1 - y0) or 1e-9
    dist = [abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / L for x, y in pts[1:-1]]
    i = int(np.argmax(dist)) + 1
    if dist[i - 1] <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol)


def measure_janus(spec, wall):
    """Temple de Janus (D139) : cella carrée, contour OpenStreetMap (voie `wall` de la tuile). Les murs encore debout sont les côtés dont le
    MNS médian sur l'axe dépasse 6 m ; leur coin commun est l'origine, le repère suit le premier (s) puis le second (t). Au MNS : faces
    extérieure et intérieure de chaque mur debout (profil médian en travers, à mi-hauteur : le relevé est flou), profil du dessus le long de l'axe (plus
    haut point de la section, tous les 50 cm à 50 cm des bouts, médiane glissante sur 2,5 m, simplifié à 1,5 m près ; les photos montrent un dessus irrégulier mais pas hérissé) ; terre-plein intérieur (médiane du MNS à plus de 3,5 m des murs) et
    souches des murs arasés (médiane sur leur axe). Longueur de chaque mur : là où son dessus retombe sous la moitié de sa médiane
    (bouts cassés net ; le contour OpenStreetMap est plus petit). Sol : médiane du MNT à 5-9 m autour du carré. Ouvertures : photos (`manual.json`)."""
    P = pairs(wall["pts"])[:4]
    x0 = min(q[0] for q in P) - 12
    y0 = min(q[1] for q in P) - 12
    x1 = max(q[0] for q in P) + 12
    y1 = max(q[1] for q in P) + 12
    key = f"janus_{wall['id']}"
    mns = Raster("MNS", key, math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1))
    mnt = Raster("MNT", key, math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1))
    cx, cy = sum(q[0] for q in P) / 4, sum(q[1] for q in P) / 4
    ring = [(cx + r * math.cos(th), cy + r * math.sin(th)) for r in (13, 15) for th in np.arange(0, 2 * math.pi, math.pi / 24)]
    g = float(np.median([mnt(*q) for q in ring]))
    sides = []
    for i in range(4):
        a, b = P[i], P[(i + 1) % 4]
        L = math.dist(a, b)
        med = float(np.median([mns(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k) for k in np.linspace(0.15, 0.85, 15)
                               for _ in [0]] + [0])) - g
        # L'axe OSM n'est pas forcément sur le mur : on prend le meilleur décalage vers l'intérieur.
        n = ((cx - (a[0] + b[0]) / 2), (cy - (a[1] + b[1]) / 2))
        nl = math.hypot(*n)
        n = (n[0] / nl, n[1] / nl)
        med = max(float(np.median([mns(a[0] + (b[0] - a[0]) * k + n[0] * o, a[1] + (b[1] - a[1]) * k + n[1] * o) for k in np.linspace(0.15, 0.85, 15)])) - g
                  for o in np.arange(-1, 3.01, 0.25))
        sides.append((i, med, L))
    up = [i for i, med, _ in sides if med > 6]
    if len(up) != 2 or (up[1] - up[0]) % 4 not in (1, 3):
        raise SystemExit(f"temple de Janus : murs debout inattendus {sides}")
    i0, i1 = (up[0], up[1]) if (up[1] - up[0]) % 4 == 1 else (up[1], up[0])
    O = P[i1]  # coin commun : fin du côté i0, début du côté i1
    # Repère : s le long du mur i1 (depuis O), t le long du mur i0 vers son début (depuis O).
    A, B = P[(i1 + 1) % 4], P[i0]
    ua = ((A[0] - O[0]) / math.dist(O, A), (A[1] - O[1]) / math.dist(O, A))
    va = (-ua[1], ua[0])
    if (B[0] - O[0]) * va[0] + (B[1] - O[1]) * va[1] < 0:
        raise SystemExit("temple de Janus : repère non direct")
    Ls, Lt = math.dist(O, A), math.dist(O, B)
    XY = lambda s, t: (O[0] + ua[0] * s + va[0] * t, O[1] + ua[1] * s + va[1] * t)

    def faces(along_s):
        """Faces du mur couché le long de s (along_s) ou de t : bornes de la section à plus de 6 m."""
        L = Ls if along_s else Lt
        cs = np.arange(-3, 5.01, 0.25)
        prof = [float(np.median([mns(*(XY(d, c) if along_s else XY(c, d))) for d in np.arange(3, L - 3, 0.5)])) - g for c in cs]
        k = int(np.argmax(prof))
        half = prof[k] / 2  # mi-hauteur : le relevé (0,5 m) est flou sur les faces
        j0, j1 = k, k
        while j0 > 0 and prof[j0 - 1] > half:
            j0 -= 1
        while j1 + 1 < len(cs) and prof[j1 + 1] > half:
            j1 += 1
        return float(cs[j0]) - 0.125, float(cs[j1]) + 0.125

    tS0, tS1 = faces(True)   # mur le long de s : épaisseur en t
    sW0, sW1 = faces(False)  # mur le long de t : épaisseur en s
    # Nouvelle origine au coin extérieur mesuré.
    O = XY(sW0, tS0)
    Ls, Lt = Ls - sW0, Lt - tS0
    XY = lambda s, t: (O[0] + ua[0] * s + va[0] * t, O[1] + ua[1] * s + va[1] * t)
    twS, twW = tS1 - tS0, sW1 - sW0
    # Longueurs : là où le dessus du mur retombe sous la moitié de sa médiane (bout cassé net), près du coin OpenStreetMap.
    def end(along_s, L, tw):
        hz = lambda d: max(mns(*(XY(d, c) if along_s else XY(c, d))) for c in np.arange(0.25, tw - 0.24, 0.25)) - g
        half = float(np.median([hz(d) for d in np.arange(2, L - 2, 1.0)])) / 2
        return next(float(d) for d in np.arange(L - 4, L + 4, 0.25) if hz(d) < half)
    Ls, Lt = end(True, Ls, twS), end(False, Lt, twW)

    def top(along_s):
        L, tw = (Ls, twS) if along_s else (Lt, twW)
        ds = list(np.arange(0.5, L - 0.49, 0.5))
        zs = [max(mns(*(XY(d, c) if along_s else XY(c, d))) for c in np.arange(0.25, tw - 0.24, 0.25)) - g for d in ds]
        zs = [float(np.median(zs[max(0, i - 2):i + 3])) for i in range(len(zs))]  # médiane glissante sur 2,5 m
        pts = [(0.0, zs[0])] + list(zip(map(float, ds), zs)) + [(float(L), zs[-1])]
        return [[round(d, 2), round(z, 1)] for d, z in simplify(pts, 1.5)]

    inner = [mns(*XY(s, t)) for s in np.arange(twW + 3.5, Ls - 3.5, 0.5) for t in np.arange(twS + 3.5, Lt - 3.5, 0.5)]
    pod = float(np.median(inner)) - g
    low = float(np.median([mns(*XY(Ls - 1, t)) for t in np.arange(3, Lt - 3, 0.5)] + [mns(*XY(s, Lt - 1)) for s in np.arange(3, Ls - 3, 0.5)])) - g
    r2 = lambda q: round(float(q), 2)
    site = {"t": "janus", "n": spec["name"], "o": [r2(O[0]), r2(O[1])], "a": round(math.atan2(ua[1], ua[0]), 4), "L": [r2(Ls), r2(Lt)],
            "tw": [r2(twS), r2(twW)], "g": r2(g), "pod": r2(pod), "low": r2(low), "wall": wall["id"],
            "S": dict(spec["walls"]["S"], top=top(True)), "W": dict(spec["walls"]["W"], top=top(False)), "putlog": spec["putlog"]}
    if spec.get("light"):
        site["light"] = 1
    return site


def janus(spec, world):
    """Écrit le site `janus` dans kinds/<tuile>.json (créé s'il n'existe pas, et ajouté à l'index) et sa silhouette lointaine. Rend
    (tuile des types si elle change, tuile des silhouettes si elle change)."""
    for m in world["tiles"]:
        path = c.OUT / "tiles" / f"{m['id']}.json"
        if not path.exists():
            continue
        w = next((q for q in json.loads(path.read_text()).get("walls", []) if q["id"] == spec["osm"]), None)
        if w:
            break
    else:
        print(f"  temple : voie {spec['osm']} absente des murs des tuiles")
        return None, None
    tid = m["id"]
    site = measure_janus(spec, w)
    hS = max(q[1] for q in site["S"]["top"])
    hW = max(q[1] for q in site["W"]["top"])
    print(f"  {site['n']} : cella de {site['L'][0]} × {site['L'][1]} m, murs de {site['tw'][0]} / {site['tw'][1]} m d'épaisseur, jusqu'à"
          f" {hS} / {hW} m ; terre-plein à {site['pod']} m, souches à {site['low']} m (sol {site['g']})")
    a, (ox, oy) = site["a"], site["o"]
    xy = lambda s, t: [round(ox + math.cos(a) * s - math.sin(a) * t, 1), round(oy + math.sin(a) * s + math.cos(a) * t, 1)]
    Ls, Lt = site["L"]
    twS, twW = site["tw"]
    med = lambda tp: site["g"] + float(np.median([q[1] for q in tp]))
    polys = [([xy(0, 0), xy(Ls, 0), xy(Ls, twS), xy(0, twS)], med(site["S"]["top"]), med(site["S"]["top"])),
             ([xy(0, twS), xy(twW, twS), xy(twW, Lt), xy(0, Lt)], med(site["W"]["top"]), med(site["W"]["top"]))]
    lod = tid if replace_lod(tid, "temple-janus", polys, {"w": "#c59f6c", "t": "#8f8c4e", "m": "terrasse", "a": "medieval", "k": zlib.crc32(b"temple-janus")}) else None
    kp = KINDS / f"{tid}.json"
    k = json.loads(kp.read_text()) if kp.exists() else {"v": 1, "buildings": {}, "sites": []}
    sites = [q for q in k["sites"] if q.get("t") != "janus"] + [site]
    if sites == k["sites"]:
        return None, lod
    k["sites"] = sites
    kp.write_text(json.dumps(k, ensure_ascii=False, separators=(",", ":")))
    index = json.loads((KINDS / "index.json").read_text())
    if tid not in index["tiles"]:
        index["tiles"] = sorted(index["tiles"] + [tid])
    index["stats"]["sites"]["janus"] = 1
    (KINDS / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    return tid, lod


# --- Pierre de Couhard (D222, docs/plans/couhard.md) ------------------------------------------------------------------------------------

COUHARD_CAPS = 24  # secteurs de 15°, cap 0 = nord, sens horaire
COUHARD_LEVELS = list(range(1, 23))  # niveaux mesurés (m au-dessus du pré) ; le niveau 0 (pied) est extrapolé


def couhard_points(spec):
    """Nuage LiDAR HD (dalle COPC lue à distance) dans une fenêtre de 70 m autour de `spec["at"]`, en repère local ; mis en cache."""
    f = CACHE / "couhard_points.npz"
    if not f.exists():
        import laspy
        X, Y = c.ORIGIN[0] + spec["at"][0], c.ORIGIN[1] + spec["at"][1]
        meta = fetch.get("https://data.geopf.fr/wfs/ows", params={
            "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "IGNF_LIDAR-HD_METADONNEE:metadata",
            "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154", "COUNT": 5,
            "BBOX": f"{X - 1},{Y - 1},{X + 1},{Y + 1},urn:ogc:def:crs:EPSG::2154"}).json()["features"]
        with laspy.CopcReader.open(meta[0]["properties"]["url_npl"]) as r:
            p = r.query(laspy.copc.Bounds(mins=np.array([X - 35, Y - 35]), maxs=np.array([X + 35, Y + 35])))
        CACHE.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(f, x=np.array(p.x) - c.ORIGIN[0], y=np.array(p.y) - c.ORIGIN[1], z=np.array(p.z) - c.ORIGIN_Z,
                            c=np.array(p.classification))
    d = np.load(f)
    return d["x"], d["y"], d["z"], d["c"]


def measure_couhard(spec):
    """Pierre de Couhard (D222) : le classement IGN range la maçonnerie en « sol », on la mesure sur le nuage (classes 1, 2 et 6).
    - pré : plan ajusté sur le sol à 13-16 m de l'axe (médiane `g`) ;
    - axe : centroïde de la section à +10 m (au-dessus du talus) ; sommet : point le plus haut à moins de 4 m de l'axe ;
    - sections : par niveau de 1 m et par secteur de 15°, 90ᵉ centile du rayon des points à ± 0,5 m ; secteurs vides (ombres, cavité)
      interpolés entre voisins ; pas de surplomb de plus de 20 cm d'un niveau au suivant (aucun au-dessus de +18 m, la cheminée) ; pied (niveau 0) prolongé du talus ;
    - cavité, clôture, panneaux : photos (`manual.json`)."""
    x, y, z, cl = couhard_points(spec)
    stone = (cl <= 2) | (cl == 6)
    x0, y0 = spec["at"]
    r0 = np.hypot(x - x0, y - y0)
    ring = (cl == 2) & (r0 > 13) & (r0 < 16)
    g = float(np.median(z[ring]))
    A = np.c_[x[ring] - x0, y[ring] - y0, np.ones(int(ring.sum()))]
    plane = np.linalg.lstsq(A, z[ring], rcond=None)[0]
    band = stone & (np.abs(z - g - 10) < 1) & (r0 < 10)
    cx, cy = float(np.mean(x[band])), float(np.mean(y[band]))
    r = np.hypot(x - cx, y - cy)
    caps = np.degrees(np.arctan2(x - cx, y - cy)) % 360
    near = lambda s, half: np.abs(((caps - s + 180) % 360) - 180) < half
    k = int(np.argmax(np.where(stone & (r < 4), z, -1e9)))
    top = float(z[k] - g)
    rows = []
    for lv in COUHARD_LEVELS:
        row = []
        for i in range(COUHARD_CAPS):
            q = stone & near(i * 360 / COUHARD_CAPS, 180 / COUHARD_CAPS) & (np.abs(z - g - lv) < 0.5) & (r < 13)
            row.append(float(np.percentile(r[q], 90)) if q.sum() >= 2 else math.nan)
        rows.append(row)
    R = np.array(rows)
    for j in range(len(R)):  # secteurs vides : interpolation circulaire entre les secteurs mesurés du niveau
        ok = np.isfinite(R[j])
        if ok.sum() >= 3:
            idx = np.arange(COUHARD_CAPS)
            R[j] = np.interp(idx, np.r_[idx[ok] - COUHARD_CAPS, idx[ok], idx[ok] + COUHARD_CAPS], np.r_[R[j][ok], R[j][ok], R[j][ok]])
        else:  # sommet : trop peu de points, anneau de la médiane du niveau (ou, sans rien, 0,9 m)
            R[j] = float(np.nanmedian(R[j])) if ok.any() else 0.9
    for j in range(1, len(R)):
        R[j] = np.minimum(R[j], R[j - 1] + 0.2 if COUHARD_LEVELS[j] < 18 else R[j - 1])  # la cheminée ne s'évase pas
    foot = np.minimum(R[0] + 0.6 * np.maximum(R[0] - R[1], 0), 12.5)
    R = np.vstack([foot, R])
    tip = [round(float(x[k] - cx), 2), round(float(y[k] - cy), 2)]
    r2 = lambda q: round(float(q), 2)
    site = {"t": "couhard", "n": spec["name"], "c": [r2(cx), r2(cy)], "g": r2(g), "top": r2(top), "tip": tip,
            "lv": [0] + COUHARD_LEVELS, "r": [[round(float(v), 2) for v in row] for row in R],
            "cav": spec["cavity"], "fence": spec["fence"], "signs": spec["signs"], "panel": spec["panel"],
            "tufts": spec["tufts"]}
    if spec.get("light"):
        site["light"] = 1
    return site, (x0, y0, [float(v) for v in plane])


def couhard_foot(site, cap):
    """Rayon du pied au cap (degrés), interpolé entre secteurs."""
    f = site["r"][0]
    u = (cap % 360) / (360 / COUHARD_CAPS)
    i = int(math.floor(u)) % COUHARD_CAPS
    return f[i] + (f[(i + 1) % COUHARD_CAPS] - f[i]) * (u - math.floor(u))


def couhard_terrain(site, plane):
    """Relief fin (terrain/<tuile>.bin) : le MNT contient la pyramide (classée en sol) ; jusqu'à 1,5 m au-delà du pied, le relief devient le
    plan du pré (ajusté sur le nuage, pas sur les tuiles) ; de 1,5 à 4 m, il est écrêté sous une pente de 20 % depuis ce plan (le reste du
    cône du MNT). Une deuxième passe ne change rien. Au-delà, le MNT est déjà le pré (dépassement de la pente rapporté). Les blocs débordent de leur tuile : tous ceux qui touchent le disque sont réécrits. Rend
    (blocs réécrits, plus grande marche au bord)."""
    px, py, (a, b, k0) = plane
    cx, cy = site["c"]
    reach = max(site["r"][0]) + 6
    out, step = [], 0.0
    for path in sorted((c.OUT / "terrain").glob("*_*.bin")):
        buf = path.read_bytes()
        base, bx0, by1, n = (float(v) for v in np.frombuffer(buf[:16], dtype="<f4"))
        n = int(n)
        if not (bx0 - reach < cx < bx0 + n + reach and by1 - n - reach < cy < by1 + reach):
            continue
        cm = np.frombuffer(buf[16:], dtype="<u2").reshape(n, n).astype(np.int64)
        new = cm.copy()
        for row in range(max(0, int(by1 - cy - reach) - 1), min(n, int(by1 - cy + reach) + 2)):
            for col in range(max(0, int(cx - bx0 - reach) - 1), min(n, int(cx - bx0 + reach) + 2)):
                x, y = bx0 + col + 0.5, by1 - row - 0.5
                d = math.hypot(x - cx, y - cy) - couhard_foot(site, math.degrees(math.atan2(x - cx, y - cy)))
                zp = a * (x - px) + b * (y - py) + k0
                z0 = base + cm[row, col] * 0.01
                if d <= 1.5:
                    new[row, col] = round((zp - base) * 100)
                elif d <= 4:  # écrêté sous une pente de 20 % depuis le plan : un `min`, donc stable d'une passe à l'autre
                    new[row, col] = round((min(z0, zp + 0.2 * (d - 1.5)) - base) * 100)
                elif d <= 5:
                    step = max(step, z0 - (zp + 0.5))
        if (new < 0).any():
            raise SystemExit(f"Pierre de Couhard : relief sous la base du bloc {path.stem}")
        if (new != cm).any():
            path.write_bytes(buf[:16] + new.astype("<u2").tobytes())
            out.append(path.stem)
    return out, step


def couhard(spec, world):
    """Écrit le site `couhard` dans kinds/<tuile>.json (créé s'il n'existe pas, et ajouté à l'index), aplanit le relief sous le pied et pose
    la silhouette lointaine (anneaux étagés). Rend (tuile des types si elle change, tuile des silhouettes si elle change)."""
    site, plane = measure_couhard(spec)
    cx, cy = site["c"]
    m = next(t for t in world["tiles"] if t["bounds"][0] <= cx < t["bounds"][2] and t["bounds"][1] <= cy < t["bounds"][3])
    tid = m["id"]
    print(f"  {site['n']} : axe ({cx} ; {cy}), pré {site['g']}, sommet +{site['top']} m ; pied de {min(site['r'][0]):.1f} à {max(site['r'][0]):.1f} m,"
          f" {np.median(site['r'][10]):.1f} m à +10 m")
    blocks, step = couhard_terrain(site, plane)
    print(f"  relief aplani sous le pied : {', '.join(blocks) or 'déjà fait'} ; dépassement de la pente à 4-5 m du pied : {step:.2f} m")
    polys = []
    for lo, hi in ((2, 10), (10, 13), (13, 17), (17, 21)):
        ring = site["r"][lo]
        pts = []
        for i in range(0, COUHARD_CAPS, 2):
            a = math.radians(i * 360 / COUHARD_CAPS)
            pts.append([round(cx + ring[i] * math.sin(a), 1), round(cy + ring[i] * math.cos(a), 1)])
        zt = site["g"] + (site["top"] if hi == 21 else hi)
        polys.append((pts, zt, zt))
    lod = tid if replace_lod(tid, "pierre-de-couhard", polys, {"w": "#8c8172", "t": "#8c8172", "m": "terrasse", "a": "medieval", "k": zlib.crc32(b"pierre-de-couhard")}) else None
    kp = KINDS / f"{tid}.json"
    k = json.loads(kp.read_text()) if kp.exists() else {"v": 1, "buildings": {}, "sites": []}
    sites = [q for q in k["sites"] if q.get("t") != "couhard"] + [site]
    if sites == k["sites"]:
        return None, lod
    k["sites"] = sites
    kp.write_text(json.dumps(k, ensure_ascii=False, separators=(",", ":")))
    index = json.loads((KINDS / "index.json").read_text())
    if tid not in index["tiles"]:
        index["tiles"] = sorted(index["tiles"] + [tid])
    index["stats"]["sites"]["couhard"] = 1
    (KINDS / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    return tid, lod


def track_surfaces(fixes):
    """Revêtement des pistes d'après photo (`tracks` de manual.json) : la piste de kinds/<tuile>.json dont un sommet est à moins de 15 m
    du point donné prend `s` (« dirt » : terre battue, dessinée rouge-brun au lieu du rouge des pistes synthétiques). Rend les tuiles changées."""
    out = set()
    for fix in fixes:
        x, y = fix["at"]
        tid = f"{int((x + c.ORIGIN[0]) // c.TILE) - c.GRID_I0}_{int((y + c.ORIGIN[1]) // c.TILE) - c.GRID_J0}"
        path = KINDS / f"{tid}.json"
        k = json.loads(path.read_text())
        hit = [q for q in k["sites"] if q["t"] == "track" and min(math.dist((x, y), p) for p in pairs(q["r"])) < 15]
        if len(hit) != 1:
            raise SystemExit(f"piste introuvable près de {fix['at']} ({len(hit)})")
        if hit[0].get("s") != fix["s"]:
            hit[0]["s"] = fix["s"]
            path.write_text(json.dumps(k, ensure_ascii=False, separators=(",", ":")))
            out.add(tid)
    return out


def main():
    data = json.load(open(c.ROOT / "tools" / "data" / "manual.json"))
    fixed = track_surfaces(data.get("tracks", []))
    if fixed:
        print(f"  revêtement des pistes : {', '.join(sorted(fixed))}")
    manual = data.get("monuments", {})
    if len(sys.argv) > 1:  # `python3 build_monuments.py <modèle>` : un seul modèle (les autres demandent les rasters LiDAR de leur zone)
        manual = {k: v for k, v in manual.items() if v["model"] == sys.argv[1]}
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

    def ring_of(bid):
        for m in world["tiles"]:
            if m.get("buildings"):
                for b in json.loads((c.OUT / "tiles" / f"{m['id']}.json").read_text())["buildings"]:
                    if b["id"] == bid:
                        return b["ring"]
        raise SystemExit(f"{bid} absent des tuiles")

    def kinds_all():
        for p in sorted(KINDS.glob("*_*.json")):
            yield p.stem, kinds.setdefault(p.stem, json.loads(p.read_text()))

    for bid, spec in manual.items():
        if spec["model"] == "gate":
            tid, lod = gate(spec, kinds_all, ring_of)
            if tid:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "janus":
            _, lod = janus(spec, world)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "couhard":
            _, lod = couhard(spec, world)
            if lod:
                changed_lod.add(lod)
            continue
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
        if spec["model"] == "theatre":
            if theatre(tid, bid, b, spec, k):
                changed.add(tid)
            continue
        if spec["model"] == "house":
            ch, lod = house(tid, bid, b, spec, k)
            if ch:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "college":
            ch, lod = college(tid, bid, b, spec, k)
            if ch:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "notredame":
            ch, lod = notredame(tid, bid, b, spec, k)
            if ch:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "vallon":
            ch, lod = vallon(tid, bid, b, spec, k)
            if ch:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "hexagone":
            ch, lod = hexagone(tid, bid, b, spec, k)
            if ch:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "playhouse":
            ch, lod = playhouse(tid, bid, b, spec, k)
            if ch:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "eduen":
            ch, lod = eduen(tid, bid, b, spec, k)
            if ch:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "station":
            ch, lod = station(tid, bid, b, spec, k)
            if ch:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
            continue
        if spec["model"] == "chapel":
            ch, lod = chapel(tid, bid, b, spec, k, kinds_all)
            if ch:
                changed.add(tid)
            if lod:
                changed_lod.add(lod)
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
    if not sys.argv[1:] or sys.argv[1] in ("vallon", "pitches"):
        spec = data.get("pitches")
        if spec and pitches(spec, kinds):
            changed.add(spec["tile"])
    for tid in changed:
        (KINDS / f"{tid}.json").write_text(json.dumps(kinds[tid], ensure_ascii=False, separators=(",", ":")))
    print(f"{len(manual)} monument(s) d'après photo ; {len(changed)} fichier(s) de types et {len(changed_lod)} de silhouettes réécrit(s)")


def pitches(spec, kinds):
    """Terrains du collège (D176) : revêtement (`surf`), rectangle de jeu (`court`) et paniers (`hoops`) posés dans les sites `pitch` de kinds/<tuile>.json,
    retrouvés par le centre de leur rectangle (à 3 m près). Vrai si le fichier change."""
    tid = spec["tile"]
    k = kinds.setdefault(tid, json.loads((KINDS / f"{tid}.json").read_text()))
    changed = False
    for want in spec["list"]:
        site = min((q for q in k["sites"] if q.get("t") == "pitch"), key=lambda q: math.dist(q["box"][:2], want["at"]), default=None)
        if site is None or math.dist(site["box"][:2], want["at"]) > 3:
            raise SystemExit(f"terrain en {want['at']} : absent de {tid}")
        for key in ("surf", "court", "hoops"):
            if key in want and site.get(key) != want[key]:
                site[key] = want[key]
                changed = True
        print(f"  terrain {site['s']} en {want['at']} : {want.get('surf')} ; {len(want.get('hoops', []))} panier(s)")
    return changed


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


def replace_lod(tid, bid, polys, base=None):
    """Remplace les prismes du bâtiment (même clé) dans lod/<tuile>.json par `polys` (contour en [x, y], égout, haut), à la place du premier ;
    le reste du fichier est inchangé. Avec `base` (couleurs, toit, époque), les ajoute à la fin s'il n'y en a pas (monument sans bâtiment,
    D137). Vrai si réécrit."""
    path = LOD / f"{tid}.json"
    if not path.exists():
        return False
    lod = json.loads(path.read_text())
    key = zlib.crc32(bid.encode())
    mine = [e for e in lod if e["k"] == key]
    if not mine and base is None:
        return False
    base = base or {k: v for k, v in mine[0].items() if k not in ("r", "e", "g")}
    new = [{"r": [v for q in pts for v in q], "e": round(e, 1), "g": round(g, 1), **base} for pts, e, g in polys]
    if mine == new:
        return False
    i = lod.index(mine[0]) if mine else len(lod)
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
