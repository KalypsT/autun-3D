"""Greffe de la navigation d'une extension de la carte (extend.py, D266) : les voies nouvelles s'ajoutent au graphe publié, sans refaire celui de la ville.

Le graphe publié s'arrête au dernier nœud à terre (`build_nav.trim_to_land`, D105). Le bac à sable d'extend.py refait la navigation de son emprise
avec la nouvelle terre : ses voies continuent. On garde chaque super-tuile publiée telle quelle (mêmes nœuds, mêmes arêtes, même ordre) et on y
ajoute, à la fin des tableaux, les morceaux d'arêtes du bac à sable qui sortent de l'ancienne terre utilisable (`coast_lib.usable` de la terre
d'avant). Un morceau qui part de l'ancienne terre est raccordé à l'impasse publiée la plus proche de sa voie (même référence OpenStreetMap si
possible) : il commence exactement sur ce nœud. Les portails (nœuds aux frontières des super-tuiles) sont ceux du bac à sable, aux mêmes coordonnées
de part et d'autre : le jeu les recoud par leurs coordonnées.

À lancer **avant** d'installer la nouvelle région et land.json dans tools/data : `coast_lib.usable` doit voir la terre et le relief d'avant.
Usage : python3 tools/data/extend.py graft-nav <nom> [--target DOSSIER]
"""

import json
import math
from collections import defaultdict
from pathlib import Path

import coast_lib as coast
import nav_lib as nl

STEP = 2.0  # pas (m) du contrôle « à terre » le long des arêtes
REACH = 25.0  # distance maximale (m) entre l'impasse publiée et la voie du bac à sable
NE = 11


def usable_old(x, y):
    return coast.usable(x, y)


class Doc:
    """Un graphe (ped ou road) d'une super-tuile, en tableaux plats, qu'on complète à la fin."""

    def __init__(self, g):
        self.g = g
        self.n, self.e, self.pts = g["n"], g["e"], g["g"]

    def nodes(self):
        return [(self.n[i], self.n[i + 1], self.n[i + 2]) for i in range(0, len(self.n), 3)]

    def edges(self):
        out = []
        for k in range(0, len(self.e), NE):
            r = self.e[k:k + NE]
            p0, np_ = r[9], r[10]
            pts = [(self.pts[2 * (p0 + j)], self.pts[2 * (p0 + j) + 1]) for j in range(np_)]
            out.append((r, pts))
        return out

    def polyline(self, r, pts):
        a, b = r[0], r[1]
        return [(self.n[3 * a], self.n[3 * a + 1])] + pts + [(self.n[3 * b], self.n[3 * b + 1])]

    def degree(self):
        d = defaultdict(int)
        for k in range(0, len(self.e), NE):
            d[self.e[k]] += 1
            d[self.e[k + 1]] += 1
        return d

    def add_node(self, x, y, f, index):
        key = (round(x, 2), round(y, 2))
        if key in index:
            i = index[key]
            self.n[3 * i + 2] |= f
            return i
        i = len(self.n) // 3
        self.n += [round(x, 2), round(y, 2), f]
        index[key] = i
        return i

    def add_edge(self, r, a, b, inner):
        p0 = len(self.pts) // 2
        for x, y in inner:
            self.pts += [round(x, 2), round(y, 2)]
        poly = [(self.n[3 * a], self.n[3 * a + 1])] + list(inner) + [(self.n[3 * b], self.n[3 * b + 1])]
        length = sum(math.dist(poly[i], poly[i + 1]) for i in range(len(poly) - 1))
        row = list(r)
        row[0], row[1], row[7], row[9], row[10] = a, b, min(65535, round(length * 10)), p0, len(inner)
        self.e += row
        return len(self.e) // NE - 1


def densify(poly):
    out = [(0.0, poly[0])]
    s = 0.0
    for p, q in zip(poly[:-1], poly[1:]):
        L = math.dist(p, q)
        k = max(1, int(L / STEP))
        for j in range(1, k + 1):
            out.append((s + L * j / k, (p[0] + (q[0] - p[0]) * j / k, p[1] + (q[1] - p[1]) * j / k)))
        s += L
    return out


def cut(poly, s0, s1):
    """Sous-polyligne entre les abscisses curvilignes s0 et s1."""
    out, s = [], 0.0
    for p, q in zip(poly[:-1], poly[1:]):
        L = math.dist(p, q) or 1e-9
        a, b = s, s + L
        if b >= s0 and a <= s1:
            t0, t1 = max(0.0, (s0 - a) / L), min(1.0, (s1 - a) / L)
            pa = (p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0)
            pb = (p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1)
            if not out:
                out.append(pa)
            out.append(pb)
        s = b
    return out


def project(poly, pt):
    """Abscisse curviligne et distance du point le plus proche de la polyligne."""
    best, s = (1e18, 0.0), 0.0
    for p, q in zip(poly[:-1], poly[1:]):
        dx, dy = q[0] - p[0], q[1] - p[1]
        L2 = dx * dx + dy * dy or 1e-12
        t = max(0.0, min(1.0, ((pt[0] - p[0]) * dx + (pt[1] - p[1]) * dy) / L2))
        d = math.hypot(p[0] + t * dx - pt[0], p[1] + t * dy - pt[1])
        if d < best[0]:
            best = (d, s + t * math.sqrt(L2))
        s += math.sqrt(L2)
    return best[1], best[0]


class Published:
    """Les voies publiées d'un graphe (toutes super-tuiles) : pour savoir si un morceau du bac à sable y est déjà."""

    def __init__(self, target, kind):
        import shapely
        from shapely.geometry import LineString

        self.lines, self.refs = [], []
        for p in sorted((Path(target) / "nav").glob("s*.json")):
            d = Doc(json.loads(p.read_text())[kind])
            for r, pts in d.edges():
                poly = d.polyline(r, pts)
                if len(poly) >= 2 and poly[0] != poly[-1] or len(poly) > 2:
                    self.lines.append(LineString(poly))
                    self.refs.append(r[8])
        self.tree = shapely.STRtree(self.lines)

    def covered(self, x, y, ref, tol):
        from shapely.geometry import Point

        pt = Point(x, y)
        for i in self.tree.query(pt.buffer(tol)):
            if self.lines[i].distance(pt) <= (tol if self.refs[i] == ref else tol / 2):
                return True
        return False


def graft_cell(pub, sbx, kind, stats, published, inside):
    """Ajoute à `pub` (doc publié) les morceaux des arêtes de `sbx` (doc du bac à sable) que le graphe publié n'a pas, dans les tuiles
    refabriquées (`inside(x, y)`) ; les bouts ouverts sont raccordés au nœud publié le plus proche (même voie et impasse de préférence)."""
    tol = 4.0 if kind == "road" else 2.5
    P, S = Doc(pub[kind]), Doc(sbx[kind])
    index = {(round(x, 2), round(y, 2)): i for i, (x, y, _) in enumerate(P.nodes())}
    deg = P.degree()
    pnodes = P.nodes()
    pref = defaultdict(set)  # nœud publié -> références des arêtes qui y aboutissent
    for r, _ in P.edges():
        for k in (0, 1):
            pref[r[k]].add(r[8])
    snodes = S.nodes()
    new_of = {}
    added = []

    def nearest_pub(pt, reach):
        best = None
        for i, (x, y, f) in enumerate(pnodes):
            d = math.dist((x, y), pt)
            if d <= reach and (best is None or d < best[0]):
                best = (d, i)
        return best

    def node_for(si):
        if si not in new_of:
            x, y, f = snodes[si]
            near = nearest_pub((x, y), 1.0) if not f & nl.NF_PORTAL else None
            new_of[si] = near[1] if near else P.add_node(x, y, f, index)
        return new_of[si]

    for si, (r, pts) in enumerate(S.edges()):
        poly = S.polyline(r, pts)
        d = densify(poly)
        new = [inside(*p) and not published.covered(p[0], p[1], r[8], tol) for _, p in d]
        if not any(new):
            continue
        total = d[-1][0]
        runs, start = [], None
        for k in range(len(d)):
            if new[k] and start is None:
                start = k
            if not new[k] and start is not None:
                runs.append((start, k - 1))
                start = None
        if start is not None:
            runs.append((start, len(d) - 1))
        for k0, k1 in runs:
            s0, s1 = d[k0][0], d[k1][0]
            if s1 - s0 < 1.0 and not (k0 == 0 or k1 == len(d) - 1):
                continue  # un point isolé : bruit de la couverture
            a_end, b_end = k0 == 0, k1 == len(d) - 1
            ends = {}
            for side, open_ in (("a", not a_end), ("b", not b_end)):
                if not open_:
                    continue
                land_part = cut(poly, 0.0, s0) if side == "a" else cut(poly, s1, total)
                cands = []
                for i, (x, y, f) in enumerate(pnodes):
                    if f & nl.NF_PORTAL:
                        continue
                    sp, dist = project(land_part, (x, y))
                    if dist <= REACH:
                        cands.append((r[8] not in pref[i], deg[i] != 1, dist, i, sp))
                if not cands:
                    stats["bouts sans raccord"] += 1
                    continue
                same, _, dist, i, sp = min(cands)
                stats["raccords"] += 1
                stats["raccords même voie"] += int(not same)
                ends[side] = (i, sp if side == "a" else s1 + sp)
            ca, cb = ends.get("a"), ends.get("b")
            s_from = ca[1] if ca else (0.0 if a_end else s0)
            s_to = cb[1] if cb else (total if b_end else s1)
            if s_to - s_from < 0.5:
                continue
            piece = cut(poly, s_from, s_to)
            a = ca[0] if ca else (node_for(r[0]) if a_end else P.add_node(*piece[0], 0, index))
            b = cb[0] if cb else (node_for(r[1]) if b_end else P.add_node(*piece[-1], 0, index))
            if a == b and len(piece) < 3:
                continue
            ei = P.add_edge(r, a, b, piece[1:-1])
            added.append((si, ei))
            stats["arêtes ajoutées"] += 1
            stats["m ajoutés"] += round(s_to - s_from)
    return added


def graft_signs(pub, sbx, added):
    """Panneaux et restrictions du graphe routier qui ne portent que sur des arêtes ajoutées."""
    m = dict(added)
    road_p, road_s = pub["road"], sbx["road"]
    sn = Doc(road_s).nodes()
    pidx = {(round(x, 2), round(y, 2)): i for i, (x, y, _) in enumerate(Doc(road_p).nodes())}
    s = road_s.get("s", [])
    for k in range(0, len(s), 3):
        node, edge, kind = s[k:k + 3]
        if edge in m:
            key = (round(sn[node][0], 2), round(sn[node][1], 2))
            if key in pidx:
                road_p["s"] += [pidx[key], m[edge], kind]
    r = road_s.get("r", [])
    for k in range(0, len(r), 3):
        fe, te, code = r[k:k + 3]
        if fe in m and te in m:
            road_p["r"] += [m[fe], m[te], code]


def graft_nav(box, target, cells, inside):
    """Greffe la navigation des super-tuiles `cells` (ids) du bac à sable `box` sur `target`, dans les tuiles refabriquées (`inside`) ;
    renvoie les statistiques."""
    stats = defaultdict(int)
    published = {k: Published(target, k) for k in ("ped", "road")}
    idx_t = json.loads((target / "nav" / "index.json").read_text())
    entries = {e["id"]: e for e in idx_t["cells"]}
    for cid in cells:
        sp, tp = box / "nav" / f"{cid}.json", target / "nav" / f"{cid}.json"
        if not sp.exists():
            continue
        sbx = json.loads(sp.read_text())
        pub = json.loads(tp.read_text()) if tp.exists() else {**sbx, "ped": {"n": [], "e": [], "g": []}, "road": {"n": [], "e": [], "g": [], "s": [], "r": []}, "poi": []}
        before = json.dumps(pub, separators=(",", ":"))
        graft_cell(pub, sbx, "ped", stats, published["ped"], inside)
        added = graft_cell(pub, sbx, "road", stats, published["road"], inside)
        graft_signs(pub, sbx, added)
        have = {(pub["poi"][k + 1], pub["poi"][k + 2]) for k in range(0, len(pub["poi"]), 5)}
        for k in range(0, len(sbx["poi"]), 5):
            p = sbx["poi"][k:k + 5]
            if (p[1], p[2]) not in have and inside(p[1], p[2]) and not usable_old(p[1], p[2]):
                pub["poi"] += p
                stats["points d'intérêt ajoutés"] += 1
        text = json.dumps(pub, separators=(",", ":"))
        if text != before:
            tp.write_text(text)
            entries[cid] = {"id": cid, "bytes": len(text), "ped": {"nodes": len(pub["ped"]["n"]) // 3, "edges": len(pub["ped"]["e"]) // NE},
                            "road": {"nodes": len(pub["road"]["n"]) // 3, "edges": len(pub["road"]["e"]) // NE}, "poi": len(pub["poi"]) // 5}
            stats["super-tuiles modifiées"] += 1
    # Même ordre que build_nav.py (indices de super-tuile, pas l'ordre alphabétique) : les essais tirent leurs départs dans cet ordre.
    idx_t["cells"] = sorted(entries.values(), key=lambda e: tuple(int(v) for v in e["id"][1:].split("_")))
    (target / "nav" / "index.json").write_text(json.dumps(idx_t, separators=(",", ":")))
    return dict(stats)


def seams(target):
    """Portails sans jumeau sur toute la navigation de `target` (build_nav.check_seams)."""
    import build_nav as bn

    docs = {}
    for p in sorted((Path(target) / "nav").glob("s*.json")):
        i, j = (int(v) for v in p.stem[1:].split("_"))
        docs[(i, j)] = json.loads(p.read_text())
    return bn.check_seams(docs, bn.SIZE)


def components(target, cells, kind):
    """Composantes du graphe `kind` sur les super-tuiles touchées et leurs voisines, nœuds recousus par les portails : (nombre, longueurs en km)."""
    parent = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    length = defaultdict(float)
    ids = set()
    for cid in cells:
        i, j = (int(v) for v in cid[1:].split("_"))
        ids |= {f"s{i + a}_{j + b}" for a in (-2, -1, 0, 1, 2) for b in (-2, -1, 0, 1, 2)}
    for cid in ids:
        p = Path(target) / "nav" / f"{cid}.json"
        if not p.exists():
            continue
        d = Doc(json.loads(p.read_text())[kind])
        nodes = d.nodes()
        key = lambda n: (cid, n) if not nodes[n][2] & nl.NF_PORTAL else ("P", nodes[n][0], nodes[n][1])
        for r, pts in d.edges():
            ka, kb = key(r[0]), key(r[1])
            parent[find(ka)] = find(kb)
            length[ka] += r[7] / 10000
    comp = defaultdict(float)
    for k, L in length.items():
        comp[find(k)] += L
    sizes = sorted(comp.values(), reverse=True)
    return len(sizes), [round(v, 2) for v in sizes[:6]]


def reach(target, cells, kind, a, b):
    """Vrai si les points a et b (x, y) sont reliés dans le graphe `kind` (nœuds les plus proches)."""
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    near = {"a": (1e18, None), "b": (1e18, None)}
    for cid in cells:
        p = Path(target) / "nav" / f"{cid}.json"
        if not p.exists():
            continue
        d = Doc(json.loads(p.read_text())[kind])
        nodes = d.nodes()
        key = lambda n: (cid, n) if not nodes[n][2] & nl.NF_PORTAL else ("P", nodes[n][0], nodes[n][1])
        for r, _ in d.edges():
            parent[find(key(r[0]))] = find(key(r[1]))
        for n, (x, y, _) in enumerate(nodes):
            for name, pt in (("a", a), ("b", b)):
                dd = math.dist((x, y), pt)
                if dd < near[name][0]:
                    near[name] = (dd, key(n))
    if near["a"][1] is None or near["b"][1] is None:
        return False, near
    return find(near["a"][1]) == find(near["b"][1]), {k: round(v[0], 1) for k, v in near.items()}


