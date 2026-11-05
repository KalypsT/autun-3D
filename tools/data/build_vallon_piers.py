"""Le plan d'eau du Vallon, lot 3 (D246, plan `docs/plans/vallon-lac.md`, §5 et §15) : les pontons, la cale et les bateaux posés.

Usage : python3 tools/data/build_vallon_piers.py
D'après `vallonPiers` de `manual.json` (tracés et positions relevés sur l'orthophotographie à 10 cm et les photos) et le relief publié :
- pontons : tabliers piétons (`decks` des ouvrages, `k: "foot"`, style `pier` : planches grises, sans garde-corps), à `h` m au-dessus du lac
  (0,3 flottant, 0,35 à 0,45 sur pieux : le LiDAR ne voit pas l'eau, hauteurs prises sur les photos). Un ponton accroché à la rive
  (`shore`) part de son premier point, posé sur la berge (à 3 cm au-dessus du relief), et rejoint sa hauteur sur `RAMP` m (passerelle) ;
  flotteurs (`fl`) ou pieux (`pl`, tous les PILE_STEP m) là où il y a de l'eau dessous ; identifiants −(DECK_ID + n), retirés puis reposés ;
- abris sur poteaux (`shelters` des ouvrages) : toit plat à `h` m au-dessus du lac ;
- bateaux (`boats` des ouvrages) : posés sur le quai (quille sur le relief) ou amarrés (`moored` : quille sous la surface) ;
- sols : la cale (couche `slipway`, béton clair), posée sur le relief mesuré (rampe de 0,15 à 0,18 au LiDAR, non retaillée), et le quai de la
  darse (couche `quay`, enrobé).
Cette étape est seule propriétaire de ces identifiants, de `boats`, de `shelters` et des couches `slipway` et `quay` : une deuxième passe ne change rien.
`bytes` des tuiles réécrites est mis à jour dans world.json.

Ordre : après build_water.py (relief creusé), avant build_vallon_path.py (le chemin s'arrête aux tabliers) et build_map.py --images.
"""

import json
import math

from shapely.geometry import LineString, Point, Polygon, box

import config as c
from survey_water import Relief

MANUAL = c.ROOT / "tools" / "data" / "manual.json"
LAKE_Z = -25.41
DECK_ID = 872_000_000
# Longueur de la passerelle qui mène de la berge à la hauteur du ponton (m).
RAMP = 2.0
# Écart des pieux le long d'un ponton fixe (m) ; un pieu ou un flotteur seulement là où le relief est à plus de UNDER m sous le tablier.
PILE_STEP = 2.5
UNDER = 0.3
# Couches de sol dont l'étape est seule propriétaire : la cale (béton clair) et le quai de la darse (enrobé).
GROUND = ("slipway", "quay")


def r2(v):
    return round(v, 2)


def tile_of(world, x, y):
    for m in world["tiles"]:
        x0, y0, x1, y1 = m["bounds"]
        if x0 <= x < x1 and y0 <= y < y1:
            return m["id"]
    return None


def pier_deck(spec, n, relief):
    """Tablier d'un ponton : axe x, y, z (passerelle depuis la berge comprise), flotteurs ou pieux."""
    pts = list(zip(spec["p"][::2], spec["p"][1::2]))
    zd = LAKE_Z + spec["h"]
    line = LineString(pts)
    L = line.length
    stations = [(0.0, pts[0])]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        acc += math.dist(a, b)
        stations.append((acc, b))
    out = []
    if spec.get("shore"):
        z0 = relief.at(*pts[0]) + 0.03
        out.append((pts[0], z0))
        if abs(z0 - zd) > 0.05 and RAMP < stations[1][0]:
            q = line.interpolate(RAMP)
            out.append(((q.x, q.y), zd))
        out += [(p, zd) for s, p in stations[1:]]
    else:
        out = [(p, zd) for _, p in stations]
    deck = {"id": -(DECK_ID + n), "k": "foot", "w": spec["w"], "p": [v for (x, y), z in out for v in (r2(x), r2(y), r2(z))],
            "st": "pier", "sp": [], "pc": [], "n": spec["name"]}
    wet = [s for s in [i * 0.5 for i in range(int(L / 0.5) + 1)] if relief.at(*line.interpolate(s).coords[0]) < zd - UNDER]
    if spec.get("float"):
        deck["fl"] = 1
    else:
        piles = []
        s = 0.4
        while s <= L - 0.3:
            if any(abs(s - w) < 0.26 for w in wet):
                piles.append(r2(s))
            s += PILE_STEP
        if L - 0.3 not in piles and any(abs(L - 0.3 - w) < 0.6 for w in wet):
            piles.append(r2(L - 0.3))
        deck["pl"] = piles
    return deck, L, len(wet) * 0.5


def main():
    manual = json.loads(MANUAL.read_text())
    spec = manual["vallonPiers"]
    world = json.loads((c.OUT / "world.json").read_text())
    relief = Relief()

    decks_by_tile, boats_by_tile, shelters_by_tile = {}, {}, {}
    report = []
    for n, p in enumerate(spec["piers"], start=1):
        deck, L, wet = pier_deck(p, n, relief)
        q = deck["p"]
        line = LineString([(q[i], q[i + 1]) for i in range(0, len(q), 3)])
        tids = {m["id"] for m in world["tiles"] if line.intersects(box(*m["bounds"]))}
        for tid in tids:
            decks_by_tile.setdefault(tid, []).append(deck)
        report.append(f"  {p['name']} : {L:.1f} m, {p['w']} m de large, {'flottant' if p.get('float') else 'sur pieux'} à {p['h']} m, "
                      f"{wet:.0f} m au-dessus de l'eau{'' if p.get('float') else f', {len(deck['pl'])} pieux'} ({', '.join(sorted(tids))})")

    for s in spec["shelters"]:
        x, y = s["c"]
        tid = tile_of(world, x, y)
        shelters_by_tile.setdefault(tid, []).append({"x": x, "y": y, "a": r2(math.radians(s["a"])), "hl": s["l"] / 2, "hw": s["w"] / 2,
                                                     "z": r2(LAKE_Z + s["h"]), "n": s["name"]})

    low = []
    for b in spec["boats"]:
        x, y = b["x"], b["y"]
        tid = tile_of(world, x, y)
        g = relief.at(x, y)
        if b.get("moored"):
            z = LAKE_Z - 0.18
            if g > LAKE_Z - 0.6:
                low.append(f"amarré sur un fond trop haut : ({x}, {y})")
        else:
            z = max(g, LAKE_Z) + 0.02
            if g < LAKE_Z - 0.1:
                low.append(f"posé dans l'eau : ({x}, {y})")
        rec = {"x": x, "y": y, "a": r2(math.radians(b["a"])), "l": b["l"], "w": b["w"], "k": b["k"], "c": b["c"], "z": r2(z)}
        if b.get("mast"):
            rec["m"] = 1
        boats_by_tile.setdefault(tid, []).append(rec)
    if low:
        raise SystemExit("bateaux mal placés : " + " ; ".join(low))

    # Sols de l'étape (cale, quai) : polygone -> tuile qui contient son point représentatif.
    owned = {}
    for layer, rings in spec["ground"].items():
        for r in rings:
            g = Polygon(list(zip(r[::2], r[1::2])))
            owned.setdefault(tile_of(world, *g.representative_point().coords[0]), {}).setdefault(layer, []).append(g)
    slip_poly = next(g for t in owned.values() for g in t.get("slipway", []))

    # Ouvrages : tabliers de cette étape retirés puis reposés ; bateaux et abris réécrits.
    changed_st = []
    for m in world["tiles"]:
        tid = m["id"]
        sp = c.OUT / "structures" / f"{tid}.json"
        if not sp.exists():
            if tid in decks_by_tile or tid in boats_by_tile or tid in shelters_by_tile:
                raise SystemExit(f"{tid} : pontons sans fichier d'ouvrages")
            continue
        text = sp.read_text()
        mine = tid in decks_by_tile or tid in boats_by_tile or tid in shelters_by_tile
        if not mine and f'"id":-{DECK_ID // 1_000_000}' not in text and '"boats"' not in text and '"shelters"' not in text:
            continue
        st = json.loads(text)
        st["decks"] = [d for d in st["decks"] if not (-DECK_ID - 999_999 <= d["id"] <= -DECK_ID)] + decks_by_tile.get(tid, [])
        for key, by in (("boats", boats_by_tile), ("shelters", shelters_by_tile)):
            if tid in by:
                st[key] = by[tid]
            else:
                st.pop(key, None)
        new = json.dumps(st, ensure_ascii=False, separators=(",", ":"))
        if new != text:
            sp.write_text(new)
            changed_st.append(tid)

    # Sols : couches de l'étape réécrites (retirées des tuiles qui n'en ont plus).
    changed = []
    for m in world["tiles"]:
        tid = m["id"]
        tp = c.OUT / "tiles" / f"{tid}.json"
        if not tp.exists():
            continue
        text = tp.read_text()
        if tid not in owned and not any(f'"{k}"' in text for k in GROUND):
            continue
        t = json.loads(text)
        for k in GROUND:
            gs = owned.get(tid, {}).get(k)
            if gs:
                t["ground"][k] = [[[r2(v) for q in list(g.exterior.coords)[:-1] for v in q]] for g in gs]
            else:
                t["ground"].pop(k, None)
        new = json.dumps(t, separators=(",", ":"), ensure_ascii=False)
        if new != text:
            tp.write_text(new)
            changed.append(tid)
            m["bytes"] = len(new.encode())
    if changed:
        (c.OUT / "world.json").write_text(json.dumps(world, indent=1))

    zs = [relief.at(*q) - LAKE_Z for q in slip_poly.exterior.coords]
    print(f"{len(spec['piers'])} pontons :")
    print("\n".join(report))
    print(f"{len(spec['shelters'])} abri(s) ; {len(spec['boats'])} bateaux ({sum(1 for b in spec['boats'] if b.get('moored'))} amarrés) ; "
          f"cale de {slip_poly.area:.0f} m², relief de {min(zs):+.2f} à {max(zs):+.2f} m sur le lac ; quai de {sum(g.area for t in owned.values() for g in t.get('quay', [])):.0f} m²")
    print(f"ouvrages réécrits : {changed_st or 'aucun'} ; tuiles réécrites : {changed or 'aucune'}")


if __name__ == "__main__":
    main()
