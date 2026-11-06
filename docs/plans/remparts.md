# Les remparts : plan (lot 0, relevés)

Enquête du 6 novembre 2026, sur `main` (D249). Rien n'est modifié dans le jeu : ce fichier, le script de relevés `tools/data/survey_remparts.py`,
la carte `docs/captures/remparts-carte.png` et une capture « avant » sont les seuls ajouts. Repère local du jeu (x vers l'est, y vers le nord), mètres.

## 0. Ce qu'il faut retenir

1. **Le jeu a 14 murs (3 144 m), tous en boîte de 6 m × 1,3 m posée sur le relief.** Le relevé montre que c'est faux sur les deux tiers :
   **2 139 m sont des murs de soutènement**, au niveau de la ville d'un côté et hauts de 5 à 10 m de l'autre ; 785 m sont des murs libres
   (jusqu'à 18 m côté extérieur au sud, rue de Breuil) ; 221 m sont arasés ou invisibles.
2. **La maçonnerie est déjà dans le relief, en herbe.** Comme à Couhard, l'IGN range le parement en « sol » (classe 2) : sur les murs de soutènement,
   90 à 100 % des points du haut sont du « sol ». Le jeu montre donc **un talus vert de 5 à 10 m surmonté d'une boîte beige** (capture ci-dessous).
   Le lot 1 doit couper ce talus et le remplacer par la face du mur.
3. **Les tours se voient mal au LiDAR.** 22 saillies hautes de 3 à 9,5 m côté extérieur sont retenues, mais beaucoup tombent sur une seule station
   (4 m) et certaines sont sans doute des contreforts, des appentis ou des arbres mal classés. Aucune tour n'est dans OpenStreetMap. **Il faut une
   liste et des photos** (§5).
4. **Panoramax ne sert à rien ici** : aucune de ses photos n'est à moins de 35 m d'un mur (57 à moins de 250 m). Les murs sont derrière des
   jardins, en contrebas de boulevards, ou dans des terrains clos. **Les photos de l'utilisateur sont la seule source d'aspect.**
5. **Il manque au moins 235 m à la pointe sud** (de (−1 ; −942), boulevard Mac Mahon, à (175 ; −787), rue Chaffaut), et toute la moitié nord de
   l'enceinte romaine est absente d'OpenStreetMap, comme ses tours.
6. **Une promenade sur le mur existe peut-être** : un sentier OSM (`426304451`) suit sur 94 m le haut du mur de soutènement de l'est (R10-R11), de
   (811 ; 62) à (715 ; −39). À confirmer sur photo. Aucun autre chemin n'est sur un dessus de mur.

![Avant : R11, vu du pied, côté extérieur](../captures/remparts-avant-r11.jpg)

*R11 aujourd'hui, vu du pied côté extérieur : le parement de 10 m est un talus d'herbe, la boîte de 6 m flotte sur la terrasse.*

## 1. Décisions de l'utilisateur (6 novembre 2026)

| Question | Réponse |
|---|---|
| Portions disparues | **Ne rien montrer.** |
| Dessus des murs | **Promenade seulement là où l'on marche en vrai.** Ailleurs, le mur reste infranchissable. |
| Enceinte médiévale du Château et du Marchaux | Laissée à ma recommandation (§2). |
| Photos | L'utilisateur fournira celles du §5. |

## 2. Château et Marchaux : recommandation

De l'Antiquité tardive à la fin du Moyen Âge, Autun s'est repliée sur deux pôles fortifiés à l'intérieur de la grande enceinte romaine. Ce qui suit
vient de mémoire et de sources secondaires : à vérifier, et la vérification n'a pas pu être faite depuis cette session (Wikipédia et culture.gouv.fr
bloqués par le réseau).
- **Le Château** : la ville haute du sud, autour de la cathédrale (centroïde en (37 ; −574)). Son mur reprend le mur romain au sud, à l'est et à
  l'ouest, et le ferme au nord par un mur neuf. Les tronçons R18 à R31 l'entourent.
- **Le Marchaux** : le bourg marchand, plus au nord, enclos plus tard. Son mur a presque entièrement disparu ; les boulevards l'ont souvent
  remplacé. Les tronçons R40 à R42, le long du boulevard Laureau, sont **à l'intérieur** de la ligne entre la porte d'Arroux et la porte
  Saint-André. Ce ne peut donc pas être le mur romain du nord, contrairement à ce que dit OSM (« Rempart romain ») : peut-être un reste du Marchaux.
  Le restaurant « Les Remparts », au coin du boulevard Laureau, va dans ce sens.

**Recommandation : un seul critère, « ce qui est debout aujourd'hui », quelle que soit l'époque.** Il découle de la réponse « ne rien montrer
des portions disparues ». Le Château est alors pris en entier sans travail de plus : ses murs sont ceux du sud de l'enceinte romaine. Du Marchaux,
on ne garde que les morceaux qui se voient (R40-R42 peut-être). L'époque ne sert qu'à choisir l'aspect : petit appareil romain, ou moellons
médiévaux plus irréguliers.

## 3. Relevés

Script : `python3 tools/data/survey_remparts.py` (≈ 3 min la première fois, quelques secondes ensuite). Il lit OpenStreetMap, le nuage LiDAR HD
(bande de 15 m de part et d'autre de chaque mur, dalles COPC lues à distance) et Panoramax ; tout est mis en cache dans `.cache/remparts/`.

Un profil en travers tous les 4 m (±12 m) donne :
- le **sommet** : 90ᵉ centile des points non classés, sol et bâti à moins de 2,5 m de l'axe ;
- le **sol de chaque côté** : classe 2, de 4 à 12 m ;
- la **largeur du dessus** : bandes à moins de 0,8 m du sommet ; 6 m ou plus, c'est une terrasse.

Le côté « ville » est celui qui regarde le centroïde des murs (242 ; −378).

Natures : *mur libre* (plus de 2 m des deux côtés) ; *soutènement* (moins de 1 m d'un côté, ou dessus de 6 m ou plus) ; *arasé* (moins de 2 m) ;
*rien de visible* (moins de 0,8 m). Précision attendue : ±0,5 m en hauteur. Sous les arbres (colonne « vég »), le sommet peut être sous-estimé.

### 3.1 Tronçons

Numérotés de R01 à R42 dans le sens horaire depuis le nord-est, chaque mur OSM coupé en morceaux d'environ 80 m. « h ville » négatif : la terrasse
est un peu plus haute que le sommet mesuré (parapet absent ou arbres). Rue : la plus proche, avec sa distance au milieu du tronçon.

| n° | Rue la plus proche | Long. | Nature | h ville | h ext. | Sol % | Remarque |
|---|---|---|---|---|---|---|---|
| R01 | rue de la Jambe de Bois (28 m) | 38 | mur libre | 4,5 | 5,3 | 0 | à l'intérieur de l'enceinte : mur de terrasse du lycée militaire ? |
| R02 | rue de la Maladière (12 m) | 79 | soutènement | −4,9 | 2,5 | 100 | |
| R03 | rue de la Maladière (9 m) | 79 | soutènement | −0,9 | 8,4 | 100 | |
| R04 | place du Capitaine Louis Leberger (12 m) | 96 | soutènement | 0,5 | 5,9 | 90 | à l'intérieur, avec R01 et R09 |
| R05 | rue de la Maladière (8 m) | 79 | soutènement | 0,1 | 8,6 | 100 | 3 saillies (tours ?) vers (990 ; 250-300) |
| R06 | rue de la Maladière (46 m) | 82 | mur libre | 1,4 | 7,8 | 8 | |
| R07 | rue de la Maladière (75 m) | 82 | soutènement | 0,9 | 8,9 | 39 | |
| R08 | rue de la Maladière (83 m) | 82 | soutènement | −0,3 | 8,2 | 100 | |
| R09 | rue Gaston Joliet (7 m) | 96 | soutènement | 1,0 | 5,1 | 42 | à l'intérieur |
| R10 | (cœur d'îlot) | 82 | soutènement | −1,3 | 6,7 | 93 | sentier sur le dessus ? |
| R11 | (cœur d'îlot) | 82 | soutènement | −0,2 | 9,7 | 100 | capture « avant » ; sentier sur le dessus ? |
| R12 | chemin du Hêtre Pourpre (47 m) | 82 | soutènement | −1,2 | 6,3 | 100 | |
| R13 | rue Gaston Joliet (6 m) | 42 | mur libre | 1,3 | 7,3 | 55 | |
| R14 | rue Gaston Joliet (6 m) | 85 | soutènement | 0,2 | 4,1 | 99 | |
| R15 | ruelle Sainte-Anne (33 m) | 85 | arasé | −0,3 | 1,3 | 100 | sous les arbres |
| R16 | ruelle Sainte-Anne (46 m) | 85 | rien de visible | −0,1 | 0,7 | 100 | sous les arbres : le mur existe-t-il ? |
| R17 | rue du Vieux Colombier (47 m) | 85 | soutènement | 1,4 | 7,4 | 72 | |
| R18 | rue du Vieux Colombier (4 m) | 72 | soutènement | 0,2 | 5,5 | 93 | |
| R19 | rue du Vieux Colombier (12 m) | 72 | soutènement | 0,1 | 5,1 | 99 | |
| R20 | rue du Vieux Colombier (29 m) | 51 | arasé | 1,1 | 0,1 | 100 | branche vers l'est : mur de jardin ? |
| R21 | rue du Vieux Colombier (49 m) | 72 | soutènement | 0,2 | 5,7 | 100 | |
| R22 | rue Blanche (33 m) | 72 | mur libre | 6,1 | 13,0 | 0 | sans doute un bâtiment adossé (0 % sol) |
| R23 | rue de Breuil (34 m) | 72 | mur libre | 8,5 | 14,7 | 0 | idem |
| R24 | rue de Breuil (32 m) | 59 | mur libre | 10,8 | 18,0 | 0 | saillie de 23 m vers (173 ; −772) : tour ? |
| R25 | rue Blanche (5 m) | 54 | mur libre | 7,2 | 6,3 | 0 | branche vers l'ouest |
| R26 | boulevard Mac Mahon (9 m) | 79 | soutènement | 0,0 | 7,7 | 100 | |
| R27 | boulevard Mac Mahon (7 m) | 79 | mur libre | 2,4 | 10,4 | 0 | 2 saillies vers (−35 ; −840 à −870) |
| R28 | boulevard Mac Mahon (8 m) | 79 | soutènement | 0,8 | 8,8 | 30 | |
| R29 | boulevard Mac Mahon (9 m) | 79 | mur libre | 0,4 | 8,3 | 96 | |
| R30 | boulevard Mac Mahon (11 m) | 79 | soutènement | 0,1 | 8,9 | 100 | |
| R31 | boulevard Mac Mahon (9 m) | 79 | soutènement | 0,1 | 7,3 | 100 | 2 saillies vers (−85 ; −550) |
| R32 | bd des Résistants Fusillés (7 m) | 75 | soutènement | 0,1 | 6,2 | 100 | |
| R33 | bd des Résistants Fusillés (9 m) | 75 | soutènement | 0,2 | 5,3 | 100 | |
| R34 | bd des Résistants Fusillés (8 m) | 75 | soutènement | 0,2 | 5,0 | 95 | |
| R35 | bd des Résistants Fusillés (7 m) | 75 | soutènement | 0,1 | 6,2 | 0 | maçonnerie classée bâti |
| R36 | bd des Résistants Fusillés (6 m) | 75 | soutènement | 0,2 | 5,7 | 87 | |
| R37 | bd des Résistants Fusillés (6 m) | 75 | soutènement | 0,5 | 4,9 | 88 | |
| R38 | bd des Résistants Fusillés (4 m) | 75 | soutènement | 0,5 | 4,7 | 93 | |
| R39 | bd des Résistants Fusillés (18 m) | 75 | soutènement | 0,3 | 3,8 | 100 | saillie vers (−354 ; −60) |
| R40 | boulevard Laureau (16 m) | 69 | mur libre | 2,2 | 2,2 | 54 | Marchaux ? (§2) ; piste cyclable au pied |
| R41 | boulevard Laureau (15 m) | 69 | mur libre | 1,3 | 2,1 | 94 | |
| R42 | boulevard Laureau (16 m) | 69 | mur libre | 0,7 | 2,3 | 87 | saillie vers (204 ; 474) |

Le détail par station (tous les 4 m) est dans `.cache/remparts/survey.json`.

### 3.2 Trous dans le tracé

| De → à | Longueur | Lecture |
|---|---|---|
| (−1 ; −942) bd Mac Mahon → (175 ; −787) rue Chaffaut | **235 m** | Pointe sud de l'enceinte, absente d'OSM. À relever au lot 1 (ligne de crête LiDAR) et à photographier. |
| (969 ; 216) → (938 ; 158), rue de la Maladière | 66 m | Rue ou brèche ? |
| (260 ; −652) → (218 ; −651), rue Blanche | 42 m | Entre R20 et R25. |
| 7 autres trous | 5 à 23 m | Raccords de dessin OSM ; à fermer au lot 1. |

**Moitié nord** : rien dans OSM entre R39 (bd des Résistants Fusillés, vers (−340 ; −30)) et la porte d'Arroux, ni entre R02 (rue de la Maladière,
(950 ; 480)) et la porte Saint-André (545 ; 844). D'après la brochure archéologique de la DRAC (lue seulement dans un résumé de recherche), environ
deux tiers de l'enceinte augustéenne subsistent, avec 30 tours. Il resterait donc des portions debout hors d'OSM. Le lot 1 cherchera des marches
nettes dans le LiDAR le long du tracé historique ; il faut pour cela un plan de l'enceinte (question 1, §6).

### 3.3 Promenades

Un seul chemin OSM est sur un dessus de mur : le sentier `426304451`, sur 94 m (R10-R11, de (811 ; 62) à (715 ; −39)). Trois autres sentiers
longent le pied de R07 à R12 (18 à 44 m chacun), et la piste cyclable du boulevard Laureau longe le pied de R40-R42 (98 m). La promenade sur le
dessus ne sera faite **que là où une photo montre des gens qui y marchent** (garde-corps, sol stabilisé, bancs).

## 4. Méthode proposée (lots 1 à 4)

- **Lot 1, forme** : tracé complet (OSM, trous, pointe sud, portions retrouvées au nord) ; profil mesuré tous les 4 m. Le mur devient un ruban
  de hauteur variable de chaque côté : pied au sol extérieur, sommet mesuré, parapet de 0,9 m là où la ville est au niveau du sommet. Le relief est
  creusé sous la face (fin du talus d'herbe). Les collisions suivent le nouveau tracé. Les portions disparues : rien.
- **Lot 2, aspect** : 4 à 6 types de parement (petit appareil romain, moellons médiévaux, partie restaurée, mur envahi de lierre, mur arasé dans
  les jardins). Chaque tronçon en reçoit un, d'après photo, sinon par déduction notée dans le plan avec sa certitude. Variations régulières
  par tronçon (teinte, lierre, mousse au pied, couronnement herbeux), pour la cohérence d'ensemble.
- **Lot 3, tours** : une liste vérifiée (photos et plan), un modèle de tour semi-circulaire saillante réglé sur les mesures LiDAR de chacune,
  un modèle à part pour les tours médiévales.
- **Lot 4, promenade et vie** : la promenade sur le dessus là où elle existe (sol, garde-corps, file des passants), les chauves-souris du
  crépuscule autour des remparts (D203 : mises sur la cathédrale faute de tracé), et le défaut déjà noté des panneaux bruns qui flottent
  au-dessus du talus vers (990 ; 255).

Budget : environ 6 km de mur au plus, en ruban de 4 faces par station de 4 m, soit de l'ordre de 12 000 triangles pour toute l'enceinte, répartis
sur une dizaine de tuiles.

## 5. Photos demandées

Pour chaque point : **une photo d'ensemble** (à 20-40 m, le mur entier dans le cadre), **une de près** (1 à 2 m, la pierre et le mortier
nets) et, si on peut y monter, **une du dessus**. Noter si possible la rue et le sens de la prise de vue (ou garder la localisation de la photo).
Par ordre d'importance :

| # | Où | Pourquoi |
|---|---|---|
| 1 | **Boulevard des Résistants Fusillés** (R32-R39), face au mur, depuis le boulevard | Le plus long tronçon (600 m) : il fixera le type « soutènement romain ». |
| 2 | **Boulevard Mac Mahon** (R26-R31), sous la cathédrale ; les deux saillies vers R27 et R31 | Côté ouest du Château ; murs libres R27 et R29 : sont-ils différents ? |
| 3 | **Pointe sud**, entre le bout du boulevard Mac Mahon et la rue Chaffaut ; **rue de Breuil** (R23-R24) | Trou de 235 m dans OSM ; mur de 15 à 18 m mesuré : tour, bâtiment adossé ou mur ? (tour des Ursulines ?) |
| 4 | **Rue de la Maladière** et le sentier au-dessus (R02-R12) ; la saillie vers (990 ; 250-300) | Promenade sur le dessus ? Tours ? Les photos du sentier `426304451` décident de la promenade. |
| 5 | **Rue du Vieux Colombier, rue Blanche** (R17-R22, R25) | Soutènement du sud-est, et branches R20 et R25 : rempart ou mur de clôture ? |
| 6 | **Boulevard Laureau**, le long de la piste cyclable (R40-R42) | Romain, médiéval (Marchaux) ou mur de clôture ? |
| 7 | **Rue Gaston Joliet, ruelle Sainte-Anne** (R13-R16) | R15-R16 : le LiDAR ne voit presque rien sous les arbres. Le mur est-il là ? |
| 8 | **Rue des Enfants de Troupe, place du Capitaine Louis Leberger** (R01, R04, R09) | Murs à l'intérieur de l'enceinte : rempart, ou murs de terrasse du lycée militaire ? |
| 9 | **Chaque tour que tu connais**, où qu'elle soit (et toute portion de mur au nord, entre la porte d'Arroux et la porte Saint-André) | Liste des tours ; portions absentes d'OSM. |

La carte numérotée (`docs/captures/remparts-carte.png`) sert de repère pour les numéros R.

![Carte des tronçons](../captures/remparts-carte.png)

## 6. Questions ouvertes

1. **Plan de l'enceinte** : as-tu (ou l'office de tourisme a-t-il) un plan des remparts avec les tours ? Une photo de panneau d'information
   suffit. Sinon, il faut autoriser `fr.wikipedia.org` et `www.culture.gouv.fr` dans le réseau de la session pour lire l'article et la brochure
   archéologique de la DRAC.
2. **R40-R42** (boulevard Laureau) : connais-tu ce mur ? Est-il romain ?
3. **Promenade** : sais-tu s'il y a un chemin sur le haut des remparts ailleurs que rue de la Maladière (par exemple le long des boulevards de
   l'ouest) ?
