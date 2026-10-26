"""Télécharge les données brutes dans .cache/ (hors git). Idempotent : ne retélécharge rien.

Usage : python3 tools/data/fetch.py [--force]
"""

import json
import sys
import time

import requests

import config as c

FORCE = "--force" in sys.argv
session = requests.Session()
session.headers["User-Agent"] = c.USER_AGENT


def download(url, dest, *, method="GET", optional=False, **kwargs):
    if dest.exists() and not FORCE:
        print(f"= {dest.relative_to(c.ROOT)}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(6):
        try:
            with session.request(method, url, stream=True, timeout=300, **kwargs) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            tmp.rename(dest)
            print(f"+ {dest.relative_to(c.ROOT)} ({dest.stat().st_size / 1e6:.1f} Mo)")
            return
        except requests.RequestException as error:
            print(f"  essai {attempt + 1} : {error}")
            time.sleep(min(60, 5 * 2**attempt))
    if optional and dest.exists():
        print(f"! {url} injoignable, on garde {dest.relative_to(c.ROOT)}")
        return
    raise SystemExit(f"échec : {url}")


def wfs(layer, dest):
    x0, y0, x1, y1 = c.MARGIN_BOX
    download(
        "https://data.geopf.fr/wfs/ows", dest,
        params={
            "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": layer,
            "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154",
            "BBOX": f"{x0},{y0},{x1},{y1},urn:ogc:def:crs:EPSG::2154", "COUNT": 5000,
        },
    )


def wms(layer, fmt, dest, scale=1):
    x0, y0, x1, y1 = c.MARGIN_BOX
    download(
        "https://data.geopf.fr/wms-r", dest,
        params={
            "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "",
            "FORMAT": fmt, "CRS": "EPSG:2154", "BBOX": f"{x0},{y0},{x1},{y1}",
            "WIDTH": c.GRID_W * scale, "HEIGHT": c.GRID_H * scale,
        },
    )


def overpass(dest):
    s, w, n, e = c.OSM_BBOX
    b = f"{s},{w},{n},{e}"
    query = (
        f"[out:json][timeout:120];("
        f"way[highway]({b});way[barrier]({b});way[natural]({b});way[leisure]({b});"
        f"way[landuse]({b});way[amenity]({b});way[area:highway]({b});way[man_made]({b});"
        f"way[building]({b});relation[building]({b});"
        f"node({b})[~\"^(amenity|shop|tourism|historic|natural|highway|barrier|man_made|leisure|crossing|kerb|heritage|addr:housenumber)$\"~\".\"];);out geom;"
    )
    download("https://overpass-api.de/api/interpreter", dest, method="POST", optional=True, data={"data": query})


def bdnb(dest):
    """Bâtiments de l'IRIS 710140108 (centre d'Autun) : l'API libre rend 10 lignes par appel."""
    if dest.exists() and not FORCE:
        print(f"= {dest.relative_to(c.ROOT)}")
        return
    select = ("batiment_groupe_id,annee_construction,mat_mur_txt,mat_toit_txt,nb_niveau,nb_log,hauteur_mean,"
              "usage_principal_bdnb_open,libelle_adr_principale_ban,denomination_monument_historique,"
              "distance_monument_historique,perimetre_bat_historique,geom_groupe")
    rows, offset = [], 0
    while True:
        r = session.get(
            "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet",
            params={"code_iris": "eq.710140108", "select": select, "order": "batiment_groupe_id", "limit": 10, "offset": offset},
            timeout=120,
        )
        if r.status_code == 429:
            time.sleep(30)
            continue
        r.raise_for_status()
        page = r.json()
        rows += page
        offset += 10
        if len(page) < 10:
            break
        time.sleep(0.4)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(rows, ensure_ascii=False))
    print(f"+ {dest.relative_to(c.ROOT)} ({len(rows)} groupes)")


if __name__ == "__main__":
    raw = c.CACHE / "raw"
    wfs("BDTOPO_V3:batiment", raw / "bdtopo_batiment.json")
    wfs("BDTOPO_V3:troncon_de_route", raw / "bdtopo_route.json")
    for name in ("MNT", "MNS", "MNH"):
        wms(f"IGNF_LIDAR-HD_{name}_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", "image/geotiff", raw / f"{name}.tif")
    # Orthophoto à 20 cm : 2,5 × la résolution de la grille 0,5 m.
    wms("HR.ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg", raw / "ortho.jpg", scale=2.5)
    download(c.LAZ_URL, raw / "lidar_0798_6651.copc.laz")
    bdnb(raw / "bdnb.json")
    overpass(raw / "osm.json")  # en dernier : le serveur public est parfois indisponible
    print("ok")
