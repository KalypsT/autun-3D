"""Rues, trottoirs, places et clôtures d'après le cadastre (étape M3, D94) : réécrit les sols et les clôtures des tuiles publiées.

Usage : python3 tools/data/build_public_space.py [--force]
Entrées : public/data/world.json et tiles/*.json (bâtiments, mobilier, murs), structures/ (eau), extrait OpenStreetMap complet, tronçons de
route BD TOPO, parcelles du cadastre (Parcellaire Express), orthophoto à 0,5 m (`region_sources.py`).
Sorties :
  tools/data/measured_widths.json   largeurs de chaussée retenues par voie (lues par streets_lib : sol et navigation voient les mêmes)
  public/data/tiles/*.json          clés `ground` (sols vectoriels), `walls` (clôtures de parcelles ajoutées), `furniture` (lampadaires
                                    replacés), arbres et feux recalés hors de la chaussée (roadside.py) ; le reste des tuiles est inchangé.
Ensuite : build_map.py (images de la carte) et build_nav.py (files des passants, D40) se relancent sur ces sols.

Principe : l'espace public est ce qui n'est dans aucune parcelle ni aucun bâtiment (le cadastre ne découpe pas le domaine public). Dans
cette emprise, la chaussée garde sa largeur (l'enrobé de l'orthophoto quand il se distingue des trottoirs, sinon BD TOPO ou la valeur type)
sans dépasser l'emprise ; les trottoirs remplissent le reste jusqu'aux façades et clôtures (5 m au plus, aucun s'il reste moins de 0,8 m) ;
au-delà, places, pelouses et parkings d'après l'orthophoto et OpenStreetMap. Les cours privées ne sont plus des places. Chaque limite de
parcelle sur la rue sans bâtiment reçoit une clôture : mur, grille ou haie.
"""

import json
import math
import zlib
from collections import Counter

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import substring, unary_union
from shapely.prepared import prep

import config as c
import region_sources as rs
import roadside
import streets_lib as sl
from build_tiles import clip_layers

SIDEWALK_MAX = 5.0  # au-delà, l'espace public le long d'une rue devient place ou pelouse
SIDEWALK_MIN = 0.8  # en dessous, rue partagée : pas de trottoir
SAMPLE = 6.0  # pas des profils en travers (m)
SURFACE = {"asphalt": "asphalt", "concrete": "paving", "sett": "sett", "paving_stones": "paving", "unhewn_cobblestone": "sett",
           "cobblestone": "sett", "compacted": "gravel", "gravel": "gravel", "fine_gravel": "gravel"}
MIN_W = {"primary": 6.0, "secondary": 5.5, "tertiary": 5.0, "residential": 3.0, "unclassified": 3.0, "living_street": 3.0, "service": 2.8, "road": 3.0}
FENCE_ID = 900_000_000  # identifiants des clôtures de parcelle : −(FENCE_ID + n)
LAMP_ID = 800_000_000  # lampadaires replacés : −(LAMP_ID + n)
LAMP_STEP = 30.0
CENTER = (0.0, 0.0)  # la mairie : vieille ville autour


# --- Raster de l'orthophoto ------------------------------------------------------------------------------------------------------
class Grid:
    """Masques et classes sur la grille de l'orthophoto (0,5 m)."""

    def __init__(self, ortho):
        self.o = ortho
        self.H, self.W = ortho.H, ortho.W

    def mask(self, geoms):
        img = Image.new("1", (self.W, self.H), 0)
        d = ImageDraw.Draw(img)
        res, x0, y1 = self.o.RES, self.o.x0, self.o.y1
        for g in geoms:
            for p in rs.as_polygons(g):
                d.polygon([((x - x0) / res, (y1 - y) / res) for x, y in p.exterior.coords], fill=1)
                for h in p.interiors:
                    d.polygon([((x - x0) / res, (y1 - y) / res) for x, y in h.coords], fill=0)
        return np.asarray(img, dtype=bool)

    def at(self, arr, x, y):
        r, q = self.o.pixel(x, y)
        if 0 <= r < self.H and 0 <= q < self.W:
            return arr[r, q]
        return False

    def polygons(self, m, cell=4):
        """Vectorise un masque par cellules de `cell` pixels (2 m) : rectangles fusionnés, puis union lissée."""
        H4, W4 = self.H // cell, self.W // cell
        mm = m[: H4 * cell, : W4 * cell].reshape(H4, cell, W4, cell).mean(axis=(1, 3)) > 0.5
        boxes = []
        res = self.o.RES * cell
        for r in range(H4):
            row = mm[r]
            d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
            for s, e in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
                boxes.append(box(self.o.x0 + s * res, self.o.y1 - (r + 1) * res, self.o.x0 + e * res, self.o.y1 - r * res))
        return unary_union(boxes) if boxes else Polygon()


def classify(rgb):
    """Classes de sol de l'orthophoto (mêmes seuils que build_streets.py) : 1 enrobé, 4 gravier, 5 herbe, 0 dallage ; vote sur 3,5 m."""
    f = rgb.astype(np.float32)
    luma = f.mean(axis=2)
    sat = f.max(axis=2) - f.min(axis=2)
    exg = 2 * f[..., 1] - f[..., 0] - f[..., 2]
    cls = np.zeros(luma.shape, np.uint8)
    cls[(luma < 105) & (sat < 45)] = 1
    cls[(luma >= 105) & (luma < 175) & (sat >= 18)] = 4
    cls[(exg > 18) & (f[..., 1] > f[..., 0])] = 5
    votes = np.stack([ndimage.uniform_filter((cls == k).astype(np.float32), size=7) for k in (0, 1, 4, 5)])
    return np.array([0, 1, 4, 5], np.uint8)[np.argmax(votes, axis=0)]


def runs(values, center):
    """Longueur (en pas) et milieu de la plage vraie contenant `center`, en tolérant des trous d'un pas ; (0, None) si `center` est faux."""
    if not values[center]:
        return 0, None
    a = center
    while a > 0 and (values[a - 1] or (a > 1 and values[a - 2])):
        a -= 1
    b = center
    while b < len(values) - 1 and (values[b + 1] or (b < len(values) - 2 and values[b + 2])):
        b += 1
    return b - a + 1, (a + b) / 2


# --- Programme --------------------------------------------------------------------------------------------------------------------
def main():
    world = json.load(open(c.OUT / "world.json"))
    tiles = {t["id"]: json.load(open(c.OUT / "tiles" / f"{t['id']}.json")) for t in world["tiles"]}
    manual = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())
    print(f"{len(tiles)} tuiles")

    bpolys = []
    for t in tiles.values():
        for b in t["buildings"]:
            r = b["ring"]
            bpolys.append(Polygon(list(zip(r[::2], r[1::2])), [list(zip(h[::2], h[1::2])) for h in b["holes"]]).buffer(0))
    B = unary_union(bpolys)
    water = []
    for f in (c.OUT / "structures").glob("*_*.json"):
        for poly in json.loads(f.read_text())["water"]:
            water.append(Polygon(list(zip(poly[0][::2], poly[0][1::2])), [list(zip(h[::2], h[1::2])) for h in poly[1:]]).buffer(0))
    WATER = unary_union(water) if water else Polygon()

    x0, y0, x1, y1 = rs.region_box(40)
    zone = box(x0 - c.ORIGIN[0], y0 - c.ORIGIN[1], x1 - c.ORIGIN[0], y1 - c.ORIGIN[1])
    parcels = [g.buffer(0) for _, g in rs.ign("CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle")]
    parcels = [p for p in parcels if not p.is_empty and p.intersects(zone)]
    P = unary_union(parcels)
    D = zone.difference(P).difference(B).buffer(-0.05).buffer(0.05)
    print(f"{len(parcels)} parcelles ; espace public {D.area / 1e4:.1f} ha")

    ortho = rs.Ortho()
    grid = Grid(ortho)
    cls = classify(ortho.rgb)
    public = grid.mask([D])
    print("orthophoto et masques prêts")

    osm = rs.osm()
    ways = osm.ways_with_geometry()
    rs.ign("BDTOPO_V3:troncon_de_route")
    routes = sl.load_bd_routes(rs.IGN_DIR / "BDTOPO_V3_troncon_de_route.json")
    sl.MEASURED = sl.MEASURED.with_name("__none__.json")  # mesurer à partir des largeurs d'origine
    streets = sl.build_street_list(ways, routes, 1)
    sl.MEASURED = sl.MEASURED.with_name("measured_widths.json")
    _, drivable_kinds = sl.classes(1)
    tags_of = {w["id"]: w["tags"] for w in ways}

    def line(s):
        return LineString(np.array(s["pts"]).reshape(-1, 2))

    def is_lot(s):
        t = tags_of.get(s["id"], {})
        return t.get("service") == "parking_aisle" or t.get("name") == "Place du Champ de Mars"

    carr = [s for s in streets if s["kind"] in drivable_kinds and s["motor"] and not s["tunnel"]]
    lots = [s for s in carr if is_lot(s)]
    drivable = [s for s in carr if not is_lot(s)]

    # --- Largeurs : emprise publique (cadastre) et enrobé (orthophoto) en travers, tous les 6 m --------------------------------
    measured, stats = {}, Counter()
    in_public = {}
    offs = np.arange(-15, 15.01, 0.5)
    c0 = len(offs) // 2
    for s in drivable:
        ln = line(s)
        if ln.length < 8:
            in_public[s["id"]] = False
            continue
        cws, aws, inside = [], [], 0
        n = 0
        for d in np.arange(4.0, ln.length - 3.9, SAMPLE):
            n += 1
            p, q = ln.interpolate(d), ln.interpolate(min(d + 0.5, ln.length))
            tx, ty = q.x - p.x, q.y - p.y
            L = math.hypot(tx, ty) or 1.0
            nx, ny = -ty / L, tx / L
            pub = [grid.at(public, p.x + nx * o, p.y + ny * o) for o in offs]
            if not pub[c0]:
                continue
            inside += 1
            k, _ = runs(pub, c0)
            cw = k * 0.5
            if cw >= 20:
                continue  # place, parvis ou carrefour : pas une rue, on n'y mesure rien
            cws.append(cw)
            asph = [grid.at(cls, p.x + nx * o, p.y + ny * o) == 1 and pub[i] for i, o in enumerate(offs)]
            ka, _ = runs(asph, c0)
            if ka:
                aws.append(ka * 0.5)
        frac = inside / n if n else 0
        in_public[s["id"]] = frac >= 0.6
        base = s["width"]
        if frac < 0.6 or len(cws) < max(2, 0.4 * n):
            stats["largeur_d_origine"] += 1
            continue
        cw = float(np.median(cws))
        w = base
        if len(aws) >= 0.5 * len(cws) and s["widthSource"] == "type":
            aw = float(np.median(aws))
            # L'enrobé ne corrige qu'une largeur type (BD TOPO a mesuré les autres), s'il se distingue des trottoirs (sinon les trottoirs sont en
            # enrobé eux aussi) et dans des bornes prudentes : les files des voitures (navigation) en dépendent.
            if 3.0 <= aw <= cw - 1.6 and base - 2.0 <= aw <= base + 3.0:
                w = aw
                stats["enrobe"] += 1
        # Rue étroite : les trottoirs disparaissent d'abord (rue partagée) ; la chaussée ne rétrécit que si l'emprise elle-même est plus
        # étroite qu'elle (vieille ville), et ne descend pas sous le minimum de sa classe tant que l'emprise le permet.
        lo = MIN_W.get(s["kind"], 3.0) if s["oneway"] == 0 else min(MIN_W.get(s["kind"], 3.0), 3.0)
        w = min(max(w, min(lo, cw)), cw)
        if abs(w - base) >= 0.3:
            measured[str(s["id"])] = round(w, 1)
            stats["corrigees"] += 1
        s["width"] = round(w, 1)
        stats["mesurees"] += 1
    sl.MEASURED.write_text(json.dumps({"version": 1, "about": "largeurs de chaussée (m) par voie OpenStreetMap, build_public_space.py (D94)",
                                       "widths": dict(sorted(measured.items(), key=lambda kv: int(kv[0])))}, indent=0))
    print(f"largeurs : {dict(stats)}")

    # --- Chaussées ------------------------------------------------------------------------------------------------------------
    Dclip = D.buffer(0.3)
    by_surface = {"asphalt": [], "sett": [], "gravel": [], "paving": []}
    for s in drivable:
        g = line(s).buffer(s["width"] / 2, cap_style="flat", join_style="round")
        if in_public.get(s["id"]):
            g = g.intersection(Dclip)
        by_surface[SURFACE.get(s["surface"] or "asphalt", "asphalt")].append(g)
    roads, taken = {}, Polygon()
    for cls_name in ("asphalt", "sett", "paving", "gravel"):
        if not by_surface[cls_name]:
            continue
        g = unary_union(by_surface[cls_name])
        g = g.buffer(1.0, join_style="round").buffer(-1.0, join_style="round")
        g = g.difference(B).difference(taken).difference(WATER)
        roads[cls_name] = g
        taken = taken.union(g)
    R = unary_union(list(roads.values()))
    print("chaussées", round(R.area / 1e4, 1), "ha")

    # --- Places, rues piétonnes, parkings (OpenStreetMap) --------------------------------------------------------------------
    plazas = {"paving": [], "sett": [], "gravel": [], "asphalt": []}
    parkings = []
    lawns = []
    for s in streets:
        if s["kind"] in ("pedestrian", "living_street") and not s["motor"]:
            plazas[SURFACE.get(s["surface"] or "paving", "paving")].append(line(s).buffer(max(s["width"], 3.0) / 2 + 1.0))
    for typ, oid, t, g in osm.areas():
        if not g.intersects(zone):
            continue
        if t.get("highway") == "pedestrian" and t.get("area") == "yes":
            plazas[SURFACE.get(t.get("surface"), "paving")].append(g)
        if t.get("amenity") == "parking" and t.get("parking") not in ("underground", "multi-storey"):
            parkings.append(g)
            plazas["gravel" if t.get("surface") in ("gravel", "compacted", "fine_gravel") else "asphalt"].append(g)
        if t.get("landuse") in ("grass", "meadow", "village_green", "recreation_ground", "flowerbed") or t.get("leisure") in ("park", "garden", "playground") \
                or t.get("natural") == "grassland":
            lawns.append(g)
    if lots:
        lot = unary_union([line(s).buffer(s["width"] / 2 + 0.5) for s in lots]).buffer(14.0).buffer(-11.0)
        filled = unary_union([Polygon(p.exterior) for p in rs.as_polygons(lot)]) if not lot.is_empty else Polygon()
        filled = filled.difference(R.buffer(0.2)).difference(B.buffer(0.3))
        plazas["asphalt"].append(filled)
        parkings.append(filled)
    PK = unary_union(parkings) if parkings else Polygon()
    PED = unary_union(plazas["paving"] + plazas["sett"]) if plazas["paving"] or plazas["sett"] else Polygon()

    # Îlots des ronds-points : l'intérieur d'une boucle de rond-point.
    for s in drivable:
        t = tags_of.get(s["id"], {})
        if t.get("junction") in ("roundabout", "circular"):
            ln = line(s)
            if ln.is_ring or ln.coords[0] == ln.coords[-1]:
                lawns.append(Polygon(ln.coords).buffer(-s["width"] / 2 - 0.3))

    # --- Trottoirs : l'espace public le long des chaussées, jusqu'aux façades et clôtures -------------------------------------
    W = R.buffer(SIDEWALK_MAX, join_style="round").intersection(D).difference(R).difference(PK.buffer(0.5)).difference(PED).difference(WATER)
    # Accotements enherbés : l'herbe de l'orthophoto dans la bande des trottoirs.
    grass = grid.polygons(ndimage.binary_opening(cls == 5, iterations=2) & grid.mask([W]))
    verges = grass.intersection(W).buffer(-0.5).buffer(0.5)
    W = W.difference(verges).buffer(-SIDEWALK_MIN / 2).buffer(SIDEWALK_MIN / 2).intersection(D).difference(R)
    print("trottoirs", round(W.area / 1e4, 1), "ha ; accotements", round(verges.area / 1e4, 1), "ha")

    # --- Le reste de l'espace public : places, pelouses, parkings d'après l'orthophoto ----------------------------------------
    rest = D.difference(R).difference(W).difference(verges).difference(WATER).difference(PK).difference(PED)
    rest_mask = grid.mask([rest])
    for name, k in (("lawn", 5), ("gravel", 4), ("asphalt", 1), ("paving", 0)):
        m = ndimage.binary_opening(ndimage.binary_closing((cls == k) & rest_mask, iterations=1), iterations=1)
        lab, nlab = ndimage.label(m)
        if nlab:
            sizes = ndimage.sum(m, lab, range(1, nlab + 1))
            m = np.isin(lab, [i + 1 for i, sz in enumerate(sizes) if sz >= 40])  # 10 m² au moins
        g = grid.polygons(m).buffer(0.8).buffer(-0.8).intersection(rest)
        if name == "lawn":
            lawns.append(g)
        else:
            plazas[name].append(g)

    layers = {}
    for cls_name, g in roads.items():
        layers[f"road_{cls_name}"] = clean(g.simplify(0.12))
    P_ = {}
    taken = unary_union([R, B, W])
    for name in ("asphalt", "sett", "gravel", "paving"):
        if not plazas[name]:
            continue
        g = unary_union([p.buffer(0) for p in plazas[name]]).difference(taken).difference(WATER).buffer(-0.4).buffer(0.4).difference(taken)
        P_[name] = g
        taken = taken.union(g)
    for name, g in P_.items():
        layers[f"plaza_{name}"] = clean(g.buffer(2.0, join_style="round").buffer(-2.0, join_style="round").simplify(0.6), 12.0)
    layers["walk"] = clean(W.simplify(0.1))
    covered = unary_union([R, B, W] + list(P_.values()))
    L = unary_union([g.buffer(0) for g in lawns] + [verges]).difference(covered).difference(WATER)
    layers["lawn"] = clean(L.simplify(0.3), 4.0)
    pitches = [g for typ, oid, t, g in osm.areas() if t.get("leisure") == "pitch" and g.intersects(zone)]
    if pitches:
        layers["pitch"] = clean(unary_union(pitches).difference(R).difference(B).difference(W).simplify(0.3), 8.0)
    layers["marks"] = clean(markings(drivable, lots, R, PK, tiles, tags_of, line), 0.05)
    print({k: (len(v), round(sum(p.area for p in v))) for k, v in layers.items()})

    # --- Clôtures de parcelle sur la rue -----------------------------------------------------------------------------------
    fences = parcel_fences(parcels, D, B, R, PK, osm, zone)
    print(f"clôtures : {len(fences)} tronçons, {sum(f['len'] for f in fences) / 1000:.1f} km")

    # --- Lampadaires : le long des chaussées, sur les nouveaux trottoirs ------------------------------------------------------
    lamps = place_lamps(drivable, W, B, line)

    # --- Écriture des tuiles --------------------------------------------------------------------------------------------------
    encoded = {k: [encode(p) for p in v] for k, v in layers.items()}
    counts = Counter()
    total = 0
    by_tile_fences, by_tile_lamps = {}, {}
    gx, gy = world["gridOrigin"]
    size = world["tileSize"]

    def tile_at(x, y):
        return f"{math.floor((x - gx) / size)}_{math.floor((y - gy) / size)}"

    for i, f in enumerate(fences):
        by_tile_fences.setdefault(tile_at(f["pts"][0], f["pts"][1]), []).append(
            {"id": -(FENCE_ID + i + 1), "kind": f["kind"], "height": f["height"], "measured": f["height"], "pts": f["pts"]})
    for i, (x, y, rot) in enumerate(lamps):
        by_tile_lamps.setdefault(tile_at(x, y), []).append({"kind": "street_lamp", "x": x, "y": y, "name": None, "id": -(LAMP_ID + i + 1), "rot": rot})
    manifest = {m["id"]: m for m in world["tiles"]}
    for tid, rec in tiles.items():
        bounds = rec["bounds"]
        stairs = [z for z in manual["stairs"] if z["bbox"][0] < bounds[2] and z["bbox"][2] > bounds[0] and z["bbox"][1] < bounds[3] and z["bbox"][3] > bounds[1]]
        rec["ground"] = clip_layers(encoded, bounds, stairs)
        rec["walls"] = [w for w in rec["walls"] if w["id"] > -FENCE_ID] + by_tile_fences.get(tid, [])
        # Les lampadaires d'OpenStreetMap restent ; ceux que la chaîne avait posés (identifiants négatifs) sont replacés.
        rec["furniture"] = [f for f in rec["furniture"] if not (f["kind"] == "street_lamp" and f["id"] < 0)] + by_tile_lamps.get(tid, [])
        for k, v in roadside.settle(rec).items():
            counts[k] += v
        text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        (c.OUT / "tiles" / f"{tid}.json").write_text(text)
        total += len(text)
        m = manifest[tid]
        m["walls"], m["furniture"], m["trees"], m["bytes"] = len(rec["walls"]), len(rec["furniture"]), len(rec["trees"]), len(text)
    (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"tuiles réécrites : {total / 1e6:.1f} Mo ; bords de chaussée : {dict(counts)}")


def clean(geom, min_area=0.6):
    return [p for p in rs.as_polygons(geom.buffer(0)) if p.area >= min_area]


def encode(p):
    def ring(r):
        return [round(v, 2) for xy in list(r.coords)[:-1] for v in xy]
    return [ring(p.exterior)] + [ring(r) for r in p.interiors]


def markings(drivable, lots, R, PK, tiles, tags_of, line):
    """Marquages : axe discontinu des rues à double sens d'au moins 5,4 m, lignes de rive des grandes routes, passages piétons, places
    de stationnement dans les parkings (comme build_ground.py), lignes d'arrêt aux stops et cédez-le-passage."""
    marks = []
    for s in drivable:
        ln = line(s)
        if ln.length < 20:
            continue
        if s["width"] >= 5.4 and s["oneway"] == 0 and s["kind"] != "service":
            d = 4.0
            while d + 2.0 < ln.length - 4.0:
                seg = substring(ln, d, d + 2.0)
                if seg.geom_type == "LineString" and seg.length > 1:
                    marks.append(seg.buffer(0.07, cap_style="flat"))
                d += 6.0
        if s["kind"] in ("primary", "secondary") and s["width"] >= 6.0:
            for side in (1, -1):
                off = ln.offset_curve(side * (s["width"] / 2 - 0.35))
                if not off.is_empty:
                    marks.append(off.buffer(0.06, cap_style="flat"))
    Rp = prep(R)
    crossings = [f for t in tiles.values() for f in t["furniture"] if f["kind"] == "crossing"]
    stops = [f for t in tiles.values() for f in t["furniture"] if f["kind"] in ("stop", "give_way")]

    def across(f, s, ln, bar, gap, half_only=False):
        p = Point(f["x"], f["y"])
        d = ln.project(p)
        q = ln.interpolate(d)
        q2, q1 = ln.interpolate(min(d + 1.0, ln.length)), ln.interpolate(max(d - 1.0, 0))
        tx, ty = q2.x - q1.x, q2.y - q1.y
        L = math.hypot(tx, ty)
        if L < 1e-6:
            return []
        tx, ty = tx / L, ty / L
        nx, ny = -ty, tx
        half = s["width"] / 2 - 0.3
        out = []
        if bar:
            u = -half + 0.25
            while u < half:
                cx, cy = q.x + nx * u, q.y + ny * u
                out.append(Polygon([(cx - tx * 1.5 - nx * 0.25, cy - ty * 1.5 - ny * 0.25), (cx + tx * 1.5 - nx * 0.25, cy + ty * 1.5 - ny * 0.25),
                                    (cx + tx * 1.5 + nx * 0.25, cy + ty * 1.5 + ny * 0.25), (cx - tx * 1.5 + nx * 0.25, cy - ty * 1.5 + ny * 0.25)]))
                u += gap
        else:
            u0 = 0.0 if half_only else -half
            out.append(LineString([(q.x + nx * u0, q.y + ny * u0), (q.x + nx * half, q.y + ny * half)]).buffer(0.25, cap_style="flat"))
        return out

    def nearest(f):
        p = Point(f["x"], f["y"])
        best = None
        for s in drivable:
            ln = line(s)
            dist = ln.distance(p)
            if dist < 3.0 and (best is None or dist < best[0]):
                best = (dist, ln, s)
        return best

    for f in crossings:
        b = nearest(f)
        if b:
            marks.extend(across(f, b[2], b[1], True, 0.9))
    for f in stops:
        b = nearest(f)
        if b:
            marks.extend(across(f, b[2], b[1], False, 0, half_only=b[2]["oneway"] == 0))
    mk = unary_union(marks).intersection(R.buffer(-0.1))
    bays = []
    if not PK.is_empty:
        for s in drivable + lots:
            ln = line(s)
            if ln.length < 8 or ln.intersection(PK).length < 0.6 * ln.length:
                continue
            d = 2.0
            while d < ln.length - 1.5:
                q, q2 = ln.interpolate(d), ln.interpolate(min(d + 0.5, ln.length))
                tx, ty = q2.x - q.x, q2.y - q.y
                L = math.hypot(tx, ty) or 1.0
                nx, ny = -ty / L, tx / L
                for side in (1, -1):
                    a = (q.x + nx * side * (s["width"] / 2 + 0.1), q.y + ny * side * (s["width"] / 2 + 0.1))
                    b = (a[0] + nx * side * 4.8, a[1] + ny * side * 4.8)
                    bays.append(LineString([a, b]).buffer(0.05, cap_style="flat"))
                d += 2.5
    if bays:
        mk = mk.union(unary_union(bays).intersection(PK).difference(R.buffer(0.05)))
    del Rp
    return mk


def parcel_fences(parcels, D, B, R, PK, osm, zone):
    """Limites de parcelle sur l'espace public sans bâtiment : mur (vieille ville, souvent), grille ou haie. Interrompues aux accès
    (toute voie ou chemin qui entre dans la parcelle) et, au milieu des longs tronçons, d'un portillon d'1,2 m."""
    Dn = D.buffer(0.3)
    gaps = unary_union([ln.buffer(2.5) for ln in (osm.way_line(wid) for wid, w in osm.ways.items() if w["tags"].get("highway")) if ln is not None]
                       + [B.buffer(0.6), PK.buffer(0.5)])
    gaps_p = prep(gaps)
    Dp = prep(Dn)
    out = []
    for p in parcels:
        if p.area > 20000 or p.area < 40 or not p.intersects(zone):
            continue
        if not Dp.intersects(p):
            continue
        front = p.exterior.intersection(Dn)
        if front.is_empty:
            continue
        if gaps_p.intersects(front):
            front = front.difference(gaps)
        lines = [g for g in getattr(front, "geoms", [front]) if g.geom_type == "LineString"]
        if isinstance(front, MultiLineString):
            from shapely.ops import linemerge
            merged = linemerge(front)
            lines = [g for g in getattr(merged, "geoms", [merged]) if g.geom_type == "LineString"]
        key = zlib.crc32(f"{p.centroid.x:.1f},{p.centroid.y:.1f}".encode()) / 2**32
        old = math.hypot(p.centroid.x - CENTER[0], p.centroid.y - CENTER[1]) < 650
        kind = ("wall" if key < 0.8 else "fence") if old else ("wall" if key < 0.35 else "fence" if key < 0.75 else "hedge")
        height = {"wall": 2.0 if old else 1.1, "fence": 1.5, "hedge": 1.4}[kind]
        for ln in lines:
            ln = ln.simplify(0.2)
            if ln.length < 1.5:
                continue
            pieces = [ln]
            if ln.length > 7:
                m = ln.length / 2
                pieces = [substring(ln, 0, m - 0.6), substring(ln, m + 0.6, ln.length)]
            for q in pieces:
                if q.geom_type == "LineString" and q.length >= 1.0:
                    out.append({"kind": kind, "height": height, "len": q.length, "pts": [round(v, 2) for xy in q.coords for v in xy]})
    return out


def place_lamps(drivable, W, B, line):
    lamps = []
    Wp = prep(W)
    Bp = prep(B)
    for s in drivable:
        if s["kind"] == "service" or s["width"] < 3.0:
            continue
        ln = line(s)
        side = 1
        d = 12.0
        while d < ln.length - 6.0:
            q, q2 = ln.interpolate(d), ln.interpolate(min(d + 1.0, ln.length))
            tx, ty = q2.x - q.x, q2.y - q.y
            L = math.hypot(tx, ty) or 1.0
            nx, ny = -ty / L, tx / L
            for off_side in (side, -side):
                px, py = q.x + nx * off_side * (s["width"] / 2 + 0.7), q.y + ny * off_side * (s["width"] / 2 + 0.7)
                pt = Point(px, py)
                if Wp.contains(pt) and not Bp.intersects(pt.buffer(0.6)) and all(math.hypot(px - l[0], py - l[1]) > 12 for l in lamps[-40:]):
                    lamps.append((round(px, 2), round(py, 2), round(math.atan2(-ny * off_side, -nx * off_side), 3)))
                    break
            side = -side
            d += LAMP_STEP
    return lamps


if __name__ == "__main__":
    main()
