"""Passants sur les sentiers des terrils des Télots (D270) : les lacets ajoutés à la navigation, sans la régénérer.

Usage : python3 tools/data/build_terrils_nav.py     (après build_terrils.py --trace, et après build_nav.py, qui réécrit toute la navigation à partir
        d'OpenStreetMap : relancer celle-ci ensuite)
Entrées : tools/data/terrils.json (axes des sentiers), public/data/nav/<super-tuile>.json.
Sortie : la super-tuile de navigation des terrils et son entrée dans nav/index.json ; rien d'autre.

Comme build_passage_nav.py (dont on reprend le graphe et les raccords de build_theatre_nav.py) :
- chaque sentier est une file (chemin, 2,5 m), du sommet au pied, sur l'axe tracé (un sommet tous les 2 m) ;
- terril est : le sommet est raccordé au chemin OpenStreetMap qui y monte par la face nord-est (`way/1497939637`, à 8 m) ; le pied, par un
  chemin le long du pied sud des terrils, au pied du sentier ouest ;
- terril ouest : le pied est raccordé à la piste qui vient de la rue des Télots (`way/250361755`, à 11 m) ;
- fréquentation 140 (sur 255) : les chemins OpenStreetMap voisins sont à 0, les passants n'y apparaîtraient presque jamais ;
- un point d'intérêt « monument » à chaque sommet, tourné vers la ville (les passants s'y arrêtent pour regarder la vue).
Les nœuds ajoutés portent le drapeau 32 et les arêtes la référence du terril est (907818795) : une nouvelle passe retire d'abord ce qu'elle avait
ajouté, puis le refait ; une deuxième passe ne change rien.
"""

import json
import math
from pathlib import Path

import build_theatre_nav as T

REF = 907818795  # terril est (OpenStreetMap)
MARK = 32
T.REF, T.MARK = REF, MARK  # le graphe du théâtre lit ces constantes à chaque appel
T.FOOT, T.ZONE = 140, 3  # fréquentation ; zone « périphérie », comme les chemins voisins
PATH, LANE, PEDSTREET = 5, 0, 9
WIDTH = 2.5
TRACE = Path(__file__).with_name("terrils.json")
# Vers la ville (cathédrale Saint-Lazare) : direction du regard aux sommets.
CITY = (36.6, -571.5)
POI_MONUMENT = 8


def main():
    trace = json.loads(TRACE.read_text())
    paths = {k: v for k, v in trace.items() if k != "_doc"}
    index = json.loads((T.NAV / "index.json").read_text())
    cells = {T.cell_of(*v["summit"][:2], index) for v in paths.values()} | {T.cell_of(*v["path"][-1][:2], index) for v in paths.values()}
    if len(cells) != 1:
        raise SystemExit(f"les sentiers débordent sur plusieurs super-tuiles ({sorted(cells)}) : à prendre en charge")
    cid = cells.pop()
    path = T.NAV / f"{cid}.json"
    doc = json.loads(path.read_text())
    G = T.Graph(doc["ped"])
    G.unpatch()

    ends = {}
    for name, v in paths.items():
        pts = [(p[0], p[1]) for p in v["path"]]
        top, foot = G.node(*pts[0]), G.node(*pts[-1])
        inner = pts[2:-1:2]
        G.add(top, foot, inner, PATH, 0, WIDTH)
        ends[name] = (top, foot)
    joined = []
    # Terril est : sommet → chemin OpenStreetMap de la face nord-est.
    sx, sy = paths["est"]["summit"][:2]
    k = G.split_nearest(sx, sy, 15, types=(PATH, LANE, PEDSTREET))
    if k is not None:
        G.add(ends["est"][0], k, [], PATH, 0, 1.5)
        joined.append("sommet est → chemin de la face nord-est")
    # Terril ouest : pied → piste de la rue des Télots.
    fx, fy = paths["ouest"]["path"][-1][:2]
    k = G.split_nearest(fx, fy, 20, types=(PATH, LANE, PEDSTREET))
    if k is not None:
        G.add(ends["ouest"][1], k, [], PATH, 0, 2.0)
        joined.append("pied ouest → piste")
    # Pied est → pied ouest, le long du pied sud (un sommet tous les 10 m).
    ax, ay = paths["est"]["path"][-1][:2]
    n = max(1, int(math.hypot(fx - ax, fy - ay) // 10))
    G.add(ends["est"][1], ends["ouest"][1], [(ax + (fx - ax) * i / n, ay + (fy - ay) * i / n) for i in range(1, n)], PATH, 0, 2.0)
    joined.append("pied est → pied ouest")

    doc["ped"] = G.dump()
    # Points d'intérêt « monument » aux sommets, à 1,5 m du sommet vers la ville.
    pois = [doc["poi"][i:i + 5] for i in range(0, len(doc["poi"]), 5)]
    summits = [v["summit"][:2] for v in paths.values()]
    keep = [q for q in pois if not (q[0] == POI_MONUMENT and any(math.hypot(q[1] - x, q[2] - y) < 25 for x, y in summits))]
    for x, y in summits:
        h = math.atan2(CITY[0] - x, CITY[1] - y)
        keep.append([POI_MONUMENT, round(x + 1.5 * math.sin(h), 2), round(y + 1.5 * math.cos(h), 2), round(h, 2), 0])
    doc["poi"] = [v for q in keep for v in q]

    text = json.dumps(doc, separators=(",", ":"))
    entry = next(e for e in index["cells"] if e["id"] == cid)
    added = sum(1 for e in G.edges if e["attr"][6] == REF)
    new_entry = dict(entry, bytes=len(text), ped={"nodes": len(G.nodes), "edges": len(G.edges)}, poi=len(doc["poi"]) // 5)
    if path.read_text() == text and entry == new_entry:
        print(f"terrils : {added} arêtes dans {cid}, rien à réécrire")
        return
    path.write_text(text)
    index["cells"] = [new_entry if e["id"] == cid else e for e in index["cells"]]
    (T.NAV / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"terrils : {added} arêtes ajoutées dans {cid} ({'; '.join(joined)}) ; {cid}.json et index.json réécrits")


if __name__ == "__main__":
    main()
