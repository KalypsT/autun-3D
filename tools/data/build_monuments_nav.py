"""Passants et monuments d'après photo (D138) : la navigation passe par les arches des portes romaines, sans la régénérer.

Usage : python3 tools/data/build_monuments_nav.py     (après build_monuments.py, qui écrit le modèle des portes, et après build_nav.py, qui
        réécrit toute la navigation à partir d'OpenStreetMap : relancer celle-ci ensuite)
Entrées : sites `gate` de public/data/kinds (modèle `gm`, D137), public/data/nav/<super-tuile>.json.
Sortie : les super-tuiles de navigation qui contiennent une porte, le temple de Janus ou un commerce vu sur une photo, et leurs entrées dans nav/index.json ; rien d'autre.

Commerces vus sur une photo (D141) : leur point d'intérêt « commerce », que build_nav.py ne connaît pas (voir `shop_pois`).

Temple de Janus (D139) : aucun chemin n'y entrait ; une boucle passe par une arche du mur ouest, le milieu de la cella et l'arche du mur sud,
raccordée aux chemins voisins (voir `janus_paths` ; réversible, comme build_theatre_nav.py).

build_nav.py trace les chemins d'OpenStreetMap, qui ignorent les piles : à la porte Saint-André, un chemin de la placette traverse la porte
en biais et passait par la pile centrale. Chaque arête piétonne qui traverse le plan médian d'une porte ailleurs que dans une arche (à 50 cm
des piédroits) est détournée par le milieu de l'arche la plus proche (deux points, à 80 cm devant chaque face) ; un nœud qui tombe dans une
pile ou dans la tour est poussé à 80 cm devant la face la plus proche ; les longueurs sont recalculées.
Une deuxième passe ne change rien (le chemin passe alors par l'arche).
"""

import json
import math

import numpy as np

import config as c
import build_theatre_nav as btn
from build_theatre_nav import ES, KINDS, NAV, PATH, Graph, cell_of, length

JANUS_REF = 542936385  # voie OpenStreetMap du temple de Janus (D139)


def janus_site():
    for p in sorted(KINDS.glob("*_*.json")):
        for s in json.loads(p.read_text())["sites"]:
            if s.get("t") == "janus":
                return s
    return None


def janus_paths(G, s):
    """Boucle des passants dans le temple de Janus (D139) : du chemin OpenStreetMap à l'ouest, par l'arche nord du mur ouest, au milieu de
    la cella, puis par l'arche du mur sud jusqu'au chemin au sud. Nœuds marqués (drapeau 64) et arêtes à la référence du temple : une passe
    retire d'abord ce qu'elle avait ajouté (et recolle les arêtes coupées), puis le refait. Rend le nombre d'arêtes ajoutées."""
    btn.REF = JANUS_REF
    G.unpatch()
    (ox, oy), a = s["o"], s["a"]
    u, v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    P = lambda ss, t: (ox + u[0] * ss + v[0] * t, oy + u[1] * ss + v[1] * t)
    Ls, Lt = s["L"]
    twS, twW = s["tw"]
    wa = max(s["W"]["arches"], key=lambda q: q[0])[0]
    sa = s["S"]["arches"][0][0]
    hub = G.node(*P(Ls / 2, Lt / 2))
    w_in, w_out = G.node(*P(twW + 1.5, wa)), G.node(*P(-2.5, wa))
    s_in, s_out = G.node(*P(sa, twS + 1.5)), G.node(*P(sa, -2.5))
    for a_, b_ in ((w_out, w_in), (w_in, hub), (hub, s_in), (s_in, s_out)):
        G.add(a_, b_, [], PATH, 0, 2)
    n = 4
    for k, far in ((w_out, 15), (s_out, 25)):
        x, y = G.nodes[k][:2]
        m = G.split_nearest(x, y, far, types=tuple(range(32)))
        if m is not None and m != k:
            # Un raccord qui couperait la cella passe devant le coin extérieur commun des deux murs.
            mx, my = G.nodes[m][:2]
            to = lambda q: ((q[0] - ox) * u[0] + (q[1] - oy) * u[1], (q[0] - ox) * v[0] + (q[1] - oy) * v[1])
            cut = any(-1 < ss < Ls + 1 and -1 < tt < Lt + 1 for ss, tt in (to((x + (mx - x) * f, y + (my - y) * f)) for f in np.linspace(0, 1, 41)))
            G.add(k, m, [P(-2.5, -2.5)] if cut else [], PATH, 0, 2)
            n += 1
    return n


def gates():
    for p in sorted(KINDS.glob("*_*.json")):
        for s in json.loads(p.read_text())["sites"]:
            if s.get("t") == "gate" and s.get("gm"):
                yield s


def frame(site):
    m = site["gm"]
    a = site["a"]
    u, v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    cx, cy = m["c"]
    to_st = lambda x, y: ((x - cx) * u[0] + (y - cy) * u[1], (x - cx) * v[0] + (y - cy) * v[1])
    to_xy = lambda s, t: (round(cx + u[0] * s + v[0] * t, 2), round(cy + u[1] * s + v[1] * t, 2))
    return to_st, to_xy, m.get("l", site["l"]) / 2, m["w"] / 2


def reroute(G, site):
    """Détourne les arêtes qui traversent la porte hors d'une arche ; rend le nombre de nœuds et d'arêtes changés."""
    to_st, to_xy, hl, hw = frame(site)
    arches = [(a0, a1) for a0, a1, _ in site["gm"]["arches"] if a1 - a0 >= 1.2]
    n = 0
    # Nœuds dans une pile ou dans la tour : poussés devant la face la plus proche.
    solid = [(p0, p1, -hw, hw) for p0, p1 in site["gm"]["piers"]] + ([tuple(site["gm"]["tower"][:4])] if "tower" in site["gm"] else [])
    for k, nd in enumerate(G.nodes):
        s, t = to_st(nd[0], nd[1])
        hit = next((r for r in solid if r[0] - 0.3 < s < r[1] + 0.3 and r[2] - 0.3 < t < r[3] + 0.3), None)
        if not hit:
            continue
        nd[0], nd[1] = to_xy(s, (hit[3] + 0.8) if t > 0 else (hit[2] - 0.8))
        for e in G.edges:
            if e["a"] == k:
                e["pts"][0] = (nd[0], nd[1])
            if e["b"] == k:
                e["pts"][-1] = (nd[0], nd[1])
            if k in (e["a"], e["b"]):
                e["attr"][5] = round(length(e["pts"]) * 10)
        n += 1
    for e in G.edges:
        pts = e["pts"]
        out = [pts[0]]
        changed = False
        for p, q in zip(pts, pts[1:]):
            (s0, t0), (s1, t1) = to_st(*p), to_st(*q)
            if t0 * t1 < 0:
                sx = s0 + (s1 - s0) * t0 / (t0 - t1)
                if abs(sx) <= hl + 0.3 and not any(a0 + 0.5 <= sx <= a1 - 0.5 for a0, a1 in arches):
                    a0, a1 = min(arches, key=lambda ab: abs((ab[0] + ab[1]) / 2 - sx))
                    sm, side = (a0 + a1) / 2, 1 if t0 > 0 else -1
                    out += [to_xy(sm, side * (hw + 0.8)), to_xy(sm, -side * (hw + 0.8))]
                    changed = True
            out.append(q)
        if changed:
            e["pts"] = out
            e["attr"][5] = round(length(out) * 10)
            n += 1
    return n


def shop_pois(index):
    """Commerces vus sur une photo, absents d'OpenStreetMap (D141, `shop` des `fronts` de manual.json) : le point d'intérêt « commerce »
    que build_nav.py poserait (milieu du mur d'entrée, 80 cm devant, cap vers la file piétonne la plus proche), ajouté à la seule
    super-tuile du commerce. Un point « commerce » déjà à moins de 30 cm est remplacé : une deuxième passe ne change rien. Rend le nombre
    de super-tuiles réécrites.

    Commerce d'OpenStreetMap dont la photo change le mur d'entrée (`poi` des `fronts`, Lidl et pharmacie, D143 ; But, Bricomarché, Intermarché et
    Jardinerie, D144 ; `poiOffset` : mètres de plus devant le mur, pour une entrée en saillie ; `poiClear` : rayon (2 m par défaut) où l'ancien point est retiré) : son ancien point
    « commerce » (à moins de 2 m du contour, dans toute super-tuile qu'il touche) est retiré, le nouveau posé comme ci-dessus."""
    from shapely.geometry import LineString, Point, Polygon
    fronts = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text()).get("fronts", {})
    wanted = {bid: m for bid, m in fronts.items() if m.get("shop") or m.get("poi")}
    if not wanted:
        return 0
    world = json.loads((c.OUT / "world.json").read_text())
    done = 0
    for m in world["tiles"]:
        if not wanted or not m.get("buildings"):
            continue
        tile = json.loads((c.OUT / "tiles" / f"{m['id']}.json").read_text())
        for b in tile["buildings"]:
            if b["id"] not in wanted:
                continue
            fi = next(f for f in tile["fiches"] if f["id"] == b["id"])
            entry = wanted.pop(b["id"])
            w = fi["walls"][entry["wall"]]
            ring = b["ring"]
            (ax, ay), (bx, by) = (ring[2 * w["a"]], ring[2 * w["a"] + 1]), (ring[2 * w["b"]], ring[2 * w["b"] + 1])
            mx, my = (ax + bx) / 2, (ay + by) / 2
            nx, ny = -(by - ay), bx - ax
            n = math.hypot(nx, ny)
            if Polygon([(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)]).contains(Point(mx + nx / n, my + ny / n)):
                nx, ny = -nx, -ny
            off = 0.8 + entry.get("poiOffset", 0.0)  # D144 : le pavillon de la Jardinerie avance de 2,4 m devant son mur
            x, y = round(mx + nx / n * off, 1), round(my + ny / n * off, 1)
            cid = cell_of(x, y, index)
            poly = Polygon([(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)])
            if entry.get("poi"):
                for oc in {cell_of(ring[i], ring[i + 1], index) for i in range(0, len(ring), 2)} | {cid}:
                    op = NAV / f"{oc}.json"
                    otext = op.read_text()
                    odoc = json.loads(otext)
                    P = odoc["poi"]
                    odoc["poi"] = [v for i in range(0, len(P), 5) if not (P[i] == 2 and poly.distance(Point(P[i + 1], P[i + 2])) < entry.get("poiClear", 2.0)) for v in P[i:i + 5]]
                    onew = json.dumps(odoc, separators=(",", ":"))
                    if onew != otext:
                        op.write_text(onew)
                        index["cells"] = [dict(e, bytes=len(onew), poi=len(odoc["poi"]) // 5) if e["id"] == oc else e for e in index["cells"]]
                        (NAV / "index.json").write_text(json.dumps(index, separators=(",", ":")))
            path = NAV / f"{cid}.json"
            text = path.read_text()
            doc = json.loads(text)
            G = Graph(doc["ped"])
            # Files des trottoirs, chemins, rues piétonnes et places (comme build_nav.py).
            lines = [LineString(e["pts"]) for e in G.edges if e["attr"][0] in (0, 5, 7, 9) and len(e["pts"]) >= 2]
            near_line = min(lines, key=lambda ln: ln.distance(Point(x, y)))
            near = near_line.interpolate(near_line.project(Point(x, y)))
            dist = Point(x, y).distance(near)
            poi = [2, x, y, round(math.atan2(near.x - x, near.y - y), 2) if dist > 0.05 else 0.0, min(255, round(dist * 10))]
            P = doc["poi"]
            keep = [P[i:i + 5] for i in range(0, len(P), 5) if not (P[i] == 2 and math.hypot(P[i + 1] - x, P[i + 2] - y) < 0.3)]
            doc["poi"] = [v for q in keep + [poi] for v in q]
            new = json.dumps(doc, separators=(",", ":"))
            if new != text:
                path.write_text(new)
                index["cells"] = [dict(e, bytes=len(new), poi=len(doc["poi"]) // 5) if e["id"] == cid else e for e in index["cells"]]
                (NAV / "index.json").write_text(json.dumps(index, separators=(",", ":")))
                done += 1
            print(f"{(fi['ground'].get('shops') or [{'name': b['id']}])[0]['name']} : point « commerce » en ({x}, {y}) dans {cid}, à {dist:.1f} m de la file")
    return done


def write(cid, doc, G, index, text_before):
    doc["ped"] = G.dump()
    text = json.dumps(doc, separators=(",", ":"))
    if text == text_before:
        return False
    (NAV / f"{cid}.json").write_text(text)
    index["cells"] = [dict(e, bytes=len(text), ped={"nodes": len(G.nodes), "edges": len(G.edges)}) if e["id"] == cid else e for e in index["cells"]]
    (NAV / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    return True


def main():
    index = json.loads((NAV / "index.json").read_text())
    shop_pois(index)
    s = janus_site()
    if s:
        cid = cell_of(*s["o"], index)
        text = (NAV / f"{cid}.json").read_text()
        doc = json.loads(text)
        G = Graph(doc["ped"])
        n = janus_paths(G, s)
        print(f"{s['n']} : {n} arêtes dans {cid}" + ("" if write(cid, doc, G, index, text) else ", rien à réécrire"))
    for site in gates():
        cid = cell_of(*site["gm"]["c"], index)
        path = NAV / f"{cid}.json"
        doc = json.loads(path.read_text())
        G = Graph(doc["ped"])
        n = reroute(G, site)
        if not n:
            print(f"{site['n']} : chemins déjà par les arches dans {cid}")
            continue
        doc["ped"] = G.dump()
        text = json.dumps(doc, separators=(",", ":"))
        path.write_text(text)
        index["cells"] = [dict(e, bytes=len(text)) if e["id"] == cid else e for e in index["cells"]]
        (NAV / "index.json").write_text(json.dumps(index, separators=(",", ":")))
        print(f"{site['n']} : {n} nœud(s) déplacé(s) et arête(s) détournée(s) par une arche dans {cid}")


if __name__ == "__main__":
    assert ES == 11 and c.OUT
    main()
