"""Clôtures de parcelle : ne garder que celles que le relevé LiDAR voit (D304).

Les clôtures de parcelle de build_public_space.py (D94, D96 ; identifiants −(900 000 000 + n)) sont posées sur chaque limite de parcelle
qui longe une rue, avec un matériau tiré au hasard par parcelle : ≈ 99 km, contre 18 km de murs relevés dans OpenStreetMap.
Ici, chaque tronçon est confronté au relief LiDAR HD (MNS − MNT, 0,5 m) et à l'orthophotographie :

- **Présence** : tous les 0,5 m le long du tronçon, on cherche à moins de PROBE m de part et d'autre (le cadastre et la clôture réelle ne
  coïncident pas au mètre) un point qui dépasse le sol de LOW à HIGH m, hors chaussée (voitures garées). Au-dessus de HIGH (houppier,
  toit), le point ne dit rien. Le tronçon est gardé si ces points couvrent au moins KEEP de ses points lisibles, et s'il en a assez.
- **Matériau** : cases surélevées vertes sur l'orthophotographie (indice de vert, HEDGE) → haie ; sinon mur bas (≤ 1,3 m) ou mur, grille au-dessus de
  1,3 m si les points trouvés sont discontinus (un barreaudage laisse passer le laser). Hauteur : médiane mesurée, bornée.
- **Un matériau par côté de rue** : les tronçons gardés qui se suivent (bouts à moins de JOIN m, même direction à 30° près) prennent le
  matériau majoritaire (en longueur) de leur groupe et sa hauteur médiane : plus de mur, haie, grille, mur d'une parcelle à l'autre.
- **Portillons** : les ouvertures d'1,2 m que D96 coupait tous les 10 m sont refermées là où le relevé voit la clôture continuer.
- Les clôtures nommées dans une liste d'exclusion (grille du lycée, clôture de la gendarmerie, `dropWalls`…) ne sont pas touchées.

Rasters mis en cache par tuile dans .cache/shared/fence_survey/ (≈ 1 s par couche et par tuile). Réécrit les tuiles publiées et les
compteurs de world.json. Appelé à la fin de build_public_space.py ; exécutable seul :
    python3 tools/data/prune_fences.py [--dry]
"""

import io
import json
import math
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from shapely.geometry import LineString, Point
from shapely.prepared import prep

import config as c
import fetch
import roadside

FENCE_ID = 900_000_000  # identifiants des clôtures de parcelle : −(FENCE_ID + n), cf. build_public_space.py
RES = 0.5
MARGIN = 6.0  # marge autour de la tuile (m) : une clôture déborde de la tuile de son premier sommet
PROBE = 1.0  # demi-largeur de la recherche de part et d'autre du tronçon (m)
LOW, HIGH = 0.6, 3.2  # un point de clôture dépasse le sol de LOW à HIGH (m)
KEEP = 0.55  # part minimale des points lisibles où quelque chose est trouvé
MIN_READ = 0.4  # part minimale de points lisibles (pas sous un houppier) pour juger
GREEN = 0.05  # indice de vert (2G − R − B) / (R + G + B) d'une case de végétation sur l'orthophotographie
HEDGE = 0.4  # part minimale de cases vertes parmi les cases surélevées pour une haie (thuyas sombres : 0,7 à 1 ; murs gris : 0 à 0,1)
SOLID = 0.8  # en dessous de cette part de points lisibles trouvés, un tronçon de plus de 1,3 m est une grille (le laser passe entre les barreaux)
JOIN = 2.5  # tronçons voisins d'un même côté de rue (m)
GATE = 1.5  # écart au plus entre deux tronçons pour un portillon de D96 (1,2 m) qu'on peut refermer
LAYERS = {"mns": "IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", "mnt": "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93",
          "ortho": "HR.ORTHOIMAGERY.ORTHOPHOTOS"}
CACHE = c.SHARED / "fence_survey"
TILES = c.OUT / "tiles"


def is_parcel_fence(w):
    return -FENCE_ID - 1_000_000 < w["id"] <= -FENCE_ID and w["kind"] in ("wall", "fence", "hedge")


def protected_ids():
    """Clôtures citées par un ouvrage qui les remplace (listes d'exclusion) : laissées telles quelles."""
    ids = set(json.load(open(c.ROOT / "tools" / "data" / "manual.json")).get("dropWalls", []))

    def walk(o, key=None):
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, k)
        elif isinstance(o, list):
            if key == "walls" and all(isinstance(v, int) for v in o):
                ids.update(o)
            else:
                for v in o:
                    walk(v)

    for p in (c.OUT / "kinds").glob("*.json"):
        walk(json.load(open(p)))
    return ids


class Window:
    """MNS − MNT et orthophotographie à 0,5 m sur l'emprise d'une tuile (coordonnées locales)."""

    def __init__(self, tid, bounds):
        x0, y0, x1, y1 = bounds
        self.x0, self.y1 = x0 - MARGIN, y1 + MARGIN
        w = round((x1 - x0 + 2 * MARGIN) / RES)
        h = round((y1 - y0 + 2 * MARGIN) / RES)
        X0, Y0 = self.x0 + c.ORIGIN[0], y0 - MARGIN + c.ORIGIN[1]
        box = (X0, Y0, X0 + w * RES, Y0 + h * RES)
        get = lambda k, fmt, ext: fetch.wms_block(LAYERS[k], fmt, *box, w, h, CACHE / f"{tid}_{k}.{ext}")
        mns = tifffile.imread(io.BytesIO(get("mns", "image/geotiff", "tif"))).astype(np.float32)
        mnt = tifffile.imread(io.BytesIO(get("mnt", "image/geotiff", "tif"))).astype(np.float32)
        for a in (mns, mnt):
            a[(a < -1000) | (a > 10000)] = np.nan
        self.above = mns - mnt
        self.rgb = np.asarray(Image.open(io.BytesIO(get("ortho", "image/jpeg", "jpg"))).convert("RGB"), np.float32)
        self.h, self.w = self.above.shape

    def cell(self, x, y):
        q, r = int((x - self.x0) / RES), int((self.y1 - y) / RES)
        return (r, q) if 0 <= r < self.h and 0 <= q < self.w else None


def survey(win, line, road):
    """(points lisibles, points où quelque chose dépasse, part verte des cases surélevées, hauteur médiane, points) pour un tronçon."""
    n = max(2, int(line.length / RES) + 1)
    read = found = green = raised = 0
    heights = []
    for i in range(n):
        p = line.interpolate(i / (n - 1), normalized=True)
        q = line.interpolate(min(i + 1, n - 1) / (n - 1), normalized=True) if i < n - 1 else line.interpolate((i - 1) / (n - 1), normalized=True)
        tx, ty = q.x - p.x, q.y - p.y
        L = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / L, tx / L
        best, blind, cells = None, False, []
        for k in np.arange(-PROBE, PROBE + 1e-6, RES):
            x, y = p.x + nx * k, p.y + ny * k
            rc = win.cell(x, y)
            if rc is None:
                continue
            h = win.above[rc]
            if not np.isfinite(h):
                continue
            if h > HIGH:
                blind = True
                break
            if h >= LOW and not (road is not None and road.contains(Point(x, y))):
                cells.append(rc)
                if best is None or h > best:
                    best = float(h)
        if blind:
            continue  # sous un houppier ou contre un toit : leurs bords imitent une haie, on ne sait pas
        read += 1
        if best is None:
            continue
        found += 1
        heights.append(best)
        for rc in cells:
            r, g, b = win.rgb[rc]
            raised += 1
            if (2 * g - r - b) / (r + g + b + 1.0) > GREEN:
                green += 1
    return read, found, green / max(raised, 1), (float(np.median(heights)) if heights else 0.0), n


def judge(win, w, road):
    pts = w["pts"]
    line = LineString([(pts[i], pts[i + 1]) for i in range(0, len(pts), 2)])
    if line.length < 0.5:
        return None
    read, found, green, h, n = survey(win, line, road)
    if read < MIN_READ * n or found < KEEP * read:
        return None
    if green >= HEDGE:
        kind, height = "hedge", min(max(h, 0.9), 2.5)
    elif h > 1.3 and found < SOLID * read:
        kind, height = "fence", min(max(h, 1.2), 2.0)
    else:
        kind, height = "wall", min(max(h, 0.6), 2.5)
    return {"kind": kind, "height": round(height, 1), "measured": round(h, 2), "len": line.length, "line": line}


def unify(kept):
    """Un matériau par côté de rue : groupes de tronçons bout à bout, alignés ; matériau majoritaire en longueur, hauteur médiane.
    Renvoie le nombre de tronçons changés et les paires de voisins (i, bout de i, j, bout de j, écart)."""
    parent = list(range(len(kept)))
    pairs = []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def direction(ln):
        (ax, ay), (bx, by) = ln.coords[0], ln.coords[-1]
        L = math.hypot(bx - ax, by - ay) or 1.0
        return (bx - ax) / L, (by - ay) / L

    ends = [(k["line"].coords[0], k["line"].coords[-1]) for k in kept]
    dirs = [direction(k["line"]) for k in kept]
    grid = defaultdict(list)
    for i, (a, b) in enumerate(ends):
        for p in (a, b):
            grid[(int(p[0] // JOIN), int(p[1] // JOIN))].append(i)
    for i, (a, b) in enumerate(ends):
        for p in (a, b):
            gx, gy = int(p[0] // JOIN), int(p[1] // JOIN)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in grid.get((gx + dx, gy + dy), ()):
                        if j <= i:
                            continue
                        d, ej = min((math.dist(p, q), e) for e, q in enumerate(ends[j]))
                        if d > JOIN:
                            continue
                        if abs(dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]) < math.cos(math.radians(30)):
                            continue
                        parent[find(i)] = find(j)
                        pairs.append((i, 0 if p == a else 1, j, ej, d))
    groups = defaultdict(list)
    for i in range(len(kept)):
        groups[find(i)].append(kept[i])
    changed = 0
    for g in groups.values():
        if len(g) < 2:
            continue
        by_kind = Counter()
        for k in g:
            by_kind[k["kind"]] += k["len"]
        kind = by_kind.most_common(1)[0][0]
        height = round(float(np.median([k["height"] for k in g if k["kind"] == kind])), 1)
        for k in g:
            if k["kind"] != kind or k["height"] != height:
                changed += 1
            k["kind"], k["height"] = kind, height
    return changed, pairs


def close_gaps(kept, pairs, window, road):
    """Referme les portillons de D96 (un tous les 10 m) là où le relevé voit la clôture continuer : on prolonge un des deux tronçons
    jusqu'à l'autre. Une vraie ouverture (entrée, portail) n'a rien entre ses bords et reste ouverte."""
    closed = 0
    for i, ei, j, ej, d in pairs:
        if d < 0.05 or d > GATE:
            continue
        a, b = kept[i], kept[j]
        pa = (a["pts"][0], a["pts"][1]) if ei == 0 else (a["pts"][-2], a["pts"][-1])
        pb = (b["pts"][0], b["pts"][1]) if ej == 0 else (b["pts"][-2], b["pts"][-1])
        if math.dist(pa, pb) < 0.05:
            continue  # déjà refermé (par l'autre bout de la paire)
        read, found, _, _, _ = survey(window(a["tile"]), LineString([pa, pb]), road(a["tile"]))
        if read == 0 or found < KEEP * read:
            continue
        a["pts"] = [*pb, *a["pts"]] if ei == 0 else [*a["pts"], *pb]
        closed += 1
    return closed


def tile_roads(rec):
    R = roadside.roads(rec.get("ground", {}))
    return prep(R) if R is not None and not R.is_empty else None


def main(dry=False):
    world_path = c.OUT / "world.json"
    world = json.loads(world_path.read_text())
    manifest = {m["id"]: m for m in world["tiles"]}
    keep_ids = protected_ids()
    todo = []
    for path in sorted(TILES.glob("*.json")):
        rec = json.loads(path.read_text())
        if any(is_parcel_fence(w) and w["id"] not in keep_ids for w in rec["walls"]):
            todo.append((path, rec))
    print(f"{len(todo)} tuiles à vérifier", flush=True)
    CACHE.mkdir(parents=True, exist_ok=True)

    def load(item):
        path, rec = item
        return Window(path.stem, rec["bounds"])

    stats = Counter()
    before_len, after_len = Counter(), Counter()
    kept, others = [], {}
    with ThreadPoolExecutor(6) as pool:
        for (path, rec), win in zip(todo, pool.map(load, todo)):
            road = tile_roads(rec)
            others[path] = []
            for w in rec["walls"]:
                if not is_parcel_fence(w) or w["id"] in keep_ids:
                    others[path].append(w)
                    continue
                pts = w["pts"]
                L = LineString([(pts[i], pts[i + 1]) for i in range(0, len(pts), 2)]).length
                before_len[w["kind"]] += L
                v = judge(win, w, road)
                if v is None:
                    stats["retirés"] += 1
                    continue
                v["id"], v["pts"], v["tile"] = w["id"], w["pts"], path
                kept.append(v)
    # Sur toute la ville d'un coup : une rue passe d'une tuile à l'autre.
    stats["unifiés"], pairs = unify(kept)
    stats["gardés"] = len(kept)
    recs = {path: rec for path, rec in todo}
    windows, roads = {}, {}

    def window(path):
        if path not in windows:
            windows.clear()  # les paires sont rangées par tuile : une fenêtre à la fois suffit
            windows[path] = Window(path.stem, recs[path]["bounds"])
        return windows[path]

    def road(path):
        if path not in roads:
            roads[path] = tile_roads(recs[path])
        return roads[path]

    pairs.sort(key=lambda t: str(kept[t[0]]["tile"]))
    stats["portillons refermés"] = close_gaps(kept, pairs, window, road)
    for v in kept:
        after_len[v["kind"]] += v["len"]
        others[v["tile"]].append({"id": v["id"], "kind": v["kind"], "height": v["height"], "measured": v["measured"], "pts": v["pts"]})
    for path, rec in todo:
        rec["walls"] = others[path]
        if not dry:
            text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
            path.write_text(text)
            m = manifest.get(path.stem)
            if m:
                m["walls"], m["bytes"] = len(rec["walls"]), len(text)
    if not dry:
        world_path.write_text(json.dumps(world, indent=1))
    km = lambda d: {k: round(v / 1000, 1) for k, v in sorted(d.items())} | {"total": round(sum(d.values()) / 1000, 1)}
    print(f"clôtures de parcelle : {dict(stats)} ; avant {km(before_len)} km ; après {km(after_len)} km")


if __name__ == "__main__":
    main(dry="--dry" in sys.argv)
