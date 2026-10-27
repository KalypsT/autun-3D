# Autun 3D

Jeu 3D en monde ouvert dans la vraie ville d'Autun (Saône-et-Loire), sur téléphone.

Phase actuelle : maquette réaliste du quartier de la mairie, autour de la place du Champ de Mars.

- Sources de données, couverture et licences : [docs/SOURCES.md](docs/SOURCES.md)
- Décisions : [docs/DECISIONS.md](docs/DECISIONS.md)
- Avancement : [PROGRESS.md](PROGRESS.md)

## Jouer

```sh
npm ci
npm run dev        # http://localhost:5173 ; ajouter ?debug pour le compteur d'images
```

Sans paramètre, on joue (la partie est reprise là où tu l'avais laissée) : joystick flottant à gauche (à fond : courir), glisser à droite pour regarder ; au clavier ZQSD/WASD, Maj pour courir, souris pour regarder ; bouton ⛶ pour le plein écran, bouton ⏸ (ou Échap, P) pour la pause : reprendre, carte, réglages, lieux notés, sauvegarde. La minimap en haut à gauche tourne avec la caméra ; la carte agrandie (menu pause) se déplace au doigt, se pince pour zoomer, et un appui long y pose ou retire un repère, visible sur la minimap et dans le monde. `?debug` affiche les images par seconde. Vélos et trottinettes garés aux parkings à vélos, voitures et motos sur les places de stationnement (indicateur 🚲/🛴/🚗/🏍️ du plus proche en haut à droite) : bouton « Monter » à côté, puis glisser horizontalement à gauche pour diriger, pédales Accélérer et Frein à droite (le frein à l'arrêt fait reculer), plus un frein à main en voiture pour la faire pivoter ; au clavier, E pour monter ou descendre, Z/S ou flèches pour accélérer et freiner, Q/D pour diriger, espace pour le frein à main, H pour le klaxon (sonnette à vélo et en trottinette : les passants devant sursautent).

## Prototypes de foule (étape P)

`?proto=1` mesure une foule de personnages animés (rapport à copier, comme `?bench=1`) ; `?proto=look&n=24` en affiche une rangée (`seed=`, `dist=`, `turn=`) ; `?proto=riders` montre les conducteurs sur leurs véhicules ; `?view=characters` est la galerie (appui : d'autres personnages) ; `?view=vehicles` est celle des véhicules du catalogue (`family=car`, `ids=`, `heading=`, `rider=1`, `parked=1` : tels qu'ils sont garés dans le jeu ; appui : couleur suivante) ; `?bench=1&crowd=100&soak=10` ajoute au banc une foule et dix minutes d'endurance. Voir `PROGRESS.md`.

## Viewer à caméra libre (captures, diagnostic)

Avec `view=` ou `cam=`, c'est la caméra libre. Paramètres d'URL : `view=aerial|street|place|mairie|church`, `cam=x,y,hauteur,cibleX,cibleY,hauteurCible`,
`h=16` (heure solaire), `day=200` (jour de l'année), `shadow=0`, `dpr=1`, `step=2` (maille du relief, en mètres),
`hide=misc,sprites-0,toit-ardoise` (masque des maillages, diagnostic), `nonormal`, `dbg=normals`.
Souris ou doigt : glisser pour regarder ; clavier : ZQSD/WASD, flèches, E/Q monter/descendre, Maj accélère, F affiche le panneau de debug.

## Vérifications

```sh
npm run typecheck && npm run lint && npm test && npm run build
tools/shot.sh captures aerial street      # construit, sert et capture en format téléphone paysage
tools/play.sh captures walk               # rejoue un scénario tactile dans le jeu (walk, wall, still, stream)
tools/ui.sh captures all                  # rejoue les écrans de l'interface : hud, pause, map, save (rendu logiciel : plusieurs minutes)
```

## Chaîne de données

```sh
python3 -m pip install -r tools/data/requirements.txt
python3 tools/data/build_all.py          # tous les blocs de REGION ; ou : build_all.py 3,4 (un bloc de 2 × 2 km, D31). Télécharge dans .cache/ puis écrit public/data/ (world.json, tiles/, lod/, terrain/, ground/ : tout par tuile, voir D30)
python3 tools/data/build_map.py          # carte : images par kilomètre, lieux et rues dans public/data/map (D33) ; ne touche à aucune tuile
python3 tools/data/build_nav.py          # navigation : files piétonnes, graphe routier, points d'intérêt, par super-tuile de 1 km dans public/data/nav (D40) ; après `fetch.py --only osm` et `--only routes` pour chaque bloc ; ne touche à aucune tuile
python3 tools/data/nav_debug.py out.png x0 y0 x1 y1 [px/m]   # image de contrôle de la navigation
python3 tools/data/probe_sources.py      # vérifie l'accès et la couverture de chaque source
```

Paramètres d'URL utiles : `?h=17` (heure de jeu au départ ; défaut 16 h), `?speed=0.02` (heures de jeu par seconde réelle ; défaut 1/50 en jeu, soit un jour en 20 minutes ; 0 = figée), `?day=200` (jour de l'année), `?style=nuit` (raccourci : 23 h 30 figée), `?detail=600` (rayon de chargement des tuiles détaillées, en mètres), `?at=x,y` (point de départ), `?cam=x,y,h,cx,cy,ch` (caméra libre), `?step=2` (pas du relief proche), `?hide=bati,toits` (masquer des maillages), `?ride=velo`, `?ride=trottinette`, `?ride=voiture`, `?ride=moto` ou l'identifiant d'un modèle du catalogue (`citadine`, `moto-routiere`…) (départ sur un véhicule), `?budget=4` (temps de construction des tuiles par image, en ms), `?peds=0` (coupe les passants ; `?peds=150` impose leur nombre maximal), `?pigeons=N` (nombre maximal de pigeons, 0 à 60 ; défaut : 40 % de la foule), `?nav=1` (recouvrement de la navigation : files, passages, places, points d'intérêt ; `?nav=all` ajoute le graphe routier), `?bench=1` (banc de test : parcours fixe d'environ 3 minutes, puis rapport à copier ou télécharger ; `?minimap=0` coupe la minimap pour comparer ; `&crowd=150&sim=1` y ajoute 150 passants simulés, `&fast=200` un trajet de plus à 200 km/h (les tuiles se construisent-elles à temps ?), `&fleet=1` les véhicules garés du jeu et un exemplaire de chaque modèle (coût en appels de dessin), `&tiers=0` et `&avoid=0` pour comparer), `?new` (ignore la sauvegarde et la remplace). Les paramètres de test (`?at=`, `?yaw=`, `?ride=`, `?h=`, `?day=`, `?speed=`, `?style=`) imposent le départ et coupent la lecture comme l'écriture de la sauvegarde ; `?dpr=`, `?shadowmap=`, `?shadow=0` et `?detail=` restent prioritaires sur les réglages du menu.
