"""Graphes de navigation : files piétonnes (trottoirs, passages, chemins, places) et graphe routier, construits depuis les axes de voies.

Analogie : un plan de métro des trottoirs. Chaque rue donne deux lignes (une par trottoir), chaque carrefour des gares de correspondance
(les coins), chaque passage piéton une passerelle entre les deux lignes. Les lignes se décalent quand un mur les gêne.

Logique pure (listes, tableaux numpy, shapely) : aucune lecture de fichier ; `build_nav.py` fournit les entrées et écrit les sorties.
Repère : local du jeu (mètres, x vers l'est, y vers le nord).
"""

import math
from collections import defaultdict

import numpy as np
import shapely
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

SIDEWALK_OFFSET = 1.1  # le sol trace des trottoirs de 2,2 m (build_ground.WALK_W) : leur milieu est à 1,1 m du bord de chaussée
SAMPLE = 3.0  # pas d'échantillonnage des files (m)
STRUCT_MARGIN = 0.5  # distance minimale d'une file à un bâtiment ou un mur (m)

# Types d'arêtes piétonnes.
T_LANE, T_CORNER, T_CROSS, T_CROSS_SIGNAL, T_CROSS_IMPLICIT, T_PATH, T_STEPS, T_PLAZA, T_PLAZA_LINK, T_PEDSTREET = range(10)
# Drapeaux d'arêtes piétonnes.
F_BRIDGE, F_STEPS, F_LIT, F_SHARED = 1, 2, 4, 8
# Drapeaux de nœuds.
NF_PORTAL, NF_WORLD_END = 1, 2

WALK_KINDS_PATH = {"footway", "path", "track", "cycleway"}
CALM_KINDS = {"residential", "unclassified", "service", "living_street"}


# --------------------------------------------------------------------------------------------------------------------
# Obstacles de structure

class Obstacles:
    """Bâtiments (polygones, cours intérieures en trous) et murs (lignes) : ce qu'une file ne doit pas traverser. Requêtes groupées."""

    def __init__(self, buildings, walls):
        geoms = []
        for rings in buildings:
            holes = [[(h[i], h[i + 1]) for i in range(0, len(h), 2)] for h in rings[1:]]
            ring = rings[0]
            p = shapely.Polygon([(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)], holes)
            if not p.is_valid:
                p = p.buffer(0)
            if not p.is_empty:
                geoms.append(p)
        for w in walls:
            if len(w) >= 4:
                geoms.append(LineString([(w[i], w[i + 1]) for i in range(0, len(w), 2)]))
        self.geoms = geoms
        self.tree = STRtree(geoms)

    def blocked(self, pts, margin=STRUCT_MARGIN):
        """Masque booléen : le point est-il à moins de `margin` d'un obstacle (ou dedans) ?"""
        pts = np.asarray(pts, float).reshape(-1, 2)
        out = np.zeros(len(pts), bool)
        if len(pts) == 0:
            return out
        hit = self.tree.query(shapely.points(pts), predicate="dwithin", distance=margin)
        out[hit[0]] = True
        return out

    def segment_blocked(self, a, b, margin=0.25):
        return len(self.tree.query(LineString([a, b]), predicate="dwithin", distance=margin)) > 0


# --------------------------------------------------------------------------------------------------------------------
# Axes

class Axis:
    """Arête d'axe : un morceau de voie entre deux nœuds du graphe (jonction, extrémité, passage piéton…)."""

    def __init__(self, street, seg, a, b, pts):
        self.street = street
        self.seg = seg
        self.a, self.b = a, b
        self.pts = np.asarray(pts, float)
        d = np.hypot(*np.diff(self.pts, axis=0).T) if len(self.pts) > 1 else np.zeros(0)
        self.cum = np.concatenate([[0.0], np.cumsum(d)])
        self.length = float(self.cum[-1])

    def at(self, s):
        s = np.clip(np.asarray(s, float), 0, self.length)
        return np.stack([np.interp(s, self.cum, self.pts[:, 0]), np.interp(s, self.cum, self.pts[:, 1])], axis=-1)

    def tangent(self, s):
        s = np.asarray(s, float)
        h = 0.6
        d = self.at(s + h) - self.at(s - h)
        n = np.hypot(d[..., 0], d[..., 1])
        n = np.where(n < 1e-9, 1.0, n)
        return d / n[..., None]

    def project(self, p):
        return float(LineString(self.pts).project(Point(p)))


def split_streets(streets, split_nodes):
    """Découpe chaque voie en arêtes d'axe aux nœuds de `split_nodes` (et à ses extrémités)."""
    axes = []
    for s in streets:
        nodes = s["nodes"]
        pts = np.array(s["pts"], float).reshape(-1, 2)
        if len(nodes) != len(pts) or len(nodes) < 2:
            continue
        cut = [0] + [i for i in range(1, len(nodes) - 1) if nodes[i] in split_nodes] + [len(nodes) - 1]
        for k, (i, j) in enumerate(zip(cut[:-1], cut[1:])):
            ax = Axis(s, k, nodes[i], nodes[j], pts[i:j + 1])
            if ax.length > 0.05:
                axes.append(ax)
    return axes


def junction_nodes(streets, extra=()):
    """Nœuds OpenStreetMap où le graphe doit être coupé : partagés par deux voies (ou deux fois par la même), extrémités, et `extra`."""
    use = defaultdict(int)
    ends = set()
    for s in streets:
        for n in s["nodes"]:
            use[n] += 1
        ends.add(s["nodes"][0])
        ends.add(s["nodes"][-1])
    return {n for n, c in use.items() if c > 1} | ends | set(extra)


# --------------------------------------------------------------------------------------------------------------------
# Graphe

class Graph:
    def __init__(self):
        self.nodes = []  # [x, y, flags]
        self.edges = []  # dict(a, b, pts (sommets intérieurs), typ, flags, width, ref, …)

    def node(self, x, y, flags=0):
        self.nodes.append([float(x), float(y), flags])
        return len(self.nodes) - 1

    def edge(self, a, b, pts, typ, **kw):
        e = {"a": a, "b": b, "pts": [(float(x), float(y)) for x, y in pts], "typ": typ, "flags": 0, "width": 2.0, "ref": 0}
        e.update(kw)
        self.edges.append(e)
        return e

    def xy(self, i):
        return self.nodes[i][0], self.nodes[i][1]


def simplify_polyline(a, pts, b, tol=0.12):
    """Sommets intérieurs conservés après simplification de a → b."""
    if len(pts) == 0:
        return []
    line = LineString([a] + list(pts) + [b]).simplify(tol, preserve_topology=False)
    inner = list(line.coords)[1:-1]
    return inner


# --------------------------------------------------------------------------------------------------------------------
# Files piétonnes

class _Arm:
    __slots__ = ("ax", "end", "u", "angle", "one", "dl", "dr", "slot_l", "slot_r", "node_l", "node_r", "kind", "width")


def _lane_profile(ax, w, obst, side):
    """Décalage latéral (m) de la file de côté `side` (+1 gauche, −1 droite) à chaque échantillon : le plus grand décalage ≤ nominal qui reste à
    distance des murs, jusqu'à l'axe. Renvoie (abscisses, décalages)."""
    L = ax.length
    n = max(2, int(math.ceil(L / SAMPLE)) + 1)
    ss = np.linspace(0, L, n)
    q = ax.at(ss)
    t = ax.tangent(ss)
    nl = np.stack([-t[:, 1], t[:, 0]], axis=1) * side
    nominal = w / 2 + SIDEWALK_OFFSET
    cands = np.arange(nominal, 0.0, -0.4)
    cands = np.concatenate([cands, [0.0]])
    pts = q[:, None, :] + nl[:, None, :] * cands[None, :, None]
    blocked = obst.blocked(pts.reshape(-1, 2)).reshape(n, len(cands))
    free = ~blocked
    first = free.argmax(axis=1)
    off = np.where(free.any(axis=1), cands[first], 0.0)
    if n >= 3:  # pas de dents de scie : minimum glissant sur trois échantillons
        off = np.minimum(off, np.minimum(np.roll(off, 1), np.roll(off, -1)))
        off[0] = min(off[0], off[1])
        off[-1] = min(off[-1], off[-2])
    return ss, off


def _is_two_lane(street):
    kind = street["kind"]
    if kind in WALK_KINDS_PATH or kind in ("steps", "pedestrian"):
        return False
    if kind == "living_street" and not street["motor"]:
        return False
    if kind == "service":
        return False
    return True


def _edge_type(street):
    kind = street["kind"]
    if kind == "steps":
        return T_STEPS
    if kind in WALK_KINDS_PATH:
        return T_PATH
    if kind == "pedestrian" or (kind == "living_street" and not street["motor"]):
        return T_PEDSTREET
    return T_LANE


def build_pedestrian(streets, node_tags, obst, crossing_nodes, signal_nodes):
    """Graphe piéton des voies données (liste de `streets_lib.build_street_list`, déjà filtrée sur les voies praticables).

    Retourne (Graph, stats). Les arêtes ont : typ, flags, width, ref (id de la voie OpenStreetMap), geometry `pts` (sommets intérieurs).
    """
    stats = defaultdict(int)
    split = junction_nodes(streets, extra=crossing_nodes)
    axes = split_streets(streets, split)
    # Profils de décalage et mode (deux files / une seule) de chaque arête d'axe.
    prof = {}
    for ax in axes:
        s = ax.street
        w = s["width"]
        if _is_two_lane(s):
            sl, ol = _lane_profile(ax, w, obst, +1)
            sr, orr = _lane_profile(ax, w, obst, -1)
            if ol.mean() < 0.8 and orr.mean() < 0.8:
                prof[id(ax)] = ("one", None, None)
                stats["rues sans place pour deux files (une file au milieu)"] += 1
            else:
                prof[id(ax)] = ("two", (sl, ol), (sr, orr))
        else:
            prof[id(ax)] = ("one", None, None)

    # Bras par nœud.
    arms_at = defaultdict(list)
    for ax in axes:
        mode = prof[id(ax)][0]
        for end in ("a", "b"):
            arm = _Arm()
            arm.ax, arm.end = ax, end
            arm.one = mode == "one"
            arm.kind = ax.street["kind"]
            arm.width = ax.street["width"]
            s0 = min(4.0, ax.length * 0.5)
            if end == "a":
                p0, p1 = ax.at(0.0), ax.at(s0)
            else:
                p0, p1 = ax.at(ax.length), ax.at(ax.length - s0)
            d = p1 - p0
            n = math.hypot(*d) or 1.0
            arm.u = (d[0] / n, d[1] / n)
            arm.angle = math.atan2(arm.u[1], arm.u[0])
            # Décalages effectifs à ce bout (côté gauche et droit du bras, vu depuis le nœud).
            if mode == "two":
                (sl, ol), (sr, orr) = prof[id(ax)][1], prof[id(ax)][2]
                near = lambda ss, oo: float(oo[ss <= 7.0].min()) if (ss <= 7.0).any() else float(oo[0])
                far = lambda ss, oo: float(oo[ss >= ax.length - 7.0].min()) if (ss >= ax.length - 7.0).any() else float(oo[-1])
                if end == "a":
                    arm.dl, arm.dr = near(sl, ol), near(sr, orr)
                else:
                    arm.dl, arm.dr = far(sr, orr), far(sl, ol)  # côté gauche du bras b = côté droit de l'axe
            else:
                arm.dl = arm.dr = 0.0
            arms_at[ax.a if end == "a" else ax.b].append(arm)

    g = Graph()
    xy_of = {}
    for ax in axes:
        xy_of[ax.a] = tuple(ax.pts[0])
        xy_of[ax.b] = tuple(ax.pts[-1])

    cross_done = set()
    for nid, arms in arms_at.items():
        J = np.array(xy_of[nid])
        tags = node_tags.get(nid, {})
        marked = nid in crossing_nodes
        signal = nid in signal_nodes
        arms.sort(key=lambda a: a.angle)
        n = len(arms)
        parent = {}

        def find(x):
            while parent.setdefault(x, x) != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(x, y):
            parent[find(x)] = find(y)

        contrib = defaultdict(list)
        for i, a in enumerate(arms):
            a.slot_l = (id(a), "S") if a.one else (id(a), "L")
            a.slot_r = (id(a), "S") if a.one else (id(a), "R")
            find(a.slot_l)
            find(a.slot_r)
        nl = lambda a: np.array([-a.u[1], a.u[0]])
        pair_links = []
        for k in range(n):
            i, j = arms[k], arms[(k + 1) % n]
            if n == 1:
                if i.one:
                    contrib[i.slot_l].append(J)
                else:
                    u, v = np.array(i.u), nl(i)
                    contrib[i.slot_l].append(J + 1.0 * u + i.dl * v)
                    contrib[i.slot_r].append(J + 1.0 * u - i.dr * v)
                    pair_links.append((i.slot_l, i.slot_r, T_CORNER, None))
                continue
            theta = (j.angle - i.angle) % (2 * math.pi)
            if theta < 1e-6:
                theta = 2 * math.pi
            ui, uj, vi, vj = np.array(i.u), np.array(j.u), nl(i), nl(j)
            di, dj = i.dl, j.dr
            a_ = None
            if 0.35 < theta < math.pi - 0.2:
                # Intersection de la file gauche de i et de la file droite de j : J + s_i u_i + d_i v_i = J + s_j u_j − d_j v_j.
                M = np.array([[ui[0], -uj[0]], [ui[1], -uj[1]]])
                rhs = -dj * vj - di * vi
                try:
                    si, sj = np.linalg.solve(M, rhs)
                except np.linalg.LinAlgError:
                    si = sj = None
                if si is not None and -0.5 <= si <= 15 and -0.5 <= sj <= 15:
                    P = J + si * ui + di * vi
                    union(i.slot_l, j.slot_r)
                    contrib[i.slot_l].append(P)
                    contrib[j.slot_r].append(P)
                    continue
            if math.pi - 0.2 <= theta <= math.pi + 0.2:
                P = J + 0.5 * (di * vi - dj * vj)
                union(i.slot_l, j.slot_r)
                contrib[i.slot_l].append(P)
                contrib[j.slot_r].append(P)
                continue
            if theta > math.pi + 0.2:  # coin extérieur : deux bouts séparés, reliés par un arc
                Pi, Pj = J + di * vi, J - dj * vj
                contrib[i.slot_l].append(Pi)
                contrib[j.slot_r].append(Pj)
                via = None
                if not i.one and not j.one:
                    b = vi - vj
                    nb = np.hypot(*b)
                    if nb > 1e-6:
                        via = J + ((di + dj) / 2) * b / nb
                pair_links.append((i.slot_l, j.slot_r, T_CORNER, via))
                continue
            # angle aigu : bouts éloignés du nœud, reliés par une corde
            s = min(8.0, max(di, dj, 1.0) * 1.5 / max(math.sin(theta), 0.2))
            contrib[i.slot_l].append(J + s * ui + di * vi)
            contrib[j.slot_r].append(J + s * uj - dj * vj)
            pair_links.append((i.slot_l, j.slot_r, T_CORNER, None))
        # Nœuds du graphe : un par groupe de bouts fusionnés, à la position moyenne des contributions.
        group_pts = defaultdict(list)
        for slot, pts in contrib.items():
            group_pts[find(slot)].extend(pts)
        gid = {}
        for root, pts in group_pts.items():
            m = np.mean(pts, axis=0)
            gid[root] = g.node(m[0], m[1])
        for a in arms:
            for side, slot in (("l", a.slot_l), ("r", a.slot_r)):
                root = find(slot)
                if root not in gid:
                    gid[root] = g.node(J[0], J[1])
                setattr(a, "node_" + side, gid[root])
        for s1, s2, typ, via in pair_links:
            n1, n2 = gid[find(s1)], gid[find(s2)]
            if n1 == n2:
                continue
            p1, p2 = g.xy(n1), g.xy(n2)
            mid = [tuple(via)] if via is not None else []
            if obst.segment_blocked(p1, p2) and (not mid or obst.segment_blocked(p1, mid[0]) or obst.segment_blocked(mid[0], p2)):
                stats["coins refusés (mur ou bâtiment)"] += 1
                continue
            g.edge(n1, n2, mid, T_CORNER, width=1.5)
        # Passages en travers de l'embouchure de chaque bras à deux files.
        degree = n
        for a in arms:
            if a.one or a.node_l == a.node_r:
                continue
            p1, p2 = g.xy(a.node_l), g.xy(a.node_r)
            dist = math.hypot(p1[0] - p2[0], p1[1] - p2[1])
            if dist > 30:
                continue
            typ = None
            if marked:
                typ = T_CROSS_SIGNAL if signal or tags.get("crossing") == "traffic_signals" else T_CROSS
            elif signal and a.kind not in CALM_KINDS:
                typ = T_CROSS_SIGNAL
            elif degree >= 3 and a.kind in CALM_KINDS and a.width <= 7.5 and (a.ax.street.get("bd") or {}).get("speed", 30) <= 50:
                typ = T_CROSS_IMPLICIT
            if typ is None:
                continue
            key = (min(a.node_l, a.node_r), max(a.node_l, a.node_r))
            if key in cross_done:
                continue
            cross_done.add(key)
            if obst.segment_blocked(p1, p2, 0.15):
                stats["passages refusés (obstacle)"] += 1
                continue
            g.edge(a.node_l, a.node_r, [], typ, width=3.0, ref=a.ax.street["id"])
            stats[("passages marqués" if typ in (T_CROSS, T_CROSS_SIGNAL) else "traversées implicites")] += 1

    # Files le long des axes.
    for ax in axes:
        mode, pl, pr = prof[id(ax)]
        arm_a = next(a for a in arms_at[ax.a] if a.ax is ax and a.end == "a")
        arm_b = next(a for a in arms_at[ax.b] if a.ax is ax and a.end == "b")
        s = ax.street
        typ = _edge_type(s)
        flags = 0
        if s["osm"].get("bridge") not in (None, "no"):
            flags |= F_BRIDGE
        if s["kind"] == "steps":
            flags |= F_STEPS
        if s["osm"].get("lit") == "yes":
            flags |= F_LIT
        lanes = []
        if mode == "two":
            lanes = [(arm_a.node_l, arm_b.node_r, pl), (arm_a.node_r, arm_b.node_l, pr)]
        else:
            lanes = [(arm_a.node_l, arm_b.node_l, None)]
            if not _is_two_lane(s):
                pass
            else:
                flags |= F_SHARED
        for na, nb, p in lanes:
            if na == nb:
                continue
            A, B = g.xy(na), g.xy(nb)
            s0, s1 = ax.project(A), ax.project(B)
            inner = []
            if s1 - s0 > 1.6:
                if p is None:
                    ss = np.unique(np.concatenate([ax.cum[(ax.cum > s0 + 0.8) & (ax.cum < s1 - 0.8)], np.arange(s0 + 0.8, s1 - 0.8, SAMPLE)]))
                    inner = [tuple(v) for v in ax.at(ss)] if len(ss) else []
                else:
                    ps, po = p
                    side = 1 if p is pl else -1
                    ss = np.unique(np.concatenate([ax.cum[(ax.cum > s0 + 0.8) & (ax.cum < s1 - 0.8)], np.arange(s0 + 0.8, s1 - 0.8, SAMPLE)]))
                    if len(ss):
                        q, t = ax.at(ss), ax.tangent(ss)
                        nrm = np.stack([-t[:, 1], t[:, 0]], axis=1) * side
                        off = np.interp(ss, ps, po)
                        inner = [tuple(v) for v in (q + nrm * off[:, None])]
            inner = simplify_polyline(A, inner, B)
            width = 2.0 if typ == T_LANE and not (flags & F_SHARED) else max(1.5, min(s["width"], 8.0))
            g.edge(na, nb, inner, typ, flags=flags, width=width, ref=s["id"])
    stats["axes"] = len(axes)
    stats["noeuds"] = len(g.nodes)
    stats["arêtes"] = len(g.edges)
    return g, dict(stats)


# --------------------------------------------------------------------------------------------------------------------
# Graphe routier (pour J3 : les données sont fixées dès J2)

CLASS_CODE = {"primary": 0, "secondary": 1, "tertiary": 2, "unclassified": 3, "residential": 4, "living_street": 5, "service": 6, "road": 7}
CLASS_SPEED = {"primary": 50, "secondary": 50, "tertiary": 50, "unclassified": 50, "residential": 30, "living_street": 20, "service": 20, "road": 30}
# Drapeaux de nœuds routiers (les deux premiers bits sont NF_PORTAL et NF_WORLD_END, communs aux deux graphes).
RN_SIGNAL, RN_STOP, RN_GIVE_WAY, RN_CROSSING, RN_MINI_ROUNDABOUT, RN_DEAD_END = 4, 8, 16, 32, 64, 128
# Drapeaux d'arêtes routières.
RE_ONEWAY_FWD, RE_ONEWAY_BACK, RE_BRIDGE, RE_TUNNEL, RE_ROUNDABOUT, RE_LIT, RE_AISLE, RE_BUS = 1, 2, 4, 8, 16, 32, 64, 128
SPECIAL_HIGHWAY = {"crossing", "traffic_signals", "stop", "give_way", "mini_roundabout", "turning_circle"}
RESTRICTION_CODE = {"no_left_turn": 0, "no_right_turn": 1, "no_straight_on": 2, "no_u_turn": 3, "no_entry": 4, "only_straight_on": 5, "only_left_turn": 6,
                    "only_right_turn": 7, "only_u_turn": 8}


def build_road(streets, node_tags, restrictions):
    """Graphe routier : arêtes d'axe non orientées (le sens unique est un drapeau), nœuds avec feux, stops, cédez-le-passage, passages piétons.

    Retourne (Graph, signs, restr, stats). `signs` : approches de stop, cédez-le-passage et feux {node, edge, kind}, avec kind + 8 quand OpenStreetMap
    ne donne pas la direction (à interpréter en J3). `restr` : restrictions de virage résolues sur des arêtes {node, from_edge, to_edge, code}.
    """
    stats = defaultdict(int)
    ms = [s for s in streets if s["motor"]]
    special = {n for n, t in node_tags.items() if t.get("highway") in SPECIAL_HIGHWAY}
    axes = split_streets(ms, junction_nodes(ms, extra=special))
    g = Graph()
    nid = {}

    def gnode(osm_id, xy):
        if osm_id not in nid:
            t = node_tags.get(osm_id, {})
            hw = t.get("highway")
            f = 0
            if hw == "traffic_signals" or t.get("crossing") == "traffic_signals":
                f |= RN_SIGNAL
            if hw == "stop":
                f |= RN_STOP
            if hw == "give_way":
                f |= RN_GIVE_WAY
            if hw == "crossing":
                f |= RN_CROSSING
            if hw == "mini_roundabout":
                f |= RN_MINI_ROUNDABOUT
            if hw == "turning_circle":
                f |= RN_DEAD_END
            nid[osm_id] = g.node(xy[0], xy[1], f)
        return nid[osm_id]

    by_way = defaultdict(list)
    for ax in axes:
        s = ax.street
        a, b = gnode(ax.a, ax.pts[0]), gnode(ax.b, ax.pts[-1])
        o, bd = s["osm"], s.get("bd") or {}
        flags = 0
        if s["oneway"] == 1:
            flags |= RE_ONEWAY_FWD
        elif s["oneway"] == -1:
            flags |= RE_ONEWAY_BACK
        if o.get("bridge") not in (None, "no"):
            flags |= RE_BRIDGE
        if s["tunnel"] or o.get("tunnel") not in (None, "no"):
            flags |= RE_TUNNEL
        if o.get("junction") in ("roundabout", "circular"):
            flags |= RE_ROUNDABOUT
        if o.get("lit") == "yes":
            flags |= RE_LIT
        if o.get("service") == "parking_aisle":
            flags |= RE_AISLE
        if bd.get("bus"):
            flags |= RE_BUS
        kind = s["kind"]
        speed = s["maxspeed"] or bd.get("speed") or CLASS_SPEED.get(kind, 30)
        lanes = s["lanes"] or bd.get("lanes") or (1 if (s["oneway"] or s["width"] < 5.5) else 2)
        inner = simplify_polyline(tuple(ax.pts[0]), [tuple(p) for p in ax.pts[1:-1]], tuple(ax.pts[-1]), 0.15)
        e = g.edge(a, b, inner, 0, flags=flags, width=s["width"], ref=s["id"], cls=CLASS_CODE.get(kind, 7), lanes=int(lanes),
                   speed=int(min(130, max(5, speed))),  # une voie de service porte maxspeed=1 dans OpenStreetMap
                   gid=s["id"] * 64 + min(ax.seg, 63))
        by_way[s["id"]].append((len(g.edges) - 1, ax))
    # Approches de panneaux : arêtes qui arrivent au nœud, dans le sens voulu.
    signs = []
    touching = defaultdict(list)
    for i, e in enumerate(g.edges):
        touching[e["a"]].append(i)
        touching[e["b"]].append(i)
    way_dir_tag = {}
    for osm_id, gi in nid.items():
        t = node_tags.get(osm_id, {})
        hw = t.get("highway")
        kind = {"stop": 1, "give_way": 2, "traffic_signals": 3}.get(hw)
        if kind is None:
            continue
        d = t.get("direction") or t.get("traffic_signals:direction") or t.get("stop:direction")
        for ei in touching[gi]:
            e = g.edges[ei]
            arrival_forward = e["b"] == gi
            if d in ("forward", "backward"):
                if (d == "forward") != arrival_forward:
                    continue
                signs.append({"node": gi, "edge": ei, "kind": kind})
            else:
                signs.append({"node": gi, "edge": ei, "kind": kind + 8})
    stats["approches de panneaux"] = len(signs)
    restr = []
    for r in restrictions:
        m = {x["role"]: x for x in r["members"]}
        if not all(k in m for k in ("from", "via", "to")) or m["via"]["type"] != "node":
            stats["restrictions ignorées (via non nœud)"] += 1
            continue
        via = nid.get(m["via"]["ref"])
        code = RESTRICTION_CODE.get(r["tags"].get("restriction"))
        if via is None or code is None:
            stats["restrictions hors zone ou inconnues"] += 1
            continue
        fe = [i for i in touching[via] if g.edges[i]["ref"] == m["from"]["ref"]]
        te = [i for i in touching[via] if g.edges[i]["ref"] == m["to"]["ref"]]
        if not fe or not te:
            stats["restrictions non résolues"] += 1
            continue
        restr.append({"node": via, "from_edge": fe[0], "to_edge": te[0], "code": code})
    stats["restrictions"] = len(restr)
    stats["noeuds"] = len(g.nodes)
    stats["arêtes"] = len(g.edges)
    return g, signs, restr, dict(stats)


# --------------------------------------------------------------------------------------------------------------------
# Découpe par super-tuile, avec nœuds « portails » aux frontières

def _split_polyline(pts, gx, gy, size):
    """Découpe une polyligne aux lignes de la grille de super-tuiles : liste de morceaux (listes de points), dont les jonctions sont exactement sur la frontière."""
    pieces = [[pts[0]]]
    for (px, py), (qx, qy) in zip(pts[:-1], pts[1:]):
        ts = []
        if qx != px:
            lo, hi = sorted((px, qx))
            k = math.floor((lo - gx) / size) + 1
            while gx + k * size < hi:
                bx = gx + k * size
                t = (bx - px) / (qx - px)
                if 0 < t < 1:
                    ts.append((t, "x", bx))
                k += 1
        if qy != py:
            lo, hi = sorted((py, qy))
            k = math.floor((lo - gy) / size) + 1
            while gy + k * size < hi:
                by = gy + k * size
                t = (by - py) / (qy - py)
                if 0 < t < 1:
                    ts.append((t, "y", by))
                k += 1
        for t, axis, b in sorted(ts):
            c = (b, round(py + t * (qy - py), 2)) if axis == "x" else (round(px + t * (qx - px), 2), b)
            pieces[-1].append(c)
            pieces.append([c])
        pieces[-1].append((qx, qy))
    return pieces


def cut_into_cells(g, gx, gy, size, cells):
    """Répartit les arêtes de `g` par super-tuile existante (`cells` : ensemble de (i, j)). Les arêtes qui traversent une frontière sont coupées, avec un
    nœud portail (flag NF_PORTAL) de chaque côté, aux coordonnées identiques ; une frontière sans voisine (bord du monde) donne NF_WORLD_END.
    Les arêtes gardent `orig` (indice dans g.edges). Retourne {cell: [arêtes]} ; g.nodes reçoit les portails.
    """
    portals = {}
    out = defaultdict(list)

    def portal(c):
        if c not in portals:
            portals[c] = g.node(c[0], c[1], NF_PORTAL)
        return portals[c]

    for oi, e in enumerate(g.edges):
        a, b = e["a"], e["b"]
        full = [(g.nodes[a][0], g.nodes[a][1])] + e["pts"] + [(g.nodes[b][0], g.nodes[b][1])]
        pieces = _split_polyline(full, gx, gy, size)
        for k, pc in enumerate(pieces):
            na = a if k == 0 else portal(pc[0])
            nb = b if k == len(pieces) - 1 else portal(pc[-1])
            mid = pc[len(pc) // 2] if len(pc) % 2 == 1 else ((pc[len(pc) // 2 - 1][0] + pc[len(pc) // 2][0]) / 2, (pc[len(pc) // 2 - 1][1] + pc[len(pc) // 2][1]) / 2)
            cell = (math.floor((mid[0] - gx) / size), math.floor((mid[1] - gy) / size))
            if cell not in cells:
                for n in (na, nb):
                    if g.nodes[n][2] & NF_PORTAL:
                        g.nodes[n][2] |= NF_WORLD_END
                continue
            piece = dict(e)
            piece.update({"a": na, "b": nb, "pts": pc[1:-1], "orig": oi})
            out[cell].append(piece)
    return out


# --------------------------------------------------------------------------------------------------------------------
# Contrôles et nettoyage

def edge_length(g, e):
    pts = [g.xy(e["a"])] + list(e["pts"]) + [g.xy(e["b"])]
    return sum(math.hypot(x1 - x0, y1 - y0) for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]))


def components(g):
    """Composantes connexes : liste de listes d'indices d'arêtes."""
    parent = list(range(len(g.nodes)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for e in g.edges:
        parent[find(e["a"])] = find(e["b"])
    comp = defaultdict(list)
    for i, e in enumerate(g.edges):
        comp[find(e["a"])].append(i)
    return sorted(comp.values(), key=lambda c: -sum(edge_length(g, g.edges[i]) for i in c))


def prune_small_components(g, min_length):
    """Retire les composantes de moins de `min_length` m (îlots où un passant resterait coincé) ; retourne (nombre de composantes retirées, mètres)."""
    comps = components(g)
    drop = set()
    removed_len = 0.0
    n = 0
    for c in comps:
        L = sum(edge_length(g, g.edges[i]) for i in c)
        if L < min_length:
            drop.update(c)
            removed_len += L
            n += 1
    g.edges = [e for i, e in enumerate(g.edges) if i not in drop]
    return n, removed_len


def lane_quality(g, obst):
    """Part (en longueur) des files qui entrent dans un bâtiment ou passent à moins de 0,25 m d'un mur, échantillonnée tous les mètres, par type d'arête."""
    tot, inside, near = defaultdict(float), defaultdict(float), defaultdict(float)
    for e in g.edges:
        pts = [g.xy(e["a"])] + list(e["pts"]) + [g.xy(e["b"])]
        line = LineString(pts)
        L = line.length
        if L < 0.5:
            continue
        ss = np.arange(0.5, L, 1.0)
        xy = np.array([line.interpolate(s).coords[0] for s in ss])
        tot[e["typ"]] += len(ss)
        inside[e["typ"]] += obst.blocked(xy, 0.0).sum()
        near[e["typ"]] += obst.blocked(xy, 0.25).sum()
    return {t: (tot[t], inside[t] / tot[t], near[t] / tot[t]) for t in tot}


# --------------------------------------------------------------------------------------------------------------------
# Obstacles ponctuels (arbres, mobilier) et nettoyage des arêtes coincées

FURNITURE_RADIUS = {"bench": 0.55, "waste_basket": 0.25, "post_box": 0.3, "atm": 0.4, "public_bookcase": 0.4, "bollard": 0.15, "memorial": 1.2,
                    "fountain": 1.0, "street_lamp": 0.2, "toilets": 1.0, "drinking_water": 0.25}  # comme src/core/world.ts
TREE_RADIUS = 0.3


class Circles:
    """Obstacles ronds (troncs, mobilier) : mêmes rayons que les collisions du jeu."""

    def __init__(self, trees, furniture):
        geoms = [Point(x, y).buffer(TREE_RADIUS, 4) for x, y in trees]
        for f in furniture:
            r = FURNITURE_RADIUS.get(f["kind"])
            if r is not None:
                geoms.append(Point(f["x"], f["y"]).buffer(r, 4))
        self.tree = STRtree(geoms)

    def blocked(self, pts, margin):
        pts = np.asarray(pts, float).reshape(-1, 2)
        out = np.zeros(len(pts), bool)
        if len(pts):
            hit = self.tree.query(shapely.points(pts), predicate="dwithin", distance=margin)
            out[hit[0]] = True
        return out

    def segment_blocked(self, a, b, margin):
        return len(self.tree.query(LineString([a, b]), predicate="dwithin", distance=margin)) > 0


def drop_stuck_edges(g, obst, max_inside=0.25):
    """Retire les arêtes dont plus de `max_inside` de la longueur est dans un bâtiment (escaliers sous un porche, chemins qui traversent une cour) :
    les collisions y bloqueraient les passants. Retourne le nombre d'arêtes retirées."""
    keep, dropped = [], 0
    for e in g.edges:
        if e["typ"] in (T_LANE, T_PATH, T_STEPS, T_PEDSTREET) and edge_length(g, e) > 2.0:
            pts = [g.xy(e["a"])] + list(e["pts"]) + [g.xy(e["b"])]
            line = LineString(pts)
            ss = np.arange(0.5, line.length, 1.0)
            xy = np.array([line.interpolate(s).coords[0] for s in ss]) if len(ss) else np.zeros((0, 2))
            if len(xy) and obst.blocked(xy, 0.0).mean() > max_inside:
                dropped += 1
                continue
        keep.append(e)
    g.edges = keep
    return dropped


def split_edges(g, cuts):
    """Coupe des arêtes en des abscisses données. `cuts` : {indice d'arête: [abscisses croissantes]}. Retourne {indice: [nœuds créés, dans l'ordre]}."""
    from shapely.ops import substring

    created = {}
    new_edges = []
    for ei, ds in cuts.items():
        e = g.edges[ei]
        line = LineString([g.xy(e["a"])] + list(e["pts"]) + [g.xy(e["b"])])
        bounds = [0.0] + list(ds) + [line.length]
        nodes = [e["a"]]
        for d in ds:
            p = line.interpolate(d)
            nodes.append(g.node(p.x, p.y))
        nodes.append(e["b"])
        created[ei] = nodes[1:-1]
        for k in range(len(bounds) - 1):
            sub = list(substring(line, bounds[k], bounds[k + 1]).coords)
            piece = e if k == 0 else dict(e)
            piece["a"], piece["b"], piece["pts"] = nodes[k], nodes[k + 1], sub[1:-1]
            if k > 0:
                new_edges.append(piece)
    g.edges.extend(new_edges)
    return created


def build_plazas(g, zone, obst, circles, roads, spacing=8.0, attach_reach=9.0, attach_gap=10.0):
    """Maillage régulier de points dans `zone` (places publiques), relié aux files voisines. Retourne (nombre de nœuds, d'arêtes, d'attaches).

    `roads` : polygones des chaussées (shapely) : aucune arête de place ne les traverse (pas de traversée sauvage par la place).
    """
    from shapely.prepared import prep

    stats = {"noeuds": 0, "arêtes": 0, "attaches": 0}
    if zone.is_empty:
        return stats, []
    inner = prep(zone.buffer(-0.9))
    covers = prep(zone.buffer(0.3))
    roads_p = prep(roads) if roads is not None and not roads.is_empty else None
    minx, miny, maxx, maxy = zone.bounds
    ix0, iy0 = math.ceil(minx / spacing), math.ceil(miny / spacing)
    nx, ny = int((maxx - minx) / spacing) + 2, int((maxy - miny) / spacing) + 2
    gx, gy = np.meshgrid(np.arange(ix0, ix0 + nx), np.arange(iy0, iy0 + ny), indexing="ij")
    cand = np.stack([gx.ravel() * spacing, gy.ravel() * spacing], axis=1)
    idx = np.stack([gx.ravel(), gy.ravel()], axis=1)
    inside = shapely.contains_xy(zone.buffer(-0.9), cand[:, 0], cand[:, 1])
    cand, idx = cand[inside], idx[inside]
    ok = ~obst.blocked(cand, 1.2) & ~circles.blocked(cand, 0.8)
    cand, idx = cand[ok], idx[ok]
    first = len(g.nodes)
    node_of = {}
    for (px, py), (i, j) in zip(cand, idx):
        node_of[(int(i), int(j))] = g.node(px, py)
    free_edges = 0
    for (i, j), n in node_of.items():
        for di, dj in ((1, 0), (0, 1), (1, 1), (1, -1)):
            m = node_of.get((i + di, j + dj))
            if m is None:
                continue
            a, b = g.xy(n), g.xy(m)
            seg = LineString([a, b])
            if obst.segment_blocked(a, b, 0.5) or circles.segment_blocked(a, b, 0.5) or not covers.covers(seg) or (roads_p and roads_p.intersects(seg)):
                continue
            g.edge(n, m, [], T_PLAZA, width=spacing * 0.75)
            free_edges += 1
    stats["noeuds"], stats["arêtes"] = len(node_of), free_edges
    # Attaches aux files existantes : un point de contact au plus tous les `attach_gap` m le long d'une file.
    lane_ids = [i for i, e in enumerate(g.edges) if e["typ"] in (T_LANE, T_PATH, T_PEDSTREET)]
    lines = [LineString([g.xy(g.edges[i]["a"])] + list(g.edges[i]["pts"]) + [g.xy(g.edges[i]["b"])]) for i in lane_ids]
    tree = STRtree(lines)
    attaches = defaultdict(list)  # indice d'arête -> [(abscisse, nœud de place, longueur du lien)]
    for n in node_of.values():
        p = Point(g.xy(n))
        best = None
        for k in tree.query(p, predicate="dwithin", distance=attach_reach):
            d = lines[k].distance(p)
            s = lines[k].project(p)
            q = lines[k].interpolate(s)
            if (best is None or d < best[0]) and not obst.segment_blocked(g.xy(n), (q.x, q.y), 0.4) \
                    and not circles.segment_blocked(g.xy(n), (q.x, q.y), 0.3) and not (roads_p and roads_p.intersects(LineString([g.xy(n), (q.x, q.y)]))):
                best = (d, k, s)
        if best:
            attaches[lane_ids[best[1]]].append((best[2], n, best[0]))
    cuts, links = {}, {}
    for ei, lst in attaches.items():
        lst.sort()
        chosen = []
        for s, n, d in lst:
            if chosen and s - chosen[-1][0] < attach_gap:
                if d < chosen[-1][2]:
                    chosen[-1] = (s, n, d)
                continue
            chosen.append((s, n, d))
        L = edge_length(g, g.edges[ei])
        chosen = [c for c in chosen if 0.8 < c[0] < L - 0.8]
        if chosen:
            cuts[ei] = [c[0] for c in chosen]
            links[ei] = [c[1] for c in chosen]
    created = split_edges(g, cuts)
    for ei, nodes in created.items():
        for lane_node, plaza_node in zip(nodes, links[ei]):
            g.edge(lane_node, plaza_node, [], T_PLAZA_LINK, width=2.0)
            stats["attaches"] += 1
    return stats, list(node_of.values())
