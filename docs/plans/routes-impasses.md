# Routes qui finissent à la mer : raccourcir et terminer proprement

Rédigé le 8 novembre 2026 après l'extension de la route de Chalon (D286), à la demande de l'utilisateur : « retirer les bouts de routes
qui ne mènent à rien, car au bord de la map et ont pour destination la falaise et la mer ». Choix de l'utilisateur : **a + b** (raccourcir
chaque route à ce qu'elle dessert, puis une vraie fin de route). **Pas encore codé : questions ci-dessous à trancher d'abord.**

## 1. Constat

La côte (D105) coupe chaque route qui sortait de la ville. Les routes s'arrêtent au dernier point à terre : au bord d'une falaise (jusqu'à
130 m de haut), ou sur une plage dans la plaine. Les conducteurs de la circulation y disparaissent (impasse, D64), le joueur roule jusqu'au vide.

Inventaire (script d'analyse, données publiées après D286) : **26 branches sur une vingtaine de routes**, environ 6,3 km de chaussée en
trop. Une branche va du dernier carrefour jusqu'à la mer ; « desservi jusqu'à » est la distance, depuis ce carrefour, de la dernière chose
desservie (bâtiment à moins de 35 m de la route, ou chemin qui s'y raccorde) ; « retiré » est ce qui partirait en coupant 25 m après.

| Route | Type | Branche (m) | Bâtiments | Desservi jusqu'à (m) | Retiré (m) | Bout | Carrefour (x ; y) |
|---|---|---|---|---|---|---|---|
| Route de Broye | tertiaire | 718 | 4 | 182 | 511 | falaise 129 m | 1333 ; −1110 |
| Route de Château-Chinon | principale | 957 | 12 | 513 | 419 | falaise 24 m | −2154 ; 2263 |
| Chemin de Montmain | chemin | 383 | 0 | 0 | 383 | falaise 111 m | 1316 ; −1674 |
| Chemin Maison Forestière Feuillée | chemin | 473 | 1 | 72 | 376 | falaise 42 m | 1954 ; 1102 |
| Avenue du Commandant de Neuchèze | principale | 1304 | 13 | 943 | 335 | falaise 8 m | −899 ; 682 |
| Chemin de la Justice | chemin | 752 | 15 | 447 | 280 | falaise 22 m | 980 ; 3764 |
| Rue de Bourgogne | chemin | 835 | 50 | 531 | 279 | falaise 40 m | 1624 ; 1393 |
| Route du Carreau | chemin | 372 | 3 | 99 | 248 | falaise 30 m | −350 ; 4546 |
| Route de Pierrefitte (est) | chemin | 572 | 7 | 301 | 245 | falaise 10 m | −1340 ; 1281 |
| Chemin du Vieux Moulin | chemin | 464 | 5 | 196 | 244 | falaise 32 m | 1954 ; 1102 |
| Route du Bois de Sapin | chemin | 666 | 32 | 403 | 238 | falaise 29 m | −1411 ; −400 |
| Route d'Arnay | principale | 283 | 5 | 27 | 232 | falaise 16 m | 1108 ; 4297 |
| Route du Puits d'Alligny | chemin | 387 | 4 | 139 | 223 | falaise 10 m | −375 ; 2042 |
| Route de Pierrefitte (ouest, isolée) | chemin | 220 | 0 | 0 | 220 | **plage** | −2116 ; 902 |
| Route de Chalon (après le chemin des Ragots) | principale | ≈ 335 | 0 | ≈ 140 (piste forestière) | ≈ 170 | falaise ≈ 75 m | 2493 ; 86 |
| Route de Saint-Denis | tertiaire | 621 | 51 | 400 | 196 | falaise 41 m | 1264 ; 1936 |
| Rue Marie Noël | chemin | 508 | 8 | 325 | 158 | falaise 30 m | 980 ; 3764 |
| Route de Beaune | principale | 587 | 8 | 420 | 142 | falaise 28 m | 1916 ; 1106 |
| Rue du Borgne | chemin | 538 | 36 | 380 | 134 | falaise 35 m | 1065 ; 2274 |
| Route Saint-Ferréol | secondaire | 623 | 7 | 487 | 111 | falaise 25 m | −299 ; 3916 |
| Rue des Mineurs (Télots) | rue | 111 | 0 | 0 | 111 | **plage** | −78 ; 4574 |
| Rue de Ménincourt | chemin | 831 | 18 | 755 | 52 | falaise 20 m | 1024 ; 2484 |
| Impasse de Cressy (Télots) | rue | 51 | 3 | à vérifier | ≤ 51 | falaise 18 m | 13 ; 4533 |
| Rue de la Descenderie, Ruelle des Corons (Télots) | rues | 42 à 148 | 3 à 6 | — | 16 à 44 | falaise 18 m | près de 67 ; 4517 |

« Bâtiments » compte ceux qui bordent toute la branche ; les routes habitées gardent toute leur partie habitée.

## 2. Ce qui sera fait (a + b)

**a. Raccourcir.** Pour chaque branche, point de coupe = dernière chose desservie + 25 m (bâtiment, entrée, parking, chemin ou piste qui
s'y raccorde). Une branche qui ne dessert rien disparaît jusqu'à son carrefour. Au-delà du point de coupe : plus de chaussée, de trottoir,
de marquage, de lampadaire, de feu ni de panneau ; le sol redevient celui d'autour (herbe, forêt, champ, d'après l'orthophotographie
comme ailleurs) ; plus d'arête de navigation (circulation et passants) ; la carte et la minimap suivent.

**b. Une vraie fin de route.** Au point de coupe : une **raquette de retournement** (aire arrondie en enrobé, assez large pour un demi-tour
de voiture) ou, sur une route étroite, une fin simple ; **barrière rouge et blanche** et deux ou trois plots en travers ; **panneau « voie sans
issue »** au dernier carrefour. Les voitures de la circulation y font demi-tour au lieu de disparaître (voir question 5).

**Liste figée et relue.** Le calcul est automatique, mais le résultat est écrit dans `manual.json` (`deadEnds` : voie, point de coupe, type
de fin), relu avec toi sur captures avant la fabrication. Les cas douteux ci-dessous y sont réglés à la main.

## 3. Comment (technique)

- Pas de régénération de la ville : un script de retouche `build_dead_ends.py`, comme `build_streetscape.py` ou `build_parking.py`, qui
  modifie seulement les tuiles touchées (≈ 25 tuiles) : sols vectoriels (chaussée, trottoir, bordures, marquages coupés au point de
  coupe ; raquette ajoutée), sols fins (pixels de route repeints avec le sol voisin), mobilier (lampadaires, feux, panneaux retirés
  ou ajoutés), puis navigation (arêtes routières et files piétonnes retirées au-delà de la coupe, sans renuméroter le reste) et images
  de la carte.
- Contrôles : aucune chaussée au-delà des coupes ; aucune arête de navigation à moins de 40 m de la côte sur ces routes ; plus aucun
  conducteur retiré en impasse sur ces routes dans les essais de circulation ; captures avant et après de chaque fin.
- Complexité : moyenne. Le plus délicat : les sols fins (images) et la navigation, où les super-tuiles mêlent ces routes à la ville.

## 4. Questions à trancher (tes réponses avant de coder)

1. **Les routes principales** (route de Château-Chinon, route de Beaune, route d'Arnay, avenue du Commandant de Neuchèze, route de Broye,
   route Saint-Ferréol, route de Chalon). Ce sont des entrées de ville : les couper à la dernière maison les fait finir en impasse en
   pleine campagne, parfois très tôt (route d'Arnay : il resterait 50 m sur 283 ; route de Broye : 200 m sur 718).
   Proposition : même règle que les autres routes. Variante : les garder jusqu'à un **belvédère** au bord de la falaise (petit parking,
   garde-corps, vue sur la mer), ce qui leur donne une destination, au lieu d'une raquette.
2. **Les deux routes qui finissent sur une plage** (route de Pierrefitte ouest, isolée, sans bâtiment ; rue des Mineurs aux Télots).
   Une route qui descend à la plage est cohérente. Proposition : les **garder** en « accès plage », avec un petit parking en bout ;
   sinon, les retirer comme les autres.
3. **Les chemins qui ne desservent rien** (chemin de Montmain, 383 m, entièrement retiré ; chemin de la Maison Forestière Feuillée,
   dont il resterait 100 m sur 473 ; route de Pierrefitte ouest si tu réponds « retirer » à la question 2). Proposition : retirer.
   Dis-moi si l'un d'eux te tient à cœur (vue, balade).
4. **Chemins et sentiers piétons** qui vont à la mer (non carrossables). Proposition : les laisser (ils ne gênent ni la circulation ni la
   conduite ; un sentier qui mène à une falaise peut finir en point de vue). Sinon, même traitement que les routes.
5. **Demi-tour des voitures de la circulation** dans les raquettes. Aujourd'hui, une voiture qui arrive dans une impasse est retirée
   (D64). Proposition : le faire dans ce lot (demi-tour en trois temps dans la raquette, avec les règles de priorité existantes) ; ou
   le reporter, la circulation n'allant plus dans ces bouts que rarement une fois les routes raccourcies.
6. **La fin de route** : raquette + barrière + plots + panneau « voie sans issue » partout, ou une forme plus simple (barrière seule) sur
   les petits chemins ? Proposition : raquette sur les routes principales et rues, barrière seule sur les chemins.
7. **Route de Chalon** : couper juste après la piste forestière des Granges de Brisecou (≈ 160 m après le chemin des Ragots), ou juste
   après le carrefour du chemin des Ragots pour que l'entrée du golf soit le vrai bout de la route ? Proposition : après la piste
   (elle mène à deux bâtiments au sud-est).
