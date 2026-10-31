"""Abris à chariots des grandes surfaces (D121) : de petits bâtiments BD TOPO posés sur les parkings, dessinés en abris ouverts.

Usage : python3 tools/data/build_carts.py       (après build_kinds.py, qui réécrit public/data/kinds ; puis relancer celle-ci)
Entrées : public/data/world.json, tiles/*.json (emprises), kinds/*.json (grandes surfaces), parkings OpenStreetMap (.cache/shared/raw/osm,
          les blocs téléchargés par fetch.py ou build_shop_fronts.py).
Sortie : kinds/<tuile>.json, type `cart` pour chaque abri, avec `open` : milieu du petit côté ouvert (vers la grande surface la plus proche) ;
          et les types imposés à la main d'après photo (`kinds` de tools/data/manual.json : la marquise de l'entrée d'E.Leclerc, D122 ; la pharmacie et l'abri à chariots du Lidl, D143).

Un abri : emprise rectangulaire (≥ 85 % de son rectangle orienté), 1,8 à 3,2 m sur 6 à 12 m, sur un parking OpenStreetMap (à moins de 3 m)
et à moins de 60 m d'une grande surface, sans y être collé. Règle prudente : les six abris d'E.Leclerc (2,3 × 8,2 m, photo de l'utilisateur) ;
les petites boîtes de 3 × 4,8 m près de Lidl et de Biocoop, plus loin et plus courtes, restent des bâtiments.
"""

import glob
import json
import math
from collections import Counter

from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

import config as c

KINDS = c.OUT / "kinds"
to_l93 = Transformer.from_crs(4326, 2154, always_xy=True)

SHORT = (1.8, 3.2)
LONG = (6.0, 12.0)
NEAR_STORE = 60.0
# Types qu'un abri peut remplacer : rien, ou un type générique tiré de la seule nature BD TOPO.
REPLACEABLE = {None, "annex", "industrial", "cart"}


def local(g):
    x, y = to_l93.transform(g["lon"], g["lat"])
    return x - c.ORIGIN[0], y - c.ORIGIN[1]


def main():
    world = json.load(open(c.OUT / "world.json"))
    parks = []
    for f in glob.glob(str(c.SHARED / "raw" / "osm" / "*.json")):
        for e in json.load(open(f))["elements"]:
            if e["type"] == "way" and e.get("tags", {}).get("amenity") == "parking" and len(e.get("geometry", [])) >= 4:
                p = Polygon([local(g) for g in e["geometry"]])
                parks.append(p if p.is_valid else p.buffer(0))
    if not parks:
        raise SystemExit("aucun parking OpenStreetMap : lancer d'abord build_shop_fronts.py (ou fetch.py --only osm)")
    parking = unary_union(parks)

    kinds = {}
    for f in glob.glob(str(KINDS / "*.json")):
        tid = f.split("/")[-1][:-5]
        if tid != "index":
            kinds[tid] = json.load(open(f))
    tiles = {m["id"]: json.loads((c.OUT / "tiles" / f"{m['id']}.json").read_text()) for m in world["tiles"] if m.get("buildings")}
    stores = []
    for tid, k in kinds.items():
        B = {b["id"]: b for b in tiles.get(tid, {}).get("buildings", [])}
        for bid, e in k["buildings"].items():
            if e["k"] == "retail" and bid in B:
                r = B[bid]["ring"]
                stores.append(Polygon([(r[i], r[i + 1]) for i in range(0, len(r), 2)]))
    store_tree = STRtree(stores)

    found = {}
    for tid, rec in tiles.items():
        for b in rec["buildings"]:
            r = b["ring"]
            poly = Polygon([(r[i], r[i + 1]) for i in range(0, len(r), 2)])
            if not 8 < poly.area < 45:
                continue
            rect = list(poly.minimum_rotated_rectangle.exterior.coords)[:4]
            sides = [math.dist(rect[i], rect[(i + 1) % 4]) for i in range(4)]
            short, long_ = min(sides), max(sides)
            if not (SHORT[0] <= short <= SHORT[1] and LONG[0] <= long_ <= LONG[1] and poly.area / (short * long_) > 0.85):
                continue
            if parking.distance(poly) > 3.0:
                continue
            near = [stores[int(i)] for i in store_tree.query(poly.buffer(NEAR_STORE))]
            d = min((s.distance(poly) for s in near), default=math.inf)
            if not 2.0 < d <= NEAR_STORE:
                continue
            store = min(near, key=lambda s: s.distance(poly))
            # Les deux petits côtés : l'ouvert est le plus proche de la grande surface.
            i0 = 0 if sides[0] < sides[1] else 1
            ends = [((rect[k][0] + rect[(k + 1) % 4][0]) / 2, (rect[k][1] + rect[(k + 1) % 4][1]) / 2) for k in (i0, i0 + 2)]
            open_end = min(ends, key=lambda p: store.distance(Point(p)))
            found[(tid, b["id"])] = [round(open_end[0], 2), round(open_end[1], 2)]

    before = Counter(e["k"] for k in kinds.values() for e in k["buildings"].values())
    # Types imposés à la main (d'après photo) : ils l'emportent sur la détection et sur build_kinds.py.
    manual = json.load(open(c.ROOT / "tools" / "data" / "manual.json")).get("kinds", {})
    owner = {b["id"]: tid for tid, rec in tiles.items() for b in rec["buildings"] if b["id"] in manual}
    found = {key: end for key, end in found.items() if key[1] not in manual}

    changed = set()
    for bid, entry in manual.items():
        tid = owner.get(bid)
        if tid is None:
            print(f"  correction à la main : {bid} absent des tuiles")
            continue
        e = {k: v for k, v in entry.items() if k != "photo"}
        k = kinds.setdefault(tid, {"v": 1, "buildings": {}, "sites": []})
        if k["buildings"].get(bid) != e:
            k["buildings"][bid] = e
            k["buildings"] = dict(sorted(k["buildings"].items()))
            changed.add(tid)
    for tid, k in kinds.items():
        for bid in [bid for bid, e in k["buildings"].items() if e["k"] == "cart" and (tid, bid) not in found and bid not in manual]:
            del k["buildings"][bid]
            changed.add(tid)
    for (tid, bid), end in found.items():
        k = kinds.setdefault(tid, {"v": 1, "buildings": {}, "sites": []})
        if k["buildings"].get(bid, {}).get("k") not in REPLACEABLE:
            continue
        e = {"k": "cart", "open": end}
        if k["buildings"].get(bid) != e:
            k["buildings"][bid] = e
            k["buildings"] = dict(sorted(k["buildings"].items()))
            changed.add(tid)
    for tid in changed:
        (KINDS / f"{tid}.json").write_text(json.dumps(kinds[tid], ensure_ascii=False, separators=(",", ":")))
    index = json.load(open(KINDS / "index.json"))
    tiles_idx = sorted(set(index["tiles"]) | {t for t, k in kinds.items() if k["buildings"] or k["sites"]})
    count = sum(1 for k in kinds.values() for e in k["buildings"].values() if e["k"] == "cart")
    # Statistiques de build_kinds.py (qui compte aussi la marge hors des tuiles), corrigées des seuls changements faits ici.
    stats = Counter(index["stats"]["buildings"])
    stats.subtract(before)
    stats.update(e["k"] for k in kinds.values() for e in k["buildings"].values())
    index["stats"]["buildings"] = dict(sorted((k, v) for k, v in stats.items() if v > 0))
    index["tiles"] = tiles_idx
    (KINDS / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    print(f"{count} abris à chariots, {len(manual)} types imposés à la main ; {len(changed)} fichiers de tuile réécrits")


if __name__ == "__main__":
    main()
