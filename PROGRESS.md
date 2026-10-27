# Avancement

## Phase : maquette réaliste — quartier du Champ de Mars

| Étape | État |
|---|---|
| 1. Accès et couverture des sources, `docs/SOURCES.md` | ✅ validée |
| 2. Chaîne de données : relief, volumes et toits LiDAR, rues, arbres | ✅ fusionnée (PR #1) |
| 3. Fiches façade (estimées) + générateur + matières | ✅ faite, en attente de ton avis |
| **Étape 1 bis : toute la zone Autun centre, 2,25 km², par tuiles** | ✅ faite, à tester sur téléphone |
| 4.1 Se balader à pied : commandes tactiles, caméra, collisions | ✅ faite, à tester sur téléphone |
| 4.2 Vélo, puis voiture (conduite réaliste) | à faire |
| 4.3 Circulation, passants, pigeons | à faire |
| 4.4 Jour/nuit, plaque de rue, vue du ciel, KTX2, optimisation | à faire |

### Étape 3 (26 octobre 2026)

Fait :
- **Fiches façade** : 353 fiches JSON validées par `docs/facade-fiche.schema.json` (`tools/data/build_facades.py`). Époque et matériaux viennent de la BDNB et de BD TOPO, les niveaux de la hauteur LiDAR, 93 commerces nommés d'OpenStreetMap sont placés sur leur mur de rue. Chaque mur est qualifié (rue, cour, mitoyen). Toutes « estimées » (confiance 0,3 à 0,75) : aucune photo libre sur la zone.
- **Générateur** (`src/render/facades.ts`) : travées, fenêtres, volets, portes, vitrines et enseignes, balcons en fer forgé, corniches, bandeaux, soubassements. 5 300 fenêtres, 197 portes, 85 vitrines, 157 balcons, en sprites à relief (atlas de 2 pages).
- **Matières** : enduit et pierre de taille, tuile plate, tuile mécanique, ardoise, zinc, toit-terrasse ; sols en textures CC0 (asphalte, pavés, gravier, herbe, trottoir, dallage) avec assombrissement près des murs ; ciel en dégradé, brume, jupe sous le relief.
- **Toits** : 27 bâtiments passent en toit maillé sur le LiDAR quand les plans échouent (D11).
- Tests : 15 (relief, soleil, triangulation des toits, fiches, planificateur de façades).

Défauts connus :
- Hôtel de ville et théâtre : toits irréguliers (à modéliser à la main d'après photos, étape suivante).
- Le kiosque à musique forme une bosse sur le terrain (classé « sol » par le LiDAR).
- Arbres : couronnes en blobs plats, sans essence.
- Très près d'un mur, les sprites (≈ 55 px/m) sont un peu flous ; pas de LOD.
- Ombres : une seule carte, bords en escalier ; pas d'occlusion ambiante autre que sur le sol.
- Textures non compressées (KTX2 à faire) ; chargement ≈ 1,1 s de génération sur PC + décodage des PNG/JPEG.
- Les fenêtres ne s'allument pas encore la nuit.
- Largeurs de rues et trottoirs estimés (voir étape 2).

### Étape 4.1 (26 octobre 2026) : se balader à pied

Fait :
- `src/core/` (logique pure, sans rendu) : collisions (`collision.ts`), piéton (`player.ts`), caméra à la troisième personne (`camera-rig.ts`), obstacles du monde (`world.ts`) ; 27 tests dont un test d'intégration sur les vraies données.
- `src/input/controls.ts` : joystick flottant, regard au doigt, clavier, souris ; `src/game/game.ts` : boucle à pas fixe 60 Hz, soleil et ombres qui suivent le joueur, personnage articulé provisoire.
- Le viewer à caméra libre reste disponible avec `?view=` ou `?cam=` (captures, diagnostic) ; sans paramètre, c'est le jeu.
- Test tactile automatisé (`tools/play.sh`) : marche à mi-poussée 0,9 m/s, course à fond 5 m/s, regard au doigt.

Pas encore fait / limites :
- Pas de saut, pas d'escaliers ni de portes : on marche à plat sur le relief. Les passages couverts (Balthus, de la Terrasse) sont bloqués.
- Pas de recentrage automatique de la caméra derrière le personnage.
- Performances sur téléphone non mesurées : en navigateur logiciel le jeu tourne à 13-80 images/s selon l'instant, ce qui ne dit rien du téléphone.
- Personnage en blocs, sans visage ni vêtements d'Autun.

### Agrandissement : 2,25 km² par tuiles (26 octobre 2026)

Fait :
- **Zone** : 6 × 6 tuiles de 250 m alignées sur le Lambert-93, de la cathédrale Saint-Lazare au nord-ouest à la rue du Théâtre romain au sud (1,5 × 1,5 km, quatre dalles LiDAR HD). 3 486 bâtiments, 5 519 arbres, 522 voies, 351 murs et grilles, 464 éléments de mobilier.
- **Données par tuile** (`tools/data/build_tiles.py`) : `public/data/tiles/<col>_<ligne>.json` (bâtiments, fiches, arbres, murs, mobilier, 3 Ko à 1,2 Mo), `lod.json` (silhouettes simplifiées, 0,5 Mo), `world.json` (grille). Relief (4,7 Mo) et cartes de sol (1,4 Mo, 1 m par pixel) restent globaux.
- **Client** : `TileManager` charge en détail les tuiles à moins de 210 m (déchargées au-delà de 300 m), les autres sont des silhouettes à toit plat (un maillage par tuile). Relief par morceaux de 250 m à trois niveaux de pas (2, 5, 12 m) avec jupes. Atlas de façades rempli à la demande (3 pages de 2048, la plus ancienne est recyclée quand tout est plein ; les tuiles concernées se reconstruisent). Collisions étiquetées par tuile, retirées au déchargement.
- **Corrigé** : murs, murets, grilles (barreaux à transparence, piliers) et mobilier urbain (bancs, poubelles, bornes, boîtes aux lettres, toilettes, fontaines, feux) sont maintenant dessinés ; ils étaient seulement des obstacles invisibles.
- **Corrigé** : champs classés « gravier » par erreur (loin des routes et des bâtiments : herbe), parkings en asphalte par défaut.
- Téléchargements : l'API OpenStreetMap par blocs de 500 m remplace Overpass quand celui-ci coupe les connexions ; BDNB complète de la commune (5 823 groupes).
- Tests : 42 (données réelles sur les 36 tuiles).

Mesures (navigateur logiciel, PC) :
- Autour de la place : 6 à 8 tuiles détaillées, ≈ 170 000 à 320 000 triangles, 80 à 150 appels de dessin.
- Toute la zone en détail (test extrême) : 710 000 triangles, 490 appels, construction 14 s.
- **Rien n'est mesuré sur téléphone.** Les budgets (appels de dessin, triangles, mémoire des atlas ≈ 130 Mo) sont des estimations à vérifier.

Limites / à faire :
- Pas de LOD des arbres (absents des tuiles lointaines) ; silhouettes sans pente de toit.
- Une tuile se construit d'un bloc (≈ 100-300 ms sur PC) : à lisser si ça saccade sur téléphone.
- Les façades restent estimées ; monuments à modéliser (hôtel de ville, théâtre, cathédrale, monuments romains).
- Ajouter de la vie : passants, circulation, pigeons (étape 4.3).
- Fidélité des sols (parking du centre-ville, cours de lycée) : à revoir sur photos / orthophoto.

### Direction artistique : essai « conte peint » (26 octobre 2026)

Après test sur téléphone (carte correcte, mais lenteurs, scintillement des fenêtres, esthétique faible), on change de parti pris : garder la cartographie réelle, mais des façades imaginées, en aplats et volumes simples, sans textures.
- `?style=conte` : murs en aplats avec ombre au pied, fenêtres/volets/portes/vitrines/enseignes en volumes (`src/render/stylized.ts`), toits à pans nets avec trame douce, sols en palette, arbres à deux boules, lumière dorée (`src/render/style.ts`). Les silhouettes lointaines utilisent la même palette (`lod.json` porte l'époque et la clé de hachage).
- Sans paramètre, le rendu texturé reste inchangé pour comparer. Pas encore mesuré sur téléphone.
- À faire si le style plaît : monuments modélisés à la main, enseignes, détails (cheminées fumantes, lanternes), ciel et nuages, suppression de l'ancien rendu.

### Repartir de zéro : bâtiments propres + trois ambiances (26 octobre 2026)

- **Bâtiments** (`tools/data/build_roofs.py`) : seules l'emprise et la hauteur BD TOPO servent. Les toits sont générés (quatre pans ou deux pans avec pignons, plateau au-delà de 4,6 m de montée), sans relevé LiDAR : plus de trous ni d'éclats. 727 toits plats, 1 844 à quatre pans, 915 à deux pans.
- **Ambiances** (`?style=affiche|jouets|nuit`, `src/render/style.ts`) : même géométrie, palettes, lumière, ciel et surimpression différents. Les fenêtres s'allument la nuit.
- À choisir ensuite : une direction, puis finitions (sol, ciel, monuments, détails), puis suppression de l'ancien rendu texturé.

### Affiche par défaut, nettoyage (26 octobre 2026)

- Le style « affiche » est le rendu par défaut ; `?style=nuit` donne la nuit. Le rendu texturé réaliste et ses ressources sont supprimés (D17).
- Prochaines étapes : rues, trottoirs, bordures et places dessinés en géométrie (aujourd'hui seulement une carte de couleurs de sol), puis ciel, lampadaires, enseignes, arbres, cycle jour/nuit.

### Sols en vecteurs, ciel, lampadaires (26 octobre 2026)

- `tools/data/build_ground.py` : chaussées (largeurs BD TOPO), trottoirs de 2,2 m, places et parkings (OSM + sol minéral de la carte), passages piétons (207), lignes axiales, lampadaires (914, tous les 30 m sur les trottoirs). Découpés par tuile dans `tiles/*.json` (champ `ground`).
- Client (`src/render/ground.ts`) : polygones triangulés et posés sur le relief, bordure de 15 cm avec liseré clair, marquages en blanc ; un seul maillage « sol » par tuile.
- Ciel en trois teintes avec nuages en aplats (ombre rosée) ; arbres jaunes et orange par endroits ; enseignes avec lettres suggérées ; lampadaires et lanternes allumées la nuit.
- Enseignes : le nom du commerce s'affiche (atlas de noms de 192 cases, recyclé en anneau) ; lampadaires orientés vers la chaussée ; trottoirs prioritaires sur les places (bords nets).
- Parkings : pas de trottoir à l'intérieur, places marquées le long des allées ; personnage aux couleurs de l'affiche (veste vermillon, écharpe moutarde, bonnet bleu-vert).
- Pelouses (OSM, ~1 km² dans la zone), terrains de sport, eau, 24 haies, 14 remparts (hauteur 6 m, épaisseur 1,3 m, avec collisions).
- Lignes d'arrêt : abandonnées pour l'instant (les nœuds « stop » d'OSM ne sont jamais en bout de voie, le sens d'approche est inconnu).
- À revoir : bandes cyclables, mobilier orienté, ombres et couleurs par rue, mesures sur téléphone.

### Cycle jour/nuit (26 octobre 2026)

- Horloge de jeu (départ 16 h, un jour en 20 minutes) : jour « affiche », couchant orangé, crépuscule violet avec étoiles, nuit bleue ; les fenêtres et les lampadaires s'allument progressivement ; l'heure s'affiche dans le panneau de debug (touche F). Voir D19.
- À faire : lune visible, réverbères plus lumineux, ciel de pluie ?, vélo puis voiture (4.2), circulation et passants (4.3), monuments.

### Corrections du 26 octobre (retour de test)

- **Feux tricolores** : ils sont posés de part et d'autre de la chaussée (au bord, sur le trottoir), avec potence vers la route, au lieu de l'axe de la voie (`roadside_signals` dans `build_tiles.py`).
- **Grilles** : les clôtures et portails mesurés à 0 m par le LiDAR (barreaux trop fins) prennent une hauteur type (1,8 m et 2,4 m) ; `tools/data/manual.json`.
- **Escalier de l'hôtel de ville** : le relief LiDAR y forme un talus lisse de 4,4 m ; la zone est déclarée dans `manual.json` (`stairs`) et dessinée en marches de 17 cm (colonnes de 50 cm, relief lissé). Rendu encore anguleux : à affiner (marches orientées, paliers, rampes).
- **Champ de Mars** : les allées de parking OSM (`service=parking_aisle`) et les voies « Place du Champ de Mars » ne sont plus des rues avec trottoirs mais un grand parking en enrobé avec places marquées.
- Diagnostic : `?skip=furn,walls,misc,wall,place,stairs` masque des familles de géométrie d'une tuile ; `?hide=` masque des maillages.
- Non élucidé : un long ruban de corniche croise parfois la vue depuis un point de la rue Jondeau (≈ −62, 70) ; il vient des corniches/bandeaux des façades (`planFacades`), pas des feux. À reprendre si on le revoit en jeu.

### Banc de test et vélo (26 octobre 2026)

- **Banc de test** (`?bench=1`, D20) : parcours fixe de 2,6 km dans les rues à 50 puis 90 km/h, arrêts avec et sans ombres, en définition réduite ; rapport à copier ou télécharger (images/s, 1 % le plus lent, à-coups, constructions de tuiles, appels, triangles, mémoire). `?bench=court` sert seulement à vérifier le déroulé.
- Mesures indépendantes de l'appareil (conteneur sans carte graphique) : ≈ 70 appels de dessin à l'arrêt sur la place, ≈ 750 000 triangles avec ombres (≈ 530 000 sans : la carte d'ombres en coûte ≈ 220 000), géométrie ≈ 50 à 75 Mo, textures ≈ 26 Mo. **Une tuile se construit en 140 à 330 ms** (processeur de PC) : à vitesse de voiture, chaque nouvelle tuile fera un à-coup ; c'est l'objet de l'étape « chargement à vitesse ».
- **Vélo** (D21) : physique réaliste (pneus, inertie, pente réelle, chocs par impulsions), vélos garés aux 12 parkings à vélos (un à 25 m du départ, indicateur 🚲 en haut à droite), bouton Monter/Descendre, pédales tactiles, caméra de poursuite, cycliste penché sur le guidon qui pédale, inclinaison dans les virages. `?ride=velo` : départ sur un vélo.
- Tests : 58.
- À faire : trottinette, chargement à vitesse (anticipation, construction étalée), voiture, moto. Mesures sur téléphone à rapporter (`?bench=1`).

![Vélo garé](docs/captures/etape5-velo-parking.jpg)
![Vélo de profil](docs/captures/etape5-velo-profil.jpg)
![Virage](docs/captures/etape5-velo-virage.jpg)

### Trottinette (26 octobre 2026)

- Trottinette électrique de location (D22) : bridée à 25 km/h, petites roues, freins plus faibles ; une au bout de chaque rangée de vélos ; conducteur debout. `?ride=trottinette` : départ dessus. Tests : 62.

![Trottinette](docs/captures/etape5-trottinette.jpg)

### Chargement à vitesse et voiture (26 octobre 2026)

- **Tuiles en tranches** (D23) : la construction d'une tuile rend la main toutes les 4 ms (`?budget=`) ; ses maillages apparaissent un par image ; les tuiles vers lesquelles on roule sont chargées d'abord (3 s d'anticipation). Banc court : la plus longue interruption passe de 963 ms (d'un bloc) à une vingtaine de millisecondes au plus.
- **Voiture** (D24) : citadine à traction avant (0 à 100 km/h en ≈ 12 s, freinage ≈ 0,9 g, sous-virage, roulis de caisse), garée sur 30 % des 1 163 places de stationnement retrouvées dans le marquage au sol ; toutes les voitures garées sont dessinées en deux appels. Escaliers infranchissables en voiture. `?ride=voiture` : départ au volant.
- Tests : 74.
- À faire : moto ; mesures sur téléphone (`?bench=1`) ; pousser les véhicules garés lors d'un choc (avec la circulation).

![Voitures garées](docs/captures/etape5-voitures-garees.jpg)
![Voiture](docs/captures/etape5-voiture.jpg)

### Moto (26 octobre 2026) — étape 1 terminée

- Moto de moyenne cylindrée (D25), garée par deux sur quelques places de stationnement ; pilote assis, inclinaison dans les virages. `?ride=moto`. Tests : 77.
- L'étape 1 (véhicules libres) est complète : vélo, trottinette, voiture, moto, chargement à vitesse. Reste à régler au doigt sur téléphone (commandes, caméra) et à mesurer (`?bench=1`).

![Moto](docs/captures/etape5-moto.jpg)

### Premier rapport du banc sur téléphone (26 octobre 2026, version 7131cd3)

Honor Magic 8 Pro (Adreno 840), Chrome 155, tenu en portrait, rendu 633 × 1 230 px (densité plafonnée à 1,5 sur 2,975), ombres 2048.
- **60 i/s sur toutes les phases**, y compris à 50 et 90 km/h ; 1 % le plus lent ≥ 54 i/s. Le navigateur cadence à 60 Hz : le banc bute sur la synchronisation de l'écran et ne mesure donc pas la marge restante.
- À-coups : un seul > 50 ms (66 ms, pendant une construction de tuile) sur 2,6 km. Tuiles : 140 à 200 ms de travail en moyenne, étalées sur 28 à 40 images, plus longue tranche 24-26 ms.
- 40 à 87 appels de dessin, 0,5 à 1,26 M triangles, géométrie 49-85 Mo, textures 26 Mo, JavaScript 88 Mo.
- Conclusion : cibles de D20 atteintes avec une marge inconnue mais vraisemblablement large. À mesurer en chargeant davantage (définition native, ombres 4096, rayon de détail plus grand) avant de décider de relever les réglages par défaut.
- Deux passages plus chargés (définition native, ombres 4096, puis détail à 400 m) restent à 60 i/s. Réglages par défaut relevés (D26) : définition ×2,5, ombres 4096, détail 300 m.

### Retour d'essai des véhicules (27 octobre 2026)

- Freinage refait (D27) : report de charge, roues qui se bloquent sans ABS, glissades, traces de pneus ; pression qui monte tant qu'on appuie.
- Direction : braquage borné par l'adhérence à haute vitesse, braquage moins brusque, course du doigt progressive.
- Repères des véhicules : un par type (vélo, trottinette, moto, voiture).
- Tests : 79.

![Freinage roues bloquées, trace au sol](docs/captures/etape5-freinage-trace.jpg)

### Deuxième retour d'essai (27 octobre 2026)

- Feux tricolores et troncs sortis de la chaussée, couronnes au-dessus des rues relevées à 4 m ou réduites (D28, `tools/data/roadside.py`, tuiles corrigées sans tout régénérer).
- Direction plus vive ; l'arrière peut décrocher en virage serré, et se rattrape en relâchant ou en contre-braquant.
- Tests : 81.

![Arbres d'alignement](docs/captures/etape5-arbres-alignement.jpg)

### Troisième retour d'essai : ABS et frein à main (27 octobre 2026)

- Voiture et moto avec ABS : freiner ne bloque plus les roues, on peut freiner en tournant. Frein à main en voiture pour la faire pivoter (D29).
- Deux-roues stables : ils ne dérapent plus ni ne se retournent en freinant ou en tournant.
- Voiture plus maniable en ville (20-40 km/h).
- Tests : 84.

![Frein à main : la voiture pivote, traces des roues arrière](docs/captures/etape5-frein-a-main.jpg)

### Agrandissement vers la commune entière, étape A : tout par tuile (27 octobre 2026)

La commune fait 61,6 km² (27 fois la zone actuelle) ; avant d'agrandir la carte, on retire tout ce qui était chargé d'un bloc (D30).
- **Données** : relief fin (`terrain/<id>.bin`), sols fins (`ground/<id>_{a,b}.png`), sols grossiers par super-tuile de 1 km (`ground/s<i>_<j>_*.png`) et silhouettes (`lod/<id>.json`) par tuile ; relief grossier global à 8 m (72 ko). Au démarrage, le jeu ne charge plus que `world.json` (9 ko) et `terrain/coarse.bin` (72 ko), contre ≈ 7,8 Mo avant (relief, sols, silhouettes, rues). Ensuite tout arrive à la demande, par ordre de proximité, dans le sens de la marche.
- **Vérifié** : mêmes altitudes qu'avant (écart 0,00000 m sur 50 000 points) ; même image à l'écran (0,2 % des pixels diffèrent de plus de 40/765 sur la vue aérienne, 0,04 % sur la place) ; parcours en téléportation sur 1,2 km sans erreur, blocs de relief chargés puis libérés (28 → 19), 34 silhouettes en mémoire, tuiles détaillées chargées et déchargées comme avant.
- **Corrigé au passage** : les obstacles des tuiles déchargées restaient en mémoire (fuite qui aurait grossi sans fin en roulant dans toute la commune).
- Tests : 94 (relief par tuile : repli sur le grossier, absence de couture à chaque frontière de tuile, mêmes altitudes qu'avant, un seul chargement par bloc ; recyclage des obstacles).
- (Voir l'étape B ci-dessous : l'anneau a été fabriqué.)

### Étape B (27 octobre 2026) : l'anneau de 9 km²

La carte couvre maintenant 3 × 3 km autour de la mairie : 144 tuiles de 250 m, 5 972 bâtiments, 38 195 arbres, rendus avec les mêmes rues, trottoirs, mobilier, enseignes et façades que le centre.
- **Chaîne par blocs** (D31) : blocs de 2 × 2 km sur une grille mondiale stable (identifiants absolus `24_32`), la mémoire ne dépend plus de la taille du monde. Le bloc central refabriqué de bout en bout redonne les données publiées (bâtiments 3 487 / 3 486, murs et mobilier identiques) ; les trois autres blocs ont été fabriqués ensuite.
- **Poids** : 43 Mo pour l'anneau (4,8 Mo/km²) ; démarrage 2,4 Mo ; un tour complet de l'anneau 6,9 Mo. Extrapolation à la commune dans D31.
- **Vérifié dans un navigateur** (sans carte graphique : seuls les octets reçus et l'absence d'erreur comptent) : parcours par téléportation aux quatre coins de l'anneau, au centre et à l'ouest, sans erreur ; captures des nouveaux quartiers. **Pas encore mesuré sur téléphone** : le site n'est publié par GitHub Pages que depuis `main`, donc après la fusion d'une PR.
- Tests : 100.
- **Reste** : mesure sur téléphone (`?bench=1`), puis étape C (commune entière, relief fin à 2 m en campagne, forêts, limites du monde).

### Cadrage des fonctions de jeu (27 octobre 2026)

L'agrandissement à la commune est reporté (D32) ; on ajoute d'abord les fonctions de jeu, dans l'ordre J1 à J7 de `docs/ROADMAP.md` : interface, carte et sauvegarde ; navigation et passants ; circulation ; police ; armes et violence ; argent et objectifs ; sons. Le prompt de l'étape J1 est dans `docs/ROADMAP.md`.


### Étape J1 (27 octobre 2026) : interface, carte et sauvegarde

Fait (décisions D33 à D35) :
- **Interface en jeu** : horloge sous la minimap (haut à gauche), bouton pause à côté du plein écran (haut à droite), pastilles des véhicules en colonne dessous ; zone santé / arme / recherche prévue en haut au centre, vide (`body.layout` la montre pour les captures). Joystick et pédales n'ont pas bougé.
- **Menu pause** (⏸, Échap, P ; en voiture comme à pied) : reprendre, carte, réglages, lieux notés, sauvegarde. La pause fige les véhicules, le soleil et l'horloge ; le rendu continue à 4 Hz derrière le menu (coupé sous la carte). Réglages en direct, enregistrés localement : définition, ombres, rayon de détail, sensibilité de la caméra, minimap ; les paramètres d'URL restent prioritaires (réglage grisé).
- **Minimap** (canvas 2D rond, rayon 180 m, 16 Hz, tourne avec la caméra ou nord fixe) : routes, trottoirs, eau, pelouses, bâtiments, joueur, véhicules garés proches, repère (flèche au bord et distance hors champ). Coût chronométré (`Minimap.cost`) dans le panneau de debug et dans le rapport du banc.
- **Carte agrandie** : tout l'anneau, déplacement et pincement, noms de rues, lieux par catégorie avec filtres, fiche au tap, joueur et direction ; appui long = pose ou retire le repère, visible sur la minimap et dans le monde (colonne et losange).
- **Données** (`tools/data/build_map.py`, 1,3 Mo, aucune tuile régénérée) : 9 images de 1 km à 1 m et 2 m par pixel, vue d'ensemble à 4 m, `places.json` (271 lieux en 14 catégories dont `perso`, 246 rues nommées). `tools/data/places_perso.json` pour tes propres lieux.
- **Notes de lieu** (menu pause) : position, direction, heure, texte et capture (IndexedDB) ; copier le texte ou télécharger le JSON.
- **Sauvegarde locale** : position, caméra, véhicule conduit, véhicules déplacés, heure et jour, repère ; à la pause, en quittant la page, toutes les 30 s ; « Nouvelle partie ». Les paramètres de test (`?at=`, `?h=`…) coupent la sauvegarde.
- Tests : 146 (conversion monde/carte, zoom et déplacement, repère, sauvegarde et réglages, notes, véhicules déplacés, départ de partie, horloge). `tools/ui.sh` rejoue les écrans en tactile.

Mesuré ici (`?bench=court`, conteneur sans carte graphique : le rendu logiciel occupe les mêmes cœurs, les chiffres sont donc pessimistes) : mise à jour de la minimap à 0,21-0,33 ms en moyenne (pire cas 0,6 à 4,5 ms, lors d'à-coups du rendu logiciel), soit moins de 0,1 ms par image à 16 Hz ; objectif d'1 ms tenu en moyenne. Le banc (`?bench=1`) et le viewer (`?view=`) fonctionnent toujours.

À vérifier sur le téléphone : coût réel de la minimap (`?debug`, puis `?bench=1` : ligne « Minimap » de chaque phase), ressenti de l'appui long (520 ms) et du pincement, clavier virtuel pendant la saisie d'une note (paysage), lisibilité de la minimap au soleil.

Constats : aucun commissariat dans l'anneau d'après OpenStreetMap (la gendarmerie est à ≈ 270 m à l'est de la zone) ; commerces et monuments très denses au centre (icônes omises en vue d'ensemble quand elles se recouvrent).

![HUD : minimap, horloge, zones santé / arme / recherche (pointillés), pause et plein écran](docs/captures/j1-hud-zones.jpg)
![Repère hors de la minimap : flèche sur le bord et distance](docs/captures/j1-hud-repere-loin.jpg)
![En voiture : l'interface ne gêne pas les pédales](docs/captures/j1-hud-voiture.jpg)
![Menu pause](docs/captures/j1-pause-menu.jpg)
![Réglages](docs/captures/j1-pause-reglages.jpg)
![Noter ce lieu](docs/captures/j1-pause-note-formulaire.jpg)
![Lieux notés](docs/captures/j1-pause-notes-liste.jpg)
![Sauvegarde](docs/captures/j1-pause-sauvegarde.jpg)
![Carte agrandie](docs/captures/j1-carte.jpg)
![Appui long : le cercle se remplit, puis le repère est posé](docs/captures/j1-carte-appui.jpg)
![Carte zoomée au pincement](docs/captures/j1-carte-zoom.jpg)
![Fiche d'un lieu](docs/captures/j1-carte-fiche.jpg)
![Filtres des lieux](docs/captures/j1-carte-filtres.jpg)
![Le repère dans le monde : colonne et losange](docs/captures/j1-jeu-repere-monde.jpg)

### Étape P (27 octobre 2026) : personnages et compteur — compteur de vitesse

Fait :
- **Compteur de vitesse** (`#speedo`, `src/ui/speedo.ts`, partie pure `src/core/speedo.ts`) : en bas au centre, seulement au volant (voiture, moto, vélo, trottinette). Chiffres en km/h, arc jaune moutarde qui passe au vermillon au-delà de 85 % de la vitesse maximale du véhicule (`spec.topSpeed`). Masqué en pause. L'indice de départ (« Joystick à gauche… ») est caché au volant pour ne pas passer sous le compteur. Le DOM n'est touché que quand la valeur affichée change.
- Tests : 5 (conversion, marche arrière, bornes de la fraction, vitesse maximale nulle, tous les véhicules). 151 tests au total.
- Captures : `tools/ui.sh <dossier> speedo` (voiture, voiture à fond, pause, vélo). Le rendu logiciel est trop lent pour accélérer vraiment : le scénario impose le vecteur vitesse à chaque image.

À voir sur téléphone : lisibilité des chiffres au soleil, place par rapport aux pouces (pédales à droite, joystick flottant à gauche).

- **Recette de personnage** (`src/core/character.ts`, logique pure) : sexe, âge (adulte, senior), taille, corpulence (4), teint (6), coiffure (9) et couleur (10), haut (9 dont gilet de chantier et tablier), bas (6), chaussures (3), chapeau (casque, béret, bonnet, casquette, chapeau), lunettes, sac, écharpe, barbe. Tirage déterministe par graine avec des poids vraisemblables (≈ 52 % de femmes, ≈ 28 % de seniors, hommes 1,78 m et femmes 1,65 m en moyenne, cheveux gris surtout chez les seniors, tenues de ville / sport / travail cohérentes : gilet fluo avec pantalon de travail et bottes, casque seulement avec gilet, pas de jupe pour les hommes). Les recettes ne stockent que des indices de palette. Lecture défensive (`parseRecipe`, champ par champ, taille bornée, version). `bodyDims` donne les mesures du corps (segments, largeurs, voûte des seniors) d'après des proportions anthropométriques, pour que le rendu et les tests s'accordent.
- Tests : 15 de plus (déterminisme, bornes et cohérence sur 3 000 graines, distribution, couverture de toutes les pièces, variété : sur 1 000 graines aucune recette identique, 0,03 % de paires qui partagent 15 critères sur 19 ou plus, sérialisation, mesures). 166 tests au total.

- **Prototypes de rendu** (nouvelle page `?proto=1`, `src/game/proto.ts`) : la même foule dessinée de trois façons, sur le même squelette (13 os, `src/core/character-rig.ts`), le même catalogue de 53 pièces (`src/core/character-kit.ts`, formes dans `src/render/character-parts.ts`, deux niveaux de détail : ≈ 1 350 triangles de près, ≈ 340 au loin) et la même pose de marche, pour que seule la façon de dessiner change :
  - **A, peau et os** (`crowd-skinned.ts`) : un `SkinnedMesh` par personnage, couleurs cuites dans les sommets. Un appel de dessin par personnage.
  - **B, instances et nuanceur** (`crowd-shader.ts`) : un seul appel de dessin pour toute la foule ; géométrie universelle (toutes les pièces), texture de données (13 matrices, couleurs, masque de pièces par personnage), peau faite dans le nuanceur de sommets.
  - **C, pièces groupées** (`crowd-parts.ts`) : un `InstancedMesh` par pièce du catalogue ; le processeur copie les matrices d'os dans les instances.
  Les trois donnent la même image (captures comparées). La série mesure, pour 50, 100 et 200 personnages (et 100 sans ombres des personnages) : fluidité, travail réel par image avec `gl.finish` (la limite de 60 Hz masque ce que vaut une image), coût du processeur (mise à jour, envoi du dessin), appels de dessin, triangles, mémoire. Rendu logiciel : la série tourne sans erreur, mais ses chiffres n'ont aucune valeur pour le téléphone (seuls les appels de dessin et les triangles se comparent : A ≈ 420 appels à 200 personnages, C ≈ 280, B ≈ 140 comme sans foule ; B envoie ≈ 3× plus de triangles, dont des dégénérés).
  - `?proto=look&r=A|B|C&n=24&seed=…` : rangée de personnages immobiles ou en marche (vue de face, `turn=3.14` de dos, `dist`, `gap`, `eye`) ; `tools/proto.sh <dossier> nom:requête …` pour les captures et l'essai court `proto=court`.
- Le panneau de rapport du banc est devenu `src/game/report-panel.ts`, partagé avec les prototypes.

**À faire sur le téléphone** : ouvrir `https://kalypst.github.io/autun-3D/?proto=1` (paysage, batterie chargée, mode économie d'énergie coupé), laisser tourner ≈ 2 minutes sans toucher l'écran, « Copier le rapport » et le coller dans la conversation. Le choix de l'approche (D37) se fera sur ces chiffres.

- **Mesure sur téléphone (Adreno 840)** : 60,3 i/s partout, même à 200 personnages avec les trois approches. Coût de la foule à 200 : A +5,4 ms, C +3,0 ms, **B +2,1 ms** (un seul appel de dessin). **B retenue** (D37) : tableau complet et limites dans `docs/DECISIONS.md`.

Suite de l'étape P : rendu du joueur et de ses poses (pédalage, assis, trottinette), apparence du joueur, banc de foule, galerie.
