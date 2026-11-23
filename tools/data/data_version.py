"""Version des données lourdes du jeu (D305) : un seul dossier public/immuable/<version>/, avec data/ et decals/.

La version est l'empreinte du contenu de ce dossier (12 caractères hexadécimaux). Elle est écrite dans src/data/data-version.json,
que lisent le jeu (src/data/data-version.ts, adresses des fichiers) et la chaîne de données (ce module, dossiers de sortie). Comme le
nom change dès qu'un octet change, l'hôte des jeux de DomoThib peut garder ces fichiers en cache un an sans les revalider.

Usage : python3 tools/data/data_version.py           # après toute régénération : recalcule l'empreinte, renomme le dossier
        python3 tools/data/data_version.py --check   # dit seulement si la version est à jour (code de sortie 1 sinon)

Le test src/data/data-version.test.ts fait le même calcul : il échoue tant que l'empreinte n'a pas été refaite.
"""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSION_FILE = ROOT / "src" / "data" / "data-version.json"
IMMUTABLE = ROOT / "public" / "immuable"


def read_version():
    return json.loads(VERSION_FILE.read_text())["version"]


VERSION = read_version()
PUBLISHED = IMMUTABLE / VERSION
# Dossiers publiés : données (tuiles, relief, sols, carte, navigation…) et images collées sur les murs.
DATA = PUBLISHED / "data"
DECALS = PUBLISHED / "decals"


def fingerprint(folder):
    """Empreinte d'un dossier : SHA-256 des lignes « <sha256 du fichier>  <chemin relatif> », triées par chemin ; 12 premiers caractères."""
    lines = []
    for path in folder.rglob("*"):
        if path.is_file():
            lines.append((path.relative_to(folder).as_posix(), hashlib.sha256(path.read_bytes()).hexdigest()))
    lines.sort()
    text = "".join(f"{digest}  {rel}\n" for rel, digest in lines)
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def stamp(check=False):
    """Renomme public/immuable/<ancienne> en public/immuable/<empreinte> et met à jour data-version.json ; rend la version."""
    current = read_version()
    folder = IMMUTABLE / current
    if not folder.is_dir():
        raise SystemExit(f"{folder} absent : la version de {VERSION_FILE.name} ne correspond à aucun dossier de public/immuable")
    others = sorted(p.name for p in IMMUTABLE.iterdir() if p.name != current)
    if others:
        raise SystemExit(f"public/immuable ne doit contenir que {current} ; à retirer : {', '.join(others)}")
    new = fingerprint(folder)
    if new == current:
        print(f"données à jour : {current}")
        return current
    if check:
        print(f"données changées : {current} -> {new} (lancer python3 tools/data/data_version.py)")
        raise SystemExit(1)
    folder.rename(IMMUTABLE / new)
    VERSION_FILE.write_text(json.dumps({"version": new}) + "\n")
    print(f"nouvelle version des données : {current} -> {new}")
    return new


if __name__ == "__main__":
    stamp(check="--check" in sys.argv[1:])
