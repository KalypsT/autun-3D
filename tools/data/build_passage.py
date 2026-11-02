"""Passage Balthus (D187) : le passage couvert entre la rue du Général Demetz et la rue aux Cordiers devient praticable.

Usage : python3 tools/data/build_passage.py     (après build_shop_fronts.py et build_streetscape.py ; avant build_nav.py)
Entrées : `passage` de tools/data/manual.json, tiles/<tuile>.json, lod/<tuile>.json, modèles de surface et de terrain LiDAR HD (WMS, cache raw/monuments).
Sorties : - les quatre bâtiments BD TOPO que recouvre le couloir (12 et 12 bis rue Demetz, 26 et 28 rue aux Cordiers) sont découpés d'une bande de
            5 m sur l'axe OpenStreetMap : contour, haut des murs, pans de toit, cheminées, murs et boutiques de leur fiche (les indices de murs sont
            refaits), silhouette lointaine. Les murs du couloir sont de simples murs mitoyens (pas de fenêtres : c'est le décor de la galerie, lot 2).
            Là où le toit de BD TOPO dépasse le toit mesuré de la galerie (`flat`), il est aplati à ce niveau : les faîtages de BD TOPO sont de 2,5 m
            trop hauts au-dessus du couloir (le modèle de surface le montre : 13 m, contre 15,8) ;
          - le site `passage` de kinds/<tuile>.json : repère de l'axe, sol de la galerie, palier de la rue aux Cordiers, volée, linteaux (les
            tronçons couverts d'un bâtiment, hauteur du toit mesurée au LiDAR par tranche).
          Une deuxième passe ne change rien (un bâtiment déjà découpé n'est plus touché). Une régénération des tuiles (build_tiles.py) rend les
          bâtiments entiers : relancer cette étape. `bytes` de la tuile est mis à jour dans world.json.

Repère : s le long de l'axe depuis la façade de la rue Demetz (0) jusqu'à celle de la rue aux Cordiers (64,3 m), t vers la gauche (nord-est).
"""

import json
import math
import sys

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient

import build_monuments as bm
import config as c

KINDS = c.OUT / "kinds"
EPS = 0.02


def pairs(flat):
    return [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]


def clean(coords):
    """Points arrondis au centimètre, sans doublon consécutif."""
    out = []
    for x, y in coords:
        q = (round(x, 2), round(y, 2))
        if not out or q != out[-1]:
            out.append(q)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def flat_ring(poly):
    return [v for p in clean(list(orient(poly, 1.0).exterior.coords)[:-1]) for v in p]


def clear_ground(ground, strip):
    """Les sols (pelouse, trottoir, place…) que le couloir recouvre sont retirés : le sol de la galerie les remplace. Renvoie le nombre de polygones touchés."""
    touched = 0
    inner = strip.buffer(-0.03)  # l'arrondi au centimètre laisse des franges : un polygone déjà découpé ne compte plus
    for layer, polys in ground.items():
        out = []
        for rings in polys:
            try:
                q = Polygon(pairs(rings[0]), [pairs(h) for h in rings[1:]])
            except ValueError:
                out.append(rings)
                continue
            if not q.is_valid or q.intersection(inner).area < 0.01:
                out.append(rings)
                continue
            touched += 1
            for piece in polys_of(q.difference(strip)):
                if piece.area > 0.05:
                    out.append([flat_ring(piece)] + [flat_ring(Polygon(i)) for i in piece.interiors if Polygon(i).area > 0.05])
        ground[layer] = out
    return touched


def flatten_terrain(ax, zf, s0, s1, margin=1.5):
    """Le relief du LiDAR sous un bâtiment est interpolé : il remonte de 10 à 40 cm vers les murs, et le maillage du relief (une maille de 2 m) en fait bomber le sol du couloir.
    Les cases de 1 m du couloir (et d'une bande de `margin` m de plus de chaque côté) entre les abscisses s0 et s1 sont mises au niveau mesuré de la galerie.
    Renvoie le nombre de cases changées (tous blocs fins confondus)."""
    changed = 0
    for path in sorted((c.OUT / "terrain").glob("*_*.bin")):
        raw = path.read_bytes()
        base, bx0, by1, n = (float(v) for v in np.frombuffer(raw[:16], dtype="<f4"))
        n = int(n)
        cx, cy = bx0 + np.arange(n) + 0.5, by1 - np.arange(n) - 0.5
        X, Y = np.meshgrid(cx, cy)
        dx, dy = X - ax.x0, Y - ax.y0
        S, T = dx * ax.ux + dy * ax.uy, dx * ax.nx + dy * ax.ny
        mask = (S >= s0) & (S <= s1) & (np.abs(T) <= ax.hw + margin)
        if not mask.any():
            continue
        if zf < base:
            raise SystemExit(f"{path.name} : sol de la galerie sous la base du bloc")
        cells = np.frombuffer(raw[16:], dtype="<u2").reshape(n, n).copy()
        want = round((zf - base) * 100)
        k = int((cells[mask] != want).sum())
        if k:
            cells[mask] = want
            path.write_bytes(raw[:16] + cells.astype("<u2").tobytes())
            changed += k
    return changed


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


class Axis:
    """Repère de l'axe : point de départ, cap, longueur ; `strip` est le couloir (prolongé de `ext` aux deux bouts)."""

    def __init__(self, spec):
        (x0, y0), (x1, y1) = spec["axis"]
        self.x0, self.y0 = x0, y0
        self.L = math.hypot(x1 - x0, y1 - y0)
        self.ux, self.uy = (x1 - x0) / self.L, (y1 - y0) / self.L
        self.nx, self.ny = -self.uy, self.ux  # à gauche (nord-est)
        self.hw = spec["half"]
        e = spec["ext"]
        self.strip = LineString([self.at(-e, 0), self.at(self.L + e, 0)]).buffer(self.hw, cap_style=2)
        self.angle = math.atan2(self.uy, self.ux)

    def at(self, s, t):
        return (self.x0 + self.ux * s + self.nx * t, self.y0 + self.uy * s + self.ny * t)


def halfplane(a, b, k):
    """Demi-plan {a·x + b·y > k} (assez grand pour un bâtiment)."""
    g = math.hypot(a, b)
    nx, ny = a / g, b / g
    ox, oy = nx * k / g, ny * k / g
    dx, dy, big = -ny, nx, 1e4
    p0, p1 = (ox + dx * big, oy + dy * big), (ox - dx * big, oy - dy * big)
    return Polygon([p0, p1, (p1[0] + nx * big, p1[1] + ny * big), (p0[0] + nx * big, p0[1] + ny * big)])


def polys_of(g):
    if g.is_empty:
        return []
    return [g] if g.geom_type == "Polygon" else [q for q in g.geoms if q.geom_type == "Polygon"]


def measure_roof(ax, mns, mnt, poly):
    """Toit mesuré de la galerie : médiane du modèle de surface sur ce qui reste du bâtiment, à moins de 6 m de l'axe, le long du vitrage (s de 10 à 44)."""
    zs = []
    for s in np.arange(10, 44.01, 1.0):
        for side in (-1, 1):
            for t in np.arange(2.75, 6.01, 0.5):
                x, y = ax.at(s, side * t)
                if poly.contains(Point(x, y)):
                    zs.append(mns(x, y))
    return float(np.median(zs)) if zs else None


def cut_building(ax, b, f, flat_h):
    """Bâtiment et fiche privés du couloir. Renvoie (bâtiment, fiche) ou None si le couloir ne le touche plus."""
    ring = pairs(b["ring"])
    poly = Polygon(ring)
    if poly.intersection(ax.strip).area < 0.3:
        return None
    left = polys_of(poly.difference(ax.strip))
    if len(left) != 1:
        raise SystemExit(f"{b['id']} : {len(left)} morceaux après la découpe")
    P = orient(left[0], 1.0)
    H = flat_h

    # --- Pans de toit : coupés par le couloir, aplatis au niveau H là où le plan le dépasse ----------------------------------------------------
    faces, hi = [], []
    for fa in b["faces"]:
        a, bb, cc = fa["p"]
        fr = Polygon(pairs(fa["r"][:-2]), [pairs(h) for h in fa["h"]])
        part = fr.difference(ax.strip)
        if H is not None and math.hypot(a, bb) > 1e-6:
            up = halfplane(a, bb, H - cc)
            hi += polys_of(part.intersection(up))
            part = part.difference(up)
        elif H is not None and cc > H:
            hi += polys_of(part)
            part = Polygon()
        for q in polys_of(part):
            if q.area > 0.05:
                faces.append({"p": fa["p"], "poly": q})
    for q in hi:
        if q.area > 0.05:
            faces.append({"p": [0.0, 0.0, round(H, 2)], "poly": q})
    out_faces = []
    for fc in faces:
        q = orient(fc["poly"], 1.0)
        r = flat_ring(q)
        out_faces.append({"p": fc["p"], "r": r + r[:2], "h": [flat_ring(Polygon(i)) for i in q.interiors if Polygon(i).area > 0.05]})

    def plane_z(x, y):
        best = None
        for fc in faces:
            if fc["poly"].buffer(0.04).contains(Point(x, y)):
                a, bb, cc = fc["p"]
                z = a * x + bb * y + cc
                best = z if best is None else max(best, z)
        return best

    # --- Contour et haut des murs -------------------------------------------------------------------------------------------------------------
    new = list(orient(P, 1.0).exterior.coords)[:-1]
    top = []
    for x, y in new:
        k = next((i for i, (ox, oy) in enumerate(ring) if abs(ox - x) < EPS and abs(oy - y) < EPS), None)
        z = b["top"][k] if k is not None else (plane_z(x, y) if plane_z(x, y) is not None else b["eave"])
        top.append(round(min(z, H) if H is not None else z, 2))
    new_ring = [round(v, 2) for p in new for v in p]
    n = len(new)

    # --- Fiche : murs (indices refaits), boutiques et mur d'entrée ----------------------------------------------------------------------------
    old_runs = f["walls"]
    on = len(ring)
    edge_run = {}
    for ri, w in enumerate(old_runs):
        i = w["a"]
        while i != w["b"]:
            edge_run[i] = ri
            i = (i + 1) % on

    def old_run_of(p, q):
        mid = Point((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        best, bd = None, 0.05
        for i in range(on):
            d = LineString([ring[i], ring[(i + 1) % on]]).distance(mid)
            if d < bd:
                best, bd = i, d
        return None if best is None else edge_run.get(best)

    groups = []
    for i in range(n):
        p, q = new[i], new[(i + 1) % n]
        r = old_run_of(p, q)
        if groups and groups[-1]["orig"] == r:
            groups[-1]["b"] = (i + 1) % n
            groups[-1]["len"] += math.dist(p, q)
        else:
            groups.append({"orig": r, "a": i, "b": (i + 1) % n, "len": math.dist(p, q), "start": p})
    if len(groups) > 1 and groups[0]["orig"] == groups[-1]["orig"]:
        last = groups.pop()
        groups[0]["a"], groups[0]["len"], groups[0]["start"] = last["a"], groups[0]["len"] + last["len"], last["start"]
    walls = []
    for g in groups:
        old = old_runs[g["orig"]] if g["orig"] is not None else None
        eave = old["eave"] if old else (H if H is not None else b["eave"])
        walls.append({"a": g["a"], "b": g["b"], "role": old["role"] if old else "party", "length": round(g["len"], 2),
                      "eave": round(min(eave, H) if H is not None else eave, 2), "gable": bool(old["gable"]) if old else False,
                      "datum": old["datum"] if old else round(min(top) - 8.0, 2)})

    def along(old_run, pt):
        """Abscisse (m) de `pt` sur le mur d'origine, depuis son départ."""
        pts, i, acc = [], old_run["a"], 0.0
        pts.append(ring[i])
        while i != old_run["b"]:
            i = (i + 1) % on
            pts.append(ring[i])
        line = LineString(pts)
        return line.project(Point(pt))

    def new_index(orig):
        best, bl = None, -1.0
        for wi, g in enumerate(groups):
            if g["orig"] == orig and g["len"] > bl:
                best, bl = wi, g["len"]
        return best

    f2 = json.loads(json.dumps(f))
    f2["walls"] = walls
    gr = f2.get("ground") or {}
    for shop in gr.get("shops", []):
        wi = new_index(shop.get("wall"))
        if wi is None:
            continue
        g = groups[wi]
        shift = along(old_runs[g["orig"]], g["start"])
        shop["s"] = round(max(0.0, min(shop.get("s", 0.0) - shift, g["len"] - 0.3)), 2)
        shop["wall"] = wi
    if "front" in gr:
        wi = new_index(gr["front"])
        if wi is None:
            del gr["front"]
        else:
            gr["front"] = wi

    # --- Bâtiment ------------------------------------------------------------------------------------------------------------------------------
    chim = [q for q in b["chim"] if P.contains(Point(q[0], q[1])) and (H is None or q[4] <= H + 0.1)]
    ridge = max([fa["p"][0] * x + fa["p"][1] * y + fa["p"][2] for fa in out_faces for x, y in pairs(fa["r"][:-2])] + top)
    flat_only = all(fa["p"][0] == 0.0 and fa["p"][1] == 0.0 for fa in out_faces)
    b2 = dict(b)
    b2.update({"ring": new_ring, "top": top, "holes": [], "holeTop": [], "faces": out_faces, "steps": [], "chim": chim,
               "eave": round(min(top), 2), "ridge": round(min(ridge, H) if H is not None else ridge, 2),
               "roofKind": "flat" if flat_only else b["roofKind"]})
    return b2, f2


def main():
    manual = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())["passage"]
    ax = Axis(manual)
    tid = manual["tile"]
    tp = c.OUT / "tiles" / f"{tid}.json"
    text = tp.read_text()
    tile = json.loads(text)
    if dump(tile) != text:
        raise SystemExit("tuile écrite dans un autre style")
    lp = c.OUT / "lod" / f"{tid}.json"
    lod = json.loads(lp.read_text())

    # LiDAR : fenêtre autour du couloir.
    xs = [ax.at(s, t)[0] for s in (-3, ax.L + 3) for t in (-9, 9)]
    ys = [ax.at(s, t)[1] for s in (-3, ax.L + 3) for t in (-9, 9)]
    x0, y0, x1, y1 = math.floor(min(xs)) - 2, math.floor(min(ys)) - 2, math.ceil(max(xs)) + 2, math.ceil(max(ys)) + 2
    mns, mnt = bm.Raster("MNS", "balthus", x0, y0, x1, y1), bm.Raster("MNT", "balthus", x0, y0, x1, y1)

    cut = 0
    for bid, opt in manual["buildings"].items():
        bi = next((k for k, b in enumerate(tile["buildings"]) if b["id"] == bid), None)
        if bi is None:
            raise SystemExit(f"{bid} absent de la tuile {tid}")
        b, f = tile["buildings"][bi], tile["fiches"][bi]
        poly = Polygon(pairs(b["ring"]))
        flat_h = None
        if opt.get("flat") and poly.intersection(ax.strip).area >= 0.3:
            flat_h = measure_roof(ax, mns, mnt, poly.difference(ax.strip))
            flat_h = round(flat_h, 2)
        res = cut_building(ax, b, f, flat_h)
        if res is None:
            continue
        b2, f2 = res
        # Silhouette lointaine : l'entrée qui recouvrait l'ancien contour reçoit le nouveau.
        old_poly = poly
        k = next((i for i, r in enumerate(lod) if Polygon(pairs(r["r"])).is_valid and Polygon(pairs(r["r"])).symmetric_difference(old_poly).area < 0.15 * old_poly.area), None)
        if k is not None:
            lod[k] = {**lod[k], "r": b2["ring"], "e": b2["eave"], "g": b2["ridge"]}
        tile["buildings"][bi], tile["fiches"][bi] = b2, f2
        cut += 1
        print(f"  {bid[-4:]} : {poly.area:.0f} m² -> {Polygon(pairs(b2['ring'])).area:.0f} m²" + (f", toit aplati à {flat_h} m" if flat_h is not None else ""))

    # --- Site `passage` ------------------------------------------------------------------------------------------------------------------------
    L = ax.L
    zf = float(np.median([mnt(*ax.at(s, 0)) for s in np.arange(12, 44.01, 1.0)]))
    zc = float(np.median([mnt(*ax.at(s, 0)) for s in np.arange(L + 2.5, L + 5.01, 0.5)]))
    st = manual["stairs"]
    slab, head = manual["slab"], manual["head"]
    lin = []
    for ei, (e0, e1) in enumerate(manual["ends"]):
        k = max(1, round((e1 - e0) / slab))
        for i in range(k):
            s0, s1 = e0 + (e1 - e0) * i / k, e0 + (e1 - e0) * (i + 1) / k
            tops = [mns(*ax.at(s, t)) for s in np.arange(s0 + 0.25, s1, 0.5) for t in np.arange(-2.25, 2.26, 0.5)]
            zl = zf if s1 <= st["s0"] else (zc if s0 >= st["s1"] else zf + (zc - zf) * min(1.0, max(0.0, (s1 - st["s0"]) / (st["s1"] - st["s0"]))))
            z0 = round(zl + head[ei], 2)
            z1 = round(max(float(np.median(tops)), z0 + 0.6), 2)
            lin.append([round(s0, 2), round(s1, 2), z0, z1])
    site = {"t": "passage", "n": manual["name"], "c": [ax.x0, ax.y0], "a": round(ax.angle, 4), "L": round(L, 2), "hw": ax.hw,
            "zf": round(zf, 2), "zc": round(zc, 2), "st": [st["s0"], st["s1"], st["n"]], "lin": lin}
    print(f"  sol de la galerie {zf:.2f} m, palier de la rue aux Cordiers {zc:.2f} m, {len(lin)} linteaux")

    nground = clear_ground(tile["ground"], ax.strip)
    nflat = flatten_terrain(ax, round(zf, 2), 1.0, st["s0"] + 0.5)
    new = dump(tile)
    changed = new != text
    if changed:
        tp.write_text(new)
        world = json.loads((c.OUT / "world.json").read_text())
        meta = next(m for m in world["tiles"] if m["id"] == tid)
        meta["bytes"] = len(new.encode())
        (c.OUT / "world.json").write_text(json.dumps(world, ensure_ascii=False, indent=1))
    lt = dump(lod)
    if lt != lp.read_text():
        lp.write_text(lt)
    # Les autres tuiles que le couloir traverse (le bout de la rue Demetz est dans 25_34) : seulement leurs sols.
    world = json.loads((c.OUT / "world.json").read_text())
    for m in world["tiles"]:
        if m["id"] == tid:
            continue
        bx0, by0, bx1, by1 = m["bounds"]
        if ax.strip.bounds[2] < bx0 or ax.strip.bounds[0] > bx1 or ax.strip.bounds[3] < by0 or ax.strip.bounds[1] > by1:
            continue
        op = c.OUT / "tiles" / f"{m['id']}.json"
        otext = op.read_text()
        otile = json.loads(otext)
        nground += clear_ground(otile["ground"], ax.strip)
        onew = dump(otile)
        if onew != otext:
            op.write_text(onew)
            m["bytes"] = len(onew.encode())
            (c.OUT / "world.json").write_text(json.dumps(world, ensure_ascii=False, indent=1))
            changed = True

    kp = KINDS / f"{tid}.json"
    k = json.loads(kp.read_text())
    if site not in k["sites"]:
        k["sites"] = [q for q in k["sites"] if not (q.get("t") == "passage" and q.get("n") == site["n"])] + [site]
        kp.write_text(dump(k))
        index = json.loads((KINDS / "index.json").read_text())
        index["stats"]["sites"]["passage"] = 1
        (KINDS / "index.json").write_text(dump(index))
    print(f"{cut} bâtiments découpés, {nground} polygones de sol retaillés, {nflat} cases du relief aplanies" + ("" if changed or nflat else " (rien à changer)"))


if __name__ == "__main__":
    sys.exit(main())
