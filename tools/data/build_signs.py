"""Panneaux de signalisation tirés du graphe routier (D295) : stop, cédez-le-passage, sens interdit, limitations de vitesse.

Usage : python3 tools/data/build_signs.py [--fetch]
        --fetch : complète tools/data/maxspeed.json par l'API d'OpenStreetMap (étiquette `maxspeed` des voies du graphe qui n'y sont pas encore).
Entrées : public/data/nav/*.json (graphe routier, D40 : nœuds, arêtes, approches de panneaux), public/data/world.json (tuiles),
          public/data/tiles/*.json (emprises des bâtiments : un panneau n'est jamais posé dedans), tools/data/maxspeed.json.
Sorties : public/data/signs/<tuile>.json ({v, items : mobilier}) et signs/index.json ; le jeu ajoute ces panneaux au mobilier de la tuile.
Étape autonome : elle ne touche à aucune tuile ni au graphe ; à relancer après build_nav.py.

Règles (voir docs/DECISIONS.md, D295) :
- stop et cédez-le-passage : sur chaque approche dont OpenStreetMap donne le sens ; quand il ne le donne pas, sur les approches des voies
  moins importantes que la plus importante du carrefour (aucune si toutes se valent) ;
- sens interdit : au bout de sortie d'une voie à sens unique, quand on peut arriver à ce carrefour par une autre voie (pas dans les
  ronds-points, ni dans les allées de parking ou les voies de service) ;
- limitation : au début d'une voie dont OpenStreetMap donne la vitesse maximale (valeur réglementaire), quand on y entre depuis une voie
  dont la vitesse diffère (50 km/h si elle n'en donne pas : la règle en ville).
Chaque panneau est sur le trottoir, à droite du conducteur à qui il s'adresse, tourné vers lui (`rot` : direction où regarde sa face).
"""

import json
import math
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

import config as c

HERE = Path(__file__).resolve().parent
NAV = c.OUT / "nav"
OUT = c.OUT / "signs"
SPEEDS = HERE / "maxspeed.json"

# Drapeaux et classes du graphe routier (nav_lib.py, src/data/nav.ts).
ONEWAY_FWD, ONEWAY_BACK, ROUNDABOUT, AISLE = 1, 2, 16, 64
SERVICE, LIVING = 6, 5
STD_SPEEDS = {20, 30, 40, 50, 70, 80, 90, 110}
STOP, GIVE_WAY, UNKNOWN_DIR = 1, 2, 8
# Identifiants du mobilier ajouté : −(SIGN_ID + n).
SIGN_ID = 960_000_000
# Écart au bord de la chaussée (m), recul depuis le carrefour pour une limitation (m), longueur minimale de la voie limitée.
SIDE = 0.6
SPEED_SETBACK = 4.0
MIN_EDGE = 8.0
MERGE = 2.0


def load_graph():
    """Graphe routier de toutes les super-tuiles, nœuds fusionnés par coordonnées (les portails ont leur jumeau dans la voisine)."""
    key_of, nodes, edges, signs = {}, [], [], []

    def node(x, y):
        k = (round(x, 2), round(y, 2))
        if k not in key_of:
            key_of[k] = len(nodes)
            nodes.append((x, y))
        return key_of[k]

    for f in sorted(NAV.glob("s*.json")):
        r = json.loads(f.read_text())["road"]
        n, e, g, s = r["n"], r["e"], r["g"], r["s"]
        local = [node(n[i], n[i + 1]) for i in range(0, len(n), 3)]
        base = len(edges)
        for i in range(0, len(e), 11):
            a, b, cls, flags, lanes, speed, w10, _len, gid, p0, np_ = e[i:i + 11]
            inner = [(g[2 * (p0 + k)], g[2 * (p0 + k) + 1]) for k in range(np_)]
            pts = [nodes[local[a]]] + inner + [nodes[local[b]]]
            edges.append({"a": local[a], "b": local[b], "cls": cls, "flags": flags, "speed": speed, "w": w10 / 10, "way": gid // 64, "pts": pts})
        for i in range(0, len(s), 3):
            signs.append((local[s[i]], base + s[i + 1], s[i + 2]))
    return nodes, edges, signs


def length(pts):
    return sum(math.dist(p, q) for p, q in zip(pts, pts[1:]))


def walk(e, from_node, d):
    """Point et direction unitaire à `d` mètres le long de l'arête depuis son bout `from_node` (vers l'intérieur de l'arête)."""
    pts = e["pts"] if e["a"] == from_node else e["pts"][::-1]
    left = d
    for p, q in zip(pts, pts[1:]):
        seg = math.dist(p, q)
        if seg < 1e-6:
            continue
        ux, uy = (q[0] - p[0]) / seg, (q[1] - p[1]) / seg
        if left <= seg:
            return (p[0] + ux * left, p[1] + uy * left), (ux, uy)
        left -= seg
    p, q = pts[-2], pts[-1]
    seg = math.dist(p, q) or 1
    return q, ((q[0] - p[0]) / seg, (q[1] - p[1]) / seg)


def can_leave(e, n):
    """On peut quitter le nœud n par l'arête e (sens de circulation)."""
    if e["flags"] & ONEWAY_FWD:
        return e["a"] == n
    if e["flags"] & ONEWAY_BACK:
        return e["b"] == n
    return True


def can_arrive(e, n):
    """On peut arriver au nœud n par l'arête e."""
    if e["flags"] & ONEWAY_FWD:
        return e["b"] == n
    if e["flags"] & ONEWAY_BACK:
        return e["a"] == n
    return True


def roadside(e, n, setback):
    """Pose d'un panneau au bord droit d'un conducteur qui arrive au nœud n par l'arête e, à `setback` du nœud, face vers lui :
    fonction (recul en plus, écart en plus) → (x, y, rot)."""
    def place(more, wider):
        (px, py), (ux, uy) = walk(e, n, setback + more)
        # (ux, uy) va du nœud vers l'arête : le conducteur roule en sens inverse (−u) ; sa droite est (−uy, ux).
        off = e["w"] / 2 + SIDE + wider
        return px - uy * off, py + ux * off, math.atan2(uy, ux)
    return place


def entering(e, n, setback):
    """Pose d'un panneau au bord droit d'un conducteur qui quitte le nœud n par l'arête e, à `setback` du nœud, face vers lui."""
    def place(more, wider):
        (px, py), (ux, uy) = walk(e, n, setback + more)
        off = e["w"] / 2 + SIDE + wider
        return px + uy * off, py - ux * off, math.atan2(-uy, -ux)
    return place


def fetch_speeds(ways, known):
    """Étiquette `maxspeed` des voies manquantes, par lots de 100 (API d'OpenStreetMap). None : pas d'étiquette, ou pas un nombre."""
    todo = sorted(w for w in ways if str(w) not in known)
    for i in range(0, len(todo), 100):
        batch = todo[i:i + 100]
        url = "https://api.openstreetmap.org/api/0.6/ways.json?ways=" + ",".join(map(str, batch))
        req = urllib.request.Request(url, headers={"User-Agent": "autun-3d-data"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                found = {el["id"]: el.get("tags", {}) for el in json.load(resp)["elements"]}
        except urllib.error.HTTPError as err:
            # Une voie supprimée depuis fait échouer tout le lot : on les demande une par une.
            if err.code not in (404, 410) or len(batch) == 1:
                raise
            found = {}
            for w in batch:
                try:
                    with urllib.request.urlopen(urllib.request.Request(url.split("=")[0] + "=" + str(w), headers=req.headers), timeout=60) as resp:
                        found.update({el["id"]: el.get("tags", {}) for el in json.load(resp)["elements"]})
                except urllib.error.HTTPError:
                    pass
        for w in batch:
            v = found.get(w, {}).get("maxspeed", "")
            known[str(w)] = int(v) if v.isdigit() else None
        print(f"  maxspeed : {min(i + 100, len(todo))}/{len(todo)}")
        time.sleep(1)
    return known


def inside(x, y, ring):
    ins, j = False, len(ring) // 2 - 1
    for i in range(len(ring) // 2):
        xi, yi, xj, yj = ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            ins = not ins
        j = i
    return ins


def main():
    nodes, edges, approaches = load_graph()
    at = defaultdict(list)
    for i, e in enumerate(edges):
        at[e["a"]].append(i)
        if e["b"] != e["a"]:
            at[e["b"]].append(i)
    known = json.loads(SPEEDS.read_text())["ways"] if SPEEDS.exists() else {}
    ways = {e["way"] for e in edges}
    if "--fetch" in sys.argv:
        known = fetch_speeds(ways, known)
        SPEEDS.write_text(json.dumps({"_doc": "Étiquette maxspeed d'OpenStreetMap des voies du graphe routier (build_signs.py --fetch, D295) ; null : "
                                              "pas d'étiquette.", "ways": dict(sorted(known.items(), key=lambda kv: int(kv[0])))}, ensure_ascii=False, indent=0))
    missing = [w for w in ways if str(w) not in known]
    if missing:
        raise SystemExit(f"{len(missing)} voie(s) sans vitesse connue : relancer avec --fetch")
    tag = lambda e: known[str(e["way"])]
    road = lambda e: e["cls"] < SERVICE and not e["flags"] & AISLE
    signs = []  # (kind, x, y, rot, name)

    # Stops et cédez-le-passage.
    by_node = defaultdict(list)
    for n, ei, k in approaches:
        if k & 7 in (STOP, GIVE_WAY):
            by_node[n].append((ei, k))
    for n, lst in by_node.items():
        incident = [edges[i] for i in at[n]]
        widest = max(e["w"] for e in incident)
        top = min(e["cls"] for e in incident)
        for ei, k in lst:
            e = edges[ei]
            if k & UNKNOWN_DIR and e["cls"] <= top:
                continue
            if length(e["pts"]) < 4:
                continue
            signs.append(("sign_stop" if k & 7 == STOP else "sign_give_way", roadside(e, n, widest / 2 + 1.5), None))

    # Sens interdits, au bout de sortie des voies à sens unique.
    for i, e in enumerate(edges):
        if not e["flags"] & (ONEWAY_FWD | ONEWAY_BACK) or e["flags"] & ROUNDABOUT or not road(e):
            continue
        x_node = e["b"] if e["flags"] & ONEWAY_FWD else e["a"]
        others = [edges[j] for j in at[x_node] if j != i]
        if not any(can_arrive(o, x_node) and road(o) for o in others) or length(e["pts"]) < 6:
            continue
        widest = max(o["w"] for o in others)
        signs.append(("sign_no_entry", entering(e, x_node, min(widest / 2 + 1.5, length(e["pts"]) / 2)), None))

    # Limitations de vitesse, au début des voies limitées.
    eff = lambda e: tag(e) or 50
    for n in range(len(nodes)):
        for j in at[n]:
            e2 = edges[j]
            v = tag(e2)
            if v not in STD_SPEEDS or not road(e2) or e2["cls"] == LIVING or e2["flags"] & ROUNDABOUT or not can_leave(e2, n) or length(e2["pts"]) < MIN_EDGE:
                continue
            if any(eff(edges[i]) != v and road(edges[i]) for i in at[n] if i != j and can_arrive(edges[i], n)):
                signs.append(("sign_speed", entering(e2, n, SPEED_SETBACK), str(v)))

    # Pose : hors de la chaussée dessinée et des bâtiments ; sur la chaussée (bouche de carrefour plus large que la voie), le panneau
    # s'écarte vers le trottoir, puis recule ; s'il n'y trouve aucune place, il est écarté.
    world = json.loads((c.OUT / "world.json").read_text())
    tiles = {t["id"]: t["bounds"] for t in world["tiles"]}
    cache = {}

    def tile_of(x, y):
        tid = next((t for t, (x0, y0, x1, y1) in tiles.items() if x0 <= x < x1 and y0 <= y < y1), None)
        if tid and tid not in cache:
            data = json.loads((c.OUT / "tiles" / f"{tid}.json").read_text())
            roads = [p for k, polys in data["ground"].items() if k.startswith("road_") for p in polys]
            cache[tid] = ([b["ring"] for b in data["buildings"]], roads)
        return tid

    def free(x, y):
        tid = tile_of(x, y)
        if tid is None:
            return False
        rings, roads = cache[tid]
        if any(inside(x, y, r) for r in rings):
            return False
        return not any(inside(x, y, p[0]) and not any(inside(x, y, h) for h in p[1:]) for p in roads)

    placed, dropped = [], 0
    for kind, place, name in signs:
        spot = next((p for more in (0, 1.5, 3) for wider in (0, 0.5, 1.0, 1.5, 2.0, 2.5) if free(*(p := place(more, wider))[:2])), None)
        if spot is None:
            dropped += 1
            continue
        x, y, rot = spot
        # Fusion des doublons : même nature, même valeur, à moins de 2 m.
        if any(m[0] == kind and m[4] == name and math.dist(m[1:3], (x, y)) < MERGE for m in placed):
            continue
        placed.append((kind, x, y, rot, name))
    out = defaultdict(list)
    for kind, x, y, rot, name in placed:
        out[tile_of(x, y)].append({"kind": kind, "x": round(x, 2), "y": round(y, 2), "name": name, "id": 0, "rot": round(rot, 3)})
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.json"):
        f.unlink()
    n = 0
    for tid in sorted(out):
        for item in out[tid]:
            n += 1
            item["id"] = -(SIGN_ID + n)
        (OUT / f"{tid}.json").write_text(json.dumps({"v": 1, "items": out[tid]}, ensure_ascii=False, separators=(",", ":")))
    (OUT / "index.json").write_text(json.dumps({"v": 1, "tiles": sorted(out)}, separators=(",", ":")))
    count = defaultdict(int)
    for items in out.values():
        for it in items:
            count[it["kind"] + (":" + it["name"] if it["name"] else "")] += 1
    print(f"{n} panneaux dans {len(out)} tuiles ({dropped} écartés : sans place hors de la chaussée et des bâtiments) : " + ", ".join(f"{k} {v}" for k, v in sorted(count.items())))


if __name__ == "__main__":
    main()
