"""Stationnement le long des trottoirs, lot 1 (D296) : relevé des voitures garées sur l'orthophotographie IGN (20 cm), rue par rue et côté par côté.

Usage : python3 tools/data/survey_curbs.py [--images DOSSIER]
Entrées : public/data/nav/*.json (graphe routier), public/data/tiles/*.json (chaussée dessinée, bâtiments), public/data/world.json (origine
          Lambert-93), orthophotographie IGN à 20 cm par tuile de 250 m (WMS, .cache/shared/ortho20, non versionné), noms des voies
          (API d'OpenStreetMap, .cache/shared/curbs_ways.json).
Sortie : tools/data/curb_parking.json (le plan, relu par l'utilisateur avant le lot 2 : une entrée par côté de tronçon où l'on voit des voitures
         garées) ; avec --images, une image de contrôle par tuile (côtés retenus en vert, voitures repérées en rouge) et une vue d'ensemble.
Ne touche à aucune donnée publiée.

Méthode : pour chaque arête carrossable du graphe (ni voie de service, ni allée de parking, ni rond-point) et chacun de ses côtés, tous les
mètres le long de l'axe, on cherche la bordure de la chaussée dessinée (la dernière case de chaussée en s'écartant de l'axe), puis on compare
trois bandes de 2 m (le long de la bordure dans la chaussée, puis au-delà : la chaussée dessinée est parfois plus étroite que la vraie, ou
décalée, D94) à l'enrobé du milieu de la voie : une case est « voiture » si sa couleur s'en écarte nettement et si la bande y est contrastée (une ombre portée est sombre mais
unie). Les suites de cases « voiture » de 3,2 à 40 m font des voitures (une tous les 5 m). Un côté est retenu à partir de deux voitures et d'un
quart de sa longueur occupé.
"""

import io
import json
import math
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import config as c
from build_signs import AISLE, ROUNDABOUT, SERVICE, load_graph, length

HERE = Path(__file__).resolve().parent
PLAN = HERE / "curb_parking.json"
ORTHO = c.SHARED / "ortho20"
NAMES = c.SHARED / "curbs_ways.json"
RES = 0.2  # m par pixel
TILE = 250.0
STEP = 1.0  # pas le long de l'axe (m)
MIN_RUN, MAX_RUN, CAR = 3.2, 40.0, 5.0
MIN_EDGE = 12.0


def wms(x0, y0, x1, y1, w, h, cache):
    if cache.exists():
        return cache.read_bytes()
    url = ("https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLES=&FORMAT=image/jpeg"
           f"&CRS=EPSG:2154&BBOX={x0},{y0},{x1},{y1}&WIDTH={w}&HEIGHT={h}")
    for attempt in range(5):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "autun-3d-data"}), timeout=120).read()
            break
        except Exception:  # coupure réseau (OSError, IncompleteRead…) : on réessaie
            time.sleep(4 * 2 ** attempt)
    else:
        raise SystemExit(f"orthophoto indisponible : {url}")
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    return data


class Tile:
    """Orthophoto et masques (chaussée dessinée 1, bâtiments 2, parkings 3) d'une tuile de 250 m, à 20 cm."""

    def __init__(self, tid, bounds, origin):
        self.x0, self.y0, self.x1, self.y1 = bounds
        n = int(round(TILE / RES))
        self.n = n
        ox, oy = origin
        img = wms(self.x0 + ox, self.y0 + oy, self.x1 + ox, self.y1 + oy, n, n, ORTHO / f"{tid}.jpg")
        self.rgb = np.asarray(Image.open(io.BytesIO(img)).convert("RGB"))
        data = json.loads((c.OUT / "tiles" / f"{tid}.json").read_text())
        road = Image.new("L", (n, n), 0)
        d = ImageDraw.Draw(road)
        for k, polys in data["ground"].items():
            if not k.startswith("road_"):
                continue
            for poly in polys:
                d.polygon(self.px_ring(poly[0]), fill=1)
                for h in poly[1:]:
                    d.polygon(self.px_ring(h), fill=0)
        # Parkings dessinés (enrobé de place) : leurs voitures sont déjà sur les places du marquage (D24) ; on ne les compte pas.
        for poly in data["ground"].get("plaza_asphalt", []):
            d.polygon(self.px_ring(poly[0]), fill=3)
            for h in poly[1:]:
                d.polygon(self.px_ring(h), fill=0)
        for b in data["buildings"]:
            d.polygon(self.px_ring(b["ring"]), fill=2)
        self.road = np.asarray(road)

    def px_ring(self, ring):
        return [((ring[i] - self.x0) / RES, (self.y1 - ring[i + 1]) / RES) for i in range(0, len(ring), 2)]

    def px(self, x, y):
        i, j = int((self.y1 - y) / RES), int((x - self.x0) / RES)
        return (i, j) if 0 <= i < self.n and 0 <= j < self.n else None


class World:
    def __init__(self):
        w = json.loads((c.OUT / "world.json").read_text())
        self.origin = w["origin"][:2]
        self.bounds = {t["id"]: t["bounds"] for t in w["tiles"]}
        t0 = w["tiles"][0]
        self.bx, self.by = t0["bounds"][0] - t0["col"] * TILE, t0["bounds"][1] - t0["row"] * TILE
        self.grid = {(t["col"], t["row"]): t["id"] for t in w["tiles"]}
        self.tiles = {}

    def tile_id(self, x, y):
        return self.grid.get((math.floor((x - self.bx) / TILE), math.floor((y - self.by) / TILE)))

    def tile(self, tid):
        """Tuile chargée ; au plus 40 en mémoire (≈ 5 Mo chacune), les plus anciennes oubliées (relues depuis le cache disque)."""
        if tid in self.tiles:
            self.tiles[tid] = self.tiles.pop(tid)
        else:
            self.tiles[tid] = Tile(tid, self.bounds[tid], self.origin)
            if len(self.tiles) > 40:
                self.tiles.pop(next(iter(self.tiles)))
        return self.tiles[tid]

    def sample(self, x, y):
        """(masque, couleur) au point, ou None hors des tuiles."""
        tid = self.tile_id(x, y)
        if tid is None:
            return None
        t = self.tile(tid)
        p = t.px(x, y)
        return None if p is None else (int(t.road[p]), t.rgb[p].astype(np.float32))


def stations(pts):
    """Points tous les STEP m le long de la polyligne, avec la direction unitaire locale."""
    out, carry = [], 0.0
    for p, q in zip(pts, pts[1:]):
        seg = math.dist(p, q)
        if seg < 1e-6:
            continue
        ux, uy = (q[0] - p[0]) / seg, (q[1] - p[1]) / seg
        s = carry
        while s < seg:
            out.append((p[0] + ux * s, p[1] + uy * s, ux, uy))
            s += STEP
        carry = s - seg
    return out


def way_names(ways):
    known = json.loads(NAMES.read_text()) if NAMES.exists() else {}
    todo = sorted(w for w in ways if str(w) not in known)
    for i in range(0, len(todo), 100):
        b = todo[i:i + 100]
        url = "https://api.openstreetmap.org/api/0.6/ways.json?ways=" + ",".join(map(str, b))
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "autun-3d-data"}), timeout=60) as r:
                found = {el["id"]: el.get("tags", {}) for el in json.load(r)["elements"]}
        except OSError:
            found = {}
        for w in b:
            known[str(w)] = found.get(w, {}).get("name")
        time.sleep(0.5)
    NAMES.parent.mkdir(parents=True, exist_ok=True)
    NAMES.write_text(json.dumps(known, ensure_ascii=False))
    return known


def survey_side(world, e, side):
    """Profil d'un côté : pour chaque station, (distance à l'axe de la bordure, score voiture) ; référence d'enrobé de l'arête."""
    st = stations(e["pts"])
    ref = []
    for x, y, ux, uy in st[::2]:
        for o in (-0.6, 0.0, 0.6):
            s = world.sample(x - uy * o, y + ux * o)
            if s and s[0] == 1:
                ref.append(s[1])
    if len(ref) < 5:
        return None
    ref = np.median(np.array(ref), axis=0)
    prof = []
    for x, y, ux, uy in st:
        nx, ny = -uy * side, ux * side  # gauche (+1) ou droite (−1) du sens a → b
        curb = None
        for k in range(1, 70):
            o = k * 0.2
            s = world.sample(x + nx * o, y + ny * o)
            if s is None or s[0] != 1:
                curb = o - 0.2 if k > 1 else None
                break
        if curb is None or curb < 1.5:
            prof.append((curb, 0.0))
            continue
        # Trois bandes de 2,2 m : le long de la bordure dans la chaussée, puis au-delà (la chaussée dessinée est parfois plus étroite que
        # la vraie, ou décalée : D94, les voitures sont alors sur ce que le jeu dessine en trottoir) ; on garde la plus « garnie ».
        best = (0.0, 0.0)
        for lo in (-2.0, 0.2, 2.4):
            cols = []
            for o in np.arange(curb + lo, curb + lo + 2.0, 0.2):
                for a in (-0.3, 0.0, 0.3):
                    s = world.sample(x + nx * o + ux * a, y + ny * o + uy * a)
                    if s is None or s[0] in (2, 3):
                        cols = []
                        break
                    cols.append(s[1])
                if not cols:
                    break
            if len(cols) < 10:
                continue
            cols = np.array(cols)
            far = np.linalg.norm(cols - ref, axis=1) > 42
            score = float(far.mean()) if float(cols.std(axis=0).mean()) > 16 else 0.0
            if score > best[0] + 0.1:
                best = (score, curb + lo + 1.0)
        prof.append((best[1] if best[0] > 0 else curb, best[0]))
    return st, prof


def runs(prof):
    out, start = [], None
    for i, (_, sc) in enumerate(prof + [(None, 0.0)]):
        if sc >= 0.35 and start is None:
            start = i
        elif sc < 0.35 and start is not None:
            ln = (i - start) * STEP
            if MIN_RUN <= ln <= MAX_RUN:
                out.append((start * STEP, i * STEP))
            start = None
    return out


def main():
    nodes, edges, _ = load_graph()
    world = World()
    candidates = [e for e in edges if e["cls"] < SERVICE and not e["flags"] & (AISLE | ROUNDABOUT) and length(e["pts"]) >= MIN_EDGE]
    if "--near" in sys.argv:
        # Essai sur une partie de la ville : --near x,y,rayon (repère du jeu) ; le plan n'est pas écrit.
        cx, cy, r = (float(v) for v in sys.argv[sys.argv.index("--near") + 1].split(","))
        candidates = [e for e in candidates if math.dist(e["pts"][len(e["pts"]) // 2], (cx, cy)) < r]
    names = way_names({e["way"] for e in candidates})
    plan, total_cars = [], 0
    marks = defaultdict(list)
    for i, e in enumerate(candidates):
        if i % 200 == 0:
            print(f"  {i}/{len(candidates)} arêtes", flush=True)
        for side in (1, -1):
            res = survey_side(world, e, side)
            if res is None:
                continue
            st, prof = res
            rr = runs(prof)
            cars = sum(max(1, round((b - a) / CAR)) for a, b in rr)
            ln = len(st) * STEP
            occ = sum(b - a for a, b in rr) / ln if ln else 0
            keep = cars >= 2 and occ >= 0.25
            offs = []
            for a, b in rr:
                k0, k1 = int(a / STEP), min(len(st) - 1, int(b / STEP) - 1)
                curbs = [prof[k][0] for k in range(k0, k1 + 1) if prof[k][0]]
                cb = float(np.median(curbs)) if curbs else e["w"] / 2
                offs.append(cb)
                p0, p1 = st[k0], st[k1]
                q = lambda p: (p[0] - p[3] * side * cb, p[1] + p[2] * side * cb)
                marks[world.tile_id(p0[0], p0[1])].append((q(p0), q(p1), keep))
            if not rr:
                continue
            total_cars += cars if keep else 0
            plan.append({"way": e["way"], "name": names.get(str(e["way"])), "a": [round(v, 2) for v in nodes[e["a"]]], "b": [round(v, 2) for v in nodes[e["b"]]],
                         "side": "gauche" if side > 0 else "droite", "len": round(ln, 1), "w": e["w"], "oneway": bool(e["flags"] & 3),
                         "cars": cars, "occ": round(occ, 2), "runs": [[round(a, 1), round(b, 1)] for a, b in rr],
                         # Distance de l'axe au milieu des voitures (m), et de l'axe à la bordure dessinée : au-delà, elles sont sur le trottoir dessiné.
                         "off": round(float(np.median(offs)), 1) if offs else None,
                         "curb": round(float(np.median([p[0] for p in prof if p[0]] or [0])), 1), "keep": keep})
    kept = [p for p in plan if p["keep"]]
    streets = defaultdict(lambda: [0, 0.0])
    for p in kept:
        streets[p["name"] or "(sans nom)"][0] += p["cars"]
        streets[p["name"] or "(sans nom)"][1] += p["len"]
    if "--near" not in sys.argv:
      PLAN.write_text(json.dumps({
        "_doc": "Stationnement le long des trottoirs (survey_curbs.py, D296) : côtés de tronçons où l'orthophotographie montre des voitures garées. "
                "a, b : bouts de l'arête du graphe routier ; side : côté par rapport au sens a → b ; runs : suites de voitures (m depuis a) ; "
                "keep : retenu par le relevé (au moins deux voitures et un quart occupé). Corrections à la main dans `overrides` : "
                "{\"way\": id, \"side\": ..., \"keep\": true|false, \"type\": \"file\"|\"epi\"}.",
        "overrides": [],
        "sides": plan,
    }, ensure_ascii=False, indent=1))
    print(f"{len(kept)} côtés retenus sur {len(plan)} où l'on voit au moins une voiture ; {total_cars} voitures sur les côtés retenus ; "
          f"{sum(p['len'] for p in kept) / 1000:.1f} km de bordure")
    for name, (cars, ln) in sorted(streets.items(), key=lambda kv: -kv[1][0])[:40]:
        print(f"  {name} : {cars} voitures, {ln:.0f} m")
    if "--images" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--images") + 1])
        out.mkdir(parents=True, exist_ok=True)
        for tid, lines in marks.items():
            if tid is None or not any(k for *_, k in lines):
                continue
            t = world.tile(tid)
            img = Image.fromarray(t.rgb)
            d = ImageDraw.Draw(img)
            for (a, b, k) in lines:
                pa, pb = t.px(*a), t.px(*b)
                if pa and pb:
                    d.line([(pa[1], pa[0]), (pb[1], pb[0])], fill=(40, 230, 60) if k else (230, 40, 40), width=6)
            img.resize((t.n // 2, t.n // 2)).save(out / f"{tid}.jpg", quality=80)
        print(f"images : {out}")


if __name__ == "__main__":
    main()
