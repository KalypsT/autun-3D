# Feuille de route et prompt de reprise

Réécrite le 27 octobre 2026, après l'étape B (anneau de 9 km²) et le cadrage des fonctions de jeu. À mettre à jour à chaque étape.

## Réponses de l'utilisateur (décisions de cadrage)

- **Appareil de test** : Honor Magic 8 Pro (Android, haut de gamme). Cible : 60 images/s stables, 30 minutes de jeu. Mesuré : 60 i/s partout sur la carte de 2,25 km², sans personne dans les rues (D26). Le budget des PNJ reste à mesurer (banc `?bench=1`).
- **Ton** : balade vivante, jeu pour adultes. **Violence : on peut pousser le curseur plus loin** que la première idée (« affiche », sans sang, bousculades). Le niveau exact (armes, effets sur les PNJ, dégâts des véhicules) sera fixé avec l'utilisateur au début de l'étape J5, pas avant. Le style graphique reste celui de l'« affiche de voyage » (D17).
- **Public** : l'auteur et quelques adultes de son entourage.
- **Étendue** : l'anneau de 3 × 3 km autour de la mairie suffit pour l'instant. **L'agrandissement à la commune entière (étape C) est reporté** : il se fera une fois les formats de données des fonctions de jeu fixés, pour ne fabriquer la commune qu'une fois. Un peu de campagne autour ensuite ; engins volants plus tard.
- **Véhicules** : vélo, trottinette, moto, voiture (puis engins volants). Obtention : **vol** (à l'arrêt, puis avec conducteur) ; l'achat viendra plus tard.
- **Hébergement des données** : GitHub Pages tant que ça tient (limite 1 Go de site publié) ; plan B : second dépôt de données publié par Pages, au-delà d'environ 400 Mo (D31).
- **Sons** : plus tard (étape J7). **Objectifs et argent** : à réfléchir le moment venu (étape J6).
- **Repère sur la carte** : simple repère posé par l'utilisateur, sans guidage par les routes pour l'instant.
- **Minimap** : tourne avec la caméra, nord fixe en option.
- **Rythme** : une version jouable et testable sur téléphone par étape.
- **Corrections après test** : l'utilisateur les apporte au fil de l'eau ; on enchaîne les étapes sans les attendre.

### Rappel des cadrages précédents

- **Commandes tactiles** : à gauche, glisser horizontalement pour diriger ; à droite, zones Accélérer et Freiner/Reculer ; frein à main en voiture. Pas d'inclinaison ni de volant virtuel.
- **Véhicules** : garés sur les places marquées, bouton « Monter » à proximité ; un véhicule quitté reste où on l'a laissé. Simulation assez réaliste, collisions réalistes, sans dégâts pour l'instant. Escaliers infranchissables en voiture, franchissables à vélo et à trottinette. Vue à la troisième personne.

## État au 27 octobre 2026

- **Monde** : anneau de 12 × 12 tuiles de 250 m (9 km²) autour de la mairie, 5 972 bâtiments, 38 195 arbres, 43 Mo de données. Tout est chargé par tuile à la demande (D30) ; la chaîne de données tourne par blocs de 2 × 2 km sur une grille mondiale qui couvre déjà la commune (D31).
- **Jeu** : marche, vélo, trottinette, voiture, moto ; cycle jour/nuit déjà là (soleil, ciel, brouillard, fenêtres et lampadaires qui s'allument la nuit, une journée en 20 minutes) mais l'heure n'est affichée que dans le panneau de debug (`?debug`) ; aucun PNJ, aucun son, aucun objectif, aucune sauvegarde, aucun menu.

## Fonctions de jeu : ordre convenu

Chaque étape doit être jouable et testable sur téléphone. Les noms J1 à J7 évitent la confusion avec les anciennes étapes (véhicules, carte).

- **J1. Interface, carte et sauvegarde.** Horloge à l'écran, menu pause (reprendre, carte, réglages, sauvegarde), minimap, carte agrandie, repère, bouton « noter ce lieu », sauvegarde locale. Fixe aussi les formats de données de lieux (`poi`, images de carte), que l'étape C devra produire. **Prochaine étape.**
- **J2. Navigation et passants.** Graphe piéton (trottoirs, passages) et graphe routier (sens uniques, feux, priorités) dans la chaîne de données ; passants qui apparaissent et disparaissent autour du joueur ; horaires jour/nuit ; pigeons.
- **J3. Circulation.** Voitures qui suivent les routes, feux, priorités, réactions à un joueur au volant.
- **J4. Police et recherche.** Niveau de recherche, voitures de police, poursuites, arrestation ; vol de véhicule avec conducteur.
- **J5. Armes et violence.** Corps à corps, armes, effets sur les PNJ, au niveau fixé avec l'utilisateur au début de l'étape. **Affichage de la santé et de l'arme en cours**, qui ont leur emplacement prévu dès J1 (voir plus bas).
- **J6. Argent, petits boulots, monuments, objectifs.** Chasse aux monuments d'Autun (fiches historiques sourcées), coursier, taxi ou courses : à choisir à ce moment. Monuments modélisés à la main (hôtel de ville, théâtre romain, cathédrale Saint-Lazare, porte d'Arroux, temple de Janus, remparts).
- **J7. Sons.** Moteurs, pas, sirènes, ambiance ; synthèse d'abord (pas de fichiers à licencier). Peut être avancé si l'utilisateur veut de la vie dès J2.
- **Étape C. Commune entière** (43 blocs de plus, environ 14 Go de LiDAR, forêts, rivières et ponts, relief fin à 2 m en campagne, limites du monde, tests et CI allégés). Après J1 à J3 au moins.

Idées retenues pour plus tard : mode photo, météo (pluie, brume, adhérence), personnage plus détaillé, dégâts des véhicules, engins volants.

En parallèle, à chaque étape : corrections ponctuelles données par l'utilisateur (`tools/data/manual.json`).

## Prompt pour la nouvelle conversation (étape J1)

> Tu reprends un projet existant : un jeu 3D en monde ouvert dans la vraie ville d'**Autun** (Saône-et-Loire), pour navigateur Android (Honor Magic 8 Pro, paysage, tactile, solo). Dépôt GitHub `kalypst/autun-3D`, site `https://kalypst.github.io/autun-3D/` (GitHub Pages, déployé depuis `main` par Actions ; l'utilisateur fusionne les PR lui-même). Lis d'abord `README.md`, `PROGRESS.md`, `docs/DECISIONS.md` (D1 à D32, surtout D17 style, D19 jour/nuit, D20 banc de test, D30 et D31 données par tuile et par blocs), `docs/SOURCES.md` et `docs/ROADMAP.md` (décisions de cadrage et ordre des étapes J1 à J7).
>
> **Langue** : échanges, docs et textes du jeu en français ; identifiants de code en anglais ; tutoiement. L'utilisateur veut des retours honnêtes et directs (dis-lui quand il se trompe), des analogies pour les notions nouvelles. À chaque étape, envoie des captures au format téléphone en paysage. Plan court avant de coder, risques signalés, petites PR (une PR à la demande seulement), décisions dans `docs/DECISIONS.md`, avancement dans `PROGRESS.md`, feuille de route à jour.
>
> **Pile** : Three.js (seule dépendance d'exécution), TypeScript strict, Vite, Vitest, ESLint. Outils de données en Python (`tools/data`, shapely, scipy, numpy, pyproj, PIL ; `pip install -r tools/data/requirements.txt`). Vérifications : `npm run typecheck && npm run lint && npm test && npm run build`. Données interdites : tout ce qui vient de Google. Sources ouvertes : IGN (BD TOPO, LiDAR HD, BD ORTHO), OpenStreetMap, BDNB ; garder l'attribution (OSM sous ODbL).
>
> **État** : anneau de 12 × 12 tuiles de 250 m (3 × 3 km, 144 tuiles, 5 972 bâtiments, 43 Mo) autour de la mairie, tout chargé par tuile (D30) : relief fin et sols fins par tuile, relief et sols grossiers au loin, silhouettes par tuile, `world.json` (plan du monde, `gridOrigin`, grille mondiale de 56 × 56 tuiles qui couvre la commune ; identifiants `colonne_ligne` absolus comme `24_32`). Style « affiche de voyage » (aplats, ombres en paliers, grain), cycle jour/nuit (`src/render/atmosphere.ts` : `hour`, `speed` par défaut 1/50 h par seconde, getter `clock` « HH:MM », fenêtres et lampadaires allumés la nuit), marche, vélo, trottinette, voiture, moto (`src/core/*.ts` pour la logique pure, `src/game/game.ts` pour la boucle, `src/input/controls.ts` pour le tactile). Interface en HTML dans `index.html` : bouton plein écran en haut à droite (`#fullscreen`), pastilles des véhicules proches (`#nearby`), indice (`#hint`), crédits en bas à droite, pédales et bouton d'action à droite, joystick flottant à gauche, panneau de debug en haut à gauche (`?debug`). Aucun menu, aucune sauvegarde, aucune carte, aucun PNJ, aucun son.
>
> **Pièges connus** : (1) `.cache/` n'est pas versionné et le conteneur est éphémère : tout téléchargement est à refaire (dalles LiDAR 170 Mo chacune, blocs OpenStreetMap, BDNB). L'environnement doit autoriser `data.geopf.fr`, `api.openstreetmap.org` et `api.bdnb.io` (Overpass n'est pas nécessaire) : vérifie l'accès avant de promettre un résultat qui en dépend et, s'il est refusé, dis-le à l'utilisateur (réglages réseau de l'environnement). (2) Chaîne : `python3 tools/data/build_all.py [bloc ...]` (blocs de l'anneau : `3,4 2,4 3,3 2,3` ; un script seul : `AUTUN_BLOCK=3,4 python3 tools/data/<script>.py`) ; étapes dans l'ordre fetch, extract_lidar, build_terrain, build_buildings, build_roofs, build_streets, build_trees, build_facades, build_ground, build_tiles, pack, check_buildings ; chaque bloc ne touche qu'à ses fichiers ; `pack.py` fusionne dans `public/data/world.json`. (3) **Ne régénère pas les tuiles sans nécessité** : le dépôt fait 47 Mo et chaque régénération en ajoute ≈ 15 Mo compressés. Pour la carte, écris des étapes autonomes (par exemple `build_map.py`) qui lisent `public/data/tiles/*.json` (les couches de sol, les bâtiments et les fiches avec les noms de commerces et les monuments y sont déjà) et n'ajoutent que de nouveaux fichiers ; seuls les lieux absents des tuiles (commissariat, hôpital, écoles, pharmacies, parkings…) demandent OpenStreetMap. (4) Vérifie les **codes de sortie** (`npm test; echo $?`), ne les passe pas dans `grep` : un test en échec ne doit jamais être poussé. Les tests chargent toutes les tuiles réelles (`src/core/testing.ts`) et doivent rester rapides : pas de `expect` dans des boucles de dizaines de milliers d'éléments. (5) Captures sans carte graphique : `tools/shot.sh <dossier> "vue:paramètres"` et `tools/play.sh` (rendu logiciel très lent : ne mesure pas les performances) ; les mesures de fluidité se font sur le téléphone avec `?bench=1`. (6) Pas de spread (`...`) sur de grands tableaux ; ne jamais écrire `pkill -f` avec un motif présent dans la commande. Pour attendre une tâche longue, la lancer en arrière-plan. (7) Git : la branche de travail est donnée par la session ; l'utilisateur fusionne les PR et la branche distante est souvent supprimée ensuite : repartir de `origin/main`. Pas de nom de modèle dans les commits, PR ou code.
>
> **Décisions de cadrage** : voir `docs/ROADMAP.md`. À retenir : jeu pour adultes, violence qu'on peut pousser plus loin (niveau exact fixé en J5), style « affiche », sons plus tard, argent et objectifs plus tard, carte entière (commune) reportée.
>
> **Mission : étape J1, interface, carte et sauvegarde.** Avant de coder, propose un plan court, signale les risques et pose tes questions. Contenu :
> 1. **Horloge** à l'écran (HH:MM, depuis `atmosphere.clock`). Prévois dans l'interface une zone pour la **santé**, l'**arme en cours** et les **étoiles de recherche**, vide pour l'instant, pour que J4 et J5 n'aient pas à refaire la mise en page ; l'interface doit rester lisible en paysage sur 915 × 412 px CSS et ne pas gêner joystick et pédales.
> 2. **Menu pause** (bouton visible, accessible en voiture comme à pied) : reprendre, carte, réglages, sauvegarde. La pause **fige la simulation et l'heure du jeu** (véhicules, soleil) ; le rendu peut continuer. Réglages : définition, ombres, rayon de détail et sensibilité de la caméra (aujourd'hui des paramètres d'URL `?dpr=`, `?shadowmap=`, `?detail=` ; ils restent prioritaires), enregistrés localement.
> 3. **Minimap** à l'écran (canvas 2D, environ 140 px, rayon visible d'environ 180 m) : tourne avec la caméra, nord fixe en option ; montre routes, trottoirs, eau, pelouses, bâtiments, le joueur, les véhicules garés proches et le repère. Doit coûter moins d'1 ms par image (mise à jour à 15-20 Hz) : mesure-le avec `?bench=1` et compare au rapport de D26.
> 4. **Carte agrandie** (écran de pause) : tout l'anneau, déplacement au doigt et zoom, noms de rues, commerces nommés, monuments, commissariat, joueur et direction. **Appui long pour poser ou retirer un repère** (rien de plus : pas de guidage par les routes). Le repère apparaît sur la minimap (flèche au bord et distance quand il est hors champ) et en jeu (petit marqueur visible).
> 5. **Données de la carte** : prévois des fichiers produits par la chaîne de données (images de fond par kilomètre dans la palette du jeu et fichier de lieux avec catégories), pour qu'ils soient fabriqués une seule fois pour la commune entière plus tard. Écris leur format dans `docs/DECISIONS.md`. Ne charge pas les 144 tuiles pour dessiner la carte.
> 6. **Bouton « noter ce lieu »** : enregistre position, direction, heure du jeu, un texte libre et une capture d'écran ; liste et export (copier / télécharger en JSON) comme le rapport du banc de test. L'utilisateur s'en sert pour signaler des erreurs de carte (« à cet endroit, ce n'est pas comme ça en vrai »).
> 7. **Sauvegarde locale** (`localStorage`, protégée par `try/catch`, versionnée) : position, direction, véhicule monté, véhicules déplacés, heure et jour du jeu, repère, réglages ; automatique à la pause, à l'envoi en arrière-plan de la page et toutes les 30 s ; bouton « nouvelle partie ».
> 8. Tests des parties pures (conversion monde/carte, sérialisation de la sauvegarde, repère), captures au format téléphone de chaque écran, décisions dans `docs/DECISIONS.md`, avancement dans `PROGRESS.md`. Garde `?bench=1` et le viewer (`?view=`) fonctionnels.
>
> **Hors périmètre** : PNJ, circulation, police, armes, sons, commune entière. Si une idée s'impose pendant le travail, note-la dans `docs/ROADMAP.md` plutôt que de la faire.
