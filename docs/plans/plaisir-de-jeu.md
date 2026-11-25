# Plaisir de jeu : prompts des phases 2 à 5

Chantier « PJ » de `docs/ROADMAP.md` (24 novembre 2026). La phase 1 (sprint, guidage, sensations, records, sons ; D309 à D313) est
faite. Chaque phase ci-dessous se fait dans **une nouvelle conversation** : copier le prompt tel quel. Une PR par phase, créée à la fin
de la phase seulement.

## Phase 2 : graphismes

```
Tu reprends le projet Autun 3D (jeu 3D en monde ouvert dans la vraie ville d'Autun, navigateur Android, Honor Magic 8 Pro en paysage, Three.js seule dépendance d'exécution, TypeScript strict, Vite, Vitest). Lis d'abord README.md, docs/ROADMAP.md (surtout la section « PJ. Plaisir de jeu »), PROGRESS.md (fin du fichier) et, dans docs/DECISIONS.md, D17 (style « affiche »), D19 (jour et nuit), D26 (réglages du téléphone), D196 (météo à l'écran), D200 (lumières de la ville), D297 à D300 (projecteurs des monuments), D105 (la mer) et D309 à D313 (phase 1 du plaisir de jeu).

Langue : échanges, docs et textes du jeu en français, identifiants en anglais, tutoiement. Retours honnêtes et directs. Décisions numérotées à la suite dans docs/DECISIONS.md, avancement dans PROGRESS.md (résumé lisible + captures dans docs/captures/), feuille de route à jour. Vérifications avant chaque commit : npm run typecheck && npm run lint && npm test && npm run build (et npm run build -- --mode domothib). Captures au format téléphone paysage avec tools/shot.sh et tools/ui.sh (rendu logiciel lent : en arrière-plan). Pas de nom de modèle dans les commits ni le code. Ne crée la PR qu'à la fin de la phase.

Mission : phase 2 du plaisir de jeu, les graphismes. Trois lots, chacun jugé sur captures (jour, coucher de soleil, nuit) et chacun avec un réglage pour le couper si le téléphone peine :
1. Halo lumineux la nuit (bloom) sur les projecteurs des monuments, les phares, les fenêtres éclairées, les lampadaires et les feux d'artifice, et étalonnage des couleurs selon l'heure (matin doux, midi franc, coucher chaud, nuit bleutée), sans trahir le style « affiche » (aplats nets, pas de flou partout). Post-traitement en demi-résolution si possible ; mesure le coût avec ?bench=1 et donne-moi un protocole de mesure sur le téléphone.
2. Ciel : nuages qui avancent avec le vent et la météo, couchers et levers de soleil plus marqués (couleurs du ciel, de la brume, des façades).
3. Mer vivante (src/render/sea.ts) : vagues, écume au rivage, reflets ; sans coût visible sur le reste.
Avant de coder, propose un plan court par lot, signale les risques (coût du post-traitement sur mobile, compatibilité avec les ombres et le brouillard, lisibilité de l'interface) et pose tes questions. Mode photo : pas dans cette phase.
```

## Phase 3 : argent et collections

```
Tu reprends le projet Autun 3D (jeu 3D en monde ouvert dans la vraie ville d'Autun, navigateur Android, Honor Magic 8 Pro en paysage, Three.js, TypeScript strict, Vite, Vitest). Lis d'abord README.md, docs/ROADMAP.md (section « PJ. Plaisir de jeu », phase 3), PROGRESS.md (fin du fichier) et, dans docs/DECISIONS.md, D33 à D35 (carte, interface, sauvegarde), D84 (armes et caches), D95 et les décisions des monuments faits d'après photo (D123 à D139, D223, D228…), D113 (garages), D200 (horaires des commerces), D214 à D218 (toits praticables), D305 (sauvegardes dans DomoThib) et D309 à D313 (phase 1 : records dans une clé à part, guidage vers le repère, bandeau d'exploit).

Langue : échanges, docs et textes du jeu en français, identifiants en anglais, tutoiement. Retours honnêtes et directs. Décisions numérotées à la suite dans docs/DECISIONS.md, avancement dans PROGRESS.md (résumé lisible + captures), feuille de route à jour. Vérifications avant chaque commit : npm run typecheck && npm run lint && npm test && npm run build (et --mode domothib). Captures au format téléphone paysage (tools/ui.sh). Pas de nom de modèle dans les commits ni le code. Ne crée la PR qu'à la fin de la phase.

Mission : phase 3 du plaisir de jeu, l'argent et les collections. Ce qui est déjà décidé : l'argent arrive dès maintenant ; on le dépense pour des véhicules, des armes, et peut-être nourriture et boissons qui soignent (les commerces ont des horaires, D200) ; pas de vêtements à acheter tant que le personnage et les vêtements n'ont pas été repris (chantier à part) ; pas de petits boulots (taxi, livraisons) dans cette phase. Collections : un système commun (carnet, découverte, récompense), une chasse aux monuments avec des fiches historiques courtes et sourcées (je relirai les textes : c'est ma ville), et des objets cachés sur les toits qui récompensent l'escalade.
Commence par écrire un plan court dans docs/plans/argent-collections.md et pose-moi tes questions avant de coder, notamment : échelle des prix et des gains, où et comment on achète (lieux réels, écran d'achat, horaires), ce que coûtent la mort et l'arrestation, ce que rapportent découvertes, records et passants mis à terre, liste des monuments retenus, thème et nombre des objets cachés, comment une découverte se déclenche, place de l'argent à l'écran, migration de la sauvegarde (SAVE_VERSION). Propose des réponses par défaut pour que je puisse répondre « ok ».
```

## Phase 4 : événements aléatoires

```
Tu reprends le projet Autun 3D (jeu 3D en monde ouvert dans la vraie ville d'Autun, navigateur Android, Honor Magic 8 Pro en paysage, Three.js, TypeScript strict, Vite, Vitest). Lis d'abord README.md, docs/ROADMAP.md (section « PJ. Plaisir de jeu », phase 4), docs/plans/ville-vivante.md, PROGRESS.md (fin du fichier) et, dans docs/DECISIONS.md, D39 à D47 (passants), D58 à D69 (circulation), D70 à D76 (police et poursuites), D80 à D86 (armes, réactions, infractions), D194 à D204 (ville vivante), D209 à D213 (chutes et bousculades), D309 à D313 (phase 1) et D317 à D327 (phase 3 : argent, carnet, magasins, armes ; les récompenses des événements passent par le porte-monnaie et le bandeau d'exploit).

Langue : échanges, docs et textes du jeu en français, identifiants en anglais, tutoiement. Retours honnêtes et directs. Décisions numérotées à la suite dans docs/DECISIONS.md, avancement dans PROGRESS.md (résumé lisible + captures), feuille de route à jour. Vérifications avant chaque commit : npm run typecheck && npm run lint && npm test && npm run build (et --mode domothib). Mesure le coût avec ?bench=1 et des tests d'endurance comme ceux de la police. Pas de nom de modèle dans les commits ni le code. Ne crée la PR qu'à la fin de la phase.

Mission : phase 4 du plaisir de jeu, les événements aléatoires autour du joueur. C'est ce qui doit rendre la ville vraiment vivante : il faut bien le travailler. Exemples : vol à l'arraché (le voleur fuit, on peut le rattraper), accident entre deux voitures de la circulation (constat, dispute, bouchon), poursuite entre la police et un autre conducteur, livreur pressé, rixe, malaise d'un passant, animal échappé… Aujourd'hui la poursuite ne vise que le joueur (src/core/chase.ts, src/game/police.ts) et les passants n'ont pas de fuite volontaire : il faudra les généraliser.
Commence par un plan détaillé dans docs/plans/evenements.md : catalogue d'événements (déclenchement, lieux, heures, fréquence, ce qu'on voit et entend, ce que le joueur peut faire, conséquences : police, étoiles, récompense), architecture (un directeur d'événements, budget de coût), découpage en lots jouables un par un, et tes questions (choix des événements du premier lot, fréquence, niveau de violence, récompenses). Propose des réponses par défaut, attends mes réponses avant de coder.
```

## Phase 5 : radio, puis jet-ski

```
Tu reprends le projet Autun 3D (jeu 3D en monde ouvert dans la vraie ville d'Autun, navigateur Android, Honor Magic 8 Pro en paysage, Three.js, TypeScript strict, Vite, Vitest). Lis d'abord README.md, docs/ROADMAP.md (section « PJ. Plaisir de jeu », phase 5, et les idées notées pendant J7), PROGRESS.md (fin du fichier) et, dans docs/DECISIONS.md, D89 (sons synthétisés par le navigateur, src/audio/), D105 (la mer, limite du monde), D241 et D242 (nage, véhicules dans l'eau), D97 (conduite), D309 à D313 (phase 1) et les décisions de la phase 4 (événements), si elle est faite.

Langue : échanges, docs et textes du jeu en français, identifiants en anglais, tutoiement. Retours honnêtes et directs. Décisions numérotées à la suite dans docs/DECISIONS.md, avancement dans PROGRESS.md, feuille de route à jour. Vérifications avant chaque commit : npm run typecheck && npm run lint && npm test && npm run build (et --mode domothib) ; sons vérifiés hors ligne avec tools/sounds.sh, page d'écoute ?sounds. Pas de nom de modèle dans les commits ni le code. Ne crée la PR qu'à la fin de la phase.

Mission : phase 5 du plaisir de jeu.
1. Radio en voiture : d'abord un prototype d'écoute (une station, quelques morceaux générés par le navigateur, sans fichier audio externe sauf si je le décide) que je juge à l'oreille avant d'aller plus loin : la musique générée peut sonner « jouet », dis-le franchement. Ensuite plusieurs stations (styles à me proposer), changement de station au volant, volume séparé dans les réglages, et un flash info qui raconte ce qui se passe en ville (événements de la phase 4, poursuites, records) : propose une forme (bandeau, jingle, voix de synthèse du navigateur ?).
2. Jet-ski sur la mer qui entoure la ville (et peut-être le plan d'eau du Vallon) : où le trouver, physique simple sur l'eau, vagues de la phase 2 si elles existent, limite du monde.
Avant de coder, propose un plan court par point, signale les risques et pose tes questions avec des réponses par défaut.
```
