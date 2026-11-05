"""L'eau de la ville, lot 0 (D239, plan `docs/plans/eau.md`) : relevés sur les données publiées, avant de creuser les fonds.

Ne modifie rien. Lit `public/data/structures/*.json` (polygones d'eau, ruisseaux, tabliers), les blocs de relief fins `public/data/terrain/*.bin`,
les tuiles (`tiles/*.json` : arbres, murs, mobilier, bâtiments) et `world.json` (la mer). Les noms viennent de l'API OpenStreetMap (petites
emprises autour d'un point du bord, gardées dans `.cache/shared/raw/water/`).

Pour chaque plan d'eau (polygones fusionnés d'une tuile à l'autre) :
- niveau : médiane du relief dans le polygone (le LiDAR voit la surface de l'eau), dispersion, et plan ajusté z = a·x + b·y + c sur les cellules
  à moins de 0,3 m de la médiane (la pente d'une rivière) ;
- mer : touché si le relief plonge à plus de 1,5 m sous la médiane (déjà creusé par build_coast.py) ou s'il approche la côte à moins de 30 m ;
- berges : tous les 2 m le long des anneaux, hauteur du relief au-dessus du niveau à 1,5 m vers l'extérieur ; pente douce (< 0,4 m),
  bord bas (0,4 à 0,8 m, on s'y hisse), bord haut (> 0,8 m) ; un mur, une clôture ou un bâtiment à moins de 1,5 m du bord compte pour « haut » ;
  plus longue suite de bord haut sans interruption (là où un nageur ne pourrait pas sortir) ;
- eau hors contour : cellules hors de tout polygone, à moins de 15 m de celui-ci, à moins de 0,15 m de son niveau et plates (écart type 3 × 3 < 0,05 m) ;
- ce qui est dedans : arbres, mobilier, murs, bâtiments dans le polygone (à plus de 1 m du bord) ;
- ponts : tabliers qui passent au-dessus, et hauteur libre au-dessus de l'eau.
Puis les rivières en ruban (largeur 6 m) : longueur, nom OSM le plus proche, profondeur du lit sous les rives.

Usage : python3 tools/data/survey_water.py
Sortie : un résumé lisible, et `tools/data/water_survey.json` (tous les chiffres, pour le lot 1).
"""

import glob
import json
import math
import os
import time

import numpy as np
import requests
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

import config as c

OUT = c.OUT
CACHE = c.SHARED / "raw" / "water"
REPORT = c.ROOT / "tools" / "data" / "water_survey.json"
UNIT = 0.01
# Bassins plus petits que cela : relevés sans nom ni berge (fontaines, mares).
MIN_AREA = 300.0
# Bande de la côte laissée à la mer (m) : la plage de build_coast.py fait 35 m.
COAST_BAND = 40.0


def read_block(path):
    buf = path.read_bytes() if hasattr(path, "read_bytes") else open(path, "rb").read()
    base, ox, oy, n = np.frombuffer(buf, dtype="<f4", count=4)
    n = int(n)
    raw = np.frombuffer(buf, dtype="<u2", offset=16, count=n * n).reshape(n, n)
    return float(ox), float(oy), n, float(base) + raw.astype(np.float64) * UNIT


class Relief:
    """Relief fin publié : blocs carrés, ligne 0 au nord (même lecture que build_coast.py)."""

    def __init__(self):
        self.blocks = []
        for f in glob.glob(str(OUT / "terrain" / "*.bin")):
            if os.path.basename(f) == "coarse.bin":
                continue
            self.blocks.append(read_block(f))
        self.index = {}
        for i, (ox, oy, n, _) in enumerate(self.blocks):
            for cx in range(math.floor(ox / 250), math.floor((ox + n) / 250) + 1):
                for cy in range(math.floor((oy - n) / 250), math.floor(oy / 250) + 1):
                    self.index.setdefault((cx, cy), []).append(i)

    def at(self, x, y):
        for i in self.index.get((math.floor(x / 250), math.floor(y / 250)), ()):
            ox, oy, n, z = self.blocks[i]
            col, row = x - ox, oy - y
            if 0 <= col < n and 0 <= row < n:
                return float(z[int(row), int(col)])
        return math.nan


def load_structures():
    polys, streams, decks = [], [], []
    for f in sorted(glob.glob(str(OUT / "structures" / "*.json"))):
        tid = os.path.basename(f)[:-5]
        st = json.load(open(f))
        for p in st.get("water", []):
            r = p[0]
            g = Polygon(list(zip(r[::2], r[1::2])), [list(zip(h[::2], h[1::2])) for h in p[1:]]).buffer(0)
            if not g.is_empty:
                polys.append((tid, g))
        for s in st.get("streams", []):
            streams.append((tid, LineString(list(zip(s["p"][::2], s["p"][1::2]))), s["w"]))
        for d in st.get("decks", []):
            p = d["p"]
            decks.append((d, LineString([(p[i], p[i + 1]) for i in range(0, len(p), 3)]), [p[i + 2] for i in range(0, len(p), 3)]))
    return polys, streams, decks


def load_tiles():
    trees, furniture, walls, buildings = [], [], [], []
    for f in sorted(glob.glob(str(OUT / "tiles" / "*.json"))):
        t = json.load(open(f))
        trees += [Point(tr[0], tr[1]) for tr in t.get("trees", [])]
        furniture += [(fu["kind"], Point(fu["x"], fu["y"])) for fu in t.get("furniture", []) if "x" in fu]
        for w in t.get("walls", []):
            p = w["pts"]
            if len(p) >= 4:
                walls.append((w["kind"], w.get("height", 0), LineString(list(zip(p[::2], p[1::2])))))
        for b in t.get("buildings", []):
            ring = b.get("footprint") or b.get("ring") or b.get("pts")
            if ring and isinstance(ring[0], (int, float)) and len(ring) >= 6:
                buildings.append(Polygon(list(zip(ring[::2], ring[1::2]))).buffer(0))
    return trees, furniture, walls, buildings


def osm_names(g, to_wgs):
    """Noms OSM d'eau autour d'un point du bord (natural=water nommé d'abord, sinon cours d'eau nommé)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    x, y = g.exterior.coords[0]
    lon0, lat0 = to_wgs(c.ORIGIN[0] + x - 40, c.ORIGIN[1] + y - 40)
    lon1, lat1 = to_wgs(c.ORIGIN[0] + x + 40, c.ORIGIN[1] + y + 40)
    path = CACHE / f"{round(x)}_{round(y)}.json"
    if not path.exists():
        for attempt in range(5):
            try:
                r = requests.get("https://api.openstreetmap.org/api/0.6/map.json", params={"bbox": f"{lon0:.6f},{lat0:.6f},{lon1:.6f},{lat1:.6f}"},
                                 headers={"User-Agent": c.USER_AGENT}, timeout=120)
                r.raise_for_status()
                path.write_text(r.text)
                break
            except requests.RequestException:
                time.sleep(4 * 2**attempt)
        else:
            return None, None
    els = json.loads(path.read_text())["elements"]
    water, ways = None, None
    for e in els:
        t = e.get("tags", {})
        if not t.get("name"):
            continue
        if t.get("natural") == "water" or t.get("waterway") == "riverbank" or t.get("landuse") == "reservoir":
            water = water or f"{t['name']} ({e['type'][0]}{e['id']}, {t.get('water', t.get('natural'))})"
        elif t.get("waterway") in ("river", "stream", "canal"):
            ways = ways or f"{t['name']} ({t['waterway']})"
    return water, ways


def main():
    to_wgs = Transformer.from_crs(2154, 4326, always_xy=True).transform
    relief = Relief()
    pieces, streams, decks = load_structures()
    trees, furniture, walls, buildings = load_tiles()
    world = json.load(open(OUT / "world.json"))
    cs = world["sea"]["coast"]
    coast = LineString(list(zip(cs[::2], cs[1::2])) + [(cs[0], cs[1])])
    merged = unary_union([g for _, g in pieces])
    lakes = sorted(merged.geoms if hasattr(merged, "geoms") else [merged], key=lambda g: -g.area)
    all_water = merged.buffer(0.01)
    wall_tree = STRtree([w[2] for w in walls])
    bld_tree = STRtree(buildings) if buildings else None
    tree_tree = STRtree(trees)
    furn_tree = STRtree([f[1] for f in furniture])

    report = {"lakes": [], "rivers": [], "streams": {}}
    print(f"{len(lakes)} plans d'eau, {merged.area / 1e4:.1f} ha ; {len(pieces)} morceaux de tuiles")
    for k, g in enumerate(lakes):
        b = g.bounds
        xs = np.arange(math.floor(b[0]) + 0.5, b[2], 1.0)
        ys = np.arange(math.floor(b[1]) + 0.5, b[3], 1.0)
        pts = [(x, y) for x in xs for y in ys if g.contains(Point(x, y))] if g.area < 4e5 else []
        zs = np.array([relief.at(x, y) for x, y in pts])
        ok = ~np.isnan(zs)
        pts = [p for p, o in zip(pts, ok) if o]
        zs = zs[ok]
        if len(zs) == 0:
            continue
        med = float(np.median(zs))
        rec = {"id": k, "area": round(g.area), "bounds": [round(v) for v in b], "point": [round(v) for v in g.representative_point().coords[0]],
               "z": {"p5": round(float(np.percentile(zs, 5)), 2), "median": round(med, 2), "p95": round(float(np.percentile(zs, 95)), 2)}}
        near = [i for i, z in enumerate(zs) if abs(z - med) < 0.3]
        if len(near) >= 3:
            A = np.array([[pts[i][0], pts[i][1], 1.0] for i in near])
            sol, *_ = np.linalg.lstsq(A, zs[near], rcond=None)
            fit = A @ sol
            rec["plane"] = {"a": round(float(sol[0]), 6), "b": round(float(sol[1]), 6), "c": round(float(sol[2]), 3),
                            "slope_m_per_km": round(1000 * math.hypot(sol[0], sol[1]), 2), "rms": round(float(np.sqrt(np.mean((fit - zs[near]) ** 2))), 3),
                            "flat_share": round(len(near) / len(zs), 3)}
        rec["coast_distance"] = round(g.distance(coast))
        # La partie à moins de COAST_BAND m de la côte reste à la mer (build_coast.py y a déjà creusé la plage) ; le reste est de l'eau de la ville.
        land = g.difference(coast.buffer(COAST_BAND))
        rec["sea"] = bool(land.area < 0.2 * g.area)
        rec["inland_area"] = round(land.area)
        if g.area >= MIN_AREA:
            w, s = osm_names(g, to_wgs)
            rec["osm_water"], rec["osm_waterway"] = w, s
        report["lakes"].append(rec)
        if g.area < MIN_AREA or rec["sea"]:
            continue
        g = land if land.geom_type == "Polygon" else max(land.geoms, key=lambda q: q.area)

        # Berges : tous les 2 m sur chaque anneau, relief à 1,5 m vers l'extérieur.
        level = lambda x, y: (rec["plane"]["a"] * x + rec["plane"]["b"] * y + rec["plane"]["c"]) if "plane" in rec else med
        counts = {"soft": 0.0, "low": 0.0, "high": 0.0}
        run = best = 0.0
        best_at = None
        samples = []
        for ring in [g.exterior] + list(g.interiors):
            L = ring.length
            n = max(4, int(L / 2))
            sgn = 1 if ring is g.exterior else -1
            for i in range(n):
                p = ring.interpolate(L * i / n)
                q = ring.interpolate(L * (i + 0.5) / n)
                dx, dy = q.x - p.x, q.y - p.y
                ln = math.hypot(dx, dy) or 1
                # Côté extérieur : celui qui n'est pas dans le polygone.
                nx, ny = dy / ln, -dx / ln
                if g.contains(Point(p.x + nx * 0.5, p.y + ny * 0.5)):
                    nx, ny = -nx, -ny
                ox, oy = p.x + nx * 1.5, p.y + ny * 1.5
                if all_water.contains(Point(ox, oy)):
                    continue  # couture avec un autre plan d'eau
                h = relief.at(ox, oy) - level(p.x, p.y)
                if math.isnan(h):
                    continue
                kind = "soft" if h < 0.4 else "low" if h < 0.8 else "high"
                close = [walls[j] for j in wall_tree.query(Point(p.x, p.y).buffer(1.5)) if walls[j][2].distance(Point(p.x, p.y)) < 1.5 and walls[j][1] >= 0.8]
                if close or (bld_tree is not None and len(bld_tree.query(Point(p.x, p.y).buffer(1.5), predicate="intersects"))):
                    kind = "high"
                counts[kind] += L / n
                samples.append(round(h, 2))
                if kind == "high":
                    run += L / n
                    if run > best:
                        best, best_at = run, (round(p.x), round(p.y))
                else:
                    run = 0.0
        tot = sum(counts.values()) or 1
        rec["banks"] = {k2: round(v / tot, 3) for k2, v in counts.items()}
        rec["banks_m"] = round(tot)
        rec["longest_high_run"] = {"m": round(best), "near": best_at}
        rec["bank_height_p50_p90"] = [round(float(np.percentile(samples, 50)), 2), round(float(np.percentile(samples, 90)), 2)] if samples else None

        # Eau hors contour.
        ring = g.buffer(15).difference(all_water)
        rb = ring.bounds
        out_cells = 0
        for x in np.arange(math.floor(rb[0]) + 0.5, rb[2], 1.0):
            for y in np.arange(math.floor(rb[1]) + 0.5, rb[3], 1.0):
                if not ring.contains(Point(x, y)):
                    continue
                z = relief.at(x, y)
                if abs(z - level(x, y)) > 0.15:
                    continue
                around = [relief.at(x + u, y + v) for u in (-1, 0, 1) for v in (-1, 0, 1)]
                if np.nanstd(around) < 0.05:
                    out_cells += 1
        rec["flat_outside_m2"] = out_cells

        inner = g.buffer(-1)
        tin = [trees[j] for j in tree_tree.query(inner, predicate="contains")] if not inner.is_empty else []
        rec["trees_at"] = [[round(t.x), round(t.y), round(relief.at(t.x, t.y) - level(t.x, t.y), 2)] for t in tin[:200]]
        rec["inside"] = {
            "trees": int(sum(1 for j in tree_tree.query(inner, predicate="contains"))) if not inner.is_empty else 0,
            "furniture": sorted({furniture[j][0] for j in furn_tree.query(inner, predicate="contains")}) if not inner.is_empty else [],
            "walls": int(len(wall_tree.query(inner, predicate="intersects"))) if not inner.is_empty else 0,
            "buildings": int(len(bld_tree.query(inner, predicate="intersects"))) if bld_tree is not None and not inner.is_empty else 0,
        }
        br = []
        for d, ln, zz in decks:
            if ln.intersects(g):
                mid = ln.intersection(g)
                m = mid.interpolate(0.5, normalized=True) if mid.length > 0 else mid.centroid
                # Altitude du tablier au point le plus proche.
                s = ln.project(m)
                i = min(len(zz) - 1, int(round(s / ln.length * (len(zz) - 1)))) if ln.length else 0
                br.append({"id": d["id"], "kind": d["k"], "clear": round(zz[i] - level(m.x, m.y), 2)})
        rec["bridges"] = br

    # Rivières en ruban (6 m) : fusion des tronçons, nom OSM le plus proche.
    wide = unary_union([ln for _, ln, w in streams if w >= 6])
    for ln in (wide.geoms if hasattr(wide, "geoms") else [wide]):
        if ln.length < 5:
            continue
        mid = ln.interpolate(0.5, normalized=True)
        dz = []
        for t in np.linspace(0.1, 0.9, 9):
            p = ln.interpolate(t, normalized=True)
            q = ln.interpolate(min(ln.length, ln.project(p) + 1))
            dx, dy = q.x - p.x, q.y - p.y
            l2 = math.hypot(dx, dy) or 1
            nx, ny = dy / l2, -dx / l2
            bank = np.nanmean([relief.at(p.x + nx * 5, p.y + ny * 5), relief.at(p.x - nx * 5, p.y - ny * 5)])
            dz.append(bank - relief.at(p.x, p.y))
        name = osm_names(Polygon(mid.buffer(1).exterior), to_wgs)[1]
        report["rivers"].append({"length": round(ln.length), "mid": [round(mid.x), round(mid.y)], "name": name, "bed_below_banks_m": round(float(np.nanmedian(dz)), 2)})
    for w in sorted({w for _, _, w in streams}):
        report["streams"][str(w)] = round(sum(ln.length for _, ln, ww in streams if ww == w))

    REPORT.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(f"écrit {REPORT.relative_to(c.ROOT)}")
    for r in report["lakes"]:
        if r["area"] < MIN_AREA:
            continue
        pl = r.get("plane", {})
        print(f"#{r['id']:2d} {r['area'] / 1e4:5.2f} ha (ville {r['inland_area'] / 1e4:5.2f}) {str(r['point']):14s} z {r['z']['median']:7.2f} pente {pl.get('slope_m_per_km', '-')} m/km"
              f" {'MER' if r['sea'] else '   '} {r.get('osm_water') or r.get('osm_waterway') or '?'}")
        if "banks" in r:
            print(f"     berges {r['banks']} ({r['banks_m']} m), haut continu {r['longest_high_run']}, hors contour {r['flat_outside_m2']} m², dedans {r['inside']}, ponts {len(r['bridges'])}"
                  f" {[b['clear'] for b in r['bridges']]}")
    for r in report["rivers"]:
        print("ruban 6 m", r)
    print("ruisseaux (m par largeur)", report["streams"])


if __name__ == "__main__":
    main()
