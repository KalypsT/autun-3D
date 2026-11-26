"""Logo « GRAND THEFT AUTUN » et jaquette DomoThib (D338).

Usage : python3 tools/logo/make_art.py [fichier-de-police]

La police des titres (Pricedown, Typodermic) ne sert qu'à fabriquer des images : elle n'est jamais embarquée dans le jeu. Elle reste hors
du dépôt : premier argument, variable LOGO_FONT, ou premier fichier `.cache/fonts/pricedown*.{ttf,otf}`. Sans elle, le script prend une
police de repli (Inter Display Black) et le dit : le logo est alors provisoire.

Produit :
- `src/assets/logo.webp` : le logo seul, fond transparent (écran de chargement, intro) ;
- `public/jaquette.webp` : 640 × 360, au plus 300 Ko (contrat DomoThib §3), capture mise en scène `tools/logo/jaquette-source.webp`
  retouchée (contraste, chaleur, vignette) avec le logo en haut à gauche ;
- `src/assets/loading/NN-nom.webp` : les images de l'écran de chargement, 1280 × 720, retouchées, d'après les captures de
  `.cache/loading/` (faites par `tools/logo/loading.sh`) ; sans ces captures, les images déjà dans le dépôt sont gardées.
"""

import glob
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FALLBACK = "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf"
LINES = ("GRAND", "THEFT", "AUTUN")


def find_font(argv: list[str]) -> tuple[str, bool]:
    """Chemin de la police et vrai si c'est la police des titres (pas le repli)."""
    candidates = argv[1:2] + ([os.environ["LOGO_FONT"]] if os.environ.get("LOGO_FONT") else [])
    candidates += sorted(glob.glob(os.path.join(ROOT, ".cache/fonts/[Pp]ricedown*.[ot]tf")))
    for path in candidates:
        if os.path.isfile(path):
            return path, True
    return FALLBACK, False


def logo(font_path: str, cap: int) -> Image.Image:
    """Les trois mots, de même taille, alignés à gauche : lettres blanches, contour noir épais, ombre portée vers le bas à droite."""
    font = ImageFont.truetype(font_path, cap)
    # Hauteur de capitale réelle (la boîte d'une police de titres déborde souvent) : interligne serré sur les capitales.
    boxes = [font.getbbox(word) for word in LINES]
    top = min(b[1] for b in boxes)
    cap_h = max(b[3] for b in boxes) - top
    gap = round(cap_h * 0.12)
    stroke = max(2, round(cap_h * 0.085))
    shadow = max(2, round(cap_h * 0.07))
    width = max(b[2] for b in boxes) + 2 * stroke + shadow
    height = len(LINES) * cap_h + (len(LINES) - 1) * gap + 2 * stroke + shadow
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    shade = Image.new("RGBA", out.size, (0, 0, 0, 0))
    d, ds = ImageDraw.Draw(out), ImageDraw.Draw(shade)
    for i, word in enumerate(LINES):
        y = stroke - top + i * (cap_h + gap)
        ds.text((stroke + shadow, y + shadow), word, font=font, fill=(0, 0, 0, 150), stroke_width=stroke, stroke_fill=(0, 0, 0, 150))
        d.text((stroke, y), word, font=font, fill=(255, 255, 255, 255), stroke_width=stroke, stroke_fill=(10, 10, 12, 255))
    shade = shade.filter(ImageFilter.GaussianBlur(shadow * 0.6))
    return Image.alpha_composite(shade, out)


def grade(img: Image.Image) -> Image.Image:
    """Retouche de la capture : plus de contraste et de couleur, une touche de chaleur, vignette."""
    img = ImageEnhance.Contrast(img).enhance(1.12)
    img = ImageEnhance.Color(img).enhance(1.15)
    warm = Image.new("RGB", img.size, (255, 196, 120))
    img = Image.blend(img, ImageChops.multiply(img, warm), 0.18)
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((-w * 0.25, -h * 0.3, w * 1.25, h * 1.3), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.08))
    dark = ImageEnhance.Brightness(img).enhance(0.55)
    return Image.composite(img, dark, mask)


def save_webp(img: Image.Image, path: str, limit: int, quality: int = 88) -> int:
    """Enregistre en WebP en baissant la qualité jusqu'à tenir sous `limit` octets ; rend la taille."""
    while True:
        img.save(path, "WEBP", quality=quality, method=6)
        size = os.path.getsize(path)
        if size <= limit or quality <= 40:
            return size
        quality -= 6


def main() -> None:
    font_path, real = find_font(sys.argv)
    if not real:
        print(f"Police des titres absente : repli sur {FALLBACK} (logo provisoire). Déposer pricedown.otf dans .cache/fonts/.")

    # Logo seul : 3 lignes de 200 px de capitale (affiché vers 26 vh de haut sur l'écran de chargement).
    os.makedirs(os.path.join(ROOT, "src/assets"), exist_ok=True)
    mark = logo(font_path, 200)
    size = save_webp(mark, os.path.join(ROOT, "src/assets/logo.webp"), 80_000)
    print(f"src/assets/logo.webp : {mark.size[0]} × {mark.size[1]}, {size} octets")

    # Jaquette 640 × 360 : capture retouchée, logo en haut à gauche sur environ la moitié de la hauteur (lisible sur une tuile de 170 px).
    src = Image.open(os.path.join(ROOT, "tools/logo/jaquette-source.webp")).convert("RGB")
    cover = grade(src).resize((640, 360), Image.LANCZOS)
    small = logo(font_path, 64)
    scale = 190 / small.size[1]
    small = small.resize((round(small.size[0] * scale), 190), Image.LANCZOS)
    cover = cover.convert("RGBA")
    cover.alpha_composite(small, (18, 16))
    size = save_webp(cover.convert("RGB"), os.path.join(ROOT, "public/jaquette.webp"), 300_000)
    print(f"public/jaquette.webp : 640 × 360, {size} octets")

    # Écran de chargement : les captures retouchées, 1280 × 720, environ 100 Ko chacune.
    shots = sorted(glob.glob(os.path.join(ROOT, ".cache/loading/[0-9][0-9]-*.png")))
    if shots:
        dest = os.path.join(ROOT, "src/assets/loading")
        os.makedirs(dest, exist_ok=True)
        for old in glob.glob(os.path.join(dest, "*.webp")):
            os.remove(old)
        for shot in shots:
            img = grade(Image.open(shot).convert("RGB")).resize((1280, 720), Image.LANCZOS)
            name = os.path.splitext(os.path.basename(shot))[0] + ".webp"
            size = save_webp(img, os.path.join(dest, name), 140_000, quality=80)
            print(f"src/assets/loading/{name} : {size} octets")


if __name__ == "__main__":
    main()
