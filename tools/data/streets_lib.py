"""Liste des voies (axes, sens, largeur, classe) construite depuis OpenStreetMap et BD TOPO.

Partagée entre le sol (`build_streets.py`, qui en tire chaussées, trottoirs et marquages) et la navigation (`build_nav.py`, étape J2),
pour que les deux voient exactement les mêmes voies, aux mêmes largeurs et dans le même sens.

Classes : `DEFAULT_WIDTH` et `DRIVABLE` sont celles que le sol dessine aujourd'hui. `EXTRA_WIDTH` (routes principales, pistes, voies cyclables)
n'est produite que si on la demande (`extra=True`) : la navigation en a besoin, le sol les dessinera quand `build_streets.DRAW_EXTRA` sera activé.
"""

import json

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString

import config as c

to_l93 = Transformer.from_crs(4326, 2154, always_xy=True)

DRIVABLE = {"residential", "tertiary", "secondary", "unclassified", "service", "living_street"}
WALKABLE = {"pedestrian", "footway", "path", "steps", "living_street"}
DEFAULT_WIDTH = {"tertiary": 6.5, "secondary": 7.0, "residential": 5.0, "unclassified": 4.5, "service": 3.5,
                 "living_street": 4.0, "pedestrian": 4.0, "footway": 1.8, "path": 1.2, "steps": 1.8}
# Classes que le sol ignorait jusqu'ici : les routes principales de l'anneau (avenue de la République, route de Beaune…) n'avaient ni chaussée ni marquages.
EXTRA_WIDTH = {"primary": 8.0, "road": 5.0, "track": 3.0, "cycleway": 2.0}
EXTRA_DRIVABLE = {"primary", "road"}
NAME_FIX = {"Rue de l'Hotel de Ville": "Rue de l'Hôtel de Ville"}

# Étiquettes OpenStreetMap conservées telles quelles sur chaque voie (la navigation en tire accès, ponts, ronds-points…).
KEPT_TAGS = ("highway", "access", "foot", "motor_vehicle", "bicycle", "bridge", "tunnel", "layer", "junction", "sidewalk", "service",
             "footway", "oneway", "ref", "lit", "surface", "priority_road", "cycleway")


def classes(extra: bool) -> tuple[dict[str, float], set[str]]:
    """(largeurs par défaut, classes carrossables) du sol ou, avec `extra`, de la navigation."""
    if not extra:
        return DEFAULT_WIDTH, DRIVABLE
    return {**DEFAULT_WIDTH, **EXTRA_WIDTH}, DRIVABLE | EXTRA_DRIVABLE


def local(lon, lat):
    x, y = to_l93.transform(lon, lat)
    return x - c.ORIGIN[0], y - c.ORIGIN[1]


def way_line(e):
    return [local(g["lon"], g["lat"]) for g in e["geometry"]]


def load_bd_routes(path):
    """Tronçons BD TOPO : (axe en coordonnées locales, attributs). `width` vaut None quand la largeur n'est pas renseignée."""
    routes = []
    for f in json.load(open(path))["features"]:
        p = f["properties"]
        if f["geometry"]["type"] != "LineString":
            continue
        coords = [(x - c.ORIGIN[0], y - c.ORIGIN[1]) for x, y, *_ in f["geometry"]["coordinates"]]
        width = p.get("largeur_de_chaussee")
        routes.append((LineString(coords), {
            "width": float(width) if width is not None else None,
            "sens": p.get("sens_de_circulation"),
            "speed": p.get("vitesse_moyenne_vl"),
            "lanes": p.get("nombre_de_voies"),
            "level": p.get("position_par_rapport_au_sol"),
            "importance": p.get("importance"),
            "nature": p.get("nature"),
            "private": bool(p.get("prive")),
            "bus": bool(p.get("reserve_aux_bus")),
            "ped": p.get("acces_pieton"),
        }))
    return routes


def match_bd(line, routes):
    """(attributs du tronçon le plus proche, attributs du plus proche qui donne une largeur) ; None si aucun à moins de 4 m en moyenne.

    La seconde valeur est ce que le sol a toujours utilisé pour la largeur ; la première sert aux autres attributs (vitesse, voies, niveau).
    """
    mids = [line.interpolate(t, normalized=True) for t in (0.25, 0.5, 0.75)]
    best_any = best_width = None
    for rl, p in routes:
        d = np.mean([rl.distance(m) for m in mids])
        if d >= 4.0:
            continue
        if best_any is None or d < best_any[0]:
            best_any = (d, p)
        if p["width"] is not None and (best_width is None or d < best_width[0]):
            best_width = (d, p)
    return (best_any[1] if best_any else None, best_width[1] if best_width else None)


def build_street_list(ways, routes, extra=False):
    """Voies carrossables et piétonnes de l'extrait OpenStreetMap, avec largeurs BD TOPO quand un tronçon correspond.

    Chaque voie : id, name, kind, motor, oneway (1 : sens des points, −1 : inverse, 0 : double), surface, width, widthSource, maxspeed, lanes,
    tunnel (passage couvert sous un bâtiment), calming, nodes (ids OpenStreetMap), pts (x0, y0, x1, y1…), plus `osm` (étiquettes conservées)
    et `bd` (attributs du tronçon BD TOPO le plus proche, ou None).
    """
    default_width, drivable = classes(extra)
    streets = []
    for e in ways:
        t = e["tags"]
        hw = t.get("highway")
        if not hw or t.get("area") == "yes" or hw not in default_width:
            continue
        if t.get("footway") == "crossing":
            continue
        pts = way_line(e)
        if len(pts) < 2:
            continue
        line = LineString(pts)
        motor = hw in drivable and t.get("motor_vehicle") not in ("no", "private") and t.get("access") != "private"
        oneway = 0
        if t.get("oneway") in ("yes", "true", "1"):
            oneway = 1
        elif t.get("oneway") == "-1":
            oneway = -1
        bd_any, bd_width = match_bd(line, routes) if hw in drivable else (None, None)
        bd = bd_width["width"] if bd_width else None
        width = bd if bd else default_width[hw]
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
            "osm": {k: t[k] for k in KEPT_TAGS if k in t},
            "bd": bd_any,
        })
    return streets
