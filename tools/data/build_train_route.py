"""Circuit du petit train touristique (D117) : calculé sur le graphe routier du jeu (public/data/nav), écrit dans src/core/train-route-data.ts.

Le train part de la rue du Général Demetz (côté Champ de Mars) et passe par les monuments du centre, sans demi-tour (circuit validé par
l'utilisateur sur une carte). Chaque étape est le plus court chemin entre deux points de passage, en préférant les rues calmes et en
respectant les sens uniques. Pour chaque sommet du tracé : sa position et le décalage vers la droite de la voie (milieu de la voie de droite
d'une rue à double sens, axe d'une rue à sens unique). Aussi : les nœuds à feux traversés et les monuments (le train y ralentit).

Usage : python3 tools/data/build_train_route.py
"""
import heapq
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAV = ROOT / "public" / "data" / "nav"
OUT = ROOT / "src" / "core" / "train-route-data.ts"

# Points de passage (m, repère du jeu) : chacun est un carrefour du graphe routier, choisi pour qu'aucune étape ne finisse par un demi-tour.
WAYPOINTS = [
    (44.0, -42.0),  # départ : rue du Général Demetz, côté Champ de Mars
    (54.7, -544.2),  # cathédrale Saint-Lazare
    (-1.4, -452.2),  # redescente par le sud de la vieille ville (boucle, sans demi-tour)
    (766.3, 285.4),  # théâtre romain
    (524.2, 833.5),  # porte Saint-André
    (-261.5, 1056.8),  # porte d'Arroux
    (-119.6, 1054.5),  # boucle autour d'un pâté de maisons (sans demi-tour)
    (160.3, 358.7),  # tour de l'Horloge
    (44.0, -42.0),  # retour au départ
]
# Monuments longés : le train y ralentit. Repères pris au bord du tracé quand le monument est en retrait : le théâtre romain, au bord ouest de
# ses gradins (rue du Théâtre romain) ; la tour de l'Horloge, vue d'en bas, à ≈ 50 m (les rues qui montent à son pied sont trop étroites) ;
# l'hôtel de ville, sa façade est (le train passe à ≈ 55 m du centre du bâtiment).
MONUMENTS = [
    ("Musée Rolin", 59, -504), ("Cathédrale Saint-Lazare", 37, -572), ("Théâtre romain", 775, 292), ("Porte Saint-André", 546, 842),
    ("Porte d'Arroux", -268, 1072), ("Tour de l'Horloge", 125, 350), ("Hôtel de ville", 50, 88),
]
# Coût d'une rue selon sa classe (0 primaire … 6 desserte) : le train préfère les rues calmes.
PENALTY = {0: 1.6, 1: 1.3, 2: 1.1, 3: 1.0, 4: 1.0, 5: 1.0, 6: 2.0}
ONEWAY_FORWARD, ONEWAY_BACK, AISLE, BUS = 1, 2, 64, 128
SIGNAL = 4


def load():
    index = json.loads((NAV / "index.json").read_text())
    rn, re_ = index["stride"]["road"]["n"], index["stride"]["road"]["e"]
    nodes, adj, signals = {}, {}, set()
    key = lambda x, y: (round(x, 1), round(y, 1))
    for f in sorted(NAV.glob("s*.json")):
        r = json.loads(f.read_text())["road"]
        n, e, g = r["n"], r["e"], r["g"]
        local = []
        for i in range(0, len(n), rn):
            k = key(n[i], n[i + 1])
            nodes[k] = (n[i], n[i + 1])
            local.append(k)
            if n[i + 2] & SIGNAL:
                signals.add(k)
        for i in range(0, len(e), re_):
            a, b, cls, flags, _lanes, _speed, width = e[i:i + 7]
            p0, np_ = e[i + 9], e[i + 10]
            if flags & (AISLE | BUS):
                continue
            pts = [nodes[local[a]]] + [(g[2 * (p0 + k)], g[2 * (p0 + k) + 1]) for k in range(np_)] + [nodes[local[b]]]
            length = sum(math.dist(pts[j], pts[j + 1]) for j in range(len(pts) - 1))
            oneway = bool(flags & (ONEWAY_FORWARD | ONEWAY_BACK))
            info = {"cls": cls, "width": width / 10, "oneway": oneway, "pts": pts}
            if not flags & ONEWAY_BACK:
                adj.setdefault(local[a], []).append((local[b], length, info, False))
            if not flags & ONEWAY_FORWARD:
                adj.setdefault(local[b], []).append((local[a], length, info, True))
    return nodes, adj, signals


def route(adj, start, goal):
    """Plus court chemin (coût : longueur × pénalité de la classe) ; renvoie la liste des (points, décalage de voie) des arêtes parcourues."""
    near = lambda p: min(adj, key=lambda k: (k[0] - p[0]) ** 2 + (k[1] - p[1]) ** 2)
    s, t = near(start), near(goal)
    dist, prev, queue = {s: 0.0}, {}, [(0.0, s)]
    while queue:
        d, u = heapq.heappop(queue)
        if u == t:
            break
        if d > dist[u]:
            continue
        for v, length, info, rev in adj.get(u, []):
            nd = d + length * PENALTY.get(info["cls"], 1.0)
            if nd < dist.get(v, 1e18):
                dist[v], prev[v] = nd, (u, info, rev)
                heapq.heappush(queue, (nd, v))
    legs, u = [], t
    while u != s:
        pu, info, rev = prev[u]
        pts = info["pts"][::-1] if rev else info["pts"]
        # Voie de droite d'une rue à double sens : au quart de la largeur, borné ; une rue à sens unique : son axe.
        offset = 0.0 if info["oneway"] else min(1.8, max(0.8, info["width"] / 4))
        legs.append((pts, offset))
        u = pu
    return legs[::-1]


def main():
    nodes, adj, signals = load()
    out = []  # (x, y, décalage)
    for p, q in zip(WAYPOINTS, WAYPOINTS[1:]):
        for pts, offset in route(adj, p, q):
            for k, (x, y) in enumerate(pts):
                if out and k == 0:
                    # Sommet partagé entre deux arêtes : le décalage moyen.
                    out[-1] = (out[-1][0], out[-1][1], (out[-1][2] + offset) / 2)
                    continue
                out.append((x, y, offset))
    # Boucle : le dernier sommet est le départ.
    if math.dist(out[0][:2], out[-1][:2]) < 0.5:
        out[0] = (out[0][0], out[0][1], (out[0][2] + out[-1][2]) / 2)
        out.pop()
    length = sum(math.dist(out[i][:2], out[(i + 1) % len(out)][:2]) for i in range(len(out)))
    lights = sorted({k for k in signals if any(math.dist(k, (x, y)) < 0.5 for x, y, _ in out)})
    flat = ", ".join(f"{x:.1f}, {y:.1f}, {o:.2f}" for x, y, o in out)
    lights_flat = ", ".join(f"{x:.1f}, {y:.1f}" for x, y in lights)
    monuments = ",\n    ".join(f'{{ name: "{n}", x: {x}, y: {y} }}' for n, x, y in MONUMENTS)
    OUT.write_text(f"""// Fichier généré par tools/data/build_train_route.py : ne pas modifier à la main.
// Circuit du petit train touristique (D117) : {len(out)} sommets, {length:.0f} m, {len(lights)} nœuds à feux.

/** Sommets du circuit (boucle, dans le sens de marche) : x, y (m), décalage vers la droite jusqu'au milieu de la voie (m). */
export const TRAIN_ROUTE_POINTS: readonly number[] = [{flat}];

/** Nœuds à feux traversés (x, y) : le train s'y arrête au rouge. */
export const TRAIN_ROUTE_SIGNALS: readonly number[] = [{lights_flat}];

/** Monuments longés : le train y ralentit. */
export const TRAIN_ROUTE_MONUMENTS: readonly {{ name: string; x: number; y: number }}[] = [
    {monuments},
];
""")
    print(f"{len(out)} sommets, {length:.0f} m, {len(lights)} feux -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
