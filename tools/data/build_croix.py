"""Abords de la Croix de la Libération (D267, docs/plans/croix-liberation.md) : sols, route de Montjeu, point d'intérêt des passants.

Usage : python3 tools/data/build_croix.py      (après build_monuments.py croix, qui écrit le site `croix` de kinds/22_28.json)
- **parking** : la clairière de terre et de gravier clair au sud de la croix (photos 4, 5 ; orthophotographie), au lieu du rectangle d'enrobé
  d'OpenStreetMap : pixels clairs et peu colorés de l'orthophotographie, sans arbre (MNS − MNT < 1,5 m), au sud de la plate-forme, à moins de
  70 m ; la plus grande tache, lissée ; sol `path_gravel` (stabilisé clair) ;
- **allée** autour de la plate-forme (photo 1) : enrobé de 2 m au sud, à l'est et à l'ouest, gravier de 2,5 m devant le mur nord (photo 2) ;
- sous la plate-forme et ses talus, plus aucun sol de la carte (le modèle dessine les dalles) ; les sols voisins sont découpés autour des
  nouveaux, sans recouvrement ;
- **RD 256 et route d'accès** (photos 6 à 9 : ni ligne médiane ni trottoir) : marquages retirés à moins de 5 m de leur axe, trottoirs à moins
  de 9 m changés en accotements herbeux (`lawn`) ;
- **point d'intérêt « monument »** des passants, sur l'allée sud, tourné vers la croix (navigation, super-tuile de la croix).
Une deuxième passe ne change rien.
"""

import json
import math

import numpy as np
import shapely
from scipy import ndimage
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

import config as c
import survey_croix as sv

OUT = c.OUT
NAV = OUT / "nav"


def frame(site):
    ca, sa = math.cos(site["a"]), math.sin(site["a"])
    cx, cy = site["c"]
    to_xy = lambda u, t: (cx + ca * u - sa * t, cy + sa * u + ca * t)
    to_ut = lambda x, y: ((x - cx) * ca + (y - cy) * sa, -(x - cx) * sa + (y - cy) * ca)
    return to_xy, to_ut


def rect(to_xy, u0, u1, t0, t1):
    return Polygon([to_xy(u0, t0), to_xy(u1, t0), to_xy(u1, t1), to_xy(u0, t1)])


def footprint(site, to_xy, m=0.0):
    u0, u1, t0, t1 = site["deck"]
    tl = site["talus"]
    return rect(to_xy, u0 - tl["w"] - m, u1 + tl["e"] + m, t0 - tl["s"] - m, t1 + m)


def gravel_patch(site, to_xy, to_ut):
    """La clairière du parking, lue sur l'orthophotographie (0,2 m) et le modèle de hauteur (0,5 m)."""
    half, res = 60.0, 0.2
    cx, cy = site["c"]
    bx = (cx - half, cy - half, cx + half, cy + half)
    rgb = np.asarray(sv.ortho(bx, res)).astype(np.float32)
    mnt, mns = sv.dem("MNT", bx, 0.5), sv.dem("MNS", bx, 0.5)
    h, w = rgb.shape[:2]
    xs = bx[0] + (np.arange(w) + 0.5) * res
    ys = bx[3] - (np.arange(h) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    bright = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    ci = np.clip(((X - bx[0]) / 0.5).astype(int), 0, mnt.a.shape[1] - 1)
    ri = np.clip(((bx[3] - Y) / 0.5).astype(int), 0, mnt.a.shape[0] - 1)
    open_ = (mns.a - mnt.a)[ri, ci] < 1.5
    U, T = to_ut(X, Y)
    south = (T < site["deck"][2] - site["talus"]["s"] - 1.0) & (np.hypot(X - cx, Y - cy) < 70)
    # Gravier au soleil (clair, peu coloré) ou à l'ombre des arbres de la lisière (sombre, gris-bleu) ; l'herbe est verte ou jaune (saturée).
    green = rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])
    mask = (((bright > 150) & (sat < 45)) | ((bright > 45) & (sat < 32) & (green < 8))) & open_ & south
    mask = ndimage.binary_closing(ndimage.binary_opening(mask, iterations=3), iterations=6)
    lab, n = ndimage.label(mask)
    if not n:
        raise SystemExit("parking introuvable sur l'orthophotographie")
    k = 1 + int(np.argmax(np.bincount(lab.ravel())[1:]))
    pts = shapely.points(X[lab == k], Y[lab == k])
    poly = unary_union(shapely.buffer(pts[:: max(1, len(pts) // 20000)], res * 2.5)).buffer(1.5).buffer(-2.5).buffer(1.0)
    poly = max(getattr(poly, "geoms", [poly]), key=lambda g: g.area)
    return Polygon(poly.exterior).simplify(0.5)


def to_rings(g):
    out = []
    for p in getattr(g, "geoms", [g]):
        if p.geom_type != "Polygon" or p.area < 0.05:
            continue
        p = shapely.set_precision(p, 0.01)
        if p.is_empty or p.geom_type != "Polygon":
            continue
        out.append([[round(v, 2) for q in list(r.coords)[:-1] for v in q] for r in (p.exterior, *p.interiors)])
    return out


def from_rings(poly):
    rings = [[(r[i], r[i + 1]) for i in range(0, len(r), 2)] for r in poly]
    return Polygon(rings[0], rings[1:]).buffer(0)


def main():
    kinds = json.loads((OUT / "kinds" / "22_28.json").read_text())
    site = next(s for s in kinds["sites"] if s["t"] == "croix")
    to_xy, to_ut = frame(site)
    world = json.loads((OUT / "world.json").read_text())
    tiles = {t["id"]: t for t in world["tiles"]}

    # Les nouveaux sols autour de la croix.
    foot = footprint(site, to_xy)
    u0, u1, t0, t1 = site["deck"]
    tl = site["talus"]
    apron = rect(to_xy, u0 - tl["w"] - 2.0, u1 + tl["e"] + 2.0, t0 - tl["s"] - 2.0, t1).difference(foot)
    north = rect(to_xy, u0 - tl["w"] - 2.0, u1 + tl["e"] + 2.0, t1, t1 + 2.5)
    park = gravel_patch(site, to_xy, to_ut).difference(foot.buffer(2.0, join_style="mitre"))
    # Terre battue et gravier clair (photos 4, 5) : le « stabilisé clair » du chemin du plan d'eau (D244) plutôt que le gravier jaune des places.
    new = {"plaza_asphalt": apron, "path_gravel": unary_union([park, north])}
    taken = unary_union([foot, apron, north, park])
    print(f"parking : {park.area:.0f} m² de gravier (contour OSM : 1 217 m²) ; allée : {apron.area:.0f} m² d'enrobé, {north.area:.0f} m² de gravier au nord")

    # Route de Montjeu et route d'accès.
    _, _, ways = sv.osm()
    roads = unary_union([LineString(sv.chain(ways, sv.RD256)), LineString(sv.chain(ways, sv.ACCESS))])
    marks_zone, verge_zone = roads.buffer(5.0), roads.buffer(9.0)

    changed = []
    stats = {"marquages retirés": 0, "trottoirs changés en accotements (m²)": 0.0}
    for tid, t in tiles.items():
        tb = box(*t["bounds"])
        near_cross = tb.intersects(taken.buffer(1.0))
        near_road = tb.intersects(verge_zone)
        if not (near_cross or near_road):
            continue
        p = OUT / "tiles" / f"{tid}.json"
        rec = json.loads(p.read_text())
        before = json.dumps(rec["ground"], separators=(",", ":"))
        g = rec["ground"]
        if near_road:
            if "marks" in g:
                keep = [q for q in g["marks"] if not marks_zone.contains(from_rings(q).centroid)]
                stats["marquages retirés"] += len(g["marks"]) - len(keep)
                g["marks"] = keep
            if "walk" in g:
                walks = [from_rings(q) for q in g["walk"]]
                inside = [w.intersection(verge_zone) for w in walks]
                moved = [w for w in inside if w.area > 0.05]
                if moved:
                    g["walk"] = [r for w in walks for r in to_rings(w.difference(verge_zone))]
                    g["lawn"] = g.get("lawn", []) + [r for w in moved for r in to_rings(w)]
                    stats["trottoirs changés en accotements (m²)"] += sum(w.area for w in moved)
        if near_cross:
            mine = {k: v.intersection(tb) for k, v in new.items()}
            if any(not v.is_empty for v in mine.values()):
                already = all(sorted(map(json.dumps, to_rings(v))) == sorted(map(json.dumps, [q for q in g.get(k, []) if from_rings(q).intersects(v.buffer(-0.05))]))
                              for k, v in mine.items() if not v.is_empty)
                if not already:
                    cut = taken.intersection(tb)
                    for k in list(g):
                        if k.startswith("marks"):
                            continue
                        polys = [from_rings(q) for q in g[k]]
                        g[k] = [r for q in polys for r in to_rings(q.difference(cut))]
                    for k, v in mine.items():
                        if not v.is_empty:
                            g[k] = g.get(k, []) + to_rings(v)
                    g = {k: v for k, v in g.items() if v}
                    rec["ground"] = g
        if json.dumps(rec["ground"], separators=(",", ":")) != before:
            text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
            p.write_text(text)
            t["bytes"] = len(text)
            changed.append(tid)
    if changed:
        (OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"tuiles réécrites : {', '.join(changed) or 'aucune'} ; {stats}")

    # Point d'intérêt « monument » sur l'allée sud, tourné vers la croix.
    px, py = to_xy((u0 + u1) / 2, t0 - tl["s"] - 1.2)
    idx = json.loads((NAV / "index.json").read_text())
    gx, gy = idx["gridOrigin"]
    cid = f"s{math.floor((px - gx) / idx['cell'])}_{math.floor((py - gy) / idx['cell'])}"
    cp = NAV / f"{cid}.json"
    doc = json.loads(cp.read_text())
    ped = doc["ped"]
    best = 1e9
    for k in range(0, len(ped["e"]), 11):
        e = ped["e"][k:k + 11]
        pts = [(ped["n"][3 * e[0]], ped["n"][3 * e[0] + 1])] + [(ped["g"][2 * (e[9] + j)], ped["g"][2 * (e[9] + j) + 1]) for j in range(e[10])] + [(ped["n"][3 * e[1]], ped["n"][3 * e[1] + 1])]
        best = min(best, LineString(pts).distance(shapely.Point(px, py)))
    poi = [8, round(px, 2), round(py, 2), round(math.atan2(site["c"][0] - px, site["c"][1] - py), 2), min(255, round(best * 10))]
    pois = [doc["poi"][k:k + 5] for k in range(0, len(doc["poi"]), 5)]
    others = [q for q in pois if not (q[0] == 8 and math.hypot(q[1] - site["c"][0], q[2] - site["c"][1]) < 25)]
    if others + [poi] != pois:
        doc["poi"] = [v for q in others + [poi] for v in q]
        text = json.dumps(doc, separators=(",", ":"))
        cp.write_text(text)
        for e in idx["cells"]:
            if e["id"] == cid:
                e["bytes"], e["poi"] = len(text), len(doc["poi"]) // 5
        (NAV / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
        print(f"point d'intérêt « monument » : ({poi[1]} ; {poi[2]}), à {best:.1f} m de la file piétonne la plus proche ({cid})")


if __name__ == "__main__":
    main()
