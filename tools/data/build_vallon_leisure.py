"""Le plan d'eau du Vallon, lot 4 (D247, plan `docs/plans/vallon-lac.md`, §6 et §16) : les équipements.

Usage : python3 tools/data/build_vallon_leisure.py
D'après `vallonLeisure` de `manual.json` (positions relevées sur l'orthophotographie à 5 cm et les photos), OpenStreetMap (relevé du lot 0,
`survey_vallon.osm()`) et le relief publié :
- aire de glisse (rénovée, D248 : d'après les photos de l'utilisateur, pas d'après l'orthophotographie ni le LiDAR, plus anciens) : relief fin
  aplani sur toute l'aire puis creusé pour le bowl (blocs terrain/*.bin réécrits, comme build_water.py) ; modules (`quarter`, `funbox`, `box`)
  en tabliers piétons (`decks` des ouvrages, `k: "foot"`, style `skate`), qu'on monte à pied ou à vélo ; bande de béton (couche de sol `skate`,
  évidée au droit du bowl) ; bowl et piste d'éducation routière (`equip` : `bowl`, `court`, avec le plan du relief `pl`) ;
- pump track : les trois boucles d'OSM, lissées, en tabliers `k: "foot"`, style `pump` : enrobé à `base` m au-dessus du relief, qui porte
  déjà les bosses de la piste (LiDAR) ;
- équipements (`equip` des ouvrages) : jeux, tables, banc, agrès, panneaux, barre de glisse, grillage, ganivelle, pierres du gué et rigole ;
  un objet posé à moins de 1,2 m du bord du chemin du tour (vallon_path.json) en est écarté ;
- sols : dalle du skatepark (`skate`), gravillons (`play_gravel`) et sol souple (`play_mat`) de l'aire de jeux ;
- terrains et pistes génériques dans le skatepark et le pump track (`replaces`) : `sites` `pitch` et `track` des kinds (build_kinds.py) et
  pelouse de sport (couche `pitch`, build_public_space.py) retirés, ces équipements les remplacent.
Identifiants des tabliers : −(DECK_ID + n), retirés puis reposés. Cette étape est seule propriétaire de ces identifiants, de `equip` et des
couches `skate`, `play_gravel` et `play_mat` : une deuxième passe ne change rien. `bytes` des tuiles réécrites est mis à jour dans world.json.

Ordre : après build_vallon_piers.py et build_vallon_path.py (le chemin s'arrête aux tabliers : la pose du chemin ne touche pas ces endroits),
puis build_map.py --images.
"""

import json
import math
import sys

from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

import config as c
from survey_water import Relief

MANUAL = c.ROOT / "tools" / "data" / "manual.json"
TRACE = c.ROOT / "tools" / "data" / "vallon_path.json"
DECK_ID = 873_000_000
GROUND = ("skate", "play_gravel", "play_mat")
# Pourtour en béton du bowl (m au-delà du rebord) : il couvre le relief affiché abaissé autour du creux (`bowlPit`, src/core/leisure.ts :
# les carreaux de 2,5 m du relief affiché descendent jusqu'à 4,1 m hors du rebord). Même valeur que BOWL_APRON (src/core/leisure.ts).
BOWL_APRON = 4.2
# Écart minimal entre un équipement et le bord du chemin (m).
CLEAR = 1.2


def r2(v):
    return round(v, 2)


def tile_of(world, x, y):
    for m in world["tiles"]:
        x0, y0, x1, y1 = m["bounds"]
        if x0 <= x < x1 and y0 <= y < y1:
            return m["id"]
    return None


def rect(spec):
    """Rectangle tourné (centre `c`, axe long `a` en degrés, longueur `l`, largeur `w`)."""
    a = math.radians(spec["a"])
    ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
    cx, cy = spec["c"]
    hl, hw = spec["l"] / 2, spec["w"] / 2
    return Polygon([(cx + ux * s * hl + vx * t * hw, cy + uy * s * hl + vy * t * hw) for s, t in ((-1, -1), (1, -1), (1, 1), (-1, 1))])


def bowl_shape(b):
    """Contour du bowl : rectangle aux coins arrondis de rayon `r`."""
    inner = rect({**b, "l": b["l"] - 2 * b["r"], "w": b["w"] - 2 * b["r"]})
    return inner.buffer(b["r"], quad_segs=8)


def bowl_depth(b, x, y):
    """Profondeur du bowl sous son rebord en (x, y) (m, 0 dehors) : rectangle arrondi, parois en quart de cercle de rayon `depth`.
    Même formule que `bowlDepth` (src/core/leisure.ts)."""
    a = math.radians(b["a"])
    dx, dy = x - b["c"][0], y - b["c"][1]
    s, t = dx * math.cos(a) + dy * math.sin(a), -dx * math.sin(a) + dy * math.cos(a)
    r = b["r"]
    qx, qy = abs(s) - (b["l"] / 2 - r), abs(t) - (b["w"] / 2 - r)
    sdf = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r
    din = -sdf
    if din <= 0:
        return 0.0
    D = b["depth"]
    return D if din >= D else D - (D - math.sqrt(max(0.0, D * D - (D - din) ** 2)))


def chaikin(pts, n=2):
    """Lissage d'une ligne fermée ou ouverte (coins coupés au quart)."""
    closed = pts[0] == pts[-1]
    for _ in range(n):
        out = [] if closed else [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        out.append(out[0] if closed else pts[-1])
        pts = out
    return pts


def skate_deck(m, n, relief):
    """Tablier d'un module : axe dans le sens de la montée, profil (abscisse, hauteur) au-dessus du relief au centre."""
    a = math.radians(m["a"])
    ux, uy = math.cos(a), math.sin(a)
    cx, cy = m["c"]
    g = relief.at(cx, cy)
    if m["k"] == "quarter":
        # Courbe d'un rayon égal à la longueur de la rampe : pente nulle au pied, raide sous le rebord.
        h = m["h"]
        R = (m["run"] ** 2 + h ** 2) / (2 * h)
        prof = [(m["run"] * k / 6, R - math.sqrt(max(0.0, R * R - (m["run"] * k / 6) ** 2))) for k in range(7)]
        prof.append((m["run"] + m["top"], h))
        width = m["l"]
    elif m["k"] == "funbox":
        r, t, h = m["run"], m["top"], m["h"]
        prof = [(0, 0.0), (r, h), (r + t, h), (2 * r + t, 0.0)]
        width = m["l"]
    else:
        prof = [(0, m["h"]), (m["l"], m["h"])]
        width = m["w"]
    L = prof[-1][0]
    p = []
    for s, z in prof:
        x, y = cx + ux * (s - L / 2), cy + uy * (s - L / 2)
        p += [r2(x), r2(y), r2(g + max(z, 0.02))]
    return {"id": -(DECK_ID + n), "k": "foot", "w": width, "p": p, "st": "skate", "sp": [], "pc": [], "n": m["name"]}


def pump_decks(spec, nodes, ways, relief, n0):
    out = []
    for k, wid in enumerate(spec["osm"]):
        pts = chaikin([nodes[i] for i in ways[wid]["nodes"]])
        line = LineString(pts)
        L = line.length
        steps = max(2, int(L / 0.5))
        p = []
        for i in range(steps + 1):
            s = L * i / steps
            q = line.interpolate(s)
            # Plus haut des quatre cellules voisines : le jeu interpole le relief entre elles.
            z = max(relief.at(q.x + dx, q.y + dy) for dx in (-0.5, 0.5) for dy in (-0.5, 0.5)) + spec["base"]
            p += [r2(q.x), r2(q.y), r2(z)]
        out.append({"id": -(DECK_ID + n0 + k), "k": "foot", "w": spec["w"], "p": p, "st": "pump", "sp": [], "pc": [],
                    "n": f"Pump track, boucle {k + 1} (OSM w{wid})"})
    return out


def slab_plane(polygon):
    """Plan moyen de la dalle du skatepark, mesuré sur le relief fin (moindres carrés, en écartant les bosses des modules) : z = a·x + b·y + c.
    Mesuré une fois sur le relief publié d'origine et rangé dans manual.json (`slabPlane`) : `--plan` l'affiche."""
    import numpy as np
    import shapely
    from build_water import Blocks

    blocks = Blocks(json.loads((c.OUT / "world.json").read_text()))
    x0, y1, w, h = blocks.grid(polygon.bounds)
    xx, yy = np.meshgrid(x0 + np.arange(w), y1 - np.arange(h))
    z = blocks.read(x0, y1, w, h)
    core = shapely.contains_xy(polygon.buffer(-0.5), xx, yy) & ~np.isnan(z)
    A = np.c_[xx[core], yy[core], np.ones(core.sum())]
    zc = z[core]
    keep = np.ones(len(zc), bool)
    for _ in range(5):
        sol = np.linalg.lstsq(A[keep], zc[keep], rcond=None)[0]
        res = zc - A @ sol
        keep = res < np.percentile(res[keep], 70) + 0.05
    return [round(float(sol[0]), 6), round(float(sol[1]), 6), round(float(sol[2]), 3)]


def flatten(polygon, plane, bowl):
    """Aplanit le relief fin sous l'aire de glisse au plan `plane` (le LiDAR y a mesuré l'ancienne dalle et ses modules, que la rénovation a
    remplacés), puis y creuse le bowl. Cellules à moins de 0,3 m de l'aire, écrites là où le relief s'écarte de la cible de plus de 2 cm.
    Renvoie le nombre de cellules réécrites (0 à la deuxième passe)."""
    import numpy as np
    import shapely
    from build_water import Blocks, UNIT

    blocks = Blocks(json.loads((c.OUT / "world.json").read_text()))
    x0, y1, w, h = blocks.grid(polygon.bounds)
    xx, yy = np.meshgrid(x0 + np.arange(w), y1 - np.arange(h))
    z = blocks.read(x0, y1, w, h)
    inside = shapely.contains_xy(polygon.buffer(0.3), xx, yy) & ~np.isnan(z)
    dig = np.vectorize(lambda x, y: bowl_depth(bowl, x, y))(xx, yy)
    target = np.round((plane[0] * xx + plane[1] * yy + plane[2] - dig) / UNIT) * UNIT
    mask = inside & (np.abs(z - target) > 0.02)
    if mask.any():
        blocks.write(x0, y1, w, h, np.where(mask, target, z), mask)
        blocks.save()
    return int(mask.sum())


def main():
    import survey_vallon as sv

    manual = json.loads(MANUAL.read_text())
    spec = manual["vallonLeisure"]
    nodes, ways = sv.osm()
    band = Polygon(list(zip(spec["ground"]["skate"][0][::2], spec["ground"]["skate"][0][1::2])))
    slab = unary_union([band, rect(spec["court"]), bowl_shape(spec["bowl"]).buffer(BOWL_APRON, quad_segs=6)]).buffer(0)
    if "--plan" in sys.argv:
        old = Polygon([nodes[n] for n in ways[spec["replaces"][0]]["nodes"]]).buffer(0)
        print("plan de l'ancienne dalle :", slab_plane(old))
        return
    flat = flatten(slab, spec["slabPlane"], spec["bowl"])
    world = json.loads((c.OUT / "world.json").read_text())
    relief = Relief()
    paths = json.loads(TRACE.read_text())["paths"]
    lines = [(p["w"], LineString(list(zip(p["p"][::2], p["p"][1::2])))) for p in paths]

    decks = [skate_deck(m, n, relief) for n, m in enumerate(spec["skate"], start=1)]
    decks += pump_decks(spec["pump"], nodes, ways, relief, len(decks) + 1)

    # Équipements ponctuels, écartés du chemin.
    equip, moved = [], []
    for e in spec["equip"]:
        x, y = e["x"], e["y"]
        half = max(e.get("l", 1.6), e.get("w", 1.6)) / 2
        for w, ln in lines:
            d = ln.distance(Point(x, y))
            want = w / 2 + CLEAR + half
            if d < want:
                q = ln.interpolate(ln.project(Point(x, y)))
                dx, dy = x - q.x, y - q.y
                n = math.hypot(dx, dy) or 1.0
                x, y = q.x + dx / n * want, q.y + dy / n * want
                moved.append(f"{e['name']} : {math.dist((x, y), (e['x'], e['y'])):.1f} m")
        rec = {"k": e["k"], "x": r2(x), "y": r2(y), "a": r2(math.radians(e["a"])), "n": e["name"]}
        for key in ("l", "w", "c"):
            if key in e:
                rec[key] = e[key]
        equip.append(rec)
    for r in spec["rails"]:
        equip.append({"k": "rail", "p": r["p"], "h": r["h"], "n": r["name"]})
    for k in ("court", "bowl"):
        b = spec[k]
        rec = {"k": k, "x": b["c"][0], "y": b["c"][1], "a": r2(math.radians(b["a"])), "l": b["l"], "w": b["w"], "pl": spec["slabPlane"], "n": b["name"]}
        if k == "bowl":
            rec.update({"h": b["depth"], "r": b["r"]})
        equip.append(rec)
    for f in spec["fence"]:
        equip.append({"k": "fence", "p": f["p"], "h": f["h"], "n": f["name"]})
    for f in spec["ganivelle"]:
        equip.append({"k": "ganivelle", "p": f["p"], "h": f["h"], "n": f["name"]})
    ford = spec["ford"]
    ax, ay, bx, by = ford["stones"]
    ang = math.atan2(by - ay, bx - ax)
    for i in range(ford["n"]):
        t = i / (ford["n"] - 1)
        equip.append({"k": "stone", "x": r2(ax + (bx - ax) * t), "y": r2(ay + (by - ay) * t), "a": r2(ang + 0.3 * math.sin(i * 2.1)),
                      "l": 0.62, "w": 0.48, "n": f"{ford['name']}, pierre {i + 1}"})
    equip.append({"k": "brook", "p": ford["brook"], "w": ford["brookW"], "n": f"{ford['name']}, rigole"})

    def where(e):
        if "p" in e:
            q = e["p"]
            return tile_of(world, sum(q[::2]) / (len(q) // 2), sum(q[1::2]) / (len(q) // 2))
        return tile_of(world, e["x"], e["y"])

    equip_by_tile, decks_by_tile = {}, {}
    for e in equip:
        equip_by_tile.setdefault(where(e), []).append(e)
    for d in decks:
        q = d["p"]
        line = LineString([(q[i], q[i + 1]) for i in range(0, len(q), 3)])
        for m in world["tiles"]:
            if line.intersects(box(*m["bounds"])):
                decks_by_tile.setdefault(m["id"], []).append(d)

    changed_st = []
    for m in world["tiles"]:
        tid = m["id"]
        sp = c.OUT / "structures" / f"{tid}.json"
        if not sp.exists():
            if tid in decks_by_tile or tid in equip_by_tile:
                raise SystemExit(f"{tid} : équipements sans fichier d'ouvrages")
            continue
        text = sp.read_text()
        mine = tid in decks_by_tile or tid in equip_by_tile
        if not mine and f'"id":-{DECK_ID // 1_000_000}' not in text and '"equip"' not in text:
            continue
        st = json.loads(text)
        st["decks"] = [d for d in st["decks"] if not (-DECK_ID - 999_999 <= d["id"] <= -DECK_ID)] + decks_by_tile.get(tid, [])
        if tid in equip_by_tile:
            st["equip"] = equip_by_tile[tid]
        else:
            st.pop("equip", None)
        new = json.dumps(st, ensure_ascii=False, separators=(",", ":"))
        if new != text:
            sp.write_text(new)
            changed_st.append(tid)

    # Terrains et pistes génériques que ces équipements remplacent (voir plus bas pour les kinds).
    area = unary_union([Polygon([nodes[n] for n in ways[w]["nodes"]]).buffer(0) for w in spec["replaces"]]).buffer(2.0)

    # Sols.
    owned = {}
    for layer, src in spec["ground"].items():
        rings = src if isinstance(src, list) else [[v for n in ways[int(src[4:])]["nodes"][:-1] for v in nodes[n]]]
        for r in rings:
            g = Polygon(list(zip(r[::2], r[1::2]))).buffer(0)
            if layer == "skate":
                # Évidée au bowl et à son pourtour en béton, que le rendu dessine lui-même (`buildBowl`, src/render/leisure.ts).
                g = g.difference(bowl_shape(spec["bowl"]).buffer(BOWL_APRON, quad_segs=6)).buffer(0)
            owned.setdefault(tile_of(world, *g.representative_point().coords[0]), {}).setdefault(layer, []).append(g)
    changed = []
    for m in world["tiles"]:
        tid = m["id"]
        tp = c.OUT / "tiles" / f"{tid}.json"
        if not tp.exists():
            continue
        text = tp.read_text()
        if tid not in owned and not any(f'"{k}"' in text for k in GROUND) and not box(*m["bounds"]).intersects(area):
            continue
        t = json.loads(text)
        # La pelouse de sport générique (couche `pitch`, build_public_space.py) du skatepark et du pump track : retirée (elle recouvrait
        # la piste dans les creux des bosses ; le relief nu est de l'herbe).
        # Sols des autres étapes (pelouses, places) au droit du bowl : découpés, sinon leurs grands triangles tendent une nappe au-dessus du creux.
        hole = bowl_shape(spec["bowl"]).buffer(BOWL_APRON)
        for layer in list(t["ground"]):
            if layer in GROUND or layer == "path_gravel":
                continue
            out = []
            for q in t["ground"][layer]:
                g = Polygon(list(zip(q[0][::2], q[0][1::2])), [list(zip(h[::2], h[1::2])) for h in q[1:]]).buffer(0)
                if g.intersection(hole).area < 0.05:
                    out.append(q)
                    continue
                for part in getattr(g.difference(hole), "geoms", [g.difference(hole)]):
                    if part.geom_type == "Polygon" and part.area > 0.5:
                        out.append([[r2(v) for xy in list(ring.coords)[:-1] for v in xy] for ring in (part.exterior, *part.interiors)])
            if out:
                t["ground"][layer] = out
            else:
                del t["ground"][layer]
        if "pitch" in t["ground"]:
            t["ground"]["pitch"] = [q for q in t["ground"]["pitch"]
                                    if not area.contains(Polygon(list(zip(q[0][::2], q[0][1::2]))).buffer(0).representative_point())]
            if not t["ground"]["pitch"]:
                del t["ground"]["pitch"]
        for k in GROUND:
            gs = owned.get(tid, {}).get(k)
            if gs:
                t["ground"][k] = [[[r2(v) for q in list(ring.coords)[:-1] for v in q] for ring in (g.exterior, *g.interiors)] for g in gs]
            else:
                t["ground"].pop(k, None)
        new = json.dumps(t, separators=(",", ":"), ensure_ascii=False)
        if new != text:
            tp.write_text(new)
            changed.append(tid)
            m["bytes"] = len(new.encode())
    if changed:
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))

    # Terrains et pistes génériques (build_kinds.py) que ces équipements remplacent : la surface verte du skatepark et du pump track
    # (leisure=pitch) et la piste rouge (leisure=track) recouvraient la dalle, les modules et l'enrobé.
    dropped = 0
    for m in world["tiles"]:
        kp = c.OUT / "kinds" / f"{m['id']}.json"
        if not kp.exists() or not box(*m["bounds"]).intersects(area):
            continue
        text = kp.read_text()
        k = json.loads(text)
        keep = [q for q in k["sites"] if not (q["t"] in ("pitch", "track")
                                              and area.contains(LineString(list(zip(q["r"][::2], q["r"][1::2]))).centroid))]
        dropped += len(k["sites"]) - len(keep)
        k["sites"] = keep
        new = json.dumps(k, ensure_ascii=False, separators=(",", ":"))
        if new != text:
            kp.write_text(new)
            changed_st.append(f"kinds/{m['id']}")

    pump_len = sum(LineString([(d["p"][i], d["p"][i + 1]) for i in range(0, len(d["p"]), 3)]).length for d in decks if d["st"] == "pump")
    print(f"{len(spec['skate'])} modules de skatepark ; pump track : {pump_len:.0f} m en {len(spec['pump']['osm'])} boucles ; "
          f"{len(equip)} équipements ({len(moved)} écartés du chemin : {', '.join(moved) or 'aucun'})")
    print(f"dalle du skatepark : {flat} cellules de relief aplanies ; ouvrages réécrits : {changed_st or 'aucun'} ; tuiles réécrites : {changed or 'aucune'}")


if __name__ == "__main__":
    main()
