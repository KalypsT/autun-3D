"""Passants dans le passage Balthus (D190) : une file du bout de la rue Demetz au bout de la rue aux Cordiers, sans régénérer la navigation.

Usage : python3 tools/data/build_passage_nav.py     (après build_passage.py, et après build_nav.py, qui réécrit toute la navigation à partir
        d'OpenStreetMap et écarte les passages couverts : relancer celle-ci ensuite)
Entrées : site `passage` de public/data/kinds (D187), public/data/nav/<super-tuile>.json.
Sortie : la super-tuile de navigation qui contient le passage et son entrée dans nav/index.json ; rien d'autre.

On ajoute, comme build_theatre_nav.py (dont on reprend le graphe et les raccords), une file droite sur l'axe : galerie (chemin de 4,6 m), volée de 15
marches (escalier), porte cochère (chemin), raccordée de part et d'autre à l'arête piétonne la plus proche (à moins de 14 m). Les nœuds ajoutés portent
le drapeau 128 et les arêtes la référence de la voie OpenStreetMap du passage (80940956) : une nouvelle passe retire d'abord ce qu'elle avait ajouté, puis
le refait ; une deuxième passe ne change rien. Le jeu pose les passants sur le tablier du passage (D187).
"""

import json
import math

import build_theatre_nav as T
import config as c

REF = 80940956  # voie OpenStreetMap « Passage Balthus »
MARK = 128
T.REF, T.MARK = REF, MARK  # le graphe du théâtre lit ces deux constantes à chaque appel
PATH, STEPS, PEDSTREET, LANE = 5, 6, 9, 0


def find_site():
    for p in sorted(T.KINDS.glob("*.json")):
        if p.name == "index.json":
            continue
        for s in json.loads(p.read_text())["sites"]:
            if s.get("t") == "passage":
                return s
    raise SystemExit("pas de site passage dans public/data/kinds (lancer build_passage.py)")


def main():
    s = find_site()
    index = json.loads((T.NAV / "index.json").read_text())
    ux, uy = math.cos(s["a"]), math.sin(s["a"])
    P = lambda d: (s["c"][0] + ux * d, s["c"][1] + uy * d)
    cid = T.cell_of(*P(s["L"] / 2), index)
    path = T.NAV / f"{cid}.json"
    doc = json.loads(path.read_text())
    G = T.Graph(doc["ped"])
    G.unpatch()

    s0, s1, n = s["st"]
    n_a, n_b, n_c, n_d = G.node(*P(-1.0)), G.node(*P(s0)), G.node(*P(s1)), G.node(*P(s["L"] + 1.0))
    W = 2 * s["hw"] - 0.4
    G.add(n_a, n_b, [], PATH, 0, W)
    G.add(n_b, n_c, [], STEPS, T.F_STAIRS, W)
    G.add(n_c, n_d, [], PATH, 0, W)
    joined = 0
    for node, d in ((n_a, -1.0), (n_d, s["L"] + 1.0)):
        k = G.split_nearest(*P(d), 14, types=(LANE, PATH, PEDSTREET))
        if k is not None:
            G.add(node, k, [], PATH, 0, 2)
            joined += 1

    doc["ped"] = G.dump()
    text = json.dumps(doc, separators=(",", ":"))
    entry = next(e for e in index["cells"] if e["id"] == cid)
    added = sum(1 for e in G.edges if e["attr"][6] == REF)
    new_entry = dict(entry, bytes=len(text), ped={"nodes": len(G.nodes), "edges": len(G.edges)})
    if path.read_text() == text and entry == new_entry:
        print(f"passage Balthus : {added} arêtes dans {cid}, rien à réécrire")
        return
    path.write_text(text)
    index["cells"] = [new_entry if e["id"] == cid else e for e in index["cells"]]
    (T.NAV / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"passage Balthus : {added} arêtes ajoutées dans {cid} ({joined} raccords aux rues) ; {cid}.json et index.json réécrits")


if __name__ == "__main__":
    main()
