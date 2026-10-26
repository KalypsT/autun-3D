"""Textures de sol CC0 (Poly Haven) : téléchargées, réduites à 512 px, écrites dans public/textures/ground.

Usage : python3 tools/data/fetch_textures.py
Licence : CC0 (https://polyhaven.com/license). Crédits dans docs/SOURCES.md.
"""

import io

import requests
from PIL import Image

import config as c

# classe de sol -> identifiant Poly Haven
# Identifiant Poly Haven et teinte moyenne visée (les textures brutes sont plus chaudes que les sols d'Autun).
ASSETS = {
    "asphalt": ("asphalt_02", (92, 92, 94)),
    "sett": ("cobblestone_floor_01", (136, 126, 112)),
    "gravel": ("sandy_gravel", (176, 168, 152)),
    "grass": ("grass_ground", (88, 112, 62)),
    "sidewalk": ("concrete_tiles", (150, 146, 138)),
    "paving": ("stone_pavers", (158, 148, 134)),
}

out = c.ROOT / "public" / "textures" / "ground"
out.mkdir(parents=True, exist_ok=True)
for name, (asset, target) in ASSETS.items():
    files = requests.get(f"https://api.polyhaven.com/files/{asset}", timeout=60).json()
    url = files["Diffuse"]["1k"]["jpg"]["url"]
    img = Image.open(io.BytesIO(requests.get(url, timeout=120).content)).convert("RGB").resize((512, 512), Image.LANCZOS)
    mean = img.resize((1, 1), Image.BOX).getpixel((0, 0))
    gains = [min(max(t / max(m, 1), 0.5), 2.4) for t, m in zip(target, mean)]
    img = Image.merge("RGB", [ch.point(lambda v, g=g: min(255, int(v * g))) for ch, g in zip(img.split(), gains)])
    img.save(out / f"{name}.jpg", quality=84, optimize=True)
    print(f"{name:9s} <- {asset} ({(out / f'{name}.jpg').stat().st_size / 1e3:.0f} ko)")
