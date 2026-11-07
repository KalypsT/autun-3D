"""Terrils des Télots (D269, docs/plans/terrils-telots.md) : schiste rose et noir, petits arbres de la face nue, sentiers en lacets.

Usage :
  python3 tools/data/build_terrils.py --trace   trace les lacets sur le relief publié (pas encore creusé) et écrit tools/data/terrils.json
  python3 tools/data/build_terrils.py           applique : relief creusé le long des sentiers, sols, arbres, poids des sols, lieu de la carte

Les deux terrils de l'ancienne mine des Télots (OSM `way/907818795` et `way/907818796`, fermés en 1957) sont dans le relief LiDAR du jeu ;
ce script leur donne leur peau, d'après l'orthophotographie IGN (0,5 m) et le modèle de hauteur (MNS − MNT) :
- **schiste rose** (schiste brûlé, photos 1 à 4) : pixels rose saumon (rouge > vert > bleu, écart rouge − bleu marqué), sans arbre ; petits trous
  (arbustes) bouchés ; sol `schist_red` ;
- **schiste noir** au pied (photos 1 à 3) : pixels gris-bleu sombres et peu saturés, sans arbre, à moins de 60 m d'un terril ; sol `schist_black` ;
- **petits arbres de la face rose** (bouleaux, photo 2) : taches vertes de 1 à 14 m² sur le schiste rose, absentes du relevé LiDAR (trop basses) ;
- **sentiers en lacets** (`terrils.json`) : du sommet au pied, branches à 9 %, 12 % en moyenne et 16 % au plus avec les virages (un vélo y monte
  à 6 à 9 km/h), 2,5 m de large, virages de 3,5 m de rayon élargis de 2 m de chaque côté ; déblai et remblai de 2 m au plus ;
  le relief fin est creusé : plat sur la largeur du sentier, talus à 45° de part et d'autre jusqu'à rejoindre la pente ; replat de 3 m au sommet ;
  sol `path_schist` ; arbres retirés à moins de 3 m de l'axe ;
- **poids des sols** (relief vu de loin, super-tuiles) : schiste rose en ocre, schiste noir en gris assombri ;
- **lieu** « Terrils des Télots » (point de vue) dans la carte.
Une deuxième passe ne change rien (le tracé est figé dans terrils.json ; les arbres ajoutés ne sont pas dédoublés).
"""

import argparse
import io
import json
import math
from pathlib import Path

import numpy as np
import requests
import shapely
from PIL import Image
from scipy import ndimage
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

import config as c
import survey_croix as sv

OUT = c.OUT
CACHE = c.ROOT / ".cache" / "telots"
TRACE = Path(__file__).with_name("terrils.json")
# Emprise de travail (repère local) : les deux terrils, leur pied et les dépôts de schiste noir.
BOX = (-220.0, 3480.0, 660.0, 4060.0)
RES = 0.5
HEAPS = {"est": 907818795, "ouest": 907818796}
# Sommets approchés (points OSM `natural=peak`) ; le vrai sommet est cherché autour dans le relief.
PEAKS = {"est": (354.0, 3773.0), "ouest": (117.0, 3760.0)}
# Lacets : secteur (azimut du centre, demi-ouverture, en degrés) où le sentier descend en zigzag. Terril est : la face rose (sud-est à sud-ouest),
# vers le pré et l'étang ; terril ouest : vers l'ouest, la rue des Télots et le stand de tir.
SECTORS = {"est": (165.0, 62.0), "ouest": (250.0, 55.0)}
GRADE = 0.09        # pente visée des branches du sentier (les virages en rattrapent un peu)
GRADE_MAX = 0.16    # pente maximale du profil (virages)
WIDTH = 2.5         # largeur plate du sentier (m)
BANK = 1.0          # talus : 1 m de dénivelé par mètre (45°)
TURN = 3.5          # rayon des virages (m)
SPIRAL = 22.0       # sous ce rayon autour du sommet, pas de lacet : le sentier tourne autour de la pointe
TOP = 3.0           # rayon du replat du sommet
CLEAR = 3.0         # arbres retirés à moins de CLEAR m de l'axe
HAIRPIN_GRADE = 0.05  # pente maximale dans les virages
HAIRPIN = 2.0       # élargissement (m de chaque côté) dans les virages serrés : un replat où vélos et voitures tournent sans monter sur le talus
UNIT = 0.01


# --- Sources ------------------------------------------------------------------------------------------------------------------
def osm_heaps():
    f = CACHE / "osm.xml"
    if not f.exists():
        import xml.etree.ElementTree  # noqa: F401  (vérifie la présence du module avant de télécharger)
        r = requests.get("https://api.openstreetmap.org/api/0.6/map", params={"bbox": "4.296,46.977,4.309,46.984"},
                         headers={"User-Agent": c.USER_AGENT}, timeout=300)
        r.raise_for_status()
        CACHE.mkdir(parents=True, exist_ok=True)
        f.write_bytes(r.content)
    import xml.etree.ElementTree as ET
    root = ET.fromstring(f.read_bytes())
    nodes = {n.get("id"): sv.local(float(n.get("lat")), float(n.get("lon"))) for n in root.iter("node")}
    out = {}
    for w in root.iter("way"):
        for name, wid in HEAPS.items():
            if int(w.get("id")) == wid:
                out[name] = Polygon([nodes[nd.get("ref")] for nd in w.findall("nd")]).buffer(0)
    missing = set(HEAPS) - set(out)
    if missing:
        raise SystemExit(f"terrils introuvables dans OpenStreetMap : {missing}")
    return out


class Mosaic:
    """Relief fin publié des tuiles de l'emprise, réuni sur la grille mondiale (pixels de 1 m, phase commune `world.lattice`)."""

    def __init__(self, world):
        self.world = world
        self.tiles = [t for t in world["tiles"] if t["bounds"][2] > BOX[0] - 5 and t["bounds"][0] < BOX[2] + 5
                      and t["bounds"][3] > BOX[1] - 5 and t["bounds"][1] < BOX[3] + 5]
        self.heads = {}
        blocks = {}
        for t in self.tiles:
            b = (OUT / "terrain" / f"{t['id']}.bin").read_bytes()
            base, ox, oy, n = np.frombuffer(b[:16], dtype="<f4")
            n = int(n)
            self.heads[t["id"]] = (float(ox), float(oy), n)
            blocks[t["id"]] = np.frombuffer(b, dtype="<u2", count=n * n, offset=16).reshape(n, n) * UNIT + float(base)
        self.x0 = min(h[0] for h in self.heads.values())
        self.y1 = max(h[1] for h in self.heads.values())
        x1 = max(h[0] + h[2] for h in self.heads.values())
        y0 = min(h[1] - h[2] for h in self.heads.values())
        self.h = np.full((round(self.y1 - y0), round(x1 - self.x0)), np.nan, dtype=np.float64)
        for tid, (ox, oy, n) in self.heads.items():
            r0, c0 = round(self.y1 - oy), round(ox - self.x0)
            self.h[r0:r0 + n, c0:c0 + n] = blocks[tid]
        ys = self.y1 - (np.arange(self.h.shape[0]) + 0.5)
        xs = self.x0 + (np.arange(self.h.shape[1]) + 0.5)
        self.X, self.Y = np.meshgrid(xs, ys)

    def at(self, x, y):
        """Interpolation bilinéaire (comme Terrain.heightAt)."""
        fx = np.asarray(x) - self.x0 - 0.5
        fy = self.y1 - np.asarray(y) - 0.5
        return ndimage.map_coordinates(self.h, [np.atleast_1d(fy), np.atleast_1d(fx)], order=1, mode="nearest")

    def write(self, new):
        changed = []
        for tid, (ox, oy, n) in self.heads.items():
            r0, c0 = round(self.y1 - oy), round(ox - self.x0)
            blk = new[r0:r0 + n, c0:c0 + n]
            cm = np.round(blk / UNIT).astype(np.int64)
            lo = int(cm.min())
            data = (cm - lo).astype("<u2")
            head = np.array([lo * UNIT, ox, oy, n], dtype="<f4")
            p = OUT / "terrain" / f"{tid}.bin"
            text = head.tobytes() + data.tobytes()
            if p.read_bytes() != text:
                p.write_bytes(text)
                changed.append(tid)
        return changed


# --- Tracé des lacets ---------------------------------------------------------------------------------------------------------
def summit(m, name):
    px, py = PEAKS[name]
    near = np.hypot(m.X - px, m.Y - py) < 45
    k = np.nanargmax(np.where(near, m.h, -np.inf))
    return float(m.X.flat[k]), float(m.Y.flat[k]), float(m.h.flat[k])


def trace_one(m, name, smooth):
    sx, sy, sz = summit(m, name)
    az, half = (math.radians(v) for v in SECTORS[name])
    gy, gx = np.gradient(smooth)  # par pixel de 1 m ; lignes vers le sud
    gx_at = lambda x, y: float(ndimage.map_coordinates(gx, [[m.y1 - y - 0.5], [x - m.x0 - 0.5]], order=1)[0])
    gy_at = lambda x, y: -float(ndimage.map_coordinates(gy, [[m.y1 - y - 0.5], [x - m.x0 - 0.5]], order=1)[0])
    # Départ : au bord du replat du sommet, du côté du secteur.
    x, y = sx + TOP * math.sin(az), sy + TOP * math.cos(az)
    hx, hy = math.sin(az), math.cos(az)
    side = 1
    pts = [(sx, sy), (x, y)]
    base = float(np.nanpercentile(m.h[np.hypot(m.X - sx, m.Y - sy) < 220], 5))
    for _ in range(4000):
        ux, uy = gx_at(x, y), gy_at(x, y)
        g = math.hypot(ux, uy)
        r = math.hypot(x - sx, y - sy)
        z = float(m.at(x, y)[0])
        if z < base + 1.5 or (g < GRADE * 1.2 and r > 60):
            break
        dx, dy = (-ux / g, -uy / g) if g > 1e-6 else (hx, hy)
        # Lacet : hors du secteur, si le sens de parcours (tangente à la pente, côté `side`) éloigne encore du secteur, on repart dans l'autre sens.
        # Décidé d'après la tangente et non le cap : pendant le virage, le cap s'éloigne encore quelques mètres sans faire rebasculer.
        theta = math.atan2(x - sx, y - sy)
        rel = (theta - az + math.pi) % (2 * math.pi) - math.pi
        tx, ty = -dy * side, dx * side
        spin = (y - sy) * tx - (x - sx) * ty  # > 0 : l'azimut autour du sommet augmente (sens horaire)
        if r > SPIRAL and abs(rel) > half and (rel > 0) == (spin > 0):
            side = -side
            tx, ty = -tx, -ty
        if g > GRADE:
            sa = GRADE / g
            want = (tx * math.sqrt(1 - sa * sa) + dx * sa, ty * math.sqrt(1 - sa * sa) + dy * sa)
        else:
            want = (dx, dy)
        # Virage de rayon TURN au plus.
        cur = math.atan2(hx, hy)
        tgt = math.atan2(*want)
        d = (tgt - cur + math.pi) % (2 * math.pi) - math.pi
        cur += max(-1 / TURN, min(1 / TURN, d))
        hx, hy = math.sin(cur), math.cos(cur)
        x, y = x + hx, y + hy
        pts.append((x, y))
    line = LineString(pts)
    # Profil : du sommet au pied, jamais en montée, au plus GRADE_MAX ; puis lissé et reborné.
    s = np.arange(0, line.length, 1.0)
    xy = np.array([line.interpolate(v).coords[0] for v in s])
    zt = m.at(xy[:, 0], xy[:, 1])
    zt[s <= TOP] = sz - 0.3
    # Deux profils gloutons qui respectent la pente (0 à GRADE_MAX) : l'un du sommet (au-dessus du terrain : remblai), l'autre du pied
    # (en dessous : déblai) ; leur moyenne respecte aussi la pente et partage les virages entre déblai et remblai. Puis lissage et rebornage.
    # Virages presque plats (HAIRPIN_GRADE) : on y coupe la corde, plus courte, donc plus raide ; les branches droites rattrapent.
    gmax = GRADE_MAX - (GRADE_MAX - HAIRPIN_GRADE) * (half_widths(xy) - WIDTH / 2) / HAIRPIN

    def bounded(z):
        for i in range(1, len(z)):
            z[i] = min(z[i - 1], max(z[i], z[i - 1] - gmax[i]))
        return z

    top = bounded(zt.copy())
    foot = zt.copy()
    for i in range(len(foot) - 2, -1, -1):
        foot[i] = max(foot[i + 1], min(foot[i], foot[i + 1] + gmax[i + 1]))
    z = (top + foot) / 2
    for _ in range(3):
        z = bounded(ndimage.uniform_filter1d(z, 7, mode="nearest"))
    z[0] = sz - 0.3
    z = bounded(z)
    print(f"terril {name} : sommet ({sx:.1f} ; {sy:.1f}) à {sz + c.ORIGIN_Z:.1f} m, sentier {line.length:.0f} m, "
          f"de {z[0] + c.ORIGIN_Z:.1f} à {z[-1] + c.ORIGIN_Z:.1f} m ; pied du relief {base + c.ORIGIN_Z:.1f} m")
    return {"summit": [round(sx, 2), round(sy, 2), round(sz, 2)],
            "path": [[round(float(a), 2), round(float(b), 2), round(float(h), 2)] for (a, b), h in zip(xy, z)]}


def trace():
    world = json.loads((OUT / "world.json").read_text())
    m = Mosaic(world)
    smooth = ndimage.gaussian_filter(np.nan_to_num(m.h, nan=float(np.nanmean(m.h))), 3.0)
    doc = {"_doc": "Sentiers en lacets des terrils des Télots (build_terrils.py --trace, D269) : sommet (x, y, z du relief non creusé) et axe "
                   "du sentier, un point par mètre (x, y, altitude du sentier), repère local, altitudes au-dessus de ORIGIN_Z."}
    for name in HEAPS:
        doc[name] = trace_one(m, name, smooth)
    TRACE.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    print(f"écrit {TRACE.relative_to(c.ROOT)}")


# --- Relief creusé ------------------------------------------------------------------------------------------------------------
def half_widths(path):
    """Demi-largeur plate du sentier en chaque point : WIDTH / 2, plus HAIRPIN dans les virages (courbure lissée sur une dizaine de mètres)."""
    p = np.asarray(path)[:, :2]
    head = np.unwrap(np.arctan2(np.diff(p[:, 0]), np.diff(p[:, 1])))
    turn = np.abs(np.gradient(head)) if len(head) > 2 else np.zeros(len(head))
    k = np.concatenate([turn, turn[-1:]])
    f = np.clip((k - 0.08) / 0.12, 0, 1)
    f = ndimage.uniform_filter1d(ndimage.maximum_filter1d(f, 9), 5)
    return WIDTH / 2 + HAIRPIN * f


def carve(m, paths):
    """Relief fin le long des sentiers : plat sur la largeur, talus à 45° jusqu'à la pente ; replat au sommet. Idempotent."""
    h = m.h.copy()
    pts = np.concatenate([np.array(p["path"]) for p in paths.values()])
    leg = np.concatenate([np.full(len(p["path"]), i) for i, p in enumerate(paths.values())])
    hw = np.concatenate([half_widths(p["path"]) for p in paths.values()])
    from scipy.spatial import cKDTree
    tree = cKDTree(pts[:, :2])
    reach = WIDTH / 2 + 12.0
    d, k = tree.query(np.stack([m.X.ravel(), m.Y.ravel()], axis=1), distance_upper_bound=reach)
    ok = np.isfinite(d)
    idx = np.flatnonzero(ok)
    k = k[ok]
    # Distance à l'axe (segment) plutôt qu'au point le plus proche, et altitude interpolée sur le segment.
    px, py = m.X.ravel()[idx], m.Y.ravel()[idx]
    best_d = np.full(len(idx), np.inf)
    best_z = np.zeros(len(idx))
    best_w = np.full(len(idx), WIDTH / 2)
    for off in (-1, 0):
        a = np.clip(k + off, 0, len(pts) - 1)
        b = np.clip(a + 1, 0, len(pts) - 1)
        same = leg[a] == leg[b]
        ax, ay, az = pts[a, 0], pts[a, 1], pts[a, 2]
        vx, vy = pts[b, 0] - ax, pts[b, 1] - ay
        L2 = np.maximum(vx * vx + vy * vy, 1e-9)
        t = np.where(same, np.clip(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1), 0)
        dd = np.hypot(px - ax - t * vx, py - ay - t * vy)
        zz = az + t * (pts[b, 2] - az)
        better = dd < best_d
        best_d = np.where(better, dd, best_d)
        best_z = np.where(better, zz, best_z)
        best_w = np.where(better, hw[a] + t * (hw[b] - hw[a]), best_w)
    e = np.maximum(best_d - best_w, 0)
    flat = h.ravel()
    flat[idx] = np.clip(flat[idx], best_z - BANK * e, best_z + BANK * e)
    h = flat.reshape(h.shape)
    # Replat du sommet : TOP m de rayon, 0,3 m sous la pointe, talus autour.
    for p in paths.values():
        sx, sy, sz = p["summit"]
        zt = sz - 0.3
        r = np.hypot(m.X - sx, m.Y - sy)
        near = r < TOP + 8
        e = np.maximum(r[near] - TOP, 0)
        h[near] = np.clip(h[near], zt - BANK * e, zt + BANK * e)
    return h


# --- Sols d'après l'orthophotographie -----------------------------------------------------------------------------------------
def classify(heaps):
    rgb = np.asarray(sv.ortho(BOX, RES)).astype(np.float32)
    mnt, mns = sv.dem("MNT", BOX, RES), sv.dem("MNS", BOX, RES)
    canopy = np.nan_to_num(mns.a - mnt.a, nan=0.0)
    H, W = rgb.shape[:2]
    canopy = canopy[:H, :W]
    xs = BOX[0] + (np.arange(W) + 0.5) * RES
    ys = BOX[3] - (np.arange(H) + 0.5) * RES
    X, Y = np.meshgrid(xs, ys)
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    bright = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    both = unary_union(list(heaps.values()))
    near = shapely.contains_xy(both.buffer(20.0), X, Y)
    near40 = shapely.contains_xy(both.buffer(40.0), X, Y)
    open_ = canopy < 2.0
    # Couleurs mesurées sur l'orthophotographie (moyennes de carrés de 6 m) : face nue (171, 165, 152), beige à peine rosé (rouge ≥ vert > bleu) ;
    # schiste noir (145, 146, 152), gris bleuté et clair ; forêt (47, 62, 66), sombre et bleutée ; pré (97, 119, 106), vert.
    bare = (bright > 118) & (R >= G - 3) & (R - B > 8) & near
    grey = (bright > 86) & (bright < 185) & (B >= R + 1) & (B >= G - 1) & (sat < 22) & open_ & near
    green = (G > R + 4) & (G > B + 4) & (bright < 150) & near
    # Face nue : densité de pixels nus sur 7 m (les arbustes la tachettent sans l'interrompre).
    win = int(round(7.0 / RES))
    pink = ndimage.uniform_filter((bare & open_).astype(np.float32), win) > 0.32
    black = ndimage.uniform_filter(grey.astype(np.float32), win) > 0.4

    def clean(mask, close, min_px, hole_px):
        mask = ndimage.binary_opening(mask, iterations=1)
        mask = ndimage.binary_closing(mask, iterations=close)
        lab, n = ndimage.label(mask)
        if n:
            size = np.bincount(lab.ravel())
            mask = size[lab] >= min_px
            mask &= lab > 0
        holes = ~mask
        lab, n = ndimage.label(holes)
        if n:
            size = np.bincount(lab.ravel())
            mask |= (size[lab] < hole_px) & (lab > 0)
        return mask

    pink = clean(pink, 2, 400, 800)        # taches de 100 m² au moins, trous de moins de 200 m² bouchés
    black = clean(black, 2, 240, 240) & ~pink
    # Petits arbres : taches vertes sur la face rose (bouchée), basses (absentes du relevé des arbres LiDAR).
    face = ndimage.binary_dilation(pink, iterations=3)
    lab, n = ndimage.label(ndimage.binary_opening(green, iterations=1) & face)
    shrubs = []
    if n:
        idx = np.arange(1, n + 1)
        area = ndimage.sum(np.ones_like(lab, dtype=np.float32), lab, idx) * RES * RES
        cy_, cx_ = np.array(ndimage.center_of_mass(lab > 0, lab, idx)).T
        hmax = ndimage.maximum(canopy, lab, idx)
        for a, r_, c_, hm in zip(area, cy_, cx_, hmax):
            if 1.0 <= a <= 14.0:
                shrubs.append((BOX[0] + (c_ + 0.5) * RES, BOX[3] - (r_ + 0.5) * RES, float(a), float(hm)))
    return {"pink": pink, "black": black, "X": X, "Y": Y}, shrubs


def polygonize(mask, X, Y, simplify=0.6):
    """Masque à 0,5 m → polygones lissés (unions de carrés de 1 m, arrondis)."""
    m2 = mask[: mask.shape[0] // 2 * 2, : mask.shape[1] // 2 * 2]
    m2 = m2.reshape(m2.shape[0] // 2, 2, m2.shape[1] // 2, 2).mean(axis=(1, 3)) >= 0.5
    r, cidx = np.nonzero(m2)
    x0, y1 = X[0, 0] - RES / 2, Y[0, 0] + RES / 2
    boxes = shapely.box(x0 + cidx, y1 - r - 1, x0 + cidx + 1, y1 - r)
    g = shapely.union_all(boxes)
    g = g.buffer(0.8, join_style="round").buffer(-1.3, join_style="round").buffer(0.5).simplify(simplify)
    return g


def to_rings(g, min_area=1.0):
    out = []
    for p in getattr(g, "geoms", [g]):
        if p.geom_type != "Polygon" or p.area < min_area:
            continue
        p = shapely.set_precision(p, 0.01)
        if p.is_empty or p.geom_type != "Polygon":
            continue
        out.append([[round(v, 2) for q in list(r_.coords)[:-1] for v in q] for r_ in (p.exterior, *p.interiors)])
    return out


def from_rings(poly):
    rings = [[(r[i], r[i + 1]) for i in range(0, len(r), 2)] for r in poly]
    return Polygon(rings[0], rings[1:]).buffer(0)


# --- Poids des sols (relief vu de loin) ---------------------------------------------------------------------------------------
def paint_weights(world, tiles, masks):
    """Tuiles : poids à 1 m ; super-tuiles : poids à 4 m. Schiste rose : ocre (A.g) et un peu de gravier (A.b) ; noir : asphalte (A.r) assombri (B.b)."""
    X, Y = masks["X"], masks["Y"]

    def frac_at(mask, xs, ys, size):
        """Part du masque dans des carrés de `size` m centrés en (xs, ys)."""
        f = ndimage.uniform_filter(mask.astype(np.float32), size=max(1, int(round(size / RES))), mode="constant")
        r = (BOX[3] - ys) / RES - 0.5
        cc = (xs - BOX[0]) / RES - 0.5
        inside = (r >= 0) & (r <= mask.shape[0] - 1) & (cc >= 0) & (cc <= mask.shape[1] - 1)
        v = ndimage.map_coordinates(f, [np.clip(r, 0, mask.shape[0] - 1), np.clip(cc, 0, mask.shape[1] - 1)], order=1)
        return np.where(inside, v, 0.0)

    pa = np.array([0, 200, 55], dtype=np.float32)
    pb_pink = np.array([0, 0, 0], dtype=np.float32)
    qa = np.array([255, 0, 0], dtype=np.float32)
    qb = np.array([0, 0, 90], dtype=np.float32)

    def blend(img_a, img_b, fp, fb):
        a = img_a.astype(np.float32)
        b = img_b.astype(np.float32)
        keep = (1 - fp - fb)[..., None]
        a = a * keep + pa * fp[..., None] + qa * fb[..., None]
        b = b * keep + pb_pink * fp[..., None] + qb * fb[..., None]
        return np.clip(np.round(a), 0, 255).astype(np.uint8), np.clip(np.round(b), 0, 255).astype(np.uint8)

    changed = []
    fx, fy = world["lattice"]
    for t in tiles:
        bx0, _, _, by1 = t["bounds"]
        ox, oy = fx + math.floor(bx0 - fx) - 1, fy + math.ceil(by1 - fy) + 1
        pa_ = OUT / "ground" / f"{t['id']}_a.png"
        pb_ = OUT / "ground" / f"{t['id']}_b.png"
        A = np.asarray(Image.open(pa_).convert("RGB"))
        Bm = np.asarray(Image.open(pb_).convert("RGB"))
        n = A.shape[0]
        xs = ox + np.arange(n) + 0.5
        ys = oy - np.arange(n) - 0.5
        XX, YY = np.meshgrid(xs, ys)
        fp, fb = frac_at(masks["pink"], XX, YY, 1.0), frac_at(masks["black"], XX, YY, 1.0)
        if fp.max() == 0 and fb.max() == 0:
            continue
        orig = CACHE / "ground" / f"{t['id']}"
        orig.parent.mkdir(parents=True, exist_ok=True)
        # Idempotence : on repart des poids d'avant la première passe, gardés dans le cache (ou, s'il manque, de ceux publiés, une seule fois).
        if not Path(f"{orig}_a.png").exists():
            Image.fromarray(A).save(f"{orig}_a.png")
            Image.fromarray(Bm).save(f"{orig}_b.png")
        A0 = np.asarray(Image.open(f"{orig}_a.png").convert("RGB"))
        B0 = np.asarray(Image.open(f"{orig}_b.png").convert("RGB"))
        na, nb = blend(A0, B0, fp, fb)
        if not (np.array_equal(na, A) and np.array_equal(nb, Bm)):
            Image.fromarray(na).save(pa_, optimize=True)
            Image.fromarray(nb).save(pb_, optimize=True)
            changed.append(t["id"])
    sup = world["super"]
    for cell in sup["cells"]:
        x0, y1 = cell["x0"], cell["y1"]
        side = sup["tiles"] * world["tileSize"]
        if x0 > BOX[2] or x0 + side < BOX[0] or y1 < BOX[1] or y1 - side > BOX[3]:
            continue
        n = sup["size"]
        res = sup["res"]
        ox, oy = x0 - res, y1 + res
        xs = ox + (np.arange(n) + 0.5) * res
        ys = oy - (np.arange(n) + 0.5) * res
        XX, YY = np.meshgrid(xs, ys)
        fp, fb = frac_at(masks["pink"], XX, YY, res), frac_at(masks["black"], XX, YY, res)
        if fp.max() == 0 and fb.max() == 0:
            continue
        pa_ = OUT / "ground" / f"{cell['id']}_a.png"
        pb_ = OUT / "ground" / f"{cell['id']}_b.png"
        orig = CACHE / "ground" / cell["id"]
        if not Path(f"{orig}_a.png").exists():
            Image.open(pa_).convert("RGB").save(f"{orig}_a.png")
            Image.open(pb_).convert("RGB").save(f"{orig}_b.png")
        A0 = np.asarray(Image.open(f"{orig}_a.png").convert("RGB"))
        B0 = np.asarray(Image.open(f"{orig}_b.png").convert("RGB"))
        na, nb = blend(A0, B0, fp, fb)
        if not (np.array_equal(na, np.asarray(Image.open(pa_).convert("RGB"))) and np.array_equal(nb, np.asarray(Image.open(pb_).convert("RGB")))):
            Image.fromarray(na).save(pa_, optimize=True)
            Image.fromarray(nb).save(pb_, optimize=True)
            changed.append(cell["id"])
    return changed


# --- Application --------------------------------------------------------------------------------------------------------------
def apply():
    if not TRACE.exists():
        raise SystemExit("terrils.json absent : lancer d'abord build_terrils.py --trace")
    trace_doc = json.loads(TRACE.read_text())
    paths = {k: v for k, v in trace_doc.items() if k in HEAPS}
    world = json.loads((OUT / "world.json").read_text())
    m = Mosaic(world)
    new_h = carve(m, paths)
    moved = np.nanmax(np.abs(new_h - m.h))
    print(f"relief : jusqu'à {moved:.2f} m déplacés ; {int(np.sum(np.abs(new_h - m.h) > 0.05))} m² touchés")
    changed_terrain = m.write(new_h)
    m.h = new_h

    heaps = osm_heaps()
    masks, shrubs = classify(heaps)
    pink = polygonize(masks["pink"], masks["X"], masks["Y"])
    black = polygonize(masks["black"], masks["X"], masks["Y"]).difference(pink)
    lines = [LineString([(p[0], p[1]) for p in v["path"]]) for v in paths.values()]
    wide = [Point(q[0], q[1]).buffer(w + 0.2, 12) for v in paths.values() for q, w in zip(v["path"][::2], half_widths(v["path"])[::2]) if w > WIDTH / 2 + 0.3]
    track = unary_union([ln.buffer(WIDTH / 2 + 0.2, cap_style="round") for ln in lines] + wide +
                        [Point(v["summit"][:2]).buffer(TOP + 0.3) for v in paths.values()]).simplify(0.15)
    pink, black = pink.difference(track), black.difference(track)
    print(f"sols : schiste rose {pink.area:.0f} m², schiste noir {black.area:.0f} m², sentiers {track.area:.0f} m² "
          f"({sum(ln.length for ln in lines):.0f} m)")
    new = {"schist_red": pink, "path_schist": track, "schist_black": black}
    taken = unary_union(list(new.values()))

    clear = unary_union([ln.buffer(CLEAR) for ln in lines] + [Point(v["summit"][:2]).buffer(TOP + CLEAR) for v in paths.values()])
    pink_face = pink.buffer(2.0)
    reach = unary_union([ln.buffer(WIDTH / 2 + 12.0) for ln in lines] + [Point(v["summit"][:2]).buffer(TOP + 8.0) for v in paths.values()])
    changed = []
    stats = {"arbres retirés": 0, "petits arbres ajoutés": 0, "arbres recalés": 0}
    for t in m.tiles:
        tb = shapely.box(*t["bounds"])
        p = OUT / "tiles" / f"{t['id']}.json"
        rec = json.loads(p.read_text())
        before = json.dumps(rec, separators=(",", ":"))
        g = rec["ground"]
        mine = {k: v.intersection(tb) for k, v in new.items()}
        if any(not v.is_empty for v in mine.values()):
            cut = taken.intersection(tb)
            for k in list(g):
                if k.startswith("marks") or k in new:
                    continue
                # Seuls les polygones qui empiètent vraiment sont redécoupés (sinon une deuxième passe déplacerait leurs sommets d'un arrondi).
                out = []
                for q in g[k]:
                    pq = from_rings(q)
                    out += to_rings(pq.difference(cut), 0.05) if pq.intersection(cut).area > 0.05 else [q]
                g[k] = out
            for k, v in mine.items():
                g[k] = to_rings(v) if not v.is_empty else []
            rec["ground"] = {k: v for k, v in g.items() if v}
        # Arbres : retirés sur les sentiers ; petits arbres ajoutés sur la face rose ; altitudes recalées sur le relief creusé.
        trees = rec["trees"]
        keep = [tr for tr in trees if not clear.contains(Point(tr[0], tr[1]))]
        stats["arbres retirés"] += len(trees) - len(keep)
        have = np.array([(tr[0], tr[1]) for tr in keep]) if keep else np.zeros((0, 2))
        for (sx, sy, area, hm) in shrubs:
            if not (t["bounds"][0] <= sx < t["bounds"][2] and t["bounds"][1] <= sy < t["bounds"][3]):
                continue
            x, y = round(sx * 2) / 2, round(sy * 2) / 2
            if not pink_face.contains(Point(x, y)) or clear.contains(Point(x, y)):
                continue
            if len(have) and np.min(np.hypot(have[:, 0] - x, have[:, 1] - y)) < 2.0:
                continue
            rad = round(min(2.2, max(0.9, math.sqrt(area / math.pi) * 1.1)), 1)
            hh = round(min(7.0, max(3.0, hm if hm > 2.0 else 2.2 + rad * 1.6)), 1)
            keep.append([x, y, 0.0, hh, rad, round(min(2.2, hh * 0.35), 1)])
            have = np.vstack([have, [x, y]])
            stats["petits arbres ajoutés"] += 1
        # Altitudes : seuls les arbres ajoutés et ceux des abords creusés sont recalés (ailleurs, l'altitude publiée reste).
        redo = [tr for tr in keep if tr[2] == 0.0 or reach.contains(Point(tr[0], tr[1]))]
        if redo:
            zs = m.at(np.array([tr[0] for tr in redo]), np.array([tr[1] for tr in redo]))
            for tr, z in zip(redo, zs):
                z = round(float(z), 2)
                if abs(tr[2] - z) > 0.02:
                    if tr[2] != 0.0:
                        stats["arbres recalés"] += 1
                    tr[2] = z
        rec["trees"] = keep
        if json.dumps(rec, separators=(",", ":")) != before:
            text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
            p.write_text(text)
            t["bytes"] = len(text)
            t["trees"] = len(keep)
            changed.append(t["id"])
    print(f"tuiles réécrites : {', '.join(changed) or 'aucune'} ; relief : {', '.join(changed_terrain) or 'aucun'} ; {stats}")
    weights = paint_weights(world, m.tiles, masks)
    print(f"poids des sols réécrits : {', '.join(weights) or 'aucun'}")
    if changed:
        (OUT / "world.json").write_text(json.dumps(world, indent=1))

    # Axes des sentiers dans les sites des tuiles (`sentier`) : le jeu creuse l'affichage du relief sous le sentier et le recouvre de relief fin
    # (comme les remparts, D250), sinon les carreaux de 2,5 m du relief affiché cachent le replat dans la pente. Chaque segment va à la tuile
    # qui contient son milieu ; une suite de segments forme un site (x, y, altitude du sentier ; demi-largeur plate par point).
    kinds_dir = OUT / "kinds"
    index = json.loads((kinds_dir / "index.json").read_text())
    runs = {}
    for v in paths.values():
        pts = v["path"]
        hw = half_widths(pts)
        cur_tile, cur = None, None
        for i in range(len(pts) - 1):
            mx, my = (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2
            tid = next((t["id"] for t in m.tiles if t["bounds"][0] <= mx < t["bounds"][2] and t["bounds"][1] <= my < t["bounds"][3]), None)
            if tid != cur_tile or cur is None:
                cur = {"t": "sentier", "p": [round(c_, 2) for c_ in pts[i]], "w": [round(float(hw[i]), 2)]}
                runs.setdefault(tid, []).append(cur)
                cur_tile = tid
            cur["p"] += [round(c_, 2) for c_ in pts[i + 1]]
            cur["w"].append(round(float(hw[i + 1]), 2))
    kinds_changed = []
    for tid in sorted({t["id"] for t in m.tiles} | set(runs)):
        if tid is None:
            continue
        kp = kinds_dir / f"{tid}.json"
        doc = json.loads(kp.read_text()) if kp.exists() else {"v": 1, "buildings": {}, "sites": []}
        sites = [st for st in doc["sites"] if st.get("t") != "sentier"] + runs.get(tid, [])
        if sites == doc["sites"] and kp.exists():
            continue
        if not sites and not doc["buildings"] and not kp.exists():
            continue
        doc["sites"] = sites
        kp.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        kinds_changed.append(tid)
        if tid not in index["tiles"]:
            index["tiles"] = sorted(index["tiles"] + [tid], key=lambda s_: tuple(int(v_) for v_ in s_.split("_")))
            (kinds_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    print(f"sites « sentier » : {sum(len(r) for r in runs.values())} dans {', '.join(sorted(k for k in runs if k))} ; kinds réécrits : {', '.join(kinds_changed) or 'aucun'}")

    # Lieu de la carte.
    pp = OUT / "map" / "places.json"
    places = json.loads(pp.read_text())
    sx, sy, _ = paths["est"]["summit"]
    place = {"id": f"osm:way/{HEAPS['est']}", "cat": "monument", "name": "Terrils des Télots", "x": round(sx, 1), "y": round(sy, 1), "kind": "viewpoint"}
    others = [q for q in places["places"] if q.get("id") != place["id"]]
    if others + [place] != places["places"]:
        places["places"] = others + [place]
        pp.write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")))
        print("lieu « Terrils des Télots » ajouté à la carte")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trace", action="store_true")
    if ap.parse_args().trace:
        trace()
    else:
        apply()


if __name__ == "__main__":
    main()
