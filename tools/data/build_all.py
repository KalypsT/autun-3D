"""Exécute toute la chaîne : téléchargements, extraction LiDAR, puis fichiers de public/data (pack.py découpe relief et sols par tuile).

Usage : python3 tools/data/build_all.py
Les étapes déjà faites (fichiers dans .cache/) ne sont pas refaites ; supprimer .cache/ pour tout repartir de zéro.
"""

import subprocess
import sys
from pathlib import Path

import config as c

here = Path(__file__).parent
steps = ["fetch.py", "extract_lidar.py", "build_terrain.py", "build_buildings.py", "build_roofs.py", "build_streets.py", "build_trees.py", "build_facades.py", "build_ground.py", "build_tiles.py", "pack.py", "check_buildings.py"]
for step in steps:
    if step == "extract_lidar.py" and (c.CACHE / "points.npz").exists():
        print(f"= {step}")
        continue
    print(f"\n== {step}")
    subprocess.run([sys.executable, str(here / step)], check=True, cwd=here)
