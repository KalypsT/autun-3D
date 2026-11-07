"""Agrandir la carte sans refabriquer la ville (docs/plans/croix-liberation.md, lot 1).

Une extension ajoute des tuiles jouables (`tools/data/extensions/<nom>.json`). La côte se déplace ; or `build_coast.py` est destructif
(il abaisse le relief et retire arbres, bâtiments et mobilier en mer) : toute tuile existante dont le rivage change doit être refabriquée
depuis les sources, avec les tuiles neuves. Le reste de la ville ne doit pas bouger d'un octet : une régénération complète, avec un extrait
OpenStreetMap plus récent, changerait la circulation et les passants partout (D153).

La méthode : **fabriquer à côté, greffer seulement ce qui change**.
  plan      calcule la nouvelle région, la côte avant et après, et les tuiles à refabriquer (là où le plafond du rivage change),
            plus un anneau de tuiles de contexte ; écrit .cache/extend/<nom>/ (plan.json, region.json, tiles.json, scope.json).
  sandbox   copie public/data dans .cache/extend/<nom>/out, en ne gardant dans world.json que les tuiles de l'emprise (refabriquées
            et contexte) ; relève l'empreinte de chaque fichier publié (before.json).
  build     dans le bac à sable : blocs restreints aux tuiles à refabriquer (AUTUN_TILES), puis les étapes globales demandées,
            sur l'emprise seulement (AUTUN_SCOPE), avec la nouvelle région (AUTUN_REGION).
  graft     greffe sur la cible (public/data, ou --target DOSSIER) les fichiers des tuiles refabriquées et, dans les fichiers partagés,
            leur part seulement : world.json (tuiles, côte, emprise, relief grossier), terrain/coarse.bin (cellules sous ces tuiles),
            super-tuiles de sol (pixels sous ces tuiles), index des types et des ouvrages, eau.
  check     compare la cible à l'empreinte d'avant : tout fichier changé hors des tuiles refabriquées et des fichiers partagés attendus
            est signalé (et la commande échoue).

Usage : python3 tools/data/extend.py plan|sandbox|build|graft|check <nom> [options]
  build : [--steps structures,kinds,public_space,coast] [--skip-blocks]
  graft, check : [--target DOSSIER] (défaut public/data)
La navigation (greffe des voies sur le graphe existant) et la carte sont traitées à part (lot 2).
"""

import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import Point

import config as c

HERE = Path(__file__).parent
EXT_DIR = HERE / "extensions"
PUBLISHED = c.ROOT / "public" / "data"
# Distance à la côte (m) en deçà de laquelle le plafond du rivage peut couper le sol : la falaise monte de 3 m par mètre après 35 m
# de plage ; à 150 m, le plafond est à plus de 340 m au-dessus de la mer, au-dessus de tout sommet de la région (≈ 320 m).
CAP_REACH = 150.0
SAMPLE = 4.0  # pas (m) de l'échantillonnage du changement de rivage
# Étapes globales qu'un bac à sable sait relancer, dans l'ordre de la chaîne (README).
GLOBAL_STEPS = {"structures": "build_structures.py", "kinds": "build_kinds.py", "public_space": "build_public_space.py",
                "coast": "build_coast.py", "water": "build_water.py"}
# Fichiers par tuile : (dossier, suffixes).
PER_TILE = (("tiles", (".json",)), ("terrain", (".bin",)), ("ground", ("_a.png", "_b.png")), ("lod", (".json",)),
            ("kinds", (".json",)), ("structures", (".json",)))


def work(name):
    return c.ROOT / ".cache" / "extend" / name


def tid(t):
    return f"{t[0]}_{t[1]}"


def parse(s):
    return tuple(int(v) for v in s.split("_"))


def ring(tiles):
    return {(a + i, b + j) for a, b in tiles for i in (-1, 0, 1) for j in (-1, 0, 1)}


# --- Côte avant et après -----------------------------------------------------------------------------------------------------
def sd_of(poly, anchor):
    """Fonction distance signée (m, positive en mer) d'une terre, sur la grille ancrée (coast_lib.distance_field)."""
    import coast_lib as k
    from scipy import ndimage

    x0, y1, field = k.distance_field(poly, anchor)

    def sd(xx, yy):
        cc = (np.asarray(xx) - x0) / k.DIST_RES - 0.5
        rr = (y1 - np.asarray(yy)) / k.DIST_RES - 0.5
        d = ndimage.map_coordinates(field, [rr.ravel(), cc.ravel()], order=1, mode="nearest").reshape(np.shape(xx))
        out = (cc < 0) | (rr < 0) | (cc > field.shape[1] - 1) | (rr > field.shape[0] - 1)
        return np.where(out, k.DIST_PAD, d)
    return sd


def grown_land(old, playable2, region2, add):
    """La terre après l'extension : l'ancienne, plus celle que donne la nouvelle région autour des tuiles ajoutées seulement
    (dans l'anneau d'une tuile autour d'elles), raccordée par une fermeture morphologique locale (petits crans au raccord)."""
    import coast_lib as k
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union

    near = unary_union([box(*c.tile_bounds_local(*t)) for t in ring(add)])
    fresh = k.compute_land(playable2, region2)
    grown = unary_union([old, fresh.intersection(near)])
    closed = grown.buffer(12.0, join_style="round").buffer(-12.0, join_style="round")
    grown = unary_union([grown, closed.intersection(near.buffer(60.0))])
    grown = max(getattr(grown, "geoms", [grown]), key=lambda g: g.area)
    return Polygon(grown.exterior)


# --- plan --------------------------------------------------------------------------------------------------------------------
def plan(name):
    spec = json.loads((EXT_DIR / f"{name}.json").read_text())
    region = json.loads(c.REGION_FILE.read_text())
    play = {parse(s) for s in region["playable"]}
    border = {parse(s) for s in region["border"]}
    keep = {parse(s) for s in region["keep"]}
    add = {parse(s) for s in spec.get("playable", [])}
    force = {parse(s) for s in spec.get("rebuild", [])}  # tuiles à refabriquer quoi qu'il arrive (essai à blanc)
    play2 = play | add
    border2 = (border | ring(play2)) - play2
    world = json.loads((PUBLISHED / "world.json").read_text())
    existing = {(t["col"], t["row"]) for t in world["tiles"]}

    import coast_lib as k

    land1 = k.land()
    anchor = json.loads(k.LAND_FILE.read_text())["anchor"] if k.LAND_FILE.exists() else list(k.field_anchor(land1))
    land2 = grown_land(land1, play2, play2 | border2, add) if add else land1
    sd1, sd2 = sd_of(land1, anchor), sd_of(land2, anchor)
    # Là où le plafond du rivage change : distance signée différente, près d'une côte (avant ou après).
    changed = set()
    if add:
        x0, y0, x1, y1 = (min(c.tile_bounds_local(*t)[i] for t in add) if i < 2 else max(c.tile_bounds_local(*t)[i] for t in add) for i in range(4))
        x0, y0, x1, y1 = x0 - 500, y0 - 500, x1 + 500, y1 + 500
        xx, yy = np.meshgrid(np.arange(x0, x1, SAMPLE) + SAMPLE / 2, np.arange(y0, y1, SAMPLE) + SAMPLE / 2)
        a, b = sd1(xx, yy), sd2(xx, yy)
        m = (np.abs(a - b) > 0.25) & (np.minimum(-a, -b) < CAP_REACH)
        changed = {(math.floor((x - c.GRID_X) / c.TILE), math.floor((y - c.GRID_Y) / c.TILE)) for x, y in zip(xx[m], yy[m])}
    region_tiles2 = play2 | border2
    rebuild = sorted(((changed & region_tiles2) | (add - existing) | (border2 - border - existing) | add | force) & region_tiles2)
    rebuilt_existing = sorted(set(rebuild) & existing)
    scope = sorted((ring(rebuild) & (existing | set(rebuild))))
    blocks = sorted({c.block_of_tile(*t) for t in rebuild})

    out = work(name)
    out.mkdir(parents=True, exist_ok=True)
    region2 = {**region, "playable": sorted(tid(t) for t in play2), "border": sorted(tid(t) for t in border2),
               "keep": sorted(tid(t) for t in keep - set(rebuild))}
    order = lambda ids: sorted(ids, key=lambda s: (parse(s)[1], parse(s)[0]))
    region2 = {k: (order(v) if k in ("playable", "border", "keep") else v) for k, v in region2.items()}
    (out / "region.json").write_text(json.dumps(region2, ensure_ascii=False, indent=1))
    (out / "land.json").write_text(json.dumps({"_doc": "Terre figée (coast_lib.land, extend.py) : contour, et coin d'origine du champ de distance.",
                                               "anchor": anchor, "exterior": [list(p) for p in land2.exterior.coords]}))
    (out / "tiles.json").write_text(json.dumps([tid(t) for t in rebuild]))
    (out / "scope.json").write_text(json.dumps([tid(t) for t in scope]))
    info = {"name": name, "add": sorted(tid(t) for t in add), "newBorder": sorted(tid(t) for t in border2 - border),
            "rebuild": [tid(t) for t in rebuild], "rebuiltExisting": [tid(t) for t in rebuilt_existing],
            "scope": [tid(t) for t in scope], "blocks": [list(b) for b in blocks],
            "land": [round(land1.area / 1e6, 3), round(land2.area / 1e6, 3)]}
    (out / "plan.json").write_text(json.dumps(info, indent=1))
    print(f"extension « {name} » : {len(add)} tuiles jouables ajoutées, {len(border2 - border)} de bordure ajoutées")
    print(f"  terre : {land1.area / 1e6:.2f} → {land2.area / 1e6:.2f} km²")
    print(f"  tuiles où le rivage change : {len(changed)} ; à refabriquer : {len(rebuild)}, dont {len(rebuilt_existing)} déjà publiées :")
    print("    " + " ".join(tid(t) for t in rebuilt_existing))
    print(f"  neuves : {' '.join(tid(t) for t in rebuild if t not in existing)}")
    print(f"  emprise (avec l'anneau de contexte) : {len(scope)} tuiles ; blocs : {blocks}")
    far = [p for p in land1.exterior.coords if land2.exterior.distance(Point(p)) > 1e-6]
    print(f"  sommets de l'ancienne côte déplacés : {len(far)} sur {len(land1.exterior.coords)}")
    print(f"  écrit {out}/plan.json, region.json, land.json, tiles.json, scope.json")


# --- Empreintes --------------------------------------------------------------------------------------------------------------
def fingerprint(root):
    root = Path(root)
    return {str(p.relative_to(root)): hashlib.sha1(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file()}


# --- sandbox -----------------------------------------------------------------------------------------------------------------
def sandbox(name):
    w = work(name)
    info = json.loads((w / "plan.json").read_text())
    box = w / "out"
    if box.exists():
        shutil.rmtree(box)
    shutil.copytree(PUBLISHED, box)
    scope = set(info["scope"])
    world = json.loads((box / "world.json").read_text())
    world["tiles"] = [t for t in world["tiles"] if t["id"] in scope]
    (box / "world.json").write_text(json.dumps(world, indent=1))
    shutil.copyfile(HERE / "measured_widths.json", w / "measured_widths.json")  # lu et réécrit dans le bac à sable (streets_lib)
    (w / "before.json").write_text(json.dumps(fingerprint(PUBLISHED)))
    print(f"bac à sable {box} : {len(world['tiles'])} tuiles publiées dans l'emprise ; empreinte de public/data relevée (before.json)")


def env_for(name):
    w = work(name)
    return {**os.environ, "AUTUN_OUT": str(w / "out"), "AUTUN_REGION": str(w / "region.json"),
            "AUTUN_TILES": str(w / "tiles.json"), "AUTUN_SCOPE": str(w / "scope.json")}


def build(name, steps, skip_blocks):
    w = work(name)
    info = json.loads((w / "plan.json").read_text())
    env = env_for(name)
    if not skip_blocks:
        args = [f"{bi},{bj}" for bi, bj in info["blocks"]]
        print(f"== blocs restreints {args} (tuiles {' '.join(info['rebuild'])})", flush=True)
        subprocess.run([sys.executable, str(HERE / "build_all.py"), *args], check=True, cwd=HERE, env=env)
    # Les étapes globales parcourent les tuiles de world.json (l'emprise, dans le bac à sable) : AUTUN_TILES ne les concerne pas
    # (et config.py le refuserait pour le bloc par défaut, qui ne contient aucune des tuiles listées).
    genv = {k: v for k, v in env.items() if k != "AUTUN_TILES"}
    for s in steps:
        print(f"\n== {GLOBAL_STEPS[s]} (bac à sable, emprise de {len(info['scope'])} tuiles)", flush=True)
        subprocess.run([sys.executable, str(HERE / GLOBAL_STEPS[s])], check=True, cwd=HERE, env=genv)


# --- graft -------------------------------------------------------------------------------------------------------------------
def tile_mask(ids, xx, yy):
    m = np.zeros(np.shape(xx), bool)
    for s in ids:
        x0, y0, x1, y1 = c.tile_bounds_local(*parse(s))
        m |= (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
    return m


def read_coarse(root, meta):
    raw = np.frombuffer((root / "terrain" / "coarse.bin").read_bytes(), dtype="<u2").reshape(meta["rows"], meta["cols"])
    return meta["base"] + raw.astype(np.float64) * meta["unit"]


def graft(name, target):
    from PIL import Image

    w = work(name)
    info = json.loads((w / "plan.json").read_text())
    box = w / "out"
    ids = set(info["rebuild"])
    target = Path(target)
    copied = removed = 0
    # Fichiers par tuile : copiés depuis le bac à sable ; absents du bac à sable (tuile sans silhouette, sans type…) : retirés.
    for folder, suffixes in PER_TILE:
        for s in ids:
            for suf in suffixes:
                src, dst = box / folder / f"{s}{suf}", target / folder / f"{s}{suf}"
                if src.exists():
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(src, dst)
                    copied += 1
                elif dst.exists():
                    dst.unlink()
                    removed += 1

    # world.json : tuiles, côte, emprise, relief grossier, super-tuiles.
    wt, ws = json.loads((target / "world.json").read_text()), json.loads((box / "world.json").read_text())
    fresh = {t["id"]: t for t in ws["tiles"] if t["id"] in ids}
    missing = ids - set(fresh)
    if missing:
        raise SystemExit(f"tuiles absentes du bac à sable : {sorted(missing)}")
    wt["tiles"] = sorted([t for t in wt["tiles"] if t["id"] not in ids] + list(fresh.values()), key=lambda t: (t["row"], t["col"]))
    wt["zone"] = [min(t["bounds"][0] for t in wt["tiles"]), min(t["bounds"][1] for t in wt["tiles"]),
                  max(t["bounds"][2] for t in wt["tiles"]), max(t["bounds"][3] for t in wt["tiles"])]
    wt["sea"] = ws["sea"]
    # Relief grossier : la grille du bac à sable (qui contient l'ancienne) ; ses valeurs sous les tuiles refabriquées et hors de
    # l'ancienne grille, celles de la cible ailleurs.
    mt, ms = wt["coarse"], ws["coarse"]
    zt, zs = read_coarse(target, mt), read_coarse(box, ms)
    res = ms["res"]
    xs = ms["x0"] + (np.arange(ms["cols"]) + 0.5) * res
    ys = ms["y1"] - (np.arange(ms["rows"]) + 0.5) * res
    xx, yy = np.meshgrid(xs, ys)
    ci = np.floor((xx - mt["x0"]) / res).astype(int)
    ri = np.floor((mt["y1"] - yy) / res).astype(int)
    inside_old = (ci >= 0) & (ci < mt["cols"]) & (ri >= 0) & (ri < mt["rows"])
    old_vals = np.where(inside_old, zt[np.clip(ri, 0, mt["rows"] - 1), np.clip(ci, 0, mt["cols"] - 1)], np.nan)
    z = np.where(tile_mask(ids, xx, yy) | ~inside_old, zs, old_vals)
    lo = math.floor(float(z.min()))
    (target / "terrain" / "coarse.bin").write_bytes(np.round((z - lo) / ms["unit"]).astype("<u2").tobytes())
    wt["coarse"] = {**ms, "base": float(lo), "zmin": float(z.min()), "zmax": float(z.max())}
    # Super-tuiles de sol : pixels sous les tuiles refabriquées depuis le bac à sable.
    sup = ws["super"]
    known = {s["id"]: s for s in wt["super"]["cells"]}
    for cell in sup["cells"]:
        x0, y1, r, n = cell["x0"], cell["y1"], sup["res"], sup["size"]
        cx, cy = np.meshgrid(x0 + (np.arange(n) + 0.5) * r, y1 - (np.arange(n) + 0.5) * r)
        m = tile_mask(ids, cx, cy)
        if not m.any():
            continue
        for part in ("a", "b"):
            src, dst = box / "ground" / f"{cell['id']}_{part}.png", target / "ground" / f"{cell['id']}_{part}.png"
            new = np.asarray(Image.open(src).convert("RGB"))
            img = np.where(m[..., None], new, np.asarray(Image.open(dst).convert("RGB"))) if dst.exists() else new
            if not dst.exists() or not np.array_equal(img, np.asarray(Image.open(dst).convert("RGB"))):
                Image.fromarray(img.astype(np.uint8)).save(dst, optimize=True)
        known[cell["id"]] = cell
    wt["super"]["cells"] = sorted(known.values(), key=lambda s: s["id"])
    (target / "world.json").write_text(json.dumps(wt, indent=1))

    # Index des types et des ouvrages : liste des tuiles qui ont un fichier, repères (types). Même ordre et même écriture que
    # build_kinds.py et build_structures.py ; un index inchangé n'est pas réécrit.
    for folder, dump in (("kinds", lambda d: json.dumps(d, ensure_ascii=False, separators=(",", ":"))), ("structures", json.dumps)):
        it = json.loads((target / folder / "index.json").read_text())
        new = json.loads(json.dumps(it))
        have = {s for s in ids if (target / folder / f"{s}.json").exists()}
        new["tiles"] = sorted((set(it["tiles"]) - ids) | have)
        if folder == "kinds":
            isb = json.loads((box / folder / "index.json").read_text())
            mine = [m for m in isb["landmarks"] if m["tile"] in ids]
            kept = [m for m in it["landmarks"] if m["tile"] not in ids]
            new["landmarks"] = it["landmarks"] if kept + mine == it["landmarks"] or sorted(map(json.dumps, kept + mine)) == sorted(map(json.dumps, it["landmarks"])) else kept + mine
        if new != it:
            (target / folder / "index.json").write_text(dump(new))

    # Eau : morceaux dont le premier sommet tombe dans une tuile refabriquée, pris au bac à sable.
    def first_in(p):
        r = p["r"][0]
        return tile_mask(ids, np.array([r[0]]), np.array([r[1]]))[0]
    wa, wb = json.loads((target / "water.json").read_text()), json.loads((box / "water.json").read_text())
    pieces = [p for p in wa["pieces"] if not first_in(p)] + [p for p in wb["pieces"] if first_in(p)]
    if sorted(map(json.dumps, pieces)) != sorted(map(json.dumps, wa["pieces"])):
        wa["pieces"] = pieces
        (target / "water.json").write_text(json.dumps(wa, separators=(",", ":")))
    # Largeurs de chaussée : celles des voies que la ville ne connaissait pas (les voies nouvelles) ; les autres ne changent pas.
    if target == PUBLISHED.resolve() and (w / "measured_widths.json").exists():
        mw = json.loads((HERE / "measured_widths.json").read_text())
        sb = json.loads((w / "measured_widths.json").read_text())["widths"]
        added = {k: v for k, v in sb.items() if k not in mw["widths"]}
        if added:
            mw["widths"] = dict(sorted({**mw["widths"], **added}.items(), key=lambda kv: int(kv[0])))
            (HERE / "measured_widths.json").write_text(json.dumps(mw, indent=0))
        print(f"  largeurs de chaussée : {len(added)} voies nouvelles ajoutées à measured_widths.json")
    print(f"greffe sur {target} : {len(ids)} tuiles, {copied} fichiers copiés, {removed} retirés ; world.json, coarse.bin, super-tuiles, index, eau")


# --- check -------------------------------------------------------------------------------------------------------------------
SHARED_FILES = {"world.json", "terrain/coarse.bin", "kinds/index.json", "structures/index.json", "water.json"}


def check(name, target):
    w = work(name)
    info = json.loads((w / "plan.json").read_text())
    before = json.loads((w / "before.json").read_text())
    after = fingerprint(target)
    ids = set(info["rebuild"])
    allowed = set(SHARED_FILES)
    for folder, suffixes in PER_TILE:
        allowed |= {f"{folder}/{s}{suf}" for s in ids for suf in suffixes}
    world = json.loads((Path(target) / "world.json").read_text())
    sup = world["super"]
    span = sup["size"] * sup["res"]
    for s in sup["cells"]:
        x0, y1 = s["x0"], s["y1"]
        if any(b[0] < x0 + span and b[2] > x0 and b[1] < y1 and b[3] > y1 - span for b in (c.tile_bounds_local(*parse(t)) for t in ids)):
            allowed |= {f"ground/{s['id']}_{p}.png" for p in "ab"}
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    bad = [k for k in changed if k not in allowed]
    print(f"{len(changed)} fichiers changés, ajoutés ou retirés, dont {len(bad)} hors de l'extension")
    for k in changed:
        state = "ajouté" if k not in before else "retiré" if k not in after else "changé"
        print(f"  {'!! ' if k in bad else '   '}{state:7} {k}")
    if bad:
        raise SystemExit("des fichiers hors de l'extension ont changé")


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    cmd, name = sys.argv[1], sys.argv[2]
    opt = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    target = Path(opt("--target", str(PUBLISHED))).resolve()
    if cmd == "plan":
        plan(name)
    elif cmd == "sandbox":
        sandbox(name)
    elif cmd == "build":
        steps = [s for s in opt("--steps", "structures,kinds,public_space,coast").split(",") if s]
        build(name, steps, "--skip-blocks" in sys.argv)
    elif cmd == "graft":
        graft(name, target)
    elif cmd == "check":
        check(name, target)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
