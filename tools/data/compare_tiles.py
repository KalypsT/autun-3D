"""Compare des tuiles de deux dossiers de données (public/data et un bac à sable d'extend.py) : contenu, relief fin, sols.

Usage : python3 tools/data/compare_tiles.py DOSSIER_A DOSSIER_B tuile [tuile ...]
Sert à l'essai à blanc d'extend.py (lot 1 de la Croix de la Libération) : refabriquer une tuile depuis les sources doit redonner la tuile
publiée, aux changements des sources près (OpenStreetMap, BD TOPO plus récents).
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def block(path):
    raw = path.read_bytes()
    base, ox, oy, n = np.frombuffer(raw[:16], "<f4")
    z = base + np.frombuffer(raw[16:], "<u2").reshape(int(n), int(n)).astype(np.float64) * 0.01
    return (float(ox), float(oy), int(n)), z


def ids(items):
    return {i.get("id") for i in items if isinstance(i, dict)}


def main():
    a, b = Path(sys.argv[1]), Path(sys.argv[2])
    for t in sys.argv[3:]:
        print(f"== {t}")
        ja, jb = (json.loads((d / "tiles" / f"{t}.json").read_text()) for d in (a, b))
        for key in ("buildings", "fiches", "walls", "furniture", "stairs"):
            ia, ib = ids(ja.get(key, [])), ids(jb.get(key, []))
            print(f"  {key:9} {len(ja.get(key, [])):5} → {len(jb.get(key, [])):5} ; communs {len(ia & ib)}, seulement A {len(ia - ib)}, seulement B {len(ib - ia)}")
        ta, tb = ja["trees"], jb["trees"]
        pa = {(round(x[0], 1), round(x[1], 1)) for x in ta}
        pb = {(round(x[0], 1), round(x[1], 1)) for x in tb}
        print(f"  arbres    {len(ta):5} → {len(tb):5} ; mêmes positions {len(pa & pb)}")
        ga, gb = ja["ground"], jb["ground"]
        for k in sorted(set(ga) | set(gb)):
            same = json.dumps(ga.get(k)) == json.dumps(gb.get(k))
            print(f"  sol {k:20} {len(ga.get(k, [])):3} → {len(gb.get(k, [])):3} {'identique' if same else 'différent'}")
        (oa, za), (ob, zb) = block(a / "terrain" / f"{t}.bin"), block(b / "terrain" / f"{t}.bin")
        if oa == ob:
            d = zb - za
            print(f"  relief : même grille ; écart médian {np.median(np.abs(d)) * 100:.1f} cm, 99ᵉ centile {np.percentile(np.abs(d), 99) * 100:.1f} cm, "
                  f"max {np.abs(d).max():.2f} m ; identique : {np.array_equal(za, zb)}")
        else:
            print(f"  relief : grilles différentes {oa} / {ob}")
        for part in "ab":
            ia_, ib_ = (np.asarray(Image.open(d / "ground" / f"{t}_{part}.png").convert("RGB")).astype(int) for d in (a, b))
            print(f"  sols fins {part} : pixels différents {np.any(ia_ != ib_, axis=-1).mean() * 100:.1f} %")


if __name__ == "__main__":
    main()
