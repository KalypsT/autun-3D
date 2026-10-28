"""Sources brutes sur toute la région (REGION de config.py), pour les étapes autonomes de l'étape M (D91).

Contrairement à `fetch.py` (par bloc, filtré pour le sol et la navigation), on garde ici tout l'extrait OpenStreetMap
(nœuds, voies, relations, toutes les étiquettes) et des couches IGN entières, téléchargés une fois dans `.cache/shared`.

- `osm()` : extrait OpenStreetMap complet, assemblé depuis des blocs de 500 m alignés sur le Lambert-93
  (`.cache/shared/osm_full/<bx>_<by>.json`, réponses brutes de l'API `map`).
- `ign(couche)` : couche BD TOPO ou cadastre (WFS de la Géoplateforme) sur l'emprise de la région, paginée
  (`.cache/shared/ign/<couche>.json`).
- `mns_window(x0, y0, x1, y1)` : modèle numérique de surface LiDAR (0,5 m) sur une petite fenêtre, en coordonnées locales.
"""

import io
import json
import math
import sys

import numpy as np
import tifffile
from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, shape
from shapely.ops import polygonize, unary_union

import config as c
import fetch

FORCE = "--force" in sys.argv
OSM_DIR = c.SHARED / "osm_full"
IGN_DIR = c.SHARED / "ign"
to_l93 = Transformer.from_crs(4326, 2154, always_xy=True)


def region_box(margin=60.0):
    """Emprise Lambert-93 (x0, y0, x1, y1) des tuiles de REGION, élargie de `margin` mètres."""
    c0, r0, nx, ny = c.REGION
    x0, y0 = (c.GRID_I0 + c0) * c.TILE, (c.GRID_J0 + r0) * c.TILE
    return x0 - margin, y0 - margin, x0 + nx * c.TILE + margin, y0 + ny * c.TILE + margin


def local(lon, lat):
    x, y = to_l93.transform(lon, lat)
    return x - c.ORIGIN[0], y - c.ORIGIN[1]


# --- OpenStreetMap --------------------------------------------------------------------------------------------------------------
class Osm:
    """Extrait OpenStreetMap complet en coordonnées locales."""

    def __init__(self, elements):
        self.nodes = {}  # id -> (x, y)
        self.node_tags = {}  # id -> étiquettes (nœuds étiquetés seulement)
        self.ways = {}  # id -> {"tags", "nodes"}
        self.relations = {}  # id -> {"tags", "members"}
        for e in elements:
            if e["type"] == "node":
                self.nodes[e["id"]] = local(e["lon"], e["lat"])
                if e.get("tags"):
                    self.node_tags[e["id"]] = e["tags"]
            elif e["type"] == "way":
                self.ways[e["id"]] = {"tags": e.get("tags", {}), "nodes": e["nodes"]}
            elif e["type"] == "relation":
                self.relations[e["id"]] = {"tags": e.get("tags", {}), "members": e.get("members", [])}

    def way_coords(self, wid):
        return [self.nodes[n] for n in self.ways[wid]["nodes"] if n in self.nodes]

    def way_line(self, wid):
        pts = self.way_coords(wid)
        return LineString(pts) if len(pts) >= 2 else None

    def way_polygon(self, wid):
        w = self.ways[wid]
        pts = self.way_coords(wid)
        if len(pts) < 4 or w["nodes"][0] != w["nodes"][-1]:
            return None
        p = Polygon(pts)
        return p if p.is_valid else p.buffer(0)

    def relation_polygon(self, rid):
        """Multipolygone d'une relation (rôles outer / inner), assemblé par polygonize ; None si rien ne se ferme."""
        r = self.relations[rid]
        outer, inner = [], []
        for m in r["members"]:
            if m["type"] != "way" or m["ref"] not in self.ways:
                continue
            ln = self.way_line(m["ref"])
            if ln is None:
                continue
            (inner if m.get("role") == "inner" else outer).append(ln)
        if not outer:
            return None
        outer_poly = unary_union(list(polygonize(unary_union(outer))))
        if outer_poly.is_empty:
            return None
        if inner:
            holes = unary_union(list(polygonize(unary_union(inner))))
            outer_poly = outer_poly.difference(holes)
        return outer_poly.buffer(0)

    def areas(self):
        """[(type, id, étiquettes, (Multi)Polygone)] : voies fermées et relations multipolygones."""
        out = []
        for wid, w in self.ways.items():
            if w["tags"] and w["nodes"] and w["nodes"][0] == w["nodes"][-1]:
                g = self.way_polygon(wid)
                if g is not None and not g.is_empty:
                    out.append(("way", wid, w["tags"], g))
        for rid, r in self.relations.items():
            if r["tags"].get("type") in ("multipolygon", "boundary") and r["tags"]:
                g = self.relation_polygon(rid)
                if g is not None and not g.is_empty:
                    out.append(("relation", rid, r["tags"], g))
        return out

    def tagged_nodes(self):
        """[(id, étiquettes, Point)]."""
        return [(nid, t, Point(*self.nodes[nid])) for nid, t in self.node_tags.items() if nid in self.nodes]


def osm():
    x0, y0, x1, y1 = region_box()
    block = fetch.OSM_BLOCK
    elements = {}
    count = 0
    for by in range(math.floor(y0 / block), math.floor((y1 - 1e-6) / block) + 1):
        for bx in range(math.floor(x0 / block), math.floor((x1 - 1e-6) / block) + 1):
            part = OSM_DIR / f"{bx}_{by}.json"
            if FORCE or not part.exists():
                lat0, lon0, lat1, lon1 = fetch.osm_bounds(bx, by)
                r = fetch.get("https://api.openstreetmap.org/api/0.6/map.json", params={"bbox": f"{lon0},{lat0},{lon1},{lat1}"})
                part.parent.mkdir(parents=True, exist_ok=True)
                part.write_bytes(r.content)
                count += 1
            for e in json.loads(part.read_text())["elements"]:
                elements[(e["type"], e["id"])] = e
    if count:
        print(f"  osm : {count} blocs téléchargés")
    return Osm(elements.values())


# --- IGN (WFS) ------------------------------------------------------------------------------------------------------------------
def ign(layer, page=1000):
    """Objets de la couche WFS sur la région : [(propriétés, géométrie shapely en coordonnées locales)]."""
    dest = IGN_DIR / f"{layer.replace(':', '_')}.json"
    if FORCE or not dest.exists():
        x0, y0, x1, y1 = region_box()
        features, start = [], 0
        while True:
            r = fetch.get("https://data.geopf.fr/wfs/ows", params={
                "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": layer,
                "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154",
                "BBOX": f"{x0},{y0},{x1},{y1},urn:ogc:def:crs:EPSG::2154", "COUNT": page, "STARTINDEX": start,
            })
            got = r.json()["features"]
            features += got
            start += page
            if len(got) < page:
                break
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
        print(f"  ign {layer} : {len(features)} objets")
    out = []
    for f in json.loads(dest.read_text())["features"]:
        if not f.get("geometry"):
            continue
        g = shape(f["geometry"])
        g = _translate(g)
        out.append((f["properties"], g))
    return out


def _translate(g):
    from shapely import force_2d
    from shapely.affinity import translate

    return translate(force_2d(g), -c.ORIGIN[0], -c.ORIGIN[1])


# --- LiDAR : modèle de surface sur une fenêtre ----------------------------------------------------------------------------------
def mns_window(x0, y0, x1, y1, res=0.5):
    """(grille z IGN69 relative à ORIGIN_Z, lignes du nord au sud ; x0, y1 locaux du coin nord-ouest) du MNS LiDAR sur la fenêtre locale."""
    X0, Y0 = math.floor((x0 + c.ORIGIN[0]) / res) * res, math.floor((y0 + c.ORIGIN[1]) / res) * res
    X1, Y1 = math.ceil((x1 + c.ORIGIN[0]) / res) * res, math.ceil((y1 + c.ORIGIN[1]) / res) * res
    w, h = int(round((X1 - X0) / res)), int(round((Y1 - Y0) / res))
    cache = c.SHARED / "mns" / f"{X0:.1f}_{Y0:.1f}_{X1:.1f}_{Y1:.1f}.tif"
    data = fetch.wms_block("IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93", "image/geotiff", X0, Y0, X1, Y1, w, h, cache)
    arr = tifffile.imread(io.BytesIO(data)).astype(np.float32)
    arr[arr < -100] = np.nan
    return arr - c.ORIGIN_Z, X0 - c.ORIGIN[0], Y1 - c.ORIGIN[1]


def as_polygons(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]
