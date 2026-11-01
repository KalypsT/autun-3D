"""Relevés du lot 0 du collège du Vallon (docs/plans/college-vallon.md, §8) : bâtiments, grille, terrains, parking, mesurés sur l'IGN (LiDAR HD + orthophotographie).

Sortie : un rapport texte (stdout) et, avec --images DOSSIER, des vues annotées. Rasters téléchargés par fenêtre (WMS data.geopf.fr), gardés dans
.cache/college/ (hors git). Aucun fichier du jeu n'est modifié.

Usage : python3 tools/data/survey_college.py [--images DOSSIER] [--crop NOM x0 y0 x1 y1 [res]]
Repère : local du jeu (x est, y nord, z au-dessus de ORIGIN_Z).
"""

import io
import json
import math
import sys
from pathlib import Path

import numpy as np
import requests
import tifffile
from PIL import Image, ImageDraw
from pyproj import Transformer

import config as c

OX, OY = c.ORIGIN
CACHE = c.ROOT / ".cache" / "college"
WMS = "https://data.geopf.fr/wms-r"
BOX = (470.0, 940.0, 730.0, 1190.0)
TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)


def local(lat, lon):
    x, y = TO_L93.transform(lon, lat)
    return x - OX, y - OY


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


def dem(kind, box=BOX, res=0.25):
    x0, y0, x1, y1 = box
    layer = f"IGNF_LIDAR-HD_{kind}_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"
    a = tifffile.imread(io.BytesIO(wms(layer, "image/geotiff", box, int((x1 - x0) / res), int((y1 - y0) / res), f"{kind}-{int(x0)}-{int(y0)}.tif"))).astype(np.float32)
    a[a < -100] = np.nan
    return a - c.ORIGIN_Z


def ortho(box, res, name):
    x0, y0, x1, y1 = box
    data = wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", box, int((x1 - x0) / res), int((y1 - y0) / res), name)
    return Image.open(io.BytesIO(data)).convert("RGB")


def crop(out, name, box, res=0.1, grid=10, mark=None):
    """Orthophotographie de `box` à `res` m/pixel avec quadrillage local tous les `grid` m (étiquettes tous les 2 pas) ; `mark` : points (x, y) cerclés."""
    x0, y0, x1, y1 = box
    im = ortho(box, res, f"ortho-{name}-{int(x0)}-{int(y0)}-{res}.jpg")
    d = ImageDraw.Draw(im)
    for k, gx in enumerate(range(int(math.ceil(x0 / grid) * grid), int(x1) + 1, grid)):
        X = (gx - x0) / res
        d.line([(X, 0), (X, im.size[1])], fill=(255, 255, 0), width=1)
        d.text((X + 3, 3), str(gx), fill=(255, 255, 0))
    for k, gy in enumerate(range(int(math.ceil(y0 / grid) * grid), int(y1) + 1, grid)):
        Y = (y1 - gy) / res
        d.line([(0, Y), (im.size[0], Y)], fill=(255, 255, 0), width=1)
        d.text((3, Y + 3), str(gy), fill=(255, 255, 0))
    for mx, my in mark or []:
        X, Y = (mx - x0) / res, (y1 - my) / res
        d.ellipse((X - 10, Y - 10, X + 10, Y + 10), outline=(255, 0, 0), width=3)
    out.mkdir(parents=True, exist_ok=True)
    im.save(out / f"college-{name}.jpg", quality=88)
    return im


# Repère du bâtiment principal (lot 0) : origine (630 ; 1110), u vers le cap 72° (ENE), v vers le cap 342° (NNO), rotation de 17,5° ;
# ailes lues sur le MNS − MNT (hauteur au-dessus du sol, classes 11 m et plus : 4 niveaux ; 6 à 11 m : 2 niveaux ; 2,5 à 6 m : 1 niveau).
FRAME = (630.0, 1110.0, 17.5)
WINGS = {  # nom: (u0, u1, v0, v1, hauteur m)
    "barre": (-24, 13, -33.5, -10, 13.6), "noyau": (-8, 1, -10, -5, 13.6), "cage-est": (13, 20, -25.5, -21.5, 7.7),
    "aile-ouest": (-7, 9, -5, 13.5, 7.7), "preau": (9, 27, -5, 12.5, 3.8), "aile-est": (27, 44, 6, 28.5, 7.7),
    "bloc-nord": (-16, 27, 13.5, 35.5, 7.7)}


def wing_corners(u0, u1, v0, v1):
    ox, oy, a = FRAME
    ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
    return [(ox + u * ca - v * sa, oy + u * sa + v * ca) for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]


def overview(out):
    box, res = (600.0, 1060.0, 700.0, 1155.0), 0.1
    im = crop(out, "ensemble", box, res, grid=10)
    d = ImageDraw.Draw(im)
    for name, (u0, u1, v0, v1, h) in WINGS.items():
        pts = [((x - box[0]) / res, (box[3] - y) / res) for x, y in wing_corners(u0, u1, v0, v1)]
        d.polygon(pts, outline=(0, 255, 255), width=2)
        d.text((sum(p[0] for p in pts) / 4 - 20, sum(p[1] for p in pts) / 4), f"{name} {h}", fill=(0, 255, 255))
    px, py = local(46.960231, 4.307759)
    X, Y = (px - box[0]) / res, (box[3] - py) / res
    d.ellipse((X - 10, Y - 10, X + 10, Y + 10), outline=(255, 0, 0), width=3)
    d.text((X + 12, Y - 6), "photo 8", fill=(255, 0, 0))
    # cap de la photo 8 lu sur les ailes (≈ 250°, flèche de 25 m) ; le cap donné (112°) est tracé en pointillé
    for cap, col in ((250, (255, 0, 0)), (112, (255, 140, 0))):
        ex, ey = px + 25 * math.sin(math.radians(cap)), py + 25 * math.cos(math.radians(cap))
        d.line([(X, Y), ((ex - box[0]) / res, (box[3] - ey) / res)], fill=col, width=3)
    im.save(out / "college-ensemble.jpg", quality=88)
    return im


def main():
    args = sys.argv[1:]
    if "--overview" in args:
        overview(Path(args[args.index("--images") + 1]))
        return
    if "--crop" in args:
        i = args.index("--crop")
        name, x0, y0, x1, y1 = args[i + 1], *map(float, args[i + 2:i + 6])
        res = float(args[i + 6]) if len(args) > i + 6 and not args[i + 6].startswith("--") else 0.1
        crop(Path(args[args.index("--images") + 1]) if "--images" in args else Path("."), name, (x0, y0, x1, y1), res)
        return
    out = Path(args[args.index("--images") + 1]) if "--images" in args else None
    mns, mnt = dem("MNS"), dem("MNT")
    H = mns - mnt  # hauteur au-dessus du sol
    print("MNS", mns.shape, "MNT", mnt.shape)
    res = 0.25
    px = lambda x, y: ((x - BOX[0]) / res, (BOX[3] - y) / res)
    tiles = json.loads((c.OUT / "tiles" / "28_39.json").read_text())
    kinds = json.loads((c.OUT / "kinds" / "28_39.json").read_text())

    print("\n== Bâtiments : hauteur LiDAR au-dessus du sol (percentiles 50/90/99 du contour) ==")
    for b in tiles["buildings"]:
        r = b["ring"]; xs, ys = r[0::2], r[1::2]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        if not (480 <= cx <= 720 and 960 <= cy <= 1180) or len(xs) < 3:
            continue
        im = Image.new("L", (mns.shape[1], mns.shape[0]), 0)
        ImageDraw.Draw(im).polygon([px(x, y) for x, y in zip(xs, ys)], fill=1)
        m = (np.array(im) > 0) & np.isfinite(H)
        h = H[m]
        kd = kinds["buildings"].get(b["id"], {})
        if h.size:
            print(f"{b['id'][-6:]} c=({cx:.0f},{cy:.0f}) n={len(xs)} h50={np.percentile(h,50):.1f} h90={np.percentile(h,90):.1f} h99={np.percentile(h,99):.1f} "
                  f"sol={np.nanmedian(mnt[m]):.1f} bdtopo={b['bd']['height']} kind={kd.get('k')}")

    if out:
        out.mkdir(parents=True, exist_ok=True)
        for name, box, rs in [("site", (470, 940, 730, 1190), 0.25)]:
            o = ortho(box, rs, f"ortho-{name}.jpg")
            o.save(out / f"college-ortho-{name}.jpg", quality=85)
        # hauteur en fausses couleurs
        hh = np.clip(np.nan_to_num(H, nan=0), 0, 14) / 14
        rgb = (np.stack([hh, 1 - abs(hh - 0.5) * 2, 1 - hh], -1) * 255).astype(np.uint8)
        Image.fromarray(rgb).save(out / "college-ndsm.png")
        print("images ->", out)


if __name__ == "__main__":
    main()
