# Autun 3D

Jeu 3D en monde ouvert dans la vraie ville d'Autun (Saône-et-Loire), sur téléphone.

Phase actuelle : maquette réaliste du quartier de la mairie, autour de la place du Champ de Mars.

- Sources de données, couverture et licences : [docs/SOURCES.md](docs/SOURCES.md)
- Décisions : [docs/DECISIONS.md](docs/DECISIONS.md)
- Avancement : [PROGRESS.md](PROGRESS.md)

## Lancer le viewer

```sh
npm ci
npm run dev        # http://localhost:5173 ; ajouter ?debug pour le compteur d'images
```

Paramètres d'URL : `view=aerial|street|place|mairie|church`, `cam=x,y,hauteur,cibleX,cibleY,hauteurCible`,
`h=16` (heure solaire), `day=200` (jour de l'année), `shadow=0`, `dpr=1`, `step=2` (maille du relief, en mètres).
Souris ou doigt : glisser pour regarder ; clavier : ZQSD/WASD, flèches, E/Q monter/descendre, Maj accélère, F affiche le panneau de debug.

## Vérifications

```sh
npm run typecheck && npm run lint && npm test && npm run build
node tools/capture.cjs http://localhost:4173/ captures aerial street   # captures téléphone en paysage
```

## Chaîne de données

```sh
python3 -m pip install -r tools/data/requirements.txt
python3 tools/data/build_all.py          # télécharge dans .cache/ puis écrit public/data/
python3 tools/data/probe_sources.py      # vérifie l'accès et la couverture de chaque source
```
