"""Relevés du lot 0 de la Pierre de Couhard (docs/plans/couhard.md, §3) : sommet, sections horizontales, cavité, abords, mesurés sur le
nuage de points LiDAR HD de l'IGN (dalle COPC lue à distance par requêtes partielles : seuls les points d'une fenêtre de 70 m sont téléchargés).

Le classement de l'IGN range la maçonnerie en « sol » (classe 2) : le MNT, donc le relief du jeu, contient la pyramide. Les sections sont
prises sur les classes 1 (non classé), 2 (sol) et 6 (bâti), la végétation (3 à 5) mise à part.

Sortie : un rapport texte (stdout). Points mis en cache dans .cache/couhard/ (hors git). Aucun fichier du jeu n'est modifié.

Usage : python3 tools/data/survey_couhard.py
Repère : local du jeu (x est, y nord, z au-dessus de ORIGIN_Z) ; caps en degrés depuis le nord, sens horaire.
"""

import math

import laspy
import numpy as np
import requests

import config as c

OX, OY = c.ORIGIN
CACHE = c.ROOT / ".cache" / "couhard"
CENTRE0 = (1181.25, -749.0)  # bosse du MNT (première estimation)
HALF = 35.0
WFS = "https://data.geopf.fr/wfs/ows"
PICKUPS = {"fusil d'assaut": (1197.5, -750.1), "fusil de précision": (1193.3, -741.0)}  # src/core/pickups.ts


def points():
    f = CACHE / "points.npz"
    if not f.exists():
        X, Y = OX + CENTRE0[0], OY + CENTRE0[1]
        meta = requests.get(WFS, timeout=120, headers={"User-Agent": c.USER_AGENT}, params={
            "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "IGNF_LIDAR-HD_METADONNEE:metadata",
            "OUTPUTFORMAT": "application/json", "SRSNAME": "EPSG:2154", "COUNT": 5,
            "BBOX": f"{X - 1},{Y - 1},{X + 1},{Y + 1},urn:ogc:def:crs:EPSG::2154"}).json()["features"]
        url = meta[0]["properties"]["url_npl"]
        with laspy.CopcReader.open(url) as r:
            p = r.query(laspy.copc.Bounds(mins=np.array([X - HALF, Y - HALF]), maxs=np.array([X + HALF, Y + HALF])))
        CACHE.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(f, x=np.array(p.x) - OX, y=np.array(p.y) - OY, z=np.array(p.z) - c.ORIGIN_Z, c=np.array(p.classification),
                            src=np.array([url]))
    d = np.load(f)
    return d["x"], d["y"], d["z"], d["c"]


def cap_of(dx, dy):
    return np.degrees(np.arctan2(dx, dy)) % 360


def near(caps, s, half):
    return np.abs(((caps - s + 180) % 360) - 180) < half


def main():
    x, y, z, cl = points()
    print(f"{len(x)} points dans la fenêtre de {2 * HALF:.0f} m ; classes {dict(zip(*map(list, np.unique(cl, return_counts=True))))}")
    stone = (cl <= 2) | (cl == 6)

    # Sol : sol (classe 2) entre 13 et 16 m du centre provisoire (le pied fait au plus 12,8 m de rayon).
    r0 = np.hypot(x - CENTRE0[0], y - CENTRE0[1])
    ring = (cl == 2) & (r0 > 13) & (r0 < 16)
    g = float(np.median(z[ring]))
    # Centre : centroïde des points de maçonnerie entre 9 et 11 m au-dessus du sol (section nette, au-dessus du talus).
    band = stone & (np.abs(z - g - 10) < 1) & (r0 < 10)
    cx, cy = float(np.mean(x[band])), float(np.mean(y[band]))
    top = stone & (np.hypot(x - cx, y - cy) < 4)
    k = int(np.argmax(np.where(top, z, -1e9)))
    print(f"\nSol du pré (médiane, 13-16 m) : z = {g:.2f} (altitude {g + c.ORIGIN_Z:.2f} m)")
    print(f"Centre (section à +10 m) : ({cx:.2f} ; {cy:.2f})")
    print(f"Sommet : z = {z[k]:.2f}, soit {z[k] - g:.1f} m au-dessus du pré, en ({x[k]:.2f} ; {y[k]:.2f}), à {math.hypot(x[k] - cx, y[k] - cy):.1f} m de l'axe")

    r = np.hypot(x - cx, y - cy)
    caps = cap_of(x - cx, y - cy)
    h = z - g
    print("\nSections horizontales : rayon (90ᵉ centile, m) par cap (secteurs de 15°) ; « - » : aucun point (creux ou ombre du relevé)")
    cols = np.arange(0, 360, 15)
    print(" h(m) " + " ".join(f"{v:4d}" for v in cols))
    for lv in (0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22):
        row = []
        for s in cols:
            q = stone & near(caps, s, 7.5) & (np.abs(h - lv) < 0.5) & (r < 13)
            row.append(f"{np.percentile(r[q], 90):4.1f}" if q.sum() >= 2 else "   -")
        print(f"{lv:5.1f} " + " ".join(row))

    print("\nProfil moyen (rayon médian sur les 24 secteurs, m) :")
    for lv in (0.5, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22):
        rs = []
        for s in cols:
            q = stone & near(caps, s, 7.5) & (np.abs(h - lv) < 0.5) & (r < 13)
            if q.sum() >= 2:
                rs.append(np.percentile(r[q], 90))
        print(f"  +{lv:4.1f} m : {np.median(rs):4.1f} m ({len(rs)} secteurs)")

    # Cavité : secteurs où, entre 3 et 9 m, le rayon tombe nettement sous celui des voisins ou les points manquent.
    print("\nCavités possibles (rayon à moins de 80 % de la médiane des secteurs voisins, ou aucun point) :")
    fine = np.arange(0, 360, 10)
    for lv in range(2, 12):
        rad = []
        for s in fine:
            q = stone & near(caps, s, 5) & (np.abs(h - lv) < 0.5) & (r < 13)
            rad.append(np.percentile(r[q], 90) if q.sum() >= 2 else np.nan)
        rad = np.array(rad)
        hits = []
        for i, s in enumerate(fine):
            nb = rad[[(i - 3) % 36, (i - 2) % 36, (i + 2) % 36, (i + 3) % 36]]
            ref = np.nanmedian(nb) if np.isfinite(nb).any() else np.nan
            if np.isnan(rad[i]) or rad[i] < 0.8 * ref:
                hits.append(f"{s}°" + ("" if np.isfinite(rad[i]) else "(vide)"))
        if hits:
            print(f"  +{lv} m : {', '.join(hits)}")

    print("\nAbords (par secteur de 30°) : sol à 13-16 m et à 22-29 m, points de végétation haute (> 3 m) à 13-30 m")
    for s in range(0, 360, 30):
        kk = near(caps, s, 15)
        g1 = z[kk & (cl == 2) & (r > 13) & (r < 16)]
        g2 = z[kk & (cl == 2) & (r > 22) & (r < 29)]
        v = int((kk & (cl == 5) & (r > 13) & (r < 30)).sum())
        f = lambda a: f"{np.median(a) - g:+5.2f}" if a.size else "    -"
        print(f"  {s:3d}° : {f(g1)} / {f(g2)} m, végétation {v}")

    print("\nCaches d'armes (src/core/pickups.ts) :")
    for n, (px, py) in PICKUPS.items():
        print(f"  {n} : à {math.hypot(px - cx, py - cy):.1f} m de l'axe, cap {cap_of(px - cx, py - cy):.0f}°")


if __name__ == "__main__":
    main()
