"""Côté des devantures et des enseignes (D120) : sur quel mur de chaque bâtiment commerçant posent-elles leurs vitrines ?

Usage : python3 tools/data/build_shop_fronts.py [--force]       (après build_map.py : il lit les rues nommées de map/places.json)
Entrées : public/data/world.json, tiles/*.json (bâtiments et fiches), kinds/*.json (grandes surfaces), map/places.json (rues nommées),
          OpenStreetMap par blocs de 500 m (.cache/shared/raw/osm, téléchargés au besoin ; --force les retélécharge) : commerces avec leur
          `addr:street`, portes (`entrance`), parkings.
Sorties : dans les fiches des tuiles seulement, `ground.front` (indice du mur d'entrée), `wall` et `s` de chaque commerce de `ground.shops`,
          et le rôle « street » du mur choisi s'il était classé « court » ; pour un commerce vu sur une photo (`shop`, D141), sa fiche. Rien d'autre ne change (les tuiles se relisent à l'octet près).

Avant (build_facades.py), la vitrine allait sur le mur « de rue » le plus long, ou le plus proche du point OSM du commerce. Or ce point est
souvent au milieu du bâtiment, et un mur arrière à moins de 10 m d'une ruelle compte comme mur de rue : 345 vitrines sans nom sur 499
et 50 enseignes nommées sur 201 regardaient une autre rue que celle de leur adresse. Ordre de choix du mur, du plus sûr au moins sûr :
  0. une correction à la main (tools/data/manual.json, `fronts` : identifiant du bâtiment -> {"wall": indice du mur, "also": [autres murs de l'entrée, vitrés], "sign": mur de la grande enseigne, "signAt": milieu de l'enseigne en mètres depuis le début de ce mur, "signZ": bas d'une enseigne basse au-dessus du sol, "shop": commerce absent d'OpenStreetMap et sa devanture (D141, voir `apply_shop`), "shopWalls": {identifiant OpenStreetMap: {mur, s, terrasse} ou null} commerces d'OpenStreetMap lus sur photo (D157), "photo": ...}, d'après une photo) ;
  1. une porte OpenStreetMap posée sur le contour (commerce, entrée principale) ;
  2. le point du commerce lui-même s'il est sur le contour (cartographié à sa porte) ;
  3. grande surface : le mur qui a le plus de parking devant lui (bande de 25 m) ;
  4. le mur qui regarde la rue de l'adresse (celle du commerce, sinon celle du bâtiment), le plus proche du commerce ;
  5. sinon, rien ne change.
"""

import glob
import json
import math
import re
import sys
import unicodedata
from collections import Counter

from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

import config as c
import fetch

FORCE = "--force" in sys.argv
OSM_DIR = c.SHARED / "raw" / "osm"
to_l93 = Transformer.from_crs(4326, 2154, always_xy=True)

LOOK = 4.0  # m : on regarde à cette distance devant le mur
REACH = 22.0  # m : rue de l'adresse au plus à cette distance devant le mur
ON_RING = 1.2  # m : un point à moins de cette distance du contour est sur le mur
MIN_WALL = 2.5  # m : une devanture demande au moins ce mur
DEPTH = 25.0  # m : parking des clients compté sur cette profondeur devant le mur d'une grande surface


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").replace("’", "'")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def address_street(addr):
    """« 21bis Avenue Charles de Gaulle 71400 Autun » -> « Avenue Charles de Gaulle »."""
    m = re.match(r"^\s*\d+\s*(?:bis|ter|quater|[a-z])?\s+(.*?)\s+\d{5}\b", addr or "", re.IGNORECASE)
    return m.group(1) if m else None


def local(lon, lat):
    x, y = to_l93.transform(lon, lat)
    return x - c.ORIGIN[0], y - c.ORIGIN[1]


def load_osm(points):
    """Commerces, portes et parkings d'OpenStreetMap dans les blocs de 500 m qui contiennent `points` (repère local)."""
    blocks = {(math.floor((x + c.ORIGIN[0]) / fetch.OSM_BLOCK), math.floor((y + c.ORIGIN[1]) / fetch.OSM_BLOCK)) for x, y in points}
    elements = {}
    for bx, by in sorted(blocks):
        part = OSM_DIR / f"{bx}_{by}.json"
        if not part.exists() or FORCE:
            n = fetch.osm_api_block(bx, by, part)
            print(f"  osm {bx},{by} : {n} éléments")
        for e in json.loads(part.read_text())["elements"]:
            elements[(e["type"], e["id"])] = e
    shops, entrances, parkings = {}, [], []
    for (typ, oid), e in elements.items():
        t = e.get("tags", {})
        if typ == "node":
            p = Point(*local(e["lon"], e["lat"]))
            if "shop" in t or "amenity" in t:
                shops[oid] = (t, p)
            if t.get("entrance") in ("main", "shop", "yes") or ("entrance" in t and "shop" in t):
                entrances.append(p)
        elif typ == "way" and t.get("amenity") == "parking" and len(e.get("geometry", [])) >= 4:
            poly = Polygon([local(g["lon"], g["lat"]) for g in e["geometry"]])
            parkings.append(poly if poly.is_valid else poly.buffer(0))
    return shops, entrances, parkings


class Walls:
    """Les murs d'une fiche, en polylignes, avec ce qu'ils regardent."""

    def __init__(self, b, fiche):
        r = b["ring"]
        n = len(r) // 2
        self.pts = [(r[2 * i], r[2 * i + 1]) for i in range(n)]
        self.fiche = fiche
        self.lines = []
        for w in fiche["walls"]:
            if "hole" in w:
                self.lines.append(None)
                continue
            count = (w["b"] - w["a"]) % n or n
            self.lines.append(LineString([self.pts[(w["a"] + j) % n] for j in range(count + 1)]))

    def usable(self, i):
        w = self.fiche["walls"][i]
        return self.lines[i] is not None and w["role"] != "party" and w["length"] >= MIN_WALL

    def candidates(self):
        return [i for i in range(len(self.lines)) if self.usable(i)]

    def edges(self, i):
        """Arêtes du mur : milieu et normale sortante (anneau extérieur dans le sens trigonométrique, normale (dy, -dx))."""
        cs = list(self.lines[i].coords)
        for (x0, y0), (x1, y1) in zip(cs, cs[1:]):
            L = math.hypot(x1 - x0, y1 - y0)
            if L >= 1.0:
                yield ((x0 + x1) / 2, (y0 + y1) / 2), ((y1 - y0) / L, -(x1 - x0) / L), L

    def facing(self, i, geoms):
        """Distance de ce que le mur regarde dans `geoms` (devant lui, pas derrière) ; None s'il ne regarde rien à portée."""
        best = None
        for (mx, my), (nx, ny), _L in self.edges(i):
            ahead = Point(mx + nx * LOOK, my + ny * LOOK)
            at = Point(mx, my)
            for g in geoms:
                d = g.distance(ahead)
                if d <= REACH and d < g.distance(at) - 1.0 and (best is None or d < best):
                    best = d
        return best

    def ahead(self, i):
        """Bande de DEPTH mètres devant le mur."""
        quads = []
        for (mx, my), (nx, ny), L in self.edges(i):
            tx, ty = -ny, nx
            h = L / 2
            quads.append(Polygon([(mx - tx * h, my - ty * h), (mx + tx * h, my + ty * h),
                                  (mx + tx * h + nx * DEPTH, my + ty * h + ny * DEPTH), (mx - tx * h + nx * DEPTH, my - ty * h + ny * DEPTH)]))
        return unary_union(quads) if quads else Polygon()

    def nearest(self, p, among):
        return min(among, key=lambda i: self.lines[i].distance(p))


def apply_shop(fi, m):
    """Commerce vu sur une photo, absent d'OpenStreetMap (D141) : la fiche devient « shop », avec son commerce au milieu du mur d'entrée,
    la couleur de sa devanture, sa devanture dessinée telle quelle (`devanture`) et l'étage d'après la photo (enduit, menuiseries, volets) ;
    `status` passe à « observed ». Rien d'autre ne change, et une deuxième passe donne la même fiche."""
    sh = m["shop"]
    g = fi["ground"]
    g["kind"] = "shop"
    g["shopfront"] = {"color": sh["color"], "glazing": "full"}
    g["shops"] = [{"name": sh["name"], "kind": sh["kind"], "wall": m["wall"], "s": round(fi["walls"][m["wall"]]["length"] / 2, 2)}]
    g["devanture"] = sh["devanture"]
    up = sh.get("fiche", {})
    if "wall" in up:
        fi["materials"]["wall"]["color"] = up["wall"]
    if "frame" in up:
        fi["facade"]["window"]["frameColor"] = up["frame"]
    if "shutters" in up:
        fi["facade"]["shutters"]["kind"] = up["shutters"]
    if "balcony" in up:
        fi["facade"]["balcony"] = up["balcony"]
    if "era" in up:
        fi["era"] = up["era"]
    # D161 : réglages de façade plus fins (largeur de travée, fenêtres, volets, corniche, cordon, soubassement) ; un dictionnaire se fusionne, le reste se remplace.
    for k, v in up.get("facade", {}).items():
        if isinstance(v, dict) and isinstance(fi["facade"].get(k), dict):
            fi["facade"][k].update(v)
        else:
            fi["facade"][k] = v
    fi["status"] = "observed"
    src = {"kind": "photo", "ref": m["photo"][:80]}
    fi["sources"] = [q for q in fi["sources"] if q["kind"] != "photo"] + [src]


def main():
    world = json.load(open(c.OUT / "world.json"))
    places = json.load(open(c.OUT / "map" / "places.json"))
    by_name = {}
    for s in places["streets"]:
        for pl in s["lines"]:
            by_name.setdefault(norm(s["name"]), []).append(LineString([(pl[i], pl[i + 1]) for i in range(0, len(pl), 2)]))
    manual = json.load(open(c.ROOT / "tools" / "data" / "manual.json")).get("fronts", {})
    retail = set()
    for f in glob.glob(str(c.OUT / "kinds" / "*.json")):
        for bid, k in json.load(open(f)).get("buildings", {}).items():
            if k.get("k") == "retail":
                retail.add(bid)

    tiles = {}
    for m in world["tiles"]:
        if m.get("buildings"):
            tiles[m["id"]] = json.loads((c.OUT / "tiles" / f"{m['id']}.json").read_text())
    todo = []  # (tuile, bâtiment, fiche)
    for tid, rec in tiles.items():
        B = {b["id"]: b for b in rec["buildings"]}
        for fi in rec["fiches"]:
            if fi["id"] in B and fi["id"] in manual and manual[fi["id"]].get("shop"):
                apply_shop(fi, manual[fi["id"]])
            if fi["id"] in B and (fi["ground"]["kind"] == "shop" or fi["id"] in retail):
                todo.append((tid, B[fi["id"]], fi))
    shops, entrances, parkings = load_osm([(b["ring"][0], b["ring"][1]) for _t, b, _f in todo])
    entrance_tree = STRtree(entrances) if entrances else None
    parking_tree = STRtree(parkings) if parkings else None
    print(f"{len(todo)} bâtiments commerçants ; OSM : {len(shops)} commerces, {len(entrances)} portes, {len(parkings)} parkings")

    stats = Counter()

    def choose(W, cands, p, street, big):
        """(mur, raison) pour un commerce au point p (ou None : le bâtiment), rue d'adresse `street`."""
        ring = LineString(W.pts + W.pts[:1])
        if entrance_tree is not None:
            doors = [entrances[int(j)] for j in entrance_tree.query(ring.buffer(ON_RING))]
            doors = [d for d in doors if ring.distance(d) < ON_RING]
            if doors:
                d = min(doors, key=lambda d: d.distance(p)) if p is not None else doors[0]
                return W.nearest(d, cands), "porte"
        if p is not None and ring.distance(p) < ON_RING:
            return W.nearest(p, cands), "point"
        if big and parking_tree is not None:
            lots = [parkings[int(j)] for j in parking_tree.query(ring.buffer(DEPTH))]
            if lots:
                lot = unary_union(lots)
                area = {i: W.ahead(i).intersection(lot).area for i in cands}
                best = max(area, key=area.get)
                if area[best] >= 150:
                    return best, "parking"
        lines = by_name.get(norm(street)) if street else None
        if lines:
            seen = {i: W.facing(i, lines) for i in cands}
            seen = {i: d for i, d in seen.items() if d is not None}
            if seen:
                close = min(seen.values())
                near = [i for i, d in seen.items() if d <= close + 3.0]
                return (W.nearest(p, near) if p is not None else max(near, key=lambda i: W.fiche["walls"][i]["length"])), "adresse"
        return None, "inchangé"

    for tid, b, fi in todo:
        # Les murs d'une correction à la main sont des murs de rue avant tout choix (une seule passe suffit).
        m = manual.get(fi["id"], {})
        over = m.get("shopWalls", {})
        for i in [m.get("wall"), m.get("sign"), *m.get("also", []), *[o["wall"] for o in over.values() if o]]:
            if i is not None and fi["walls"][i]["role"] != "street":
                fi["walls"][i]["role"] = "street"
                stats["mur passé en rue"] += 1
        W = Walls(b, fi)
        cands = W.candidates()
        if not cands:
            continue
        g = fi["ground"]
        big = fi["id"] in retail
        street = address_street(fi.get("address"))
        if fi["id"] in manual:
            front, why = manual[fi["id"]]["wall"], "à la main"
        else:
            front, why = choose(W, cands, None, street, big)
        chosen = []
        g.pop("front", None)
        g.pop("frontWalls", None)
        g.pop("signWall", None)
        g.pop("signAt", None)
        g.pop("signZ", None)
        if front is not None:
            g["front"] = front
            chosen.append(front)
        if fi["id"] in manual and manual[fi["id"]].get("also"):
            g["frontWalls"] = manual[fi["id"]]["also"]
            chosen.extend(g["frontWalls"])
        if fi["id"] in manual and manual[fi["id"]].get("sign") is not None:
            g["signWall"] = manual[fi["id"]]["sign"]
            if manual[fi["id"]].get("signAt") is not None:
                g["signAt"] = manual[fi["id"]]["signAt"]
            if manual[fi["id"]].get("signZ") is not None:
                g["signZ"] = manual[fi["id"]]["signZ"]
            chosen.append(g["signWall"])
        stats[f"bâtiment : {why}"] += 1
        for sh in g.get("shops", []):
            t, p = shops.get(sh.get("osm"), ({}, None))
            if p is None:
                stats["commerce absent d'OSM"] += 1
                continue
            wall, why = choose(W, cands, p, t.get("addr:street") or street, big)
            if wall is None:
                stats[f"commerce : {why}"] += 1
                continue
            stats[f"commerce : {why}"] += 1
            stats["commerce : mur changé"] += wall != sh["wall"]
            sh["wall"] = wall
            sh["s"] = round(W.lines[wall].project(p), 2)
            chosen.append(wall)
        # D157 : mur, position et terrasse d'un commerce lus sur photo (`shopWalls` de `fronts` : identifiant OpenStreetMap -> {wall, s, terrace}, ou null : le
        # commerce n'est pas dans ce bâtiment).
        if over:
            kept = []
            for sh in g.get("shops", []):
                key = str(sh.get("osm"))
                if key not in over:
                    kept.append(sh)
                    continue
                o = over[key]
                if o is None:
                    stats["commerce : retiré (photo)"] += 1
                    continue
                sh["wall"] = o["wall"]
                if "s" in o:
                    sh["s"] = o["s"]
                if "terrace" in o:
                    sh["terrace"] = o["terrace"]
                stats["commerce : mur lu sur photo"] += 1
                chosen.append(o["wall"])
                kept.append(sh)
            g["shops"] = kept
        for i in chosen:
            if fi["walls"][i]["role"] != "street":
                fi["walls"][i]["role"] = "street"
                stats["mur passé en rue"] += 1

    manifest = {m["id"]: m for m in world["tiles"]}
    changed = 0
    dropped = set(json.load(open(c.ROOT / "tools" / "data" / "manual.json")).get("dropWalls", []))
    for tid, rec in tiles.items():
        if dropped:
            kept = [w for w in rec.get("walls", []) if w["id"] not in dropped]
            stats["mur retiré (D161)"] += len(rec.get("walls", [])) - len(kept)
            rec["walls"] = kept
        text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        path = c.OUT / "tiles" / f"{tid}.json"
        if path.read_text() != text:
            path.write_text(text)
            manifest[tid]["bytes"] = len(text)
            changed += 1
    (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    for k, v in sorted(stats.items()):
        print(f"  {k} : {v}")
    print(f"{changed} tuiles réécrites")


if __name__ == "__main__":
    main()
