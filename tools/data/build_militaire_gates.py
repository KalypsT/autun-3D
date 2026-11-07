"""Entrées du Lycée militaire (D260, lot 3 de docs/plans/lycee-militaire.md) : grille sur muret et grand portail de l'avenue du 2e Dragons,
entrée ouverte de la rue Gaston Joliet, bâtiment blanc de l'entrée.

Usage : python3 tools/data/build_militaire_gates.py      (après build_tiles.py et build_school_gate.py ; avant build_nav.py)
Entrée : `militaireGates` de tools/data/manual.json, tiles/<tuile>.json.
Sortie : - chaque tracé de `cuts` est coupé au sommet `at` (retiré) : la première partie finit au point `A` (s'il est donné), la seconde
           (identifiant `second`) commence au point `B` ; nature et hauteur imposées (`kind`, `height`) ; un muret (`muret` : identifiants des
           deux murets, hauteur) suit chaque partie ;
         - chaque fiche de `fiches` reçoit ses réglages (enduit, époque, rez-de-chaussée sans vitrine) et passe à « observed » (D262 : les
           bâtiments modernes de l'enceinte, classés « commerce et services » par BD TOPO, n'ont pas de vitrine).
- `closures` : courts tracés ajoutés pour fermer l'enceinte (D263) ;
         - `ringMoves` : sommets du contour BD TOPO déplacés (D264 : la face nord-est du Lycée militaire passe 2 à 3 m sous le toit relevé au LiDAR).
Idempotent : un tracé déjà coupé (le second existe) est laissé tel quel ; `bytes` et `walls` de world.json sont mis à jour.
"""

import json

import config as c


def cut(walls, spec):
    w = next(x for x in walls if x["id"] == spec["wall"])
    changed = False
    if not any(x["id"] == spec["second"] for x in walls):
        pts = [(w["pts"][i], w["pts"][i + 1]) for i in range(0, len(w["pts"]), 2)]
        at = spec["at"]
        first = pts[:at] + ([tuple(spec["A"])] if spec.get("A") else [])
        second = ([tuple(spec["B"])] if spec.get("B") else []) + pts[at + 1:]
        flat = lambda p: [round(v, 2) for q in p for v in q]
        w["pts"] = flat(first)
        walls.append({**w, "id": spec["second"], "pts": flat(second)})
        changed = True
        print(f"  {spec['wall']} coupé : {len(first)} et {len(second)} sommets")
    for x in walls:
        if x["id"] in (spec["wall"], spec["second"]):
            for key in ("kind", "height"):
                if key in spec and x[key] != spec[key]:
                    x[key] = spec[key]
                    changed = True
    if "muret" in spec:
        ids, h = spec["muret"]
        for src, mid in zip((spec["wall"], spec["second"]), ids):
            part = next(x for x in walls if x["id"] == src)
            mur = {**part, "id": mid, "kind": "wall", "height": h, "measured": h}
            old = next((x for x in walls if x["id"] == mid), None)
            if old != mur:
                if old:
                    walls.remove(old)
                walls.append(mur)
                changed = True
    return changed


def fiche(tile, spec):
    fi = next(f for f in tile["fiches"] if f["id"] == spec["id"])
    before = json.dumps(fi, sort_keys=True)
    if "wall" in spec:
        fi["materials"]["wall"]["color"] = spec["wall"]
    if "era" in spec:
        fi["era"] = spec["era"]
    fi["ground"] = {**spec["ground"], **({"front": fi["ground"]["front"]} if "front" in fi["ground"] and "front" not in spec["ground"] else {})}
    fi["status"] = "observed"
    fi["sources"] = [q for q in fi["sources"] if q["kind"] != "photo"] + [{"kind": "photo", "ref": spec["photo"][:80]}]
    return json.dumps(fi, sort_keys=True) != before


def main():
    spec = json.loads((c.ROOT / "tools" / "data" / "manual.json").read_text())["militaireGates"]
    tiles = {}
    changed = set()
    for s in spec["cuts"]:
        tile = tiles.setdefault(s["tile"], json.loads((c.OUT / "tiles" / f"{s['tile']}.json").read_text()))
        if cut(tile["walls"], s):
            changed.add(s["tile"])
    # Contour recalé au LiDAR (D264) : sommets déplacés (ancien -> nouveau), là où le mur BD TOPO passe sous le toit mesuré.
    for rm in spec.get("ringMoves", []):
        tile = tiles.setdefault(rm["tile"], json.loads((c.OUT / "tiles" / f"{rm['tile']}.json").read_text()))
        b = next(x for x in tile["buildings"] if x["id"] == rm["id"])
        r = b["ring"]
        for (ox, oy), (nx, ny) in rm["moves"]:
            for i in range(0, len(r), 2):
                if abs(r[i] - ox) < 0.01 and abs(r[i + 1] - oy) < 0.01:
                    r[i], r[i + 1] = nx, ny
                    changed.add(rm["tile"])
    # Fermetures (D263) : bouts de clôture entre un tracé et le bâtiment voisin, là où l'enceinte laissait passer un piéton.
    for w in spec.get("closures", []):
        tile = tiles.setdefault(w["tile"], json.loads((c.OUT / "tiles" / f"{w['tile']}.json").read_text()))
        wall = {"id": w["id"], "kind": w["kind"], "height": w["height"], "measured": w["height"], "pts": w["pts"]}
        old = next((x for x in tile["walls"] if x["id"] == w["id"]), None)
        if old != wall:
            if old:
                tile["walls"].remove(old)
            tile["walls"].append(wall)
            changed.add(w["tile"])
    for f in spec["fiches"]:
        tile = tiles.setdefault(f["tile"], json.loads((c.OUT / "tiles" / f"{f['tile']}.json").read_text()))
        if fiche(tile, f):
            changed.add(f["tile"])
    if changed:
        world = json.loads((c.OUT / "world.json").read_text())
        for tid in sorted(changed):
            new = json.dumps(tiles[tid], separators=(",", ":"), ensure_ascii=False)
            (c.OUT / "tiles" / f"{tid}.json").write_text(new)
            for m in world["tiles"]:
                if m["id"] == tid:
                    m["bytes"] = len(new.encode())
                    m["walls"] = len(tiles[tid]["walls"])
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))
    print(f"{len(changed)} tuile(s) réécrite(s)" if changed else "rien à faire")


if __name__ == "__main__":
    main()
