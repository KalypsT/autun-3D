# Avancement

## Phase : maquette réaliste — quartier du Champ de Mars

| Étape | État |
|---|---|
| 1. Accès et couverture des sources, `docs/SOURCES.md` | ✅ validée |
| 2. Chaîne de données : relief, volumes et toits LiDAR, rues, arbres | ✅ faite, en attente de ton avis |
| 3. Fiches façade (estimées pour ce premier essai) | à faire |
| 4. Rendu complet, jeu, publication GitHub Pages | à faire (workflow déjà en place) |

### Étape 2 (26 octobre 2026)

Fait :
- `tools/data/` : `fetch.py` (téléchargements), `extract_lidar.py`, `build_terrain.py`, `build_buildings.py`, `build_streets.py`, `build_trees.py`, `check_buildings.py` ; `build_all.py` lance le tout.
- `public/data/` : relief 1 m (270 ko), 353 bâtiments avec 2 679 faces de toit LiDAR, 1 061 cheminées détectées, 55 voies (sens, revêtement, largeur), carte des sols 0,5 m, 40 murs, 66 éléments de mobilier, 228 arbres réels.
- Viewer minimal (Vite, TypeScript strict, three) : 9 appels de dessin, 236 k triangles, 50-60 images/s dans un navigateur sans GPU (SwiftShader) ; à mesurer sur ton téléphone.
- Tests : relief, soleil, couverture de la triangulation des toits (10 tests). Workflow GitHub Actions prêt (`.github/workflows/deploy.yml`).

Défauts connus :
- Façades sans détail (murs unis) : c'est l'objet de l'étape 3.
- Un vide dans un toit du théâtre (probablement un écart entre deux emprises cadastrales).
- Le kiosque à musique est classé « sol » par le LiDAR : il forme une bosse sur le terrain.
- Largeurs de chaussée = BD TOPO quand un tronçon correspond (32 voies sur 55), valeurs types sinon ; trottoirs déduits (2 m), pas mesurés.
- Sols : classes déduites de l'orthophoto et d'OSM, sans textures encore.
- OSM : extraction faite quand Overpass répondait ; le serveur est tombé ensuite, `fetch.py` garde le cache.
- Arbres : feuillage générique (pas d'essence), couronnes issues du LiDAR de mars élargies par l'orthophoto d'été.
- Ombres : carte d'ombres unique, bords en escalier de près.

À faire sur ton téléphone : ouvrir le viewer (voir README) et me dire si les volumes te parlent.
