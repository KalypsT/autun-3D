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

Sans paramètre, on joue : joystick flottant à gauche (à fond : courir), glisser à droite pour regarder ; au clavier ZQSD/WASD, Maj pour courir, souris pour regarder ; bouton ⛶ pour le plein écran. `?debug` affiche les images par seconde.

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
```

## Chaîne de données

```sh
python3 -m pip install -r tools/data/requirements.txt
python3 tools/data/build_all.py          # télécharge dans .cache/ puis écrit public/data/ (relief, sols, rues, tuiles/, lod.json)
python3 tools/data/probe_sources.py      # vérifie l'accès et la couverture de chaque source
```

Paramètres d'URL utiles : `?style=nuit` (la nuit, fenêtres allumées ; le jour est le style « affiche » par défaut), `?detail=600` (rayon de chargement des tuiles détaillées, en mètres), `?at=x,y` (point de départ), `?cam=x,y,h,cx,cy,ch` (caméra libre), `?step=2` (pas du relief proche), `?hide=bati,toits` (masquer des maillages).
