"""Ponts, eau et voies ferrées (étape M2, D93) : étape autonome, ne touche à aucune tuile.

Usage : python3 tools/data/build_structures.py [--force]
Entrées : public/data/world.json, terrain/*.bin (relief fin publié), extrait OpenStreetMap complet et couches BD TOPO de la région
(`region_sources.py`), modèle de surface LiDAR le long des ponts (profil réel des tabliers : le relief de l'IGN ne les porte pas).
Sorties : public/data/structures/<tuile>.json et structures/index.json.

Fichier d'une tuile : {v, decks, water, streams, weirs, rails, platforms, crossings}
  decks     tabliers praticables : {id, k (road | foot | rail), w (largeur), p [x, y, z, …] (axe et altitude du dessus), st (stone : voûtes en
            pierre, beam : tablier droit, light : passerelle), sp [abscisses des piles le long de l'axe], pc [[s0, s1], …] (parapets
            infranchissables, coupés là où le pont enjambe une voie), n?} ; un tablier est dans chaque tuile que son emprise touche.
  water     polygones d'eau (anneau extérieur puis trous, coordonnées aplaties), découpés à la tuile.
  streams   ruisseaux et fossés hors des polygones d'eau : {p, w}.
  weirs     seuils et barrages : {p}.
  rails     voies ferrées : {p, s (1 : voie de service)} ; altitude : celle du tablier ou du relief, calculée par le jeu.
  platforms quais : {r, h}. crossings : passages à niveau [x, y, angle de la voie ferrée].
Altitudes relatives à ORIGIN_Z, comme le relief publié.
"""

import json
import math
import struct
from collections import Counter, defaultdict

import numpy as np
from shapely.geometry import LineString, Point, box
from shapely.ops import substring, unary_union

import config as c
import region_sources as rs
import streets_lib as sl

OUT = c.OUT / "structures"
VERSION = 1
SIDEWALK = 2.2  # trottoir de part et d'autre d'une chaussée (comme build_ground.py)
FOOT = {"footway", "path", "cycleway", "steps", "pedestrian", "bridleway"}
STREAM_W = {"river": 6.0, "canal": 3.0, "stream": 1.6, "ditch": 0.9, "drain": 0.9}


# --- Relief publié (terrain/<tuile>.bin) ---------------------------------------------------------------------------------------
class Relief:
    def __init__(self, world):
        self.gx, self.gy = world["gridOrigin"]
        self.size = world["tileSize"]
        self.blocks = {}

    def block(self, col, row):
        key = (col, row)
        if key not in self.blocks:
            path = c.OUT / "terrain" / f"{col}_{row}.bin"
            if not path.exists():
                self.blocks[key] = None
            else:
                raw = path.read_bytes()
                base, x0, y1, n = struct.unpack("<ffff", raw[:16])
                n = int(n)
                arr = np.frombuffer(raw[16:16 + 2 * n * n], "<u2").reshape(n, n).astype(np.float64) * 0.01 + base
                self.blocks[key] = (arr, x0, y1)
        return self.blocks[key]

    def z(self, x, y):
        b = self.block(math.floor((x - self.gx) / self.size), math.floor((y - self.gy) / self.size))
        if b is None:
            return float("nan")
        arr, x0, y1 = b
        # Interpolation bilinéaire, comme Terrain.heightAt.
        fx, fy = x - x0 - 0.5, y1 - y - 0.5
        c0, r0 = int(math.floor(fx)), int(math.floor(fy))
        tx, ty = fx - c0, fy - r0
        n = arr.shape[0]
        g = lambda r, q: arr[min(max(r, 0), n - 1), min(max(q, 0), n - 1)]  # noqa: E731
        top = g(r0, c0) * (1 - tx) + g(r0, c0 + 1) * tx
        bot = g(r0 + 1, c0) * (1 - tx) + g(r0 + 1, c0 + 1) * tx
        return float(top * (1 - ty) + bot * ty)


def flat(geom_coords):
    return [round(v, 2) for xy in geom_coords for v in xy]


def deck_width(tags):
    try:
        return max(2.0, float(str(tags.get("width", "")).replace(",", ".").split()[0]))
    except (ValueError, IndexError):
        pass
    if tags.get("railway"):
        return 5.0
    hw = tags.get("highway", "")
    widths, drivable = sl.classes(1)
    if hw in FOOT or hw in ("track",):
        return 3.0 if hw != "track" else 4.5
    base = widths.get(hw, 6.0)
    return base + (2 * SIDEWALK if hw in drivable and hw != "service" else 1.0)


def deck_profile(line, relief):
    """Altitude du dessus du tablier tous les mètres : profil du modèle de surface (25ᵉ centile en travers, ce qui écarte voitures et
    garde-corps), validé contre la droite entre les deux culées ; sinon cette droite."""
    L = line.length
    ds = np.arange(0, L + 1e-6, 1.0)
    if ds[-1] < L:
        ds = np.append(ds, L)

    def ground_beyond(d, sign):
        p = line.interpolate(d)
        q = line.interpolate(min(max(d - sign * 1.0, 0), L))
        ux, uy = p.x - q.x, p.y - q.y
        n = math.hypot(ux, uy) or 1.0
        return relief.z(p.x + ux / n * 1.5, p.y + uy / n * 1.5)

    za, zb = ground_beyond(0, -1), ground_beyond(L, 1)
    lin = za + (zb - za) * ds / max(L, 1e-6)
    x0, y0, x1, y1 = line.bounds
    try:
        z, wx0, wy1 = rs.mns_window(x0 - 4, y0 - 4, x1 + 4, y1 + 4)
    except RuntimeError:
        return ds, lin, "linear"
    prof = []
    for d in ds:
        p = line.interpolate(d)
        col, row = int((p.x - wx0) / 0.5), int((wy1 - p.y) / 0.5)
        win = z[max(row - 3, 0):row + 4, max(col - 3, 0):col + 4]
        prof.append(float(np.nanpercentile(win, 25)) if np.isfinite(win).any() else float("nan"))
    prof = np.array(prof)
    ok = np.isfinite(prof)
    if not np.isfinite(lin).all():
        # Une culée hors des tuiles publiées (relief inconnu) : on ne garde que le modèle de surface.
        if ok.mean() < 0.7:
            return ds, np.full_like(ds, np.nanmedian(prof) if ok.any() else 0.0), "linear"
        lin = np.interp(ds, ds[ok], prof[ok])
    prof = np.interp(ds, ds[ok], prof[ok])
    k = min(7, len(prof) | 1)
    smooth = np.convolve(np.pad(prof, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    rough = np.abs(np.diff(smooth, 2)).max() if len(smooth) > 2 else 0.0
    if np.abs(smooth - lin).max() > 2.5 or rough > 0.35:
        return ds, lin, "linear"
    # Raccord aux culées sur 2 m : le tablier rejoint exactement le relief des deux bouts.
    w = np.clip(np.minimum(ds, L - ds) / 2.0, 0, 1)
    return ds, lin * (1 - w) + smooth * w, "mns"


def main():
    world = json.load(open(c.OUT / "world.json"))
    relief = Relief(world)
    tiles = {t["id"]: box(*t["bounds"]) for t in world["tiles"]}
    osm = rs.osm()
    areas = osm.areas()
    out = defaultdict(lambda: {"v": VERSION, "decks": [], "water": [], "streams": [], "weirs": [], "rails": [], "platforms": [], "crossings": []})
    stats = Counter()

    def tiles_touching(geom):
        return [tid for tid, t in tiles.items() if t.intersects(geom)]

    # --- Eau : surfaces OpenStreetMap (y compris multipolygones) et BD TOPO permanentes ----------------------------------------
    polys = []
    for typ, oid, tags, g in areas:
        if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in ("reservoir", "basin") and tags.get("water"):
            if tags.get("leisure") == "swimming_pool":
                continue
            polys.append(g)
    for props, g in rs.ign("BDTOPO_V3:surface_hydrographique"):
        if props.get("persistance") == "Permanent":
            polys.append(g.buffer(0))
    water = unary_union([p.buffer(0) for p in polys]).buffer(0.3).buffer(-0.3)
    for tid, t in tiles.items():
        part = water.intersection(t)
        for p in rs.as_polygons(part):
            p = p.simplify(0.3)
            if p.area < 4:
                continue
            out[tid]["water"].append([flat(list(p.exterior.coords)[:-1])] + [flat(list(h.coords)[:-1]) for h in p.interiors])
            stats["water_m2"] += p.area

    # Ruisseaux, fossés et rivières sans surface : rubans, hors des surfaces d'eau et des busages.
    water_buf = water.buffer(0.5)
    for wid, w in osm.ways.items():
        t = w["tags"]
        kind = t.get("waterway")
        if kind not in STREAM_W or t.get("tunnel") not in (None, "no") or t.get("intermittent") == "yes" and kind in ("ditch", "drain"):
            continue
        ln = osm.way_line(wid)
        if ln is None:
            continue
        rest = ln.difference(water_buf)
        try:
            width = float(t.get("width", STREAM_W[kind]))
        except ValueError:
            width = STREAM_W[kind]
        for piece in getattr(rest, "geoms", [rest]):
            if piece.is_empty or piece.length < 3:
                continue
            for tid in tiles_touching(piece):
                clip = piece.intersection(tiles[tid].buffer(2))
                for seg in getattr(clip, "geoms", [clip]):
                    if seg.geom_type == "LineString" and seg.length > 1:
                        out[tid]["streams"].append({"p": flat(seg.simplify(0.3).coords), "w": round(width, 1)})
            stats["streams_m"] += piece.length
    for wid, w in osm.ways.items():
        if w["tags"].get("waterway") in ("weir", "dam"):
            ln = osm.way_line(wid)
            if ln is not None:
                for tid in tiles_touching(ln):
                    out[tid]["weirs"].append({"p": flat(ln.coords)})
                stats["weirs"] += 1

    # --- Voies ferrées, quais, passages à niveau ------------------------------------------------------------------------------
    rail_lines = []
    for wid, w in osm.ways.items():
        t = w["tags"]
        if t.get("railway") not in ("rail", "disused") or t.get("tunnel") not in (None, "no"):
            continue
        ln = osm.way_line(wid)
        if ln is None:
            continue
        rail_lines.append(ln)
        service = 1 if t.get("service") in ("yard", "siding", "spur") or t.get("usage") is None and t.get("railway") == "disused" else 0
        for tid in tiles_touching(ln):
            clip = ln.intersection(tiles[tid].buffer(2))
            for seg in getattr(clip, "geoms", [clip]):
                if seg.geom_type == "LineString" and seg.length > 1:
                    out[tid]["rails"].append({"p": flat(seg.coords), "s": service})
        stats["rails_m"] += ln.length
    for typ, oid, tags, g in areas:
        if tags.get("railway") == "platform" or tags.get("public_transport") == "platform" and tags.get("train") == "yes":
            for tid in tiles_touching(g):
                for p in rs.as_polygons(g.intersection(tiles[tid])):
                    out[tid]["platforms"].append({"r": flat(list(p.simplify(0.2).exterior.coords)[:-1]), "h": 0.55})
            stats["platforms"] += 1
    for wid, w in osm.ways.items():
        if w["tags"].get("railway") == "platform" and w["nodes"][0] != w["nodes"][-1]:
            ln = osm.way_line(wid)
            if ln is None:
                continue
            g = ln.buffer(1.6, cap_style="flat")
            for tid in tiles_touching(g):
                for p in rs.as_polygons(g.intersection(tiles[tid])):
                    out[tid]["platforms"].append({"r": flat(list(p.simplify(0.2).exterior.coords)[:-1]), "h": 0.55})
            stats["platforms"] += 1
    rails_union = unary_union(rail_lines) if rail_lines else LineString()
    for nid, tags, p in osm.tagged_nodes():
        if tags.get("railway") in ("level_crossing", "crossing"):
            if rails_union.is_empty or rails_union.distance(p) > 2:
                continue
            best = min(rail_lines, key=lambda ln: ln.distance(p))
            d = best.project(p)
            a0, a1 = best.interpolate(max(d - 2, 0)), best.interpolate(min(d + 2, best.length))
            a = math.atan2(a1.y - a0.y, a1.x - a0.x)
            tid = next((tid for tid, t in tiles.items() if t.contains(p)), None)
            if tid:
                out[tid]["crossings"].append([round(p.x, 2), round(p.y, 2), round(a, 4)])
                stats["crossings"] += 1

    # --- Tabliers -------------------------------------------------------------------------------------------------------------
    lower_roads = [osm.way_line(wid) for wid, w in osm.ways.items()
                   if w["tags"].get("highway") and w["tags"].get("bridge") in (None, "no") and w["tags"].get("tunnel") in (None, "no")]
    lower = [ln for ln in lower_roads if ln is not None] + rail_lines
    water_lines = [osm.way_line(wid) for wid, w in osm.ways.items() if w["tags"].get("waterway") in STREAM_W]
    water_any = unary_union([water] + [ln.buffer(1) for ln in water_lines if ln is not None])
    for wid, w in osm.ways.items():
        t = w["tags"]
        if t.get("bridge") in (None, "no") or not (t.get("highway") or t.get("railway") in ("rail", "disused", "abandoned")):
            continue
        ln = osm.way_line(wid)
        if ln is None or ln.length < 3:
            continue
        if not any(tt.intersects(ln) for tt in tiles.values()):
            continue
        kind = "rail" if t.get("railway") else "foot" if t.get("highway") in FOOT else "road"
        width = deck_width(t)
        ds, zs, src = deck_profile(ln, relief)
        stats[f"profile_{src}"] += 1
        over_water = ln.intersects(water_any)
        # Croisements avec une voie en dessous : les parapets s'y interrompent (obstacles en 2D : ils barreraient la voie du bas).
        cuts = []
        for low in lower:
            if low.crosses(ln):
                for pt in getattr(low.intersection(ln), "geoms", [low.intersection(ln)]):
                    if pt.geom_type == "Point":
                        cuts.append(ln.project(pt))
        spans = [[0.4, ln.length - 0.4]]
        for cpos in cuts:
            gap = (cpos - width / 2 - 4, cpos + width / 2 + 4)
            nxt = []
            for a, b in spans:
                if gap[1] <= a or gap[0] >= b:
                    nxt.append([a, b])
                    continue
                if gap[0] > a + 0.5:
                    nxt.append([a, gap[0]])
                if gap[1] < b - 0.5:
                    nxt.append([gap[1], b])
            spans = nxt
        style = "light" if kind == "foot" else "stone" if over_water and ln.length >= 15 and kind == "road" else "beam"
        L = ln.length
        n = max(1, round(L / (16 if style == "stone" else 15))) if (style == "stone" or L > 20) else 1
        piers = [round(L * i / n, 2) for i in range(1, n)]
        # Axe : sommets de la voie, plus des points tous les 4 m pour suivre le profil.
        pts = []
        for d in np.unique(np.concatenate([[ln.project(Point(q)) for q in ln.coords], np.arange(0, L, 4.0), [L]])):
            p = ln.interpolate(d)
            pts.extend([round(p.x, 2), round(p.y, 2), round(float(np.interp(d, ds, zs)), 2)])
        deck = {"id": wid, "k": kind, "w": round(width, 1), "p": pts, "st": style, "sp": piers, "pc": [[round(a, 2), round(b, 2)] for a, b in spans]}
        if t.get("name"):
            deck["n"] = t["name"]
        foot = ln.buffer(width / 2 + 0.5, cap_style="flat")
        for tid in tiles_touching(foot):
            out[tid]["decks"].append(deck)
        stats[f"decks_{kind}"] += 1
        dip = max(float(np.interp(d, ds, zs)) - relief.z(*ln.interpolate(d).coords[0]) for d in ds)
        print(f"  pont {wid} {t.get('name') or ''} ({kind}, {style}) : {L:.0f} m, profil {src}, relief jusqu'à {dip:.1f} m sous le tablier, "
              f"{len(cuts)} voie(s) dessous")

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    ids = sorted(tid for tid, d in out.items() if any(d[k] for k in d if k != "v"))
    for tid in ids:
        (OUT / f"{tid}.json").write_text(json.dumps(out[tid], separators=(",", ":")))
    size = sum(p.stat().st_size for p in OUT.glob("*.json"))
    (OUT / "index.json").write_text(json.dumps({"v": VERSION, "tiles": ids, "stats": {k: round(v) for k, v in sorted(stats.items())}}))
    print(f"{len(ids)} tuiles ({size / 1e3:.0f} ko) : {dict((k, round(v)) for k, v in sorted(stats.items()))}")


if __name__ == "__main__":
    main()
