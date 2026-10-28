"""Types de bâtiments et sites remarquables (étape M1, D92) : étape autonome, ne touche à aucune tuile.

Usage : python3 tools/data/build_kinds.py [--force]     (--force retélécharge OpenStreetMap et les couches IGN)
Entrées : public/data/world.json et tiles/*.json (emprises, identifiants), extrait OpenStreetMap complet et couches BD TOPO de la région
(`region_sources.py`), modèle de surface LiDAR autour des églises (hauteur des clochers).
Sorties : public/data/kinds/<tuile>.json pour chaque tuile qui a quelque chose, et kinds/index.json (liste des tuiles, statistiques).

Fichier d'une tuile : {v, buildings: {id: {k, n?, c?, tc?, main?, tower?}}, sites: [...]}
  k     type du bâtiment (KINDS) ; n : texte de l'enseigne ou de l'inscription ; c, tc : couleur du panneau et des lettres ;
  main  1 pour le bâtiment principal d'un site (il porte l'inscription, les drapeaux) ;
  tower clocher [x, y, côté, z du haut de la tour, z de la pointe] (z relatifs à ORIGIN_Z, comme les bâtiments).
  sites : {t: "fuel", x, y, a, l, w, n?, c?, roof?} station-service (auvent l × w orienté de a radians ; roof : bâtiment-auvent existant),
          {t: "pitch", s, r, box: [cx, cy, a, l, w]} terrain de sport (discipline s, contour r, rectangle orienté le plus petit),
          {t: "track", r} piste d'athlétisme, {t: "cemetery", r} cimetière.
Priorité des sources pour un bâtiment : étiquette `building` d'OpenStreetMap, points OpenStreetMap dans le bâtiment, zones
OpenStreetMap (école, hôpital, supermarché…), zones d'activité BD TOPO, nature puis usage BD TOPO.
"""

import json
import math
import unicodedata
from collections import Counter, defaultdict

import numpy as np
from scipy import ndimage
from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

import config as c
import region_sources as rs

OUT = c.OUT / "kinds"
VERSION = 1

KINDS = ("retail", "industrial", "annex", "sports", "greenhouse", "canopy", "station", "school", "townhall", "civic", "post", "hospital",
         "care", "culture", "church", "chapel")
# Grandes surfaces : enseignes connues, couleur du panneau et des lettres (évocation, sans logo).
BRANDS = {
    "e.leclerc": ("E.Leclerc", "#1d5fa6", "#ffffff"), "aldi": ("ALDI", "#1b3c78", "#ffffff"), "lidl": ("Lidl", "#0050aa", "#ffe500"),
    "biocoop": ("Biocoop", "#3f8f3a", "#ffffff"), "mr.bricolage": ("Mr.Bricolage", "#e2231a", "#ffffff"), "gamm vert": ("Gamm vert", "#3a8d3a", "#ffffff"),
    "intermarche": ("Intermarché", "#e2231a", "#ffffff"), "carrefour": ("Carrefour", "#1d4f9c", "#ffffff"), "u express": ("U Express", "#e2231a", "#ffffff"),
    "dacia": ("Dacia", "#646b52", "#ffffff"), "total access": ("TotalEnergies", "#e2231a", "#ffffff"), "avia": ("AVIA", "#e2231a", "#ffffff"),
    "la poste": ("La Poste", "#ffcc00", "#003da5"),
}
RETAIL_SHOPS = {"supermarket", "mall", "department_store", "doityourself", "hardware", "garden_centre", "car", "furniture", "wholesale"}
BUILDING_TAG = {
    "church": "church", "cathedral": "church", "chapel": "chapel", "train_station": "station", "industrial": "industrial", "warehouse": "industrial",
    "manufacture": "industrial", "school": "school", "college": "school", "kindergarten": "school", "university": "school", "hospital": "hospital",
    "sports_hall": "sports", "sports_centre": "sports", "grandstand": "sports", "civic": "civic", "public": "civic", "government": "civic",
    "townhall": "townhall", "greenhouse": "greenhouse", "roof": "canopy", "garage": "annex", "garages": "annex", "shed": "annex", "service": "annex",
}
AREA_AMENITY = {"school": "school", "college": "school", "kindergarten": "school", "university": "school", "hospital": "hospital", "clinic": "hospital",
                "nursing_home": "care", "place_of_worship": "church", "townhall": "townhall", "post_office": "post", "theatre": "culture",
                "cinema": "culture", "library": "culture", "arts_centre": "culture", "community_centre": "culture"}
NODE_AMENITY = {"townhall": "townhall", "post_office": "post", "cinema": "culture", "theatre": "culture", "library": "culture",
                "arts_centre": "culture", "hospital": "hospital", "clinic": "hospital"}
# Zones d'activité BD TOPO : (catégorie, nature) -> type ; la nature prime sur la catégorie.
ZAI_NATURE = {"Mairie": "townhall", "Sous-préfecture": "civic", "Préfecture": "civic", "Poste": "post", "Hôpital": "hospital", "Maison de retraite": "care",
              "Musée": "culture", "Salle de spectacle ou conférence": "culture", "Office de tourisme": "culture", "Gare voyageurs uniquement": "station",
              "Gare voyageurs et fret": "station", "Complexe sportif couvert": "sports", "Piscine": "sports", "Stade": "sports",
              "Culte chrétien": "church", "Siège d'EPCI": "civic", "Divers public ou administratif": "civic"}
ZAI_CATEGORY = {"Science et enseignement": "school", "Santé": "hospital"}
# Inscriptions fixes (le nom propre reste dans OpenStreetMap / BD TOPO, l'enseigne est ce qu'on lirait sur la façade).
FIXED_SIGN = {"townhall": "HÔTEL DE VILLE", "post": "La Poste", "station": "GARE D'AUTUN"}
CIVIC_SIGN = {"Sous-préfecture": "SOUS-PRÉFECTURE"}
# Types génériques : un type précis trouvé par une source moins sûre l'emporte (une mairie étiquetée « civic » reste une mairie).
GENERIC = {"civic", "industrial", "annex"}
# Types qui priment sur un service hébergé (la bibliothèque dans l'hôtel de ville, le guichet dans la gare).
LANDMARK = {"townhall", "station"}
# Types à drapeaux sur le bâtiment principal.
FLAGS = {"townhall", "civic", "school"}
# Types dont tous les bâtiments d'un site reçoivent le type (les autres types ne prennent que les grands bâtiments du site).
WHOLE_SITE = {"school", "hospital", "care"}
MIN_AREA = {"retail": 350.0, "sports": 250.0, "industrial": 120.0, "church": 80.0, "culture": 60.0, "civic": 60.0, "townhall": 60.0, "post": 40.0, "station": 60.0}
PITCH_SPORTS = {"soccer": "soccer", "soccer;multi": "soccer", "rugby_union": "rugby", "rugby": "rugby", "tennis": "tennis", "basketball": "basketball",
                "handball": "handball", "multi": "multi", "volleyball": "multi", "athletics": "athletics"}


def norm(s):
    return "".join(ch for ch in unicodedata.normalize("NFD", (s or "").lower()) if unicodedata.category(ch) != "Mn").strip()


def brand_of(tags):
    """(texte, couleur, couleur des lettres) de l'enseigne d'une grande surface."""
    raw = tags.get("brand") or tags.get("name") or ""
    key = norm(raw).replace("e. leclerc", "e.leclerc")
    for k, v in BRANDS.items():
        if key.startswith(k):
            return v
    name = raw.split(" - ")[0].strip()
    return (name, None, None) if name else (None, None, None)


def sign_text(text):
    """Inscription en capitales, coupée aux tirets (« Lycée Bonaparte Site Leclerc » reste entier, « Hôtel Arcades - Autun » perd la ville)."""
    if not text:
        return None
    t = text.split(" - ")[0].strip()
    return t.upper() if len(t) <= 34 else None


def load_buildings():
    world = json.load(open(c.OUT / "world.json"))
    out = []
    for info in world["tiles"]:
        tile = json.load(open(c.OUT / "tiles" / f"{info['id']}.json"))
        for b in tile["buildings"]:
            r = b["ring"]
            poly = Polygon(list(zip(r[::2], r[1::2])), [list(zip(h[::2], h[1::2])) for h in b["holes"]]).buffer(0)
            out.append({"id": b["id"], "tile": info["id"], "poly": poly, "area": poly.area, "bd": b["bd"], "eave": b["eave"], "ground": b["ground"],
                        "ridge": b["ridge"]})
    return world, out


def inside_share(poly, area):
    return poly.intersection(area).area / max(poly.area, 1e-6)


def main():
    world, buildings = load_buildings()
    tile_of = {}
    for info in world["tiles"]:
        tile_of[(info["col"], info["row"])] = info["id"]
    gx, gy = world["gridOrigin"]
    size = world["tileSize"]

    def tile_at(x, y):
        return tile_of.get((math.floor((x - gx) / size), math.floor((y - gy) / size)))

    tree = STRtree([b["poly"] for b in buildings])
    osm = rs.osm()
    areas = osm.areas()
    nodes = osm.tagged_nodes()
    zai = rs.ign("BDTOPO_V3:zone_d_activite_ou_d_interet")
    clochers = [g for p, g in rs.ign("BDTOPO_V3:construction_ponctuelle") if p.get("nature") == "Clocher"]
    sport_ign = rs.ign("BDTOPO_V3:terrain_de_sport")

    # Candidats par bâtiment : (priorité, type, enseigne, couleur, couleur des lettres, clé de site).
    cand = defaultdict(list)

    def hits(geom, share=0.5):
        for i in tree.query(geom):
            b = buildings[int(i)]
            if inside_share(b["poly"], geom) >= share:
                yield int(i)

    # 1. Étiquette building d'OpenStreetMap.
    for typ, oid, tags, g in areas:
        kind = BUILDING_TAG.get(tags.get("building", ""))
        if tags.get("building") in ("retail", "commercial", "supermarket") and (tags.get("shop") in RETAIL_SHOPS or g.area > 600):
            kind = "retail"
        if not kind:
            continue
        name, col, tcol = brand_of(tags) if kind == "retail" else (sign_text(tags.get("name")) if kind not in ("church", "chapel", "annex", "canopy") else None, None, None)
        for i in tree.query(g):
            b = buildings[int(i)]
            inter = b["poly"].intersection(g).area
            if inter > 0.5 * min(b["area"], g.area):
                cand[int(i)].append((6, kind, name, col, tcol, f"osm:{typ}/{oid}"))

    # 2. Points d'OpenStreetMap dans le bâtiment.
    for nid, tags, p in nodes:
        kind, name, col, tcol = None, None, None, None
        if tags.get("shop") in RETAIL_SHOPS:
            kind = "retail"
            name, col, tcol = brand_of(tags)
        elif tags.get("amenity") in NODE_AMENITY:
            kind = NODE_AMENITY[tags["amenity"]]
            name = FIXED_SIGN.get(kind) or sign_text(tags.get("name"))
            if kind == "post":
                name, col, tcol = BRANDS["la poste"]
        elif tags.get("railway") == "station":
            kind, name = "station", FIXED_SIGN["station"]
        if not kind:
            continue
        for i in tree.query(p.buffer(3.0)):
            b = buildings[int(i)]
            if b["poly"].distance(p) <= 2.0 and b["area"] >= MIN_AREA.get(kind, 0):
                cand[int(i)].append((5, kind, name, col, tcol, f"osm:node/{nid}"))

    # 3. Zones d'OpenStreetMap (sites).
    for typ, oid, tags, g in areas:
        kind = AREA_AMENITY.get(tags.get("amenity", ""))
        name = sign_text(tags.get("name"))
        col = tcol = None
        if tags.get("shop") in RETAIL_SHOPS:
            kind = "retail"
            name, col, tcol = brand_of(tags)
        elif tags.get("leisure") in ("sports_centre", "stadium") or tags.get("building") == "sports_hall":
            kind = kind or "sports"
        elif tags.get("tourism") == "museum":
            kind = "culture"
        elif tags.get("landuse") == "industrial":
            kind = kind or "industrial"
            name = None
        if not kind:
            continue
        if kind in FIXED_SIGN:
            name = FIXED_SIGN[kind]
        if kind == "post":
            name, col, tcol = BRANDS["la poste"]
        for i in hits(g):
            cand[int(i)].append((4, kind, name, col, tcol, f"osm:{typ}/{oid}"))

    # 4. Zones d'activité BD TOPO.
    for props, g in zai:
        kind = ZAI_NATURE.get(props.get("nature")) or ZAI_CATEGORY.get(props.get("categorie"))
        if props.get("nature") == "Zone industrielle":
            kind = "industrial"
        if not kind:
            continue
        name = FIXED_SIGN.get(kind) or CIVIC_SIGN.get(props.get("nature")) or (sign_text(props.get("toponyme")) if kind != "church" else None)
        col = tcol = None
        if kind == "post":
            name, col, tcol = BRANDS["la poste"]
        for i in hits(g):
            cand[int(i)].append((3, kind, name if kind != "industrial" else None, col, tcol, f"ign:{props.get('cleabs')}"))

    # 5 et 6. Nature et usage BD TOPO.
    for i, b in enumerate(buildings):
        nature, use, use2 = b["bd"].get("nature"), b["bd"].get("use"), b["bd"].get("use2")
        kind = {"Industriel, agricole ou commercial": "industrial", "Eglise": "church", "Chapelle": "chapel", "Serre": "greenhouse",
                "Tribune": "sports"}.get(nature)
        if kind:
            cand[i].append((2, kind, None, None, None, None))
        elif use in ("Industriel", "Agricole") and b["area"] >= 80:
            cand[i].append((1, "industrial", None, None, None, None))
        elif use == "Sportif" and b["area"] >= 150:
            cand[i].append((1, "sports", None, None, None, None))
        elif use == "Annexe" and use2 in (None, "Annexe") and b["area"] < 80 and b["eave"] - b["ground"] < 4.5:
            cand[i].append((1, "annex", None, None, None, None))

    # Choix : la plus haute priorité ; à priorité égale, le type le plus précis (ordre de KINDS inversé : chapelle avant hangar).
    chosen = {}
    for i, lst in cand.items():
        b = buildings[i]
        ok = []
        for pr, kind, name, col, tcol, site in lst:
            if b["area"] < MIN_AREA.get(kind, 0) and not (kind in WHOLE_SITE and pr <= 4):
                # Petit bâtiment dans un site : il garde sa façade (loge, local technique), sauf dans les écoles et hôpitaux.
                if pr <= 4 and b["area"] < 80:
                    continue
                if pr >= 5:
                    continue
            # Un site ne transforme pas une maison en hangar : seuls les bâtiments non résidentiels prennent les types « boîte ».
            if kind in ("industrial", "retail", "sports") and pr <= 4 and b["bd"].get("use") == "Résidentiel" and b["area"] < 400:
                continue
            ok.append((pr + (0 if kind in GENERIC else 3) + (2 if kind in LANDMARK else 0), KINDS.index(kind), kind, name, col, tcol, site))
        if ok:
            ok.sort(key=lambda t: (-t[0], -t[1]))
            best = list(ok[0])
            # Le nom vient de la source la plus parlante pour ce type : un point (l'enseigne) avant le contour du bâtiment ou du site.
            named = sorted((t for t in lst if t[1] == best[2] and t[2]), key=lambda t: (t[0] != 5, -t[0]))
            if named:
                best[3:6] = named[0][2:5]
            chosen[i] = tuple(best)

    chosen = {i: (t if t[2] not in ("church", "chapel") else t[:3] + (None, None, None) + t[6:]) for i, t in chosen.items()}

    # Bâtiment principal de chaque site : le plus grand ; lui seul porte l'inscription et les drapeaux.
    by_site = defaultdict(list)
    for i, (pr, _, kind, name, col, tcol, site) in chosen.items():
        by_site[(site or f"b{i}", kind)].append(i)
    entries = {}
    for (site, kind), idx in by_site.items():
        main_i = max(idx, key=lambda i: buildings[i]["area"])
        for i in idx:
            pr, _, k, name, col, tcol, _s = chosen[i]
            e = {"k": k}
            if i == main_i:
                e["main"] = 1
                if name:
                    e["n"] = name
                if col:
                    e["c"] = col
                if tcol:
                    e["tc"] = tcol
            entries[i] = e

    # Clochers : la tour est la zone la plus haute du modèle de surface, autour du maximum ; le point « Clocher » de BD TOPO l'emporte s'il existe.
    towers = 0
    for i, e in entries.items():
        if e["k"] not in ("church", "chapel"):
            continue
        b = buildings[i]
        x0, y0, x1, y1 = b["poly"].bounds
        try:
            z, wx0, wy1 = rs.mns_window(x0 - 3, y0 - 3, x1 + 3, y1 + 3)
        except RuntimeError as error:
            print("  MNS indisponible :", error)
            continue
        res = 0.5
        rows, cols = z.shape
        xs = wx0 + (np.arange(cols) + 0.5) * res
        ys = wy1 - (np.arange(rows) + 0.5) * res
        X, Y = np.meshgrid(xs, ys)
        inside = np.array([b["poly"].contains(Point(x, y)) for x, y in zip(X.ravel(), Y.ravel())]).reshape(z.shape)
        zz = np.where(inside, np.nan_to_num(z, nan=-1e9), -1e9)
        hint = [p for p in clochers if b["poly"].buffer(2).contains(p)]
        if hint:
            hx, hy = hint[0].x, hint[0].y
            near = (X - hx) ** 2 + (Y - hy) ** 2 < 6 ** 2
            zz2 = np.where(near, zz, -1e9)
            r0, c0 = np.unravel_index(np.argmax(zz2), zz.shape)
        else:
            r0, c0 = np.unravel_index(np.argmax(zz), zz.shape)
        tip = float(zz[r0, c0])
        # Faîtage réel de la nef : le haut des valeurs mesurées sur l'emprise (la tour n'en couvre qu'une petite part).
        nave = float(np.percentile(zz[inside], 80)) if inside.any() else b["ridge"]
        if tip - nave < 3.0:
            continue  # rien ne dépasse franchement le toit : pas de clocher
        high = zz > nave + 1.5
        lab, _ = ndimage.label(high)
        region = lab == lab[r0, c0]
        side = float(np.clip(math.sqrt(region.sum() * res * res), 3.0, min(9.0, math.sqrt(b["area"]) * 0.5)))
        ring_cells = region & ~ndimage.binary_erosion(region)
        body = float(np.median(zz[ring_cells])) if ring_cells.any() else nave + 2
        body = min(max(body, nave + 1.5), tip - 0.5)
        tx, ty = float(X[region].mean()), float(Y[region].mean())
        e["tower"] = [round(tx, 2), round(ty, 2), round(side, 2), round(body, 2), round(tip, 2)]
        print(f"  clocher {b['id']} : côté {side:.1f} m, tour {body - b['ground']:.1f} m, pointe {tip - b['ground']:.1f} m (nef {nave - b['ground']:.1f} m)")
        towers += 1

    # --- Sites ----------------------------------------------------------------------------------------------------------------
    sites = defaultdict(list)

    def ring(g, tol=0.3):
        p = max(rs.as_polygons(g), key=lambda q: q.area).simplify(tol)
        return [round(v, 2) for xy in list(p.exterior.coords)[:-1] for v in xy]

    def obox(g):
        """Rectangle orienté le plus petit : centre, angle du grand côté, longueur, largeur."""
        r = g.minimum_rotated_rectangle
        pts = list(r.exterior.coords)[:4]
        e1 = (pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        e2 = (pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
        l1, l2 = math.hypot(*e1), math.hypot(*e2)
        a = math.atan2(e1[1], e1[0]) if l1 >= l2 else math.atan2(e2[1], e2[0])
        cx, cy = r.centroid.x, r.centroid.y
        return [round(cx, 2), round(cy, 2), round(a, 4), round(max(l1, l2), 2), round(min(l1, l2), 2)]

    # Stations-service : l'auvent existant (building=roof) ou un auvent posé au centre du site, dans l'axe de la voie la plus proche.
    roofs = [(oid, g) for typ, oid, tags, g in areas if tags.get("building") == "roof"]
    roads = [osm.way_line(wid) for wid, w in osm.ways.items() if w["tags"].get("highway") in ("primary", "secondary", "tertiary", "residential", "unclassified", "service")]
    roads = [r for r in roads if r is not None]
    road_tree = STRtree(roads)
    fuel = [(f"way/{oid}", tags, g) for typ, oid, tags, g in areas if tags.get("amenity") == "fuel"]
    fuel += [(f"node/{nid}", tags, p) for nid, tags, p in nodes if tags.get("amenity") == "fuel"
             and not any(g.buffer(15).contains(p) for _, _, g in fuel)]
    roof_ids = {}
    for fid, tags, g in fuel:
        zone = g.buffer(25) if g.geom_type == "Point" else g.buffer(8)
        near = [(oid, rg) for oid, rg in roofs if zone.intersects(rg)]
        name, col, _tc = brand_of(tags)
        if near:
            oid, rg = max(near, key=lambda t: t[1].area)
            cx, cy, a, l, w = obox(rg)
            hit = [int(i) for i in hits(rg, 0.5)]
            site = {"t": "fuel", "x": cx, "y": cy, "a": a, "l": l, "w": w}
            if hit:
                site["roof"] = buildings[hit[0]]["id"]
                roof_ids[hit[0]] = True
        else:
            p = g.centroid
            j = road_tree.nearest(p)
            rd = roads[int(j)]
            d = rd.project(p)
            q0, q1 = rd.interpolate(max(d - 2, 0)), rd.interpolate(min(d + 2, rd.length))
            a = math.atan2(q1.y - q0.y, q1.x - q0.x)
            site = {"t": "fuel", "x": round(p.x, 2), "y": round(p.y, 2), "a": round(a, 4), "l": 14.0, "w": 8.0}
        if name:
            site["n"] = name
        if col:
            site["c"] = col
        tid = tile_at(site["x"], site["y"])
        if tid:
            sites[tid].append(site)
    for i in roof_ids:
        entries[i] = {"k": "canopy"}

    # Terrains de sport : OpenStreetMap d'abord, BD TOPO pour ceux qui manquent.
    pitch_geoms = []
    for typ, oid, tags, g in areas:
        if tags.get("leisure") == "pitch" and g.area > 60:
            pitch_geoms.append((PITCH_SPORTS.get(tags.get("sport", ""), "other" if tags.get("sport") else "multi"), g))
        elif tags.get("leisure") == "track" and g.area > 300:
            tid = tile_at(g.centroid.x, g.centroid.y)
            if tid:
                sites[tid].append({"t": "track", "r": ring(g)})
    for props, g in sport_ign:
        if any(g.intersection(q).area > 0.3 * g.area for _, q in pitch_geoms):
            continue
        nat, det = props.get("nature"), props.get("nature_detaillee") or ""
        s = "soccer" if "football" in det else "rugby" if "rugby" in det else "tennis" if nat == "Terrain de tennis" else "basketball" if "basket" in det \
            else "handball" if "hand" in det else "athletics" if nat == "Piste de sport" else "multi"
        if s == "athletics":
            continue  # les pistes BD TOPO recouvrent le terrain central : la piste vient d'OpenStreetMap
        pitch_geoms.append((s, g))
    for s, g in pitch_geoms:
        tid = tile_at(g.centroid.x, g.centroid.y)
        if tid:
            sites[tid].append({"t": "pitch", "s": s, "r": ring(g), "box": obox(g)})

    # Cimetières.
    for typ, oid, tags, g in areas:
        if tags.get("landuse") == "cemetery" or tags.get("amenity") == "grave_yard":
            tid = tile_at(g.centroid.x, g.centroid.y)
            if tid and g.area > 200:
                sites[tid].append({"t": "cemetery", "r": ring(g, 0.5)})

    # --- Écriture --------------------------------------------------------------------------------------------------------------
    per_tile = defaultdict(dict)
    for i, e in entries.items():
        per_tile[buildings[i]["tile"]][buildings[i]["id"]] = e
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    ids = sorted(set(per_tile) | set(sites))
    for tid in ids:
        data = {"v": VERSION, "buildings": dict(sorted(per_tile.get(tid, {}).items())), "sites": sites.get(tid, [])}
        (OUT / f"{tid}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    kinds = Counter(e["k"] for e in entries.values())
    site_count = Counter(s["t"] for lst in sites.values() for s in lst)
    named = sorted({(e["k"], e.get("n")) for e in entries.values() if e.get("n")})
    index = {"v": VERSION, "tiles": ids, "stats": {"buildings": dict(sorted(kinds.items())), "sites": dict(sorted(site_count.items())), "towers": towers}}
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    size = sum(p.stat().st_size for p in OUT.glob("*.json"))
    print(f"{len(entries)} bâtiments typés dans {len(ids)} tuiles ({size / 1e3:.0f} ko) : {dict(kinds)}")
    print(f"sites : {dict(site_count)} ; clochers : {towers}")
    for k, n in named:
        print(f"  {k:10s} {n}")


if __name__ == "__main__":
    main()
