"""Relevés du lot 0 des remparts (docs/plans/remparts.md) : tracé, profils, tours, promenades et photos de rue disponibles.

Sources, toutes lues à distance et mises en cache dans .cache/remparts/ (hors git) :
- OpenStreetMap (Overpass) : murs `barrier=city_wall` / `historic=citywalls`, portes, chemins piétons proches ;
- nuage de points LiDAR HD de l'IGN (dalles COPC lues par requêtes partielles : une bande de 30 m autour de chaque mur) ;
- Panoramax (photos de rue libres, CC-BY-SA) : position, date et cap de chaque photo à moins de 40 m d'un mur.

Profils en travers tous les 4 m : sommet du mur (points non classés, sol et bâti ; la végétation à part), sol de chaque côté (classe 2,
de 4 à 12 m de l'axe), hauteur côté ville et côté extérieur, largeur du dessus, part de végétation au-dessus du mur. Côté « ville » :
celui qui regarde le centre de l'enceinte (centroïde de tous les murs).

Sorties : rapport texte (stdout), `.cache/remparts/survey.json` (tronçons, profils, tours, promenades, photos) et la carte numérotée
`docs/captures/remparts-carte.png`. Aucun fichier du jeu n'est modifié.

Usage : python3 tools/data/survey_remparts.py
Repère : local du jeu (x est, y nord, z au-dessus de ORIGIN_Z), mètres.
"""

import json
import math
import time

import laspy
import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.ops import substring

import config as c

OX, OY = c.ORIGIN
CACHE = c.ROOT / ".cache" / "remparts"
CARTE = c.ROOT / "docs" / "captures" / "remparts-carte.png"
BBOX = (46.935, 4.285, 46.958, 4.312)  # sud, ouest, nord, est (WGS84) : toute la ville ancienne
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter")
WFS = "https://data.geopf.fr/wfs/ows"
PANORAMAX = "https://api.panoramax.xyz/api/search"
STEP = 4.0  # pas des profils (m)
HALF = 12.0  # demi-largeur des profils (m)
BAND = 15.0  # demi-largeur de la bande LiDAR lue autour de chaque mur (m)
PIECE = 80.0  # longueur visée d'un tronçon numéroté (m)
LANDMARKS = {"mairie": (0.0, 0.0), "cathédrale": (37.0, -574.0)}  # centroïde de BATIMENT…348852451 (tuile 26_32)
PHOTO_R = 35.0  # une photo de rue « couvre » une station à moins de cette distance

TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
TO_WGS = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


def local(lon, lat):
    x, y = TO_L93.transform(lon, lat)
    return x - OX, y - OY


def get_json(urls, **kw):
    last = None
    for attempt in range(6):
        for u in urls:
            try:
                r = requests.post(u, timeout=180, headers={"User-Agent": c.USER_AGENT}, **kw) if "data" in kw else \
                    requests.get(u, timeout=180, headers={"User-Agent": c.USER_AGENT}, **kw)
                r.raise_for_status()
                return r.json()
            except Exception as e:  # noqa: BLE001 - miroirs Overpass capricieux
                last = e
        time.sleep(2 ** attempt)
    raise RuntimeError(f"échec : {last}")


def osm():
    f = CACHE / "osm.json"
    if not f.exists():
        s, w, n, e = BBOX
        b = f"({s},{w},{n},{e})"
        q = f"""[out:json][timeout:120];(
          way["barrier"="city_wall"]{b}; way["historic"="citywalls"]{b}; nwr["historic"="city_gate"]{b};
          nwr["defensive_works"]{b}; nwr["historic"="tower"]{b}; nwr["man_made"="tower"]["tower:type"="defensive"]{b};
          way["highway"~"^(footway|path|pedestrian|steps|track|living_street)$"]{b};
        );out tags geom;"""
        d = get_json(OVERPASS, data={"data": q})
        CACHE.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(d))
    d = json.loads(f.read_text())
    walls, paths, gates = [], [], []
    for e in d["elements"]:
        t = e.get("tags", {})
        geom = e.get("geometry") or ([{"lon": e["lon"], "lat": e["lat"]}] if "lon" in e else [])
        pts = [local(g["lon"], g["lat"]) for g in geom]
        if not pts:
            continue
        if t.get("barrier") == "city_wall" or t.get("historic") == "citywalls":
            if len(pts) >= 2:
                walls.append({"id": e["id"], "tags": t, "pts": pts})
        elif t.get("historic") == "city_gate" or "defensive_works" in t or t.get("historic") == "tower" or t.get("man_made") == "tower":
            gates.append({"id": e["id"], "tags": t, "at": tuple(np.mean(pts, axis=0))})
        elif "highway" in t and len(pts) >= 2:
            paths.append({"id": e["id"], "tags": t, "pts": pts})
    return walls, paths, gates


def copc_urls(x0, y0, x1, y1):
    meta = get_json([WFS], params={
        "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "IGNF_LIDAR-HD_METADONNEE:metadata",
        "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154", "COUNT": 50,
        "BBOX": f"{x0 + OX},{y0 + OY},{x1 + OX},{y1 + OY},urn:ogc:def:crs:EPSG::2154"})["features"]
    return sorted({m["properties"]["url_npl"] for m in meta})


def lidar(wall):
    """Points LiDAR d'une bande de BAND m autour du mur (toutes dalles), en repère local."""
    f = CACHE / f"lidar_{wall['id']}.npz"
    if not f.exists():
        line = LineString(wall["pts"]).buffer(BAND)
        x0, y0, x1, y1 = line.bounds
        xs, ys, zs, cs = [], [], [], []
        for url in copc_urls(x0, y0, x1, y1):
            with laspy.CopcReader.open(url) as r:
                p = r.query(laspy.copc.Bounds(mins=np.array([x0 + OX, y0 + OY]), maxs=np.array([x1 + OX, y1 + OY])))
            xs.append(np.array(p.x) - OX)
            ys.append(np.array(p.y) - OY)
            zs.append(np.array(p.z) - c.ORIGIN_Z)
            cs.append(np.array(p.classification))
        x, y = np.concatenate(xs), np.concatenate(ys)
        # Ne garder que la bande (la boîte englobante d'un mur en diagonale est surtout vide).
        from shapely import contains_xy
        keep = contains_xy(line, x, y)
        np.savez_compressed(f, x=x[keep], y=y[keep], z=np.concatenate(zs)[keep], c=np.concatenate(cs)[keep])
    d = np.load(f)
    return d["x"], d["y"], d["z"], d["c"]


def panoramax():
    f = CACHE / "panoramax.json"
    if not f.exists():
        s, w, n, e = BBOX
        feats, url, params = [], PANORAMAX, {"bbox": f"{w},{s},{e},{n}", "limit": 1000}
        while url:
            d = get_json([url], params=params)
            feats += d["features"]
            nxt = [lk["href"] for lk in d.get("links", []) if lk.get("rel") == "next"]
            url, params = (nxt[0], None) if nxt and len(feats) < 20000 else (None, None)
        CACHE.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(feats))
    out = []
    for p in json.loads(f.read_text()):
        lon, lat = p["geometry"]["coordinates"][:2]
        x, y = local(lon, lat)
        pr = p.get("properties", {})
        out.append({"id": p["id"], "x": x, "y": y, "date": (pr.get("datetime") or "")[:10], "cap": pr.get("view:azimuth")})
    return out


def profiles(wall, centre):
    x, y, z, cl = lidar(wall)
    line = LineString(wall["pts"])
    mason = (cl <= 2) | (cl == 6)  # non classé, sol, bâti : la maçonnerie peut être dans l'un ou l'autre
    veg = (cl >= 3) & (cl <= 5)
    out = []
    n = max(1, int(line.length // STEP))
    for k in range(n + 1):
        d = min(k * STEP, line.length)
        p = line.interpolate(d)
        a, b = line.interpolate(max(0, d - 1)), line.interpolate(min(line.length, d + 1))
        tx, ty = b.x - a.x, b.y - a.y
        L = math.hypot(tx, ty) or 1
        tx, ty = tx / L, ty / L
        nx, ny = ty, -tx
        if (centre[0] - p.x) * nx + (centre[1] - p.y) * ny < 0:  # n regarde la ville
            nx, ny = -nx, -ny
        dx, dy = x - p.x, y - p.y
        along, off = dx * tx + dy * ty, dx * nx + dy * ny
        sl = (np.abs(along) < 1.5) & (np.abs(off) <= HALF)
        if sl.sum() < 20:
            out.append({"d": d, "x": p.x, "y": p.y, "vide": True})
            continue
        bins = np.floor(off[sl] / 0.5).astype(int)
        zz, mm, cc = z[sl], mason[sl], cl[sl]
        bmax = {}
        for bi, zi, mi in zip(bins, zz, mm):
            if mi and zi > bmax.get(bi, -1e9):
                bmax[bi] = zi

        def ground(lo, hi):
            g = zz[(cc == 2) & (off[sl] >= lo) & (off[sl] <= hi)]
            return float(np.percentile(g, 30)) if len(g) >= 5 else None

        core = [v for bi, v in bmax.items() if -2.5 <= bi * 0.5 <= 2.0]
        if not core:
            out.append({"d": d, "x": p.x, "y": p.y, "vide": True})
            continue
        top = float(np.percentile(core, 90))
        g_in, g_out = ground(4, HALF), ground(-HALF, -4)
        # Largeur du dessus : bandes contiguës à moins de 0,8 m du sommet, de part et d'autre de l'axe (plafonnée à HALF).
        w_in = w_out = 0.0
        for side, sgn in ((1, 1), (0, -1)):
            k2 = 0 if sgn > 0 else -1
            run = 0.0
            while abs(k2 * 0.5) <= HALF:
                v = bmax.get(k2)
                if v is None or v < top - 0.8:
                    break
                run += 0.5
                k2 += sgn
            if side:
                w_in = run
            else:
                w_out = run
        # Saillie extérieure haute (tour) : point de maçonnerie le plus loin côté extérieur, à plus de 2 m au-dessus du sol extérieur
        # et à moins de 3 m sous le sommet.
        lim = max((g_out if g_out is not None else top - 99) + 2.0, top - 3.0)
        ext = [-bi * 0.5 for bi, v in bmax.items() if bi < 0 and v >= lim]
        ext_out = max(ext) if ext else 0.0
        cls_hi = cc[mm & (zz > top - 2) & (np.abs(off[sl]) < 2)]
        vh = veg[sl] & (np.abs(off[sl]) < 2) & (zz > top + 0.5)
        out.append({
            "d": round(d, 1), "x": round(p.x, 1), "y": round(p.y, 1), "n": (round(nx, 3), round(ny, 3)),
            "top": round(top, 2), "g_in": None if g_in is None else round(g_in, 2), "g_out": None if g_out is None else round(g_out, 2),
            "h_in": None if g_in is None else round(top - g_in, 2), "h_out": None if g_out is None else round(top - g_out, 2),
            "w_top": round(w_in + w_out, 1), "ext_out": round(ext_out, 1),
            "sol_pct": round(100 * float(np.mean(cls_hi == 2)), 0) if len(cls_hi) else None,
            "bati_pct": round(100 * float(np.mean(cls_hi == 6)), 0) if len(cls_hi) else None,
            "veg": int(vh.sum()),
        })
    return out


def kind(p):
    """Nature du mur à une station (lecture du profil)."""
    if p.get("vide"):
        return "sans mesure"
    hi = [h for h in (p["h_in"], p["h_out"]) if h is not None]
    if not hi:
        return "sans mesure"
    hmax = max(hi)
    if hmax < 0.8:
        return "rien de visible"
    if hmax < 2.0:
        return "arasé (bas)"
    if p["w_top"] >= 6 or (p["h_in"] is not None and p["h_in"] < 1.0 and (p["h_out"] or 0) >= 2.0) \
            or (p["h_out"] is not None and p["h_out"] < 1.0 and (p["h_in"] or 0) >= 2.0):
        return "soutènement"
    return "mur libre"


def towers(profs):
    """Saillies extérieures hautes de 4 à 18 m de long : tours probables."""
    out, run = [], []
    for p in profs + [{"vide": True}]:
        # Une saillie qui atteint le bord du profil (≥ HALF − 1) est un bâtiment ou le relief, pas une tour ; une tour domine le sol
        # extérieur d'au moins 4 m.
        if not p.get("vide") and 3.0 <= p["ext_out"] < HALF - 1 and (p["h_out"] or 0) >= 4 and p["w_top"] < 6:
            run.append(p)
            continue
        if run:
            L = run[-1]["d"] - run[0]["d"] + STEP
            if 4 <= L <= 18:
                m = run[len(run) // 2]
                out.append({"x": m["x"], "y": m["y"], "long": L, "saillie": max(r["ext_out"] for r in run),
                            "h_out": max((r["h_out"] or 0) for r in run), "top": max(r["top"] for r in run)})
            run = []
    return out


def walk_paths(walls, paths, profs_by_wall):
    """Chemins OSM le long d'un mur : sur le dessus (à 1,2 m près du sommet mesuré), ou au pied."""
    tops = []
    for w in walls:
        for p in profs_by_wall[w["id"]]:
            if not p.get("vide"):
                tops.append((p["x"], p["y"], p["top"], p.get("g_in"), p.get("g_out"), w["id"]))
    if not tops:
        return []
    T = np.array([(t[0], t[1]) for t in tops])
    res = []
    for pa in paths:
        ln = LineString(pa["pts"])
        on, foot, near_ids = 0.0, 0.0, set()
        for k in range(int(ln.length // 2) + 1):
            q = ln.interpolate(k * 2.0)
            dd = np.hypot(T[:, 0] - q.x, T[:, 1] - q.y)
            i = int(np.argmin(dd))
            if dd[i] > 6:
                continue
            near_ids.add(tops[i][5])
            res_pt = tops[i]
            # « Sur le dessus » : à moins de 3 m de l'axe, et le sol d'un côté est au niveau du sommet (mur de soutènement dont le haut
            # est une terrasse). L'altitude du chemin lui-même n'est pas lue : à vérifier sur photo.
            on_top = dd[i] < 3 and any(g is not None and abs(res_pt[2] - g) < 1.2 for g in (res_pt[3], res_pt[4]))
            if on_top:
                on += 2
            else:
                foot += 2
        if on + foot >= 10:
            res.append({"id": pa["id"], "highway": pa["tags"].get("highway"), "name": pa["tags"].get("name"),
                        "sur": on, "pied": foot, "murs": sorted(near_ids)})
    return res


def pieces(walls, profs_by_wall, centre):
    """Tronçons numérotés : chaque mur coupé en morceaux d'environ PIECE m, numérotés dans le sens horaire depuis le nord."""
    out = []
    for w in walls:
        line = LineString(w["pts"])
        n = max(1, round(line.length / PIECE))
        for k in range(n):
            a, b = line.length * k / n, line.length * (k + 1) / n
            seg = substring(line, a, b)
            mid = seg.interpolate(0.5, normalized=True)
            ps = [p for p in profs_by_wall[w["id"]] if a - 1e-6 <= p["d"] <= b + 1e-6]
            kinds = {}
            for p in ps:
                kinds[kind(p)] = kinds.get(kind(p), 0) + 1
            ok = [p for p in ps if not p.get("vide")]

            def med(key, ps=ok):
                v = [p[key] for p in ps if p.get(key) is not None]
                return round(float(np.median(v)), 1) if v else None

            out.append({
                "wall": w["id"], "name": w["tags"].get("name"), "a": round(a, 1), "b": round(b, 1), "long": round(b - a, 1),
                "mid": (round(mid.x, 1), round(mid.y, 1)), "pts": [(round(px, 1), round(py, 1)) for px, py in seg.coords],
                "cap": round(math.degrees(math.atan2(mid.x - centre[0], mid.y - centre[1])) % 360, 0),
                "nature": max(kinds, key=kinds.get) if kinds else "sans mesure", "natures": kinds,
                "h_in": med("h_in"), "h_out": med("h_out"), "w_top": med("w_top"), "sol_pct": med("sol_pct"), "veg": med("veg"),
                "top": med("top"),
            })
    out.sort(key=lambda p: p["cap"])
    for i, p in enumerate(out, 1):
        p["num"] = f"R{i:02d}"
    return out


def gaps(walls):
    """Trous entre bouts de murs voisins (moins de 250 m) : candidats à des portions non cartographiées ou disparues."""
    ends = []
    for w in walls:
        ends += [(w["pts"][0], w["id"]), (w["pts"][-1], w["id"])]
    out = []
    for i, (p, wi) in enumerate(ends):
        best = None
        for j, (q, wj) in enumerate(ends):
            if wj == wi:
                continue
            d = math.dist(p, q)
            if best is None or d < best[0]:
                best = (d, q, wj)
        if best and 3 < best[0] < 250 and wi < best[2]:
            out.append({"de": wi, "a": best[2], "long": round(best[0]), "p": [round(v, 1) for v in p],
                        "q": [round(v, 1) for v in best[1]]})
    seen, uniq = set(), []
    for g in sorted(out, key=lambda g: g["long"]):
        k = (g["de"], g["a"])
        if k not in seen:
            seen.add(k)
            uniq.append(g)
    return uniq


def draw(pieces_, towers_, gaps_, photos, gates):
    allp = np.array([pt for p in pieces_ for pt in p["pts"]])
    x0, y0 = allp.min(axis=0) - 120
    x1, y1 = allp.max(axis=0) + 120
    s = 1.6  # px/m
    W, H = int((x1 - x0) * s), int((y1 - y0) * s)
    img = Image.new("RGB", (W, H), (246, 243, 236))
    dr = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
    except OSError:
        font = small = ImageFont.load_default()

    def P(x, y):
        return ((x - x0) * s, (y1 - y) * s)

    for ph in photos:
        X, Y = P(ph["x"], ph["y"])
        dr.ellipse((X - 1.5, Y - 1.5, X + 1.5, Y + 1.5), fill=(150, 170, 215))
    colors = {"mur libre": (176, 58, 46), "soutènement": (214, 137, 16), "arasé (bas)": (125, 102, 8),
              "rien de visible": (160, 160, 160), "sans mesure": (90, 90, 90)}
    for p in pieces_:
        dr.line([P(*q) for q in p["pts"]], fill=colors[p["nature"]], width=7)
    for g in gaps_:
        dr.line([P(*g["p"]), P(*g["q"])], fill=(120, 120, 120), width=2)
    for t in towers_:
        X, Y = P(t["x"], t["y"])
        dr.rectangle((X - 6, Y - 6, X + 6, Y + 6), outline=(20, 20, 20), width=2, fill=(255, 255, 255))
    for gt in gates:
        X, Y = P(*gt["at"])
        dr.polygon([(X, Y - 8), (X + 8, Y + 6), (X - 8, Y + 6)], fill=(40, 90, 160))
        dr.text((X + 10, Y - 8), gt["tags"].get("name", "porte"), fill=(40, 90, 160), font=small)
    for p in pieces_:
        X, Y = P(*p["mid"])
        dr.text((X + 6, Y - 18), p["num"], fill=(20, 20, 20), font=font, stroke_width=3, stroke_fill=(246, 243, 236))
    for name, (lx, ly_) in LANDMARKS.items():
        X, Y = P(lx, ly_)
        dr.ellipse((X - 4, Y - 4, X + 4, Y + 4), fill=(60, 60, 60))
        dr.text((X + 7, Y - 7), name, fill=(60, 60, 60), font=small)
    ly = 10
    for k, col in colors.items():
        dr.rectangle((10, ly + 4, 34, ly + 12), fill=col)
        dr.text((40, ly), k, fill=(20, 20, 20), font=small)
        ly += 20
    dr.rectangle((16, ly + 2, 28, ly + 14), outline=(20, 20, 20), width=2, fill=(255, 255, 255))
    dr.text((40, ly), "tour probable (saillie LiDAR)", fill=(20, 20, 20), font=small)
    ly += 20
    dr.ellipse((19, ly + 5, 25, ly + 11), fill=(150, 170, 215))
    dr.text((40, ly), "photo Panoramax", fill=(20, 20, 20), font=small)
    ly += 20
    dr.line([(10, ly + 8), (34, ly + 8)], fill=(120, 120, 120), width=2)
    dr.text((40, ly), "trou entre deux murs cartographiés", fill=(20, 20, 20), font=small)
    # Barre d'échelle : 200 m.
    dr.line([(W - 30 - 200 * s, H - 30), (W - 30, H - 30)], fill=(20, 20, 20), width=3)
    dr.text((W - 30 - 200 * s, H - 52), "200 m", fill=(20, 20, 20), font=small)
    dr.text((W - 70, 10), "N ↑", fill=(20, 20, 20), font=font)
    CARTE.parent.mkdir(parents=True, exist_ok=True)
    img.save(CARTE, optimize=True)


def main():
    walls, paths, gates = osm()
    centre = tuple(np.mean([pt for w in walls for pt in w["pts"]], axis=0))
    print(f"{len(walls)} murs OSM ({sum(LineString(w['pts']).length for w in walls):.0f} m), {len(gates)} portes ou tours OSM, "
          f"{len(paths)} chemins piétons ; centre de l'enceinte ({centre[0]:.0f} ; {centre[1]:.0f})")
    for g in gates:
        print(f"  {g['tags'].get('name', '?')} ({g['at'][0]:.0f} ; {g['at'][1]:.0f}) {g['tags'].get('historic') or g['tags'].get('man_made')}")
    profs = {}
    for w in walls:
        profs[w["id"]] = profiles(w, centre)
    pcs = pieces(walls, profs, centre)
    tw = []
    for w in walls:
        for t in towers(profs[w["id"]]):
            t["wall"] = w["id"]
            tw.append(t)
    wk = walk_paths(walls, paths, profs)
    gp = gaps(walls)
    photos = panoramax()
    near = []
    for ph in photos:
        dmin = min(math.dist((ph["x"], ph["y"]), p["mid"]) for p in pcs)
        if dmin < 250:
            near.append(ph)
    for p in pcs:
        line = LineString(p["pts"])
        cov = [ph for ph in near if line.distance(Point(ph["x"], ph["y"])) < PHOTO_R]
        p["photos"] = len(cov)
        p["photo_ex"] = sorted(cov, key=lambda ph: ph["date"], reverse=True)[0]["id"] if cov else None
        p["photo_dates"] = sorted({ph["date"][:4] for ph in cov})

    print("\nTronçons (sens horaire depuis le nord, cap vu du centre) : nature, hauteur côté ville / côté extérieur, largeur du dessus,")
    print("part de la maçonnerie classée « sol » par l'IGN (donc déjà dans le relief du jeu), végétation au-dessus, photos de rue à < 35 m")
    print(" n°   mur OSM      long  cap  nature            h ville  h ext  dessus  sol%  vég  photos")
    for p in pcs:
        f = lambda v: "  -  " if v is None else f"{v:5.1f}"  # noqa: E731
        print(f" {p['num']}  {p['wall']:<11} {p['long']:5.0f} {p['cap']:4.0f}  {p['nature']:<16} {f(p['h_in'])}  {f(p['h_out'])}  "
              f"{f(p['w_top'])}  {f(p['sol_pct'])}  {f(p['veg'])}  {p['photos']:4d} {','.join(p['photo_dates'])}")
    tot = sum(p["long"] for p in pcs)
    by = {}
    for p in pcs:
        by[p["nature"]] = by.get(p["nature"], 0) + p["long"]
    print(f"\nTotal {tot:.0f} m : " + ", ".join(f"{k} {v:.0f} m" for k, v in sorted(by.items(), key=lambda kv: -kv[1])))
    cov = sum(p["long"] for p in pcs if p["photos"] > 0)
    print(f"Couverts par au moins une photo de rue à < {PHOTO_R:.0f} m : {cov:.0f} m ({100 * cov / tot:.0f} %) ; {len(near)} photos près des murs")
    print(f"\nTours probables (saillie extérieure ≥ 3 m, haute, de 4 à 18 m de long) : {len(tw)}")
    for t in tw:
        print(f"  ({t['x']:.0f} ; {t['y']:.0f}) mur {t['wall']} : {t['long']:.0f} m de long, saillie {t['saillie']:.1f} m, "
              f"{t['h_out']:.1f} m côté extérieur")
    print("\nChemins piétons le long des murs (m sur le dessus / au pied) :")
    for w_ in sorted(wk, key=lambda w_: -w_["sur"]):
        print(f"  {w_['id']} {w_['highway']} {w_['name'] or ''} : {w_['sur']:.0f} / {w_['pied']:.0f} ; murs {w_['murs']}")
    print("\nTrous entre murs cartographiés (bout à bout, moins de 250 m) :")
    for g in gp:
        print(f"  {g['de']} → {g['a']} : {g['long']} m, de ({g['p'][0]:.0f} ; {g['p'][1]:.0f}) à ({g['q'][0]:.0f} ; {g['q'][1]:.0f})")

    draw(pcs, tw, gp, near, gates)
    (CACHE / "survey.json").write_text(json.dumps({"pieces": pcs, "towers": tw, "walks": wk, "gaps": gp, "profiles": profs,
                                                   "gates": [{"name": g["tags"].get("name"), "at": g["at"]} for g in gates]},
                                                  default=float))
    print(f"\nCarte : {CARTE.relative_to(c.ROOT)} ; détail : .cache/remparts/survey.json")


if __name__ == "__main__":
    main()
