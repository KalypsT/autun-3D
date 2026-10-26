# Feuille de route et prompt de reprise

Rédigée le 26 octobre 2026 après la PR #8. À mettre à jour à chaque étape.

## Réponses de l'utilisateur (décisions de cadrage)

- **Appareil de test** : Honor Magic 8 Pro (Android, haut de gamme). Cible : 60 images/s stables, 30 minutes de jeu. Les budgets peuvent être plus larges que sur un téléphone de milieu de gamme, mais rien n'est mesuré : le banc de test passe avant toute décision de densité.
- **Ton** : balade vivante avec une violence limitée, non graphique (style « affiche » : pas de sang ; bousculades, poursuites, vol de véhicule, réactions des habitants).
- **Public** : l'auteur et quelques adultes de son entourage.
- **Étendue** : d'abord la commune d'Autun ; si c'est agréable, un peu de campagne autour. Les engins volants plus tard.
- **Véhicules** : vélo, trottinette, moto, voiture (puis engins volants). Obtention : **vol** (à l'arrêt, puis avec conducteur) ; l'achat viendra plus tard.
- **Hébergement des données** : à décider selon la complexité (GitHub Pages tant que ça tient).
- **Sons** : indécis. **Objectifs de jeu** : à penser plus tard, mais il en faudra.
- **Rythme** : peu importe, choisir le plus optimisé (une version jouable par étape reste la règle).

## Ordre proposé

0. **Banc de test téléphone** (images/s, appels de dessin, mémoire, à-coups, exportés en rapport) et premiers retours de test.
1. **Véhicules libres** sur la carte actuelle (2,25 km²) : vélo, trottinette, puis voiture, puis moto. Physique arcade réaliste, caméra, commandes tactiles (volant virtuel, boutons, inclinaison à comparer), collisions, chargement des tuiles à vitesse (anticipation dans le sens de la marche).
2. **Extension de la carte par anneaux** : centre élargi (≈ 9–10 km², tient encore dans le format JSON actuel et sur Pages), puis commune entière (format binaire compact, niveaux de détail supplémentaires, éventuellement hébergement séparé), puis campagne.
3. **Vie dans la ville** : graphe piéton (trottoirs, passages), graphe routier (sens uniques, feux, priorités), passants, circulation, pigeons, ambiance sonore, horaires jour/nuit.
4. **Obtention des véhicules** : voler un véhicule à l'arrêt, puis avec conducteur ; réactions des habitants, violence limitée.
5. **Monuments modélisés à la main** (hôtel de ville, théâtre romain, cathédrale Saint-Lazare, porte d'Arroux, temple de Janus, remparts), puis **objectifs et missions**.

En parallèle, à chaque étape : corrections ponctuelles données par l'utilisateur (`tools/data/manual.json`).

## Prompt pour la nouvelle conversation

> Tu reprends un projet existant : un jeu 3D en monde ouvert dans la vraie ville d'**Autun** (Saône-et-Loire), pour navigateur Android (Honor Magic 8 Pro, paysage, tactile, solo). Dépôt GitHub `kalypst/autun-3D`, site `https://kalypst.github.io/autun-3D/` (GitHub Pages, déployé depuis `main` par Actions). Lis d'abord `README.md`, `PROGRESS.md`, `docs/DECISIONS.md` (D1 à D19), `docs/SOURCES.md` et `docs/ROADMAP.md`.
>
> **Langue** : échanges, docs et textes du jeu en français ; identifiants de code en anglais. À chaque étape, envoie des captures au format téléphone en paysage. Plan court avant de coder, risques signalés, petites PR, décisions dans `docs/DECISIONS.md`, avancement dans `PROGRESS.md`.
>
> **Pile** : Three.js (seule dépendance d'exécution), TypeScript strict, Vite, Vitest, ESLint. Outils de données en Python (`tools/data`, shapely, scipy, numpy, pyproj, PIL). Vérifications : `npm run typecheck && npm run lint && npm test && npm run build`. Données interdites : tout ce qui vient de Google. Sources ouvertes : IGN (BD TOPO, LiDAR HD, BD ORTHO), OpenStreetMap, BDNB ; garder l'attribution (OSM sous ODbL).
>
> **État** : zone de 6 × 6 tuiles de 250 m (2,25 km²) autour de la mairie. Bâtiments générés à partir de l'emprise et de la hauteur BD TOPO (toits à pans par `build_roofs.py`, aucune géométrie LiDAR de toit), façades imaginées par une grammaire (`src/render/stylized.ts`), style « affiche de voyage » (aplats, ombres en paliers, grain), cycle jour/nuit (`src/render/atmosphere.ts`, fenêtres et lampadaires allumés la nuit), sols en vecteurs (chaussées, trottoirs avec bordures, places, parkings, marquages, `build_ground.py` + `src/render/ground.ts`), enseignes avec noms, lampadaires, pelouses, haies, remparts, escalier de l'hôtel de ville en marches. Chargement par tuiles (`src/render/tile-manager.ts`, détail à moins de 210 m, silhouettes au loin), relief par morceaux, collisions 2D par tuile, marche à pied avec commandes tactiles. 42 tests.
>
> **Pièges connus** : (1) `.cache/` n'est pas versionné et le conteneur est éphémère : les téléchargements bruts (≈ 700 Mo, LiDAR, BDNB, OSM) sont à refaire avec `tools/data/fetch.py` (reprise possible) ; `public/data` est versionné. (2) Chaîne : `tools/data/build_all.py` (ordre : fetch, extract_lidar, build_terrain, build_buildings, build_roofs, build_streets, build_trees, build_facades, build_ground, build_tiles, check) ; `build_ground.py` prend ≈ 1,5 min, les rasters vectorisés trop fins explosent la mémoire. (3) Corrections manuelles : `tools/data/manual.json`. (4) Captures sans GPU : `tools/shot.sh <dossier> "vue:paramètres"` (un seul point de vue par processus, `dpr=1&shadowmap=2048`), très lent en SwiftShader : ne mesure pas les performances. Paramètres utiles : `?cam=x,y,h,cx,cy,ch`, `?h=`, `?speed=`, `?detail=`, `?hide=`, `?skip=`. (5) Ne jamais écrire `pkill -f` ou `kill $(ps … grep)` avec un motif présent dans la commande : cela tue le shell. Pour attendre une tâche longue, la lancer en arrière-plan et utiliser Monitor (pas de `sleep` enchaînés). (6) Pas de spread (`...`) sur de grands tableaux (limite d'arguments) : boucler. (7) Anneaux de bâtiments en sens trigonométrique ; les normales des murs en dépendent. (8) Git : la branche de travail est `claude/autun-3d-realistic-mockup-15elc2` ; l'utilisateur fusionne les PR et la branche distante est souvent supprimée ensuite : repartir de `origin/main`. Le push forcé est refusé ; fusionner `origin/main` dans la branche et pousser normalement. Un hook de fin de tour exige que tout soit commité et poussé. Ne pas créer de PR sans demande ; mettre à jour la description de la PR ouverte plutôt que d'en recréer. Pas de nom de modèle dans les commits, PR ou code.
>
> **Décisions de cadrage** : voir « Réponses de l'utilisateur » dans `docs/ROADMAP.md` (violence limitée non graphique, adultes, commune d'abord, véhicules vélo/trottinette/moto/voiture puis engins volants, obtention par vol, hébergement et sons à décider).
>
> **Anomalies ouvertes** : un long ruban de corniche croise parfois la vue depuis la rue Jondeau (≈ −62, 70) ; l'escalier de l'hôtel de ville est anguleux (colonnes de 50 cm) ; aucune mesure de performances sur téléphone ; ≈ 1 km² de pelouse OSM très simple ; les nœuds « stop » d'OSM ne donnent pas le sens d'approche (pas de lignes d'arrêt).
>
> **Première mission** : étape 0 de la feuille de route : un banc de test de performances embarqué (images/s, appels de dessin, triangles, mémoire texture/géométrie, à-coups de construction de tuile, export en rapport lisible par l'utilisateur), puis traiter les retours de test que l'utilisateur apportera. Ensuite, étape 1 (véhicules libres). Avant de coder une étape, propose un court plan et signale les risques.

## Retour de test (à compléter)

À remplir par l'utilisateur après ses essais sur téléphone : fluidité, lisibilité, éléments mal représentés (position + ce que c'est en réalité).
