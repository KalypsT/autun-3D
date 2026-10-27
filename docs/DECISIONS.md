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

## 2026-10-26 — D13. Déplacement à pied : collisions 2D, pas fixe, caméra qui se rétracte

- Collisions : le plan (x, y) suffit pour se balader. Contours des bâtiments et de leurs cours, murs OSM = segments ; mobilier et troncs d'arbres = cercles ; grille spatiale de 8 m. Le piéton est un cercle de 0,35 m repoussé hors des obstacles, sa vitesse perd la part qui entre dans le mur (il glisse). Les cours intérieures et passages couverts ne sont pas franchissables.
- Simulation à pas fixe de 1/60 s, indépendante des images affichées : même comportement à 30 ou 60 images/s. Les pas rapides (5 m/s ≈ 8 cm par pas) ne traversent pas les murs (test sur les vraies données : 120 trajets aléatoires de 8 s en courant).
- Caméra à la troisième personne : orbite autour de la tête ; un rayon vers la caméra raccourcit la distance devant un mur (marge 0,35 m, minimum 0,6 m) ; le personnage se masque sous 0,9 m ; la distance revient doucement quand le mur disparaît.
- Commandes : joystick flottant (moitié gauche de l'écran, à fond = course), regard au doigt (moitié droite), clavier (touches physiques WASD : fonctionne en AZERTY ZQSD), souris (glisser), plein écran + verrouillage paysage.
- Rendu en jeu : densité de pixels plafonnée à 1,5 et carte d'ombres de 2048 centrée sur le joueur (±80 m) pour économiser le téléphone ; à mesurer.

## 2026-10-26 — D14. Monde par tuiles de 250 m, détail près du joueur, silhouettes au loin

- Choix : zone de 6 × 6 tuiles alignées sur le Lambert-93 ; un objet appartient à la tuile de son centre. Chaque tuile est un JSON chargé à la demande ; `lod.json` (silhouettes simplifiées à 0,6 m) donne le reste. Relief et cartes de sol sont globaux (6 Mo) : plus simple que de les découper, et ils tiennent en mémoire.
- Rayon de chargement 210 m, déchargement à 300 m (hystérésis). Brouillard de 260 à 1 000 m : au-delà de 210 m on ne voit de toute façon que des volumes.
- Raison : toute la zone en détail fait 710 000 triangles et 490 appels de dessin, trop pour un téléphone milieu de gamme ; 8 tuiles en font 170 000 à 320 000.
- Alternative écartée : un second pipeline de LOD complet (toits, façades simplifiés) ; les silhouettes à partir des mêmes données suffisent à cette distance.

## 2026-10-26 — D15. Atlas de sprites rempli à la demande, avec recyclage

- Les sprites ne sont plus planifiés pour toute la ville : chacun est dessiné dans l'atlas partagé à la première tuile qui en a besoin (48 px/m, 3 pages de 2048 + 1 de 1024 pour les enseignes). 1 214 sprites distincts sur la zone, 834 tiennent ensemble.
- Quand les pages sont pleines, la moins récemment utilisée est vidée ; les tuiles qui s'en servaient masquent leurs sprites puis se reconstruisent (une par image). Alternative écartée : un atlas par tuile (trop d'appels de dessin et de textures).
- Mémoire de texture des atlas : ≈ 130 Mo avec mipmaps et cartes de normales. À réduire (KTX2, pages plus petites) si le téléphone ne suit pas.

## 2026-10-26 — D16. Relief par morceaux, sols en deux textures de poids

- Relief : morceaux de 250 m, pas de 2 m à moins de 110 m, 5 m jusqu'à 380 m, 12 m au-delà ; normales calculées sur le relief (pas par maillage) pour qu'elles se raccordent entre niveaux ; jupe de 3 m sous chaque bord pour cacher les fissures.
- Sols : deux PNG RVB de poids (asphalte/pavés/gravier ; herbe/trottoir/ombre près des murs), 1 m par pixel, avec mipmaps pour ne pas scintiller au loin ; le dallage est le complément à 1.
- OSM : l'API `map` par blocs de 500 m remplace Overpass quand celui-ci coupe les connexions (même données, même licence).

## 2026-10-26 — D17. Abandon du rendu réaliste, direction « affiche de voyage »

- Constat (test sur téléphone) : carte correcte, mais lenteurs, scintillement des fenêtres texturées et rendu peu esthétique ; les toits LiDAR laissaient des trous et des éclats.
- Choix : garder la cartographie (emprises, hauteurs BD TOPO, rues, relief, arbres, tuiles) et dessiner un style propre, sans texture externe : aplats, ombres en paliers, palette limitée, grain de papier léger ; façades **imaginées** par une grammaire (fenêtres, volets, portes, vitrines en petits volumes) plutôt que reconstituées. `?style=nuit` : même géométrie, fenêtres allumées (cycle jour/nuit à venir).
- Bâtiments : toits générés depuis l'emprise (D18), plus de relevé LiDAR de toits.
- Supprimés : atlas de sprites, textures de façade et de sol, cartes de normales (≈ 130 Mo de textures, 2 000 lignes de code).
- Conséquence : un maillage de bâti par tuile (murs, façades, murets, mobilier), un de toits, un de grilles, deux d'arbres.

## 2026-10-26 — D18. Toits générés

- Chaque pan est la région du toit la plus proche d'un bord de l'emprise (Voronoï de points échantillonnés sur les bords), à pente constante de 0,7 : un toit à quatre pans pour n'importe quelle emprise ; deux pans avec pignons pour les rectangles à peu près réguliers (62 %) ; plateau au-delà de 4,6 m de montée ; toit plat pour les annexes (< 14 m²) et les terrasses.
- Hauteur d'égout = hauteur BD TOPO × 0,94. Les fiches de façade sont recalculées sur ces emprises.

## 2026-10-26 — D19. Cycle jour/nuit par interpolation d'ambiances

- Le soleil vient de `core/sun.ts` (latitude d'Autun, jour de l'année, heure solaire). Quatre jalons selon sa hauteur (−10°, −3°, 3°, 15°) : nuit, crépuscule, couchant, jour ; ciel, brouillard, lumières, exposition sont interpolés entre deux jalons (`render/atmosphere.ts`).
- Lumière : le soleil ne descend pas sous 5° (jamais d'éclairage par en dessous), puis la lune prend le relais du côté opposé. Même matière, même géométrie jour et nuit : seules les couleurs de lumière changent, pas de seconde palette.
- Fenêtres et lampadaires : une couche chaude translucide posée sur 62 % des vitres (90 % des vitrines) et sur les lanternes, dont l'opacité suit la hauteur du soleil (de 3° à −6°) ; masquée en plein jour. Étoiles et nuages suivent aussi.
- Horloge : 1 heure de jeu = 50 s réelles par défaut (un jour en 20 minutes), réglable par `?speed=`, figée dans le viewer.

## 2026-10-26 — D20. Banc de test embarqué, mesures sur le téléphone de l'utilisateur

- `?bench=1` lance un parcours fixe (`src/game/bench-route.ts`, 2,6 km de plus courts chemins sur les rues carrossables), caméra en poursuite comme derrière un véhicule : arrêt sur la place (8 s), rues à 50 km/h, rues à 90 km/h, puis arrêt sans ombres et arrêt sans ombres en définition 1×. Heure figée à 16 h pour que deux rapports soient comparables.
- Mesures par phase : images/s moyennes et sur le 1 % le plus lent, durées d'image (médiane, 95 %, 99 %, max), à-coups (> 33 et > 50 ms) et part de ceux qui tombent sur une construction de tuile, appels de dessin et triangles, durée de chaque construction de tuile, mémoire géométrie et textures (estimation à partir de la scène), tas JavaScript quand Chrome le donne. Le rapport s'affiche à la fin (copier, télécharger en JSON) et porte la version (commit).
- Le conteneur de développement n'a pas de carte graphique : ses images/s ne valent rien. Seul le téléphone de l'utilisateur fait foi ; les chiffres indépendants de l'appareil (appels, triangles, mémoire) sont vérifiés ici.
- Cibles provisoires (Honor Magic 8 Pro) : 60 i/s de moyenne, 1 % le plus lent ≥ 40 i/s, aucune image > 50 ms en roulant à 50 km/h. À confirmer après le premier rapport.

## 2026-10-26 — D21. Véhicules : modèle « bicyclette » dynamique, chocs par impulsions

- Physique (`src/core/vehicle.ts`, logique pure, testée) : deux essieux, pneus à rigidité de dérive bornée par l'adhérence (cercle de frottement simplifié), inertie de lacet, puissance et force de traction, frein, résistance au roulement et de l'air, pente du relief réel. Sous 4 m/s, le modèle tend progressivement vers le modèle géométrique (lacet = v tan δ / L), le modèle dynamique étant instable à très basse vitesse. Deux sous-pas par pas de 1/60 s.
- Braquage maximal réduit avec la vitesse (max / (1 + (v / v₀)²)) et vitesse de braquage limitée : la direction au doigt reste stable à pleine vitesse.
- Chocs : l'emprise est une suite de cercles le long de l'axe, testés contre les collisions 2D existantes ; impulsion au point de contact avec restitution et frottement de Coulomb, donc un choc de biais fait pivoter le véhicule. Pas de dégâts pour l'instant.
- Deux-roues : l'inclinaison est l'équilibre entre gravité et accélération latérale (atan(v·ω / g)), lissée ; elle est visuelle, la physique reste plane.
- Vélo (`BIKE`) : 92 kg avec le cycliste, ≈ 250 W, on ne pédale plus au-delà de 27 km/h ; une côte de 8 % se monte vers 11 km/h, les descentes accélèrent au-delà. Freinage ≈ 6,7 m/s². À l'arrêt, le frein fait reculer à 1,2 m/s.
- Véhicules garés aux parkings à vélos d'OSM (2 ou 3 par parking, couleurs et orientation tirées de l'identifiant), qui deviennent les obstacles à la place de l'ancien cercle invisible du parking. Un véhicule quitté reste où on le laisse (jusqu'au rechargement). Monter à moins de 2,2 m ; descendre en roulant freine d'abord.
- Commandes (schéma A) : à gauche, glisser horizontalement pour diriger (70 px pour braquer à fond) ; à droite, pédales Pédaler et Frein ; le reste de la moitié droite sert à regarder, la caméra de poursuite se recale derrière après 1,2 s sans toucher. Clavier : Z/W ou flèche haut, S ou flèche bas, Q/A et D, espace, E pour monter et descendre.
- Rendu : un vélo = 4 maillages (cadre, direction, deux roues) en couleurs de sommets ; les véhicules garés à plus de 110 m ne sont pas dessinés.

## 2026-10-26 — D22. Trottinette électrique de location

- Même physique que le vélo, autres paramètres (`SCOOTER`) : moteur ≈ 500 W bridé à 25 km/h (limite légale), petites roues (adhérence 0,72, roulement deux fois plus fort), freinage ≈ 4,5 m/s², poussée à reculons à 1 m/s. Elle monte une côte de 8 % vers 20 km/h, mieux qu'un cycliste.
- Une trottinette au bout de chaque rangée de vélos (parkings à vélos d'OSM). Conducteur debout, un pied devant l'autre ; la pédale de droite devient « Accélérer ».
- Modèles de véhicules : interface commune `VehicleModel` (`src/render/vehicle-model.ts`), posture du conducteur portée par le modèle (« pedal » ou « stand »).

## 2026-10-26 — D23. Construction des tuiles en tranches, anticipation selon la vitesse

- Constat (profil sur processeur de PC) : une tuile dense coûte 150 à 340 ms d'un bloc — plan des façades 50-70 ms, éléments de façade 80-125 ms, assemblage du maillage « bâti » 50-65 ms, sols 15-60 ms. En roulant, chaque tuile aurait fait sauter 10 à 20 images.
- La construction devient un générateur (`buildTileSteps`, `planFacadesSteps`, `buildGroundSteps`, `MeshBuilder.buildSteps`) qui rend la main après chaque bâtiment, tous les 40 éléments de façade, chaque polygone de sol et tous les 90 000 flottants copiés. `TileManager` lui accorde 4 ms par image (`?budget=`, `?budget=1000` = d'un bloc pour comparer) ; une tuile se construit ainsi en quelques dizaines d'images. Le préchargement du départ reste d'un bloc.
- Les maillages d'une tuile neuve sont montrés un par image (l'envoi des sommets à la carte graphique est étalé) ; la silhouette reste visible jusqu'au dernier.
- Anticipation : la distance d'une tuile est la plus petite entre la position et le point atteint dans 3 s à la vitesse actuelle ; les tuiles devant sont chargées et construites d'abord.
- Les obstacles d'une tuile ne comptent qu'une fois sa construction finie. À 90 km/h, une tuile entre en chargement ≈ 11 s avant qu'on y arrive (210 m + 3 s d'anticipation) ; sa construction prend de l'ordre d'une seconde : la marge est large, mais à vérifier au banc sur téléphone si plusieurs tuiles attendent en même temps.
- Mesure (banc court, processeur de PC, rendu logiciel) : d'un bloc, la plus longue interruption atteint 963 ms (tuile 0_4) ; en tranches de 4 ms, une tuile de ≈ 210 ms de travail s'étale sur ≈ 35 images. Les étapes trop longues trouvées par instrumentation (enseignes dessinées dans l'atlas, très grands bâtiments, assemblage des vitres) rendent maintenant la main plus souvent.
- Limite : `JSON.parse` d'une tuile (jusqu'à ≈ 1 Mo) reste d'un bloc sur le fil principal ; à déplacer dans un worker si le banc le montre.

## 2026-10-26 — D24. Voiture : citadine à traction avant, voitures garées sur les places marquées

- Physique (`CAR`) : 1 250 kg, 66 kW (≈ 56 kW aux roues), 0 à 100 km/h en ≈ 12 s, 175 km/h, freinage ≈ 0,9 g (50 km/h → arrêt en ≈ 10 m), braquage 35° réduit avec la vitesse, pneus de tourisme ; motricité bornée par l'adhérence des roues avant (traction), frein moteur, roulis de caisse visuel vers l'extérieur du virage. Emprise : trois cercles de 0,82-0,85 m sur l'axe.
- Places de stationnement : retrouvées dans le jeu à partir du marquage au sol (deux traits de ≈ 4,8 m parallèles à ≈ 2,5 m), sans régénérer les données (`src/core/parking.ts`, 1 163 places sur la zone). 30 % sont occupées, couleur et sens de stationnement tirés de la position ; aucune voiture dans les 4 m du point de départ.
- Rendu : voitures garées en deux maillages instanciés pour toute la ville (peinture teintée par instance, détails et roues) dans un rayon de 170 m, mis à jour tous les 10 m de déplacement ; la voiture conduite reçoit un modèle articulé (caisse qui prend le roulis, quatre roues, braquage des roues avant). Le conducteur n'est pas dessiné (vitres sombres).
- Escaliers : obstacles réservés aux voitures (`Fleet.carOnly`, emprise des zones `stairs`), retirés avec la tuile.
- Chocs : les véhicules garés sont des obstacles fixes (masse infinie) ; les pousser viendra avec la circulation (étape 3).
- Caméra de poursuite par type (distance, recul avec la vitesse, hauteur) ; on monte à moins de 3 m d'une voiture, on en descend côté conducteur (gauche).

## 2026-10-26 — D25. Moto de moyenne cylindrée

- Physique (`MOTO`) : 265 kg avec le pilote, 35 kW (≈ 32 kW à la roue), 0 à 100 km/h en ≈ 5,5 s, 170 km/h, freinage ≈ 0,9 g ; seule la roue arrière est motrice (motricité bornée) ; frein moteur ; inclinaison des deux-roues (jusqu'à ≈ 43°).
- Garées par deux sur 4 % des places de stationnement (en plus des 30 % de voitures). Pilote assis, buste penché vers le guidon. `?ride=moto`.
- Modèle : quatre maillages (cadre avec réservoir, moteur et échappement ; direction avec fourche, guidon et phare ; deux roues), angle de chasse de 24°.

## 2026-10-27 — D26. Réglages par défaut relevés d'après le banc sur téléphone

- Mesures (Honor Magic 8 Pro, Adreno 840) : 60 i/s sur toutes les phases en définition native (×2,975), ombres 4096 et détail à 400 m ; seule baisse : 1 % le plus lent à 49 i/s à 90 km/h avec 400 m de détail, mémoire JavaScript 169 Mo (88 Mo à 210 m). Le navigateur cadence à 60 Hz : la marge au-delà reste inconnue.
- Nouveaux défauts en jeu : définition ×2,5 au plus (au lieu de 1,5), carte d'ombres 4096 (au lieu de 2048), détail jusqu'à 300 m (au lieu de 210). On ne prend pas le maximum mesuré : le banc dure 3 minutes, la cible est 30 minutes de jeu, et la chauffe peut faire baisser la cadence d'un téléphone sur la durée.
- À vérifier : une partie de 30 minutes sans baisse de fluidité ni chauffe gênante. Les paramètres `?dpr=`, `?shadowmap=`, `?detail=` restent disponibles pour comparer.

## 2026-10-27 — D27. Freinage par essieu, roues qui se bloquent, braquage borné par l'adhérence

Retour d'essai : « frein à revoir, avec dérapages » ; « direction à adapter à haute vitesse » ; « pas trouvé de vélo ».
- Freinage : réparti entre l'avant et l'arrière (voiture 80/20, deux-roues 50-70 % à l'avant), avec report de charge (hauteur du centre de gravité) : l'avant s'écrase, l'arrière s'allège. Chaque essieu a un « cercle d'adhérence » : ce qui sert à freiner ou à tracter ne sert plus à tourner.
- Une roue freinée au-delà de son adhérence se bloque (voiture sans ABS) : elle glisse avec 75 % de l'adhérence, dans le sens de son mouvement, et ne dirige plus. Répartition réglée pour que l'avant bloque d'abord : la voiture file tout droit au lieu de partir en tête-à-queue. Deux-roues : frein avant toujours dosé (pas de chute modélisée), l'arrière peut bloquer.
- Pédale tactile tout ou rien : la pression monte en 0,7 s tant qu'on appuie (un appui bref ralentit, un appui long bloque) et retombe en 0,15 s. Voiture lancée à 50 km/h, frein maintenu : arrêt en ≈ 15 m roues avant bloquées.
- Traces de pneus au sol derrière les roues bloquées ou à la limite d'adhérence (un maillage instancié, 1 500 segments recyclés).
- Braquage : en plus de la réduction avec la vitesse, borné à ce que les pneus peuvent tenir (v² δ / L ≤ 1,15 × adhérence) ; plein braquage en 0,35 s au plus ; course du doigt progressive (puissance 1,6) pour les petites corrections.
- Repères à l'écran : un par type de véhicule (🚲 🛴 🏍️ 🚗), car les voitures garées partout masquaient les vélos.

## 2026-10-27 — D28. Bords de chaussée : feux, troncs et couronnes ; direction plus vive

Retour d'essai : feux encore au milieu de la route, arbres sur le bord de la route, feuillages trop gros ou trop bas qui masquent la route, direction trop molle.
- `tools/data/roadside.py` (appelé par `build_tiles.py`, exécutable seul sur les tuiles publiées) : feux encore dans la chaussée (8 sur 29, aux carrefours : le décalage perpendiculaire à une rue tombait dans la rue qui croise) posés au point de trottoir le plus proche ; troncs dans la chaussée (54) poussés sur le bord, supprimés s'ils en sont à plus de 3 m ; couronnes qui débordent sur la chaussée élaguées comme des arbres d'alignement, à 4 m au moins (313), ou réduites quand l'arbre est trop petit (167). Un test vérifie qu'aucun feu ni tronc n'est dans la chaussée.
- Rendu des arbres : le feuillage commence en haut du tronc (et non plus à 60 % de sa hauteur).
- Direction : braquage permis jusqu'à 1,4 × l'adhérence à haute vitesse (on peut dépasser la limite et sentir glisser), plein braquage en 0,2 s, course du doigt moins atténuée (exposant 1,3). Conséquence voulue : braquage à fond à 50 km/h, l'arrière décroche peu à peu ; la voiture se remet droite en ≈ 1 s quand on relâche, ≈ 0,5 s en contre-braquant.
