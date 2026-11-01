"""Dallage du parvis de l'Hexagone (D167, lot 3 de docs/plans/hexagone.md) : vectorisation de l'orthophotographie IGN (20 cm).

Sortie : `.cache/hexagone/plaza.json` (polygones par classe de sol, repère local) et, avec --images DOSSIER, la superposition sur l'orthophotographie.
Les polygones sont ensuite recopiés dans `streetscape.plazas` de tools/data/manual.json (le relevé n'est pas rejoué par la chaîne de données).

Méthode : classement des pixels de l'orthophotographie (brique : rouge dominant ; ardoise : gris moyen bleuté, RVB ≈ 125-135 / 130-140 / 137-142 ; le reste : filets et fond clair),
majorité par cellule de 20 cm, puis, dans des zones tracées à la main sur la photo (bande d'ardoise, losange de brique, deux triangles à l'est),
union des cellules de la classe, ouverture (écarte les taches d'ombre) et simplification à 15 cm. Les filets clairs restent des vides entre les motifs.

Usage : python3 tools/data/survey_plaza.py [--images DOSSIER]
"""

import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely import box as sbox
from shapely.geometry import Polygon
from shapely.ops import unary_union

import config as c
import survey_hexagone as S

BOX = (300.0, 150.0, 360.0, 205.0)
RES = 0.2
# Zones (repère local) : lues sur la classification de l'orthophotographie.
SLATE_ZONES = {
    "bande": [(318.75, 186.25), (332.0, 185.25), (336.5, 173.0), (339.5, 154.5), (332.5, 154.25)],
    "est-haut": [(339.0, 187.0), (345.5, 187.0), (345.5, 179.0), (339.0, 183.0)],
    "est-bas": [(341.0, 173.0), (349.0, 174.0), (349.0, 165.0), (345.0, 165.0)],
}
BRICK_ZONE = [(329.75, 177.0), (332.5, 186.0), (338.5, 187.0), (344.5, 180.0), (347.5, 167.0), (345.0, 165.0), (339.0, 165.5), (334.5, 168.0), (330.0, 172.5)]
SPHERE = (340.4, 175.2)


def classes():
    data = S.wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", BOX, 600, 550, "plaza.jpg")
    a = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(float)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    L = a.mean(2)
    brick = (R - B > 14) & (R - G > 6) & (L > 105)
    slate = (L > 95) & (L < 152) & (B - R > 5) & (np.abs(G - R) < 14)
    return brick, slate


def cells(mask):
    """Majorité par cellule de 20 cm (blocs de 2 × 2 pixels de 10 cm) ; rend le tableau des cellules vraies."""
    h, w = mask.shape
    m = mask[: h // 2 * 2, : w // 2 * 2].reshape(h // 2, 2, w // 2, 2).sum((1, 3))
    return m >= 3


def union_cells(m, zone):
    zone = Polygon(zone)
    rows, cols = np.nonzero(m)
    boxes = [sbox(BOX[0] + j * RES, BOX[3] - (i + 1) * RES, BOX[0] + (j + 1) * RES, BOX[3] - i * RES) for i, j in zip(rows, cols)]
    boxes = [b for b in boxes if zone.intersects(b.centroid)]
    return unary_union(boxes).intersection(zone) if boxes else Polygon()


def polys(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for part in getattr(g, "geoms", []) for p in polys(part)]


def encode(p):
    def ring(r):
        pts = [(round(x, 2), round(y, 2)) for x, y in list(r.coords)[:-1]]
        return [v for xy in pts for v in xy]
    return [ring(p.exterior)] + [ring(h) for h in p.interiors]


def main():
    images = Path(sys.argv[sys.argv.index("--images") + 1]) if "--images" in sys.argv else None
    brick_px, slate_px = classes()
    brick_c, slate_c = cells(brick_px), cells(slate_px)
    slate = unary_union([union_cells(slate_c, z) for z in SLATE_ZONES.values()])
    slate = slate.buffer(-0.2).buffer(0.2).simplify(0.15)
    brick = union_cells(brick_c, BRICK_ZONE).buffer(0.5).buffer(-0.5)
    brick = brick.intersection(Polygon(BRICK_ZONE)).difference(slate.buffer(0.05)).buffer(-0.1).buffer(0.1).simplify(0.15)
    # Fond clair : l'emprise des motifs élargie d'un mètre (les filets sont les vides entre les motifs).
    base = unary_union([Polygon(z) for z in SLATE_ZONES.values()] + [Polygon(BRICK_ZONE)]).buffer(1.0, join_style="mitre").simplify(0.2)
    out = {
        "plaza_slate": [encode(p) for p in polys(slate) if p.area > 0.3],
        "plaza_brick": [encode(p) for p in polys(brick) if p.area > 0.8],
        "plaza_filet": [encode(p) for p in polys(base)],
        "sphere": SPHERE,
    }
    S.CACHE.mkdir(parents=True, exist_ok=True)
    (S.CACHE / "plaza.json").write_text(json.dumps(out))
    print({k: (len(v) if isinstance(v, list) and k != "sphere" else v) for k, v in out.items()}, f"; ardoise {slate.area:.0f} m², brique {brick.area:.0f} m², fond {base.area:.0f} m²")
    if images:
        images.mkdir(parents=True, exist_ok=True)
        im = Image.open(io.BytesIO(S.wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", BOX, 600, 550, "plaza.jpg"))).convert("RGB").resize((1500, 1375), Image.LANCZOS)
        k = 25
        d = ImageDraw.Draw(im, "RGBA")
        px = lambda x, y: ((x - BOX[0]) * k, (BOX[3] - y) * k)
        for g, col in ((base, (255, 255, 0, 60)), (brick, (255, 80, 60, 110)), (slate, (40, 80, 255, 120))):
            for p in polys(g):
                d.polygon([px(*q) for q in p.exterior.coords], fill=col, outline=col[:3] + (255,))
        im.save(images / "hexagone-lot3-dallage-releve.jpg", quality=86)


if __name__ == "__main__":
    main()
