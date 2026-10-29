# Autun 3D

Jeu 3D en monde ouvert dans la vraie ville d'Autun (Saône-et-Loire), sur téléphone.

Phase actuelle : toute la ville (18,8 km², avec Bellevue et les Télots), entourée par la mer comme dans un GTA (D105).

- Sources de données, couverture et licences : [docs/SOURCES.md](docs/SOURCES.md)
- Décisions : [docs/DECISIONS.md](docs/DECISIONS.md)
- Avancement : [PROGRESS.md](PROGRESS.md)

## Jouer

```sh
npm ci
npm run dev        # http://localhost:5173 ; ajouter ?debug pour le compteur d'images
```

Sans paramètre, on joue (la partie est reprise là où tu l'avais laissée) : joystick flottant à gauche (à fond : courir), glisser à droite pour regarder ; au clavier ZQSD/WASD, Maj pour courir, souris pour regarder ; plein écran au premier appui (réglage « Plein écran ») ; toucher la minimap (ou Échap, P) met en pause sur la carte agrandie, avec « Reprendre » et « Menu » (apparence, réglages, lieux notés, sauvegarde, crédits). La minimap en haut à gauche tourne avec la caméra ; la carte agrandie se déplace au doigt, se pince pour zoomer, et un appui long y pose ou retire un repère, visible sur la minimap et dans le monde. `?debug` affiche les images par seconde. Vélos et trottinettes garés aux parkings à vélos, voitures et motos sur les places de stationnement (visibles sur la minimap) : bouton rond « Monter » à côté, ou « Prendre » à côté d'une voiture de la circulation arrêtée ou au pas (son conducteur sort et s'enfuit, et la police est prévenue : étoiles en haut au centre), puis glisser horizontalement à gauche pour diriger, pédales Accélérer et Frein à droite (le frein à l'arrêt fait reculer), plus un frein à main en voiture pour la faire pivoter ; sur un deux-roues, la direction fait pencher (on tourne en se penchant), le même doigt tiré vers le bas en accélérant lève la roue avant (roue arrière, sauf scooter et trottinette), poussé vers le haut en freinant lève la roue arrière (roue avant), avec la distance affichée sous la minimap, à côté du compteur ; un choc trop fort fait tomber (blessure selon la vitesse, jamais mortelle) ; au clavier, E pour monter ou descendre, Z/S ou flèches pour accélérer et freiner, Q/D pour diriger, espace pour le frein à main, Maj pour la roue arrière, C pour la roue avant, H pour le klaxon (sonnette à vélo et en trottinette : les passants devant sursautent). À pied, bouton rond à droite pour frapper (tenu : coups enchaînés ; touche J), arme dans le bandeau du haut, à toucher pour en changer (X, ou 1 à 6) ; des armes sont cachées en ville (faisceau jaune, losange orange sur la minimap) : bouton « Ramasser » ; tenir le bouton rond tire (visée assistée ; bouton ↻ ou R pour recharger) ; `?arms=all` donne toutes les armes pour les essais. Sons fabriqués par le navigateur (moteurs, circulation, sirènes, armes, cloches de Saint-Lazare, oiseaux…) : ils démarrent au premier appui, se taisent pendant la pause ; réglage « Volume » dans le menu pause, `?sound=0` pour couper. `?sounds` ouvre la page d'écoute (chaque son sur un bouton). Le téléphone vibre aux chocs, aux tirs et aux coups reçus (réglage « Vibrations », `?vibrate=0` pour couper) ; la nuit, ton véhicule allume ses phares.

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
tools/sounds.sh sons [wav]               # rend chaque son hors ligne : niveaux, et fichiers WAV avec « wav »
tools/ui.sh captures all                  # rejoue les écrans de l'interface : hud, pause, map, save, wanted, police, arrest (rendu logiciel : plusieurs minutes)
```

## Chaîne de données

```sh
python3 -m pip install -r tools/data/requirements.txt
python3 tools/data/build_all.py          # tous les blocs de tools/data/region.json (zone jouable et bordure, D105) ; ou : build_all.py 3,4 (un bloc de 2 × 2 km, D31). Télécharge dans .cache/ puis écrit public/data/ (world.json, tiles/, lod/, terrain/, ground/ : tout par tuile, voir D30)
python3 tools/data/build_map.py          # carte : images par kilomètre, lieux et rues dans public/data/map (D33) ; ne touche à aucune tuile
python3 tools/data/build_nav.py          # navigation : files piétonnes, graphe routier, points d'intérêt, par super-tuile de 1 km dans public/data/nav (D40) ; après `fetch.py --only osm` et `--only routes` pour chaque bloc ; ne touche à aucune tuile
python3 tools/data/build_public_space.py # rues, trottoirs, places et clôtures d'après le cadastre (D94) : réécrit sols, clôtures et lampadaires des tuiles, puis relancer build_nav.py et build_map.py
python3 tools/data/build_structures.py   # ponts (tabliers mesurés au LiDAR), eau, ruisseaux, voies ferrées, quais dans public/data/structures (D93) ; ne touche à aucune tuile
python3 tools/data/build_coast.py        # la mer autour du monde (D105) : creuse le rivage (plage, falaises), découpe à la côte tout ce qui est en mer ; après build_public_space.py, avant build_nav.py et build_map.py
python3 tools/data/build_kinds.py        # types de bâtiments et sites (grandes surfaces, mairie, gare, églises, terrains, stations-service…), cathédrale et portes romaines (D95) dans public/data/kinds (D92) ; ne touche à aucune tuile
python3 tools/data/nav_debug.py out.png x0 y0 x1 y1 [px/m]   # image de contrôle de la navigation
python3 tools/data/probe_sources.py      # vérifie l'accès et la couverture de chaque source
```

Paramètres d'URL utiles : `?h=17` (heure de jeu au départ ; défaut 16 h), `?speed=0.02` (heures de jeu par seconde réelle ; défaut 1/50 en jeu, soit un jour en 20 minutes ; 0 = figée), `?day=200` (jour de l'année), `?style=nuit` (raccourci : 23 h 30 figée), `?detail=600` (rayon de chargement des tuiles détaillées, en mètres), `?at=x,y` (point de départ), `?cam=x,y,h,cx,cy,ch` (caméra libre), `?step=2` (pas du relief proche), `?hide=bati,toits` (masquer des maillages), `?skip=kinds` (sans les gabarits de bâtiments typés, D92), `?skip=structures` (sans ponts, eau des ouvrages ni voies ferrées, D93), `?ride=velo`, `?ride=trottinette`, `?ride=voiture`, `?ride=moto` ou l'identifiant d'un modèle du catalogue (`citadine`, `moto-routiere`…) (départ sur un véhicule), `?budget=4` (temps de construction des tuiles par image, en ms), `?peds=0` (coupe les passants ; `?peds=150` impose leur nombre maximal), `?pigeons=N` (nombre maximal de pigeons, 0 à 60 ; défaut : 40 % de la foule), `?traffic=N` (circulation : nombre maximal de voitures, 0 à 60 ; défaut : le réglage « Circulation » du menu pause, Normale), `?wanted=N` (niveau de recherche au départ, 0 à 3 étoiles), `?chase=N` (N gendarmeries poursuivent le joueur, quel que soit le niveau), `?nav=1` (recouvrement de la navigation : files, passages, places, points d'intérêt ; `?nav=all` ajoute le graphe routier), `?bench=1` (banc de test : parcours fixe d'environ 3 minutes, puis rapport à copier ou télécharger ; `?minimap=0` coupe la minimap pour comparer ; `&crowd=150&sim=1` y ajoute 150 passants simulés, `&fast=200` un trajet de plus à 200 km/h (les tuiles se construisent-elles à temps ?), `&fleet=1` les véhicules garés du jeu et un exemplaire de chaque modèle (coût en appels de dessin), `&traffic=20` la circulation du jeu (20 voitures au plus ; `&h=8` ou `&h=22` pour la pointe du matin ou la nuit), `&police=1` une poursuite à trois étoiles pendant tout le banc (quatre gendarmeries, gendarmes à pied aux arrêts), `&tiers=0` et `&avoid=0` pour comparer), `?new` (ignore la sauvegarde et la remplace). Les paramètres de test (`?at=`, `?yaw=`, `?ride=`, `?h=`, `?day=`, `?speed=`, `?style=`) imposent le départ et coupent la lecture comme l'écriture de la sauvegarde ; `?dpr=`, `?shadowmap=`, `?shadow=0` et `?detail=` restent prioritaires sur les réglages du menu.
