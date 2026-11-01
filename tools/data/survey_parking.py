"""Rangées du parking de l'Hexagone (D169, lot 5 de docs/plans/hexagone.md) : lecture sur l'orthophotographie IGN (20 cm) redressée.

Repère redressé (comme D154) : origine O, angle 37° ; `u` le long de la rangée, `v` le long des traits de places. Les rangées de départ (premier trait, nombre,
tronçons de traits) sont lues à l'œil sur l'image redressée ; ce relevé affine le pas (2,44 à 2,56 m) et la phase de chaque rangée sur les traits blancs
visibles (profil du masque blanc le long de `u` dans les tronçons de la rangée), puis superpose les traits prédits à l'orthophotographie.
Les places dont les traits sont cachés par des voitures ou par l'ombre sont extrapolées au pas (comme D154).

Usage : python3 tools/data/survey_parking.py [--images DOSSIER]
Sortie : les rangées affinées (JSON, à recopier dans `parkings` de tools/data/manual.json) et les comptes.
"""

import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import survey_hexagone as S

O, ANGLE = (325.0, 245.0), 37.0
BOX = (280.0, 180.0, 380.0, 305.0)
# Rangées lues sur l'image redressée : nom, premier trait u0, nombre de traits, tronçons v, ligne de fond.
ROWS = [
    ("N", 11.8, 9, [[-39.6, -34.8]], None),
    ("R1", 1.25, 18, [[-27.0, -22.0], [-22.0, -17.0]], -22.0),
    ("R2", -9.4, 20, [[-10.3, -5.0]], -5.0),
    ("R2b", -9.4, 8, [[-5.0, -0.6]], -5.0),
    ("R3", -15.2, 10, [[5.9, 11.0], [11.0, 16.2]], 11.0),
    ("R4", -26.7, 13, [[21.8, 27.0], [27.0, 32.0]], 27.0),
]
STEP0 = 2.5


def rectified():
    data = S.wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", BOX, 500, 625, "pk-wide.jpg")
    a = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(float)
    k = 12
    U, V = np.arange(-30, 60, 1 / k), np.arange(-52, 48, 1 / k)
    UU, VV = np.meshgrid(U, V)
    ang = math.radians(ANGLE)
    X, Y = O[0] + UU * math.cos(ang) + VV * math.sin(ang), O[1] + UU * math.sin(ang) - VV * math.cos(ang)
    j, i = (X - BOX[0]) / 0.2 - 0.5, (BOX[3] - Y) / 0.2 - 0.5
    j0, i0 = np.clip(np.floor(j).astype(int), 0, a.shape[1] - 2), np.clip(np.floor(i).astype(int), 0, a.shape[0] - 2)
    fj, fi = (j - j0)[..., None], (i - i0)[..., None]
    img = a[i0, j0] * (1 - fj) * (1 - fi) + a[i0, j0 + 1] * fj * (1 - fi) + a[i0 + 1, j0] * (1 - fj) * fi + a[i0 + 1, j0 + 1] * fj * fi
    L, sat = img.mean(2), img.max(2) - img.min(2)
    bg = S.blur(L, 5 * 1.0)
    mask = (L > bg + 20) & (sat < 50) & (L > 105)
    return img.clip(0, 255).astype(np.uint8), mask, k


def score(mask, k, u0, step, n, spans):
    """Part des traits prédits (bande de ± 4 cm) qui tombent sur du blanc, dans les tronçons de la rangée."""
    hit = tot = 0
    for q in range(n):
        u = u0 + q * step
        x0 = int(round((u + 30) * k)) - 1
        for v0, v1 in spans:
            y0, y1 = int((v0 + 52 + 0.4) * k), int((v1 + 52 - 0.4) * k)
            col = mask[y0:y1, x0:x0 + 3].any(axis=1)
            hit += int(col.sum())
            tot += len(col)
    return hit / max(tot, 1)


def fit(mask, k, name, u0, n, spans):
    best = (-1.0, u0, STEP0)
    for step in np.arange(2.44, 2.5601, 0.01):
        for du in np.arange(-0.7, 0.701, 0.04):
            s = score(mask, k, u0 + du, step, n, spans)
            if s > best[0] + 1e-9:
                best = (s, u0 + du, step)
    return best


def main():
    images = Path(sys.argv[sys.argv.index("--images") + 1]) if "--images" in sys.argv else None
    img, mask, k = rectified()
    out, total = [], 0
    for name, u0, n, spans, base in ROWS:
        s, fu0, step = fit(mask, k, name, u0, n, spans)
        row = {"name": name, "u0": round(float(fu0), 2), "step": round(float(step), 3), "n": n, "v": spans}
        if base is not None:
            row["base"] = base
        out.append(row)
        bays = (n - 1) * len(spans)
        total += bays
        print(f"  {name:3s} : u0 {u0:6.2f} -> {fu0:6.2f}, pas {step:.3f}, {n} traits, {len(spans)} demi-rangée(s) = {bays} places ; traits sur du blanc : {s * 100:.0f} %")
    print(f"places : {total}")
    print(json.dumps(out))
    if images:
        images.mkdir(parents=True, exist_ok=True)
        im = Image.fromarray(img)
        d = ImageDraw.Draw(im, "RGBA")
        for row in out:
            for q in range(row["n"]):
                x = (row["u0"] + q * row["step"] + 30) * k
                for v0, v1 in row["v"]:
                    d.line([(x, (v0 + 52) * k), (x, (v1 + 52) * k)], fill=(255, 40, 40, 200), width=1)
            if "base" in row:
                y = (row["base"] + 52) * k
                d.line([((row["u0"] + 30) * k, y), ((row["u0"] + (row["n"] - 1) * row["step"] + 30) * k, y)], fill=(255, 40, 40, 200), width=1)
        im.save(images / "hexagone-lot5-parking-releve.jpg", quality=88)


if __name__ == "__main__":
    main()
