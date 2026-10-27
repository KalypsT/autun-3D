"""Bords de chaussée : rien de solide ne reste sur la route, rien de bas ne pend au-dessus.

- Feux tricolores encore dans la chaussée (aux carrefours, le décalage perpendiculaire à une rue tombe dans la rue
  qui croise) : posés au point de trottoir le plus proche, crosse tournée vers la route.
- Troncs d'arbres dans la chaussée : poussés sur le bord s'ils en sont à moins de 3 m (position LiDAR imprécise),
  supprimés sinon (houppier voisin pris pour un arbre).
- Arbres dont la couronne déborde sur la chaussée : élagués comme des arbres d'alignement, couronne à 4 m au moins
  (gabarit des camions) ; trop petits pour cela, leur couronne est réduite pour ne plus déborder.

Appelé par build_tiles.py pour chaque tuile ; exécutable seul pour corriger les tuiles publiées sans tout régénérer :
    python tools/data/roadside.py
"""

import json
import math
import sys
from pathlib import Path

from shapely.geometry import Point, Polygon
from shapely.ops import nearest_points, unary_union

ROAD_LAYERS = ("road_asphalt", "road_sett", "road_gravel", "road_paving")
#: Écart entre un objet poussé hors de la chaussée et le bord (m).
CLEARANCE = 0.8
#: Au-delà de ce déplacement, un tronc dans la chaussée est jugé faux et supprimé.
MAX_TREE_SHIFT = 3.0
#: Hauteur libre sous les couronnes au-dessus de la chaussée (m) et hauteur minimale de couronne restante.
ROAD_HEADROOM = 4.0
MIN_CROWN = 2.0
#: Rayon de couronne réellement dessiné (stylized.ts : min(r, 4,5) × 0,9 à 1,1).
CROWN_CAP, CROWN_SCALE = 4.5, 1.1


def roads(ground):
    polys = []
    for name in ROAD_LAYERS:
        for poly in ground.get(name, []):
            ring = lambda r: [(r[i], r[i + 1]) for i in range(0, len(r), 2)]
            polys.append(Polygon(ring(poly[0]), [ring(h) for h in poly[1:]]).buffer(0))
    return unary_union(polys) if polys else None


def off_road(R, x, y):
    """
    Point hors de la chaussée R le plus proche de (x, y), à CLEARANCE du bord, et la distance parcourue.
    Répété au besoin : un îlot étroit entre deux voies peut renvoyer dans l'autre voie.
    """
    inside = R.buffer(0.2)
    ox, oy = x, y
    for _ in range(4):
        p = Point(x, y)
        if not inside.contains(p):
            break
        edge = nearest_points(R.boundary, p)[0]
        dx, dy = edge.x - x, edge.y - y
        d = math.hypot(dx, dy) or 1.0
        x, y = edge.x + dx / d * CLEARANCE, edge.y + dy / d * CLEARANCE
    return x, y, math.hypot(x - ox, y - oy)


def settle(rec):
    """Corrige une tuile (dictionnaire de build_tiles : ground, furniture, trees) ; renvoie le décompte des corrections."""
    R = roads(rec.get("ground", {}))
    counts = {"feux": 0, "troncs_deplaces": 0, "troncs_supprimes": 0, "couronnes_relevees": 0, "couronnes_reduites": 0}
    if R is None or R.is_empty:
        return counts
    inside = R.buffer(0.2)
    for f in rec["furniture"]:
        if f["kind"] != "traffic_signals" or not inside.contains(Point(f["x"], f["y"])):
            continue
        nx, ny, _ = off_road(R, f["x"], f["y"])
        f["rot"] = round(math.atan2(f["y"] - ny, f["x"] - nx), 3)
        f["x"], f["y"] = round(nx, 2), round(ny, 2)
        counts["feux"] += 1
    trees = []
    for tr in rec["trees"]:
        x, y, z, h, r, trunk = tr[:6]
        if inside.contains(Point(x, y)):
            nx, ny, d = off_road(R, x, y)
            if d > MAX_TREE_SHIFT:
                counts["troncs_supprimes"] += 1
                continue
            x, y = round(nx, 2), round(ny, 2)
            counts["troncs_deplaces"] += 1
        drawn = min(r, CROWN_CAP) * CROWN_SCALE
        gap = R.distance(Point(x, y))
        if gap < drawn and trunk < ROAD_HEADROOM:
            if h - ROAD_HEADROOM >= MIN_CROWN:
                trunk = ROAD_HEADROOM
                counts["couronnes_relevees"] += 1
            else:
                smaller = round(max(gap - 0.2, 0.8) / CROWN_SCALE, 2)
                if smaller < r:
                    r = smaller
                    counts["couronnes_reduites"] += 1
        trees.append([x, y, z, h, r, trunk, *tr[6:]])
    rec["trees"] = trees
    return counts


def main():
    tiles = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "public" / "data" / "tiles"
    total = {}
    world_path = tiles.parent / "world.json"
    world = json.loads(world_path.read_text())
    manifest = {m["id"]: m for m in world["tiles"]}
    for path in sorted(tiles.glob("*.json")):
        rec = json.loads(path.read_text())
        for k, v in settle(rec).items():
            total[k] = total.get(k, 0) + v
        text = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        path.write_text(text)
        m = manifest.get(path.stem)
        if m:
            m["trees"], m["bytes"] = len(rec["trees"]), len(text)
    world_path.write_text(json.dumps(world, indent=1))
    print(", ".join(f"{k} : {v}" for k, v in total.items()))


if __name__ == "__main__":
    main()
