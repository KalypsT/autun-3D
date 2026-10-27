"""Télécharge les données brutes du bloc (AUTUN_BLOCK, cf. config.py) dans .cache/ (hors git). Idempotent et reprenable : ne retélécharge rien.

Usage : AUTUN_BLOCK=3,4 python3 tools/data/fetch.py [--force] [--only lidar|wfs|routes|wms|bdnb|osm]   (routes : seulement les tronçons de route BD TOPO)
Partagé entre blocs (.cache/shared) : dalles LiDAR, blocs OpenStreetMap de 500 m, BDNB de la commune. Propre au bloc (.cache/blocks/<bloc>/raw) :
rasters IGN 0,5 m, BD TOPO, extrait OpenStreetMap.
"""

import io
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
import tifffile
from PIL import Image

import config as c

FORCE = "--force" in sys.argv
ONLY = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
session = requests.Session()
session.headers["User-Agent"] = c.USER_AGENT
RAW = c.CACHE / "raw"
SHARED = c.SHARED / "raw"


def get(url, *, method="GET", retries=6, timeout=300, **kwargs):
    last = None
    for attempt in range(retries):
        try:
            r = session.request(method, url, timeout=timeout, **kwargs)
            if r.status_code in (429, 502, 503, 504):
                raise requests.RequestException(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r
        except requests.RequestException as error:
            last = error
            time.sleep(min(60, 4 * 2**attempt))
    raise RuntimeError(f"échec : {url} ({last})")


def download_file(url, dest):
    if dest.exists() and not FORCE:
        print(f"= {dest.relative_to(c.ROOT)}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(5):
        try:
            with session.get(url, stream=True, timeout=300) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            tmp.rename(dest)
            print(f"+ {dest.relative_to(c.ROOT)} ({dest.stat().st_size / 1e6:.0f} Mo)")
            return
        except requests.RequestException as error:
            print(f"  essai {attempt + 1} : {error}")
            time.sleep(min(60, 5 * 2**attempt))
    raise RuntimeError(f"échec : {url}")


# --- IGN WFS (vecteur), paginé ----------------------------------------------------------------
def wfs_paged(layer, dest, sort="cleabs", page=1000):
    if dest.exists() and not FORCE:
        print(f"= {dest.relative_to(c.ROOT)}")
        return
    x0, y0, x1, y1 = c.MARGIN_BOX
    features, start = [], 0
    while True:
        r = get(
            "https://data.geopf.fr/wfs/ows",
            params={
                "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": layer,
                "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154", "SORTBY": sort,
                "BBOX": f"{x0},{y0},{x1},{y1},urn:ogc:def:crs:EPSG::2154", "COUNT": page, "STARTINDEX": start,
            },
        )
        got = r.json()["features"]
        features += got
        start += page
        if len(got) < page:
            break
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"+ {dest.relative_to(c.ROOT)} ({len(features)} objets)")


# --- IGN WMS (rasters) par blocs, assemblés en .npy -------------------------------------------
BLOCK_PX = 1000  # côté d'un bloc de requête, en pixels


def wms_block(layer, fmt, x0, y0, x1, y1, w, h, cache):
    if cache.exists() and not FORCE:
        return cache.read_bytes()
    r = get(
        "https://data.geopf.fr/wms-r",
        params={"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "", "FORMAT": fmt,
                "CRS": "EPSG:2154", "BBOX": f"{x0},{y0},{x1},{y1}", "WIDTH": w, "HEIGHT": h},
    )
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(r.content)
    return r.content


def wms_mosaic(layer, name, rgb=False):
    """Assemble la grille complète (GRID_H × GRID_W à 0,5 m) en blocs ; le résultat est .cache/raw/<name>.npy."""
    dest = RAW / f"{name}.npy"
    if dest.exists() and not FORCE:
        print(f"= {dest.relative_to(c.ROOT)}")
        return
    scale = 2.5 if rgb else 1  # orthophoto demandée à 20 cm puis ramenée à 0,5 m
    step = BLOCK_PX / scale  # pixels de grille 0,5 m par bloc
    out = np.zeros((c.GRID_H, c.GRID_W, 3), np.uint8) if rgb else np.full((c.GRID_H, c.GRID_W), np.nan, np.float32)
    jobs = []
    for r0 in range(0, c.GRID_H, int(step)):
        for c0 in range(0, c.GRID_W, int(step)):
            jobs.append((r0, c0, min(int(step), c.GRID_H - r0), min(int(step), c.GRID_W - c0)))

    def run(job):
        r0, c0, h, w = job
        x0 = c.GRID_X0 + c0 * c.RES
        y1 = c.GRID_Y1 - r0 * c.RES
        data = wms_block(
            layer, "image/jpeg" if rgb else "image/geotiff", x0, y1 - h * c.RES, x0 + w * c.RES, y1, int(w * scale), int(h * scale),
            RAW / "blocks" / f"{name}_{r0}_{c0}.{'jpg' if rgb else 'tif'}",
        )
        if rgb:
            img = Image.open(io.BytesIO(data)).convert("RGB").resize((w, h), Image.BOX)
            return job, np.asarray(img)
        arr = tifffile.imread(io.BytesIO(data)).astype(np.float32)
        arr[arr < -100] = np.nan
        return job, arr

    with ThreadPoolExecutor(4) as pool:
        for n, (job, arr) in enumerate(pool.map(run, jobs), 1):
            r0, c0, h, w = job
            out[r0:r0 + h, c0:c0 + w] = arr
            if n % 10 == 0 or n == len(jobs):
                print(f"  {name} : {n}/{len(jobs)} blocs")
    np.save(dest, out)
    print(f"+ {dest.relative_to(c.ROOT)} {out.shape}")


# --- LiDAR HD : dalles entières (nuage classé) -----------------------------------------------
def lidar():
    meta = get(
        "https://data.geopf.fr/wfs/ows",
        params={
            "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "IGNF_LIDAR-HD_METADONNEE:metadata",
            "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154", "COUNT": 200,
            "BBOX": f"{c.MARGIN_BOX[0]},{c.MARGIN_BOX[1]},{c.MARGIN_BOX[2]},{c.MARGIN_BOX[3]},urn:ogc:def:crs:EPSG::2154",
        },
    ).json()["features"]
    urls = {f["properties"]["coordonnees_nw"]: f["properties"]["url_npl"] for f in meta}
    for kx, ky in c.LIDAR_TILES:
        key = f"{kx:04d}-{ky:04d}"
        if key not in urls:
            raise RuntimeError(f"dalle LiDAR {key} absente du catalogue")
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda t: download_file(urls[f"{t[0]:04d}-{t[1]:04d}"], SHARED / f"lidar_{t[0]}_{t[1]}.copc.laz"), c.LIDAR_TILES))


# --- BDNB : toute la commune, 10 lignes par appel ----------------------------------------------
def bdnb(dest):
    if dest.exists() and not FORCE:
        print(f"= {dest.relative_to(c.ROOT)}")
        return
    select = ("batiment_groupe_id,annee_construction,mat_mur_txt,mat_toit_txt,nb_niveau,nb_log,hauteur_mean,"
              "usage_principal_bdnb_open,libelle_adr_principale_ban,denomination_monument_historique,"
              "distance_monument_historique,perimetre_bat_historique,geom_groupe")
    part = dest.with_suffix(".part.json")
    rows = json.loads(part.read_text()) if part.exists() else []
    offset = len(rows)
    while True:
        r = get(
            "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet",
            params={"code_commune_insee": f"eq.{c.INSEE_AUTUN}", "select": select, "order": "batiment_groupe_id", "limit": 10, "offset": offset},
            timeout=120,
        )
        page = r.json()
        rows += page
        offset += 10
        if offset % 500 == 0:
            part.write_text(json.dumps(rows, ensure_ascii=False))
            print(f"  bdnb : {len(rows)} groupes")
        if len(page) < 10:
            break
        time.sleep(0.55)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(rows, ensure_ascii=False))
    part.unlink(missing_ok=True)
    print(f"+ {dest.relative_to(c.ROOT)} ({len(rows)} groupes)")


# --- OpenStreetMap par blocs de 500 m alignés sur le Lambert-93 (partagés entre blocs), avec reprise ----------
OSM_BLOCK = 500.0


def osm_bounds(bx, by, m=20.0):
    """Emprise WGS84 (lat0, lon0, lat1, lon1) du bloc OSM absolu (bx, by), élargie de m mètres."""
    from pyproj import Transformer

    t = Transformer.from_crs(2154, 4326, always_xy=True)
    lon0, lat0 = t.transform(bx * OSM_BLOCK - m, by * OSM_BLOCK - m)
    lon1, lat1 = t.transform((bx + 1) * OSM_BLOCK + m, (by + 1) * OSM_BLOCK + m)
    return lat0, lon0, lat1, lon1


def overpass_block(bx, by, dest):
    lat0, lon0, lat1, lon1 = osm_bounds(bx, by)
    b = f"{lat0},{lon0},{lat1},{lon1}"
    query = (
        f"[out:json][timeout:180];("
        f"way[highway]({b});way[barrier]({b});way[natural]({b});way[leisure]({b});way[landuse]({b});way[amenity]({b});"
        f"way[\"area:highway\"]({b});way[man_made]({b});way[building][name]({b});way[building][\"ref:mhs\"]({b});"
        f"node({b})[~\"^(amenity|shop|tourism|historic|natural|highway|barrier|man_made|leisure|crossing|kerb|heritage)$\"~\".\"];"
        f");out geom;"
    )
    r = get("https://overpass-api.de/api/interpreter", method="POST", data={"data": query}, retries=8, timeout=300)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    return len(r.json()["elements"])


WAY_KEYS = ("highway", "barrier", "natural", "leisure", "landuse", "amenity", "area:highway", "man_made")
NODE_KEYS = ("amenity", "shop", "tourism", "historic", "natural", "highway", "barrier", "man_made", "leisure", "crossing", "kerb", "heritage")


def osm_api_block(bx, by, dest):
    """Même contenu que overpass_block, par l'API officielle d'OpenStreetMap (secours quand Overpass est indisponible)."""
    lat0, lon0, lat1, lon1 = osm_bounds(bx, by)
    els = get("https://api.openstreetmap.org/api/0.6/map.json", params={"bbox": f"{lon0},{lat0},{lon1},{lat1}"}, retries=6).json()["elements"]
    nodes = {e["id"]: (e["lat"], e["lon"]) for e in els if e["type"] == "node"}
    out = []
    for e in els:
        tags = e.get("tags", {})
        if e["type"] == "way":
            if not any(k in tags for k in WAY_KEYS) and not ("building" in tags and ("name" in tags or "ref:mhs" in tags)):
                continue
            geometry = [{"lat": nodes[n][0], "lon": nodes[n][1]} for n in e["nodes"] if n in nodes]
            out.append({"type": "way", "id": e["id"], "nodes": e["nodes"], "tags": tags, "geometry": geometry})
        elif e["type"] == "node" and any(k in tags for k in NODE_KEYS):
            out.append({"type": "node", "id": e["id"], "lat": e["lat"], "lon": e["lon"], "tags": tags})
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"elements": out}))
    return len(out)


def osm():
    dest = RAW / "osm.json"
    if dest.exists() and not FORCE:
        print(f"= {dest.relative_to(c.ROOT)}")
        return
    x0, y0, x1, y1 = c.MARGIN_BOX
    elements, missing = {}, []
    for by in range(math.floor(y0 / OSM_BLOCK), math.floor((y1 - 1e-6) / OSM_BLOCK) + 1):
        for bx in range(math.floor(x0 / OSM_BLOCK), math.floor((x1 - 1e-6) / OSM_BLOCK) + 1):
            part = SHARED / "osm" / f"{bx}_{by}.json"
            if not part.exists() or FORCE:
                try:
                    n = osm_api_block(bx, by, part)
                    print(f"  osm {bx},{by} : {n} éléments (API OSM)")
                except RuntimeError:
                    try:
                        n = overpass_block(bx, by, part)
                        print(f"  osm {bx},{by} : {n} éléments (Overpass)")
                    except RuntimeError as error:
                        print(f"  osm {bx},{by} : ÉCHEC ({error})")
                        missing.append((bx, by))
                        continue
            for e in json.loads(part.read_text())["elements"]:
                elements[(e["type"], e["id"])] = e
    if missing:
        raise RuntimeError(f"OSM incomplet, blocs manquants : {missing} (relancer : les blocs faits sont gardés)")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"elements": list(elements.values())}))
    print(f"+ {dest.relative_to(c.ROOT)} ({len(elements)} éléments)")


if __name__ == "__main__":
    steps = {
        "wfs": lambda: (wfs_paged("BDTOPO_V3:batiment", RAW / "bdtopo_batiment.json"),
                        wfs_paged("BDTOPO_V3:troncon_de_route", RAW / "bdtopo_route.json")),
        "routes": lambda: wfs_paged("BDTOPO_V3:troncon_de_route", RAW / "bdtopo_route.json"),
        "wms": lambda: ([wms_mosaic(f"IGNF_LIDAR-HD_{n}_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", n) for n in ("MNT", "MNS", "MNH")],
                        wms_mosaic("HR.ORTHOIMAGERY.ORTHOPHOTOS", "ortho", rgb=True)),
        "lidar": lidar,
        "bdnb": lambda: bdnb(SHARED / "bdnb.json"),
        "osm": osm,
    }
    for name, fn in steps.items():
        if ONLY and ONLY != name:
            continue
        print(f"== {name}")
        fn()
    print("ok")
