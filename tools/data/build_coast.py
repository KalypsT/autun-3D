"""La mer autour du monde (D105) : découpe à la côte tout ce qui a été fabriqué, creuse le rivage et le fond marin.

Usage : python3 tools/data/build_coast.py
À lancer après les blocs, build_structures.py, build_kinds.py et build_public_space.py, avant build_nav.py et build_map.py (qui lisent la
même terre dans coast_lib.py). Ne touche qu'aux tuiles qui approchent la côte. Idempotente : la relancer ne change plus rien.

Pour chaque tuile proche de la côte :
  terrain/<id>.bin   sol plafonné par le profil du rivage (coast_lib.shore_cap) : falaise sur les hauteurs, plage dans la plaine, fond marin
  ground/<id>_*.png  sable sur la plage et sous l'eau, roche sur les falaises
  tiles/<id>.json    bâtiments, fiches, arbres, murs, mobilier et sols découpés à la côte
  lod/, kinds/, structures/   même découpe
Puis le relief grossier (terrain/coarse.bin) et les sols grossiers des super-tuiles, et `sea` dans world.json : { z, coast }.
"""

import json
import math

import numpy as np
from PIL import Image
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

import coast_lib as k
import config as c

OUT = c.OUT
UNIT = 0.01
# Une tuile plus loin que cela de la côte, entièrement à terre, n'est pas touchée : plage (35 m) puis falaise (3 m/m) y dépasseraient 600 m.
REACH = 200.0
# Poids de mélange des sols (D30) : A = asphalte, pavés, gravier ; B = herbe, trottoir, ombre. Sable : le gravier ; roche : les pavés, assombris.
SAND = ((0, 0, 255), (0, 0, 0))
SEABED = ((0, 0, 255), (0, 0, 110))
ROCK = ((0, 255, 0), (0, 0, 70))


def read_block(path):
    buf = path.read_bytes()
    base, ox, oy, n = np.frombuffer(buf, dtype="<f4", count=4)
    n = int(n)
    raw = np.frombuffer(buf, dtype="<u2", offset=16, count=n * n).reshape(n, n)
    return float(ox), float(oy), n, float(base) + raw.astype(np.float64) * UNIT


def write_block(path, ox, oy, n, z):
    cm = np.round(z / UNIT).astype(np.int64)
    lo = int(cm.min())
    head = np.array([lo * UNIT, ox, oy, n], dtype="<f4")
    path.write_bytes(head.tobytes() + (cm - lo).astype("<u2").tobytes())


def shore(z, sd):
    """Sol plafonné, et masques du rivage (sable, roche, mer) pour les sols et la découpe."""
    new = np.minimum(z, k.shore_cap(sd))
    sand, rock, sea = k.shore_masks(new, sd)
    return new, sand, rock, sea


def mask_polygon(mask, ox, oy, cell=2):
    """Le masque (grille de 1 m, coin nord-ouest ox, oy) en polygones : cellules de `cell` mètres fusionnées, contour lissé."""
    n = mask.shape[0] // cell * cell
    mm = mask[:n, :n].reshape(n // cell, cell, n // cell, cell).mean(axis=(1, 3)) >= 0.5
    boxes = []
    for r in range(mm.shape[0]):
        d = np.diff(np.concatenate([[0], mm[r].astype(np.int8), [0]]))
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            boxes.append(box(ox + a * cell, oy - (r + 1) * cell, ox + b * cell, oy - r * cell))
    if not boxes:
        return Polygon()
    return unary_union(boxes).buffer(1.0).buffer(-1.0)


def paint(path_a, path_b, sand, rock, sea):
    a = np.array(Image.open(path_a).convert("RGB"))
    b = np.array(Image.open(path_b).convert("RGB"))
    for mask, (wa, wb) in ((rock, ROCK), (sand & ~sea & ~rock, SAND), (sea, SEABED)):
        a[mask] = wa
        b[mask] = wb
    Image.fromarray(a).save(path_a, optimize=True)
    Image.fromarray(b).save(path_b, optimize=True)


def grid_xy(ox, oy, n, res=1.0):
    xs = ox + (np.arange(n) + 0.5) * res
    ys = oy - (np.arange(n) + 0.5) * res
    return np.meshgrid(xs, ys)


def ring_points(ring):
    return [(ring[i], ring[i + 1]) for i in range(0, len(ring) - 1, 2)]


def footprint_on_land(ring):
    pts = ring_points(ring)
    if len(pts) < 3:
        return False
    poly = Polygon(pts)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.area <= 0:
        return k.on_land(*pts[0])
    return poly.intersection(k.land()).area >= 0.9 * poly.area


def clip_tile(rec, shore_poly, in_shore):
    """Découpe le contenu d'une tuile à la côte (`k.land`) et au rivage (plage, falaise : `shore_poly`, `in_shore(x, y)`)."""
    def ok_footprint(ring):
        if not footprint_on_land(ring):
            return False
        if shore_poly.is_empty:
            return True
        poly = Polygon(ring_points(ring)).buffer(0)
        return poly.area <= 0 or poly.intersection(shore_poly).area <= 0.1 * poly.area

    kept = [b for b in rec["buildings"] if ok_footprint(b["ring"])]
    ids = {b["id"] for b in kept}
    gone = len(rec["buildings"]) - len(kept)
    rec["buildings"] = kept
    rec["fiches"] = [f for f in rec["fiches"] if f["id"] in ids]
    rec["trees"] = [t for t in rec["trees"] if k.on_land(t[0], t[1], 1.0) and not in_shore(t[0], t[1])]
    walls = []
    for w in rec["walls"]:
        pieces = k.clip_line(w["pts"])
        if not shore_poly.is_empty:
            cut = []
            for pts in pieces:
                g = LineString([(pts[i], pts[i + 1]) for i in range(0, len(pts) - 1, 2)]).difference(shore_poly)
                for part in getattr(g, "geoms", [g]):
                    if part.geom_type == "LineString" and part.length >= 0.5:
                        cut.append([round(v, 2) for p in part.coords for v in p])
            pieces = cut
        for i, pts in enumerate(pieces):
            walls.append({**w, "pts": pts} if i == 0 else {**w, "id": w["id"] * 100 - i, "pts": pts})
    rec["walls"] = walls
    rec["furniture"] = [f for f in rec["furniture"] if k.on_land(f["x"], f["y"], 0.5) and not in_shore(f["x"], f["y"])]
    ground = {}
    for layer, polys in rec["ground"].items():
        out = []
        for poly in polys:
            for p in k.clip_polygon(poly):
                if shore_poly.is_empty:
                    out.append(p)
                    continue
                g = Polygon(ring_points(p[0]), [ring_points(h) for h in p[1:]]).buffer(0)
                if not g.intersects(shore_poly):
                    out.append(p)
                    continue
                for part in getattr(g.difference(shore_poly), "geoms", [g.difference(shore_poly)]):
                    if part.geom_type == "Polygon" and part.area >= 0.5:
                        out.append([[round(v, 2) for xy in list(r.coords)[:-1] for v in xy] for r in (part.exterior, *part.interiors)])
        if out:
            ground[layer] = out
    rec["ground"] = ground
    return gone


def clip_structures(st):
    for key in ("decks", "rails", "streams", "weirs", "platforms", "crossings"):
        items = []
        for it in st.get(key, []):
            if isinstance(it, dict) and "p" in it:
                stride = 3 if key == "decks" else 2
                for pts in k.clip_line(it["p"], stride):
                    items.append({**it, "p": pts})
            elif isinstance(it, dict) and "x" in it:
                if k.on_land(it["x"], it["y"]):
                    items.append(it)
            else:
                items.append(it)
        if key in st:
            st[key] = items
    st["water"] = [p for poly in st.get("water", []) for p in k.clip_polygon(poly)]


def near_coast(bounds):
    tb = box(*bounds)
    g = k.land()
    return not g.contains(tb) or g.exterior.distance(tb) < REACH


def main():
    wpath = OUT / "world.json"
    world = json.loads(wpath.read_text())
    stats = {"tiles": 0, "buildings": 0, "trees": 0, "cells_lowered": 0}
    for t in world["tiles"]:
        if not near_coast(t["bounds"]):
            continue
        stats["tiles"] += 1
        tid = t["id"]
        # Relief fin et sols fins (même grille de 1 m).
        tpath = OUT / "terrain" / f"{tid}.bin"
        ox, oy, n, z = read_block(tpath)
        xx, yy = grid_xy(ox, oy, n)
        sd = k.signed_distance(xx, yy)
        new, sand, rock, sea = shore(z, sd)
        stats["cells_lowered"] += int((z - new > 0.01).sum())
        write_block(tpath, ox, oy, n, new)
        ga, gb = OUT / "ground" / f"{tid}_a.png", OUT / "ground" / f"{tid}_b.png"
        if ga.exists() and gb.exists():
            paint(ga, gb, sand, rock, sea)
        # Contenu de la tuile : rien en mer, ni sur la plage ou la falaise.
        rim = sand | rock | sea
        shore_poly = mask_polygon(rim, ox, oy)

        def in_shore(x, y, ox=ox, oy=oy, n=n, rim=rim):
            i, j = int(oy - y), int(x - ox)
            return 0 <= i < n and 0 <= j < n and bool(rim[i, j])

        p = OUT / "tiles" / f"{tid}.json"
        rec = json.loads(p.read_text())
        trees0 = len(rec["trees"])
        stats["buildings"] += clip_tile(rec, shore_poly, in_shore)
        stats["trees"] += trees0 - len(rec["trees"])
        text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        p.write_text(text)
        t.update(buildings=len(rec["buildings"]), trees=len(rec["trees"]), walls=len(rec["walls"]), furniture=len(rec["furniture"]), bytes=len(text))
        lp = OUT / "lod" / f"{tid}.json"
        if lp.exists():
            lod = [s for s in json.loads(lp.read_text()) if footprint_on_land(s["r"])]
            if lod:
                lp.write_text(json.dumps(lod, separators=(",", ":")))
            else:
                lp.unlink()  # pas de fichier de silhouettes pour une tuile sans bâtiment (comme pack.py)
            t["lod"] = len(lod)
        kp = OUT / "kinds" / f"{tid}.json"
        if kp.exists():
            kd = json.loads(kp.read_text())
            kept = {b["id"] for b in rec["buildings"]}
            kd["buildings"] = {i: v for i, v in kd.get("buildings", {}).items() if i in kept}
            kd["sites"] = [s for s in kd.get("sites", []) if not isinstance(s, dict) or "r" not in s or footprint_on_land(s["r"])]
            kp.write_text(json.dumps(kd, ensure_ascii=False, separators=(",", ":")))
        sp = OUT / "structures" / f"{tid}.json"
        if sp.exists():
            st = json.loads(sp.read_text())
            clip_structures(st)
            sp.write_text(json.dumps(st, ensure_ascii=False, separators=(",", ":")))

    # Relief grossier (8 m, centres des cellules).
    meta = world["coarse"]
    raw = np.frombuffer((OUT / "terrain" / "coarse.bin").read_bytes(), dtype="<u2").reshape(meta["rows"], meta["cols"])
    z = meta["base"] + raw.astype(np.float64) * meta["unit"]
    xs =meta["x0"] + (np.arange(meta["cols"]) + 0.5) * meta["res"]
    ys = meta["y1"] - (np.arange(meta["rows"]) + 0.5) * meta["res"]
    xx, yy = np.meshgrid(xs, ys)
    new, _, _, _ = shore(z, k.signed_distance(xx, yy))
    lo = math.floor(float(new.min()))
    (OUT / "terrain" / "coarse.bin").write_bytes(np.round((new - lo) / meta["unit"]).astype("<u2").tobytes())
    meta.update(base=float(lo), zmin=float(new.min()), zmax=float(new.max()))

    # Sols grossiers des super-tuiles (4 m) : sable et roche d'après le relief grossier.
    sup = world["super"]
    for cell in sup["cells"]:
        x0, y1, res, size = cell["x0"], cell["y1"], sup["res"], sup["size"]
        if not near_coast((x0, y1 - size * res, x0 + size * res, y1)):
            continue
        cx, cy = np.meshgrid(x0 + (np.arange(size) + 0.5) * res, y1 - (np.arange(size) + 0.5) * res)
        cc = np.clip(((cx - meta["x0"]) / meta["res"]).astype(int), 0, meta["cols"] - 1)
        rr = np.clip(((meta["y1"] - cy) / meta["res"]).astype(int), 0, meta["rows"] - 1)
        zc = z[rr, cc]
        _, sand, rock, sea = shore(zc, k.signed_distance(cx, cy))
        ga, gb = OUT / "ground" / f"{cell['id']}_a.png", OUT / "ground" / f"{cell['id']}_b.png"
        if ga.exists() and gb.exists():
            paint(ga, gb, sand, rock, sea)

    coast = []
    for x, y in k.land().simplify(3.0).exterior.coords:
        coast += [round(x, 1), round(y, 1)]
    world["sea"] = {"z": k.SEA_Z, "coast": coast}
    wpath.write_text(json.dumps(world, indent=1))
    print(f"côte : {stats['tiles']} tuiles touchées, {stats['buildings']} bâtiments et {stats['trees']} arbres en mer retirés, "
          f"{stats['cells_lowered']} points de relief abaissés ; mer à {k.SEA_ALTITUDE} m, côte de {len(coast) // 2} points")


if __name__ == "__main__":
    main()
