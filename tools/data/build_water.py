"""L'eau de la ville (D240, plan `docs/plans/eau.md`) : un niveau par plan d'eau, un fond creusé sous la surface, la carte de l'eau pour le jeu.

Usage : python3 tools/data/build_water.py
À lancer après build_coast.py (la mer) et avant build_nav.py et build_map.py. Lit et réécrit les données publiées, comme build_coast.py :
aucune donnée brute. Idempotente : la relancer ne change plus rien.

Le LiDAR ne traverse pas l'eau : sous un plan d'eau, le relief publié est la surface de l'eau. Cette étape :
1. découpe chaque polygone d'eau (structures/<tuile>.json, `water`) en partie « ville » et partie « côte » (à moins de COAST_BAND m de la côte :
   la mer s'en charge, build_coast.py y a creusé la plage) ; seulement au premier passage ;
2. donne à chaque partie « ville » son niveau, `wz` = [a, b, c] (z = a·x + b·y + c) : un seul niveau pour un plan d'eau fermé (médiane du
   relief), un plan par morceau de tuile pour une rivière (recollé à ses voisins sur leurs coutures) ; `null` pour une partie « côte » ;
3. creuse le fond dans les blocs de relief fins (terrain/<tuile>.bin) : fond = niveau − min(P, s · d), d la distance au bord sec le plus proche,
   P et s par plan d'eau (manual.json, `water`) ; une cellule à moins de TREE_DRY m d'un arbre compte comme sèche (les arbres sont sur des hauts-fonds) ;
   le relief grossier (terrain/coarse.bin) n'est pas touché : de loin, on ne voit que la surface ;
4. écrit `water.json` : toutes les parties « ville » et leur niveau, pour le jeu (règle de profondeur, eau lointaine).
Les niveaux du premier passage sont gardés dans structures/ (`wz`) : les passages suivants repartent d'eux, sur un relief déjà creusé.
"""

import json
import math

import numpy as np
import shapely
from scipy import ndimage
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

import config as c

OUT = c.OUT
UNIT = 0.01
MANUAL = c.ROOT / "tools" / "data" / "manual.json"
# Bande de la côte laissée à la mer (m) : la plage de build_coast.py fait 35 m.
COAST_BAND = 40.0
# Cellule « d'eau » : dans le polygone et à moins de WET_ABOVE m au-dessus du niveau (une berge ou une île du polygone n'est pas creusée).
WET_ABOVE = 0.3
# Rayon autour d'un arbre qui reste sec (m).
TREE_DRY = 2.5
# Lissage du fond (écart type, m).
SMOOTH = 1.5
# Écart des niveaux de ses morceaux sous lequel un plan d'eau est fermé (un seul niveau).
CLOSED_SPREAD = 0.4
# Plan d'eau plus petit que cela (m²) : toujours fermé (un étang, pas une rivière).
CLOSED_AREA = 10000.0
# Pente d'eau maximale d'une rivière (m/m) : au-delà, l'ajustement est du bruit.
MAX_SLOPE = 0.004
MARGIN = 12
# Sorties (D241) : bord « haut » (plus de EXIT_HIGH m au-dessus de l'eau à 1,5 m du bord : un nageur ne s'y hisse pas) ; une suite de bords
# hauts plus longue que EXIT_RUN m reçoit une rampe tous les EXIT_EVERY m : EXIT_HALF m de demi-largeur, pente EXIT_SLOPE, EXIT_LEN m au plus.
EXIT_HIGH = 0.8
EXIT_RUN = 150.0
EXIT_EVERY = 100.0
EXIT_HALF = 1.5
EXIT_SLOPE = 0.3
EXIT_LEN = 14.0


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


def ring_poly(p):
    r = p[0]
    return Polygon(list(zip(r[::2], r[1::2])), [list(zip(h[::2], h[1::2])) for h in p[1:]]).buffer(0)


def flat_rings(g, nd=2):
    return [[round(v, nd) for xy in list(r.coords)[:-1] for v in xy] for r in (g.exterior, *g.interiors)]


def parts(g):
    return [q for q in getattr(g, "geoms", [g]) if q.geom_type == "Polygon" and q.area > 1.0]


class Blocks:
    """Blocs de relief fins publiés. Toutes les cellules sont sur une même grille de 1 m : centres en x = ix + FX, y = iy + FY."""

    def __init__(self, world):
        self.blocks = {}
        for t in world["tiles"]:
            p = OUT / "terrain" / f"{t['id']}.bin"
            if p.exists():
                ox, oy, n, z = read_block(p)
                self.blocks[t["id"]] = [ox, oy, n, z, False]
        fx = {round((b[0] + 0.5) % 1, 3) for b in self.blocks.values()}
        fy = {round((b[1] - 0.5) % 1, 3) for b in self.blocks.values()}
        assert len(fx) == 1 and len(fy) == 1, "blocs sur des grilles différentes"
        self.fx, self.fy = fx.pop(), fy.pop()

    def grid(self, bounds):
        """Grille alignée couvrant `bounds` (+ MARGIN) : x0 (centre de la colonne 0), y1 (centre de la ligne 0, au nord), w, h."""
        x0 = math.floor(bounds[0] - MARGIN - self.fx) + self.fx
        y1 = math.ceil(bounds[3] + MARGIN - self.fy) + self.fy
        w = int(math.ceil(bounds[2] + MARGIN - x0)) + 1
        h = int(math.ceil(y1 - (bounds[1] - MARGIN))) + 1
        return x0, y1, w, h

    def _overlaps(self, x0, y1, w, h):
        for tid, b in self.blocks.items():
            ox, oy, n = b[0], b[1], b[2]
            c0 = round(x0 - (ox + 0.5))
            r0 = round((oy - 0.5) - y1)
            # Indices dans le bloc de la colonne 0 et de la ligne 0 de la grille.
            bc0, bc1 = max(0, c0), min(n, c0 + w)
            br0, br1 = max(0, r0), min(n, r0 + h)
            if bc0 < bc1 and br0 < br1:
                yield tid, b, (br0, br1, bc0, bc1), (br0 - r0, br1 - r0, bc0 - c0, bc1 - c0)

    def read(self, x0, y1, w, h):
        z = np.full((h, w), np.nan)
        for _, b, (a0, a1, b0, b1), (g0, g1, h0, h1) in self._overlaps(x0, y1, w, h):
            z[g0:g1, h0:h1] = b[3][a0:a1, b0:b1]
        return z

    def write(self, x0, y1, w, h, z, mask):
        for _, b, (a0, a1, b0, b1), (g0, g1, h0, h1) in self._overlaps(x0, y1, w, h):
            m = mask[g0:g1, h0:h1]
            if m.any():
                sub = b[3][a0:a1, b0:b1]
                sub[m] = z[g0:g1, h0:h1][m]
                b[4] = True

    def save(self):
        n = 0
        for tid, b in self.blocks.items():
            if b[4]:
                write_block(OUT / "terrain" / f"{tid}.bin", b[0], b[1], b[2], b[3])
                n += 1
        return n


def exits(body, z, lev, label, x0, y1, w, h):
    """Rampes à tailler : (x, y du bord, normale vers la terre, niveau de l'eau) le long des suites de bords hauts de plus de EXIT_RUN m."""
    def at(grid, x, y):
        c, r = int(round(x - x0)), int(round(y1 - y))
        return grid[r, c] if 0 <= r < h and 0 <= c < w else math.nan

    out = []
    for poly in parts(body):
        ring = poly.exterior
        L = ring.length
        n = max(8, int(L / 2))
        samples = []
        for i in range(n):
            p = ring.interpolate(L * i / n)
            q = ring.interpolate(L * (i + 0.5) / n)
            tx, ty = q.x - p.x, q.y - p.y
            ln = math.hypot(tx, ty) or 1.0
            nx, ny = ty / ln, -tx / ln
            if poly.contains(shapely.Point(p.x + nx * 0.5, p.y + ny * 0.5)):
                nx, ny = -nx, -ny
            lv = at(lev, p.x - nx * 1.5, p.y - ny * 1.5)
            if math.isnan(lv):
                lv = at(lev, p.x - nx * 3, p.y - ny * 3)
            zo = at(z, p.x + nx * 1.5, p.y + ny * 1.5)
            high = not math.isnan(lv) and not math.isnan(zo) and zo - lv > EXIT_HIGH
            samples.append((p.x, p.y, nx, ny, lv, high))
        # Suites de bords hauts (l'anneau est fermé : on commence après un bord bas).
        start = next((i for i, s in enumerate(samples) if not s[5]), None)
        if start is None:
            continue
        step = L / n
        run = []
        for k in range(1, n + 1):
            s = samples[(start + k) % n]
            if s[5]:
                run.append(s)
                continue
            if len(run) * step > EXIT_RUN:
                count = int(len(run) * step // EXIT_EVERY)
                for j in range(count):
                    m = run[int(len(run) * (j + 0.5) / count)]
                    out.append((m[0], m[1], m[2], m[3], m[4]))
            run = []
    return out


def body_rule(cfg, body):
    """Règle de manual.json (`water.bodies`) qui désigne ce plan d'eau par un point, ou None."""
    return next((r for r in cfg.get("bodies", []) if shapely.contains_xy(body, *r["at"])), None)


def body_params(cfg, body):
    """Profondeur maximale et pente de berge d'un plan d'eau : règle de manual.json qui le désigne par un point, sinon d'après sa surface."""
    for r in cfg.get("bodies", []):
        if shapely.contains_xy(body, *r["at"]):
            return r["depth"], r["slope"], r.get("name"), r.get("closed", False)
    d = cfg["default"]
    if body.area < d["smallArea"]:
        return d["smallDepth"], d["smallSlope"], None, False
    return d["depth"], d["slope"], None, False


def main():
    world = json.loads((OUT / "world.json").read_text())
    cfg = json.loads(MANUAL.read_text())["water"]
    cs = world["sea"]["coast"]
    band = LineString(list(zip(cs[::2], cs[1::2])) + [(cs[0], cs[1])]).buffer(COAST_BAND)
    blocks = Blocks(world)

    # 1. Morceaux d'eau de chaque tuile, découpés ville / côte au premier passage.
    sts, pieces = {}, []  # pieces : [tid, index, polygone, wz]
    first = False
    for t in world["tiles"]:
        sp = OUT / "structures" / f"{t['id']}.json"
        if not sp.exists():
            continue
        st = json.loads(sp.read_text())
        if not st.get("water"):
            continue
        sts[t["id"]] = st
        if "wz" not in st:
            first = True
            water, wz = [], []
            for p in st["water"]:
                g = ring_poly(p)
                for q in parts(g.difference(band)):
                    water.append(flat_rings(q))
                    wz.append([0.0, 0.0, 0.0])  # niveau calculé plus bas
                for q in parts(g.intersection(band)):
                    water.append(flat_rings(q))
                    wz.append(None)
            st["water"], st["wz"] = water, wz
        assert len(st["wz"]) == len(st["water"]), f"{t['id']} : `wz` ne suit plus `water` (build_coast.py relancé ?) : repartir des structures d'avant build_water.py"
        # Ajouts au contour d'OSM (`extend`, D246) : réunis au morceau « ville » qu'ils touchent, s'ils n'y sont pas déjà.
        tb = shapely.box(*t["bounds"])
        for ext in cfg.get("extend", []):
            e = Polygon(list(zip(ext["ring"][::2], ext["ring"][1::2]))).intersection(tb)
            if e.is_empty:
                continue
            for i, p in enumerate(st["water"]):
                g = ring_poly(p)
                if st["wz"][i] is None or g.distance(e) > 0.5 or e.difference(g).area < 0.5:
                    continue
                u = unary_union([g, e.buffer(0.01)])
                if u.geom_type == "Polygon":
                    st["water"][i] = flat_rings(u.simplify(0.05))
                break
        for i, p in enumerate(st["water"]):
            if st["wz"][i] is not None:
                pieces.append([t["id"], i, ring_poly(p), st["wz"][i]])
    print(f"{len(pieces)} morceaux d'eau de la ville dans {len(sts)} tuiles ({'premier passage' if first else 'niveaux repris'})")

    # Plans d'eau : morceaux fusionnés.
    merged = unary_union([p[2].buffer(0.05) for p in pieces])
    bodies = sorted(parts(merged), key=lambda g: -g.area)
    of_body = [[] for _ in bodies]
    for k, p in enumerate(pieces):
        pt = p[2].representative_point()
        j = next(j for j, b in enumerate(bodies) if b.contains(pt))
        of_body[j].append(k)

    trees = []
    for t in world["tiles"]:
        tp = OUT / "tiles" / f"{t['id']}.json"
        if tp.exists():
            trees += [(tr[0], tr[1]) for tr in json.loads(tp.read_text()).get("trees", [])]
    trees = np.array(trees) if trees else np.zeros((0, 2))

    stats = {"bodies": len(bodies), "cells": 0, "deepest": 0.0}
    report = []
    for j, body in enumerate(bodies):
        x0, y1, w, h = blocks.grid(body.bounds)
        xs = x0 + np.arange(w)
        ys = y1 - np.arange(h)
        xx, yy = np.meshgrid(xs, ys)
        z = blocks.read(x0, y1, w, h)
        label = np.full((h, w), -1, dtype=np.int32)
        for k in of_body[j]:
            g = pieces[k][2]
            b = g.bounds
            c0, c1 = max(0, int((b[0] - x0) - 1)), min(w, int((b[2] - x0) + 2))
            r0, r1 = max(0, int((y1 - b[3]) - 1)), min(h, int((y1 - b[1]) + 2))
            sub = shapely.contains_xy(g, xx[r0:r1, c0:c1], yy[r0:r1, c0:c1])
            label[r0:r1, c0:c1][sub] = k

        # 2. Niveaux (premier passage) : médiane (plan d'eau fermé) ou quart bas (rivière, dont les bancs relèvent la médiane) par morceau.
        if first:
            own = {}
            for k in of_body[j]:
                v = z[label == k]
                v = v[~np.isnan(v)]
                own[k] = (float(np.median(v)) if len(v) else math.nan, float(np.percentile(v, 25)) if len(v) else math.nan, len(v))
            meds = [m for m, _, n in own.values() if n > 20 and not math.isnan(m)]
            closed = body_params(cfg, body)[3] or body.area < CLOSED_AREA or len(meds) <= 1 or max(meds) - min(meds) < CLOSED_SPREAD
            if closed:
                v = z[label >= 0]
                lv = float(np.nanmedian(v))
                for k in of_body[j]:
                    pieces[k][3] = [0.0, 0.0, round(lv, 2)]
            else:
                lv_of = {k: (own[k][1] if own[k][2] > 20 else math.nan) for k in of_body[j]}
                for k in of_body[j]:
                    if math.isnan(lv_of[k]):
                        near = [lv_of[q] for q in of_body[j] if q != k and not math.isnan(lv_of[q]) and pieces[q][2].distance(pieces[k][2]) < 1.0]
                        lv_of[k] = float(np.mean(near)) if near else float(np.nanmedian(z[label == k]))
                for k in of_body[j]:
                    # Le plan du morceau passe par ses coutures (niveau moyen des deux morceaux) : la surface ne fait pas de marche d'une tuile à l'autre.
                    g = pieces[k][2]
                    seams = []
                    for q in of_body[j]:
                        if q == k:
                            continue
                        seam = g.buffer(0.6).intersection(pieces[q][2].buffer(0.6))
                        if not seam.is_empty and seam.area > 0.5:
                            sx, sy = seam.centroid.coords[0]
                            seams.append((sx, sy, (lv_of[k] + lv_of[q]) / 2))
                    a = bb = 0.0
                    cc = lv_of[k]
                    if len(seams) == 1:
                        cc = seams[0][2]
                    elif len(seams) >= 2:
                        if len(seams) == 2:
                            (px, py, pz), (qx, qy, qz) = seams
                            d2 = max(1.0, (qx - px) ** 2 + (qy - py) ** 2)
                            a, bb = (qz - pz) * (qx - px) / d2, (qz - pz) * (qy - py) / d2
                        else:
                            A = np.array([[p[0], p[1], 1.0] for p in seams])
                            sol, _, rank, _ = np.linalg.lstsq(A, np.array([p[2] for p in seams]), rcond=None)
                            a, bb = (float(sol[0]), float(sol[1])) if rank == 3 else (0.0, 0.0)
                        gr = math.hypot(a, bb)
                        if gr > MAX_SLOPE:
                            a, bb = a * MAX_SLOPE / gr, bb * MAX_SLOPE / gr
                        mx, my = np.mean([p[0] for p in seams]), np.mean([p[1] for p in seams])
                        cc = float(np.mean([p[2] for p in seams])) - a * mx - bb * my
                    pieces[k][3] = [round(a, 7), round(bb, 7), round(cc, 3)]

        # 3. Fond.
        lev = np.full((h, w), np.nan)
        for k in of_body[j]:
            a, bb, cc = pieces[k][3]
            m = label == k
            lev[m] = a * xx[m] + bb * yy[m] + cc
        wet = (label >= 0) & ~np.isnan(z) & (z <= lev + WET_ABOVE)
        # Plan d'eau à `flood` (D246) : loin du bord du polygone (plus de `flood` m), tout est de l'eau, même un relief plus haut que
        # WET_ABOVE : le LiDAR, qui ne voit pas l'eau, y a interpolé une nappe entre les rives (triangle au sud du Vallon, jusqu'à 0,9 m
        # au-dessus du lac). Les berges et les îles (trous du polygone) gardent la règle ordinaire.
        rule = body_rule(cfg, body)
        if rule and rule.get("flood"):
            inner = ndimage.distance_transform_edt(label >= 0) > rule["flood"]
            wet |= inner & ~np.isnan(z) & ~np.isnan(lev)
        if len(trees):
            inb = (trees[:, 0] > x0 - 3) & (trees[:, 0] < x0 + w + 3) & (trees[:, 1] > y1 - h - 3) & (trees[:, 1] < y1 + 3)
            tmask = np.zeros((h, w), bool)
            for tx, ty in trees[inb]:
                ci, ri = int(round(tx - x0)), int(round(y1 - ty))
                if 0 <= ri < h and 0 <= ci < w:
                    tmask[ri, ci] = True
            if tmask.any():
                near_tree = ndimage.distance_transform_edt(~tmask) <= TREE_DRY
                wet &= ~near_tree
        if not wet.any():
            continue
        P, s, name, _ = body_params(cfg, body)
        d = ndimage.distance_transform_edt(wet)
        depth = np.minimum(P, s * d)
        for zone in cfg.get("shallow", []):
            if shapely.contains_xy(body, *zone["at"]):
                zb = zone["box"]
                inz = (xx >= zb[0]) & (xx <= zb[2]) & (yy >= zb[1]) & (yy <= zb[3])
                depth = np.where(inz, np.minimum(depth, zone["depth"]), depth)
        depth = np.where(wet, depth, 0.0)
        depth = np.where(wet, ndimage.gaussian_filter(depth, SMOOTH), 0.0)
        bed = np.where(wet, np.minimum(z, lev - depth), z)
        bed = np.round(bed / UNIT) * UNIT
        changed = wet & (bed < z - 0.005)
        # 3 bis. Sorties (D241) : sur un long bord haut, une rampe taillée dans la berge tous les EXIT_EVERY m, pour qu'un nageur sorte de l'eau.
        cut = np.zeros((h, w), bool)
        for ramp in exits(body, bed, lev, label, x0, y1, w, h):
            cx, cy, nx, ny, lv = ramp
            s_ = (xx - cx) * nx + (yy - cy) * ny
            t_ = np.abs(-(xx - cx) * ny + (yy - cy) * nx)
            inr = (s_ >= -1.0) & (s_ <= EXIT_LEN) & (t_ <= EXIT_HALF) & ~np.isnan(bed)
            prof = lv + EXIT_SLOPE * np.maximum(s_, 0.0) - 0.05
            low = inr & (prof < bed) & ~wet
            bed = np.where(low, np.round(prof / UNIT) * UNIT, bed)
            cut |= low
            stats["exits"] = stats.get("exits", 0) + 1
            stats.setdefault("exit_at", []).append((round(cx), round(cy)))
        blocks.write(x0, y1, w, h, bed, wet | cut)
        stats["cells"] += int(changed.sum())
        stats["deepest"] = max(stats["deepest"], float(np.nanmax(lev[wet] - bed[wet])))
        report.append((round(body.area), name, P, s, int(wet.sum()), round(float(np.nanmax(lev[wet] - bed[wet])), 2),
                       round(float(np.nanmin(lev[label >= 0])), 2), round(float(np.nanmax(lev[label >= 0])), 2)))

    # 4. Écritures.
    for k, p in enumerate(pieces):
        sts[p[0]]["wz"][p[1]] = p[3]
    for tid, st in sts.items():
        (OUT / "structures" / f"{tid}.json").write_text(json.dumps(st, ensure_ascii=False, separators=(",", ":")))
    nb = blocks.save()
    out = {"v": 1, "pieces": []}
    for p in pieces:
        g = p[2].simplify(0.3)
        if g.is_empty or g.geom_type != "Polygon":
            g = p[2]
        out["pieces"].append({"r": flat_rings(g, 1), "z": p[3]})
    (OUT / "water.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"{stats.get('exits', 0)} sorties taillées {stats.get('exit_at', [])}")
    print(f"{stats['bodies']} plans d'eau, {stats['cells']} cellules creusées, {nb} blocs réécrits, fond le plus profond {stats['deepest']:.2f} m ;"
          f" water.json {(OUT / 'water.json').stat().st_size / 1024:.0f} ko")
    for r in report[:12]:
        print("  ", r)


if __name__ == "__main__":
    main()
