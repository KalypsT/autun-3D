"""Relevés du lot 0 de l'Hexagone (docs/plans/hexagone.md, §8) : toit, terrasses, murs, parking, mesurés sur l'IGN (LiDAR HD + orthophotographie).

Sortie : un rapport texte (stdout) et, avec --images DOSSIER, deux vues annotées. Les rasters sont téléchargés par fenêtre (WMS data.geopf.fr) et gardés
dans .cache/hexagone/ (hors git). Aucun fichier du jeu n'est modifié.

Usage : python3 tools/data/survey_hexagone.py [--images DOSSIER]
Repère : local du jeu (x est, y nord, z au-dessus de ORIGIN_Z) ; caps en degrés depuis le nord, sens horaire.
"""

import io
import math
import sys
from pathlib import Path

import numpy as np
import requests
import tifffile
from PIL import Image, ImageDraw

import config as c

OX, OY = c.ORIGIN
CACHE = c.ROOT / ".cache" / "hexagone"
WMS = "https://data.geopf.fr/wms-r"
HIPS = 20.0  # arêtes de la pyramide, cap + 30°·k (lu sur l'orthophotographie, rayons tracés sur les arêtes ; l'ajustement LiDAR donne 20,0°)
CENTRE0 = (383.5, 184.0)  # première estimation du sommet de la pyramide (lue sur l'orthophotographie)
PARKING = (292.0, 190.0, 362.0, 290.0)
# Blocs de places du parking (coin sud-ouest, coin nord-est, repère local) lus sur l'orthophotographie.
BLOCKS = {"B": (307, 260, 321, 269), "A": (322, 270, 340, 282), "C": (338, 262, 356, 278), "D": (311, 242, 332, 256),
          "E": (316, 221, 333, 236), "F": (318, 205, 340, 228), "G": (326, 232, 340, 243)}


def wms(layer, fmt, box, w, h, name):
    f = CACHE / name
    if f.exists():
        return f.read_bytes()
    x0, y0, x1, y1 = box
    r = requests.get(WMS, timeout=180, headers={"User-Agent": c.USER_AGENT}, params={
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "", "FORMAT": fmt, "CRS": "EPSG:2154",
        "BBOX": f"{OX + x0},{OY + y0},{OX + x1},{OY + y1}", "WIDTH": w, "HEIGHT": h})
    r.raise_for_status()
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_bytes(r.content)
    return r.content


def dem(kind, box, res):
    x0, y0, x1, y1 = box
    layer = f"IGNF_LIDAR-HD_{kind}_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
    a = tifffile.imread(io.BytesIO(wms(layer, "image/geotiff", box, int((x1 - x0) / res), int((y1 - y0) / res), f"{kind}.tif"))).astype(np.float32)
    a[a < -100] = np.nan
    return a - c.ORIGIN_Z


def ortho(box, res, name):
    x0, y0, x1, y1 = box
    data = wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", box, int((x1 - x0) / res), int((y1 - y0) / res), name)
    return Image.open(io.BytesIO(data)).convert("RGB")


class Grid:
    """Raster aligné sur `box` (x0, y0, x1, y1 locaux), ligne 0 au nord ; X, Y : coordonnées des centres de pixels."""

    def __init__(self, box, res):
        self.x0, self.y0, self.x1, self.y1, self.res = *box, res
        i, j = np.mgrid[0:int((self.y1 - self.y0) / res), 0:int((self.x1 - self.x0) / res)]
        self.X = self.x0 + (j + 0.5) * res
        self.Y = self.y1 - (i + 0.5) * res

    def px(self, x, y):
        return (x - self.x0) / self.res, (self.y1 - y) / self.res


def blur(a, sigma):
    """Flou gaussien séparable (numpy seul)."""
    k = np.exp(-0.5 * (np.arange(-int(4 * sigma), int(4 * sigma) + 1) / sigma) ** 2)
    k /= k.sum()
    a = np.apply_along_axis(lambda v: np.convolve(v, k, "same"), 0, a)
    return np.apply_along_axis(lambda v: np.convolve(v, k, "same"), 1, a)


def fit_cone(g, Z, centre):
    """Cône z = z0 − s·r sur 3 < r < 13 m, ajustement robuste ; le centre est le barycentre des pixels à moins de 0,35 m du sommet. Renvoie (cx, cy, z0, s)."""
    cx, cy = centre
    for _ in range(3):
        r = np.hypot(g.X - cx, g.Y - cy)
        m = (r > 3) & (r < 13) & np.isfinite(Z)
        A = np.c_[np.ones(m.sum()), -r[m]]
        coef, *_ = np.linalg.lstsq(A, Z[m], rcond=None)
        keep = np.abs(Z[m] - A @ coef) < 0.5
        coef, *_ = np.linalg.lstsq(A[keep], Z[m][keep], rcond=None)
        top = (Z > coef[0] - 0.35) & (r < 8)
        cx, cy = g.X[top].mean(), g.Y[top].mean()
    return cx, cy, float(coef[0]), float(coef[1])


def fit_pyramid(g, Z, cx, cy, n=12):
    """Pyramide régulière à `n` pans, z = z0 − p·max_k(·), normales des pans à φ0 + 360°·k/n : balaye φ0 ; renvoie (φ0, z0, pente, écart). Le MNS est trop
    peu net pour que la phase soit discriminante (écart presque plat) : elle est vérifiée à l'œil sur l'orthophotographie (rayons tracés sur les arêtes)."""
    dx, dy = g.X - cx, g.Y - cy
    r = np.hypot(dx, dy)
    m = (r > 4) & (r < 14) & np.isfinite(Z)
    best = None
    for phi0 in np.arange(0, 360 / n, 0.5):
        d = np.max([dx[m] * math.sin(math.radians(phi0 + 360 * k / n)) + dy[m] * math.cos(math.radians(phi0 + 360 * k / n)) for k in range(n)], axis=0)
        A = np.c_[np.ones(d.size), -d]
        coef, *_ = np.linalg.lstsq(A, Z[m], rcond=None)
        rms = float(np.sqrt(np.mean((Z[m] - A @ coef) ** 2)))
        if best is None or rms < best[3]:
            best = (float(phi0), float(coef[0]), float(coef[1]), rms)
    return best


def section(g, Z, G, cx, cy, cap, radii):
    n = (math.sin(math.radians(cap)), math.cos(math.radians(cap)))
    d = (g.X - cx) * n[0] + (g.Y - cy) * n[1]
    lat = np.abs(-(g.X - cx) * n[1] + (g.Y - cy) * n[0])
    top, soil = [], []
    for r in radii:
        m = (abs(d - r) < 1) & (lat < 1.5) & np.isfinite(Z)
        top.append(float(np.median(Z[m])) if m.any() else np.nan)
        soil.append(float(np.median(G[m])) if m.any() else np.nan)
    return top, soil


def wall(g, H, cx, cy, cap, half=5.0):
    """Mur sur la normale `cap` : distance au sommet du dernier pas où le dessus dépasse le sol de 1,8 m (à 1,5 m de trou près) ; largeur du toit à 1 m en deçà."""
    n = (math.sin(math.radians(cap)), math.cos(math.radians(cap)))
    d = (g.X - cx) * n[0] + (g.Y - cy) * n[1]
    lat = -(g.X - cx) * n[1] + (g.Y - cy) * n[0]
    last, gap, r = None, 0.0, 18.0
    while r < 36:
        m = (abs(d - r) < 0.25) & (abs(lat) < half) & np.isfinite(H)
        if m.any() and np.median(H[m]) > 1.8:
            last, gap = r, 0.0
        else:
            gap += 0.25
            if gap > 1.5:
                break
        r += 0.25
    ls = [l for l in np.arange(-25, 25.1, 0.5) if ((abs(d - (last - 1.0)) < 0.4) & (abs(lat - l) < 0.4) & np.isfinite(H)).any()
          and np.median(H[(abs(d - (last - 1.0)) < 0.4) & (abs(lat - l) < 0.4) & np.isfinite(H)]) > 1.8]
    return last, (min(ls), max(ls))


def stroke_blocks(img, box, res):
    """Direction des traits de places (cap modulo 180) et pas, par bloc ; traits blancs = pixels plus clairs que leur voisinage, peu saturés."""
    rgb = np.asarray(img).astype(float)
    L, sat = rgb.mean(2), rgb.max(2) - rgb.min(2)
    mask = (L > blur(L, 6) + 22) & (sat < 45) & (L > 110)
    sm = blur(mask.astype(float), 0.8)
    gy, gx = np.gradient(sm)
    Y, X = np.mgrid[0:L.shape[0], 0:L.shape[1]]
    wx, wy = box[0] + (X + 0.5) * res, box[3] - (Y + 0.5) * res
    out = {}
    for name, (a, b, c_, d) in BLOCKS.items():
        m = (wx >= a) & (wx <= c_) & (wy >= b) & (wy <= d) & (sm > 0.15)
        if m.sum() < 60:
            continue
        nx, ny = gx[m], -gy[m]
        ang, w = np.degrees(np.arctan2(nx, ny)) % 180, np.hypot(nx, ny)
        h, _ = np.histogram(ang, bins=np.arange(0, 181, 5), weights=w)
        n0 = int(np.argmax(h)) * 5 + 2.5
        sel = np.abs(((ang - n0 + 90) % 180) - 90) < 12
        nc = float(np.degrees(np.angle(np.sum(w[sel] * np.exp(2j * np.radians(ang[sel])))) / 2) % 180)
        t = wx[m] * math.sin(math.radians(nc)) + wy[m] * math.cos(math.radians(nc))
        hist, _ = np.histogram(t, bins=np.arange(t.min(), t.max(), 0.05))
        hist = hist - hist.mean()
        ac = np.correlate(hist, hist, "full")[len(hist) - 1:]
        lo, hi = int(1.8 / 0.05), int(3.4 / 0.05)
        out[name] = ((nc + 90) % 180, (lo + int(np.argmax(ac[lo:hi]))) * 0.05 if len(ac) > hi else float("nan"))
    return out


def main():
    images = Path(sys.argv[sys.argv.index("--images") + 1]) if "--images" in sys.argv else None
    box = (329, 126, 449, 246)
    g = Grid(box, 0.25)
    Z, G = dem("MNS", box, 0.25), dem("MNT", box, 0.25)

    print("== Toit : pyramide")
    cx, cy, z0, s = fit_cone(g, Z, CENTRE0)
    r = np.hypot(g.X - cx, g.Y - cy)
    ground = float(np.nanmedian(G[(r > 24) & (r < 30)]))
    print(f"sommet ({cx:.2f} ; {cy:.2f}), z = {z0:+.2f} (sol {ground:+.2f} : {z0 - ground:.1f} m au-dessus), pente {s:.3f} ({math.degrees(math.atan(s)):.1f}°)")

    obox = (cx - 75, cy - 75, cx + 75, cy + 75)
    g_o = Grid(obox, 0.1)
    img_o = ortho(obox, 0.1, "ortho.jpg")
    phi0, zz, p, rms = fit_pyramid(g, Z, cx, cy)
    hip0 = HIPS
    print(f"pyramide à 12 pans : ajustement LiDAR, normales à {phi0:.1f}° + 30°·k (arêtes à {(phi0 + 15) % 30:.1f}°), pente {p:.3f}, écart {rms:.2f} m")
    print(f"  arêtes retenues : {hip0:.1f}° + 30°·k (vérifié à l'œil sur l'orthophotographie) ; normales des pans à {hip0 + 15:.1f}° + 30°·k")

    print("== Coupes (altitude locale du dessus ; sol en dessous), médiane sur ±1,5 m, r depuis le sommet")
    radii = list(range(12, 38, 2))
    print("r (m)     " + " ".join(f"{q:5d}" for q in radii))
    sections = {}
    for cap in (265, 325, 25, 85, 145, 205):
        top, soil = section(g, Z, G, cx, cy, cap, radii)
        sections[cap] = top
        print(f"{cap:3d}° haut " + " ".join(f"{v:5.1f}" for v in top))
        print(f"     sol  " + " ".join(f"{v:5.1f}" for v in soil))
    print("  lecture : pied de la pyramide à r ≈ 16,5 m (z ≈ +4,4)")

    print("== Murs sur les six normales des pans (35° + 60°·k) : distance au sommet, étendue latérale du toit à 1 m en deçà (peut inclure un voisin)")
    walls = {}
    for cap in (35, 95, 155, 215, 275, 335):
        r_w, lat = wall(g, Z - G, cx, cy, cap)
        walls[cap] = r_w
        a = math.radians(cap)
        print(f"  {cap:3d}° : mur à {r_w:.1f} m, milieu ({cx + r_w * math.sin(a):.1f} ; {cy + r_w * math.cos(a):.1f}), toit présent de {lat[0]:+.1f} à {lat[1]:+.1f} m")

    print("== Parking : traits de places par bloc (cap des traits mod 180, pas le long de la rangée)")
    img_p = ortho(PARKING, 0.2, "pk.jpg")
    blocks = stroke_blocks(img_p, PARKING, 0.2)
    for n, (a, p) in blocks.items():
        print(f"  {n} {BLOCKS[n]} : traits à {a:5.1f}°, pas {p:.2f} m")
    if blocks:
        print(f"  moyenne : {np.mean([a for a, _ in blocks.values()]):.1f}° ± {np.std([a for a, _ in blocks.values()]):.1f}°, pas {np.nanmean([p for _, p in blocks.values()]):.2f} m")

    if images:
        images.mkdir(parents=True, exist_ok=True)
        im = img_o.copy()
        d = ImageDraw.Draw(im)
        px, py = g_o.px(cx, cy)
        for k in range(12):
            a = math.radians(hip0 + 30 * k)
            d.line([(px, py), (px + 16.5 * 10 * math.sin(a), py - 16.5 * 10 * math.cos(a))], fill=(255, 255, 0), width=2)
        d.ellipse([px - 165, py - 165, px + 165, py + 165], outline=(255, 255, 0), width=2)
        for cap, rr in walls.items():
            a = math.radians(cap)
            qx, qy = px + rr * 10 * math.sin(a), py - rr * 10 * math.cos(a)
            d.ellipse([qx - 7, qy - 7, qx + 7, qy + 7], outline=(255, 64, 64), width=3)
            d.text((qx + 9, qy - 6), f"{cap}° {rr:g} m", fill=(255, 255, 255))
        d.ellipse([px - 6, py - 6, px + 6, py + 6], outline=(255, 64, 64), width=3)
        im.save(images / "hexagone-lot0-toit.jpg", quality=85)
        pk = img_p.resize((img_p.width * 3, img_p.height * 3), Image.LANCZOS)
        d = ImageDraw.Draw(pk)
        k = 3 / 0.2
        for n, (a, p) in blocks.items():
            x0, y0, x1, y1 = BLOCKS[n]
            d.rectangle([(x0 - PARKING[0]) * k, (PARKING[3] - y1) * k, (x1 - PARKING[0]) * k, (PARKING[3] - y0) * k], outline=(255, 255, 0), width=2)
            d.text(((x0 - PARKING[0]) * k + 4, (PARKING[3] - y1) * k + 4), f"{n} {a:.0f}° / {p:.2f} m", fill=(255, 255, 0))
        for gx in range(int(PARKING[0]), int(PARKING[2]) + 1, 10):
            d.text(((gx - PARKING[0]) * k + 2, 4), str(gx), fill=(255, 255, 255))
        for gy in range(int(PARKING[1]), int(PARKING[3]) + 1, 10):
            d.text((4, (PARKING[3] - gy) * k - 5), str(gy), fill=(255, 255, 255))
        pk.save(images / "hexagone-lot0-parking.jpg", quality=85)
        print("images :", images)


if __name__ == "__main__":
    main()
