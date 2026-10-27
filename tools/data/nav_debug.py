"""Image de contrôle de la navigation : sols et bâtiments des tuiles, puis (si public/data/nav existe) les files, passages et points d'intérêt.

Usage : python3 tools/data/nav_debug.py <sortie.png> x0 y0 x1 y1 [pixels_par_metre=4] [--no-nav]   (coordonnées locales, repère du jeu)
Lit public/data/tiles/*.json et public/data/nav/*.json ; n'écrit que l'image.
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data"

LAYER_COLORS = {
    "lawn": "#a9c98f", "pitch": "#9cc08a", "water": "#8fb7d6", "road_asphalt": "#6e6e72", "road_sett": "#8a8078", "road_paving": "#8a8078",
    "road_gravel": "#a99f86", "plaza_asphalt": "#9a9a9a", "plaza_paving": "#d9cfb8", "plaza_sett": "#bfb29b", "plaza_gravel": "#d8c9a0", "walk": "#e8e2d4",
}
ORDER = ["lawn", "pitch", "water", "plaza_paving", "plaza_sett", "plaza_gravel", "plaza_asphalt", "walk", "road_gravel", "road_sett", "road_paving", "road_asphalt"]
PED_COLORS = {0: "#1f77b4", 1: "#2ca02c", 2: "#d62728", 3: "#ff7f0e", 4: "#e377c2", 5: "#17becf", 6: "#8c564b", 7: "#bcbd22", 8: "#9467bd", 9: "#1f77b4"}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = args[0]
    x0, y0, x1, y1 = (float(v) for v in args[1:5])
    k = float(args[5]) if len(args) > 5 else 4.0
    show_nav = "--no-nav" not in sys.argv
    W, H = int((x1 - x0) * k), int((y1 - y0) * k)
    img = Image.new("RGB", (W, H), "#f2e4c0")
    d = ImageDraw.Draw(img)

    def px(x, y):
        return ((x - x0) * k, (y1 - y) * k)

    tiles = []
    for f in sorted((DATA / "tiles").glob("*.json")):
        b = [float(v) for v in f.stem.split("_")]
        t = json.loads(f.read_text())
        tb = t["bounds"]
        if tb[2] < x0 or tb[0] > x1 or tb[3] < y0 or tb[1] > y1:
            continue
        tiles.append(t)
    for layer in ORDER:
        for t in tiles:
            for poly in t["ground"].get(layer, []):
                for i, ring in enumerate(poly):
                    pts = [px(ring[j], ring[j + 1]) for j in range(0, len(ring), 2)]
                    d.polygon(pts, fill=LAYER_COLORS[layer] if i == 0 else "#f2e4c0")
    for t in tiles:
        for b in t["buildings"]:
            r = b["ring"]
            d.polygon([px(r[j], r[j + 1]) for j in range(0, len(r), 2)], fill="#c9b79c", outline="#7a6a55")
        for w in t["walls"]:
            p = w["pts"]
            d.line([px(p[j], p[j + 1]) for j in range(0, len(p), 2)], fill="#5a4a3a", width=1)
        for tr in t["trees"]:
            cx, cy = px(tr[0], tr[1])
            d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill="#4f9a5a")
        for f in t["furniture"]:
            cx, cy = px(f["x"], f["y"])
            col = {"crossing": "#d62728", "traffic_signals": "#ff7f0e", "stop": "#000000", "give_way": "#555555", "bench": "#8c564b"}.get(f["kind"])
            if col:
                d.rectangle([cx - 2, cy - 2, cx + 2, cy + 2], outline=col)
    nav_dir = DATA / "nav"
    if show_nav and nav_dir.exists():
        for f in sorted(nav_dir.glob("s*.json")):
            c = json.loads(f.read_text())
            bb = c["bounds"]
            if bb[2] < x0 or bb[0] > x1 or bb[3] < y0 or bb[1] > y1:
                continue
            ped = c["ped"]
            n, e, g = ped["n"], ped["e"], ped["g"]
            S = 11
            for i in range(0, len(e), S):
                a, b, typ, _fl, _w, _foot, _zone, _len, _ref, p0, npts = e[i:i + S]
                pts = [px(n[a * 3], n[a * 3 + 1])] + [px(g[(p0 + j) * 2], g[(p0 + j) * 2 + 1]) for j in range(npts)] + [px(n[b * 3], n[b * 3 + 1])]
                d.line(pts, fill=PED_COLORS.get(typ, "#000000"), width=2)
            for i in range(0, len(n), 3):
                cx, cy = px(n[i], n[i + 1])
                d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill="#ffffff" if not (n[i + 2] & 1) else "#000000", outline="#222222")
            road = c.get("road")
            if road:
                rn, re_, rg = road["n"], road["e"], road["g"]
                RS = 11
                for i in range(0, len(re_), RS):
                    a, b = re_[i], re_[i + 1]
                    p0, npts = re_[i + RS - 2], re_[i + RS - 1]
                    pts = [px(rn[a * 3], rn[a * 3 + 1])] + [px(rg[(p0 + j) * 2], rg[(p0 + j) * 2 + 1]) for j in range(npts)] + [px(rn[b * 3], rn[b * 3 + 1])]
                    d.line(pts, fill="#000000", width=1)
    img.save(out)
    print(out, img.size)


if __name__ == "__main__":
    main()
