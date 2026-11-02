# Passage Balthus : passage couvert entre la rue du Général-André-Demetz et la rue aux Cordiers (plan, lot 0)

**Avancement** : lots 1 (D187) et 2 (D188) faits ; lots 3 et 4 à faire. État retenu : consoles bleu et or (photos 4 à 6).

Enquête du 2 novembre 2026, sur la branche de travail (après D186). Rien n'a été modifié dans le dépôt, sauf ce fichier. Les six photos de
l'utilisateur ne sont pas versionnées : seule leur lecture est écrite ici. Coordonnées : repère local du jeu (x vers l'est, y vers le nord),
en mètres ; altitudes au-dessus de `originZ` (330 m) ; caps en degrés depuis le nord, sens horaire.

## 0. Ce qu'il faut retenir

1. **Aujourd'hui, le passage est un mur.** Le chemin OpenStreetMap (way 80940956, `pedestrian`, `tunnel=building_passage`) est sur la carte,
   mais `build_nav.py` écarte les passages couverts (`walkable`, « bloqués par les collisions », D13) et les bâtiments BD TOPO sont pleins.
   PROGRESS.md le note depuis le début : « Les passages couverts (Balthus, de la Terrasse) sont bloqués. »
2. **BD TOPO a coupé le passage en deux dans sa longueur.** L'axe OpenStreetMap suit exactement les murs mitoyens : entre le 12 et le 12 bis
   rue Demetz (`…348853287` et `…348853288`), puis entre le 28 et le 26 rue aux Cordiers (`…348853543` et `…348853545`). Le couloir se
   trouve donc à cheval sur quatre emprises : 2,5 m pris sur chacune, de part et d'autre de l'axe.
3. **Le LiDAR voit à travers la verrière** : sol plat à **3,97 m** (± 3 cm) sur 38,5 m. C'est la mesure la plus fiable du lot.
   - Rue Demetz devant la façade : 3,22 m. On **monte de 0,65 à 0,75 m** (quatre marches, visibles sur la photo 3).
   - Rue aux Cordiers : 6,43 m. On **descend de 2,45 m** depuis la rue aux Cordiers (environ 15 marches de 16 cm, l'escalier de la photo 2).
4. **Coupe** : corniches hautes de part et d'autre à **8,6 – 9,2 m** au-dessus du sol de la galerie, à ±2,5 m de l'axe. La largeur entre
   corniches fait donc environ 5 m. Le faîtage de verre n'est pas mesurable (le laser le traverse) ; d'après la photo 2, il serait vers
   10 – 10,5 m.
5. Pour le rendu, le principal obstacle technique est le **verre**. Le jeu dessine aujourd'hui le verre en plaques opaques dans le maillage
   plein (`glass` de `src/render/store.ts`), qui portent ombre. Une verrière dessinée ainsi donnerait un tunnel sombre. Il faut un
   maillage transparent qui ne porte pas d'ombre, ou bien une verrière en nervures seules.

## 1. Les photos

| n° | Ce que je lis | Lieu, caméra déduite | Certitude |
|---|---|---|---|
| 1 | Porte cochère en pierre à arc surbaissé, plafond à poutres, plaque bleue « PASSAGE BALTHUS », panneau d'information à droite. Au fond, une grille noire et une baie vitrée cintrée, puis la galerie en contrebas, sous la verrière. À gauche, une devanture rouge en bois (tourniquets de cartes) ; à droite, une devanture vert sombre à store vert « Chaussures M… ». Balcons en fer forgé à l'étage. | Entrée rue aux Cordiers (vers (10 ; −169)), caméra sur la rue vers le nord-ouest (cap ≈ 326°). Rouge à gauche = 28 rue aux Cordiers (La Promesse de l'Aube, D158) ; à droite, le 26. | 90 % |
| 2 | Vue en enfilade depuis le haut de l'escalier : volée large aux rampes de fer courbes qui s'évasent en bas, galerie à deux niveaux. En bas, devantures de bois brun-aubergine entre des pilastres ; au-dessus, une frise de rinceaux sculptés crème ; à l'étage, des colonnes blanches à chapiteaux corinthiens dorés devant des fenêtres ; une corniche dorée ; une verrière à deux pans sur fermes fines. Sol à carreaux octogonaux beige-saumon et cabochons bleu-gris. Une statue au milieu de l'allée, à mi-longueur. Au fond, un arc ouvert sur la rue. Décorations de Noël, filigrane de banque d'images. | Haut de l'escalier côté Cordiers, vers la rue Demetz (cap ≈ 326°). **Couleurs plus anciennes** : pas de bleu, contrairement aux photos 4 à 6. | 90 % |
| 3 | Façade classique en pierre sur la rue : grand arc central à grille et imposte vitrée, quelques marches, une boutique de chaque côté au rez-de-chaussée (affiches), balcons à l'étage, fronton triangulaire sculpté entre deux lucarnes, toit d'ardoise. Voitures garées. | Entrée rue Demetz (vers (−25 ; −116)), depuis la rue vers le sud-est (cap ≈ 146°). La façade couvre les bouts du 12 et du 12 bis, environ 13 m (6 + 6,8 m). Le LiDAR donne 11 à 12 m de haut au faîtage du pavillon. | 85 % |
| 4 | Grille de fer à imposte en éventail, galerie derrière, totem « Viva La Vie, les coiffeurs… », tourniquets de cartes postales d'Autun à droite. Consoles **bleu et or**, globes lumineux. Au fond, un arc et des marches qui montent. | Entrée rue Demetz, juste derrière la grille, vers la rue aux Cordiers (cap ≈ 146°). Les cartes postales viennent sans doute du Tabac Presse (12 rue Demetz, à droite donc côté nord-est). | 85 % |
| 5 | Statue de chien en bronze sombre, poils longs (type briard), sur un socle de pierre à plaque : « Œuvre de Paulette … 1922 Paris 1956 … » (lecture partielle). Derrière : devantures vitrées à cadres blancs, pilastres à consoles bleu et or, globes sur potences, frise de rinceaux blanche, colonnes à chapiteaux dorés à l'étage. | Au milieu de l'allée (photo 2). | 80 % (texte de la plaque : 40 %) |
| 6 | Gros plan de la tête du chien, même décor. | Même endroit. | — |

## 2. Données de la zone

Tuile **26_34**, super-tuile de navigation **s6_8** (comme la rue aux Cordiers, D158).

| Élément | Source | Valeur |
|---|---|---|
| Axe | OSM 80940956 | (−25,3 ; −115,7) → (5,0 ; −161,0) → (10,3 ; −169,2) ; 64,3 m ; cap 146° ; revêtement `paving_stones` ; dans `streets.json` (`tunnel: true`) et `map/places.json` (rue de rang 2) |
| 12 rue Demetz | BD TOPO `…348853287` | 356 m², sol 4,59, « Commercial et services », Tabac Presse (OSM 14018828464) ; côté nord-est de l'axe |
| 12 bis rue Demetz | `…348853288` | 364 m², sol 4,63, bande de 6 m sur 54 m ; côté sud-ouest de l'axe |
| 28 rue aux Cordiers | `…348853543` | 74 m², 1840, sol 6,50, La Promesse de l'Aube (livres) ; sud-ouest |
| 26 rue aux Cordiers | `…348853545` | 66 m², 1840, sol 6,41, La Promesse de l'Aube (jeux), La Manufacture ; nord-est |

**Profil le long de l'axe** (s = 0 au coin de la façade rue Demetz ; MNS et MNT LiDAR HD à 0,5 m, WMS IGN, fenêtre (−45 ; −190) – (30 ; −95)) :

| s (m) | Ce qu'on y trouve | Mesure |
|---|---|---|
| −8 à −1 | rue Demetz | MNT 3,20 – 3,25 |
| −1 à 0 | marches de la façade | 3,44 → 3,86 |
| 0 à 8 | pavillon de la rue Demetz (photo 3) | MNS 12,3 – 15,7 (faîtage vers 15,7) |
| 8 à 46,5 | **galerie vitrée** | MNS = MNT = 3,97 sur l'axe ; corniches à 8,6 – 9,2 au-dessus du sol |
| ≈ 45 à 50 | escalier (photo 2) | +2,45 m ; la position exacte du pied (± 1,5 m) se lira sur les photos 1 et 2 |
| 47 à 52 | toit bas au-dessus de l'escalier ou du palier | MNS ≈ 7,5 m au-dessus du sol de la galerie |
| 52 à 64,3 | porte cochère sous le 28 / 26 rue aux Cordiers (photo 1) | sol 6,4 (rue), bâtiment de 4 étages au-dessus (MNS jusqu'à 21) |

**Coupe transversale** (pas de 25 cm, tous les 2 m de s = 10 à 46) : le sol est visible sur 1,5 à 2 m autour de l'axe (centre à −0,1 m ±
0,2) ; la hauteur remonte jusqu'à 9 m entre |t| = 1 et 2,5 m (le laser frappe en partie le verre et les corniches). Les ailes latérales
sont plates à 8,7 – 9,2 m au-dessus du sol de la galerie, soit 12,7 – 13,2 m d'altitude, jusqu'à |t| = 6 m. **Correction (D187)** : j'avais d'abord
lu ce chiffre contre les 13,5 m d'égout de BD TOPO, qui sont des altitudes (le 12 bis a 9,5 m de haut) : les égouts sont justes ; ce sont les
faîtages de BD TOPO, tombés sur l'axe à 15,8 m, qui sont 2,5 m trop hauts.

## 3. Propositions

### A. Ouvrir seulement (petit lot)

Retrancher des quatre emprises une bande de 5 m centrée sur l'axe, puis poser un sol, les marches, l'escalier et une verrière simple.
Pas de décor intérieur. On traverse ; c'est un couloir beige.
*Pour* : rapide, sans risque. *Contre* : l'intérêt du lieu, c'est son décor ; on obtiendrait un tunnel sans charme, en contradiction avec
la méthode « d'après photos » suivie partout ailleurs.

### B. Modèle dédié d'après photos, en lots (**recommandé**)

La même méthode que pour la cathédrale (porche, D132), la porte d'Arroux (on passe sous les arches, D137) et les galeries de Bellevue
(vitrines, D145) : un modèle `passage` décrit dans `manual.json`, mesuré par `build_monuments.py`, dessiné dans le maillage de la tuile.
Les murs propres au modèle remplacent l'emprise comme obstacle, des tabliers servent de marches, et les passants le traversent.

### C. B, plus des boutiques où l'on entre

Je le déconseille pour l'instant : le jeu n'a aucun intérieur ouvert (les portes de la cathédrale restent fermées, D132). Il faudrait inventer
des intérieurs sans photos, et cela coûterait plus que tout le reste.

**Choix d'état** : les photos montrent deux décors. La photo 2 est plus ancienne, en crème et or avec des devantures brunes ; les photos 4 à 6
montrent des consoles bleu et or et des cadres blancs. Je propose l'état actuel (photos 4 à 6), à confirmer.

## 4. Plan (option B)

Chaque lot fait l'objet d'une décision (D187, D188…) avec ses captures avant/après dans `docs/captures/`. Il est vérifié par
`npm run typecheck && npm run lint && npm test && npm run build`, avec des captures `tools/shot.sh` à la même place que les photos de
l'utilisateur.

### Lot 1 : ouvrir le passage (emprises, sols, obstacles) — fait, D187

- `manual.json`, nouvelle entrée `monuments.balthus` : axe OSM, demi-largeur 2,5 m, abscisses des pièces (pavillon, galerie, escalier,
  porte cochère), niveaux mesurés (3,22 / 3,97 / 6,43), nombre de marches (4 et 15), relevés de la photo.
- `build_monuments.py` (`measure_passage`) : relit le MNT et le MNS (cache `raw/monuments`) et écrit un champ `passage` sur le 12 bis (le plus
  long des quatre), avec un repère `frame` (origine, cap 146°), les niveaux et les pièces. Une deuxième passe ne doit rien changer.
- **Emprises** : les quatre bâtiments sont découpés par la bande (ring de chaque reste, rangé dans `kinds`, comme le `roof` mesuré des
  magasins). Au-dessus de la galerie, les ailes sont ramenées à **8,9 m** (mesure) au lieu de 13,5 m. Au-dessus de la porte cochère et du
  pavillon, le bâtiment reste entier ; on ne retire que le volume du passage au rez-de-chaussée.
- **Obstacles** (`src/core/landmarks.ts`, sur le modèle de `cathedralWalls`) : deux longs murs le long des vitrines, les piédroits des deux
  arcs et les rampes de l'escalier. L'emprise BD TOPO ne bloque plus le couloir.
- **Tabliers** (`landmarkDecks`, comme `porchDecks`) : 4 marches côté Demetz, le palier de la galerie à 3,97, puis 15 marches et le sol de
  la porte cochère à 6,4.
- **Sol** : carrelage octogonal beige-saumon à cabochons bleu-gris dans la galerie, pavés dans la porte cochère.
- Tests : on va d'une rue à l'autre à pied, en restant dans la bande ; on ne traverse pas les vitrines ; les marches montent bien de 2,45 m ;
  à vélo, on ne passe pas l'escalier (comme la volée du porche) ; idempotence de la chaîne.

### Lot 2 : la galerie (décor intérieur) — fait, D188 (sans verre)

- 13 travées d'environ 2,95 m de chaque côté sur 38,5 m (nombre à recompter sur la photo 2).
- Rez-de-chaussée : vitrines à cadres blancs entre pilastres, consoles bleu et or, globes sur potences.
- Bandeau : panneaux blancs de rinceaux (en aplat, comme le tympan de la cathédrale) entre des dés.
- Étage : colonnes blanches à chapiteaux dorés devant des fenêtres, corniche dorée à 8,9 m.
- **Verrière** : deux pans du haut des corniches jusqu'au faîtage, vers 10,3 m ; fermes fines tous les 1 m environ, poutre faîtière. Le verre
  va dans un maillage **transparent qui ne porte pas d'ombre** : un appel de dessin de plus, seulement dans la tuile 26_34. Sinon, le
  soleil n'entre pas.
- Budget : moins de 8 000 triangles, comme la cathédrale ; test de borne.

### Lot 3 : les deux entrées

- Rue Demetz (photo 3) : façade de pierre d'environ 13 m, grand arc, grille à imposte en éventail, quatre marches, une boutique de chaque
  côté, balcons, fronton triangulaire entre deux lucarnes. Elle remplace les bouts génériques du 12 et du 12 bis.
- Rue aux Cordiers (photo 1) : arc surbaissé de pierre, plaque bleue « PASSAGE BALTHUS », plafond à poutres, portes rouges latérales, grille
  et baie vitrée cintrée au fond. Les devantures du 28 et du 26 (D158) sont reprises de part et d'autre de l'arc.
- L'escalier (photo 2) : volée large aux rampes de fer courbes évasées.

### Lot 4 : vie du lieu

- **Statue du chien** sur son socle, au milieu de l'allée. C'est un obstacle : cercle de 0,6 m.
- Passants : `build_monuments_nav.py` ajoute une file sur l'axe, avec des nœuds raccordés aux files des deux rues, dans la seule super-tuile
  s6_8 (comme les portes romaines, D138), et quelques points « commerce » devant les vitrines.
- Nuit : globes et vitrines allumés (maillage des vitres allumées) ; grilles fermées la nuit (horaires à confirmer). Grilles fermées =
  obstacle ; les passants ne passent plus.
- Silhouette lointaine (`lod`) : faîte de verre plus bas entre les deux toits.

### Ensuite

Le passage de la Terrasse, cité dans PROGRESS.md, réutiliserait le modèle (axe, pièces, niveaux), avec ses propres photos.

## 5. Questions ouvertes

1. Quel état : consoles bleu et or (photos 4 à 6, proposé) ou crème et or (photo 2) ?
2. À droite de la porte cochère, rue aux Cordiers : la photo 1 montre « Chaussures M… » (store vert), alors que D158 a posé La Manufacture
   et le rouge des jeux de La Promesse de l'Aube. Quelle photo est la plus récente ?
3. Grilles fermées la nuit dans le jeu ? Si oui, à quelles heures ?
4. Le texte de la plaque du chien (photo 5), si tu as une photo plus nette.
