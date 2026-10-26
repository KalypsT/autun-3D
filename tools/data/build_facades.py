"""Fiches façade : une fiche JSON par bâtiment (docs/facade-fiche.schema.json).

Usage : python3 tools/data/build_facades.py

Sans photo (Panoramax est vide sur la zone), toutes les fiches sont « estimées » :
  - époque et matériaux : BDNB puis BD TOPO, à défaut typologie du quartier (secteur sauvegardé) ;
  - niveaux : hauteur LiDAR de l'égout, recoupée avec BDNB / BD TOPO ;
  - commerces et enseignes : nœuds OpenStreetMap placés sur le mur de rue le plus proche ;
  - rôle de chaque mur (rue, cour, mitoyen) : voisinage géométrique et carte des sols ;
  - tirages (couleurs, rythme, volets) déterministes : graine = identifiant du bâtiment.
Quand des photos existeront, on remplace la fiche (status « observed » + références).

Sortie : public/data/facades.json
"""

import json
import math
import random
import zlib

import numpy as np
import shapely
from jsonschema import Draft202012Validator
from pyproj import Transformer
from shapely.affinity import translate
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

import common
import config as c

to_l93 = Transformer.from_crs(4326, 2154, always_xy=True)

# --------------------------------------------------------------------------- palettes
PLASTER = ["#d9c9a8", "#cfb08a", "#d8bfa3", "#c9c4b8", "#e3d9c0", "#bda88a", "#d4c3a0", "#cdb89a"]
PLASTER_MODERN = ["#e6e0d0", "#d8d2c4", "#ebe5d6", "#cfc9bb", "#e0d4bc"]
ASHLAR = ["#cdbf9f", "#d6cbb0", "#c2b79c", "#d2c4a4"]
SHUTTERS = {"#7d8a8c": 3, "#5b6b5a": 3, "#e8e4d8": 3, "#6b4a35": 3, "#4f6b86": 2, "#8a2f2b": 1}
DOORS = ["#5b6b5a", "#6b4a35", "#2f3a45", "#7a2f2a", "#4f6b86", "#3d3a36"]
SHOPFRONTS = ["#2f4a3a", "#222222", "#6a2a2a", "#27374d", "#8a7a5a", "#3d3a36", "#5a3a2a"]
FRAME_OLD = "#5a4632"
FRAME_WHITE = "#e9e4d6"
PLINTH_STONE = "#a8a193"

PUBLIC_GROUND = {1, 2, 3, 4, 7}  # asphalte, trottoir, pavés, gravier, dalles
SHOP_AMENITIES = {"restaurant", "cafe", "bar", "fast_food", "bank", "pharmacy", "post_office", "cinema", "pub", "ice_cream"}
MONUMENT_NAMES = {
    "Mairie d'Autun": ("classical", "Hôtel de ville"),
    "Théâtre": ("xix", "Théâtre municipal"),
    "Église Notre-Dame": ("xix", "Église Notre-Dame"),
    "Lycée Bonaparte": ("classical", "Lycée Bonaparte"),
    "Hôtel d'Orsenne": ("classical", "Hôtel d'Orsenne"),
    "Hôtel Saint-Louis": ("classical", "Hôtel Saint-Louis"),
    "Bibliothèque Bussy-Rabutin": ("classical", "Bibliothèque Bussy-Rabutin"),
    "Hôtel de Ganay": ("classical", "Hôtel de Ganay"),
}


def pick(rng, weighted):
    items = list(weighted.items()) if isinstance(weighted, dict) else [(k, 1) for k in weighted]
    return rng.choices([k for k, _ in items], [w for _, w in items])[0]


def era_of(year):
    if year is None:
        return None
    for limit, era in ((1650, "medieval"), (1790, "classical"), (1914, "xix"), (1945, "interwar"), (1975, "postwar")):
        if year < limit:
            return era
    return "contemporary"


def local(lon, lat):
    x, y = to_l93.transform(lon, lat)
    return x - c.ORIGIN[0], y - c.ORIGIN[1]


def main():
    buildings = json.load(open(c.CACHE / "work" / "buildings_clean.json"))
    streets = json.load(open(c.OUT / "streets.json"))
    osm = json.load(open(c.CACHE / "raw" / "osm.json"))["elements"]
    bdnb_rows = json.load(open(c.CACHE / "raw" / "bdnb.json"))
    mnt = common.raster("MNT") - c.ORIGIN_Z
    ground_idx = np.load(c.CACHE / "work" / "ground.npy")

    def ground_class(x, y):
        col = int((x + c.ORIGIN[0] - c.GRID_X0) / c.RES)
        row = int((c.GRID_Y1 - (y + c.ORIGIN[1])) / c.RES)
        if 0 <= row < ground_idx.shape[0] and 0 <= col < ground_idx.shape[1]:
            return int(ground_idx[row, col])
        return 0

    def terrain_z(x, y):
        col, row = common.world_to_pixel(x + c.ORIGIN[0], y + c.ORIGIN[1])
        return float(mnt[min(max(int(row), 0), mnt.shape[0] - 1), min(max(int(col), 0), mnt.shape[1] - 1)])

    polys = []
    for b in buildings:
        ring = np.array(b["ring"]).reshape(-1, 2)
        holes = [np.array(h).reshape(-1, 2) for h in b["holes"]]
        polys.append(Polygon(ring, holes))
    tree = STRtree(polys)

    # --- BDNB : groupe de plus grand recouvrement avec chaque emprise --------------------
    bdnb_polys = []
    for r in bdnb_rows:
        g = r.get("geom_groupe")
        bdnb_polys.append(translate(shapely.geometry.shape(g), -c.ORIGIN[0], -c.ORIGIN[1]) if g else None)
    bdnb_tree = STRtree([g for g in bdnb_polys if g is not None])
    bdnb_valid = [i for i, g in enumerate(bdnb_polys) if g is not None]

    def bdnb_for(poly):
        best, area = None, 0.0
        for j in bdnb_tree.query(poly):
            g = bdnb_polys[bdnb_valid[int(j)]]
            a = g.intersection(poly).area
            if a > area and a > 0.4 * min(poly.area, g.area):
                best, area = bdnb_rows[bdnb_valid[int(j)]], a
        return best

    # --- Monuments : éléments OSM nommés / classés -------------------------------------
    monuments = {}  # index du bâtiment -> (nom, mhs, ère)
    for e in osm:
        t = e.get("tags", {})
        name = t.get("name")
        if not name or not (name in MONUMENT_NAMES or t.get("ref:mhs")):
            continue
        if e["type"] == "node":
            geom = Point(*local(e["lon"], e["lat"]))
        elif e["type"] == "way" and "geometry" in e and len(e["geometry"]) >= 4:
            geom = Polygon([local(g["lon"], g["lat"]) for g in e["geometry"]])
        else:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        cand = [int(i) for i in tree.query(geom)]
        cand = [i for i in cand if polys[i].intersects(geom)] or (
            [min(range(len(polys)), key=lambda i: polys[i].distance(geom))] if polys[min(range(len(polys)), key=lambda i: polys[i].distance(geom))].distance(geom) < 4 else [])
        # Pour un polygone : tous les bâtiments qu'il recouvre à plus de moitié ; pour un point : celui qui le contient.
        for i in cand:
            if geom.geom_type == "Polygon" and polys[i].intersection(geom).area < 0.5 * polys[i].area:
                continue
            era = MONUMENT_NAMES.get(name, ("classical", name))[0]
            monuments[i] = (MONUMENT_NAMES.get(name, (era, name))[1], t.get("ref:mhs"), era)

    # --- Commerces OSM ----------------------------------------------------------------
    shop_nodes = []
    for e in osm:
        t = e.get("tags", {})
        if e["type"] != "node":
            continue
        kind = t.get("shop") or (t.get("amenity") if t.get("amenity") in SHOP_AMENITIES else None)
        if kind:
            shop_nodes.append((e["id"], t.get("name"), kind if t.get("shop") is None else t["shop"], Point(*local(e["lon"], e["lat"]))))

    shop_tree = STRtree([sn[3] for sn in shop_nodes]) if shop_nodes else None
    street_lines = [LineString(np.array(s["pts"]).reshape(-1, 2)) for s in streets if s["kind"] != "steps"]
    street_tree = STRtree(street_lines)
    all_union_tree = tree

    def near_street(p, d):
        return any(street_lines[int(i)].distance(p) <= d for i in street_tree.query(p.buffer(d)))

    fiches, stats = [], {"era": {}, "role": {}, "shops": 0, "monuments": 0, "bdnb": 0, "levels_from": {"bdnb": 0, "bd": 0, "lidar": 0}}
    for bi, b in enumerate(buildings):
        rng = random.Random(zlib.crc32(b["id"].encode()))
        poly = polys[bi]
        ring = np.array(b["ring"]).reshape(-1, 2)
        n = len(ring)
        bd, bn = b["bd"], bdnb_for(poly)
        stats["bdnb"] += bn is not None
        year = (bn or {}).get("annee_construction") or bd.get("year")
        mon = monuments.get(bi)
        era = (mon[2] if mon else None) or era_of(year)
        guessed = era is None
        usage = (bn or {}).get("usage_principal_bdnb_open") or bd.get("use") or ""
        mat_wall = ((bn or {}).get("mat_mur_txt") or "").upper()
        mat_roof = ((bn or {}).get("mat_toit_txt") or "").upper()

        # --- rôle de chaque arête -----------------------------------------------------
        others = [polys[int(i)] for i in tree.query(poly.buffer(1.0)) if int(i) != bi]
        other_union = unary_union(others) if others else None
        roles = []
        for i in range(n):
            p, q = ring[i], ring[(i + 1) % n]
            L = math.hypot(*(q - p))
            m = (p + q) / 2
            nrm = np.array([q[1] - p[1], -(q[0] - p[0])]) / max(L, 1e-9)
            p1, p2 = Point(*(m + 0.6 * nrm)), Point(*(m + 2.5 * nrm))
            if other_union is not None and other_union.distance(Point(*m)) < 0.35:
                role = "party"
            elif ground_class(*(m + 2.5 * nrm)) in PUBLIC_GROUND or ground_class(*(m + 1.0 * nrm)) in PUBLIC_GROUND or near_street(p2, 8.0):
                role = "street"
            else:
                role = "court"
            roles.append((role, L))
        # Les arêtes très courtes prennent le rôle de la précédente.
        for i in range(n):
            if roles[i][1] < 1.2:
                roles[i] = (roles[i - 1][0], roles[i][1])

        # --- séries de murs : arêtes consécutives presque alignées et de même rôle ------
        runs = []
        i = 0
        edges = list(range(n))

        def direction(k):
            d = ring[(k + 1) % n] - ring[k]
            return math.atan2(d[1], d[0])

        start = 0
        # On démarre sur un angle marqué pour ne pas couper une série au milieu.
        turn = [abs(((direction(k) - direction(k - 1) + math.pi) % (2 * math.pi)) - math.pi) for k in range(n)]
        if max(turn) > math.radians(20):
            start = int(np.argmax(turn))
        order = [(start + k) % n for k in range(n)]
        cur = None
        for k in order:
            role, L = roles[k]
            if cur and roles[cur["edges"][-1]][0] == role and abs(((direction(k) - direction(cur["edges"][0]) + math.pi) % (2 * math.pi)) - math.pi) < math.radians(18) and abs(((direction(k) - direction(cur["edges"][-1]) + math.pi) % (2 * math.pi)) - math.pi) < math.radians(8):
                cur["edges"].append(k)
            else:
                cur = {"edges": [k]}
                runs.append(cur)
        walls = []
        for run in runs:
            ks = run["edges"]
            a, bb = ks[0], (ks[-1] + 1) % n
            length = sum(roles[k][1] for k in ks)
            tops = [b["top"][(ks[0] + j) % n] for j in range(len(ks) + 1)]
            pts = [ring[(ks[0] + j) % n] for j in range(len(ks) + 1)]
            line = LineString(pts)
            samples = [terrain_z(*line.interpolate(d).coords[0]) for d in np.arange(0, line.length + 0.01, 1.0)]
            walls.append({
                "a": int(a), "b": int(bb), "role": roles[ks[0]][0], "length": round(length, 2),
                "eave": round(float(np.median(tops)), 2), "gable": bool(max(tops) - min(tops) > 1.2),
                "datum": round(float(np.percentile(samples, 70)), 2),
            })
        for hi, hole in enumerate(b["holes"]):
            hr = np.array(hole).reshape(-1, 2)
            hn = len(hr)
            tops = b["holeTop"][hi]
            for k in range(hn):
                length = float(np.hypot(*(hr[(k + 1) % hn] - hr[k])))
                if length < 1.5:
                    continue
                walls.append({"a": k, "b": (k + 1) % hn, "hole": hi, "role": "court", "length": round(length, 2),
                              "eave": round(float((tops[k] + tops[(k + 1) % hn]) / 2), 2), "gable": False,
                              "datum": round(terrain_z(*((hr[k] + hr[(k + 1) % hn]) / 2)), 2)})
        walls = [w for w in walls if w["length"] > 0.05]
        for w in walls:
            stats["role"][w["role"]] = stats["role"].get(w["role"], 0) + 1

        street_walls = [w for w in walls if w["role"] == "street" and w["length"] >= 2.5]
        main_wall = max(street_walls, key=lambda w: w["length"]) if street_walls else None

        # --- niveaux ------------------------------------------------------------------
        datum = main_wall["datum"] if main_wall else b["ground"]
        eave = main_wall["eave"] if main_wall else b["eave"]
        height = max(eave - datum, 2.0)
        if era is None:
            era = "xix" if height > 7 else "classical" if height > 5.5 else "postwar"
        stats["era"][era] = stats["era"].get(era, 0) + 1
        lidar_levels = int(min(max(round((height - 3.4) / 3.0) + 1, 1), 8))
        levels, src = lidar_levels, "lidar"
        for cand, name in (((bn or {}).get("nb_niveau"), "bdnb"), (bd.get("levels"), "bd")):
            if cand and abs(int(cand) - lidar_levels) <= 1:
                levels, src = int(cand), name
                break
        stats["levels_from"][src] += 1
        levels = min(max(levels, 1), 5 if mon else 9)
        upper = min(max((height - 3.4) / max(levels - 1, 1), 2.5), 3.5) if levels > 1 else 3.0
        ground_h = min(max(height - upper * (levels - 1), 2.6), 4.4)

        # --- matériaux ----------------------------------------------------------------
        stone_text = "PIERRE" in mat_wall or "MEULI" in mat_wall
        rich = usage in ("Tertiaire", "Résidentiel collectif") and levels >= 3
        if mon:
            wall_kind = "ashlar"
        elif era == "medieval":
            wall_kind = "plaster"
        elif era in ("classical", "xix"):
            wall_kind = "ashlar" if (stone_text and rich and rng.random() < 0.55) or rng.random() < 0.12 else "plaster"
        elif "BRIQUE" in mat_wall and rng.random() < 0.5:
            wall_kind = "brick"
        else:
            wall_kind = "plaster"
        if wall_kind == "ashlar":
            color = rng.choice(ASHLAR)
        elif wall_kind == "brick":
            color = "#a8593f"
        else:
            color = rng.choice(PLASTER if era in ("medieval", "classical", "xix") else PLASTER_MODERN)

        roof_color = b.get("roofColor") or "#808080"
        r_, g_, bl_ = (int(roof_color[i:i + 2], 16) for i in (1, 3, 5))
        lum, warm = 0.299 * r_ + 0.587 * g_ + 0.114 * bl_, r_ - bl_
        if b["roofKind"] == "flat":
            roof = "terrasse"
        elif "ZINC" in mat_roof and "TUILE" not in mat_roof:
            roof = "zinc"
        elif "ARDOISE" in mat_roof and "TUILE" not in mat_roof or bd.get("roof") == "20":
            roof = "ardoise"
        elif "TUILE" in mat_roof or bd.get("roof") in ("10", "12", "13"):
            roof = "tuile_plate" if era in ("medieval", "classical", "xix") else "tuile_mecanique"
        elif lum > 165 and warm < 12:
            roof = "zinc"
        elif warm < 4:
            roof = "ardoise"
        else:
            roof = "tuile_plate" if era in ("medieval", "classical", "xix") else "tuile_mecanique"

        # --- façade ------------------------------------------------------------------
        if era == "medieval":
            win = dict(style="small", width=0.75, height=1.05, surround="stone", sill=False, lintel="flat", frameColor=FRAME_OLD)
            bay, cornice, plinth_h = rng.uniform(2.4, 3.2), ("eaves_rafters", 0.15, 0.4), rng.uniform(0.5, 0.9)
            shutters = pick(rng, {"none": 3, "battant": 2})
        elif era == "classical":
            win = dict(style="panes_6", width=0.95, height=1.55, surround=pick(rng, {"stone": 3, "plaster_band": 2}), sill=True,
                       lintel=pick(rng, {"segmental": 2, "flat": 3}), frameColor=FRAME_WHITE)
            bay, cornice, plinth_h = rng.uniform(3.0, 3.6), (("stone_moulded", 0.3, 0.28) if wall_kind == "ashlar" or levels >= 3 else ("eaves_rafters", 0.15, 0.4)), rng.uniform(0.5, 0.9)
            shutters = pick(rng, {"battant": 5, "persienne": 2, "none": 1})
        elif era == "xix":
            win = dict(style="panes_4", width=1.0, height=1.85, surround=pick(rng, {"stone": 3, "plaster_band": 3}), sill=True,
                       lintel=pick(rng, {"flat": 3, "segmental": 2}), frameColor=pick(rng, {FRAME_WHITE: 3, "#6f7a78": 1}))
            bay, cornice, plinth_h = rng.uniform(3.0, 3.5), ("stone_moulded", 0.35, 0.3), rng.uniform(0.6, 1.0)
            shutters = pick(rng, {"persienne": 4, "battant": 3, "none": 1})
        elif era == "interwar":
            win = dict(style="panes_2", width=1.1, height=1.5, surround=pick(rng, {"none": 2, "plaster_band": 2}), sill=True, lintel="none", frameColor=FRAME_WHITE)
            bay, cornice, plinth_h = rng.uniform(3.0, 3.5), ("eaves_rafters", 0.15, 0.3), 0.5
            shutters = pick(rng, {"battant": 3, "roulant": 3, "none": 1})
        elif era == "postwar":
            win = dict(style="panes_2", width=1.3, height=1.3, surround="none", sill=False, lintel="none", frameColor=pick(rng, {FRAME_WHITE: 2, "#4a4a48": 1}))
            bay, cornice, plinth_h = rng.uniform(3.4, 4.2), ("none", 0.0, 0.15), 0.25
            shutters = pick(rng, {"roulant": 4, "none": 2})
        else:
            win = dict(style="picture", width=1.5, height=1.3, surround="none", sill=False, lintel="none", frameColor="#3d3d3b")
            bay, cornice, plinth_h = rng.uniform(3.6, 4.5), ("none", 0.0, 0.1), 0.15
            shutters = pick(rng, {"none": 3, "roulant": 1})
        if mon:
            shutters = "none"
        if wall_kind == "plaster" and era in ("medieval", "classical", "xix") and win["surround"] == "stone" and rng.random() < 0.3:
            win["surround"] = "plaster_band"
        shutter_color = pick(rng, SHUTTERS)
        balcony, balcony_level = "none", 1
        if era in ("classical", "xix") and levels >= 3 and not mon:
            balcony = pick(rng, {"filant": 2 if wall_kind == "ashlar" else 1, "individuel": 1, "none": 4})
            balcony_level = 1 if balcony == "filant" else rng.randint(1, max(levels - 2, 1))
        facade = {
            "bayWidth": round(bay, 2), "window": win,
            "shutters": {"kind": shutters, "color": shutter_color},
            "balcony": balcony, "balconyLevel": balcony_level,
            "stringCourse": bool(era in ("xix", "classical") and (wall_kind == "ashlar" or mon or rng.random() < 0.35)),
            "corners": "quoins" if (era in ("classical", "xix") and wall_kind == "ashlar" and rng.random() < 0.5) or mon else "none",
            "cornice": {"kind": cornice[0], "height": cornice[1], "projection": cornice[2]},
            "plinth": {"height": round(plinth_h * 0.75, 2), "color": PLINTH_STONE},
        }

        # --- commerces et rez-de-chaussée ---------------------------------------------
        shops = []
        near_shops = [shop_nodes[int(j)] for j in shop_tree.query(poly.buffer(3.0))] if shop_nodes else []
        for oid, name, kind, pt in near_shops:
            if poly.distance(pt) >= 3.0:
                continue
            # Le mur de rue le plus proche du point.
            best = None
            for wi, w in enumerate(walls):
                if w["role"] != "street" or "hole" in w:
                    continue
                run_pts = [ring[(w["a"] + j) % n] for j in range(0, _count(w, n) + 1)]
                line = LineString(run_pts)
                d = line.distance(pt)
                if best is None or d < best[0]:
                    best = (d, wi, line.project(pt))
            if best and best[0] < 12:
                shops.append({"name": name, "kind": kind, "wall": best[1], "s": round(best[2], 2), "osm": int(oid)})
        shops = shops[:3]
        stats["shops"] += len(shops)
        commercial = usage in ("Tertiaire", "Commercial et services") or bd.get("use") == "Commercial et services"
        if mon:
            gkind = "monument"
        elif poly.area < 12 or height < 3.0 or not main_wall:
            gkind = "blank"
        elif shops or (commercial and rng.random() < 0.6):
            gkind = "shop"
        else:
            gkind = "dwelling"
        door_style = "glazed" if gkind in ("shop", "monument") else pick(rng, {"simple": 5, "carriage": 1 if (main_wall and main_wall["length"] > 9 and era != "postwar") else 0, "garage": 1 if era in ("interwar", "postwar", "contemporary") else 0}) if gkind != "blank" else "none"
        ground = {"kind": gkind, "door": {"style": door_style, "color": rng.choice(DOORS)}}
        if gkind == "shop":
            ground["shopfront"] = {"color": rng.choice(SHOPFRONTS), "glazing": pick(rng, {"full": 3, "divided": 2})}
            if shops:
                ground["shops"] = shops

        sources = [{"kind": "bdtopo", "ref": b["id"]}, {"kind": "lidar", "ref": "LHD_FXX_0798_6651"}]
        if bn:
            sources.append({"kind": "bdnb", "ref": bn["batiment_groupe_id"]})
        if shops:
            sources.extend({"kind": "osm", "ref": f"node/{s['osm']}"} for s in shops)
        if mon and mon[1]:
            sources.append({"kind": "pop", "ref": mon[1]})
        sources.append({"kind": "typology", "ref": f"{era}{' (supposée)' if guessed else ''}"})
        conf = 0.3 + (0.15 if year else 0) + (0.1 if mat_wall else 0) + (0.1 if shops else 0) + (0.1 if mon else 0) + (0.05 if src != "lidar" else 0)
        fiche = {
            "id": b["id"], "status": "estimated", "confidence": round(min(conf, 0.75), 2), "sources": sources,
            "address": (bn or {}).get("libelle_adr_principale_ban"),
            "monument": {"name": mon[0], "mhs": mon[1], "note": "modélisation fine à faire d'après des photos"} if mon else None,
            "era": era, "year": int(year) if year else None, "levels": levels,
            "storeys": {"ground": round(ground_h, 2), "upper": round(upper, 2)},
            "materials": {"wall": {"kind": wall_kind, "color": color}, "roof": roof},
            "facade": facade, "ground": ground, "walls": walls,
        }
        stats["monuments"] += bool(mon)
        fiches.append(fiche)

    schema = json.load(open(c.ROOT / "docs" / "facade-fiche.schema.json"))
    validator = Draft202012Validator(schema)
    errors = [(f["id"], e.message) for f in fiches for e in validator.iter_errors(f)]
    if errors:
        for e in errors[:10]:
            print("ERREUR", e)
        raise SystemExit(f"{len(errors)} erreur(s) de schéma")
    (c.CACHE / "work" / "facades.json").write_text(json.dumps(fiches, ensure_ascii=False, separators=(",", ":")))
    size = (c.CACHE / "work" / "facades.json").stat().st_size / 1e3
    print(f"{len(fiches)} fiches ({size:.0f} ko), toutes valides ; {json.dumps(stats, ensure_ascii=False)}")


def _count(w, n):
    """Nombre d'arêtes d'une série (a -> b, en tournant)."""
    return (w["b"] - w["a"]) % n or n


if __name__ == "__main__":
    main()
