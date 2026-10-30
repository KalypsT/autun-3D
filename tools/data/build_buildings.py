"""Bâtiments : emprises BD TOPO + toits reconstruits depuis le nuage LiDAR HD.

Usage : python3 tools/data/build_buildings.py [--only CLEABS]

Pour chaque emprise :
  1. points « bâtiment » (classe 6) dans l'emprise ;
  2. plans de toit par RANSAC séquentiel (pentes, croupes, lucarnes, terrasses) ;
  3. chaque cellule de 0,5 m reçoit le plan le plus proche de son altitude LiDAR ;
     les régions sont polygonisées puis simplifiées sans trous entre elles ;
  4. l'emprise est découpée aux endroits où changent les faces : le haut de chaque mur
     suit exactement le toit (pignons triangulaires compris) ;
  5. cheminées : amas de points nettement au-dessus du plan de toit.
Sans assez de points, toit plat à la hauteur BD TOPO.

Sortie : public/data/buildings.json (coordonnées locales en mètres, z relatif à ORIGIN_Z).
"""

import json
import math
import multiprocessing
import sys
import zlib

import numpy as np
import shapely
from scipy import ndimage
from scipy.spatial import Delaunay, cKDTree
from shapely.affinity import translate
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.geometry.polygon import orient

import common
import config as c

CELL = 0.5
THRESH = 0.10        # distance max d'un point à son plan (m)
MIN_INLIERS = 50     # ~1,7 m² de toit
MAX_PLANES = 14
FLAT_SLOPE = math.tan(math.radians(3.5))
MAX_SLOPE = math.tan(math.radians(62))
MIN_AREA = 2.0       # m² : en dessous, on ignore l'emprise
CONTEXT = 12.0       # m : frange autour du bloc dont on reconstruit aussi les bâtiments (voisinage des murs)
STEP_MIN = 0.25      # saut de hauteur entre deux faces voisines qui demande un mur (m)
HF_THRESHOLD = 0.12  # part de cellules à plus d'1 m d'écart au-delà de laquelle on passe au toit maillé
MIN_REGION = 6       # cellules (1,5 m²) : les régions plus petites sont absorbées par leur voisine

rng = np.random.default_rng(42)
ORTHO = None  # orthophoto ramenée à la grille 0,5 m, chargée par main()


def roof_color(fp):
    """Couleur médiane des pixels éclairés de l'orthophoto dans l'emprise (hex)."""
    minx, miny, maxx, maxy = fp.bounds
    xs = np.arange(math.floor(minx), math.ceil(maxx) + 0.01, CELL)
    ys = np.arange(math.floor(miny), math.ceil(maxy) + 0.01, CELL)
    gx, gy = np.meshgrid(xs, ys)
    m = shapely.contains_xy(fp.buffer(-0.4) if fp.area > 12 else fp, gx.ravel(), gy.ravel())
    if not m.any():
        return None
    col, row = common.world_to_pixel(gx.ravel()[m] + c.ORIGIN[0], gy.ravel()[m] + c.ORIGIN[1])
    rgb = ORTHO[np.clip(row.astype(int), 0, ORTHO.shape[0] - 1), np.clip(col.astype(int), 0, ORTHO.shape[1] - 1)]
    lit = rgb[rgb.mean(axis=1) > 70]
    if len(lit) < 4:
        lit = rgb
    r, g, b = np.median(lit, axis=0).astype(int)
    return f"#{r:02x}{g:02x}{b:02x}"


def fit_planes(xyz):
    """RANSAC séquentiel. Retourne [(a, b, c)] avec z = a x + b y + c."""
    pts = xyz
    planes = []
    while len(pts) >= MIN_INLIERS and len(planes) < MAX_PLANES:
        sub = pts if len(pts) <= 6000 else pts[rng.choice(len(pts), 6000, replace=False)]
        k = min(24, len(sub))
        tree = cKDTree(sub[:, :2])
        trials = 500
        seeds = rng.integers(0, len(sub), trials)
        _, nb = tree.query(sub[seeds, :2], k=k)
        pick = rng.integers(1, k, (trials, 2))
        rows = np.arange(trials)
        p0, p1, p2 = sub[seeds], sub[nb[rows, pick[:, 0]]], sub[nb[rows, pick[:, 1]]]
        n = np.cross(p1 - p0, p2 - p0)
        norm = np.linalg.norm(n, axis=1)
        nz = np.abs(n[:, 2]) / np.maximum(norm, 1e-12)
        ok = (norm > 1e-9) & (nz > 0.3)
        if not ok.any():
            break
        n = n[ok] / norm[ok, None]
        n[n[:, 2] < 0] *= -1
        d = -(n * p0[ok]).sum(1)
        counts = (np.abs(sub @ n.T + d) < THRESH).sum(0)
        best = int(np.argmax(counts))
        nn, dd = n[best], d[best]
        # Affinage : moindres carrés sur les inliers, quelques tours.
        inl = np.abs(pts @ nn + dd) < THRESH
        a = b = cc = None
        for _ in range(4):
            if inl.sum() < 3:
                break
            A = np.c_[pts[inl, 0], pts[inl, 1], np.ones(inl.sum())]
            (a, b, cc), *_ = np.linalg.lstsq(A, pts[inl, 2], rcond=None)
            inl = np.abs(pts[:, 0] * a + pts[:, 1] * b + cc - pts[:, 2]) < THRESH
        if a is None or inl.sum() < MIN_INLIERS or math.hypot(a, b) > MAX_SLOPE:
            break
        if math.hypot(a, b) < FLAT_SLOPE:
            a = b = 0.0
            cc = float(pts[inl, 2].mean())
        planes.append((float(a), float(b), float(cc)))
        pts = pts[~inl]
    return planes


def top_surface(xyz, cell=CELL, slack=0.25):
    """Garde les points proches du maximum de leur cellule : écarte les façades et le dessous des débords."""
    if len(xyz) == 0:
        return xyz
    key = np.floor(xyz[:, 0] / cell).astype(np.int64) * 100003 + np.floor(xyz[:, 1] / cell).astype(np.int64)
    _, inv = np.unique(key, return_inverse=True)
    top = np.full(inv.max() + 1, -np.inf)
    np.maximum.at(top, inv, xyz[:, 2])
    return xyz[xyz[:, 2] >= top[inv] - slack]


def merge_planes(planes, xyz):
    """Fusionne les plans quasi identiques (pente à 0,05 près et écart < 0,2 m sur l'emprise)."""
    cx, cy = xyz[:, 0].mean(), xyz[:, 1].mean()
    out = []
    for p in planes:
        for k, q in enumerate(out):
            if abs(p[0] - q[0]) < 0.05 and abs(p[1] - q[1]) < 0.05 and abs(plane_z(p, cx, cy) - plane_z(q, cx, cy)) < 0.2:
                break
        else:
            out.append(p)
    return out


def absorb_small(lab, mask):
    """Les régions de moins de MIN_REGION cellules prennent l'étiquette dominante de leur voisinage."""
    for i in np.unique(lab[lab >= 0]):
        comp, n = ndimage.label(lab == i)
        for k in range(1, n + 1):
            region = comp == k
            if region.sum() >= MIN_REGION:
                continue
            ring = ndimage.binary_dilation(region, iterations=1) & ~region & (lab >= 0)
            if ring.any():
                vals, counts = np.unique(lab[ring], return_counts=True)
                lab[region] = vals[np.argmax(counts)]
    return lab


def label_cells(planes, cx, cy, cz, has_pts, mask):
    """Plan le plus proche de l'altitude LiDAR de chaque cellule, puis lissage.

    Les cellules sans point (cours, trous) et les aberrations (cheminées, antennes) reprennent
    l'altitude de la cellule connue la plus proche : jamais l'extrapolation lointaine d'un plan.
    """
    P = np.array(planes)
    zp = P[:, 0, None] * cx.ravel() + P[:, 1, None] * cy.ravel() + P[:, 2, None]
    resid = np.abs(zp - cz.ravel())
    known = has_pts & mask & (resid.min(axis=0).reshape(cx.shape) <= 0.5)
    if not known.any():
        known = has_pts & mask
    if not known.any():
        return np.where(mask, 0, -1)
    idx = ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True)
    zfill = cz[tuple(idx)]
    resid = np.abs(zp - zfill.ravel())
    lab = np.where(mask, np.argmin(resid, axis=0).reshape(cx.shape), -1)
    for size in (3, 5):
        onehot = np.stack([(lab == i) for i in range(len(planes))]).astype(np.float32)
        smooth = np.stack([ndimage.uniform_filter(o, size=size, mode="constant") for o in onehot])
        lab = np.where(mask, np.argmax(smooth, axis=0), -1)
    return lab


def polygonize(lab, nplanes, x0, y0):
    """Une région par plan, simplifiée en conservant les arêtes communes."""
    polys, ids = [], []
    for i in range(nplanes):
        rr, cc = np.nonzero(lab == i)
        if len(rr) == 0:
            continue
        # Les lignes vont du sud (0) vers le nord : y = y0 + r * CELL.
        boxes = shapely.box(x0 + cc * CELL, y0 + rr * CELL, x0 + (cc + 1) * CELL, y0 + (rr + 1) * CELL)
        u = shapely.union_all(boxes)
        for g in (u.geoms if u.geom_type == "MultiPolygon" else [u]):
            polys.append(g)
            ids.append(i)
    if len(polys) > 1:
        try:
            polys = list(shapely.coverage_simplify(polys, 0.5, simplify_boundary=True))
        except shapely.errors.GEOSException:
            pass
    return polys, ids


def plane_z(p, x, y):
    return p[0] * x + p[1] * y + p[2]


def clean_polygon(g):
    """Polygones valides au millimètre (sommets confondus fusionnés, auto-contacts séparés)."""
    g = shapely.set_precision(g, 1e-3)
    if not g.is_valid:
        g = shapely.make_valid(g)
    parts = g.geoms if hasattr(g, "geoms") else [g]
    out = []
    for part in parts:
        if part.geom_type == "Polygon" and part.area > 0.05:
            out.append(orient(part, 1.0))
        elif part.geom_type == "MultiPolygon":
            out.extend(orient(q, 1.0) for q in part.geoms if q.area > 0.05)
    return out


def triangulate(g):
    """Triangles d'une face (indices dans [anneau extérieur ouvert, trous ouverts…]) par Delaunay contraint."""
    verts = [c for ring in [g.exterior, *g.interiors] for c in list(ring.coords)[:-1]]
    index = {}
    for i, (x, y) in enumerate(verts):
        index.setdefault((round(x, 6), round(y, 6)), i)
    try:
        tris = shapely.constrained_delaunay_triangles(g)
    except shapely.errors.GEOSException:
        return None
    out = []
    for t in tris.geoms:
        ids = [index.get((round(x, 6), round(y, 6))) for x, y in list(t.exterior.coords)[:3]]
        if None in ids or len(set(ids)) < 3:
            return None
        out.extend(ids)
    return out


def heightfield(fp, zbound, cap=None):
    """Toit maillé directement sur la surface LiDAR (bâtiments que les plans ne décrivent pas bien).

    Maille de 1 m dans l'emprise, anneau densifié tous les 1,2 m ; altitude = mesure la plus proche, adoucie.
    Retourne (anneau extérieur ouvert, anneaux de trous ouverts, altitudes, face au format du jeu).
    """
    x0, y0, zf = zbound
    zs = ndimage.median_filter(zf, size=3)

    def zat(x, y):
        ix = min(max(int((x - x0) / CELL), 0), zs.shape[1] - 1)
        iy = min(max(int((y - y0) / CELL), 0), zs.shape[0] - 1)
        z = float(zs[iy, ix])
        return min(z, cap) if cap is not None else z

    def dens(ring):
        pts = list(ring.coords)[:-1]
        out = []
        for p, q in zip(pts, pts[1:] + pts[:1]):
            n = max(1, int(math.ceil(math.hypot(q[0] - p[0], q[1] - p[1]) / 1.2)))
            out += [(p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n) for k in range(n)]
        return out

    ext = dens(fp.exterior)
    holes = [dens(r) for r in fp.interiors]
    minx, miny, maxx, maxy = fp.bounds
    gx, gy = np.meshgrid(np.arange(math.floor(minx) + 0.5, maxx, 1.0), np.arange(math.floor(miny) + 0.5, maxy, 1.0))
    inside = shapely.contains_xy(fp.buffer(-0.6), gx.ravel(), gy.ravel())
    extra = list(zip(gx.ravel()[inside], gy.ravel()[inside]))
    allpts = ext + [p for h in holes for p in h] + extra
    arr = np.array(allpts)
    tri = Delaunay(arr)
    cen = arr[tri.simplices].mean(axis=1)
    keep = shapely.contains_xy(fp.buffer(1e-3), cen[:, 0], cen[:, 1])
    z = [round(zat(x, y), 2) for x, y in allpts]
    face = {
        "p": [0, 0, 0],
        "r": [round(v, 2) for p in ext + [ext[0]] for v in p],
        "h": [[round(v, 2) for p in h + [h[0]] for v in p] for h in holes],
        "e": [round(v, 2) for p in extra for v in p],
        "t": [int(i) for t in tri.simplices[keep] for i in t],
        "z": z,
    }
    return ext, holes, z, face


def ring_list(ring):
    return [round(float(v), 2) for xy in ring.coords for v in xy[:2]]


def node_ring(ring, face_vertices, tol=1e-4):
    """Insère dans l'anneau les sommets de faces qui tombent sur ses arêtes."""
    coords = list(ring.coords)[:-1]
    out = []
    for i, p in enumerate(coords):
        q = coords[(i + 1) % len(coords)]
        out.append(p)
        seg = LineString([p, q])
        L = seg.length
        if L < 2 * tol:
            continue
        cand = []
        for v in face_vertices:
            if seg.distance(Point(v)) < tol:
                t = seg.project(Point(v)) / L
                if tol / L < t < 1 - tol / L:
                    cand.append((t, v))
        for _, v in sorted(cand):
            if math.hypot(v[0] - out[-1][0], v[1] - out[-1][1]) > 2 * tol:
                out.append(v)
    return out


def snap_vertices(faces_poly, face_plane, planes, fp, max_shift=1.0):
    """Aligne les sommets partagés sur les arêtes réelles (intersection des plans voisins).

    La grille de 0,5 m dessine des escaliers entre deux faces ; un sommet commun à deux faces
    est ramené sur la droite z1 = z2, un sommet commun à trois faces sur leur point d'intersection,
    un sommet de bord d'emprise glisse le long du mur. Les coins de l'emprise ne bougent pas.
    """
    def key(x, y):
        return (round(x * 1e5), round(y * 1e5))

    owners = {}
    for fi, g in enumerate(faces_poly):
        for ring in [g.exterior, *g.interiors]:
            for x, y in list(ring.coords)[:-1]:
                owners.setdefault(key(x, y), set()).add(fi)
    fp_rings = [fp.exterior, *fp.interiors]
    corners = {key(x, y) for r in fp_rings for x, y in list(r.coords)[:-1]}
    segments = [(a, b) for r in fp_rings for a, b in zip(list(r.coords)[:-1], list(r.coords)[1:])]
    boundary = fp.boundary
    moved = {}
    for k, fs in owners.items():
        if k in corners:
            continue
        pids = sorted({face_plane[f] for f in fs})
        if len(pids) < 2:
            continue
        x, y = k[0] / 1e5, k[1] / 1e5
        on_edge = boundary.distance(Point(x, y)) < 1e-4
        if len(pids) == 2:
            A, B = planes[pids[0]], planes[pids[1]]
            gx, gy = A[0] - B[0], A[1] - B[1]
            f = gx * x + gy * y + (A[2] - B[2])
            if on_edge:
                seg = min(segments, key=lambda s: LineString(s).distance(Point(x, y)))
                dx, dy = seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]
                L = math.hypot(dx, dy)
                dx, dy = dx / L, dy / L
                slope = gx * dx + gy * dy
                if abs(slope) < 0.05:
                    continue
                t = -f / slope
                if abs(t) > max_shift:
                    continue
                moved[k] = (x + t * dx, y + t * dy)
            else:
                g2 = gx * gx + gy * gy
                if g2 < 0.02:
                    continue
                t = -f / g2
                if math.hypot(t * gx, t * gy) > max_shift:
                    continue
                moved[k] = (x + t * gx, y + t * gy)
        elif not on_edge:
            A, B, C = (planes[i] for i in pids[:3])
            m = np.array([[A[0] - B[0], A[1] - B[1]], [A[0] - C[0], A[1] - C[1]]])
            if abs(np.linalg.det(m)) < 0.02:
                continue
            rhs = -np.array([A[2] - B[2], A[2] - C[2]])
            nx, ny = np.linalg.solve(m, rhs)
            if math.hypot(nx - x, ny - y) <= max_shift:
                moved[k] = (float(nx), float(ny))
    if not moved:
        return faces_poly

    def remap(ring):
        return [moved.get(key(x, y), (x, y)) for x, y in list(ring.coords)[:-1]]

    out = []
    for g in faces_poly:
        try:
            ng = Polygon(remap(g.exterior), [remap(i) for i in g.interiors])
            if not ng.is_valid:
                ng = ng.buffer(0)
            if ng.is_empty or ng.geom_type != "Polygon":
                ng = g
        except (ValueError, shapely.errors.GEOSException):
            ng = g
        out.append(orient(ng, 1.0))
    return out


def classify(planes, areas):
    sloped = [p for p, a in zip(planes, areas) if p[0] or p[1]]
    if not sloped:
        return "flat"
    big = [p for p, a in zip(planes, areas) if (p[0] or p[1]) and a > 3]
    if len(big) <= 1:
        return "shed" if len(big) == 1 and len(planes) <= 2 else "complex"
    az = {round(math.degrees(math.atan2(p[1], p[0])) / 45) % 8 for p in big}
    if len(big) == 2 and len(az) == 2:
        return "gable"
    if len(az) >= 3:
        return "hip"
    return "complex"


def build_one(props, fp, P_index, mnt_sampler):
    """Retourne (enregistrement, rms) ; fp est en coordonnées locales, P_index indexe les points « bâtiment »."""
    global rng
    rng = np.random.default_rng(zlib.crc32(props["cleabs"].encode()) + 7 * props.get("part", 0))
    minx, miny, maxx, maxy = fp.bounds
    near = fp.buffer(0.3)
    box = P_index.box(minx - 1, miny - 1, maxx + 1, maxy + 1)
    sx, sy, sz = box[:, 0], box[:, 1], box[:, 2]
    inside = shapely.contains_xy(near, sx, sy)
    xyz = np.c_[sx[inside], sy[inside], sz[inside]]
    xyz = top_surface(xyz)

    alt_max = props.get("altitude_maximale_toit")
    cap = float(alt_max) - c.ORIGIN_Z + 1.5 if alt_max is not None else None  # plafond : toit BD TOPO + 1,5 m
    ground = float(np.median(mnt_sampler(np.array(fp.exterior.coords)[:, 0], np.array(fp.exterior.coords)[:, 1])))
    record = {
        "id": props["cleabs"] + (f"-{props['part']}" if props["part"] else ""),
        "rnb": props.get("identifiants_rnb") or None,
        "bd": {
            "levels": props.get("nombre_d_etages"), "height": props.get("hauteur"),
            "walls": props.get("materiaux_des_murs") or None, "roof": props.get("materiaux_de_la_toiture") or None,
            "year": int(props["date_d_apparition"][:4]) if props.get("date_d_apparition") else None,
            "use": props.get("usage_1"), "use2": props.get("usage_2"), "nature": props.get("nature"),
        },
        "ground": round(ground, 2),
        "roofColor": roof_color(fp),
    }

    planes = merge_planes(fit_planes(xyz), xyz) if len(xyz) >= MIN_INLIERS else []
    rms = None
    chim = []
    zbound = None  # (x0, y0, zfill) : altitude mesurée la plus proche de chaque cellule
    if not planes:
        zr = ground + float(props.get("hauteur") or 6.0)
        planes = [(0.0, 0.0, zr)]
        faces_poly, face_plane = [orient(fp, 1.0)], [0]
        record["q"] = {"n": int(len(xyz)), "planes": 0, "fallback": True}
    else:
        x0 = math.floor((minx - 0.5) / CELL) * CELL
        y0 = math.floor((miny - 0.5) / CELL) * CELL
        nx = int(math.ceil((maxx + 0.5 - x0) / CELL)) + 1
        ny = int(math.ceil((maxy + 0.5 - y0) / CELL)) + 1
        cx = x0 + (np.arange(nx) + 0.5) * CELL
        cy = y0 + (np.arange(ny) + 0.5) * CELL
        cx, cy = np.meshgrid(cx, cy)
        ix = np.clip(((xyz[:, 0] - x0) / CELL).astype(int), 0, nx - 1)
        iy = np.clip(((xyz[:, 1] - y0) / CELL).astype(int), 0, ny - 1)
        cnt = np.zeros((ny, nx))
        zsum = np.zeros((ny, nx))
        np.add.at(cnt, (iy, ix), 1)
        np.add.at(zsum, (iy, ix), xyz[:, 2])
        has = cnt > 0
        cz = np.where(has, zsum / np.maximum(cnt, 1), 0.0)
        mask = shapely.contains_xy(fp.buffer(0.36), cx.ravel(), cy.ravel()).reshape(cx.shape)
        lab = absorb_small(label_cells(planes, cx, cy, cz, has, mask), mask)
        known = has & mask
        if known.any():
            near = ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True)
            zbound = (x0, y0, cz[tuple(near)])
        polys, ids = polygonize(lab, len(planes), x0, y0)
        clipped, face_plane = [], []
        for g, pid in zip(polys, ids):
            inter = g.intersection(fp)
            for part in (inter.geoms if hasattr(inter, "geoms") else [inter]):
                if part.geom_type == "Polygon" and part.area > 0.05:
                    clipped.append(part)
                    face_plane.append(pid)
        # Restes non couverts : rattachés à la face voisine qui partage le plus de bord.
        rest = fp.difference(shapely.union_all(clipped)) if clipped else fp
        for piece in (rest.geoms if hasattr(rest, "geoms") else [rest]):
            if piece.geom_type != "Polygon" or piece.area < 1e-3 or not clipped:
                continue
            j = max(range(len(clipped)), key=lambda k: clipped[k].intersection(piece.buffer(1e-3)).length)
            clipped[j] = shapely.union_all([clipped[j], piece.buffer(1e-6)]).buffer(0)
        faces_poly = []
        new_plane = []
        for g, pid in zip(clipped, face_plane):
            for part in (g.geoms if hasattr(g, "geoms") else [g]):
                if part.geom_type == "Polygon" and part.area > 0.05:
                    faces_poly.append(orient(part, 1.0))
                    new_plane.append(pid)
        face_plane = new_plane
        faces_poly = snap_vertices(faces_poly, face_plane, planes, fp)
        cleaned, cleaned_plane = [], []
        for g, pid in zip(faces_poly, face_plane):
            for part in clean_polygon(g):
                cleaned.append(part)
                cleaned_plane.append(pid)
        faces_poly, face_plane = cleaned, cleaned_plane
        # Écart du modèle aux points (qualité) et cheminées.
        zmodel = np.full(cx.shape, np.nan)
        for g, pid in zip(faces_poly, face_plane):
            m = shapely.contains_xy(g, cx.ravel(), cy.ravel()).reshape(cx.shape)
            zmodel[m] = plane_z(planes[pid], cx[m], cy[m])
        ok = has & ~np.isnan(zmodel)
        rms = float(np.sqrt(np.mean((cz[ok] - zmodel[ok]) ** 2))) if ok.any() else None
        around = ndimage.maximum_filter(np.where(np.isnan(zmodel), -1e9, zmodel), size=5)
        above = ok & (cz - around > 0.5) & (cz - zmodel < 3.0)
        if above.any():
            comp, ncomp = ndimage.label(above)
            for k in range(1, ncomp + 1):
                rr, cc = np.nonzero(comp == k)
                area = len(rr) * CELL * CELL
                if 0.25 <= area <= 2.5 and (max(np.ptp(rr), np.ptp(cc)) + 1) * CELL <= 1.8:
                    bx0, bx1 = cx[0, cc.min()] - CELL / 2, cx[0, cc.max()] + CELL / 2
                    by0, by1 = cy[rr.min(), 0] - CELL / 2, cy[rr.max(), 0] + CELL / 2
                    top = float(np.percentile(cz[rr, cc], 90))
                    base = float(np.nanmin(zmodel[rr, cc]))
                    chim.append([round((bx0 + bx1) / 2, 2), round((by0 + by1) / 2, 2), round(bx1 - bx0, 2),
                                 round(by1 - by0, 2), round(base, 2), round(top, 2)])
        record["q"] = {"n": int(len(xyz)), "planes": len(planes)}
        bad = float(np.mean(np.abs(cz[ok] - zmodel[ok]) > 1.0)) if ok.any() else 0.0
        if bad > HF_THRESHOLD and fp.area > 15 and zbound is not None:
            fp = orient(fp, 1.0)
            ext, holes_, zs_all, face = heightfield(fp, zbound, cap)
            ne = len(ext)
            record["ring"] = [round(v, 2) for p in ext for v in p]
            record["top"] = zs_all[:ne]
            record["holes"], record["holeTop"], at = [], [], ne
            for h in holes_:
                record["holes"].append([round(v, 2) for p in h for v in p])
                record["holeTop"].append(zs_all[at:at + len(h)])
                at += len(h)
            record["faces"], record["steps"], record["chim"] = [face], [], []
            record["roofKind"] = "complex"
            record["eave"] = round(float(np.median(zs_all[:ne])), 2)
            record["ridge"] = round(max(zs_all), 2)
            record["q"]["heightfield"] = True
            return record, rms

    def zclamp(x, y, z):
        """Un sommet ne s'écarte pas de plus de 1 m de la mesure LiDAR la plus proche (zones sans point : cours, trous)."""
        if zbound is None:
            return z
        bx0, by0, zf = zbound
        ix = min(max(int((x - bx0) / CELL), 0), zf.shape[1] - 1)
        iy = min(max(int((y - by0) / CELL), 0), zf.shape[0] - 1)
        hi = zf[iy, ix] + 1.0 if cap is None else min(zf[iy, ix] + 1.0, cap)
        return float(min(max(z, zf[iy, ix] - 1.0), hi))

    # Anneaux nodés + haut de mur.
    face_vertices = {(round(x, 6), round(y, 6)) for g in faces_poly
                     for ring in [g.exterior, *g.interiors] for x, y in ring.coords}

    def wall_tops(ring):
        pts = node_ring(ring, face_vertices)
        tops = []
        for (x, y) in pts:
            zs = [plane_z(planes[pid], x, y) for g, pid in zip(faces_poly, face_plane) if g.distance(Point(x, y)) < 1e-3]
            if not zs:
                zs = [plane_z(planes[face_plane[int(np.argmin([g.distance(Point(x, y)) for g in faces_poly]))]], x, y)]
            tops.append(round(zclamp(x, y, float(np.mean(zs))), 2))
        return pts, tops

    fp = orient(fp, 1.0)
    pts, tops = wall_tops(fp.exterior)
    record["ring"] = [round(v, 2) for p in pts for v in p]
    record["top"] = tops
    record["holes"], record["holeTop"] = [], []
    for hole in fp.interiors:
        hp, ht = wall_tops(hole)
        record["holes"].append([round(v, 2) for p in hp for v in p])
        record["holeTop"].append(ht)

    # Faces de toit.
    record["faces"] = []
    areas = {}
    for g, pid in zip(faces_poly, face_plane):
        areas[pid] = areas.get(pid, 0) + g.area
        face = {
            "p": [round(planes[pid][0], 4), round(planes[pid][1], 4), round(planes[pid][2], 2)],
            "r": ring_list(g.exterior), "h": [ring_list(i) for i in g.interiors],
        }
        tri = triangulate(g)
        if tri is not None:
            face["t"] = tri
        a_, b_, c_ = planes[pid]
        openpts = [xy for ring in [g.exterior, *g.interiors] for xy in list(ring.coords)[:-1]]
        raw = [a_ * x + b_ * y + c_ for x, y in openpts]
        clamped = [zclamp(x, y, z) for (x, y), z in zip(openpts, raw)]
        if any(abs(u - v) > 0.05 for u, v in zip(raw, clamped)):
            face["z"] = [round(v, 2) for v in clamped]
        record["faces"].append(face)

    # Murs de raccord entre faces voisines dont les hauteurs diffèrent (lucarnes, décrochements).
    steps = []
    for i in range(len(faces_poly)):
        for j in range(i + 1, len(faces_poly)):
            if face_plane[i] == face_plane[j]:
                continue
            shared = faces_poly[i].boundary.intersection(faces_poly[j].boundary)
            for seg in (shared.geoms if hasattr(shared, "geoms") else [shared]):
                if seg.geom_type != "LineString" or seg.length < 0.2:
                    continue
                coords = list(seg.coords)
                for (xa, ya), (xb, yb) in zip(coords[:-1], coords[1:]):
                    za = (plane_z(planes[face_plane[i]], xa, ya), plane_z(planes[face_plane[j]], xa, ya))
                    zb = (plane_z(planes[face_plane[i]], xb, yb), plane_z(planes[face_plane[j]], xb, yb))
                    if max(abs(za[0] - za[1]), abs(zb[0] - zb[1])) > STEP_MIN and (za[0] - za[1]) * (zb[0] - zb[1]) >= 0:
                        steps.append([round(xa, 2), round(ya, 2), round(min(za), 2), round(max(za), 2),
                                      round(xb, 2), round(yb, 2), round(min(zb), 2), round(max(zb), 2)])
    record["steps"] = steps
    record["chim"] = chim
    sizes = [areas.get(i, 0) for i in range(len(planes))]
    record["roofKind"] = classify(planes, sizes)
    record["eave"] = round(float(np.median(tops)), 2)
    record["ridge"] = round(max(max(tops), max((p[2] + p[0] * x + p[1] * y) for p, (x, y) in
                            [(planes[face_plane[k]], faces_poly[k].representative_point().coords[0]) for k in range(len(faces_poly))])), 2)
    return record, rms


_INDEX = None
_MNT = None


def _mnt_sampler(x, y):
    col, row = common.world_to_pixel(np.asarray(x) + c.ORIGIN[0], np.asarray(y) + c.ORIGIN[1])
    col = np.clip(col.astype(int), 0, _MNT.shape[1] - 1)
    row = np.clip(row.astype(int), 0, _MNT.shape[0] - 1)
    return _MNT[row, col]


def _work(job):
    props, g = job
    fp = translate(g, -c.ORIGIN[0], -c.ORIGIN[1])
    try:
        return build_one(props, fp, _INDEX, _mnt_sampler)
    except Exception as error:  # un bâtiment défaillant ne doit pas faire perdre les autres
        print(f"  ! {props['cleabs']} : {type(error).__name__}: {error}", flush=True)
        return None, None


def main():
    global ORTHO, _INDEX, _MNT
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    ORTHO = common.ortho()
    pts = common.points([6])
    # Un bloc de bordure peut n'avoir aucun point bâtiment (D105) : ses bâtiments éventuels échouent alors un à un, sans arrêter la chaîne.
    _INDEX = common.PointIndex(pts["x"], pts["y"], pts["z"]) if len(pts["x"]) else None
    _MNT = common.raster("MNT") - c.ORIGIN_Z
    print(f"{len(pts['x'])} points bâtiment indexés")

    jobs = []
    for props, geom in common.bdtopo_buildings():
        if only and not props["cleabs"].startswith(only):
            continue
        geom = shapely.make_valid(geom)
        for g in (geom.geoms if geom.geom_type != "Polygon" and hasattr(geom, "geoms") else [geom]):
            if g.geom_type != "Polygon" or g.area < MIN_AREA:
                continue
            cx, cy = g.centroid.x, g.centroid.y
            # Le bloc et une frange de 12 m : les bâtiments voisins servent à reconnaître les murs mitoyens en bordure de bloc.
            if c.ZONE[0] - CONTEXT <= cx < c.ZONE[2] + CONTEXT and c.ZONE[1] - CONTEXT <= cy < c.ZONE[3] + CONTEXT:
                jobs.append((props, g))
    print(f"{len(jobs)} bâtiments à reconstruire")
    out = []
    with multiprocessing.get_context("fork").Pool(4) as pool:
        for n, (rec, _) in enumerate(pool.imap(_work, jobs, chunksize=6), 1):
            if rec is not None:
                out.append(rec)
            if n % 250 == 0:
                print(f"  {n}/{len(jobs)}", flush=True)
    work = c.CACHE / "work"
    work.mkdir(parents=True, exist_ok=True)
    if not only:
        (work / "buildings.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"toits maillés sur le LiDAR (plans insuffisants) : {sum(1 for r in out if r['q'].get('heightfield'))} bâtiments")
    kinds = {}
    for r in out:
        kinds[r["roofKind"]] = kinds.get(r["roofKind"], 0) + 1
    print(f"{len(out)} bâtiments, {sum(len(r['faces']) for r in out)} faces, {sum(len(r['chim']) for r in out)} cheminées, "
          f"{sum(len(r['steps']) for r in out)} raccords ; toits {kinds}")


if __name__ == "__main__":
    main()
