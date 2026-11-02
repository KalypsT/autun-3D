"""Images collées sur les murs (D186) -> public/decals/*.png.

  python3 build_decals.py [photo-de-la-fresque.jpg]

- lutrin-long.png et lutrin-pignon.png : façades à colombages tracées (plâtre crème, poutres rouge sombre, croix de Saint-André, fenêtres sombres) pour la maison du
  Lutrin (1 place du Terreau), l'une pour le long pan sur la place, l'autre pour le pignon sur la rue ;
- fresque.png : la fresque d'Autun (mur est de Chez Daddy), recadrée dans la photo de l'utilisateur ; le ciel et les bords hors du mur sont transparents.
"""
import random
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[2] / "public" / "decals"
PX = 64  # pixels par mètre des façades tracées
PLASTER, BEAM, GLASS, FRAME = (238, 222, 190), (125, 31, 31), (46, 58, 71), (236, 226, 204)


def timber(width_m, height_m, floors, name, seed):
    """Façade à colombages : `floors` = hauteurs des niveaux (m), du bas vers le haut ; le dernier niveau est un comble à petites fenêtres."""
    rnd = random.Random(seed)
    k = 2  # suréchantillonnage
    W, H = int(width_m * PX * k), int(height_m * PX * k)
    im = Image.new("RGB", (W, H), PLASTER)
    px = ImageDraw.Draw(im)
    # Grain du plâtre.
    for _ in range(W * H // 40):
        x, y = rnd.randrange(W), rnd.randrange(H)
        d = rnd.randint(-10, 8)
        px.point((x, y), (PLASTER[0] + d, PLASTER[1] + d, PLASTER[2] + d))
    m = PX * k
    beam = 0.16 * m
    y = H  # on dessine de bas en haut
    levels = []
    for h in floors:
        levels.append((y - h * m, y))
        y -= h * m
    for li, (top, bottom) in enumerate(levels):
        attic = li == len(levels) - 1
        # Lisses haute et basse du niveau.
        px.rectangle([0, top, W, top + 0.3 * m], fill=BEAM)
        px.rectangle([0, bottom - 0.3 * m, W, bottom], fill=BEAM)
        # Poteaux tous les 1,05 m environ, panneaux entre eux.
        n = max(2, round(width_m / 1.55))
        step = W / n
        for i in range(n + 1):
            x = i * step
            px.rectangle([x - beam / 2, top, x + beam / 2, bottom], fill=BEAM)
        for i in range(n):
            x0, x1 = i * step + beam / 2, (i + 1) * step - beam / 2
            y0, y1 = top + 0.3 * m, bottom - 0.3 * m
            # Teinte du panneau légèrement variable (plâtre refait par endroits).
            t = rnd.randint(-7, 5)
            px.rectangle([x0, y0, x1, y1], fill=(PLASTER[0] + t, PLASTER[1] + t, PLASTER[2] + t))
            window = (i + 2 * li) % 3 == 1 if not attic else i % 3 == 2
            if not window:
                # Croix de Saint-André ; un panneau sur quatre garde seulement une jambe de force.
                px.line([x0, y0, x1, y1], fill=BEAM, width=int(beam * 0.9))
                if (i * 7 + li) % 4 != 0:
                    px.line([x0, y1, x1, y0], fill=BEAM, width=int(beam * 0.9))
            else:
                # Fenêtre : cadre clair, deux vantaux sombres, petit bois.
                ww, wh = (x1 - x0) * 0.46, (y1 - y0) * (0.42 if attic else 0.6)
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + (0.1 * m if not attic else 0.05 * m)
                box = [cx - ww / 2, cy - wh / 2, cx + ww / 2, cy + wh / 2]
                px.rectangle([box[0] - 0.06 * m, box[1] - 0.06 * m, box[2] + 0.06 * m, box[3] + 0.06 * m], fill=FRAME)
                px.rectangle(box, fill=GLASS)
                px.line([cx, box[1], cx, box[3]], fill=FRAME, width=int(0.05 * m))
                px.line([box[0], cy, box[2], cy], fill=FRAME, width=int(0.05 * m))
    # Ombre sous chaque lisse (encorbellement) : léger dégradé.
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    for top, _ in levels[1:]:
        sd.rectangle([0, top + 0.3 * m, W, top + 0.9 * m], fill=34)
    shade = shade.filter(ImageFilter.GaussianBlur(0.12 * m))
    im = Image.composite(Image.new("RGB", (W, H), (60, 40, 30)), im, shade)
    im = im.resize((W // k, H // k), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.4))
    im.save(OUT / name, optimize=True)
    return im.size


def fresque(photo):
    """Recadre la fresque dans la photo (coordonnées de la photo réduite de moitié, ×2) ; l'extérieur du pignon est transparent."""
    im = Image.open(photo).convert("RGB")
    box = (0, 2 * 309, 1256, 2 * 1095)
    crop = im.crop(box)
    poly = [(0, 1095), (0, 742), (52, 500), (275, 309), (560, 348), (628, 800), (628, 1095)]
    mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(mask).polygon([(x * 2 - box[0] + (3 if x == 0 else -3 if x == 628 else 0), y * 2 - box[1] + (3 if y == 309 else 0)) for x, y in poly], fill=255)
    mask = mask.filter(ImageFilter.MinFilter(5))  # recule le bord : plus de liseré de ciel
    crop.putalpha(mask)
    crop = crop.resize((640, round(640 * crop.height / crop.width)), Image.LANCZOS)
    crop.save(OUT / "fresque.png", optimize=True)
    return crop.size


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    print("lutrin-long", timber(10.0, 9.8, [3.3, 3.3, 3.2], "lutrin-long.png", 1))
    print("lutrin-pignon", timber(11.29, 11.4, [3.3, 3.3, 3.2, 1.6], "lutrin-pignon.png", 2))
    if len(sys.argv) > 1:
        print("fresque", fresque(sys.argv[1]))
