"""Passants et monuments d'après photo (D138) : la navigation passe par les arches des portes romaines, sans la régénérer.

Usage : python3 tools/data/build_monuments_nav.py     (après build_monuments.py, qui écrit le modèle des portes, et après build_nav.py, qui
        réécrit toute la navigation à partir d'OpenStreetMap : relancer celle-ci ensuite)
Entrées : sites `gate` de public/data/kinds (modèle `gm`, D137), public/data/nav/<super-tuile>.json.
Sortie : les super-tuiles de navigation qui contiennent une porte, et leurs entrées dans nav/index.json ; rien d'autre.

build_nav.py trace les chemins d'OpenStreetMap, qui ignorent les piles : à la porte Saint-André, un chemin de la placette traverse la porte
en biais et passait par la pile centrale. Chaque arête piétonne qui traverse le plan médian d'une porte ailleurs que dans une arche (à 50 cm
des piédroits) est détournée par le milieu de l'arche la plus proche (deux points, à 80 cm devant chaque face) ; un nœud qui tombe dans une
pile ou dans la tour est poussé à 80 cm devant la face la plus proche ; les longueurs sont recalculées.
Une deuxième passe ne change rien (le chemin passe alors par l'arche).
"""

import json
import math

import config as c
from build_theatre_nav import ES, KINDS, NAV, Graph, cell_of, length


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


def main():
    index = json.loads((NAV / "index.json").read_text())
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
