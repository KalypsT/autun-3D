"""Fabrique les données de la carte : images de fond par kilomètre (palette du jeu) et fichier de lieux avec catégories (D33).

Usage : python3 tools/data/build_map.py [--force]   (--force : retélécharge OpenStreetMap)
Entrées : public/data/world.json et public/data/tiles/*.json (couches de sol, emprises de bâtiments, monuments des fiches),
          OpenStreetMap par blocs de 500 m (noms de rues, commissariat, hôpital, écoles, commerces, parkings… ; .cache/shared/map_osm),
          tools/data/places_perso.json (lieux définis à la main).
Sorties : public/data/map/index.json, map/<id>.png (1 m par pixel) et map/<id>_2.png (2 m par pixel), un couple par kilomètre de la grille mondiale,
          map/overview.png (toute la zone à 4 m par pixel), map/places.json.
Étape autonome : elle ne relit pas les tuiles à chaque kilomètre (une seule lecture), n'écrit que dans public/data/map et ne touche
à aucune tuile. Pour la commune entière, elle s'applique telle quelle une fois les tuiles fabriquées.
"""

import json
import math
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry import box as sbox

import coast_lib as coast
import config as c

FORCE = "--force" in sys.argv
OUT = c.OUT / "map"
OSM_DIR = c.SHARED / "map_osm"
PERSO = Path(__file__).resolve().parent / "places_perso.json"

KM = 1000.0
RES = 1.0  # mètres par pixel des images de fond
SS = 2  # sur-échantillonnage du dessin (lissage des bords)
OVERVIEW_RES = 4.0
PALETTE_COLORS = 96

# --- Palette : celle du jeu (render/style.ts, thème « affiche »), éclaircie pour que la carte reste lisible -----------------
PAPER = "#f2e4c0"
COLORS = {
    "lawn": "#8cc494",
    "pitch": "#e58a62",
    "water": "#4fb0c6",
    "plaza_paving": "#d6b98a",
    "plaza_granite": "#b4b3ad",
    "plaza_pavers": "#9c9b99",
    "plaza_concrete": "#dcd6c8",
    "plaza_sett": "#c79a6b",
    "plaza_gravel": "#e3bf86",
    "plaza_asphalt": "#a3adaf",
    "road_asphalt": "#7d8a8e",
    "road_sett": "#c79a6b",
    "road_gravel": "#e3bf86",
    "road_paving": "#d6b98a",
    "walk": "#fbf3dc",
}
ORDER = ["lawn", "pitch", "water", "plaza_gravel", "plaza_paving", "plaza_granite", "plaza_pavers", "plaza_concrete", "plaza_sett", "plaza_asphalt", "road_gravel", "road_paving", "road_sett", "road_asphalt", "walk"]
BUILDING = "#e58d73"
BUILDING_EDGE = "#b9573f"
MONUMENT = "#d9472b"

# --- Catégories de lieux -------------------------------------------------------------------------------------------------------
# id : (libellé, groupe, pictogramme, couleur). Les groupes servent aux filtres de la carte.
CATEGORIES = {
    "police": ("Police, gendarmerie", "securite", "🚓", "#1f4a63"),
    "hopital": ("Hôpital, clinique", "sante", "🏥", "#d9472b"),
    "pharmacie": ("Pharmacie", "sante", "💊", "#2f7f6a"),
    "mairie": ("Mairie", "services", "🏛️", "#1f4a63"),
    "poste": ("Poste", "services", "✉️", "#f1b24a"),
    "ecole": ("École, collège, lycée", "services", "🏫", "#2f7f8f"),
    "gare": ("Gare", "services", "🚉", "#1f4a63"),
    "monument": ("Monument, site historique", "culture", "🏰", "#b9573f"),
    "culture": ("Musée, théâtre, bibliothèque", "culture", "🎭", "#7a4a8a"),
    "culte": ("Lieu de culte", "culture", "⛪", "#6b4a3a"),
    "parking": ("Parking", "stationnement", "🅿️", "#4a6a8a"),
    "parc": ("Parc, jardin", "parcs", "🌳", "#3f9a6f"),
    "commerce": ("Commerce nommé", "commerces", "🛍️", "#e0a030"),
    "perso": ("Lieu personnel", "perso", "⭐", "#d9472b"),
}
GROUPS = {
    "securite": "Sécurité", "sante": "Santé", "services": "Services", "culture": "Culture et patrimoine",
    "stationnement": "Stationnement", "parcs": "Parcs", "commerces": "Commerces", "perso": "Mes lieux",
}
# Catégories sans nom dans OSM : on garde le lieu avec le libellé de la catégorie.
ESSENTIAL = {"police", "hopital", "mairie", "poste", "gare"}

SHOP_AMENITIES = {"restaurant", "cafe", "bar", "pub", "fast_food", "bank", "ice_cream", "cinema"}
CULTURE_AMENITIES = {"theatre", "library", "arts_centre", "community_centre", "cinema"}
STREET_KINDS = ["primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian", "service", "footway", "path", "cycleway", "steps"]
# Rang d'importance d'une rue (le plus petit est le plus visible) pour choisir ce qu'on écrit à chaque niveau de zoom.
STREET_RANK = {"primary": 0, "secondary": 0, "tertiary": 1, "unclassified": 1, "residential": 2, "living_street": 2, "pedestrian": 2, "service": 3, "footway": 3, "path": 3, "cycleway": 3, "steps": 3}
OSM_KEEP = ("highway", "amenity", "leisure", "tourism", "historic", "railway", "public_transport", "shop", "building", "man_made", "office", "government", "emergency", "military")

to_l93 = Transformer.from_crs(4326, 2154, always_xy=True)


def local(lon, lat):
    x, y = to_l93.transform(lon, lat)
    return x - c.ORIGIN[0], y - c.ORIGIN[1]


def norm(s):
    return "".join(ch for ch in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(ch) != "Mn").strip()


# --- Téléchargement OpenStreetMap -----------------------------------------------------------------------------------------------
def fetch_osm(zone):
    """Blocs de 500 m (alignés sur le Lambert-93) couvrant la zone ; chaque bloc est gardé tel quel dans .cache/shared/map_osm."""
    import fetch

    ox, oy = c.ORIGIN
    bx0, bx1 = math.floor((zone[0] + ox) / fetch.OSM_BLOCK), math.floor((zone[2] + ox - 1e-6) / fetch.OSM_BLOCK)
    by0, by1 = math.floor((zone[1] + oy) / fetch.OSM_BLOCK), math.floor((zone[3] + oy - 1e-6) / fetch.OSM_BLOCK)
    elements = {}
    for by in range(by0, by1 + 1):
        for bx in range(bx0, bx1 + 1):
            part = OSM_DIR / f"{bx}_{by}.json"
            if FORCE or not part.exists():
                lat0, lon0, lat1, lon1 = fetch.osm_bounds(bx, by)
                els = fetch.get("https://api.openstreetmap.org/api/0.6/map.json", params={"bbox": f"{lon0},{lat0},{lon1},{lat1}"}).json()["elements"]
                nodes = {e["id"]: (e["lat"], e["lon"]) for e in els if e["type"] == "node"}
                out = []
                for e in els:
                    all_tags = e.get("tags", {})
                    if not any(k in all_tags for k in OSM_KEEP) and not re.search("gendarmerie|commissariat|police", all_tags.get("name", "").lower()):
                        continue
                    tags = {k: v for k, v in all_tags.items() if k in OSM_KEEP or k in ("name", "religion", "parking", "capacity", "ref:mhs")}
                    if e["type"] == "node":
                        out.append({"type": "node", "id": e["id"], "lat": e["lat"], "lon": e["lon"], "tags": tags})
                    elif e["type"] == "way":
                        geom = [[nodes[n][1], nodes[n][0]] for n in e["nodes"] if n in nodes]
                        out.append({"type": "way", "id": e["id"], "tags": tags, "geom": geom})
                part.parent.mkdir(parents=True, exist_ok=True)
                part.write_text(json.dumps({"elements": out}, ensure_ascii=False))
                print(f"  osm {bx},{by} : {len(out)} éléments")
            for e in json.loads(part.read_text())["elements"]:
                elements[(e["type"], e["id"])] = e
    return list(elements.values())


# --- Classement des éléments OSM -----------------------------------------------------------------------------------------------
def classify(tags, is_area):
    """(catégorie, sous-type) d'un élément OSM, ou None."""
    amenity, shop = tags.get("amenity"), tags.get("shop")
    label = norm(tags.get("name", ""))
    if amenity == "police" or tags.get("government") == "police" or any(w in label for w in ("gendarmerie", "commissariat", "police municipale", "hotel de police")):
        return "police", None
    if amenity in ("hospital", "clinic"):
        return "hopital", amenity
    if amenity == "pharmacy":
        return "pharmacie", None
    if amenity == "townhall":
        return "mairie", None
    if amenity == "post_office":
        return "poste", None
    if amenity in ("school", "college", "university"):
        return "ecole", amenity
    if tags.get("railway") in ("station", "halt") or amenity == "bus_station":
        return "gare", None
    if amenity == "place_of_worship":
        return "culte", tags.get("religion")
    if tags.get("tourism") in ("museum", "gallery") or amenity in CULTURE_AMENITIES - {"cinema"}:
        return "culture", tags.get("tourism") or amenity
    if tags.get("historic") and tags["historic"] not in ("yes", "boundary_stone", "wayside_cross", "wayside_shrine", "tree_shrine"):
        return "monument", tags["historic"]
    if tags.get("tourism") in ("attraction", "viewpoint"):
        return "monument", tags["tourism"]
    if amenity == "parking":
        return "parking", tags.get("parking")
    if tags.get("leisure") in ("park", "garden", "common") and is_area:
        return "parc", tags["leisure"]
    if shop and shop not in ("vacant", "yes"):
        return "commerce", shop
    if amenity in SHOP_AMENITIES:
        return "commerce", amenity
    return None


def way_polygon(e):
    pts = [local(lon, lat) for lon, lat in e["geom"]]
    if len(pts) >= 4 and pts[0] == pts[-1]:
        p = Polygon(pts)
        if p.is_valid and p.area > 0:
            return p
    return None


def osm_places_and_streets(elements, zone):
    inside = lambda x, y: zone[0] <= x <= zone[2] and zone[1] <= y <= zone[3]
    places, ways = [], {}
    for e in elements:
        tags = e["tags"]
        if e["type"] == "node":
            x, y = local(e["lon"], e["lat"])
            area = 0.0
        else:
            if "highway" in tags and tags.get("name"):
                ways.setdefault(tags["name"], []).append(e)
            poly = way_polygon(e)
            if not poly:
                if len(e["geom"]) < 1:
                    continue
                # Chemin ouvert ou réduit à un point : on prend son point médian.
                x, y = local(*e["geom"][len(e["geom"]) // 2])
                area = 0.0
            else:
                x, y = poly.representative_point().x, poly.representative_point().y
                area = poly.area
        if "highway" in tags and "amenity" not in tags:
            continue
        found = classify(tags, area > 0)
        if not found or not inside(x, y):
            continue
        cat, sub = found
        name = tags.get("name")
        if not name:
            if cat not in ESSENTIAL and cat not in ("parking", "parc"):
                continue
            name = {"parking": "Parking", "parc": "Parc"}.get(cat) or CATEGORIES[cat][0]
        if cat == "parking" and not (tags.get("name") or area >= 3000):
            continue
        if cat == "parc" and area < 1500:
            continue
        places.append({"id": f"osm:{e['type']}/{e['id']}", "cat": cat, "name": name, "x": round(x, 1), "y": round(y, 1), "kind": sub, "area": area})
    return places, ways


def streets_from_ways(ways, zone):
    out = []
    for name, group in sorted(ways.items()):
        lines, kinds = [], []
        for e in group:
            kind = e["tags"]["highway"]
            if kind not in STREET_RANK:
                continue
            pts = [local(lon, lat) for lon, lat in e["geom"]]
            if len(pts) < 2:
                continue
            line = LineString(pts)
            if not line.intersects(Polygon([(zone[0], zone[1]), (zone[2], zone[1]), (zone[2], zone[3]), (zone[0], zone[3])])):
                continue
            for part in coast.clip_line([v for p in line.simplify(1.5).coords for v in p]):  # rien en mer (D105)
                lines.append([round(v, 1) for v in part])
                kinds.append(kind)
        if not lines:
            continue
        kind = min(kinds, key=lambda k: STREET_RANK[k])
        out.append({"name": name, "kind": kind, "rank": STREET_RANK[kind], "lines": lines})
    return out


# --- Lecture des tuiles --------------------------------------------------------------------------------------------------------
def read_tiles(world):
    layers = {k: [] for k in ORDER}
    buildings, monuments = [], []
    for t in world["tiles"]:
        d = json.loads((c.OUT / "tiles" / f"{t['id']}.json").read_text())
        for name, polys in d["ground"].items():
            if name in layers:
                for rings in polys:
                    layers[name].append(rings)
        mon = {f["id"]: f["monument"] for f in d["fiches"] if f.get("monument")}
        for b in d["buildings"]:
            ring = [*b["ring"]]
            buildings.append(([ring, *b["holes"]], b["id"] in mon))
            if b["id"] in mon:
                monuments.append((mon[b["id"]]["name"], mon[b["id"]].get("mhs"), Polygon(list(zip(ring[0::2], ring[1::2]))).representative_point()))
    return layers, buildings, monuments


def bbox_of(rings):
    ring = rings[0]
    return min(ring[0::2]), min(ring[1::2]), max(ring[0::2]), max(ring[1::2])


def monument_places(monuments, osm_places):
    """Un lieu par monument et par groupe de bâtiments voisins (< 150 m) ; ignoré si un lieu OSM de même nom est à moins de 250 m."""
    by_name = {}
    for name, mhs, pt in monuments:
        by_name.setdefault(name, []).append((mhs, pt))
    known = [(norm(p["name"]), p) for p in osm_places]
    out = []
    for name, items in sorted(by_name.items()):
        if "centre hospitalier" in norm(name):
            continue  # l'hôpital vient d'OSM
        groups = []
        for mhs, pt in items:
            for g in groups:
                if any(pt.distance(q) < 150 for _, q in g):
                    g.append((mhs, pt))
                    break
            else:
                groups.append([(mhs, pt)])
        for k, g in enumerate(groups):
            x = sum(p.x for _, p in g) / len(g)
            y = sum(p.y for _, p in g) / len(g)
            n = norm(name)
            twin = next((p for nm, p in known if nm == n and math.hypot(p["x"] - x, p["y"] - y) < 250), None)
            mhs = next((m for m, _ in g if m), None)
            if twin:
                if mhs:
                    twin["mhs"] = mhs
                continue
            out.append({"id": f"mh:{mhs or norm(name).replace(' ', '-')}:{k}", "cat": "monument", "name": name, "x": round(x, 1), "y": round(y, 1), "kind": "mhs" if mhs else None, **({"mhs": mhs} if mhs else {})})
    return out


def dedupe(places):
    """Deux lieux de même catégorie et de même nom à moins de 120 m n'en font qu'un (bâtiments d'un même établissement)."""
    places = sorted(places, key=lambda p: (-p.get("area", 0), p["id"]))
    kept = []
    for p in places:
        n = norm(p["name"])
        if any(q["cat"] == p["cat"] and norm(q["name"]) == n and math.hypot(q["x"] - p["x"], q["y"] - p["y"]) < 120 for q in kept):
            continue
        kept.append(p)
    return kept


def perso_places(zone):
    if not PERSO.exists():
        return []
    out = []
    for p in json.loads(PERSO.read_text()).get("places", []):
        if not (zone[0] <= p["x"] <= zone[2] and zone[1] <= p["y"] <= zone[3]):
            print(f"  lieu perso hors zone ignoré : {p.get('name')}")
            continue
        out.append({"id": f"perso:{p['id']}", "cat": "perso", "name": p["name"], "x": round(p["x"], 1), "y": round(p["y"], 1), "kind": None, **{k: p[k] for k in ("note", "story") if p.get(k)}})
    return out


# --- Dessin des images de fond --------------------------------------------------------------------------------------------------
def rgb(h):
    return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def fill(img, rings, color, ox, oy, scale):
    """Remplit un polygone à trous (anneaux aplatis, coordonnées locales) : un masque par polygone, collé en une fois."""
    xs, ys = rings[0][0::2], rings[0][1::2]
    px0, px1 = math.floor((min(xs) - ox) * scale) - 1, math.ceil((max(xs) - ox) * scale) + 1
    py0, py1 = math.floor((oy - max(ys)) * scale) - 1, math.ceil((oy - min(ys)) * scale) + 1
    w, h = px1 - px0, py1 - py0
    if w <= 0 or h <= 0 or w > 20000 or h > 20000:
        return
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    for k, ring in enumerate(rings):
        pts = [((x - ox) * scale - px0, (oy - y) * scale - py0) for x, y in zip(ring[0::2], ring[1::2])]
        if len(pts) >= 3:
            md.polygon(pts, fill=255 if k == 0 else 0)
    img.paste(color, (px0, py0), mask)


def outline(draw, ring, color, ox, oy, scale):
    pts = [((x - ox) * scale, (oy - y) * scale) for x, y in zip(ring[0::2], ring[1::2])]
    if len(pts) >= 3:
        draw.line([*pts, pts[0]], fill=color, width=1)


def render_km(x0, y1, layers_idx, buildings_idx):
    """Image RVB de 1 km × 1 km (sur-échantillonnée) : x0 = bord ouest, y1 = bord nord."""
    scale = SS / RES
    size = int(KM / RES * SS)
    img = Image.new("RGB", (size, size), rgb(PAPER))
    # La mer autour du monde (D105), sous tout le reste.
    sea = sbox(x0 - 4, y1 - KM - 4, x0 + KM + 4, y1 + 4).difference(coast.land())
    for g in getattr(sea, "geoms", [sea]):
        if g.geom_type == "Polygon" and g.area > 1:
            fill(img, [[v for p in list(r.coords)[:-1] for v in p] for r in (g.exterior, *g.interiors)], rgb(COLORS["water"]), x0, y1, scale)
    box = (x0 - 30, y1 - KM - 30, x0 + KM + 30, y1 + 30)
    hit = lambda bb: bb[2] >= box[0] and bb[0] <= box[2] and bb[3] >= box[1] and bb[1] <= box[3]
    for name in ORDER:
        col = rgb(COLORS[name])
        for bb, rings in layers_idx[name]:
            if hit(bb):
                fill(img, rings, col, x0, y1, scale)
    draw = ImageDraw.Draw(img)
    for bb, rings, mon in buildings_idx:
        if hit(bb):
            fill(img, rings, rgb(MONUMENT if mon else BUILDING), x0, y1, scale)
            outline(draw, rings[0], rgb(BUILDING_EDGE), x0, y1, scale)
    return img


def build_images(world, layers, buildings):
    layers_idx = {k: [(bbox_of(r), r) for r in v] for k, v in layers.items()}
    buildings_idx = [(bbox_of(r), r, m) for r, m in buildings]
    gx, gy = world["gridOrigin"]
    kms = sorted({(t["col"] // c.SUPER, t["row"] // c.SUPER) for t in world["tiles"]})
    OUT.mkdir(parents=True, exist_ok=True)
    shared = None
    images, smalls = [], {}
    for i, j in kms:
        x0, y1 = gx + i * KM, gy + (j + 1) * KM
        full = render_km(x0, y1, layers_idx, buildings_idx)
        flat = full.resize((int(KM / RES), int(KM / RES)), Image.BOX)
        if shared is None:
            shared = flat.quantize(colors=PALETTE_COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        name = f"s{i}_{j}"
        files = {}
        # Deux niveaux par kilomètre : 1 m par pixel (zoom) et 2 m par pixel (minimap, carte dézoomée) ; la minimap n'a ainsi
        # jamais à décoder les images fines. Même palette partout, pour que les couleurs ne changent pas d'une image à l'autre.
        for res in (RES, 2 * RES):
            n = int(KM / res)
            level = flat if res == RES else full.resize((n, n), Image.BOX)
            file = f"{name}.png" if res == RES else f"{name}_2.png"
            level.quantize(palette=shared, dither=Image.Dither.NONE).save(OUT / file, optimize=True)
            files[f"{res:g}"] = file
        images.append({"id": name, "x0": x0, "y1": y1, "files": files})
        smalls[(i, j)] = full.resize((int(KM / OVERVIEW_RES),) * 2, Image.BOX)
        print(f"  {name} : {', '.join(f'{(OUT / f).stat().st_size / 1024:.0f} ko' for f in files.values())}")
    i0, i1 = min(k[0] for k in kms), max(k[0] for k in kms)
    j0, j1 = min(k[1] for k in kms), max(k[1] for k in kms)
    s = int(KM / OVERVIEW_RES)
    over = Image.new("RGB", ((i1 - i0 + 1) * s, (j1 - j0 + 1) * s), rgb(COLORS["water"]))
    for (i, j), im in smalls.items():
        over.paste(im, ((i - i0) * s, (j1 - j) * s))
    assert shared is not None
    over.quantize(palette=shared, dither=Image.Dither.NONE).save(OUT / "overview.png", optimize=True)
    overview = {"file": "overview.png", "x0": gx + i0 * KM, "y1": gy + (j1 + 1) * KM, "res": OVERVIEW_RES, "w": over.width, "h": over.height}
    print(f"  overview : {(OUT / 'overview.png').stat().st_size / 1024:.0f} ko")
    return images, overview


def main():
    world = json.loads((c.OUT / "world.json").read_text())
    zone = world["zone"]
    print("== lecture des tuiles")
    layers, buildings, monuments = read_tiles(world)
    print(f"  {sum(len(v) for v in layers.values())} polygones de sol, {len(buildings)} bâtiments, {len(monuments)} fiches de monument")
    print("== OpenStreetMap")
    elements = fetch_osm(zone)
    osm_places, ways = osm_places_and_streets(elements, zone)
    places = dedupe(osm_places)
    places += monument_places(monuments, places)
    places += perso_places(zone)
    places = [p for p in places if coast.on_land(p["x"], p["y"])]
    for p in places:
        p.pop("area", None)
        if p.get("kind") is None:
            p.pop("kind", None)
    places.sort(key=lambda p: (p["cat"], p["name"], p["id"]))
    streets = streets_from_ways(ways, zone)
    print(f"  {len(places)} lieux, {len(streets)} rues nommées")
    print("== images")
    images, overview = build_images(world, layers, buildings)
    (OUT / "index.json").write_text(json.dumps({
        "version": 1, "size": KM, "levels": [RES, 2 * RES], "zone": zone, "images": images, "overview": overview,
    }, ensure_ascii=False, indent=1))
    (OUT / "places.json").write_text(json.dumps({
        "version": 1,
        "attribution": "© contributeurs OpenStreetMap (ODbL) · IGN (BD TOPO®)",
        "groups": [{"id": g, "label": l} for g, l in GROUPS.items()],
        "categories": [{"id": k, "label": v[0], "group": v[1], "glyph": v[2], "color": v[3]} for k, v in CATEGORIES.items()],
        "places": places,
        "streets": streets,
    }, ensure_ascii=False, separators=(",", ":")))
    size = sum(f.stat().st_size for f in OUT.iterdir())
    print(f"ok : {size / 1e6:.2f} Mo dans {OUT.relative_to(c.ROOT)}")
    cats = {}
    for p in places:
        cats[p["cat"]] = cats.get(p["cat"], 0) + 1
    print("  lieux par catégorie :", ", ".join(f"{k} {v}" for k, v in sorted(cats.items())))


if __name__ == "__main__":
    main()
