"""Bâtiments absents de BD TOPO, mesurés au LiDAR (D145) : l'aile nord-ouest de la galerie marchande de Bellevue (Centrakor).

Usage : python3 tools/data/build_extras.py     (après build_tiles.py ; avant build_carts.py, build_stores.py et build_shop_fronts.py)
Entrées : `extra` de tools/data/manual.json (identifiant -> contour direct, hauteur du toit au-dessus du sol, photo), world.json, tiles/*.json.
Sortie : le bâtiment et sa fiche dans la tuile qui contient son centre (tiles/<tuile>.json), et le compte de bâtiments de cette tuile dans world.json.
          Le type (`kinds` de manual.json) vient de build_carts.py, le plan du toit mesuré de build_stores.py. Une deuxième passe ne change rien ;
          une régénération des tuiles (build_tiles.py) retire ces bâtiments : relancer cette étape.

L'aile (Centrakor) existe au LiDAR et sur Google Maps mais ni dans BD TOPO ni dans OpenStreetMap, ni sur l'orthophotographie (antérieure).
"""

import json
import math

from shapely.geometry import Polygon

import config as c


def main():
    manual = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text()).get("extra", {})
    world = json.loads((c.OUT / "world.json").read_text())
    gx, gy = world["gridOrigin"]
    size = world["tileSize"]
    meta = {m["id"]: m for m in world["tiles"]}
    changed_world = False
    written = 0
    for bid, spec in manual.items():
        ring = spec["ring"]
        poly = Polygon([(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)])
        tid = f"{math.floor((poly.centroid.x - gx) / size)}_{math.floor((poly.centroid.y - gy) / size)}"
        if tid not in meta:
            print(f"  {bid} : tuile {tid} hors du monde")
            continue
        path = c.OUT / "tiles" / f"{tid}.json"
        text = path.read_text()
        tile = json.loads(text)
        n = len(ring) // 2
        # Sol : médiane du MNT LiDAR aux sommets (`ground` de manual.json).
        ground = spec["ground"]
        top = round(ground + spec["height"], 2)
        building = {
            "id": bid, "rnb": None,
            "bd": {"levels": None, "height": spec["height"], "walls": None, "roof": None, "year": None, "use": "Commercial et services", "use2": None, "nature": "Industriel, agricole ou commercial"},
            "ground": ground, "roofColor": "#7e8e9c", "q": {"n": 0, "planes": 1}, "steps": [], "chim": [], "ring": ring, "top": [top] * n, "holes": [], "holeTop": [],
            "faces": [{"p": [0.0, 0.0, top], "r": ring + ring[:2], "h": []}], "roofKind": "flat", "eave": top, "ridge": top,
        }
        walls = []
        for i in range(n):
            j = (i + 1) % n
            walls.append({"a": i, "b": j, "role": "street" if i == spec.get("front", 0) else "party",
                          "length": round(math.hypot(ring[2 * j] - ring[2 * i], ring[2 * j + 1] - ring[2 * i + 1]), 2), "eave": top, "gable": False, "datum": ground})
        fiche = {
            "id": bid, "status": "estimated", "confidence": 0.5,
            "sources": [{"kind": "lidar", "ref": "manual:extra"}, {"kind": "typology", "ref": "contemporary"}],
            "address": None, "monument": None, "era": "contemporary", "year": None, "levels": 1, "storeys": {"ground": spec["height"], "upper": 0.0},
            "materials": {"wall": {"kind": "plaster", "color": "#e6e0d0"}, "roof": "ardoise"},
            "facade": {"bayWidth": 4.4, "window": {"style": "picture", "width": 1.5, "height": 1.3, "surround": "none", "sill": False, "lintel": "none", "frameColor": "#3d3d3b"},
                       "shutters": {"kind": "roulant", "color": "#6b4a35"}, "balcony": "none", "balconyLevel": 1, "stringCourse": False, "corners": "none",
                       "cornice": {"kind": "none", "height": 0.0, "projection": 0.1}, "plinth": {"height": 0.11, "color": "#a8a193"}},
            "ground": {"kind": "shop", "door": {"style": "glazed", "color": "#3d3a36"}, "shopfront": {"color": "#27374d", "glazing": "full"}, "front": spec.get("front", 0)},
            "walls": walls,
        }
        bi = next((k for k, b in enumerate(tile["buildings"]) if b["id"] == bid), None)
        if bi is None:
            tile["buildings"].append(building)
            tile["fiches"].append(fiche)
        else:
            tile["buildings"][bi] = building
            tile["fiches"][bi] = fiche
        new = json.dumps(tile, ensure_ascii=False, separators=(",", ":"))
        if new != text:
            path.write_text(new)
            written += 1
        count = len(tile["buildings"])
        if meta[tid]["buildings"] != count or meta[tid]["bytes"] != len(new.encode()):
            meta[tid]["buildings"] = count
            meta[tid]["bytes"] = len(new.encode())
            changed_world = True
        print(f"  {bid} : tuile {tid}, {poly.area:.0f} m², toit à {spec['height']} m")
    if changed_world:
        (c.OUT / "world.json").write_text(json.dumps(world, ensure_ascii=False, indent=1))
    print(f"{len(manual)} bâtiments ajoutés d'après le LiDAR ; {written} tuiles réécrites")


if __name__ == "__main__":
    main()
