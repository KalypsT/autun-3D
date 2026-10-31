"""Passants dans le théâtre romain (D135) : chemins et escaliers ajoutés à la navigation, sans la régénérer.

Usage : python3 tools/data/build_theatre_nav.py     (après build_monuments.py, qui écrit le site `theatre`, et après build_nav.py, qui réécrit
        toute la navigation à partir d'OpenStreetMap : relancer celle-ci ensuite)
Entrées : site `theatre` de public/data/kinds (mesures, D133), public/data/nav/<super-tuile>.json.
Sortie : la super-tuile de navigation qui contient le théâtre et son entrée dans nav/index.json ; rien d'autre.

build_nav.py retire les voies OpenStreetMap qui traversent un bâtiment : l'emprise BD TOPO du théâtre (masquée depuis D133) couvrait toute la
cavea, il n'y reste que le chemin du sommet. On ajoute, aux altitudes du modèle (le jeu pose les passants sur les tabliers des gradins) :
- l'allée de la précinction (chemin), d'une extrémité des gradins restaurés à l'autre ;
- l'escalier de l'axe, de la précinction à l'orchestre, et les six escaliers du haut jusqu'au chemin du sommet (raccord : l'arête la plus
  proche est coupée en deux, à moins de 12 m) ;
- l'orchestre : un carrefour au milieu, la scène (marches, plateau, sortie à l'est), et une sortie au nord, hors des massifs, vers l'escalier
  OpenStreetMap qui descend du sommet près de la maison du gardien.
Les nœuds ajoutés portent le drapeau 64 et les arêtes la référence de la voie OpenStreetMap du théâtre : une nouvelle passe retire d'abord
tout ce qu'elle avait ajouté (et recolle les arêtes coupées), puis le refait : une deuxième passe ne change rien.
"""

import json
import math

import config as c

NAV = c.OUT / "nav"
KINDS = c.OUT / "kinds"
REF = 153779957  # voie OpenStreetMap « Théâtre romain »
MARK = 64  # drapeau des nœuds ajoutés
PATH, STEPS = 5, 6
F_STAIRS = 2
FOOT, ZONE = 140, 1
ES = 11


def find_theatre():
    for p in sorted(KINDS.glob("*.json")):
        if p.name == "index.json":
            continue
        for s in json.loads(p.read_text())["sites"]:
            if s.get("t") == "theatre":
                return s
    raise SystemExit("pas de site theatre dans public/data/kinds (lancer build_monuments.py)")


def cell_of(x, y, index):
    gx, gy = index["gridOrigin"]
    return f"s{int((x - gx) // index['cell'])}_{int((y - gy) // index['cell'])}"


class Graph:
    """Graphe piéton d'une super-tuile, arêtes en polylignes (extrémités comprises)."""

    def __init__(self, ped):
        n = ped["n"]
        self.nodes = [[n[i], n[i + 1], n[i + 2]] for i in range(0, len(n), 3)]
        g = ped["g"]
        self.edges = []
        for i in range(0, len(ped["e"]), ES):
            a, b, typ, fl, w, foot, zone, ln, ref, p0, np_ = ped["e"][i:i + ES]
            pts = [tuple(self.nodes[a][:2])] + [(g[2 * k], g[2 * k + 1]) for k in range(p0, p0 + np_)] + [tuple(self.nodes[b][:2])]
            self.edges.append({"a": a, "b": b, "attr": [typ, fl, w, foot, zone, ln, ref], "pts": pts})

    def unpatch(self):
        """Retire les arêtes du théâtre, recolle les arêtes coupées à un nœud ajouté, retire les nœuds ajoutés."""
        self.edges = [e for e in self.edges if e["attr"][6] != REF]
        for k, nd in enumerate(self.nodes):
            if not nd[2] & MARK:
                continue
            inc = [e for e in self.edges if e["a"] == k or e["b"] == k]
            if len(inc) != 2:
                continue
            e1, e2 = inc
            p1 = e1["pts"] if e1["b"] == k else e1["pts"][::-1]
            a1 = e1["a"] if e1["b"] == k else e1["b"]
            p2 = e2["pts"] if e2["a"] == k else e2["pts"][::-1]
            b2 = e2["b"] if e2["a"] == k else e2["a"]
            # Longueur d'origine : la somme des deux morceaux (voir split_nearest) ; l'arête reprend la place du premier morceau.
            # Le point de coupe, ajouté sur un segment, disparaît (aligné à 1 cm près avec ses voisins) : la géométrie d'origine revient.
            pts = p1 + p2[1:]
            j = len(p1) - 1
            (ax, ay), (mx, my), (bx, by) = pts[j - 1], pts[j], pts[j + 1]
            L = math.hypot(bx - ax, by - ay)
            if L > 0 and abs((bx - ax) * (my - ay) - (by - ay) * (mx - ax)) / L < 0.01:
                pts = pts[:j] + pts[j + 1:]
            merged = {"a": a1, "b": b2, "attr": list(e1["attr"]), "pts": pts}
            merged["attr"][5] = e1["attr"][5] + e2["attr"][5]
            first = min(self.edges.index(e1), self.edges.index(e2))
            self.edges = [merged if i == first else e for i, e in enumerate(self.edges) if e is not e1 and e is not e2 or i == first]
        keep = [k for k, nd in enumerate(self.nodes) if not nd[2] & MARK]
        remap = {k: i for i, k in enumerate(keep)}
        for e in self.edges:
            if e["a"] not in remap or e["b"] not in remap:
                raise SystemExit("nœud du théâtre encore utilisé par une arête d'origine")
            e["a"], e["b"] = remap[e["a"]], remap[e["b"]]
        self.nodes = [self.nodes[k] for k in keep]

    def node(self, x, y):
        self.nodes.append([round(x, 2), round(y, 2), MARK])
        return len(self.nodes) - 1

    def add(self, a, b, pts, typ, fl, width):
        pts = [tuple(self.nodes[a][:2])] + [(round(x, 2), round(y, 2)) for x, y in pts] + [tuple(self.nodes[b][:2])]
        self.edges.append({"a": a, "b": b, "attr": [typ, fl, round(width * 10), FOOT, ZONE, round(length(pts) * 10), REF], "pts": pts})

    def split_nearest(self, x, y, maxd, types=(PATH,)):
        """Coupe l'arête (des types donnés, hors théâtre) la plus proche de (x, y) au point le plus proche ; rend le nœud, ou None au-delà de maxd."""
        best = None
        for e in self.edges:
            if e["attr"][0] not in types or e["attr"][6] == REF:
                continue
            for i in range(len(e["pts"]) - 1):
                (ax, ay), (bx, by) = e["pts"][i], e["pts"][i + 1]
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy
                t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
                px, py = ax + dx * t, ay + dy * t
                d = math.hypot(px - x, py - y)
                if best is None or d < best[0]:
                    best = (d, e, i, t, px, py)
        if best is None or best[0] > maxd:
            return None
        d, e, i, t, px, py = best
        pts = e["pts"]
        # Au bout de l'arête : son nœud ; sur un sommet intérieur : coupe à ce sommet.
        if i == 0 and t < 1e-3 or math.hypot(px - pts[0][0], py - pts[0][1]) < 0.05:
            return e["a"]
        if i == len(pts) - 2 and t > 1 - 1e-3 or math.hypot(px - pts[-1][0], py - pts[-1][1]) < 0.05:
            return e["b"]
        if t > 1 - 1e-3:
            i, t, (px, py) = i + 1, 0.0, pts[i + 1]
        if t < 1e-3:
            px, py = pts[i]
            head, tail = pts[:i + 1], pts[i:]
        else:
            px, py = round(px, 2), round(py, 2)
            head, tail = pts[:i + 1] + [(px, py)], [(px, py)] + pts[i + 1:]
        k = self.node(px, py)
        # Les deux morceaux prennent la place de l'arête et se partagent sa longueur (la somme reste celle d'origine : recollage exact).
        l1 = min(e["attr"][5], round(length(head) * 10))
        pieces = []
        for a, b, p, ln in ((e["a"], k, head, l1), (k, e["b"], tail, e["attr"][5] - l1)):
            attr = list(e["attr"])
            attr[5] = ln
            pieces.append({"a": a, "b": b, "attr": attr, "pts": p})
        i = self.edges.index(e)
        self.edges[i:i + 1] = pieces
        return k

    def dump(self):
        g, e = [], []
        for ed in self.edges:
            inner = ed["pts"][1:-1]
            typ, fl, w, foot, zone, ln, ref = ed["attr"]
            e += [ed["a"], ed["b"], typ, fl, w, foot, zone, ln, ref, len(g) // 2, len(inner)]
            for x, y in inner:
                g += [x, y]
        return {"n": [v for nd in self.nodes for v in nd], "e": e, "g": g}


def length(pts):
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def main():
    s = find_theatre()
    index = json.loads((NAV / "index.json").read_text())
    cx, cy = s["c"]
    a = s["a"]
    P = lambda R, u: (cx + R * math.cos(a + u), cy + R * math.sin(a + u))
    cid = cell_of(cx, cy, index)
    path = NAV / f"{cid}.json"
    doc = json.loads(path.read_text())
    G = Graph(doc["ped"])
    G.unpatch()

    ro, rw0, r1 = s["ro"], s["rows"][1], s["rows"][2]
    r2, _, r4 = s["up"][:3]
    rest = s["rest"]
    lanes_low, lanes_up, lane_w = s["lanes"]
    Rp = (r1 + r2) / 2
    arc = lambda R, u0, u1: [P(R, u0 + (u1 - u0) * k / max(1, math.ceil(abs(u1 - u0) * R / 3))) for k in range(1, max(1, math.ceil(abs(u1 - u0) * R / 3)))]
    ray = lambda u, R0, R1: [P(R0 + (R1 - R0) * k / max(1, math.ceil(abs(R1 - R0) / 3)), u) for k in range(1, max(1, math.ceil(abs(R1 - R0) / 3)))]

    # Précinction : nœuds aux bouts et au pied de chaque escalier.
    uc = min(lanes_low, key=abs)
    stops = sorted({rest[0] + 0.03, rest[1] - 0.03, uc, *[u for u, _ in lanes_up if rest[0] < u < rest[1]]})
    pn = {u: G.node(*P(Rp, u)) for u in stops}
    for u0, u1 in zip(stops[:-1], stops[1:]):
        G.add(pn[u0], pn[u1], arc(Rp, u0, u1), PATH, 0, r2 - r1)
    # Escaliers du haut, jusqu'au chemin du sommet.
    joined = 0
    for u, _ in lanes_up:
        if u not in pn:
            continue
        top = G.node(*P(r4 + 0.3, u))
        G.add(pn[u], top, ray(u, Rp, r4 + 0.3), STEPS, F_STAIRS, lane_w * 0.8)
        k = G.split_nearest(*P(r4 + 0.3, u), 12)
        if k is not None:
            G.add(top, k, [], PATH, 0, 1.5)
            joined += 1
    # Escalier de l'axe et orchestre.
    foot = G.node(*P(ro - 1.6, uc))
    G.add(pn[uc], foot, ray(uc, Rp, ro - 1.6), STEPS, F_STAIRS, 1.6)
    hub = G.node(*P(10, 0))
    G.add(foot, hub, [], PATH, 0, 3)
    # Scène : du pied des marches au plateau, puis à l'est du plateau et, en la contournant à 1,5 m, vers la sortie nord.
    q = s["stage"]
    (x0, y0), (x1, y1), (x2, y2) = (q[0], q[1]), (q[2], q[3]), (q[4], q[5])
    W = math.hypot(x1 - x0, y1 - y0)
    ex, ey = (x1 - x0) / W, (y1 - y0) / W
    nx, ny = -ey, ex
    if (x2 - x1) * nx + (y2 - y1) * ny < 0:
        nx, ny = -nx, -ny
    depth = (x2 - x1) * nx + (y2 - y1) * ny
    sd = q[9]
    at = lambda e, t: (x0 + ex * e + nx * t, y0 + ey * e + ny * t)
    s0, s1, s2 = G.node(*at(W / 2, -0.8)), G.node(*at(W / 2, sd + 0.5)), G.node(*at(W / 2, depth + 1.0))
    G.add(hub, s0, [], PATH, 0, 3)
    G.add(s0, s1, [], STEPS, F_STAIRS, 3)
    G.add(s1, s2, [], PATH, 0, 3)
    # Sortie nord, au-delà de l'extrémité des gradins (u < −90°), vers le pied de l'escalier OpenStreetMap près de la maison du gardien.
    m = G.node(*P(18, -math.radians(95)))
    side = min((-1.5, W + 1.5), key=lambda e: math.dist(at(e, depth + 1.0), P(18, -math.radians(95))))
    corner = G.node(*at(side, depth + 1.0))
    G.add(s2, corner, [], PATH, 0, 2)
    G.add(corner, m, [], PATH, 0, 2)
    G.add(hub, m, [], PATH, 0, 3)
    n1 = G.node(*P(35, -math.radians(103)))
    G.add(m, n1, [], PATH, 0, 2)
    pn2 = P(62, -math.radians(101))
    n2 = G.node(*pn2)
    G.add(n1, n2, [], PATH, 0, 2)
    k = G.split_nearest(*pn2, 40, types=(PATH, STEPS))
    if k is not None:
        G.add(n2, k, [], PATH, 0, 1.5)

    doc["ped"] = G.dump()
    text = json.dumps(doc, separators=(",", ":"))
    entry = next(e for e in index["cells"] if e["id"] == cid)
    added = sum(1 for e in G.edges if e["attr"][6] == REF)
    new_entry = dict(entry, bytes=len(text), ped={"nodes": len(G.nodes), "edges": len(G.edges)})
    if path.read_text() == text and entry == new_entry:
        print(f"théâtre : {added} arêtes dans {cid}, rien à réécrire")
        return
    path.write_text(text)
    index["cells"] = [new_entry if e["id"] == cid else e for e in index["cells"]]
    (NAV / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"théâtre : {added} arêtes ajoutées dans {cid} ({joined} escaliers du haut raccordés au chemin du sommet) ; {cid}.json et index.json réécrits")


if __name__ == "__main__":
    main()
