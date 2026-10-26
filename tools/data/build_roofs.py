"""Bâtiments « propres » : emprise + hauteur BD TOPO, toits générés (jamais de relevé LiDAR).

Usage : python3 tools/data/build_roofs.py        (après build_buildings.py)
Entrée  : .cache/work/buildings.json (emprise, hauteur, sol)
Sortie  : .cache/work/buildings_clean.json (même schéma, toits à pans nets)

Chaque pan est la région du toit la plus proche d'un bord de l'emprise (diagramme de Voronoï de points
échantillonnés sur les bords), incliné à pente constante : c'est la forme d'un toit à quatre pans (« croupes »)
de n'importe quelle emprise. Les bâtiments à peu près rectangulaires reçoivent souvent un toit à deux pans (pignons).
Les grands volumes se terminent par un plateau (comble à la Mansart) plutôt qu'une pyramide de dix mètres.
"""

import json
import math
from multiprocessing import Pool

import numpy as np
import shapely
from scipy.spatial import Voronoi
from shapely.geometry import MultiPolygon, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

import config as c

PITCH = 0.7  # montée / course : environ 35°
RISE_MAX = 4.6  # au-delà, plateau
STEP = 0.35
MIN_AREA = 14.0  # en dessous : toit plat (appentis, annexes)


def hash01(text, salt=0):
    h = 2166136261 ^ salt
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return (h % 100000) / 100000


def ring_edges(coords):
    """Arêtes (p1, p2) d'un anneau ouvert."""
    n = len(coords)
    return [(coords[i], coords[(i + 1) % n]) for i in range(n)]


def facets(poly, edges, eave):
    """Pans du toit : liste de (plan (a, b, c), Polygon). `edges` : arêtes qui portent un pan, normale vers la matière à gauche."""
    pts, labels = [], []
    for k, ((x1, y1), (x2, y2)) in enumerate(edges):
        length = math.hypot(x2 - x1, y2 - y1)
        n = max(2, math.ceil(length / STEP))
        for i in range(n):
            t = (i + 0.5) / n
            pts.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
            labels.append(k)
    minx, miny, maxx, maxy = poly.bounds
    far = 200.0
    dummies = [(minx - far, miny - far), (maxx + far, miny - far), (maxx + far, maxy + far), (minx - far, maxy + far),
               ((minx + maxx) / 2, miny - far), ((minx + maxx) / 2, maxy + far), (minx - far, (miny + maxy) / 2), (maxx + far, (miny + maxy) / 2)]
    arr = np.array(pts + dummies)
    vor = Voronoi(arr)
    cells = {}
    for i, lab in enumerate(labels):
        region = vor.regions[vor.point_region[i]]
        if not region or -1 in region:
            continue
        cell = Polygon(vor.vertices[region])
        if not cell.is_valid:
            cell = cell.buffer(0)
        cells.setdefault(lab, []).append(cell)
    out = []
    for lab, parts in cells.items():
        region = unary_union(parts).intersection(poly)
        (x1, y1), (x2, y2) = edges[lab]
        length = math.hypot(x2 - x1, y2 - y1)
        nx, ny = -(y2 - y1) / length, (x2 - x1) / length
        a, b = PITCH * nx, PITCH * ny
        plane = (a, b, eave - (a * x1 + b * y1))
        out.append((plane, region))
    return out


def polygons(geom):
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


def flat_coords(ring):
    pts = list(ring.coords)
    return [round(v, 2) for xy in pts for v in xy]


def face_record(plane, poly):
    return {"p": [round(plane[0], 4), round(plane[1], 4), round(plane[2], 3)], "r": flat_coords(poly.exterior),
            "h": [flat_coords(r) for r in poly.interiors]}


def build(b):
    ring = [(b["ring"][i], b["ring"][i + 1]) for i in range(0, len(b["ring"]), 2)]
    holes = [[(h[i], h[i + 1]) for i in range(0, len(h), 2)] for h in b["holes"]]
    poly = Polygon(ring, holes)
    if not poly.is_valid:
        poly = poly.buffer(0)
    poly = poly.simplify(0.06, preserve_topology=True)
    parts = polygons(poly)
    if not parts:
        return None
    poly = max(parts, key=lambda p: p.area)  # parties détachées (artefacts) ignorées
    poly = orient(poly, 1.0)
    ground = b["ground"]
    height = b["bd"]["height"] or max(b["eave"] - ground, 3.0)
    height = min(max(height, 2.4), 40.0)
    eave = ground + height * 0.94
    area = poly.area
    key = hash01(b["id"])
    ext = list(poly.exterior.coords)[:-1]
    inner = [list(r.coords)[:-1] for r in poly.interiors]

    rec = {k: b[k] for k in ("id", "rnb", "bd", "ground", "roofColor", "q")}
    rec["steps"] = []
    rec["chim"] = []
    flat = b["roofKind"] == "flat" or area < MIN_AREA or height < 2.8
    if flat:
        top = round(eave, 2)
        face = [face_record((0.0, 0.0, eave), poly)]
        rec.update(ring=[round(v, 2) for xy in ext for v in xy], top=[top] * len(ext), holes=[[round(v, 2) for xy in h for v in xy] for h in inner],
                   holeTop=[[top] * len(h) for h in inner], faces=face, roofKind="flat", eave=top, ridge=top)
        return rec

    # Forme : rectangle ou presque -> deux pans possibles.
    obb = poly.minimum_rotated_rectangle
    ratio = area / obb.area if obb.area > 0 else 0
    oc = list(obb.exterior.coords)
    e1 = (oc[1][0] - oc[0][0], oc[1][1] - oc[0][1])
    e2 = (oc[2][0] - oc[1][0], oc[2][1] - oc[1][1])
    long_v = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
    ll = math.hypot(*long_v)
    u = (long_v[0] / ll, long_v[1] / ll)
    width = min(math.hypot(*e1), math.hypot(*e2))
    gable = not inner and ratio > 0.86 and width < 14 and key < 0.62

    all_edges = ring_edges(ext)
    for r in inner:
        all_edges += ring_edges(r)
    side_ids, end_ids = [], []
    if gable:
        for i, ((x1, y1), (x2, y2)) in enumerate(ring_edges(ext)):
            L = math.hypot(x2 - x1, y2 - y1)
            if L < 1e-3:
                continue
            cos = abs(((x2 - x1) * u[0] + (y2 - y1) * u[1]) / L)
            (side_ids if cos >= 0.8 else end_ids).append(i)
        # Il faut des bords de long pan des deux côtés ; sinon on retombe sur un toit à quatre pans.
        ext_edges = ring_edges(ext)
        sides = [ext_edges[i] for i in side_ids]
        if len(sides) < 2 or not end_ids:
            gable = False
        else:
            ns = [(-(e[1][1] - e[0][1]), e[1][0] - e[0][0]) for e in sides]
            if not any(a[0] * bb[0] + a[1] * bb[1] < -0.5 * math.hypot(*a) * math.hypot(*bb) for a in ns for bb in ns):
                gable = False
    edges_for_roof = [ring_edges(ext)[i] for i in side_ids] if gable else all_edges

    try:
        radius = shapely.maximum_inscribed_circle(poly, 0.3).length
    except Exception:
        radius = math.sqrt(area) / 3
    dcap = RISE_MAX / PITCH
    plateau = radius > dcap
    fs = facets(poly, edges_for_roof, eave)
    faces = []
    if plateau:
        core = poly.buffer(-dcap, join_style=2, mitre_limit=8.0)
        ring_band = poly.difference(core) if not core.is_empty else poly
        for plane, region in fs:
            for p in polygons(region.intersection(ring_band)):
                if p.area > 0.12:
                    faces.append(face_record(plane, p.simplify(0.03)))
        for p in polygons(core):
            if p.area > 0.12:
                faces.append(face_record((0.0, 0.0, eave + RISE_MAX), p.simplify(0.03)))
        ridge = eave + RISE_MAX
    else:
        for plane, region in fs:
            for p in polygons(region):
                if p.area > 0.12:
                    faces.append(face_record(plane, p.simplify(0.03)))
        ridge = eave + PITCH * radius

    # Anneau extérieur : sur un pignon, un sommet est ajouté au milieu du mur de bout, à la hauteur du faîtage.
    ring_out, top_out = [], []
    ext_edges = ring_edges(ext)
    sides_lines = []
    for (x1, y1), (x2, y2) in (edges_for_roof if gable else []):
        L = math.hypot(x2 - x1, y2 - y1)
        sides_lines.append((-(y2 - y1) / L, (x2 - x1) / L, x1, y1))
    for i, ((x1, y1), (x2, y2)) in enumerate(ext_edges):
        ring_out.append((x1, y1))
        top_out.append(eave)
        if gable and i in end_ids and math.hypot(x2 - x1, y2 - y1) > 1.5:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            d = min(max((nx * (mx - ox) + ny * (my - oy)), 0.0) for nx, ny, ox, oy in sides_lines)
            ring_out.append((mx, my))
            top_out.append(eave + min(PITCH * d, RISE_MAX))
    rec.update(
        ring=[round(v, 2) for xy in ring_out for v in xy], top=[round(t, 2) for t in top_out],
        holes=[[round(v, 2) for xy in h for v in xy] for h in inner], holeTop=[[round(eave, 2)] * len(h) for h in inner],
        faces=faces, roofKind="gable" if gable else "hip", eave=round(eave, 2), ridge=round(ridge, 2),
    )
    if area > 45 and hash01(b["id"], 7) < 0.55:
        try:
            line = shapely.maximum_inscribed_circle(poly, 0.3)
            cx, cy = line.coords[0]
            zc = ridge if not plateau else eave + RISE_MAX
            if plateau:
                zc = eave + RISE_MAX
            rec["chim"] = [[round(cx, 2), round(cy, 2), 0.7, 0.7, round(zc - 0.3, 2), round(zc + 1.3, 2)]]
        except Exception:
            pass
    return rec


def work(b):
    try:
        return build(b)
    except Exception as e:  # emprises dégénérées : le bâtiment est ignoré, pas la chaîne
        print("ignoré", b["id"], e)
        return None


def main():
    buildings = json.load(open(c.CACHE / "work" / "buildings.json"))
    with Pool(4) as pool:
        out = [r for r in pool.map(work, buildings, chunksize=20) if r]
    (c.CACHE / "work" / "buildings_clean.json").write_text(json.dumps(out, separators=(",", ":")))
    kinds = {}
    for r in out:
        kinds[r["roofKind"]] = kinds.get(r["roofKind"], 0) + 1
    print(f"{len(out)} bâtiments propres sur {len(buildings)} : {kinds}, {sum(len(r['faces']) for r in out)} pans")


if __name__ == "__main__":
    main()
