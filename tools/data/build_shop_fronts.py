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


def apply_overrides(fi, up):
    """Réglages d'étage d'après photo (D141, D161, D163) : enduit, menuiseries, volets, balcons, époque, niveaux, matériaux et réglages fins de
    façade (largeur de travée, fenêtres, volets, corniche, cordon, soubassement). Un dictionnaire se fusionne, le reste se remplace."""
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
    if "levels" in up:
        fi["levels"] = up["levels"]
    if "storeys" in up:
        fi["storeys"].update(up["storeys"])
    for k, v in up.get("materials", {}).items():
        if isinstance(v, dict):
            fi["materials"][k].update(v)
        else:
            fi["materials"][k] = v
    for k, v in up.get("facade", {}).items():
        if isinstance(v, dict) and isinstance(fi["facade"].get(k), dict):
            fi["facade"][k].update(v)
        else:
            fi["facade"][k] = v


def apply_observed(fi, m):
    """Bâtiment vu sur une photo sans devanture (D163, `fiches` de manual.json) : réglages de façade, `status` « observed », source « photo »."""
    apply_overrides(fi, m)
    fi["status"] = "observed"
    src = {"kind": "photo", "ref": m["photo"][:80]}
    fi["sources"] = [q for q in fi["sources"] if q["kind"] != "photo"] + [src]


def drop_buildings(world, ids):
    """Retire des tuiles les bâtiments BD TOPO qui ne sont pas des bâtiments (D163 : l'auvent d'entrée de l'hôpital de Latouche, que BD TOPO compte comme
    un bâtiment de 4,7 m) : bâtiment et fiche de la tuile, type de `kinds/`, silhouette lointaine de `lod/`. Les compteurs de `world.json` suivent."""
    meta = {m["id"]: m for m in world["tiles"]}
    n = 0
    for tid, m in meta.items():
        tp = c.OUT / "tiles" / f"{tid}.json"
        if not m.get("buildings") or not tp.exists():
            continue
        rec = json.loads(tp.read_text())
        gone = [b for b in rec["buildings"] if b["id"] in ids]
        if not gone:
            continue
        rings = [b["ring"] for b in gone]
        rec["buildings"] = [b for b in rec["buildings"] if b["id"] not in ids]
        rec["fiches"] = [f for f in rec["fiches"] if f["id"] not in ids]
        text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        tp.write_text(text)
        m["buildings"] = len(rec["buildings"])
        m["bytes"] = len(text)
        kp = c.OUT / "kinds" / f"{tid}.json"
        if kp.exists():
            k = json.loads(kp.read_text())
            for b in gone:
                k["buildings"].pop(b["id"], None)
            kp.write_text(json.dumps(k, ensure_ascii=False, separators=(",", ":")))
        lp = c.OUT / "lod" / f"{tid}.json"
        if lp.exists():
            lod = json.loads(lp.read_text())
            kept = [r for r in lod if r["r"] not in rings]
            if len(kept) != len(lod):
                lp.write_text(json.dumps(kept, ensure_ascii=False, separators=(",", ":")))
                m["lod"] = len(kept)
        n += len(gone)
    return n


CORNER_D = 3.2  # m : milieu de la vitrine d'angle, à cette distance du coin sur le mur voisin
CORNER_NEAR = 4.0  # m : un commerce à moins de cette distance d'un coin déborde sur le mur voisin
CORNER_MIN_WALL = 5.5  # m : longueur minimale du mur voisin (une vitrine y demande 4 à 5 m)


def corner_wrap(fi, b, sh, taken):
    """Boutique d'angle (D179) : `{wall, s}` de la vitrine du commerce `sh` sur le mur de rue voisin, ou None.
    Le commerce doit être à moins de CORNER_NEAR du coin de son mur ; l'angle entre les deux murs de 55° à 125° ; le mur voisin de rue, long d'au moins
    CORNER_MIN_WALL et sans autre vitrine à moins de 6 m (`taken` : mur -> abscisses déjà prises)."""
    W = fi["walls"]
    ring = b["ring"]
    n = len(ring) // 2
    w = W[sh["wall"]]
    if w.get("hole") is not None:
        return None
    L, s = w["length"], sh["s"]

    def vec(i, j):
        return ring[2 * j] - ring[2 * i], ring[2 * j + 1] - ring[2 * i + 1]

    for near, V, key in ((s <= CORNER_NEAR, w["a"], "b"), (L - s <= CORNER_NEAR, w["b"], "a")):
        if not near:
            continue
        adj = [(j, x) for j, x in enumerate(W) if j != sh["wall"] and x.get("hole") is None and x[key] == V]
        if not adj:
            continue
        j, x = adj[0]
        if x["role"] != "street" or x["length"] < CORNER_MIN_WALL:
            continue
        v1, v2 = (vec(V, (V + 1) % n), vec(V, (V - 1) % n)) if key == "b" else (vec(V, (V - 1) % n), vec(V, (V + 1) % n))
        cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (math.hypot(*v1) * math.hypot(*v2))
        if not 55 <= math.degrees(math.acos(max(-1, min(1, cos)))) <= 125:
            continue
        sa = CORNER_D if x["a"] == V else x["length"] - CORNER_D
        if any(abs(sa - t) < 6.0 for t in taken.get(j, [])):
            return None
        return {"wall": j, "s": round(sa, 2)}
    return None


def apply_shop(fi, m):
    """Commerce vu sur une photo, absent d'OpenStreetMap (D141) : la fiche devient « shop », avec son commerce au milieu du mur d'entrée,
    la couleur de sa devanture, sa devanture dessinée telle quelle (`devanture`) et l'étage d'après la photo (enduit, menuiseries, volets) ;
    `status` passe à « observed ». Rien d'autre ne change, et une deuxième passe donne la même fiche."""
    sh = m["shop"]
    g = fi["ground"]
    g["kind"] = "shop"
    g["shopfront"] = {"color": sh["color"], "glazing": "full"}
    kept = [x for x in g.get("shops", []) if x.get("osm") in sh.get("keepOsm", [])]  # commerces voisins gardés (identifiants OpenStreetMap)
    # `s` (facultatif) : abscisse du commerce quand sa devanture n'est pas au milieu du mur (D184)
    g["shops"] = [{"name": sh["name"], "kind": sh["kind"], "wall": m["wall"], "s": sh.get("s", round(fi["walls"][m["wall"]]["length"] / 2, 2))}] + kept
    if "terrace" in sh:  # terrasse d'après photo (D178) devant la devanture
        g["shops"][0]["terrace"] = sh["terrace"]
    g["devanture"] = sh["devanture"]
    if "corner" in sh:  # boutique d'angle (D179) : devanture du même commerce sur le mur voisin
        g["corner"] = sh["corner"]
    else:
        g.pop("corner", None)
    if "corners" in sh:  # façade courbe ou à plusieurs pans (D182) : devantures sur d'autres murs consécutifs
        g["corners"] = sh["corners"]
    else:
        g.pop("corners", None)
    apply_overrides(fi, sh.get("fiche", {}))
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
    manual_all = json.load(open(c.ROOT / "tools" / "data" / "manual.json"))
    manual = manual_all.get("fronts", {})
    fiches_manual = manual_all.get("fiches", {})
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
            if fi["id"] in B and fi["id"] in fiches_manual:
                apply_observed(fi, fiches_manual[fi["id"]])
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
        for i in [m.get("wall"), m.get("sign"), *m.get("also", []), *[o["wall"] for o in over.values() if o], (m.get("shop", {}).get("corner") or m.get("corner") or {}).get("wall"), *[q["wall"] for q in m.get("shop", {}).get("corners", [])]]:
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
        # D179 : boutique d'angle photographiée (`corner` d'une entrée sans `shop`) ; sinon, vitrine générique sur le mur voisin des commerces proches d'un coin.
        if m.get("corner") and not m.get("shop"):
            g["corner"] = m["corner"]
            chosen.append(m["corner"]["wall"])
        elif not m.get("shop"):
            g.pop("corner", None)
        taken = {}
        for sh in g.get("shops", []):
            sh.pop("corner", None)
            taken.setdefault(sh["wall"], []).append(sh["s"])
        if g["kind"] == "shop" and not g.get("devanture") and not g.get("corner") and not big:
            for sh in g.get("shops", []):
                if not sh.get("name") or sh.get("kind") in ("hotel", "guest_house"):
                    continue
                cw = corner_wrap(fi, b, sh, taken)
                if cw:
                    sh["corner"] = cw
                    taken.setdefault(cw["wall"], []).append(cw["s"])
                    chosen.append(cw["wall"])
                    stats["boutique d'angle (vitrine sur le mur voisin)"] += 1
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
    dropped_b = drop_buildings(world, set(manual_all.get("dropBuildings", [])))
    if dropped_b:
        stats["bâtiment retiré (D163)"] += dropped_b
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    for k, v in sorted(stats.items()):
        print(f"  {k} : {v}")
    print(f"{changed} tuiles réécrites")


if __name__ == "__main__":
    main()
