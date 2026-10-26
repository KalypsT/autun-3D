# Décisions

Chaque décision : date, contexte, choix, raison. On ne la réécrit pas : si elle change, on ajoute une nouvelle entrée qui la remplace.

## 2026-10-25 — D1. Chaîne de données en Python, jeu en TypeScript

- Contexte : le LiDAR HD est livré en COPC/LAZ, en Lambert-93, avec des rasters GeoTIFF.
- Choix : `tools/data/` est écrit en Python 3 (laspy + lazrs, pyproj, shapely, numpy, tifffile, requests). Le jeu reste en TypeScript strict avec three.js comme seule dépendance d'exécution.
- Raison : Node n'a pas de lecteur LAZ fiable. Python fait cela en quelques lignes. La chaîne de données ne tourne que chez le développeur ; elle n'alourdit pas le jeu.

## 2026-10-25 — D2. Données brutes hors git

- Choix : les téléchargements (LiDAR, rasters, orthophotos, photos, réponses d'API) vont dans `.cache/` (ignoré par git). Seuls les fichiers compacts produits par la chaîne sont versionnés.

## 2026-10-25 — D3. Repère de travail en Lambert-93

- Choix : tous les calculs de la chaîne se font en Lambert-93 (EPSG:2154), en mètres, avec les altitudes IGN69 du LiDAR. Le jeu reçoit des coordonnées locales en mètres, avec une origine au centre de la zone.
- Raison : c'est le système natif de BD TOPO, du LiDAR et de l'orthophoto. On évite ainsi toute reprojection d'image.

## 2026-10-25 — D4. Pas de données Google

- Choix : ni Street View, ni 3D Tiles, ni aucune donnée Google. Si l'option est retenue, Mapillary (Meta, CC-BY-SA) est autorisé ; il n'est pas utilisé pour l'instant.

## 2026-10-26 — D5. Emprises BD TOPO gardées telles quelles, toits recalés sur le LiDAR

- Contexte : BD TOPO annonce 3 m de précision planimétrique. Mesure : 83 % des points « bâtiment » du LiDAR tombent dans les emprises, 95 % à moins d'1 m (le reste, ce sont des débords de toit). Un recalage par bâtiment ne gagne en médiane que 8 % de points.
- Choix : on garde les emprises sans les déplacer. Les toits sont reconstruits sur les points LiDAR, découpés à l'emprise.
- Raison : un recalage individuel ajouterait du bruit sans gain mesurable ; les murs restent alignés sur le cadastre et les rues OSM.

## 2026-10-26 — D6. Toits : plans RANSAC, sommets alignés sur les arêtes réelles

- Choix : pour chaque bâtiment, plans de toit ajustés par RANSAC sur la surface supérieure du nuage (on écarte les points de façade), cellules de 0,5 m étiquetées par le plan le plus proche de l'altitude mesurée, régions simplifiées avec arêtes communes, puis **sommets partagés ramenés sur l'intersection exacte des plans voisins**. Triangles précalculés en Python (Delaunay contraint).
- Raison : sans ce recalage, les arêtes suivent la grille (escaliers de 0,5 m, marches de 0,7 m entre faces) ; la triangulation d'earcut dans three se trompait sur 7 faces avec trous (test `roof-triangulation.test.ts`).
- Mesure : écart médian modèle/MNS 0,03 m, 86 % des cellules à moins de 0,5 m (`tools/data/check_buildings.py`).

## 2026-10-26 — D7. Altitudes relatives, repère local

- Choix : coordonnées locales en mètres (x est, y nord, z haut) autour de (798770, 6650812) en Lambert-93, altitudes relatives à 330 m IGN69. Le rendu convertit en (x, z, −y).
- Raison : petits nombres, pas de perte de précision en float32 sur le téléphone.

## 2026-10-26 — D8. Données générées versionnées, brutes hors dépôt

- `public/data/` (≈ 1,5 Mo : relief, bâtiments, rues, sols, arbres) est versionné pour que le jeu et la publication ne dépendent pas des serveurs IGN/OSM. `.cache/` (dalle LiDAR 173 Mo, rasters, orthophoto, réponses d'API) est ignoré par git. `python3 tools/data/build_all.py` refait tout.
- Overpass (serveur public) est parfois indisponible : `fetch.py` garde alors le cache existant au lieu d'échouer.

## 2026-10-26 — D9. Dépendances d'exécution

- Une seule : `three`. Le reste (vite, typescript, vitest, eslint, @types) ne sert qu'au développement. Les triangulations et le LiDAR sont traités à l'avance en Python.

## 2026-10-26 — D10. Façades : fiches en données, sprites à relief plutôt que maillages

- Choix : une fiche JSON par bâtiment (`docs/facade-fiche.schema.json`, validée à la génération par `build_facades.py`). Le rendu ne modélise pas chaque fenêtre en géométrie : il pose des quads texturés (atlas de fenêtres, volets, portes, vitrines dessinés à partir des fiches, avec carte de normales pour le relief) et ne garde en volume que les corniches, bandeaux, soubassements, balcons et chaînages.
- Raison : ~12 000 fenêtres en maillage coûteraient plus d'un million de triangles ; en quads, ~25 000.
- Les fiches sont toutes « estimées » (aucune photo de rue libre sur la zone) ; `status: observed` + `photos` serviront quand on aura des photos.
- KTX2 : repoussé à l'étape de rendu final, il faut un encodeur (basisu/toktx) qui n'est pas installé ici. Pour l'instant textures PNG/JPEG générées ou réduites.

## 2026-10-26 — D11. Toits : plans par défaut, maillage LiDAR quand les plans échouent

- Constat : 78 bâtiments sur 353 avaient plus de 15 % de cellules à plus d'1 m d'écart au MNS ; 27 d'entre eux (plus de 15 m²) portaient des éclats de toit visibles.
- Choix : si plus de 12 % des cellules s'écartent de plus d'1 m, le toit est un maillage direct de la surface LiDAR (1 m, adouci), plafonné à l'altitude BD TOPO du toit + 1,5 m. Chaque sommet est aussi plafonné à ±1 m de la mesure la plus proche.
- Limite connue : les ailes de l'hôtel de ville et du théâtre restent irrégulières. Ce sont des monuments : ils seront modélisés à part d'après des photos.
- Les décrochements de moins de 1,5 m entre faces voisines ne dessinent plus de mur (ils formaient des plaques parasites).

## 2026-10-26 — D12. Atlas de sprites

- Les sprites de façade sont regroupés en 2 pages de 2048 px (≈ 55 px/m, 497 sprites distincts) ; les variantes invisibles sont fusionnées (`canonicalWindow`). Mémoire de texture : ≈ 45 Mo avec mipmaps, à réduire avec KTX2 à l'étape de rendu final.
