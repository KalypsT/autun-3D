"""Remparts, lot 1 (docs/plans/remparts.md) : le tracé complété et la forme mesurée au LiDAR remplacent les boîtes de 6 m.

Entrées : les murs `barrier=city_wall` d'OpenStreetMap et les profils LiDAR de tools/data/survey_remparts.py (mêmes caches, .cache/remparts/),
`ramparts` de tools/data/manual.json (tracés retrouvés au LiDAR, hauteurs imposées d'après photo), public/data/streets.json (brèches des rues).

Étapes :
1. Tracés absents d'OSM (`traces`) : le long du segment a → b, à chaque station de 4 m, la plus forte marche du sol LiDAR (classe 2, la maçonnerie y
   est rangée) à moins de `half` m, côté haut vers la ville ; on garde les stations des plages `keep` (abscisses en m depuis a) où la marche
   dépasse `minDrop` m ; décalage lissé (médiane sur 3 stations).
2. Raccords : deux bouts de murs à moins de `join` m sont reliés, sauf si une rue passe entre eux (une brèche).
3. Profils tous les 4 m (sommet, sol de chaque côté) lissés par une médiane sur 5 stations ; trous comblés par interpolation. Là où un côté
   est plus haut de 2 m ou plus, la face basse est posée sur la marche mesurée du sol LiDAR (`face_offsets`) et l'axe une demi-épaisseur
   derrière (le trait OSM suit à peu près la face, pas l'axe). Là où une face toucherait une chaussée dessinée, l'axe recule (1,5 m au plus). Les stations où le mur
   dépasse le sol de moins de `minVisible` m des deux côtés sont retirées (« ne rien montrer » des portions disparues, décision du 6 novembre).
   Sommet : au moins `parapet` m au-dessus du sol le plus haut (le parapet d'un mur de soutènement) ; au plus `maxHeight` m au-dessus du plus bas
   (au-delà, ce sont des bâtiments adossés). Hauteurs imposées (`overrides`) : sommet = sol extérieur + `height`.
4. Tuiles : les murs `rampart` sont remplacés par des polylignes à profil (`top`, `gl`, `gr` : sommet, sol à gauche et à droite du sens de la
   polyligne, par sommet), coupées par tuile (un segment va à la tuile de son milieu), identifiants −(RAMPART_ID + n). `bytes` et `walls` de
   world.json sont mis à jour.
5. Relief fin (terrain/<tuile>.bin) : de chaque côté, de l'axe jusqu'à `carve` m au-delà de la face, le relief est écrêté sous le sol mesuré de ce côté plus une pente
   de `slope` (le talus d'herbe que le MNT avait mis à la place du parement disparaît). Un `min` : une deuxième passe ne change rien.

Usage : python3 tools/data/build_ramparts.py ; après build_public_space.py et build_coast.py (qui réécrivent murs et relief), avant build_nav.py.
"""

import json
import math

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.prepared import prep
from shapely.ops import unary_union

import config as c
import survey_remparts as sv

RAMPART_ID = 860_000_000
THICK = 2.0  # épaisseur dessinée (m), partagée avec src/core/ramparts.ts


def tile_of(x, y):
    return f"{int((x + c.ORIGIN[0]) // c.TILE) - c.GRID_I0}_{int((y + c.ORIGIN[1]) // c.TILE) - c.GRID_J0}"


def median_filter(v, k):
    out = []
    for i in range(len(v)):
        w = [q for q in v[max(0, i - k // 2): i + k // 2 + 1] if q is not None]
        out.append(float(np.median(w)) if w else None)
    return out


def fill(v):
    idx = [i for i, q in enumerate(v) if q is not None]
    if not idx:
        return None
    return list(np.interp(range(len(v)), idx, [v[i] for i in idx]))


def trace(spec):
    """Tracé d'un mur absent d'OSM : la plus forte marche du sol LiDAR le long du segment a → b (voir l'en-tête)."""
    a, b = np.array(spec["a"], float), np.array(spec["b"], float)
    L = float(np.linalg.norm(b - a))
    t = (b - a) / L
    n = np.array([-t[1], t[0]])
    centre = np.array(spec["inside"], float)
    if np.dot(centre - a, n) < 0:  # n regarde la ville
        n = -n
    old = sv.BAND
    sv.BAND = spec["half"] + 10
    x, y, z, cl = sv.lidar({"id": f"trace_{spec['name']}", "pts": [tuple(a), tuple(b)]})
    sv.BAND = old
    g = cl == 2
    x0, y0 = float(x.min()), float(y.min())
    W, H = int(x.max() - x0) + 2, int(y.max() - y0) + 2
    grid = np.full((H, W), np.nan)
    o = np.argsort(z[g])
    grid[(y[g][o] - y0).astype(int), (x[g][o] - x0).astype(int)] = z[g][o]

    def zat(p):
        i, j = int(p[1] - y0), int(p[0] - x0)
        return grid[i, j] if 0 <= i < H and 0 <= j < W else np.nan

    runs, cur = [], []
    for s in np.arange(0, L + 0.01, sv.STEP):
        inside = any(lo <= s <= hi for lo, hi in spec["keep"])
        best = None
        if inside:
            p = a + t * s
            for off in np.arange(-spec["half"], spec["half"] + 0.01, 0.5):
                q = p + n * off
                hi = [v for v in (zat(q + n * k) for k in (0.5, 1, 1.5, 2, 2.5)) if not np.isnan(v)]
                lo = [v for v in (zat(q - n * k) for k in (0.5, 1, 1.5, 2, 2.5)) if not np.isnan(v)]
                if len(hi) >= 2 and len(lo) >= 2:
                    dz = float(np.median(hi) - np.median(lo))
                    if best is None or dz > best[0]:
                        best = (dz, off)
        if best and best[0] >= spec["minDrop"]:
            cur.append((s, best[1]))
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    out = []
    for r in runs:
        if len(r) < 3:
            continue
        offs = median_filter([o for _, o in r], 3)
        out.append([tuple(map(float, a + t * s + n * o)) for (s, _), o in zip(r, offs)])
    return out


def streets():
    lines = []
    for s in json.load(open(c.OUT / "streets.json")):
        if len(s["pts"]) >= 4:
            lines.append(LineString(list(zip(s["pts"][0::2], s["pts"][1::2]))).buffer(max(1.5, (s.get("width") or 3) / 2)))
    return unary_union(lines)


def joins(walls, limit, roads):
    """Raccords des bouts de murs proches qu'aucune rue ne sépare."""
    ends = [(w["pts"][0], w["id"]) for w in walls] + [(w["pts"][-1], w["id"]) for w in walls]
    out, seen = [], set()
    for p, wi in ends:
        for q, wj in ends:
            if wi == wj or (wj, wi) in seen:
                continue
            d = math.dist(p, q)
            if 0.5 < d <= limit and not LineString([p, q]).intersects(roads):
                seen.add((wi, wj))
                out.append({"id": f"join_{wi}_{wj}", "pts": [p, q], "join": (wi, wj)})
    return out


def face_offsets(wall, profs, gin, gout):
    """Position de la face basse de chaque station, mesurée : la plus forte marche du sol LiDAR (classe 2, la maçonnerie y est rangée) à moins
    de 3 m de la ligne, le long de la normale vers le côté haut. Rend, par station, le décalage (m) de la face le long de cette normale (lissé,
    médiane sur 5 stations) ; voir plus bas pour le décalage de l'axe qui en découle."""
    x, y, z, cl = sv.lidar(wall)
    g = cl == 2
    x, y, z = x[g], y[g], z[g]
    raw = []
    for k, p in enumerate(profs):
        if p.get("vide") or abs(gin[k] - gout[k]) < 2:
            raw.append(None)
            continue
        sgn = 1 if gin[k] > gout[k] else -1
        nx, ny = sgn * p["n"][0], sgn * p["n"][1]
        tx, ty = ny, -nx
        dx, dy = x - p["x"], y - p["y"]
        m = np.abs(dx * tx + dy * ty) < 1.5
        of, zz = (dx * nx + dy * ny)[m], z[m]
        best = None
        for o in np.arange(-3, 3.01, 0.25):
            hi, lo = zz[(of > o) & (of < o + 2)], zz[(of < o) & (of > o - 2)]
            if len(hi) > 3 and len(lo) > 3:
                dz = float(np.median(hi) - np.median(lo))
                if dz >= 1.5 and (best is None or dz > best[0]):
                    best = (dz, float(o))
        raw.append(best[1] if best else None)
    # Décalage de l'axe le long de la normale vers la ville (positif : vers la ville) : face mesurée plus une demi-épaisseur, côté haut ;
    # trous comblés par interpolation ; 0 aux bouts et là où le mur n'a pas de côté haut ; puis lissé (médiane sur 5, moyenne sur 5 stations :
    # les passages d'un calage à l'autre se font sur 20 m, sans zigzag).
    sh = []
    for k, r in enumerate(raw):
        if r is None:
            sh.append(None if (not profs[k].get("vide") and abs(gin[k] - gout[k]) >= 2) else 0.0)
        else:
            sh.append((1 if gin[k] > gout[k] else -1) * (r + THICK / 2))
    sh = fill(median_filter(sh, 5)) or [0.0] * len(sh)
    out = []
    for k in range(len(sh)):
        w = sh[max(0, k - 2): k + 3]
        out.append(sum(w) / len(w))
    return out


def road_surfaces():
    """Chaussées dessinées des tuiles (sols `road_*`), en un seul polygone : un rempart ne doit pas y empiéter."""
    polys = []
    for path in sorted((c.OUT / "tiles").glob("*.json")):
        ground = json.loads(path.read_text()).get("ground") or {}
        for k, layer in ground.items():
            if not k.startswith("road_"):
                continue
            for poly in layer:
                rings = [list(zip(r[0::2], r[1::2])) for r in poly]
                if len(rings[0]) >= 3:
                    polys.append(Polygon(rings[0], [h for h in rings[1:] if len(h) >= 3]).buffer(0))
    return prep(unary_union(polys))


ROADS = None


def clear_of_roads(px, py, nx, ny):
    """Recule l'axe (le long de ±(nx, ny)) jusqu'à ce que les deux faces soient à 20 cm au moins des chaussées ; 1,5 m au plus."""
    global ROADS
    if ROADS is None:
        ROADS = road_surfaces()
    hw = THICK / 2 + 0.2
    for step in np.arange(0, 1.51, 0.25):
        for sgn in ((1,) if step == 0 else (1, -1)):
            qx, qy = px + sgn * nx * step, py + sgn * ny * step
            if not ROADS.intersects(LineString([(qx - nx * hw, qy - ny * hw), (qx + nx * hw, qy + ny * hw)])):
                return qx, qy
    return px, py


def stations(wall, centre, spec, override):
    """Stations lissées d'un mur : listes de (x, y, sommet, sol gauche, sol droit), coupées là où rien n'est visible."""
    profs = sv.profiles(wall, centre)
    if len(profs) < 2:
        return []
    top = fill(median_filter([None if p.get("vide") else p["top"] for p in profs], 5))
    gin = fill(median_filter([None if p.get("vide") else p["g_in"] for p in profs], 5))
    gout = fill(median_filter([None if p.get("vide") else p["g_out"] for p in profs], 5))
    if top is None or gin is None or gout is None:
        return []
    faces = face_offsets(wall, profs, gin, gout)
    line = LineString(wall["pts"])
    runs, cur = [], []
    for k, p in enumerate(profs):
        d = p["d"]
        a, b = line.interpolate(max(0, d - 1)), line.interpolate(min(line.length, d + 1))
        tx, ty = b.x - a.x, b.y - a.y
        Lt = math.hypot(tx, ty) or 1
        lx, ly = -ty / Lt, tx / Lt  # gauche du sens de la polyligne
        n = p.get("n")
        if n is None:  # station vide : le côté ville par le centre de l'enceinte
            n = (centre[0] - p["x"], centre[1] - p["y"])
        left_is_in = lx * n[0] + ly * n[1] > 0
        zt, zi, zo = top[k], gin[k], gout[k]
        if override is not None:
            zt = zo + override
        visible = max(zt - zi, zt - zo) >= spec["minVisible"]
        zt = min(max(zt, max(zi, zo) + spec["parapet"]), min(zi, zo) + spec["maxHeight"])
        gl, gr = (zi, zo) if left_is_in else (zo, zi)
        # Mur de soutènement : la face basse sur la marche mesurée, l'axe une demi-épaisseur derrière, côté haut.
        px, py = p["x"], p["y"]
        if not p.get("vide"):
            px += p["n"][0] * faces[k]
            py += p["n"][1] * faces[k]
            # Les chaussées dessinées (largeurs BD TOPO) débordent parfois sur la bande d'herbe du pied : le mur recule, sans empiéter.
            px, py = clear_of_roads(px, py, p["n"][0], p["n"][1])
        if visible:
            cur.append((px, py, zt, gl, gr))
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def carve(runs, spec):
    """Écrête le relief fin de chaque côté des murs (voir l'en-tête). Rend les blocs réécrits."""
    hw = THICK / 2
    reach = spec["carve"] + hw + 2
    segs = []
    for r in runs:
        for (x1, y1, _, l1, r1), (x2, y2, _, l2, r2) in zip(r, r[1:]):
            segs.append((x1, y1, x2, y2, l1, r1, l2, r2))
    if not segs:
        return []
    S = np.array(segs)
    verts = []  # (x, y, sol bas, côté bas (1 : gauche), directions des segments voisins)
    for r in runs:
        for k, (x, y, _, gl, gr) in enumerate(r):
            if abs(gl - gr) < 1.0:
                continue
            adj = []
            for a, b in ((k - 1, k), (k, k + 1)):
                if 0 <= a and b < len(r):
                    adj.append((r[b][0] - r[a][0], r[b][1] - r[a][1]))
            verts.append((x, y, min(gl, gr), 1 if gl < gr else -1, adj))
    out = []
    for path in sorted((c.OUT / "terrain").glob("*_*.bin")):
        buf = path.read_bytes()
        base, bx0, by1, n = (float(v) for v in np.frombuffer(buf[:16], dtype="<f4"))
        n = int(n)
        near = S[(np.minimum(S[:, 0], S[:, 2]) < bx0 + n + reach) & (np.maximum(S[:, 0], S[:, 2]) > bx0 - reach)
                 & (np.minimum(S[:, 1], S[:, 3]) < by1 + reach) & (np.maximum(S[:, 1], S[:, 3]) > by1 - n - reach)]
        if not len(near):
            continue
        cm = np.frombuffer(buf[16:], dtype="<u2").reshape(n, n).astype(np.int64)
        z = base + cm * 0.01
        cols = np.arange(n) + bx0 + 0.5
        rows = by1 - np.arange(n) - 0.5
        X, Y = np.meshgrid(cols, rows)
        target = np.full_like(z, np.inf)
        for x1, y1, x2, y2, l1, r1, l2, r2 in near:
            dx, dy = x2 - x1, y2 - y1
            L2 = dx * dx + dy * dy
            if L2 < 1e-6:
                continue
            L = math.sqrt(L2)
            t = ((X - x1) * dx + (Y - y1) * dy) / L2
            side = ((X - x1) * -dy + (Y - y1) * dx) / L  # > 0 : à gauche
            # Toute la bande, dessous du mur compris : chaque moitié prend le sol de son côté, la marche est sur l'axe, cachée dans le mur
            # (sinon le relief à mailles de 1 m monte en biseau à travers la face).
            m = (t >= -0.05) & (t <= 1.05) & (np.abs(side) <= hw + spec["carve"])
            if not m.any():
                continue
            tc = np.clip(t, 0, 1)
            g = np.where(side > 0, l1 + tc * (l2 - l1), r1 + tc * (r2 - r1))
            tg = g + spec["slope"] * np.maximum(0, np.abs(side) - hw - 0.5)
            target = np.where(m, np.minimum(target, tg), target)
        # Angles saillants et bouts : autour de chaque sommet, côté bas des deux segments voisins (l'onglet n'est en face d'aucun des deux).
        for x0_, y0_, low, sgn, adj in verts:
            if not (bx0 - reach < x0_ < bx0 + n + reach and by1 - n - reach < y0_ < by1 + reach):
                continue
            dist = np.hypot(X - x0_, Y - y0_)
            m = dist <= hw + spec["carve"]
            for dx, dy in adj:
                m &= sgn * ((X - x0_) * -dy + (Y - y0_) * dx) > 0
            if m.any():
                target = np.where(m, np.minimum(target, low + spec["slope"] * np.maximum(0, dist - hw - 0.5)), target)
        new_z = np.minimum(z, target)
        new = np.round((new_z - base) * 100).astype(np.int64)
        new = np.where(np.isfinite(target), np.minimum(new, cm), cm)
        if (new < 0).any():
            new = np.maximum(new, 0)
        if (new != cm).any():
            path.write_bytes(buf[:16] + new.astype("<u2").tobytes())
            out.append(path.stem)
    return out


def main():
    spec = json.load(open(c.ROOT / "tools" / "data" / "manual.json"))["ramparts"]
    osm_walls, _, _ = sv.osm()
    centre = tuple(np.mean([pt for w in osm_walls for pt in w["pts"]], axis=0))
    walls = [{"id": w["id"], "pts": w["pts"]} for w in osm_walls]
    for tr in spec["traces"]:
        for k, pts in enumerate(trace(tr)):
            walls.append({"id": f"trace_{tr['name']}", "pts": pts, "name": f"{tr['name']} {k + 1}"})
            print(f"  tracé « {tr['name']} » {k + 1} : {LineString(pts).length:.0f} m, de ({pts[0][0]:.0f} ; {pts[0][1]:.0f}) à ({pts[-1][0]:.0f} ; {pts[-1][1]:.0f})")
    js = joins(walls, spec["join"], streets())
    for j in js:
        print(f"  raccord de {math.dist(*j['pts']):.0f} m entre {j['join'][0]} et {j['join'][1]}")
    walls += js
    overrides = {str(o["wall"]): o["height"] for o in spec["overrides"]}
    runs = []
    for w in walls:
        for r in stations(w, centre, spec, overrides.get(str(w["id"]))):
            runs.append(r)
    total = sum(LineString([(p[0], p[1]) for p in r]).length for r in runs)
    print(f"{len(runs)} murs, {total:.0f} m (OSM : {sum(LineString(w['pts']).length for w in osm_walls):.0f} m)")

    # Tuiles : un segment va à la tuile de son milieu ; les segments consécutifs d'une même tuile forment une polyligne.
    per_tile, nid = {}, 0
    for r in runs:
        cur, cur_tile = [], None
        for p, q in zip(r, r[1:]):
            tid = tile_of((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
            if tid != cur_tile and cur:
                per_tile.setdefault(cur_tile, []).append(cur)
                cur = []
            if not cur:
                cur = [p]
            cur.append(q)
            cur_tile = tid
        if cur:
            per_tile.setdefault(cur_tile, []).append(cur)
    world = json.loads((c.OUT / "world.json").read_text())
    metas = {m["id"]: m for m in world["tiles"]}
    changed = 0
    for path in sorted((c.OUT / "tiles").glob("*.json")):
        tid = path.stem
        tile = json.loads(path.read_text())
        keep = [w for w in tile.get("walls", []) if w["kind"] != "rampart"]
        new = []
        for poly in per_tile.get(tid, []):
            nid += 1
            h = max(p[2] - min(p[3], p[4]) for p in poly)
            new.append({"id": -(RAMPART_ID + nid), "kind": "rampart", "height": round(h, 1), "measured": round(h, 1),
                        "pts": [round(v, 2) for p in poly for v in p[:2]],
                        "top": [round(p[2], 2) for p in poly], "gl": [round(p[3], 2) for p in poly], "gr": [round(p[4], 2) for p in poly]})
        if not new and len(keep) == len(tile.get("walls", [])):
            continue
        tile["walls"] = keep + new
        text = json.dumps(tile, separators=(",", ":"), ensure_ascii=False)
        if text != path.read_text():
            path.write_text(text)
            if tid in metas:
                metas[tid]["bytes"] = len(text.encode())
                metas[tid]["walls"] = len(tile["walls"])
            changed += 1
    (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"{changed} tuile(s) réécrite(s)")
    blocks = carve(runs, spec)
    print(f"relief écrêté au pied des murs : {', '.join(blocks) or 'déjà fait'}")


if __name__ == "__main__":
    main()
