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
