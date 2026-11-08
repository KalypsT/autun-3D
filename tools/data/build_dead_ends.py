"""Routes qui finissent à la mer (D287, docs/plans/routes-impasses.md) : raccourcir chaque route à ce qu'elle dessert, puis une vraie fin de route.

La côte (D105) coupe les routes qui sortaient de la ville : elles s'arrêtent au dernier point à terre, au bord d'une falaise ou sur une plage.
Le graphe routier publié marque ces bouts (nœuds `deadEnd`, `build_nav.trim_to_land`). Pour chacun, la **branche** va du dernier carrefour au bout ;
elle est coupée 25 m après la dernière chose qu'elle dessert (bâtiment à moins de 35 m, parking, chemin ou sentier qui s'y raccorde), et jamais
au-delà du haut de la falaise. Une branche qui ne dessert rien disparaît jusqu'à son carrefour.

    plan      calcule les branches et écrit tools/data/dead_ends.json (relu et corrigé à la main : `overrides`) ; ne touche à aucune donnée publiée
    apply     applique dead_ends.json à public/data : sols (chaussée, trottoirs, marquages coupés ; aire de retournement), sols fins et super-tuiles
              (repeints en herbe), mobilier (lampadaires et panneaux retirés ; panneau « voie sans issue » ajouté), barrière rouge et blanche (mur
              `barrier`), navigation (arêtes routières et files piétonnes coupées, sans toucher aux autres), points d'intérêt, rues de la carte.
              À lancer une fois, sur les données publiées d'avant (`git checkout public/data` pour recommencer) ; puis `extend.py`-like : images
              de la carte (build_map.py --images, kilomètres touchés seulement).

Usage : python3 tools/data/build_dead_ends.py plan|apply
"""

import json
import math
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import substring, unary_union
from shapely.strtree import STRtree

import coast_lib as coast
import config as c
from build_streetscape import decode, encode, polys

HERE = Path(__file__).parent
OUT = c.OUT
PLAN = HERE / "dead_ends.json"
NE = 11
NF_DEAD_END = 128
SERVE = 35.0       # un bâtiment à moins de SERVE m de la branche est desservi
LOT = 15.0         # un parking (sol plaza_*) à moins de LOT m est desservi
PATH_JOIN = 6.0    # un chemin piéton dont un bout est à moins de PATH_JOIN m de la branche s'y raccorde
MARGIN = 25.0      # on coupe MARGIN m après la dernière chose desservie
EDGE_BACK = 15.0   # et au moins EDGE_BACK m avant le haut de la falaise (premier point hors de `coast.usable`)
TURN_R = 7.0       # rayon de l'aire de retournement (m) : un demi-tour de voiture en trois temps
TURN_MIN_W = 4.5   # largeur de chaussée (m) à partir de laquelle on fait une aire de retournement (sinon : barrière seule)
SIGN_MIN = 60.0    # longueur gardée (m) à partir de laquelle on pose un panneau « voie sans issue » au carrefour
CUT_LAYERS = ("road_asphalt", "road_sett", "road_gravel", "road_paving", "walk", "marks", "marks_yellow", "marks_blue", "gutter")
CUT_FURNITURE = {"street_lamp", "stop", "give_way", "crossing", "traffic_signals", "bollard"}
PED_CUT = {0, 1, 2, 3, 4}  # files, angles, passages : ce qui longe ou traverse la route ; les chemins et sentiers restent
WALL_ID0, SIGN_ID0 = -980_000_000, -970_000_000
# Tracés de rue absents de places.json (fabriqué avant l'extension « chalon », D286) : la route de Chalon après le chemin des Ragots
# (OpenStreetMap, voie 155064508, coupée au trait de côte). Ajoutés à la carte par `apply`, et lus par `plan` pour reconnaître la coupe.
PLACES_ADD = {"Route de Chalon": [[2627.2, 47.5, 2859.3, -22.7]]}
COAST_NEAR = 300.0  # un bout de route à moins de COAST_NEAR m de la côte peut avoir été coupé par elle
EXTEND = 80.0      # côté carrefour d'un fragment isolé, la zone retirée continue de EXTEND m


# --- Graphe routier publié, recousu aux portails ------------------------------------------------------------------------------
def key(x, y):
    return (round(x, 1), round(y, 1))


def road_graph():
    nodes, adj, edges = {}, defaultdict(list), []
    for p in sorted((OUT / "nav").glob("s*.json")):
        r = json.loads(p.read_text())["road"]
        n, e, g = r["n"], r["e"], r["g"]
        for i in range(0, len(n), 3):
            k = key(n[i], n[i + 1])
            nodes[k] = nodes.get(k, 0) | n[i + 2]
        for j in range(0, len(e), NE):
            row = e[j:j + NE]
            a, b = key(n[3 * row[0]], n[3 * row[0] + 1]), key(n[3 * row[1]], n[3 * row[1] + 1])
            pts = [a] + [(g[2 * (row[9] + q)], g[2 * (row[9] + q) + 1]) for q in range(row[10])] + [b]
            i = len(edges)
            edges.append({"a": a, "b": b, "gid": row[8], "cls": row[2], "w": row[6] / 10, "pts": pts})
            adj[a].append(i)
            adj[b].append(i)
    return nodes, adj, edges


def walk_branch(end, adj, edges):
    """Du bout `end` jusqu'au premier nœud de degré ≠ 2 : polyligne du carrefour vers le bout, arêtes, nœud du carrefour."""
    path, used, cur, prev_e = [end], [], end, None
    while True:
        nxt = [i for i in adj[cur] if i != prev_e]
        if len(adj[cur]) > 2 and cur != end or not nxt:
            break
        i = nxt[0]
        e = edges[i]
        pts = e["pts"] if e["a"] == cur else e["pts"][::-1]
        path += pts[1:]
        used.append(i)
        prev_e, cur = i, pts[-1]
        if len(adj[cur]) != 2:
            break
    return path[::-1], used, cur


# --- Ce que la branche dessert ------------------------------------------------------------------------------------------------
class Context:
    def __init__(self):
        world = json.loads((OUT / "world.json").read_text())
        rings, lots, roads = [], [], []
        for t in world["tiles"]:
            d = json.loads((OUT / "tiles" / f"{t['id']}.json").read_text())
            for b in d["buildings"]:
                r = b["ring"]
                rings.append(Polygon([(r[i], r[i + 1]) for i in range(0, len(r), 2)]).buffer(0))
            for layer, ps in d["ground"].items():
                if layer.startswith("plaza_"):
                    lots += [decode(p) for p in ps]
                elif layer.startswith("road_"):
                    roads += [decode(p) for p in ps]
        self.buildings = rings
        self.btree = STRtree(rings)
        self.roads = roads
        self.rtree = STRtree(roads)
        self.lots = [p for p in lots if p.area > 150]  # les petits bouts de place (trottoirs élargis) ne sont pas des parkings
        self.ltree = STRtree(self.lots)
        ends = []
        for p in sorted((OUT / "nav").glob("s*.json")):
            ped = json.loads(p.read_text())["ped"]
            n, e = ped["n"], ped["e"]
            for j in range(0, len(e), NE):
                if e[j + 2] in (5, 6):  # chemin, escalier
                    for q in (e[j], e[j + 1]):
                        ends.append(Point(n[3 * q], n[3 * q + 1]))
        self.path_ends = ends
        self.ptree = STRtree(ends)


def served_distance(line, ctx):
    """Abscisse (depuis le carrefour) de la dernière chose desservie par la branche, et ce que c'est."""
    best, what, nb = 0.0, None, 0
    for i in ctx.btree.query(line.buffer(SERVE)):
        g = ctx.buildings[i]
        if g.distance(line) <= SERVE:
            nb += 1
            s = line.project(g.centroid)
            if s > best:
                best, what = s, "bâtiment"
    for i in ctx.ltree.query(line.buffer(LOT)):
        g = ctx.lots[i]
        if g.distance(line) <= LOT:
            s = max(line.project(Point(q)) for q in g.exterior.coords)
            if s > best:
                best, what = s, "parking"
    for i in ctx.ptree.query(line.buffer(PATH_JOIN)):
        p = ctx.path_ends[i]
        if p.distance(line) <= PATH_JOIN:
            s = line.project(p)
            if s > best:
                best, what = s, "chemin"
    return best, what, nb


SCENARIO_ZONE = (-1520.0, -1812.0, 1480.0, 1188.0)  # src/core/testing.ts
SCENARIO_MARGIN = 300.0  # une branche dont le carrefour est à moins de SCENARIO_MARGIN m de la zone garde son bout (les trajets des scénarios en sortent)


def scenario_exit(line, cut):
    """Si la branche est dans la zone des scénarios au-delà de `cut` : l'abscisse où elle en sort pour de bon (+ 20 m), ou sa longueur."""
    x0, y0, x1, y1 = SCENARIO_ZONE
    j = line.interpolate(0.0)
    m = SCENARIO_MARGIN
    if x0 - m <= j.x <= x1 + m and y0 - m <= j.y <= y1 + m:
        # Elle part de la zone ou de ses abords : les trajets des scénarios (200 s de conduite) en sortent et y entrent ; son bout ne bouge pas.
        return line.length
    inside = [s for s in np.arange(cut, line.length + 0.01, 2.0)
              if x0 <= line.interpolate(s).x <= x1 and y0 <= line.interpolate(s).y <= y1]
    if not inside:
        return None
    return float(inside[-1]) + 20.0


def first_served(line, ctx):
    """Abscisse du premier bâtiment desservi (pour un fragment isolé, raccourci aussi du côté du « carrefour »)."""
    best = line.length
    for i in ctx.btree.query(line.buffer(SERVE)):
        g = ctx.buildings[i]
        if g.distance(line) <= SERVE:
            best = min(best, line.project(g.centroid))
    return best


def cliff_distance(line):
    """Abscisse du premier point de la branche hors de la terre utilisable (plage, falaise), ou sa longueur."""
    for s in np.arange(0.0, line.length, 4.0):
        p = line.interpolate(s)
        if not coast.usable(p.x, p.y, margin=0.0):
            return float(s)
    return line.length


def end_height(line):
    """Le plus haut point des 90 derniers mètres, au-dessus de la mer : moins de 8 m, c'est une plage."""
    hs = []
    for s in np.arange(max(0.0, line.length - 90), line.length, 5.0):
        p = line.interpolate(s)
        z = coast._SAMPLER.at(p.x, p.y)
        if z is not None:
            hs.append(z - coast.SEA_Z)
    return max(hs) if hs else 0.0


# --- plan ---------------------------------------------------------------------------------------------------------------------
def plan():
    old = json.loads(PLAN.read_text()) if PLAN.exists() else {}
    overrides = old.get("overrides", {})
    nodes, adj, edges = road_graph()
    ctx = Context()
    out, seen = [], set()
    names = StreetNames()
    def coast_cut(q):
        """Bout coupé par la côte : à moins de COAST_NEAR m d'elle, et 20 m plus loin dans l'axe, ce n'est déjà plus de la terre utilisable."""
        if float(coast.signed_distance(np.array([q[0]]), np.array([q[1]]))[0]) <= -COAST_NEAR:
            return False
        e = edges[adj[q][0]]
        pts = e["pts"] if e["b"] == q else e["pts"][::-1]
        (x1, y1), (x2, y2) = pts[-2], pts[-1]
        d = math.hypot(x2 - x1, y2 - y1) or 1.0
        tx, ty = (x2 - x1) / d, (y2 - y1) / d
        if not coast.usable(x2 + tx * 20, y2 + ty * 20, margin=0.0):
            return True
        # Droit devant, à moins de 150 m : le rivage (plage, falaise, mer), après une descente de plus de 10 m (la règle du test, D287).
        z0 = coast._SAMPLER.at(x2, y2)
        if z0 is not None:
            drop, shore = 0.0, False
            for dd in np.arange(10.0, 151.0, 5.0):
                z = coast._SAMPLER.at(x2 + tx * dd, y2 + ty * dd)
                drop = max(drop, z0 - max(coast.SEA_Z, coast.SEA_Z if z is None else z))  # jusqu'à la surface de l'eau, pas le fond
                if float(coast.signed_distance(np.array([x2 + tx * dd]), np.array([y2 + ty * dd]))[0]) > -40.0:
                    shore = True
            if drop > 10.0 and shore:
                return True
        # La rue continue au-delà du bout dans les tracés de la carte (OpenStreetMap jusqu'au trait de côte) : le graphe l'a coupée au
        # dernier nœud utilisable (build_nav.trim_to_land), le suivant étant sur la plage, dans la falaise ou en mer.
        return names.continues(q, tx, ty)

    for end in sorted(k for k in nodes if len(adj[k]) == 1 and coast_cut(k)):
        path, used, junction = walk_branch(end, adj, edges)
        if frozenset(used) in seen:
            continue
        seen.add(frozenset(used))
        line = LineString(path)
        isolated = len(adj[junction]) == 1  # les deux bouts sont des impasses : la branche ne rejoint rien
        served, what, nb = served_distance(line, ctx)
        h = end_height(line)
        cliff = line.length if h < 8.0 else line.length - EDGE_BACK  # le bout du graphe est le dernier point utilisable : la falaise suit
        w = max(edges[i]["w"] for i in used)
        gid = edges[used[-1]]["gid"]
        name = names(line)
        e = {"name": name, "gid": gid, "junction": [round(v, 1) for v in junction], "end": [round(v, 1) for v in end],
             "length": round(line.length, 1), "width": w, "buildings": nb, "served": round(served, 1), "servedBy": what,
             "cliff": round(cliff, 1), "endHeight": round(h, 1), "isolated": isolated}
        if h < 8.0 and not isolated:
            e.update(action="keep", why="accès à la plage (descente douce)")
        elif isolated and nb:
            # Fragment de route entre deux bouts de côte (relié à rien) : raccourci des deux côtés à ce qu'il dessert.
            first = first_served(line, ctx)
            e.update(action="cut", cut0=round(max(EDGE_BACK, first - MARGIN), 1), cut=round(min(served + MARGIN, line.length - EDGE_BACK), 1),
                     finish="barrier", sign=False, why="fragment isolé entre deux bouts de côte : gardé là où il dessert des bâtiments")
        elif isolated or served == 0.0:
            e.update(action="remove", cut=0.0, why="ne dessert rien" if not isolated else "tronçon isolé, relié à rien")
        else:
            cut = min(served + MARGIN, cliff)
            if cut >= line.length - 5.0:
                e.update(action="keep", why="dessert jusqu'au bout")
            else:
                e.update(action="cut", cut=round(max(cut, served), 1), why=f"dernière chose desservie : {what} à {served:.0f} m")
        # Zone étalonnée des scénarios de circulation et de police (testing.ts, SCENARIO_ZONE, D105) : on n'y change pas le graphe routier
        # (leurs départs et leurs trajets en dépendent) ; une branche qui la traverse est coupée à sa sortie, ou à son bout si elle y finit.
        if e["action"] in ("cut", "remove"):
            exit_s = scenario_exit(line, e.get("cut", 0.0))
            if exit_s is not None:
                if exit_s >= line.length:
                    e.pop("cut0", None)  # le graphe ne bouge pas : ni d'un côté ni de l'autre
                e.update(action="cut", cut=round(min(line.length, exit_s), 1),
                         why=e["why"] + f" ; coupée à {min(line.length, exit_s):.0f} m pour ne pas changer le graphe routier autour de la zone étalonnée des scénarios")
        e.update(overrides.get(str(gid), {}))
        if e["action"] == "cut":
            cp = line.interpolate(e["cut"] - TURN_R)
            drawn = any(ctx.roads[i].distance(cp) < 1.0 for i in ctx.rtree.query(cp.buffer(1.0)))  # chaussée dessinée (sinon : peinte au sol seulement)
            e["finish"] = e.get("finish") or ("turn" if w >= TURN_MIN_W and e["cut"] >= TURN_R + 12 and drawn else "barrier")
            e["sign"] = e.get("sign", e["cut"] >= SIGN_MIN)
        e["line"] = [[round(x, 2), round(y, 2)] for x, y in path]
        (x1, y1), (x2, y2) = path[-2], path[-1]
        d = math.hypot(x2 - x1, y2 - y1) or 1.0
        e["tail"] = names.tail(path[-1], (x2 - x1) / d, (y2 - y1) / d, line)
        out.append(e)
    out.sort(key=lambda e: (e["action"], -e["length"]))
    PLAN.write_text(json.dumps({"_doc": "Routes qui finissent à la mer (build_dead_ends.py, D287) : une entrée par branche (du dernier carrefour au bout coupé par "
                                        "la côte). action : cut (couper à `cut` m du carrefour), remove (retirer toute la branche), keep. finish : turn (aire de "
                                        "retournement et barrière) ou barrier. overrides : corrections à la main, par identifiant de voie (gid).",
                                "overrides": overrides, "branches": out}, ensure_ascii=False, indent=1))
    for e in out:
        print(f"{e['action']:6s} {e['name'][:34]:34s} {e['length']:6.0f} m, {e['buildings']:3d} bât., desservi {e['served']:5.0f} m ({e['servedBy']}),"
              f" falaise à {e['cliff']:5.0f} m, bout à {e['endHeight']:5.1f} m, coupe {e.get('cut', '-')} {e.get('finish', '')}")
    print(f"{len(out)} branches ; écrit {PLAN}")


def add_places(d):
    """Ajoute PLACES_ADD aux rues de places.json (si elles n'y sont pas déjà)."""
    for name, lines in PLACES_ADD.items():
        st = next((x for x in d["streets"] if x["name"] == name), None)
        if st is None:
            continue
        for l in lines:
            if not any(m[:2] == l[:2] for m in st["lines"]):
                st["lines"].append(list(l))


class StreetNames:
    """Nom d'une branche : la rue de la carte (places.json) la plus proche de ses points, à 12 m au plus."""

    def __init__(self):
        d = json.loads((OUT / "map" / "places.json").read_text())
        add_places(d)
        self.lines, self.names, self.drive = [], [], []
        for st in d["streets"]:
            for l in st["lines"]:
                if len(l) >= 4:
                    self.lines.append(LineString([(l[i], l[i + 1]) for i in range(0, len(l), 2)]))
                    self.names.append(st["name"])
                    self.drive.append(st["kind"] not in ("path", "footway", "cycleway", "pedestrian"))
        self.tree = STRtree(self.lines)

    def continues(self, q, tx, ty, reach=15.0):
        """Vrai si un tracé de rue carrossable passe par q (à 3 m) et continue au-delà, dans la direction (tx, ty), jusqu'à un point qui n'est
        plus de la terre utilisable (plage, falaise, mer)."""
        p = Point(q)
        for i in self.tree.query(p.buffer(3.0)):
            ln = self.lines[i]
            if not self.drive[i] or ln.distance(p) > 3.0:
                continue
            for x, y in ln.coords:
                if (x - q[0]) * tx + (y - q[1]) * ty > reach and not coast.usable(x, y, margin=0.0):
                    return True
        return False

    def tail(self, q, tx, ty, branch=None):
        """Suite du tracé de rue carrossable au-delà de q dans la direction (tx, ty) (jusqu'au trait de côte), prolongée de 40 m ; à défaut,
        un prolongement droit jusqu'à 40 m au-delà de la terre utilisable (au plus 300 m)."""
        p = Point(q)
        best = None
        for i in self.tree.query(p.buffer(3.0)):
            ln = self.lines[i]
            if not self.drive[i] or ln.distance(p) > 3.0:
                continue
            s = ln.project(p)
            for part in (substring(ln, s, ln.length), substring(ln, s, 0.0)):
                if part.length < 1.0:
                    continue
                # Elle doit partir vers l'avant (et non revenir le long de la branche quand la route tourne)…
                a, b2 = part.interpolate(0.0), part.interpolate(min(8.0, part.length))
                if (b2.x - a.x) * tx + (b2.y - a.y) * ty < 0.5 * a.distance(b2):
                    continue
                # … et s'arrête si elle revient près de la branche.
                if branch is not None:
                    for d in np.arange(15.0, part.length, 3.0):
                        if branch.distance(part.interpolate(d)) < 6.0:
                            part = substring(part, 0.0, d - 3.0)
                            break
                if best is None or part.length > best.length:
                    best = part
        if best is not None:
            pts = [q] + list(best.coords)[1:]
        else:
            pts, L = [q], 0.0
            while L < 300 and coast.usable(q[0] + tx * L, q[1] + ty * L, margin=0.0):
                L += 5.0
            pts.append((q[0] + tx * L, q[1] + ty * L))
        (x1, y1), (x2, y2) = pts[-2], pts[-1]
        d = math.hypot(x2 - x1, y2 - y1) or 1.0
        pts.append((x2 + (x2 - x1) / d * 40, y2 + (y2 - y1) / d * 40))
        return [[round(x, 2), round(y, 2)] for x, y in pts]

    def __call__(self, line):
        votes = defaultdict(float)
        for s in np.linspace(0, line.length, 9):
            p = line.interpolate(s)
            for i in self.tree.query(p.buffer(12.0)):
                if self.lines[i].distance(p) <= 12.0:
                    votes[self.names[i]] += 1
        return max(votes, key=votes.get) if votes else "?"


# --- apply --------------------------------------------------------------------------------------------------------------------
def zones(branches, edges_keep):
    """Pour chaque branche : zone retirée (polygone), aire de retournement, barrière, panneau."""
    keep_mask = unary_union([LineString(e["pts"]).buffer(e["w"] / 2 + 3.0) for e in edges_keep if len(e["pts"]) >= 2])
    out = []
    for i, b in enumerate(branches):
        if b["action"] not in ("cut", "remove"):
            continue
        line = LineString(b["line"])
        L = line.length
        w = max(3.0, b["width"])
        # Au-delà du bout du graphe, la suite réelle de la route jusqu'à la côte (`tail`) : la chaussée publiée va parfois bien plus loin.
        ext = LineString(list(line.coords) + [tuple(p) for p in b["tail"][1:]])
        s0 = b["cut"] if b["action"] == "cut" else 0.0
        part = substring(ext, s0, ext.length)
        half = w / 2 + 8.0
        z = part.buffer(half, cap_style=2).union(Point(ext.coords[-1]).buffer(half))
        if b["action"] == "remove":
            z = z.union(Point(line.coords[0]).buffer(half)).difference(keep_mask)
        else:
            z = z.difference(keep_mask.difference(line.buffer(half)))  # les autres routes proches restent intactes
        if b.get("cut0"):
            (x1, y1), (x2, y2) = line.coords[1], line.coords[0]
            d0 = math.hypot(x2 - x1, y2 - y1) or 1.0
            ext0 = LineString([(x2 + (x2 - x1) / d0 * EXTEND, y2 + (y2 - y1) / d0 * EXTEND)] + list(line.coords))
            z = z.union(substring(ext0, 0.0, b["cut0"] + EXTEND).buffer(half, cap_style=2))
        z = z.buffer(0)
        rec = {"i": i, "b": b, "zone": z, "turn": None, "barrier": None, "barrier0": None, "sign": None}
        if b.get("cut0"):
            tx, ty = direction(line, b["cut0"])
            bx, by = point(line, b["cut0"] + 0.6)
            hb = w / 2 + 0.3
            rec["barrier0"] = [bx - ty * hb, by + tx * hb, bx + ty * hb, by - tx * hb]
        if b["action"] == "cut":
            tx, ty = direction(line, s0)
            nx, ny = ty, -tx  # à droite en roulant vers le bout
            if b["finish"] == "turn":
                cx, cy = point(line, s0 - TURN_R)
                rec["turn"] = Point(cx, cy).buffer(TURN_R, quad_segs=12)
            # Barrière juste au-delà du bout de la route (le graphe s'y arrête : les conducteurs simulés vont jusqu'au bout sans la toucher).
            s_bar, half_bar = s0 + 0.8, w / 2 + 0.5
            bx, by = point(ext_line(line, b), s_bar)
            rec["barrier"] = [bx - nx * half_bar, by - ny * half_bar, bx + nx * half_bar, by + ny * half_bar]
            if b.get("sign"):
                s_sign = min(14.0, s0 / 3)
                px, py = point(line, s_sign)
                sx, sy = direction(line, s_sign)
                off = w / 2 + 1.1
                # Panneau à droite en entrant dans la branche, face aux conducteurs qui arrivent du carrefour.
                rec["sign"] = (px + sy * off, py - sx * off, math.atan2(-sy, -sx))
        out.append(rec)
    return out


def ext_line(line, b):
    """La branche prolongée par la suite réelle de la route (`tail`) : pour poser ce qui est au-delà du bout du graphe."""
    return LineString(list(line.coords) + [tuple(p) for p in b["tail"][1:]])


def point(line, s):
    p = line.interpolate(max(0.0, min(line.length, s)))
    return p.x, p.y


def direction(line, s):
    a = line.interpolate(max(0.0, s - 2.0))
    b = line.interpolate(min(line.length, s + 2.0))
    d = math.hypot(b.x - a.x, b.y - a.y) or 1.0
    return (b.x - a.x) / d, (b.y - a.y) / d


def tile_of(x, y):
    return f"{math.floor((x - c.GRID_X) / c.TILE)}_{math.floor((y - c.GRID_Y) / c.TILE)}"


def tiles_touching(geom, world_ids):
    x0, y0, x1, y1 = geom.bounds
    out = []
    for col in range(math.floor((x0 - c.GRID_X) / c.TILE), math.floor((x1 - c.GRID_X) / c.TILE) + 1):
        for row in range(math.floor((y0 - c.GRID_Y) / c.TILE), math.floor((y1 - c.GRID_Y) / c.TILE) + 1):
            tid = f"{col}_{row}"
            if tid in world_ids and geom.intersects(box(*c.tile_bounds_local(col, row))):
                out.append(tid)
    return out


def apply_tiles(recs, world):
    ids = {t["id"] for t in world["tiles"]}
    manifest = {t["id"]: t for t in world["tiles"]}
    touched = defaultdict(list)
    for r in recs:
        geoms = [r["zone"]] + ([r["turn"].buffer(2.0)] if r["turn"] else [])
        for bar in (r["barrier"], r["barrier0"]):
            if bar:
                geoms.append(LineString([bar[:2], bar[2:]]).buffer(1.0))
        if r["sign"]:
            geoms.append(Point(r["sign"][:2]).buffer(1.0))
        for tid in tiles_touching(unary_union(geoms), ids):
            touched[tid].append(r)
    stats = defaultdict(int)
    for tid, rs in sorted(touched.items()):
        p = OUT / "tiles" / f"{tid}.json"
        d = json.loads(p.read_text())
        tb = box(*d["bounds"])
        zone = unary_union([r["zone"] for r in rs]).intersection(tb)
        turns = unary_union([r["turn"] for r in rs if r["turn"]]).intersection(tb) if any(r["turn"] for r in rs) else None
        bld = unary_union([Polygon([(b["ring"][i], b["ring"][i + 1]) for i in range(0, len(b["ring"]), 2)]).buffer(0) for b in d["buildings"]])
        if turns is not None and not turns.is_empty:
            turns = turns.difference(bld.buffer(0.5))
        g = d["ground"]
        for layer in CUT_LAYERS:
            if layer not in g:
                continue
            before = len(g[layer])
            kept = []
            for poly in g[layer]:
                P = decode(poly)
                if not P.intersects(zone) and (turns is None or layer != "walk" or not P.intersects(turns)):
                    kept.append(poly)
                    continue
                Q = P.difference(zone)
                if turns is not None and layer in ("walk",) + tuple(l for l in CUT_LAYERS if l.startswith("marks")):
                    Q = Q.difference(turns)
                kept += [encode(q) for q in polys(Q) if q.area > (0.02 if layer.startswith("marks") else 0.3)]
            g[layer] = kept
            stats["polygones de sol retouchés"] += abs(len(kept) - before) or 1
        if turns is not None and not turns.is_empty:
            road = unary_union([decode(q) for q in g.get("road_asphalt", [])] + [turns])
            g["road_asphalt"] = [encode(q) for q in polys(road.intersection(tb)) if q.area > 0.3]
            ring = turns.buffer(1.8).difference(turns).difference(road).difference(bld.buffer(0.3)).intersection(tb)
            walk = unary_union([decode(q) for q in g.get("walk", [])] + [ring])
            g["walk"] = [encode(q) for q in polys(walk) if q.area > 0.3]
            stats["aires de retournement"] += 1
        if turns is not None and not turns.is_empty:
            t0 = len(d["trees"])
            d["trees"] = [t for t in d["trees"] if not turns.buffer(0.8).contains(Point(t[0], t[1]))]
            stats["arbres retirés des aires"] += t0 - len(d["trees"])
        n0 = len(d["furniture"])
        d["furniture"] = [f for f in d["furniture"] if not (f["kind"] in CUT_FURNITURE and zone.contains(Point(f["x"], f["y"])))]
        stats["mobilier retiré"] += n0 - len(d["furniture"])
        for r in rs:
            for slot, bar in ((0, r["barrier"]), (500, r["barrier0"])):
                if not bar:
                    continue
                mx, my = (bar[0] + bar[2]) / 2, (bar[1] + bar[3]) / 2
                if tile_of(mx, my) == tid:
                    d["walls"].append({"id": WALL_ID0 - slot - r["i"], "kind": "barrier", "height": 1.0, "measured": 0.0,
                                       "pts": [round(v, 2) for v in bar]})
                    stats["barrières"] += 1
            if r["sign"] and tile_of(*r["sign"][:2]) == tid:
                d["furniture"].append({"kind": "dead_end", "x": round(r["sign"][0], 2), "y": round(r["sign"][1], 2), "name": None,
                                       "id": SIGN_ID0 - r["i"], "rot": round(r["sign"][2], 4)})
                stats["panneaux"] += 1
        text = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
        p.write_text(text)
        m = manifest[tid]
        m.update(walls=len(d["walls"]), furniture=len(d["furniture"]), trees=len(d["trees"]), bytes=len(text))
        paint_fine(tid, zone, turns)
    return sorted(touched), stats


def paint(img_a, img_b, x0, y1, res, zone, turns):
    """Repeint les poids de sol sous la zone retirée (herbe) et sous les aires de retournement (asphalte). Rend vrai si l'image change."""
    A = np.asarray(img_a.convert("RGB")).copy()
    B = np.asarray(img_b.convert("RGB")).copy()
    h, w = A.shape[:2]
    xs = x0 + (np.arange(w) + 0.5) * res
    ys = y1 - (np.arange(h) + 0.5) * res
    xx, yy = np.meshgrid(xs, ys)
    import shapely
    changed = False
    for geom, a_val, b_grass in ((zone, (0, 0, 0), 255), (turns, (255, 0, 0), 0)):
        if geom is None or geom.is_empty:
            continue
        m = shapely.contains_xy(geom, xx, yy)
        if not m.any():
            continue
        A[m] = a_val
        B[m, 0] = b_grass
        B[m, 1] = 0
        changed = True
    return changed, Image.fromarray(A), Image.fromarray(B)


def paint_fine(tid, zone, turns):
    ga, gb = OUT / "ground" / f"{tid}_a.png", OUT / "ground" / f"{tid}_b.png"
    tb = OUT / "terrain" / f"{tid}.bin"
    if not ga.exists() or not tb.exists():
        return
    _, ox, oy, _ = np.frombuffer(tb.read_bytes()[:16], dtype="<f4")
    ch, a, b = paint(Image.open(ga), Image.open(gb), float(ox), float(oy), 1.0, zone, turns)
    if ch:
        a.save(ga, optimize=True)
        b.save(gb, optimize=True)


def paint_super(world, recs):
    sup = world["super"]
    zone = unary_union([r["zone"] for r in recs])
    turns = unary_union([r["turn"] for r in recs if r["turn"]])
    n = 0
    for cell in sup["cells"]:
        side = sup["size"] * sup["res"]
        cb = box(cell["x0"], cell["y1"] - side, cell["x0"] + side, cell["y1"])
        if not cb.intersects(zone.union(turns)):
            continue
        ga, gb = OUT / "ground" / f"{cell['id']}_a.png", OUT / "ground" / f"{cell['id']}_b.png"
        ch, a, b = paint(Image.open(ga), Image.open(gb), cell["x0"], cell["y1"], sup["res"], zone.intersection(cb), turns.intersection(cb))
        if ch:
            a.save(ga, optimize=True)
            b.save(gb, optimize=True)
            n += 1
    return n


# --- Navigation ---------------------------------------------------------------------------------------------------------------
def clip_graph(gr, zone, select, stats, kind):
    """Coupe les arêtes choisies (`select(row, polyline)`) par la zone : on garde les morceaux hors zone qui touchent un nœud d'origine
    (le nouveau bout prend le drapeau impasse) ; les nœuds devenus inutiles disparaissent ; panneaux et restrictions sont renumérotés."""
    n, e, g = gr["n"], gr["e"], gr["g"]
    nodes = [[n[i], n[i + 1], n[i + 2]] for i in range(0, len(n), 3)]
    rows = []
    for j in range(0, len(e), NE):
        r = e[j:j + NE]
        pts = [(nodes[r[0]][0], nodes[r[0]][1])] + [(g[2 * (r[9] + q)], g[2 * (r[9] + q) + 1]) for q in range(r[10])] + [(nodes[r[1]][0], nodes[r[1]][1])]
        rows.append((list(r), pts))
    new_rows, emap = [], {}
    for idx, (r, pts) in enumerate(rows):
        line = LineString(pts) if len(set(pts)) > 1 else None
        if line is None or not select(r, pts) or not line.intersects(zone):
            emap[idx] = len(new_rows)
            new_rows.append((r, pts))
            continue
        rest = line.difference(zone)
        pieces = [q for q in getattr(rest, "geoms", [rest]) if not q.is_empty and q.length > 0.5]
        if len(pieces) == 1 and pieces[0].length > line.length - 0.5:
            # L'arête ne fait que toucher la zone : rien à couper, on n'y touche pas (mêmes nœuds, même numérotation).
            emap[idx] = len(new_rows)
            new_rows.append((r, pts))
            continue
        a, b = Point(pts[0]), Point(pts[-1])
        kept = None
        for q in pieces:
            qa, qb = Point(q.coords[0]), Point(q.coords[-1])
            if qa.distance(a) < 0.01 or qb.distance(a) < 0.01:
                coords = list(q.coords) if qa.distance(a) < 0.01 else list(q.coords)[::-1]
                kept = ("a", coords)
                break
            if qa.distance(b) < 0.01 or qb.distance(b) < 0.01:
                coords = list(q.coords)[::-1] if qa.distance(b) < 0.01 else list(q.coords)
                kept = ("b", coords)
        stats[f"{kind} : arêtes coupées"] += 1
        if kept is None:
            stats[f"{kind} : arêtes retirées"] += 1
            continue
        side, coords = kept
        x, y = coords[-1] if side == "a" else coords[0]
        nodes.append([round(x, 2), round(y, 2), NF_DEAD_END])
        nid = len(nodes) - 1
        r = list(r)
        if side == "a":
            r[1] = nid
            inner = coords[1:-1]
        else:
            r[0] = nid
            inner = coords[1:-1]
        emap[idx] = len(new_rows)
        new_rows.append((r, [(nodes[r[0]][0], nodes[r[0]][1])] + [tuple(p) for p in inner] + [(nodes[r[1]][0], nodes[r[1]][1])]))
    # Nœuds utilisés, dans l'ordre d'origine (les nouveaux à la fin).
    used = sorted({r[0] for r, _ in new_rows} | {r[1] for r, _ in new_rows})
    nmap = {o: i for i, o in enumerate(used)}
    gr["n"] = [v for o in used for v in nodes[o]]
    ee, gg = [], []
    for r, pts in new_rows:
        inner = pts[1:-1]
        p0 = len(gg) // 2
        for x, y in inner:
            gg += [round(x, 2), round(y, 2)]
        L = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        r = list(r)
        r[0], r[1], r[7], r[9], r[10] = nmap[r[0]], nmap[r[1]], min(65535, round(L * 10)), p0, len(inner)
        ee += r
    gr["e"], gr["g"] = ee, gg
    if "s" in gr:
        s = gr["s"]
        out = []
        for j in range(0, len(s), 3):
            node, edge, k = s[j:j + 3]
            if node in nmap and edge in emap:
                out += [nmap[node], emap[edge], k]
        stats[f"{kind} : panneaux retirés"] += (len(s) - len(out)) // 3
        gr["s"] = out
    if "r" in gr:
        r_ = gr["r"]
        out = []
        for j in range(0, len(r_), 3):
            a, b, k = r_[j:j + 3]
            if a in emap and b in emap:
                out += [emap[a], emap[b], k]
        gr["r"] = out


def apply_nav(recs, branch_edges):
    # Les branches qui gardent leur bout (coupe au bout du graphe : abords de la zone des scénarios) gardent aussi leur navigation.
    zone = unary_union([r["zone"] for r in recs if r["b"]["action"] == "remove" or r["b"]["cut"] < r["b"]["length"] - 0.5])
    # Pour le graphe routier (seules les arêtes des branches sont coupées) : une branche retirée l'est jusqu'à son carrefour.
    zone_road = unary_union([zone] + [LineString(r["b"]["line"]).buffer(r["b"]["width"] / 2 + 8.0) for r in recs if r["b"]["action"] == "remove"])
    stats = defaultdict(int)
    # Les morceaux d'arêtes coupés aux frontières des super-tuiles : chacun a ses deux extrémités sur la polyligne de la branche.
    ends = {frozenset((key(*e["pts"][0]), key(*e["pts"][-1]))) for e in branch_edges}
    changed = []
    for p in sorted((OUT / "nav").glob("s*.json")):
        text = p.read_text()
        d = json.loads(text)
        if not box(*d["bounds"]).intersects(zone):
            continue
        clip_graph(d["road"], zone_road, lambda r, pts: frozenset((key(*pts[0]), key(*pts[-1]))) in ends, stats, "routes")
        clip_graph(d["ped"], zone, lambda r, pts: r[2] in PED_CUT, stats, "piétons")
        poi = d["poi"]
        keep = []
        for j in range(0, len(poi), 5):
            if not zone.contains(Point(poi[j + 1], poi[j + 2])):
                keep += poi[j:j + 5]
        stats["points d'intérêt retirés"] += (len(poi) - len(keep)) // 5
        d["poi"] = keep
        new = json.dumps(d, separators=(",", ":"))
        if new != text:
            p.write_text(new)
            changed.append(p.stem)
    # Taille des super-tuiles dans l'index.
    ip = OUT / "nav" / "index.json"
    idx = json.loads(ip.read_text())
    for cell in idx.get("cells", []):
        if cell["id"] in changed:
            cell["bytes"] = (OUT / "nav" / f"{cell['id']}.json").stat().st_size
    ip.write_text(json.dumps(idx, ensure_ascii=False))
    return changed, stats


def apply_places(recs):
    """Rues de la carte (places.json) : tracés coupés par la zone retirée."""
    p = OUT / "map" / "places.json"
    raw = p.read_text()
    d = json.loads(raw)
    add_places(d)
    zone = unary_union([r["zone"] for r in recs])
    n = 0
    for st in d["streets"]:
        lines = []
        for l in st["lines"]:
            ls = LineString([(l[i], l[i + 1]) for i in range(0, len(l), 2)])
            if not ls.intersects(zone):
                lines.append(l)
                continue
            n += 1
            rest = ls.difference(zone)
            for q in getattr(rest, "geoms", [rest]):
                if not q.is_empty and q.length > 5:
                    lines.append([round(v, 1) for xy in q.coords for v in xy])
        st["lines"] = lines
    d["streets"] = [s for s in d["streets"] if s["lines"]]
    p.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")) if "\n" not in raw[:200] else json.dumps(d, ensure_ascii=False, indent=1))
    return n


def apply_map(tiles):
    """Images de la carte des kilomètres touchés (build_map.py --images) ; les autres images gardent leurs octets."""
    kms = {(int(t.split("_")[0]) // c.SUPER, int(t.split("_")[1]) // c.SUPER) for t in tiles}
    backup = c.ROOT / ".cache" / "dead_ends_map_backup"
    if backup.exists():
        shutil.rmtree(backup)
    shutil.copytree(OUT / "map", backup)
    subprocess.run([sys.executable, str(HERE / "build_map.py"), "--images"], check=True, cwd=HERE, stdout=subprocess.DEVNULL)
    for p in backup.glob("s*.png"):
        i, j = (int(v.lstrip("s")) for v in p.stem.split("_")[:2])
        if (i, j) not in kms:
            shutil.copyfile(p, OUT / "map" / p.name)
    shutil.copyfile(backup / "places.json", OUT / "map" / "places.json")  # --images ne le réécrit pas, mais par prudence
    return sorted(f"s{i}_{j}" for i, j in kms)


def apply():
    spec = json.loads(PLAN.read_text())
    branches = spec["branches"]
    nodes, adj, edges = road_graph()
    branch_edge_ids = set()
    for b in branches:
        if b["action"] not in ("cut", "remove"):
            continue
        end = key(*b["end"])
        if end not in adj:
            raise SystemExit(f"bout {b['end']} ({b['name']}) absent du graphe publié : déjà appliqué ? (git checkout public/data)")
        _, used, _ = walk_branch(end, adj, edges)
        branch_edge_ids |= set(used)
    keep_edges = [e for i, e in enumerate(edges) if i not in branch_edge_ids]
    recs = zones(branches, keep_edges)
    world = json.loads((OUT / "world.json").read_text())
    tiles, st = apply_tiles(recs, world)
    n_super = paint_super(world, recs)
    (OUT / "world.json").write_text(json.dumps(world, indent=1))
    cells, nst = apply_nav(recs, [edges[i] for i in branch_edge_ids])
    n_streets = apply_places(recs)
    kms = apply_map(tiles)
    print(f"{len(recs)} branches traitées ; tuiles : {len(tiles)} ({' '.join(tiles)})")
    print("  " + ", ".join(f"{k} : {v}" for k, v in st.items()))
    print(f"  super-tuiles de sol repeintes : {n_super} ; navigation : {cells}")
    print("  " + ", ".join(f"{k} : {v}" for k, v in nst.items()))
    print(f"  rues de la carte coupées : {n_streets} ; kilomètres de carte refaits : {kms}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "plan":
        plan()
    elif cmd == "apply":
        apply()
    else:
        raise SystemExit(__doc__)
