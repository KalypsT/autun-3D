"""Vérifie l'accès et la couverture de chaque source pour la zone de la maquette.

Usage : python3 -I tools/data/probe_sources.py
Écrit un résumé JSON sur la sortie standard. Ne télécharge que des métadonnées
et de petits extraits (pas le nuage LiDAR complet).
"""

import json
import math
import sys
import time

import requests

# Zone de la maquette (WGS84) : quartier de la mairie, place du Champ de Mars.
LAT_MIN, LON_MIN, LAT_MAX, LON_MAX = 46.9488040, 4.2964430, 46.9516020, 4.3009710
# Même zone en Lambert-93 (EPSG:2154), arrondie au mètre.
L93 = (798601, 6650654, 798940, 6650970)
INSEE_AUTUN = "71014"
IRIS_CENTRE = "710140108"

USER_AGENT = "Autun3DMockup/0.1 (https://github.com/kalypst/autun-3d)"
TIMEOUT = 120

session = requests.Session()
session.headers["User-Agent"] = USER_AGENT


def get(url, **kwargs):
    """GET avec trois essais espacés (limites de débit, coupures)."""
    last = None
    for attempt in range(3):
        try:
            response = session.get(url, timeout=TIMEOUT, **kwargs)
            if response.status_code != 429:
                return response
            last = response
        except requests.RequestException as error:
            last = error
        time.sleep(5 * (attempt + 1))
    if isinstance(last, Exception):
        raise last
    return last


def probe(name, fn):
    try:
        return {"source": name, "ok": True, **fn()}
    except Exception as error:  # noqa: BLE001 - on rapporte toute erreur
        return {"source": name, "ok": False, "error": f"{type(error).__name__}: {error}"}


def osm():
    bbox = f"{LAT_MIN},{LON_MIN},{LAT_MAX},{LON_MAX}"
    query = f"[out:json][timeout:90];(way[building]({bbox});way[highway]({bbox});node[natural=tree]({bbox});nwr[shop]({bbox}););out tags;"
    response = session.post("https://overpass-api.de/api/interpreter", data={"data": query}, timeout=TIMEOUT)
    response.raise_for_status()
    elements = response.json()["elements"]
    tags = [e.get("tags", {}) for e in elements]
    return {
        "buildings": sum("building" in t for t in tags),
        "highways": sum("highway" in t for t in tags),
        "highways_with_width": sum("highway" in t and "width" in t for t in tags),
        "trees": sum(t.get("natural") == "tree" for t in tags),
        "shops": sum("shop" in t for t in tags),
    }


def wfs(type_name):
    response = get(
        "https://data.geopf.fr/wfs/ows",
        params={
            "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
            "TYPENAMES": type_name, "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154",
            "BBOX": f"{L93[0]},{L93[1]},{L93[2]},{L93[3]},urn:ogc:def:crs:EPSG::2154", "COUNT": 2000,
        },
    )
    response.raise_for_status()
    return response.json()["features"]


def bdtopo():
    features = [f["properties"] for f in wfs("BDTOPO_V3:batiment")]

    def filled(key):
        return sum(p.get(key) not in (None, "", "00") for p in features)

    return {
        "buildings": len(features),
        "with_height": filled("hauteur"),
        "with_levels": filled("nombre_d_etages"),
        "with_wall_material": filled("materiaux_des_murs"),
        "with_roof_material": filled("materiaux_de_la_toiture"),
        "with_date": filled("date_d_apparition"),
    }


def lidar():
    tiles = [f["properties"] for f in wfs("IGNF_LIDAR-HD_METADONNEE:metadata")]
    return {
        "tiles": [
            {
                "name": t["coordonnees_nw"],
                "points": t["nombre_points"],
                "acquired": t["date_debut_acquisition"],
                "classification": t["procede_classement"],
                "laz": t["url_npl"],
            }
            for t in tiles
        ]
    }


def ortho():
    features = [f["properties"] for f in wfs("ORTHOIMAGERY.ORTHOPHOTOS.GRAPHE-MOSAIQUAGE:graphe_bdortho")]
    return {"flights": sorted({(p["dep"], p["date_vol"], p["res"]) for p in features})}


def bdnb():
    response = get(
        "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet",
        params={"code_iris": f"eq.{IRIS_CENTRE}", "select": "batiment_groupe_id"},
        headers={"Prefer": "count=exact"},
    )
    response.raise_for_status()
    return {
        "iris_groups": response.headers.get("content-range", "?").split("/")[-1],
        "max_items_per_call": response.headers.get("x-max-items-per-call"),
        "quota_remaining": response.headers.get("x-quota-remaining"),
    }


def panoramax():
    bbox = f"{LON_MIN},{LAT_MIN},{LON_MAX},{LAT_MAX}"
    inside = get(f"https://api.panoramax.xyz/api/search?bbox={bbox}&limit=100").json()["features"]
    wide = get("https://api.panoramax.xyz/api/search?bbox=4.290,46.945,4.308,46.956&limit=1000").json()["features"]
    centre = ((LON_MIN + LON_MAX) / 2, (LAT_MIN + LAT_MAX) / 2)

    def distance(feature):
        lon, lat = feature["geometry"]["coordinates"]
        return math.hypot((lon - centre[0]) * 76_000, (lat - centre[1]) * 111_000)

    return {
        "pictures_in_zone": len(inside),
        "pictures_within_1km": len(wide),
        "nearest_m": round(min(map(distance, wide))) if wide else None,
    }


def commons():
    response = get(
        "https://commons.wikimedia.org/w/api.php",
        params={
            "action": "query", "list": "geosearch", "format": "json", "gsnamespace": 6, "gslimit": 500,
            "gsbbox": f"{LAT_MAX}|{LON_MIN}|{LAT_MIN}|{LON_MAX}",
        },
    )
    response.raise_for_status()
    return {"geotagged_files": len(response.json()["query"]["geosearch"])}


def reachable(url):
    def fn():
        response = get(url, allow_redirects=False)
        return {"status": response.status_code}

    return fn


if __name__ == "__main__":
    results = [
        probe("OpenStreetMap (Overpass)", osm),
        probe("IGN BD TOPO", bdtopo),
        probe("IGN LiDAR HD", lidar),
        probe("IGN BD ORTHO", ortho),
        probe("BDNB", bdnb),
        probe("Panoramax", panoramax),
        probe("Wikimedia Commons", commons),
        probe("POP (notice théâtre)", reachable("https://pop.culture.gouv.fr/notice/merimee/PA00113552")),
        probe("Poly Haven (API)", reachable("https://api.polyhaven.com/assets?t=textures")),
        probe("ambientCG (API)", reachable("https://ambientcg.com/api/v2/full_json?q=plaster&limit=1")),
        probe("ambientCG (téléchargement)", reachable("https://acg-download.struffelproductions.com/")),
    ]
    json.dump(results, sys.stdout, ensure_ascii=False, indent=2)
    print()
