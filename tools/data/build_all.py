"""Exécute toute la chaîne, bloc par bloc : téléchargements, extraction LiDAR, puis fichiers de public/immuable/<version>/data.

Usage : python3 tools/data/build_all.py [bloc ...]      ex. : python3 tools/data/build_all.py 3,4 2,4
Sans argument : tous les blocs de REGION (config.py). Un bloc = 8 × 8 tuiles de 250 m ; la mémoire ne dépend donc pas de la taille du monde.
Les étapes déjà faites (fichiers dans .cache/) ne sont pas refaites ; supprimer .cache/ pour tout repartir de zéro.
pack.py découpe relief et sols par tuile et fusionne le bloc dans world.json.
Les fichiers vont dans public/immuable/<version>/data ; à la fin, data_version.py refait l'empreinte et renomme le dossier (D305).
"""

import os
import subprocess
import sys
from pathlib import Path

here = Path(__file__).parent
steps = ["fetch.py", "extract_lidar.py", "build_terrain.py", "build_buildings.py", "build_roofs.py", "build_streets.py", "build_trees.py", "build_facades.py", "build_ground.py", "build_tiles.py", "pack.py", "check_buildings.py"]


def blocks():
    if len(sys.argv) > 1:
        return [tuple(int(v) for v in a.split(",")) for a in sys.argv[1:]]
    # config lit AUTUN_BLOCK au chargement : on l'importe sans variable, le bloc par défaut ne sert qu'à lister REGION.
    sys.path.insert(0, str(here))
    import config as c

    return c.region_blocks()


for bi, bj in blocks():
    env = {**os.environ, "AUTUN_BLOCK": f"{bi},{bj}"}
    print(f"\n######## bloc {bi},{bj}")
    for step in steps:
        print(f"\n== {step} (bloc {bi},{bj})")
        subprocess.run([sys.executable, str(here / step)], check=True, cwd=here, env=env)

# Nouvelle version des données (D305) : le dossier public/immuable/<version> prend le nom de l'empreinte de son contenu.
subprocess.run([sys.executable, str(here / "data_version.py")], check=True, cwd=here)
