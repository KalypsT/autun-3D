"""Rues, carte des sols, murs et mobilier urbain.

Usage : python3 tools/data/build_streets.py

Sorties dans public/data/ :
  streets.json  voies (axe, nom, sens, revêtement, largeur de chaussée, trottoir) et nœuds OSM pour le graphe
  .cache/work/global/ground_{a,b}.png, ground.json   poids de mélange des sols à 1 m (cf. export_weights) ; classes à 0,5 m dans .cache/work/ground.npy
  .cache/work/props.json   murs (hauteur mesurée au LiDAR), mobilier : découpés par tuile par build_tiles.py
Les largeurs viennent de BD TOPO quand un tronçon correspond, sinon de valeurs types : champ `widthSource`.
"""

import json
import math
import re

import numpy as np
import shapely
from PIL import Image
from pyproj import Transformer
from scipy import ndimage
from shapely.affinity import translate
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

import common
import config as c

to_l93 = Transformer.from_crs(4326, 2154, always_xy=True)

# Classes de sol (indices de la palette de ground.png).
GROUND = {
    "paving": 0,      # dalles, sol urbain clair par défaut
    "asphalt": 1,
    "sidewalk": 2,
    "sett": 3,        # pavés
    "gravel": 4,
    "grass": 5,
    "building": 6,    # dessous des bâtiments : jamais vu
    "paving_stones": 7,
}
PALETTE = {0: (170, 165, 155), 1: (70, 70, 74), 2: (150, 148, 142), 3: (120, 112, 104), 4: (190, 175, 150),
           5: (80, 120, 60), 6: (30, 30, 30), 7: (160, 150, 140)}

DRIVABLE = {"residential", "tertiary", "secondary", "unclassified", "service", "living_street"}
WALKABLE = {"pedestrian", "footway", "path", "steps", "living_street"}
DEFAULT_WIDTH = {"tertiary": 6.5, "secondary": 7.0, "residential": 5.0, "unclassified": 4.5, "service": 3.5,
                 "living_street": 4.0, "pedestrian": 4.0, "footway": 1.8, "path": 1.2, "steps": 1.8}
SURFACE_CLASS = {"asphalt": "asphalt", "concrete": "paving", "sett": "sett", "paving_stones": "paving_stones",
                 "unhewn_cobblestone": "sett", "compacted": "gravel", "gravel": "gravel", "cobblestone": "sett"}
NAME_FIX = {"Rue de l'Hotel de Ville": "Rue de l'Hôtel de Ville"}
SIDEWALK_W = 2.0


def local(lon, lat):
    x, y = to_l93.transform(lon, lat)
    return x - c.ORIGIN[0], y - c.ORIGIN[1]


def way_line(e):
    return [local(g["lon"], g["lat"]) for g in e["geometry"]]


def export_weights(ground):
    """Carte des sols du jeu (grille globale intermédiaire, découpée par tuile par pack.py) : poids de mélange à 1 m en deux PNG RVB (A : asphalte, pavés, gravier ; B : herbe, trottoir,
    occlusion près des murs). Le dallage est le complément à 1. Aucun canal alpha : le navigateur ne le prémultiplie pas."""
    H, W = ground.shape
    h, w = H // 2, W // 2

    def frac(k):
        return (ground[: 2 * h, : 2 * w] == GROUND[k]).reshape(h, 2, w, 2).mean(axis=(1, 3)).astype(np.float32)

    building = frac("building")
    soft = ndimage.uniform_filter(ndimage.uniform_filter(building, 5), 5)
    ao = np.clip(soft * 2.2, 0, 1) * (building < 0.5)
    a = np.stack([frac("asphalt"), frac("sett"), frac("gravel")], axis=-1)
    b = np.stack([frac("grass"), frac("sidewalk"), ao], axis=-1)
    for name, arr in (("ground_a.png", a), ("ground_b.png", b)):
        Image.fromarray((arr * 255).round().astype(np.uint8)).save(c.GLOBAL / name, optimize=True)
    (c.GLOBAL / "ground.json").write_text(json.dumps({
        "cols": w, "rows": h, "res": 1.0, "x0": c.GRID_X0 - c.ORIGIN[0], "y1": c.GRID_Y1 - c.ORIGIN[1]}))


def main():
    osm = json.load(open(c.CACHE / "raw" / "osm.json"))["elements"]
    ways = [e for e in osm if e["type"] == "way" and "geometry" in e and "tags" in e]
    H, W = c.GRID_H, c.GRID_W
    def rasterize(geom):
        """Masque (H, W) de la grille 0,5 m couvert par geom (coordonnées locales)."""
        return common.polygon_mask([geom], local=True)

    # --- Bâtiments (masque) -------------------------------------------------------------
    bld = unary_union([translate(g, -c.ORIGIN[0], -c.ORIGIN[1]) for _, g in common.bdtopo_buildings()])
    bmask = rasterize(bld)

    # --- Largeurs BD TOPO ---------------------------------------------------------------
    bd_routes = []
    for f in json.load(open(c.CACHE / "raw" / "bdtopo_route.json"))["features"]:
        p = f["properties"]
        if f["geometry"]["type"] != "LineString" or p.get("largeur_de_chaussee") is None:
            continue
        coords = [(x - c.ORIGIN[0], y - c.ORIGIN[1]) for x, y, *_ in f["geometry"]["coordinates"]]
        bd_routes.append((LineString(coords), float(p["largeur_de_chaussee"]), p.get("sens_de_circulation")))

    def bd_width(line):
        mids = [line.interpolate(t, normalized=True) for t in (0.25, 0.5, 0.75)]
        best = None
        for rl, w, _ in bd_routes:
            d = np.mean([rl.distance(m) for m in mids])
            if d < 4.0 and (best is None or d < best[0]):
                best = (d, w)
        return best[1] if best else None

    # --- Voies --------------------------------------------------------------------------
    streets = []
    for e in ways:
        t = e["tags"]
        hw = t.get("highway")
        if not hw or t.get("area") == "yes" or hw not in DEFAULT_WIDTH:
            continue
        if t.get("footway") == "crossing":
            continue
        pts = way_line(e)
        if len(pts) < 2:
            continue
        line = LineString(pts)
        motor = hw in DRIVABLE and t.get("motor_vehicle") not in ("no", "private") and t.get("access") != "private"
        oneway = 0
        if t.get("oneway") in ("yes", "true", "1"):
            oneway = 1
        elif t.get("oneway") == "-1":
            oneway = -1
        bd = bd_width(line) if hw in DRIVABLE else None
        width = bd if bd else DEFAULT_WIDTH[hw]
        if t.get("lanes") and t["lanes"].isdigit() and not bd:
            width = max(width, 3.0 * int(t["lanes"]))
        name = NAME_FIX.get(t.get("name"), t.get("name"))
        streets.append({
            "id": e["id"], "name": name, "kind": hw, "motor": bool(motor),
            "oneway": oneway, "surface": t.get("surface"), "width": round(width, 1),
            "widthSource": "bdtopo" if bd else "type",
            "maxspeed": int(t["maxspeed"]) if t.get("maxspeed", "").isdigit() else None,
            "lanes": int(t["lanes"]) if t.get("lanes", "").isdigit() else None,
            "tunnel": t.get("tunnel") == "building_passage",
            "calming": t.get("traffic_calming"),
            "nodes": e["nodes"], "pts": [round(v, 2) for p in pts for v in p],
        })

    # --- Carte des sols -----------------------------------------------------------------
    rgb = common.ortho().astype(np.float32)
    luma = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    exg = 2 * rgb[..., 1] - rgb[..., 0] - rgb[..., 2]
    mnh = np.nan_to_num(common.raster("MNH"), nan=0.0)
    canopy = (mnh > 2.0) & ~bmask
    canopy = ndimage.binary_dilation(canopy, iterations=1)

    ortho_cls = np.full((H, W), GROUND["paving"], np.uint8)
    ortho_cls[(luma < 105) & (sat < 45)] = GROUND["asphalt"]
    ortho_cls[(luma >= 105) & (luma < 175) & (sat >= 18)] = GROUND["gravel"]
    ortho_cls[(exg > 18) & (rgb[..., 1] > rgb[..., 0])] = GROUND["grass"]
    # Sous les arbres on ne voit que le feuillage : on reprend la classe voisine.
    idx = ndimage.distance_transform_edt(canopy | bmask, return_distances=False, return_indices=True)
    ortho_cls = ortho_cls[tuple(idx)]
    # Vote majoritaire sur ~3,5 m pour gommer voitures, ombres et marquages.
    votes = np.stack([ndimage.uniform_filter((ortho_cls == k).astype(np.float32), size=7) for k in range(8)])
    ground = np.argmax(votes, axis=0).astype(np.uint8)
    ground[ground == GROUND["building"]] = GROUND["paving"]
    ground[ground == GROUND["sett"]] = GROUND["paving"]

    # Parkings : gravier ou asphalte selon l'orthophoto, jamais d'herbe.
    parking = np.zeros((H, W), bool)
    for e in ways:
        t = e["tags"]
        if t.get("amenity") == "parking" and len(e["geometry"]) >= 4:
            m = rasterize(Polygon(way_line(e))) & ~bmask
            parking |= m
            if m.any():
                # Un parking est en enrobé sauf si sa couleur médiane (les voitures n'y pèsent pas) est franchement sableuse.
                med = np.median(rgb[m], axis=0)
                sandy = med[0] - med[2] > 22 and med.mean() > 120
                ground[m] = GROUND["gravel"] if sandy else GROUND["asphalt"]

    drivable = [s for s in streets if s["kind"] in DRIVABLE]
    walkways = [s for s in streets if s["kind"] in ("pedestrian", "footway", "path", "steps")]
    carriage = unary_union([LineString(np.array(s["pts"]).reshape(-1, 2)).buffer(s["width"] / 2, cap_style="flat")
                            for s in drivable if s["motor"] and not s["tunnel"]])
    cmask = rasterize(carriage)
    # Loin de toute route et de tout bâtiment (plus de 14 m) : champ ou jardin, donc herbe (l'orthophoto d'été montre du foin sec).
    far = ndimage.distance_transform_edt(~(cmask | bmask)) * c.RES > 14.0
    ground[far & ~bmask & ~parking] = GROUND["grass"]
    # Trottoirs : sol libre à moins de SIDEWALK_W du bord de chaussée, hors herbe et parking.
    side = rasterize(carriage.buffer(SIDEWALK_W)) & ~cmask & ~bmask & (ground != GROUND["grass"]) \
        & (ground != GROUND["gravel"])
    ground[side] = GROUND["sidewalk"]

    # Rues piétonnes : toute la largeur libre, dans leur revêtement.
    for s in streets:
        if s["kind"] in ("pedestrian", "living_street") and not s["motor"]:
            m = rasterize(LineString(np.array(s["pts"]).reshape(-1, 2)).buffer(max(s["width"], 3.0) / 2 + 1.5)) & ~bmask
            ground[m] = GROUND[SURFACE_CLASS.get(s["surface"], "paving_stones") if SURFACE_CLASS.get(s["surface"]) in GROUND else "paving"]
    for e in ways:
        t = e["tags"]
        if t.get("highway") == "pedestrian" and t.get("area") == "yes":
            m = rasterize(Polygon(way_line(e))) & ~bmask
            ground[m] = GROUND[SURFACE_CLASS.get(t.get("surface"), "paving")]
    for s in walkways:
        if s["kind"] in ("footway", "path") and s["surface"] in SURFACE_CLASS:
            m = rasterize(LineString(np.array(s["pts"]).reshape(-1, 2)).buffer(s["width"] / 2)) & ~bmask
            ground[m] = GROUND[SURFACE_CLASS[s["surface"]]]
    # Chaussées par-dessus, selon leur revêtement.
    for s in sorted(drivable, key=lambda s: -s["width"]):
        if not s["motor"] or s["tunnel"]:
            continue
        m = rasterize(LineString(np.array(s["pts"]).reshape(-1, 2)).buffer(s["width"] / 2, cap_style="flat"))
        cls = SURFACE_CLASS.get(s["surface"] or "asphalt", "asphalt")
        ground[m & ~bmask] = GROUND[cls if cls in GROUND else "asphalt"]
    ground[bmask] = GROUND["building"]

    work = c.CACHE / "work"
    work.mkdir(parents=True, exist_ok=True)
    np.save(work / "ground.npy", ground)
    c.OUT.mkdir(parents=True, exist_ok=True)
    c.GLOBAL.mkdir(parents=True, exist_ok=True)
    export_weights(ground)

    # --- Murs, mobilier -----------------------------------------------------------------
    mns, mnt = common.raster("MNS"), common.raster("MNT")
    above = np.nan_to_num(mns - mnt, nan=0.0)

    def height_at(x, y):
        col, row = common.world_to_pixel(x + c.ORIGIN[0], y + c.ORIGIN[1])
        r, q = int(row), int(col)
        patch = above[max(r - 1, 0):r + 2, max(q - 1, 0):q + 2]
        return float(patch.max()) if patch.size else 0.0

    walls = []
    for e in ways:
        t = e["tags"]
        if t.get("barrier") in ("wall", "fence", "retaining_wall", "gate") and "building" not in t:
            pts = way_line(e)
            line = LineString(pts)
            hs = [height_at(*line.interpolate(d).coords[0]) for d in np.arange(0, line.length, 1.0)] or [0.0]
            h = float(np.median(hs))
            if t.get("height"):
                try:
                    h = float(t["height"])
                except ValueError:
                    pass
            walls.append({"id": e["id"], "kind": t["barrier"], "height": round(min(max(h, 0.5), 3.5), 1),
                          "measured": round(float(np.median(hs)), 2), "pts": [round(v, 2) for p in pts for v in p]})

    furniture = []
    keep = {("amenity", "bench"), ("amenity", "waste_basket"), ("amenity", "bicycle_parking"), ("amenity", "post_box"),
            ("amenity", "atm"), ("amenity", "drinking_water"), ("amenity", "public_bookcase"), ("amenity", "toilets"),
            ("barrier", "bollard"), ("historic", "memorial"), ("amenity", "fountain"), ("highway", "street_lamp"),
            ("highway", "crossing"), ("highway", "traffic_signals"), ("highway", "stop"), ("highway", "give_way")}
    for e in osm:
        if e["type"] != "node":
            continue
        t = e.get("tags", {})
        for k, v in t.items():
            if (k, v) in keep:
                x, y = local(e["lon"], e["lat"])
                furniture.append({"kind": v if k != "highway" else v, "x": round(x, 2), "y": round(y, 2),
                                  "name": t.get("name"), "id": e["id"]})
                break

    (c.OUT / "streets.json").write_text(json.dumps(streets, ensure_ascii=False, separators=(",", ":")))
    (c.CACHE / "work" / "props.json").write_text(json.dumps({"walls": walls, "furniture": furniture}, ensure_ascii=False,
                                                 separators=(",", ":")))
    counts = {k: int((ground == v).sum()) for k, v in GROUND.items()}
    print(f"{len(streets)} voies ({sum(s['motor'] for s in streets)} carrossables, "
          f"{sum(s['widthSource'] == 'bdtopo' for s in streets)} largeurs BD TOPO), {len(walls)} murs, "
          f"{len(furniture)} éléments de mobilier")
    print("sols (m²) :", {k: round(v * c.RES * c.RES) for k, v in counts.items()})


if __name__ == "__main__":
    main()
