"""Données de navigation (étape J2) : graphe piéton, graphe routier et points d'intérêt, par super-tuile de 1 km.

Usage : python3 tools/data/build_nav.py          (après `fetch.py --only osm` et `--only routes` pour chaque bloc de REGION)
Entrées : public/data/world.json et public/data/tiles/*.json (bâtiments, murs, arbres, mobilier, fiches, sols : obstacles et places),
          OpenStreetMap par blocs de 500 m (.cache/shared/raw/osm : voies, passages, feux, restrictions de virage),
          BD TOPO tronçons de route de chaque bloc (.cache/blocks/*/raw/bdtopo_route.json : largeurs, vitesses, voies).
Sorties : public/data/nav/index.json et nav/s<i>_<j>.json, un fichier par super-tuile de la grille mondiale (les mêmes 1 km que les sols grossiers).
Étape autonome (comme build_map.py) : ne touche à aucune tuile ; se relance librement (≈ 0,1 Mo). Format : D40.
`--only s6_8[,s6_9…]` (D153) : ne reconstruit que ces super-tuiles, à partir des seuls blocs OpenStreetMap, tronçons BD TOPO et tuiles qui les touchent
(téléchargés au besoin dans .cache/shared) ; le graphe routier de ces super-tuiles reste celui du fichier existant (l'extrait OpenStreetMap a changé depuis la dernière régénération complète) ; les autres fichiers de nav/ et leurs entrées de l'index ne sont pas touchés, la couture n'est pas contrôlée.
Ensuite : build_theatre_nav.py (chemins du théâtre romain, D135 : l'emprise BD TOPO masquée du théâtre en retire les voies).
"""

import glob
import json
import math
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import shapely
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

import coast_lib as coast
import config as c
import nav_lib as nl
import streets_lib as sl

OUT = c.OUT / "nav"
SIZE = c.TILE * c.SUPER  # 1 000 m
ROUND = 2  # centimètres


def log(*a):
    print(*a, flush=True)


# --- Entrées ---------------------------------------------------------------------------------------------------------------

def load_world():
    w = json.loads((c.OUT / "world.json").read_text())
    gx, gy = w["gridOrigin"]
    cells = {(int(s["id"][1:].split("_")[0]), int(s["id"][1:].split("_")[1])) for s in w["super"]["cells"]}
    return w, gx, gy, cells


def only_box(world, only, margin=150.0):
    """Emprise locale (x0, y0, x1, y1) des super-tuiles demandées, élargie de `margin` m (None : tout le monde)."""
    if not only:
        return None
    gx, gy = world["gridOrigin"]
    cs = [tuple(int(v) for v in i[1:].split("_")) for i in only]
    return (gx + min(i for i, _ in cs) * SIZE - margin, gy + min(j for _, j in cs) * SIZE - margin,
            gx + (max(i for i, _ in cs) + 1) * SIZE + margin, gy + (max(j for _, j in cs) + 1) * SIZE + margin)


def load_tiles(world, box=None):
    """Obstacles et données des tuiles : bâtiments (anneaux), murs, arbres, mobilier, fiches de commerces."""
    buildings, walls, trees, furniture, shops, plazas = [], [], [], [], [], defaultdict(list)
    for t in world["tiles"]:
        if box and (t["bounds"][2] < box[0] or t["bounds"][0] > box[2] or t["bounds"][3] < box[1] or t["bounds"][1] > box[3]):
            continue
        d = json.loads((c.OUT / "tiles" / f"{t['id']}.json").read_text())
        for b in d["buildings"]:
            buildings.append([b["ring"]] + list(b["holes"]))
        walls.extend(w["pts"] for w in d["walls"])
        # Fontaines d'après photo (D131, D132) : leur bassin (site `fountain` de kinds) remplace le mobilier OpenStreetMap, sans arbre dedans.
        kp = c.OUT / "kinds" / f"{t['id']}.json"
        basins = {q["id"]: q for q in (json.loads(kp.read_text())["sites"] if kp.exists() else []) if q.get("t") == "fountain"}
        trees.extend((x, y) for x, y, *_ in d["trees"] if all(math.hypot(x - q["x"], y - q["y"]) > q["rb"] + 0.6 for q in basins.values()))
        furniture.extend(dict(f, x=basins[f["id"]]["x"], y=basins[f["id"]]["y"], r=basins[f["id"]]["rb"] + 0.2) if f["id"] in basins else f
                         for f in d["furniture"])
        fiches = {f["id"]: f for f in d["fiches"]}
        for b in d["buildings"]:
            f = fiches.get(b["id"])
            if f and f["ground"].get("kind") == "shop":
                shops.append((b["ring"], f))
        for layer, polys in d["ground"].items():
            if layer.startswith("plaza_") or layer == "road_asphalt" or layer.startswith("road_"):
                plazas[layer].extend(polys)
    return {"buildings": buildings, "walls": walls, "trees": trees, "furniture": furniture, "shops": shops, "ground": plazas}


def to_polygons(polys):
    out = []
    for rings in polys:
        holes = [[(h[i], h[i + 1]) for i in range(0, len(h), 2)] for h in rings[1:]]
        p = Polygon([(rings[0][i], rings[0][i + 1]) for i in range(0, len(rings[0]), 2)], holes)
        out.append(p if p.is_valid else p.buffer(0))
    return out


PUBLIC_PARKING = (None, "yes", "permissive")


def plaza_zone(tiles, ways):
    """Places publiques où l'on peut flâner : les composantes (≤ 4 ha) des sols de place des tuiles qui touchent un espace public confirmé par
    OpenStreetMap (zone piétonne, parking public). Les `plaza_*` des tuiles viennent en partie de l'orthophoto (cours privées) : seules elles ne suffisent pas."""
    P = unary_union(to_polygons([p for layer, polys in tiles["ground"].items() if layer.startswith("plaza_") for p in polys]))
    seeds, private = [], []
    aisles = []
    for e in ways:
        t, g = e["tags"], e["geometry"]
        if t.get("highway") == "service" and t.get("service") == "parking_aisle" and t.get("access") not in ("private", "no"):
            aisles.append(LineString(sl.way_line(e)))
        if len(g) < 4 or g[0] != g[-1]:
            continue
        public = (t.get("highway") == "pedestrian" and t.get("area") == "yes") or (t.get("amenity") == "parking" and t.get("access") in PUBLIC_PARKING)
        if public:
            poly = Polygon(sl.way_line(e)).buffer(0)
            if poly.area >= 300:
                seeds.append(poly)
        elif t.get("amenity") == "parking":
            private.append(Polygon(sl.way_line(e)).buffer(0))
    # Les allées de parking (sans polygone de parking à l'accès réservé à moins de 15 m) comptent aussi : le Champ de Mars est tracé ainsi.
    P_private = unary_union(private) if private else Polygon()
    seeds += [a.buffer(6) for a in aisles if a.length > 20 and P_private.distance(a) > 15]
    S = unary_union(seeds)
    comps = [p for p in getattr(P, "geoms", [P]) if p.intersects(S)]
    kept = [p.intersection(S.buffer(22)) if p.area > 12000 else p for p in comps]
    return unary_union(kept + [S.intersection(P.buffer(1.0))]), len(seeds)


def load_osm(box=None):
    els = {}
    files = glob.glob(str(c.SHARED / "raw" / "osm" / "*.json"))
    if box:
        # Seuls les blocs de 500 m qui touchent l'emprise, téléchargés au besoin (comme build_shop_fronts.py).
        import fetch
        o = c.ORIGIN
        files = []
        for bx in range(math.floor((box[0] + o[0]) / fetch.OSM_BLOCK), math.floor((box[2] + o[0]) / fetch.OSM_BLOCK) + 1):
            for by in range(math.floor((box[1] + o[1]) / fetch.OSM_BLOCK), math.floor((box[3] + o[1]) / fetch.OSM_BLOCK) + 1):
                part = c.SHARED / "raw" / "osm" / f"{bx}_{by}.json"
                if not part.exists():
                    log(f"  osm {bx},{by} : {fetch.osm_api_block(bx, by, part)} éléments")
                files.append(str(part))
    for f in files:
        for e in json.loads(Path(f).read_text())["elements"]:
            els[(e["type"], e["id"])] = e
    ways = [e for (t, _), e in els.items() if t == "way" and "geometry" in e and "tags" in e]
    node_tags = {i: e["tags"] for (t, i), e in els.items() if t == "node" and e.get("tags")}
    nodes = {i: e for (t, i), e in els.items() if t == "node"}
    restrictions = [e for (t, _), e in els.items() if t == "relation"]
    # Les nœuds de voie sans étiquette n'ont pas besoin d'exister : seuls ceux qui portent des étiquettes comptent.
    return ways, node_tags, nodes, restrictions, els


def load_routes(box=None):
    routes = []
    seen = set()
    files = sorted(glob.glob(str(c.ROOT / ".cache" / "blocks" / "*" / "raw" / "bdtopo_route.json")))
    if box:
        # Tronçons de l'emprise seule (WFS), gardés dans .cache/shared/nav_routes_<emprise>.json.
        import fetch
        o = c.ORIGIN
        bb = [box[0] + o[0], box[1] + o[1], box[2] + o[0], box[3] + o[1]]
        dest = c.SHARED / "nav_routes" / ("_".join(str(round(v)) for v in bb) + ".json")
        if not dest.exists():
            r = fetch.get("https://data.geopf.fr/wfs/ows", params={"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "BDTOPO_V3:troncon_de_route",
                                                                   "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154", "BBOX": ",".join(map(str, bb)) + ",EPSG:2154"})
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.content)
        files = [str(dest)]
    for f in files:
        for line, props in sl.load_bd_routes(f):
            key = (round(line.coords[0][0], 1), round(line.coords[0][1], 1), round(line.length, 1))
            if key in seen:
                continue
            seen.add(key)
            routes.append((line, props))
    return routes


def trim_to_land(s):
    """La voie réduite à sa plus longue suite de nœuds à terre, hors plage et falaise (D105) : les routes qui partent vers la mer s'arrêtent au dernier nœud."""
    pts = s["pts"]
    on = [coast.usable(pts[i], pts[i + 1]) for i in range(0, len(pts), 2)]
    if all(on):
        return s
    best, start = (0, 0), None
    for i, v in enumerate(on + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start > best[1] - best[0]:
                best = (start, i)
            start = None
    if best[1] - best[0] < 2:
        return None
    a, b = best
    return {**s, "nodes": s["nodes"][a:b], "pts": pts[2 * a:2 * b]}


def walkable(s):
    o = s["osm"]
    foot_ok = o.get("foot") in ("yes", "designated", "permissive")
    if s["tunnel"] or o.get("tunnel") == "building_passage":
        return False  # les passages couverts sont bloqués par les collisions (D13)
    if o.get("foot") == "no":
        return False
    if o.get("access") in ("private", "no") and not foot_ok:
        return False
    if s["kind"] == "cycleway" and not foot_ok:
        return False
    if o.get("service") in ("driveway", "emergency_access"):
        return False
    return True


# --- Sortie ----------------------------------------------------------------------------------------------------------------

def q(v):
    return round(v, ROUND)


def build_pois(tiles, ways, node_tags, nodes, plaza_nodes, gp, zone):
    """Points d'intérêt : [type, x, y, cap, distance à la file piétonne la plus proche (dm)]. Le cap regarde vers cette file (assise, vitrine, panneau)."""
    raw = []
    for f in tiles["furniture"]:
        k = POI_FROM_FURNITURE.get(f["kind"])
        if k is not None:
            raw.append((k, f["x"], f["y"]))
    for i, t in node_tags.items():
        e = nodes[i]
        x, y = sl.local(e["lon"], e["lat"])
        if t.get("highway") == "bus_stop":
            raw.append((1, x, y))
        elif t.get("amenity") in POI_FROM_AMENITY:
            raw.append((POI_FROM_AMENITY[t["amenity"]], x, y))
    for w in ways:  # lieux de culte tracés en surface
        t = w["tags"]
        if t.get("amenity") == "place_of_worship" and len(w["geometry"]) >= 4:
            c0 = Polygon(sl.way_line(w)).buffer(0).centroid
            raw.append((9, c0.x, c0.y))
    for ring, f in tiles["shops"]:
        street = [w for w in f["walls"] if w["role"] == "street"]
        if not street:
            continue
        # Le mur d'entrée choisi par build_shop_fronts.py (D120), sinon le plus long mur sur rue.
        front = f["ground"].get("front")
        w = f["walls"][front] if front is not None else max(street, key=lambda w: w["length"])
        a, b = (ring[2 * w["a"]], ring[2 * w["a"] + 1]), (ring[2 * w["b"]], ring[2 * w["b"] + 1])
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        nx, ny = -(b[1] - a[1]), b[0] - a[0]
        n = math.hypot(nx, ny) or 1.0
        poly = Polygon([(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)]).buffer(0)
        if poly.contains(Point(mx + nx / n, my + ny / n)):
            nx, ny = -nx, -ny
        raw.append((2, mx + nx / n * 0.8, my + ny / n * 0.8))
    # Spots à pigeons : quelques points par place, les plus éloignés les uns des autres.
    pts = np.array([gp.xy(n) for n in plaza_nodes]) if plaza_nodes else np.zeros((0, 2))
    if len(pts):
        picked = [0]
        d = np.hypot(*(pts - pts[0]).T)
        while len(picked) < min(len(pts), 1 + int(len(pts) // 25)) and d.max() > 14:
            k = int(d.argmax())
            picked.append(k)
            d = np.minimum(d, np.hypot(*(pts - pts[k]).T))
        raw += [(11, pts[k][0], pts[k][1]) for k in picked]
    # Cap et distance : vers le point le plus proche des files (types 'lane', 'path', 'pedestrian_street', 'plaza').
    segs = [LineString([gp.xy(e["a"])] + list(e["pts"]) + [gp.xy(e["b"])]) for e in gp.edges if e["typ"] in (nl.T_LANE, nl.T_PATH, nl.T_PEDSTREET, nl.T_PLAZA)]
    tree = shapely.STRtree(segs)
    out = []
    for k, x, y in raw:
        p = Point(x, y)
        i = tree.nearest(p)
        line = segs[i] if i is not None else None
        if line is None:
            continue
        near = line.interpolate(line.project(p))
        d = p.distance(near)
        if d > 30:
            continue
        out.append((k, x, y, math.atan2(near.x - x, near.y - y) if d > 0.05 else 0.0, min(255, round(d * 10))))
    return out


def annotate_foot(gp, pois, tiles):
    """`foot` (fréquentation 0 à 255) et `zone` (0 centre, 1 résidentiel, 2 périphérie, 3 nature) de chaque arête piétonne :
    commerces et lieux autour, part bâtie, distance à la mairie (origine du repère)."""
    shop_pts = np.array([(x, y) for k, x, y, *_ in pois if k in (2, 10, 1, 9)]) if pois else np.zeros((0, 2))
    shop_tree = cKDTree(shop_pts) if len(shop_pts) else None
    cent, area = [], []
    for rings in tiles["buildings"]:
        r = rings[0]
        xs, ys = r[0::2], r[1::2]
        cent.append(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2))
        area.append(Polygon([(r[i], r[i + 1]) for i in range(0, len(r), 2)]).buffer(0).area)
    bt, ba = cKDTree(np.array(cent)), np.array(area)
    R = 70.0
    mids = np.array([[(gp.nodes[e["a"]][0] + gp.nodes[e["b"]][0]) / 2, (gp.nodes[e["a"]][1] + gp.nodes[e["b"]][1]) / 2] for e in gp.edges]) if gp.edges else np.zeros((0, 2))
    n_poi = np.array([len(shop_tree.query_ball_point(m, R)) for m in mids]) if shop_tree else np.zeros(len(mids))
    cover = np.array([ba[bt.query_ball_point(m, R)].sum() / (math.pi * R * R) for m in mids])
    dist0 = np.hypot(mids[:, 0], mids[:, 1])
    score = 0.45 * np.minimum(1, n_poi / 8) + 0.35 * np.minimum(1, cover / 0.30) + 0.20 * np.exp(-dist0 / 700)
    for i, e in enumerate(gp.edges):
        mult = {nl.T_PATH: 0.6, nl.T_STEPS: 0.7, nl.T_PEDSTREET: 1.15, nl.T_PLAZA: 1.15, nl.T_PLAZA_LINK: 1.15}.get(e["typ"], 1.0)
        sc = float(score[i]) * mult
        e["foot"] = int(round(255 * min(1.0, sc / 0.95)))
        if e["typ"] in (nl.T_PATH,) and cover[i] < 0.04 and n_poi[i] == 0:
            e["zone"] = 3
        else:
            e["zone"] = 0 if sc >= ZONE_CENTRE else (1 if sc >= ZONE_RESIDENTIAL else 2)
    return score


ZONE_CENTRE, ZONE_RESIDENTIAL = 0.55, 0.18  # calibrés sur l anneau : centre ≈ 12 % de la longueur des files, résidentiel ≈ 30 %


def serialize(g, edges, kind):
    """Un fichier de graphe pour une super-tuile : nœuds utilisés (indices locaux), arêtes et sommets intérieurs en tableaux plats."""
    local = {}
    n_out, g_out, e_out = [], [], []
    for e in edges:
        for k in ("a", "b"):
            if e[k] not in local:
                local[e[k]] = len(local)
                x, y, f = g.nodes[e[k]]
                n_out += [q(x), q(y), f]
    for e in edges:
        p0 = len(g_out) // 2
        for x, y in e["pts"]:
            g_out += [q(x), q(y)]
        length = 0.0
        pts = [g.xy(e["a"])] + list(e["pts"]) + [g.xy(e["b"])]
        for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
            length += math.hypot(x1 - x0, y1 - y0)
        if kind == "ped":
            e_out += [local[e["a"]], local[e["b"]], e["typ"], e["flags"], min(255, round(e["width"] * 10)), e.get("foot", 128), e.get("zone", 1),
                      min(65535, round(length * 10)), e["ref"], p0, len(e["pts"])]
        else:
            e_out += [local[e["a"]], local[e["b"]], e["cls"], e["flags"], e["lanes"], e["speed"], min(255, round(e["width"] * 10)),
                      min(65535, round(length * 10)), e["gid"], p0, len(e["pts"])]
    return {"n": n_out, "e": e_out, "g": g_out}, local


def check_seams(docs, size):
    """Chaque portail d'une super-tuile a son jumeau (mêmes coordonnées) dans la voisine, sauf au bord du monde (NF_WORLD_END)."""
    out = {"portails": 0, "portails sans jumeau": 0, "bords du monde": 0}
    by_cell = {}
    for cell, d in docs.items():
        for kind in ("ped", "road"):
            n = d[kind]["n"]
            by_cell[(cell, kind)] = {(n[i], n[i + 1]) for i in range(0, len(n), 3) if n[i + 2] & nl.NF_PORTAL}
    for (cell, kind), pts in by_cell.items():
        x0, y0 = docs[cell]["bounds"][:2]
        n = docs[cell][kind]["n"]
        flags = {(n[i], n[i + 1]): n[i + 2] for i in range(0, len(n), 3)}
        for (x, y) in pts:
            out["portails"] += 1
            if flags[(x, y)] & nl.NF_WORLD_END:
                out["bords du monde"] += 1
                continue
            on_x, on_y = x in (x0, x0 + size), y in (y0, y0 + size)
            if on_x == on_y:  # coin de super-tuile ou point hors frontière : pas de voisine unique
                continue
            nb = (cell[0] + (1 if x == x0 + size else -1 if x == x0 else 0), cell[1] + (1 if y == y0 + size else -1 if y == y0 else 0))
            if (x, y) not in by_cell.get((nb, kind), set()):
                out["portails sans jumeau"] += 1
    return out


PED_STRIDE = {"n": 3, "e": 11}
PED_TYPES = ["lane", "corner", "crossing", "crossing_signal", "crossing_implicit", "path", "steps", "plaza", "plaza_link", "pedestrian_street"]
POI_KINDS = ["bench", "bus_stop", "shop", "fountain", "drinking_water", "post_box", "atm", "bookcase", "memorial", "worship", "restaurant", "pigeon_spot", "school", "toilets"]
POI_FROM_FURNITURE = {"bench": 0, "fountain": 3, "drinking_water": 4, "post_box": 5, "atm": 6, "public_bookcase": 7, "memorial": 8, "toilets": 13}
POI_FROM_AMENITY = {"restaurant": 10, "cafe": 10, "bar": 10, "pub": 10, "fast_food": 10, "place_of_worship": 9, "school": 12}
ROAD_STRIDE = {"n": 3, "e": 11, "s": 3, "r": 3}


def main():
    t0 = time.time()
    world, gx, gy, cells = load_world()
    only = []
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1].split(",")
        cells = {tuple(int(v) for v in i[1:].split("_")) for i in only}
    box = only_box(world, only)
    log(f"monde : {len(world['tiles'])} tuiles, {len(cells)} super-tuiles de {SIZE:.0f} m, origine de grille ({gx}, {gy})")
    tiles = load_tiles(world, box)
    obst = nl.Obstacles(tiles["buildings"], tiles["walls"])
    log(f"obstacles : {len(tiles['buildings'])} bâtiments, {len(tiles['walls'])} murs ({time.time() - t0:.0f} s)")
    ways, node_tags, nodes, restrictions, _ = load_osm(box)
    routes = load_routes(box)
    streets = [s for s in (trim_to_land(s) for s in sl.build_street_list(ways, routes, 2)) if s]
    # Une même voie peut venir de deux blocs : l'extrait OpenStreetMap est déjà dédoublonné par (type, id).
    log(f"voies : {len(streets)} ({Counter(s['kind'] for s in streets).most_common()}), {len(routes)} tronçons BD TOPO, {len(restrictions)} restrictions")

    crossing = {i for i, t in node_tags.items() if t.get("highway") == "crossing"}
    signal = {i for i, t in node_tags.items() if t.get("highway") == "traffic_signals" or t.get("crossing") == "traffic_signals"
              or t.get("crossing:signals") == "yes"}
    ped_streets = [s for s in streets if walkable(s)]
    gp, pst = nl.build_pedestrian(ped_streets, node_tags, obst, crossing, signal)
    pst["arêtes retirées (dans un bâtiment)"] = nl.drop_stuck_edges(gp, obst)
    circles = nl.Circles(tiles["trees"], tiles["furniture"])
    zone, n_seeds = plaza_zone(tiles, ways)
    roads = unary_union(to_polygons([p for layer, polys in tiles["ground"].items() if layer.startswith("road_") for p in polys]))
    plz, plaza_nodes = nl.build_plazas(gp, zone, obst, circles, roads)
    pst["places"] = {**plz, "aire m²": round(zone.area), "composantes": len(getattr(zone, "geoms", [zone]))}
    n_drop, m_drop = nl.prune_small_components(gp, 100.0)
    pst["îlots retirés (< 100 m)"] = n_drop
    pst["km de files"] = round(sum(nl.edge_length(gp, e) for e in gp.edges) / 1000, 1)
    comps = nl.components(gp)
    pst["composantes"] = len(comps)
    pst["part de la plus grande (%)"] = round(100 * sum(nl.edge_length(gp, gp.edges[i]) for i in comps[0]) / max(1.0, sum(nl.edge_length(gp, e) for e in gp.edges)), 1)
    log(f"graphe piéton : {pst} ({time.time() - t0:.0f} s)")
    pois = build_pois(tiles, ways, node_tags, nodes, plaza_nodes, gp, zone)
    annotate_foot(gp, pois, tiles)
    log(f"points d'intérêt : {dict(Counter(POI_KINDS[p[0]] for p in pois))}")
    gr, signs, restr, rst = nl.build_road(streets, node_tags, restrictions)
    log(f"graphe routier : {rst}")

    ped_cells = nl.cut_into_cells(gp, gx, gy, SIZE, cells)
    road_cells = nl.cut_into_cells(gr, gx, gy, SIZE, cells)

    OUT.mkdir(parents=True, exist_ok=True)
    if not only:
        for f in OUT.glob("s*.json"):
            f.unlink()
    old_index = json.loads((OUT / "index.json").read_text()) if only else None
    index = {"version": 1, "cell": SIZE, "gridOrigin": [gx, gy], "stride": {"ped": PED_STRIDE, "road": ROAD_STRIDE, "poi": 5}, "poiKinds": POI_KINDS,
             "pedTypes": PED_TYPES, "stats": {"ped": pst, "road": rst}, "cells": []}
    total = 0
    docs = {}
    for cell in sorted(cells):
        cid = f"s{cell[0]}_{cell[1]}"
        ped, _ = serialize(gp, ped_cells.get(cell, []), "ped")
        road, rloc = serialize(gr, road_cells.get(cell, []), "road")
        piece_of = defaultdict(list)
        for li, e in enumerate(road_cells.get(cell, [])):
            piece_of[e["orig"]].append((li, e))
        s_out = []
        for sg in signs:
            for li, e in piece_of.get(sg["edge"], []):
                if sg["node"] in (e["a"], e["b"]):
                    s_out += [rloc[sg["node"]], li, sg["kind"]]
        r_out = []
        for r in restr:
            fe = [li for li, e in piece_of.get(r["from_edge"], []) if r["node"] in (e["a"], e["b"])]
            te = [li for li, e in piece_of.get(r["to_edge"], []) if r["node"] in (e["a"], e["b"])]
            if fe and te:
                r_out += [fe[0], te[0], r["code"]]
        road["s"], road["r"] = s_out, r_out
        cx0, cy0 = gx + cell[0] * SIZE, gy + cell[1] * SIZE
        p_out = []
        for kind, x, y, h, d in pois:
            if cx0 <= x < cx0 + SIZE and cy0 <= y < cy0 + SIZE:
                p_out += [kind, q(x), q(y), round(h, 2), d]
        if only and (OUT / f"{cid}.json").exists():
            # Le graphe routier de la super-tuile reste celui de la dernière régénération complète : D153 n'y touche pas, et l'extrait OpenStreetMap
            # d'aujourd'hui n'est plus celui d'alors (voies redécoupées, classes changées) : le refaire ici déplacerait les files des voitures.
            road = json.loads((OUT / f"{cid}.json").read_text())["road"]
        doc = {"v": 1, "id": cid, "bounds": [cx0, cy0, cx0 + SIZE, cy0 + SIZE], "ped": {**ped}, "road": {**road}, "poi": p_out}
        docs[cell] = doc
        text = json.dumps(doc, separators=(",", ":"))
        (OUT / f"{cid}.json").write_text(text)
        total += len(text)
        index["cells"].append({"id": cid, "bytes": len(text), "ped": {"nodes": len(ped["n"]) // 3, "edges": len(ped["e"]) // 11},
                               "road": {"nodes": len(road["n"]) // 3, "edges": len(road["e"]) // 11}, "poi": len(p_out) // 5})
    if only:
        # Les autres super-tuiles ne sont pas touchées : on remplace seulement leurs entrées et on garde les statistiques.
        keep = [e for e in old_index["cells"] if e["id"] not in {f"s{i}_{j}" for i, j in cells}]
        old_index["cells"] = sorted(keep + index["cells"], key=lambda e: e["id"])
        index = old_index
        (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
        log(f"+ {OUT.relative_to(c.ROOT)} : {len(docs)} fichier(s) remplacé(s), couture non contrôlée ({time.time() - t0:.0f} s)")
        return 0
    problems = check_seams(docs, SIZE)
    index["stats"]["seams"] = problems
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    log(f"couture entre super-tuiles : {problems}")
    log(f"+ {OUT.relative_to(c.ROOT)} : {len(index['cells'])} fichiers, {total / 1e3:.0f} ko en JSON ({time.time() - t0:.0f} s)")
    return 1 if problems["portails sans jumeau"] else 0


if __name__ == "__main__":
    sys.exit(main())
