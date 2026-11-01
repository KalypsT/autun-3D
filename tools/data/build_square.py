"""Place du Champ de Mars (D155) : tilleuls taillés en rideau et kiosque à musique, mesurés au LiDAR.

Usage : python3 tools/data/build_square.py      (après build_kinds.py, qui réécrit public/data/kinds, et build_monuments.py ; puis relancer celle-ci)
Entrées : `square` de tools/data/manual.json (points des rideaux et photos), tiles/*.json (bâtiments, arbres), modèles de surface et de terrain LiDAR
          HD de l'IGN (WMS, 0,5 m, gardés dans .cache/shared/raw/monuments).
Sorties : sites `curtain` (un par rideau) et `bandstand` (kiosque) dans kinds/<tuile>.json ; bâtiment BD TOPO du kiosque masqué (`hidden`) et sa silhouette
          lointaine remplacée par un octogone. Rien d'autre. Une deuxième passe ne change rien.

Mesures :
- rideau : composante connexe des cellules à plus de 2,5 m au-dessus du terrain (hors bâtiments BD TOPO) qui contient le point donné ; rectangle
  minimal orienté ; haut = médiane de la hauteur sur les cellules à plus de 1,5 m du bord du rectangle ; sol = médiane du terrain ; remplissage
  = part du rectangle couverte (contrôle) ;
- kiosque : contour BD TOPO (octogone) ; sol du plancher = point le plus haut du terrain sur le contour ; sommet = maximum du modèle de surface
  sur le contour ; côté bas = direction du point le plus bas du terrain sur le contour (côté des marches).
Le LiDAR ne voit pas ce qui est sous les couronnes : hauteur des troncs et pas des arbres viennent de `manual.json` (photos).
"""

import json
import math

import numpy as np
from scipy import ndimage
from shapely.geometry import MultiPoint, Point, Polygon
from shapely.ops import unary_union

import config as c
from build_monuments import KINDS, Raster, replace_lod


def tile_of(x, y):
    return f"{int((x + c.ORIGIN[0]) // c.TILE) - c.GRID_I0}_{int((y + c.ORIGIN[1]) // c.TILE) - c.GRID_J0}"


def all_tiles():
    world = json.load(open(c.OUT / "world.json"))
    out = {}
    for m in world["tiles"]:
        p = c.OUT / "tiles" / f"{m['id']}.json"
        if p.exists():
            out[m["id"]] = json.loads(p.read_text())
    return out


def measure_curtain(spec, tiles):
    x, y = spec["at"]
    W = 34
    x0, y0 = math.floor(x - W), math.floor(y - W)
    key = "square_" + spec["name"].replace(" ", "_")
    mns, mnt = Raster("MNS", key, x0, y0, x0 + 2 * W, y0 + 2 * W), Raster("MNT", key, x0, y0, x0 + 2 * W, y0 + 2 * W)
    X, Y = np.meshgrid(x0 + 0.25 + 0.5 * np.arange(mns.a.shape[1]), mns.y1 - 0.25 - 0.5 * np.arange(mns.a.shape[0]))
    nd = mns.a - mnt.a
    bld = unary_union([Polygon(list(zip(b["ring"][0::2], b["ring"][1::2]))).buffer(0.5) for t in tiles.values() for b in t["buildings"]
                       if not (b["ring"][0] > x + W + 20 or b["ring"][0] < x - W - 20)])
    from shapely import contains_xy
    mask = (nd > 2.5) & ~contains_xy(bld, X, Y)
    mask = ndimage.binary_opening(mask, iterations=1)
    lab, _ = ndimage.label(mask)
    i = lab[int((mns.y1 - y) / 0.5), int((x - x0) / 0.5)]
    if i == 0:
        # La fente sombre entre les deux files de troncs est plus basse que le seuil : on prend la couronne la plus proche, à moins de 4 m.
        d = (X - x) ** 2 + (Y - y) ** 2
        d[lab == 0] = 1e9
        j = np.unravel_index(np.argmin(d), d.shape)
        i = lab[j] if d[j] < 16 else 0
    if i == 0:
        raise SystemExit(f"{spec['name']} : pas de couronne au point {spec['at']}")
    sel = lab == i
    pts = MultiPoint(list(zip(X[sel], Y[sel])))
    rect = pts.minimum_rotated_rectangle
    cs = list(rect.exterior.coords)
    e0 = math.dist(cs[0], cs[1])
    e1 = math.dist(cs[1], cs[2])
    # Le grand côté d'abord.
    (ax, ay), (bx, by), (cx_, cy_) = cs[0], cs[1], cs[2]
    if e0 >= e1:
        l, w, ang = e0, e1, math.atan2(by - ay, bx - ax)
    else:
        l, w, ang = e1, e0, math.atan2(cy_ - by, cx_ - bx)
    ang = ang % math.pi
    c0 = rect.centroid
    # Repère du rectangle pour mesurer le haut loin des bords.
    ux, uy = math.cos(ang), math.sin(ang)
    s = (X - c0.x) * ux + (Y - c0.y) * uy
    t = -(X - c0.x) * uy + (Y - c0.y) * ux
    core = sel & (np.abs(s) < l / 2 - 1.5) & (np.abs(t) < w / 2 - 1.0)
    fill = float(sel.sum() * 0.25 / (l * w))
    top = float(np.median(nd[core]))
    g = float(np.median(mnt.a[sel]))
    # Pied et sommet du rectangle sur le terrain (pente le long du rideau).
    return {"t": "curtain", "n": spec["name"], "c": [round(c0.x, 2), round(c0.y, 2)], "a": round(ang, 4), "l": round(l, 1), "w": round(w, 1),
            "g": round(g, 2), "top": round(top, 1), "fill": round(fill, 2), "trunk": spec["trunk"], "pitch": spec["pitch"], "rows": spec["rows"],
            "crown": spec["crown"]}


def measure_bandstand(spec, tiles):
    bid = spec["bid"]
    tid, b = next((tid, b) for tid, t in tiles.items() for b in t["buildings"] if b["id"] == bid)
    ring = list(zip(b["ring"][0::2], b["ring"][1::2]))
    poly = Polygon(ring)
    cx, cy = poly.centroid.x, poly.centroid.y
    W = 12
    x0, y0 = math.floor(cx - W), math.floor(cy - W)
    mns, mnt = Raster("MNS", "square_bandstand", x0, y0, x0 + 2 * W, y0 + 2 * W), Raster("MNT", "square_bandstand", x0, y0, x0 + 2 * W, y0 + 2 * W)
    # Terrain sur le contour (sommets et milieux d'arêtes), sommet du modèle de surface à l'intérieur.
    edge = [Point(poly.exterior.interpolate(d)).coords[0] for d in np.arange(0, poly.exterior.length, 0.5)]
    zs = [mnt(px, py) for px, py in edge]
    lo, hi = min(zs), max(zs)
    low = edge[int(np.argmin(zs))]
    top = max(mns(px, py) for px in np.arange(cx - 4, cx + 4.01, 0.5) for py in np.arange(cy - 4, cy + 4.01, 0.5) if poly.contains(Point(px, py)))
    # Rayon du cercle circonscrit et orientation de l'octogone (sommet le plus proche de l'est).
    verts = ring[:-1] if ring[0] == ring[-1] else ring
    rc = float(np.mean([math.dist((cx, cy), v) for v in verts]))
    ph = math.atan2(verts[0][1] - cy, verts[0][0] - cx)
    return tid, {"t": "bandstand", "n": spec["name"], "id": bid, "c": [round(cx, 2), round(cy, 2)], "r": round(rc, 2), "ph": round(ph, 4),
                 "nv": len(verts), "lo": round(lo, 2), "hi": round(hi, 2), "top": round(top, 2),
                 "low": round(math.atan2(low[1] - cy, low[0] - cx), 3), "floor": spec["floor"], "post": spec["post"], "eave": spec["eave"],
                 "steps": spec["steps"]}


def write(tid, site, key, hide=None):
    kp = KINDS / f"{tid}.json"
    k = json.loads(kp.read_text()) if kp.exists() else {"v": 1, "buildings": {}, "sites": []}
    # Un site déjà là, identique, ne bouge pas (sinon l'ordre changerait à chaque passe).
    changed = site not in k["sites"]
    if changed:
        k["sites"] = [q for q in k["sites"] if not (q.get("t") == site["t"] and q.get("n") == site["n"])] + [site]
    if hide and k["buildings"].get(hide) != {"k": "hidden"}:
        k["buildings"][hide] = {"k": "hidden"}
        changed = True
    if not changed:
        return False
    kp.write_text(json.dumps(k, ensure_ascii=False, separators=(",", ":")))
    index = json.loads((KINDS / "index.json").read_text())
    if tid not in index["tiles"]:
        index["tiles"] = sorted(index["tiles"] + [tid])
    index["stats"]["sites"][site["t"]] = key
    (KINDS / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    return True


def main():
    spec = json.load(open(c.ROOT / "tools" / "data" / "manual.json"))["square"]
    tiles = all_tiles()
    changed = 0
    for cs in spec["curtains"]:
        site = measure_curtain({**cs, **{k: spec[k] for k in ("trunk", "pitch", "rows", "crown")}}, tiles)
        print(f"  {site['n']} : {site['l']} × {site['w']} m, haut {site['top']} m au-dessus de {site['g']}, remplissage {site['fill']}, cap {math.degrees(site['a']):.0f}°")
        changed += write(tile_of(*site["c"]), site, len(spec["curtains"]))
    tid, bs = measure_bandstand(spec["bandstand"], tiles)
    print(f"  kiosque : octogone de {bs['r']} m de rayon, sol de {bs['lo']} à {bs['hi']} m, sommet à {bs['top']} m ({bs['top'] - bs['hi']:.1f} m au-dessus du plancher),"
          f" marches vers {math.degrees(bs['low']):.0f}°")
    changed += write(tid, bs, 1, hide=bs["id"])
    # Silhouette lointaine : un octogone au lieu de la maison.
    a = [(bs["c"][0] + bs["r"] * math.cos(bs["ph"] + 2 * math.pi * i / bs["nv"]), bs["c"][1] + bs["r"] * math.sin(bs["ph"] + 2 * math.pi * i / bs["nv"])) for i in range(bs["nv"])]
    if replace_lod(tid, bs["id"], [([[round(x, 1), round(y, 1)] for x, y in a], bs["hi"] + bs["eave"], bs["top"])]):
        print("  silhouette lointaine du kiosque remplacée")
    print(f"{len(spec['curtains'])} rideaux et un kiosque ; {changed} fichier(s) de types réécrit(s)")


if __name__ == "__main__":
    main()
