# Centre-ville d'Autun : rues, parkings du Champ de Mars, rues piétonnes, commerces (plan, phase A)

Enquête du 31 octobre 2026, sur `origin/main` (D152). Rien n'a été modifié dans le dépôt, sauf ce fichier. Les photos ne sont pas versionnées :
seule leur lecture est écrite ici. Coordonnées : repère local du jeu (x vers l'est, y vers le nord, origine près de la mairie), en mètres ;
caps en degrés depuis le nord, sens horaire. Les captures « avant » et le plan annoté ont été produits hors du dépôt (bloc-notes de la
session) ; la phase B les refera dans `docs/captures/` à chaque décision.

## 0. Ce qu'il faut retenir

1. **La place du Champ de Mars n'a pas de chaussée.** `build_public_space.py` prend toute voie nommée « Place du Champ de Mars » pour une allée
   de parking (`is_lot`, ligne `t.get("name") == "Place du Champ de Mars"`). Les quatre tronçons `tertiary` de la place (OSM 671039846,
   1333715967, 671039850, 1343418270 : la route qui va de l'avenue Charles-de-Gaulle à la rue de l'Arbalète) sont donc fondus dans un seul
   aplat `plaza_asphalt` d'environ 1,3 ha, sans bordure, sans marquage, avec des traits de places de parking tirés le long de la route
   (on les voit à l'entrée de la rue aux Cordiers). Les voitures de la circulation, elles, y passent (la navigation lit `streets_lib`).
2. **Les parkings sont dessinés au hasard.** Les places viennent de traits posés tous les 2,5 m le long des allées OSM : quelques dizaines de
   traits épars et mal orientés, alors que l'orthophotographie montre environ 160 places en rangées régulières dans le grand parking (allées
   à sens unique, bande piétonne centrale, massifs aux angles) et deux autres parkings rangés à l'est.
3. **Les tilleuls taillés en rideau** (six blocs de 21 à 47 m × 9,5 m, 6,4 à 6,8 m de haut au LiDAR, plus le rideau de 56 m de la rue de
   Lattre) sont 29 arbres génériques ronds et des taches de pelouse. Le **kiosque à musique** est une maison de trois niveaux à toit à
   croupes ; le **monument aux morts** (7,9 m au LiDAR) est un pavé de 0,7 × 0,5 × 1,9 m.
4. **Rue aux Cordiers : 177 m de « clôtures de parcelle »** (130 m de murs de 2 m, 47 m de grilles de 1,5 m) devant les vitrines, sur la
   limite cadastrale entre la façade BD TOPO et la rue (capture « avant » depuis le sud : une grille devant les boutiques). Ce sont des
   obstacles : ils barrent l'accès aux portes.
5. **Rues piétonnes trop étroites et décentrées** : un ruban fixe de 6 m sur l'axe OSM, alors que les façades sont à 7,5 – 9,5 m l'une de
   l'autre rue aux Cordiers (6,2 – 7,0 m rue Saint-Saulge) ; il reste jusqu'à 2,5 m de relief nu le long des façades.
6. **La rangée nord-ouest de la rue du Champ de Mars tourne le dos à la place** : là où le trottoir s'élargit (plus de 10,7 m entre l'axe
   et les façades), les murs sur la place sont classés « cour ». L'Augusto, Havas Voyages et Le Commerce ont leur vitrine sur le mur
   arrière ou latéral (mesuré : mur 0 de `…854061`, 13,6 m face à 136°, rôle « court » ; les commerces sont sur le mur 7, face à 326°).

## 1. Les photos

Numérotées dans l'ordre d'envoi. « Certitude » : probabilité que le lieu et l'orientation soient justes. Les noms des commerces sont lus sur
la photo puis retrouvés dans OpenStreetMap (point et position), ce qui fixe le côté de la rue.

| n° | Ce que je lis | Lieu, côté, caméra déduite | Certitude |
|---|---|---|---|
| 1 | Street View juil. 2026, « 1 av. Charles de Gaulle ». Enrobé sombre, passage piéton à bandes devant, flèches au sol, « Pl. du Champ de Mars » écrit par Google sur la chaussée ; à gauche, parking à motos derrière une barrière basse verte à croisillons et des potelets noirs, voitures garées, rangée de maisons à lucarnes (rez-de-chaussée commerçant, « …BONAPARTE ») ; au milieu, feux tricolores sur mât, Peugeot 3008 dans la voie d'en face, Fiat 500 devant ; à droite, haies et massifs taillés, muret de béton clair, panneau P bleu, triangle, abribus, panneau jaune ; au fond, immeuble à drapeaux. | Carrefour avenue Charles-de-Gaulle / place, caméra vers (−9 ; 7) sur la chaussée, cap ≈ 130° (sud-est), le long de la route de la place (671039846). À gauche le parking est (OSM 80175800) et la rangée de la rue de Lattre (Grande Pharmacie Bonaparte, (71 ; −33), au cap 117°) ; à droite les massifs devant l'esplanade du monument. | 75 % |
| 2 | Street View juil. 2026, « 2 pl. du Champ de Mars ». Monument aux morts à gauche (haut socle de pierre, figure ailée), marches, mât à drapeau, lampadaires à plusieurs lanternes ; au fond le théâtre (baies en plein cintre, dôme) et l'hôtel de ville (pavillons, lucarnes) ; à droite parking (panneau P), sens interdit, potelets marron à tête blanche sur le trottoir, muret de pierre et massifs. | Route de la place vers (63 ; −53), cap ≈ 320° (nord-ouest). Monument (31 ; −52) à gauche (cap 270°), théâtre (−8 ; 44) au cap 324°, mairie (27 ; 76) au cap 345°. Tronçon à plateau (`traffic_calming=table`). | 85 % |
| 3 | Street View juil. 2026, étiquette Google « Rue du Champ de Mars ». Revêtement clair (béton balayé) sur toute la largeur, caniveau sombre à grille à droite, bande de stabilisé et massifs de graminées ; à gauche façades de pierre, portail sculpté en ruine, portes bleues, boutique « ÉCOUTER VOIR », bac planté ; terrasses à parasols plus loin ; à droite grands arbres taillés serrés, voitures derrière ; panneaux « stationnement interdit », « zone de rencontre 20 », « sens interdit sauf riverains » ; flèche au fond. | **Je lis la rue du Général-André-Demetz** (OSM 55921182 : `living_street`, `motor_vehicle=no`, sens unique, béton), depuis son bout nord-est vers (44 ; −58), cap ≈ 225°. Indices : façades à gauche et arbres à droite (en allant vers le sud-ouest, la rue Demetz a ses maisons au sud-est et les tilleuls taillés au nord-ouest) ; zone de rencontre et sens interdit sauf riverains ; béton clair ; la vraie rue du Champ de Mars est en enrobé (photo 14). La flèche du fond serait le clocheton de Notre-Dame (non vérifié). L'étiquette de Google est probablement fausse. | 70 % (rue Demetz) ; 25 % rue du Champ de Mars |
| 4 | Street View juil. 2026, « 1 pl. du Champ de Mars ». Rue en béton clair, potelets marron à tête blanche à droite, borne centrale amovible, borne d'accès à feu rouge à gauche, totem marron « Rue Jean et Bernard de Lattre de Tassigny » avec panneaux piétons, boîte aux lettres jaune, panneau zone de rencontre 20 ; à gauche rideau d'arbres taillés et massif de graminées devant le parking, hôtel de ville au fond à gauche ; à droite Grande Pharmacie Bonaparte (croix verte), La Poste, parasols. | Bout sud de la rue de Lattre-de-Tassigny vers (56 ; −46), cap ≈ 5° (nord). Pharmacie Bonaparte et La Poste à (71 ; −33) et (72 ; −27) ; rideau mesuré au LiDAR à x ≈ 57. | 90 % |
| 5 | Street View juil. 2026, « 1 pl. du Champ de Mars ». Pavés de granit gris, arbre dans un bac rond à banc circulaire, boutique (icône sac), terrasse à parasols roses et blancs devant « Coffee », totem marron, potelets ; à droite immeuble d'angle arrondi à rez-de-chaussée jaune et vitrines noires (Optic 2000). | Entrée nord de la rue aux Cordiers vers (66 ; −53), cap ≈ 200°. L'ideal Coffee (68 ; −70) à gauche ; Optic 2000 (50 ; −68), angle arrondi au cap 241°, à droite. | 90 % |
| 6 | Photo (pas Street View). Rue piétonne en pavés de granit gris clair, **caniveau central** légèrement courbe, devantures sous stores, « JAMES » (devanture verte, mannequins) à droite, « Chantal » plus loin à droite, portants de vêtements, oriflamme ; balcons en fer forgé. | Bas de la rue aux Cordiers, vers (−6 ; −207), cap ≈ 30°. James (2,5 ; −201,5) puis Chantal & Co (5,9 ; −197) : on remonte vers le nord-est, côté sud-est à droite. | 85 % |
| 7 | Photo, soleil. Rue en pavés de béton gris à bandes sombres, « …e des Remparts, Glacier, Salon de thé » (devanture rouge), terrasse à chaises vertes, « Audition… », « orange » ; au fond une tour sous échafaudage et des collines. | Bas de la rue Saint-Saulge vers (−17 ; −206), cap ≈ 325° (on descend vers le Champ de Mars). Crêperie des Remparts (−24 ; −203) puis Orange (−29 ; −193) à gauche, côté sud-ouest. La tour sous échafaudage serait le clocheton de Notre-Dame ou du lycée (non vérifié) ; la photo est ancienne. Le revêtement colle à OSM (`paving_stones`, contre `sett` pour la rue aux Cordiers). | 80 % |
| 8 | Photo de banque d'images (filigrane). Kiosque à musique octogonal, colonnes de fonte fines, lambrequins ajourés, toit à huit pans à faible pente, épi, garde-corps de fonte, socle de pierre à marches, plaque bleue « KIOSQUE Louis Renault » (lecture probable) ; derrière, le lycée et des maisons de la place. | Kiosque OSM 124225939 (−19 ; −73), vu du sud-est vers le nord-ouest (le lycée à gauche, la rangée de la rue du Champ de Mars à droite). Socle sur un terrain en pente : 330,8 à 333,1 m sous le kiosque (LiDAR) ; haut de 7,0 m au-dessus du sol (LiDAR). | 75 % |
| 9 | Photo. Carrefour City : rez-de-chaussée habillé de pierre claire en grandes plaques, trois grandes baies à cadre noir (entrée vitrée, vitrophanie verte à dessins de ville, vitrine), lettres vertes « Carrefour city » posées sur la pierre à droite, enseigne drapeau verte à gauche ; à droite « DIAGONAL Coiffure » (bandeau crème), puis une devanture rouge « Kalista ». Pavés gris. | Rue aux Cordiers, côté est (façade face à l'ouest-nord-ouest, 287°), vue de biais vers le sud-est. Carrefour City (58 ; −103, « 11-13 rue aux Cordiers ») ; Diagonal Coiffure (56 ; −113). | 90 % |
| 10 | Photo. Deux devantures en applique en bois peint rouge : à gauche « LA PROMESSE DE L'AUBE » en lettres de relief sur le bandeau, porte au milieu entre deux vitrines de livres ; à droite vitrines et porte sous le même rouge ; n° 30 sur la façade ; étage en pierre, garde-corps en fer forgé, volets blancs à persiennes à droite. | Rue aux Cordiers, côté ouest (façades face au sud-est, 124° à 126°). Livres (3,8 ; −173,8) et jeux (11,1 ; −163,5) : deux bâtiments BD TOPO voisins. | 85 % |
| 11 | Photo. « TERRITOIRE D'HOMME » : devanture moderne à cadre blanc, lettres noires sur le bandeau, grandes vitrines à mannequins, porte vitrée au milieu, banc devant ; étage en pierre et enduit, garde-corps en fer forgé, volets à persiennes. Pavés gris. | Rue aux Cordiers, côté ouest (28 ; −138), façade face à 120°. | 85 % |
| 12 | Street View **juil. 2024**, « rue du Champ de Mars ». Brasserie « Le Commerce » à l'angle, stores rouges, terrasse sous parasols bordeaux, bacs ; passages piétons ; sens interdit à l'entrée de la rue du Champ de Mars ; le lycée au fond à gauche. | Carrefour avenue Charles-de-Gaulle, caméra vers (6 ; −6), cap ≈ 290°. Le Commerce (−24 ; 14) à l'angle ouest du carrefour. Le sens interdit confirme le sens unique OSM (sud-ouest → nord-est). Photo de 2024 : le trottoir a pu changer depuis. | 90 % |
| 13 | Street View juil. 2026, « 31 rue du Champ de Mars ». « L'AUGUSTO » Bar-Brasserie-Restaurant, store rouge, terrasse sur une **estrade de dalles claires** bordée de tonneaux plantés, guirlandes, parasols rouges ; « VOYAGES » (bandeau bleu) à gauche ; bande de gravier et arbres entre la terrasse et la chaussée ; au fond à droite, l'hôtel de ville. | Rangée nord-ouest de la rue du Champ de Mars vers (−44 ; −26), cap ≈ 350°. L'Augusto (−47 ; −9), Havas Voyages (−52 ; −14). | 85 % |
| 14 | Street View juil. 2026, « 34 rue du Champ de Mars ». « LE CENTRAL » Bar-Brasserie-Pizzeria : stores noirs, terrasse fermée de panneaux gris découpés au laser, parasols noirs, bacs à oliviers ; large trottoir clair (stabilisé ou béton balayé) ; chaussée en enrobé à gauche, voiture blanche garée côté parking ; le lycée au fond. | Rue du Champ de Mars vers (−62 ; −33), cap ≈ 230°. Le Central (−69 ; −30). | 85 % |
| 15 | Street View juil. 2026, « 1 rue de l'Arbalète ». Immeuble d'angle arrondi à quatre étages (garde-corps filants), rez-de-chaussée jaune à vitrines noires « Optic 2000 » ; à gauche rue piétonne pavée à terrasses ; potelets, banc courbe de pierre ; à droite chaussée, monument aux morts, drapeaux, tilleuls taillés. | Débouché de la rue aux Cordiers vers (76 ; −50), cap ≈ 235°. Optic 2000 (50 ; −68), bâtiment `…853987` (« 1 rue Général Demetz »). | 85 % |
| 16 | Capture satellite Google Maps (nord en haut). | Repère d'ensemble : avenue Charles-de-Gaulle, mairie, parkings, kiosque, Carrefour City, office de tourisme, Le Central. | — |
| 17 | Vue aérienne 3D Google Maps, regard vers le nord-nord-est. | Repère : lycée en bas à gauche, kiosque et tilleuls au milieu, mairie en haut. | — |

**Plan annoté** (orthophotographie IGN à 20 cm, contours BD TOPO en jaune, axes OSM en cyan, rues piétonnes en magenta) avec les 15 caméras :
fourni à part (pas dans le dépôt). Points de caméra ci-dessus, à ± 3 m.

## 2. Données de la zone (état de `origin/main`)

Tuiles concernées : 25_34, 26_34 (y de −312 à −62), 25_35, 26_35 (y de −62 à 188). Navigation : une seule super-tuile, s6_8.

### Rues

`kind`, largeur et source de `streets_lib` (même liste pour le sol et la navigation) ; BD TOPO : tronçon apparié. « Façades » : distance
mesurée entre murs BD TOPO en travers de l'axe (médiane, profils tous les 12 m) ; « emprise » : espace hors parcelles et hors bâtiments.

| Rue | OSM | kind, sens | Largeur (source) | Revêtement OSM | Façades / emprise mesurées |
|---|---|---|---|---|---|
| Avenue Charles-de-Gaulle | 324703656 | tertiary, double | 6,5 (type) | asphalt | façades 15,5 – 16 ; LiDAR : **7,2 m entre les caniveaux** (−3,5 m et +3,7 m de l'axe ; D153 : le « 8 m » de la première lecture était trop large), trottoirs 4,3 m (ouest-sud-ouest) et 2,5 m |
| Place du Champ de Mars | 671039846, 1333715967, 671039850, 1343418270 | tertiary, double (2 voies sur 671039846) ; plateau sur les deux derniers | 5,5 (BD TOPO) | asphalt | **pas de chaussée dessinée** (voir 0.1) |
| Rue du Champ de Mars | 250821471, 1163981589 | residential, sens unique S-O → N-E (confirmé photo 12) | 3,0 (BD TOPO) | asphalt | façades 22 – 26 (rangée N-O ↔ parking) ; chaussée lue sur photo 14 : 3,5 – 4 m le long du parking |
| Rue de Lattre-de-Tassigny | 250821488 (puis 250821490, 838001039) | living_street, `motor_vehicle=no` | 4,0 (BD TOPO) | concrete | façades ≈ 20 (rideau d'arbres compris) |
| Rue du Général-André-Demetz | 55921182 | living_street, `motor_vehicle=no`, sens unique | 4,0 (type) | concrete | façades d'un seul côté ; promenade des tilleuls de l'autre |
| Rue de l'Arbalète | 249932252, 1206487801 | tertiary | 5,5 (BD TOPO) puis 3,0 | asphalt | façades 11,5, emprise 9,5 |
| Rue du Lycée Bonaparte | 830966734 (carrossable), 250821472 (piétonne) | residential, sens unique / pedestrian | 3,0 / 4,0 (type) | concrete | 17 – 19 (place devant le lycée) |
| Rue aux Cordiers | 55921185, 671039842 | pedestrian | 4,0 (type) | sett | **façades 7,5 – 9,5 (médiane 8,8)**, emprise 6,2 – 7,5 ; axe OSM décalé de ≈ 0,5 m vers l'ouest |
| Rue Saint-Saulge | 55921186 | pedestrian | 4,0 (type) | paving_stones | **façades 6,2 – 7,0**, emprise 6,0 – 7,0 |
| Grande Rue Chauchien (départ) | 80174705 | pedestrian | 4,0 (type) | paving_stones | — |
| Passages Balthus et de la Terrasse | 80940956, 669431421, 669431422 | pedestrian (passage couvert) | — | paving_stones | hors périmètre |

Pentes (MNT LiDAR) : rue aux Cordiers de 332,5 m (nord) à 337,3 m (sud), 2,9 % ; rue Saint-Saulge de 333,1 à 337,3 m, 4,7 % ; la place est
à 327,6 – 332 m (elle monte vers l'est).

### Sols des tuiles

- **Grand parking, place, parking est** : un seul aplat `plaza_asphalt` (`is_lot` + `filled`) ; marques `marks` éparses (113 polygones dans
  25_34, 18 dans 26_34, 190 dans 25_35, 455 dans 26_35, passages piétons compris). Quelques grands losanges blancs isolés dans le grand
  parking (morceaux de passages piétons OSM tombés sur les allées).
- **Rue du Champ de Mars** : `road_asphalt` de 3 m au milieu, `walk` de 5 m côté façades puis `plaza_paving` jusqu'aux façades, `walk` de 2 m
  côté parking. Ni bande plantée, ni estrades.
- **Rues piétonnes** : `plaza_sett` (rue aux Cordiers) et `plaza_paving` (Saint-Saulge), ruban de 6 m. Ces classes ont les couleurs « pavés »
  (`#c79a6b`, ocre) et « dallage » (`#d6b98a`) du thème : rien de gris.
- **Rue de Lattre** : ruban `plaza_paving` de 6 m, rideau d'arbres en `lawn` (il est `leisure=park` dans OSM, way 250192757).
- **Esplanade du monument** : morceaux de `plaza_paving`, `lawn` et `plaza_asphalt`.
- Bordures : la couche `walk` a une bordure de 15 cm (`ground.ts`) ; places et plazas n'en ont pas.

### Mobilier, arbres, clôtures

- 25_35 : 40 lampadaires, 13 passages piétons, 5 stops, 4 feux ; 26_35 : 20 lampadaires, 10 feux, 9 passages, 4 bancs, le monument (pavé
  générique, `props.ts`), 2 toilettes ; 26_34 : 10 bancs, 7 corbeilles, 2 potelets, 1 boîte à livres. Les bancs et corbeilles de la rue aux
  Cordiers et de la promenade (nœuds OSM 11148…, 11306…) sont dans les tuiles.
- 29 arbres génériques dans le secteur des tilleuls (x de −65 à 35, y de −125 à −50).
- Clôtures de parcelle : 177 m rue aux Cordiers (voir 0.4) ; 14 m de muret OSM de 0,5 m rue de Lattre ; 16 m rue aux Cordiers.

### Commerces et passants

- Points « commerce » posés par `build_nav.py` devant `ground.front` (ou le mur des commerces) : pour L'Augusto, Havas et Le Commerce, sur le
  mauvais mur (voir 0.6). Les points d'intérêt « banc », « monument » existent.
- Navigation : super-tuile s6_8 ; classe 5 = `living_street` (rue de Lattre, rue Demetz) ; la classe 7 (grille des places) est ignorée
  comme demandé.

### Captures « avant » (même principe que `tools/shot.sh`, h = 14, `detail=120`, 915 × 412)

Prises depuis les 15 caméras ci-dessus, plus une vue de dessus, une vue d'ensemble et une vue de nuit (photo 5). Ce qu'on y voit :
grande nappe grise sans chaussée ni rangées (photos 1, 2), traits de places à l'entrée de la rue aux Cordiers (5), grille et mur devant
les vitrines de la rue aux Cordiers (6, 9, 10 : grille devant Diagonal Coiffure, mur et grille face à La Promesse de l'Aube), arbres
ronds orange et verts à la place des tilleuls taillés (3, 8), kiosque dessiné en maison à toit à croupes (8), mur aveugle de L'Augusto
sur la place et enseigne absente (13), devantures génériques à stores rayés (9, 10, 11, 14), sol ocre des rues piétonnes. La caméra de
la photo 7 tombe dans un mur : en phase B, elle sera avancée de 2 m vers l'axe de la rue Saint-Saulge.

## 3. Mesures

- **Profils en travers** (MNT LiDAR à 0,5 m, médiane le long de la rue ; orthophotographie à 20 cm pour la teinte) :
  - avenue Charles-de-Gaulle (de 30 à 90 m depuis la place) : creux de caniveau à −3,5 m (−0,14 m) et à +3,5 – 4 m (−0,10 m) de l'axe,
    bombement au milieu : **chaussée ≈ 8 m** au lieu de 6,5 ; trottoirs en enrobé eux aussi (même teinte) ; une bande claire à +2,5 –
    3,5 m (voitures garées ou ligne) ; **le côté du stationnement est à confirmer sur photo**. Bordure ≈ 10 – 15 cm (au bruit du MNT près).
  - rue du Champ de Mars : sol qui monte de 0,4 à 0,9 m du caniveau vers le parking ; marches de bordure non lisibles au MNT ; la
    répartition (trottoir clair côté façades 5 – 7 m, bande plantée, chaussée 3,5 – 4 m, bordure du parking) est **lue sur les photos
    13 et 14** à un mètre près.
  - rues piétonnes : pas de bordure (sol continu), caniveau central rue aux Cordiers **lu sur la photo 6** (invisible au LiDAR).
- **Grand parking** (relation OSM 11356384, orthophotographie redressée dans l'axe du parking, 33° au nord de l'est) : rangée simple le
  long de la rue du Champ de Mars, deux doubles rangées dos à dos, rangée simple côté kiosque, une colonne à chaque bout ; places
  perpendiculaires de **2,5 m × 5 m**, allées de ≈ 6 m à flèches (sens unique), **bande piétonne centrale de ≈ 6 m** (OSM 1445933901) qui
  coupe toutes les rangées, zébras aux bouts de rangées, massifs plantés aux angles ouest et est. Environ **160 places** (comptage à
  ± 10, à refaire trait par trait en phase B).
- **Parking est** (OSM 80175800, x 20 – 48) : deux rangées perpendiculaires de part et d'autre d'une allée, places en épi au sud ; **parking
  devant la mairie** (80175794) : places en épi. À lire sur l'orthophotographie en phase B.
- **Tilleuls en rideau** (MNS − MNT > 2,5 m hors bâtiments, rectangle minimal) : est (5,7 ; −63,4) 40,5 × 9,5 m, 6,7 m ; (12,9 ; −73,3)
  46,8 × 9,4 m, 6,8 m ; ouest (−28,6 ; −89,2) 20,5 × 9,1 m, 6,4 m ; (−19,5 ; −98,1) 25,0 × 9,1 m, 6,6 m ; (−50,9 ; −106,2) 21,1 × 9,8 m,
  6,5 m ; (−43,6 ; −116,5) 21,1 × 9,5 m, 6,6 m ; rue de Lattre (56,8 ; 12,6) 56 × 7,4 m, 6,5 m. Une fente sombre au milieu de chaque bloc
  (orthophotographie) : deux lignes de troncs sous une couronne commune. Le LiDAR ne voit que le dessus : **hauteur des troncs et pas des
  arbres à lire sur photo** (photos 2, 3 et 15 de loin : troncs nus jusqu'à ≈ 2,5 – 3 m).
- **Monument aux morts** (31 ; −52) : 7,9 m au-dessus du sol au LiDAR, emprise de ≈ 3 × 3 m ; esplanade claire à marches.
- **Kiosque** (BD TOPO `…854030`, 56 m², octogone) : 7,0 m au LiDAR (BD TOPO : 8,2 m et toit à croupes faux) ; sol de 330,8 à 333,1 m.
- **Ce que le LiDAR ne voit pas** : les marquages, les bordures basses, les caniveaux, les couleurs, les estrades de terrasse, les potelets
  et barrières, le dessous des tilleuls. Tout cela est lu sur photo (à un mètre près) ou sur l'orthophotographie (marquages, places).

## 4. Commerces

Le numéro de mur est celui de la **fiche** (`walls[k]`), pas l'arête du contour (D144).

| Commerce | Bâtiment BD TOPO, tuile | Mur sur la rue (fiche / arête, longueur, orientation) | Fiche actuelle | Traitement proposé |
|---|---|---|---|---|
| Carrefour City | `…853330`, 26_34, 11 rue aux Cordiers | 0 / 0, 12,6 m, 287° | shop, `front` 0 ; porte aussi « Diagonal Coiffure » (à tort : il est dans `…853303`) | devanture D141 étendue : encadrement de pierre, lettres posées sans panneau, enseigne drapeau, vitrophanie en aplat |
| Diagonal Coiffure, Kalista | `…853303`, 26_34, 15 rue aux Cordiers | 0 / 0, 7,1 m, 289° | shop | bandeau crème, devanture rouge voisine : seulement si une photo de face |
| La Promesse de l'Aube (livres) | `…853544`, 26_34, 30 rue aux Cordiers | 0 / 0, 5,5 m, 124° | shop, `front` 0 | devanture D141 telle quelle (applique en bois rouge, lettres de relief) |
| La Promesse de l'Aube (jeux), La Manufacture | `…853545`, 26_34, 26 rue aux Cordiers | 0 / 0, 7,4 m, 126° | shop, deux commerces | devanture D141 rouge ; La Manufacture à retirer de ce mur si la photo le confirme (question) |
| Territoire d'Homme | `…853291`, 26_34, 20 rue aux Cordiers | 0 / 0, 9,0 m, 120° | shop, store « divided » | devanture D141 étendue : cadre blanc, lettres noires sur le bandeau, banc |
| Optic 2000 (et Le Gourmet) | `…853987`, 26_34, 1 rue Général Demetz | 7 / 10, 11,7 m, 344° ; angle arrondi = murs 5 et 6 (1,9 et 2,3 m) ; mur 1 / 3, 10,4 m, 97° sur la rue aux Cordiers | shop, deux commerces | devanture sur plusieurs murs (l'angle) : le gabarit D141 pose une devanture par mur ; à étendre à une suite de murs, sinon trois devantures alignées |
| L'Augusto | `…854061`, 25_35 | **0 / 13, 13,6 m, 136°, rôle « court »** | shop sur le mur 7 (5 m, 326°) | `fronts` (mur 0), store rouge, estrade de terrasse à tonneaux |
| Havas Voyages | `…854060`, 25_35 | **3 / 0, 6,4 m, 136°, rôle « court »** | shop sur le mur 0 (239°) ; aussi listé dans `…854061` | `fronts` (mur 3), bandeau bleu « VOYAGES » |
| Le Central | `…853814`, 25_35 | 0 / 1, 6,9 m, 141° | shop, sans `front` | stores noirs, terrasse fermée de panneaux gris |
| Le Commerce | `…854064`, 25_35 | 0 / 4, 7,0 m, 137° (« court ») et 1 / 5, 20,7 m, 57° | shop, `front` 1 | `fronts` (mur 1 + `also` 0), stores rouges, terrasse en angle ; photo de 2024 |
| Grande Pharmacie Bonaparte, La Poste | `…854039`, 26_35 (2 305 m², un seul bâtiment BD TOPO pour tout l'îlot) | 9 / 18, 18,5 m | shop | **fait en D159** (photo de face reçue : façade moderne, dessin `devanture-modern.ts`) |
| James, Chantal & Co | `…853608`, 26_34 | 2 / 4, 8,6 m | shop | photo 6 trop de biais : à faire si photo de face |
| Crêperie des Remparts, Orange | `…853621`, `…853618`, 25_34 | 4 / 0 ; 7 / 0 | shop | photo 7 trop de biais (et ancienne) |

**Gabarit ou modèle** : toutes ces devantures sont des rez-de-chaussée de maisons de ville ; aucune ne demande `store.ts` (fait pour les
grandes surfaces : toit mesuré, sas, galeries). Le gabarit de devanture D141 (`devanture.ts`, `fronts[…].shop.devanture`) convient tel
quel pour La Promesse de l'Aube ; il lui faut de petites options pour les autres : lettres posées sans panneau, enseigne drapeau,
encadrement de pierre ou cadre blanc sans pilastres, vitrophanie en aplat, devanture sur une suite de murs (angle arrondi d'Optic 2000).
Les cafés de la rue du Champ de Mars demandent des terrasses dessinées (estrade, tonneaux, panneaux, couleur des stores) : extension de
`shopfront.ts` (`terrace`, `awning`) pilotée par la fiche, pas un modèle de magasin.

## 5. Décisions proposées (une par lot, dans l'ordre)

Principes communs : données dans `manual.json`, une nouvelle étape autonome et idempotente pour tous les sols du centre (pas un fichier par
rue), aucun appel de dessin de plus (les nouvelles classes de sol vont dans le maillage du sol de la tuile), photos non versionnées.
Chaîne quand elle est concernée : build_carts → build_stores → build_monuments → build_shop_fronts → build_monuments_nav → build_courts
→ **build_streetscape** (nouvelle, D153), rejouée deux fois avec la somme de contrôle de `public/data`. `build_public_space.py` n'est pas
relancé (il réécrit toute la ville et efface les sols posés à la main) ; la règle `is_lot` y est quand même corrigée pour la prochaine
régénération, et `build_streetscape.py` reproduit localement le bon résultat.

### D153 — Rues carrossables du centre

- **Périmètre** : avenue Charles-de-Gaulle (de la place à la rue Jeannin), route de la place du Champ de Mars (quatre tronçons), rue du
  Champ de Mars, débuts de la rue de l'Arbalète, de la rue de l'Hôtel-de-Ville, de la rue Bulliot et de la rue du Lycée-Bonaparte
  (partie carrossable).
- **Sans photo de plus** :
  - nouvelle étape `tools/data/build_streetscape.py` et clé `streetscape` de `manual.json` : une zone (polygone local) dont les sols sont
    redessinés ; à chaque passe, les polygones des couches de sol des tuiles 25_34, 26_34, 25_35, 26_35 sont coupés par la zone, puis la
    zone est remplie par les sols décrits ; anneaux normalisés (sens, premier sommet, arrondi à 1 cm) pour qu'une deuxième passe ne change
    rien ; `bytes` de `world.json` mis à jour ;
  - la route de la place retrouve sa chaussée (5,5 m, BD TOPO), ses bordures, son axe, ses passages piétons OSM ; le plateau
    (`traffic_calming=table`) en enrobé clair avec rampes peintes ; les traits de places le long de la route disparaissent ;
  - largeur de l'avenue Charles-de-Gaulle : 8 m mesurés au LiDAR, dans une nouvelle table `streets` de `streetscape` (largeur, décalage de
    l'axe) que lit `streets_lib` après `measured_widths.json` (le sol et la navigation voient la même chose) ; **à n'appliquer qu'après le
    test des files de voitures** (risque ci-dessous) ;
  - `is_lot` de `build_public_space.py` : seules les allées `service=parking_aisle` sont des allées de parking (la règle sur le nom saute) ;
  - nouvelles classes de sol `walk_concrete` (trottoir clair) et `plaza_concrete` (béton balayé des zones de rencontre) dans
    `ground.ts` et `style.ts` (jour et nuit) ; même maillage.
- **Avec les photos déjà là** : rue du Champ de Mars d'après les photos 12, 13, 14 : chaussée d'enrobé de 3,5 m le long du parking
  (axe décalé vers le sud-est), bordure, bande plantée de gravier à arbres (photo 13) entre la chaussée et le trottoir, trottoir clair
  jusqu'aux façades (7 à 12 m de large selon l'endroit) ; les arbres de la bande plantée sont ceux de la carte, recalés.
- **Attend des photos** : le côté du stationnement de l'avenue Charles-de-Gaulle et ses marquages (axe, rives) ; les flèches de
  présélection du carrefour (OSM `turn:lanes` sur 1163981589) ; tant qu'il n'y a pas de photo, axe discontinu seulement.
- **Étapes et fichiers** : `tools/data/build_streetscape.py` (nouveau), `manual.json` (`streetscape`), `streets_lib.py` (table `streets`),
  `build_public_space.py` (`is_lot`), `src/render/ground.ts`, `src/render/style.ts`, README (étape et champ), DECISIONS, PROGRESS.
- **Captures** : photos 1, 2, 12, 13, 14 « comme la photo » (1,7 m), vue de dessus du carrefour, vue d'ensemble, nuit (photo 1).
- **Tests** : la route de la place a une chaussée continue de l'avenue à la rue de l'Arbalète ; aucun trait de place à moins de 1 m d'une
  chaussée ; passages piétons sur la chaussée ; largeurs lues par `streets_lib` ; idempotence (deux passes, même somme) ; coût en
  triangles de la tuile ; files de voitures : les tests de circulation et de poursuite existants passent.
- **Risques** : changer une largeur déplace les files des voitures (D94 : chocs aux carrefours, poursuites moins stables) ; si un test
  bouge, l'avenue garde 6,5 m dans la navigation et seulement le sol change (à écrire dans les limites). Les points d'intérêt des passants
  restent ceux de la navigation actuelle (voir la question 3).

### D154 — Les parkings du Champ de Mars

- **Périmètre** : grand parking (relation 11356384), parking est (80175800), parking devant la mairie (80175794) et ses deux petits voisins
  (1200432320, 1200432321).
- **Sans photo de plus** (orthophotographie) : `lots` dans `streetscape` : pour chaque rangée, deux points sur la ligne de fond, côté,
  profondeur (5 m), pas (2,5 m), angle (90° ou épi), nombre de places ; allées et leurs flèches ; bande piétonne centrale (dallage clair,
  6 m) ; massifs (`lawn` à bordure) ; zébras de bout de rangée. Les traits sont ceux que lit déjà `findStalls` (4,8 m × 0,1 m, 2,2 à
  2,9 m d'écart) : **les voitures garées du jeu se posent sur les vraies places** sans changer `vehicles.ts`. Les bordures des massifs et du
  pourtour sont des couches `walk` (bordure de 15 cm déjà dessinée).
- **Avec les photos déjà là** : barrière basse verte à croisillons et potelets noirs le long du parking est (photo 1) ; potelets marron à
  tête blanche (photos 2, 4) ; panneau P. Potelets et barrières basses ne bloquent pas (règle connue).
- **Attend des photos** : une vue au sol du grand parking (bordures, massifs, horodateurs, éclairage) pour le mobilier ; sans elle,
  seulement le sol et les marquages.
- **Étapes et fichiers** : `build_streetscape.py`, `manual.json`, peut-être `src/render/props.ts` (barrière à croisillons) ; tests.
- **Captures** : vue de dessus (comparée à l'orthophotographie), photo 1, photo 8 (vers le lycée), vue de nuit ; vue d'ensemble.
- **Tests** : nombre de places par parking (à ± 2 du comptage), places entièrement dans le parking et hors chaussée, `findStalls` retrouve
  chaque place, aucune voiture garée sur la bande piétonne ni dans une allée, triangles bornés, idempotence.
- **Risques** : plus de places = plus de voitures garées dessinées (coût d'instanciation ; à mesurer avec `?bench=1&fleet=1`) ; si besoin,
  l'occupation du centre est baissée.

### D155 — Tilleuls en rideau, kiosque et monument aux morts

- **Périmètre** : les six blocs de tilleuls de la place et le rideau de la rue de Lattre ; le kiosque `…854030` ; le monument aux morts (nœud
  OSM 943859188).
- **Sans photo de plus** : blocs mesurés au LiDAR (section 3) dessinés en rideau : couronne en pavé arrondi de la hauteur mesurée, deux
  lignes de troncs nus (le gabarit des arbres taillés de D149 est repris et étendu à une couronne commune) ; les 29 arbres génériques du
  secteur et le `lawn` du rideau de la rue de Lattre retirés à l'affichage (comme D142) ; troncs en cercles d'obstacle. Données : entrée
  `monuments` du kiosque (`model: "bandstand"`, `rideaux` rattachés comme la `grille` de D149), écrite par `build_monuments.py` dans
  `kinds/25_34.json` et `26_34.json` / `26_35.json`.
- **Avec les photos déjà là** : kiosque d'après la photo 8 (banque d'images) : socle de pierre octogonal (le dessus mesuré au niveau haut du
  terrain), marches, huit colonnes de fonte, lambrequins en aplat, toit à huit pans à faible pente, épi, garde-corps ; plaque bleue.
  Le contour BD TOPO ne bloque plus que par le socle (on monte par les marches). Hauteur mesurée : 7,0 m.
- **Attend des photos** : le monument aux morts (une photo de face, de près : socle, statue, inscriptions, marches) ; sans elle, seulement
  un socle et une silhouette ailée lus de loin sur les photos 2 et 15, à la hauteur mesurée (7,9 m) : je propose d'attendre la photo.
  Le tronc et le pas des tilleuls : une photo sous les arbres les fixerait ; sans elle, troncs à 2,8 m, pas de 4 m (à écrire dans les
  limites).
- **Étapes et fichiers** : `manual.json` (`monuments`), `build_monuments.py`, `src/render/monuments.ts`, `src/data/types.ts`, tests ;
  `build_monuments_nav.py` si un point « kiosque » est ajouté pour les passants.
- **Captures** : photo 8 « comme la photo », photo 3 (rue Demetz, tilleuls à droite), photo 4 (rideau à gauche), photo 15, vue de dessus,
  nuit.
- **Tests** : blocs dans leur rectangle mesuré (± 0,5 m), hauteur ± 0,3 m, aucun arbre générique dedans, troncs hors des allées et des
  files de passants (marge 30 cm), aucune cache d'arme à moins de 3 m, kiosque à 6,5 – 7,5 m, géométrie finie, coût borné.
- **Risques** : les files de la promenade passent entre les blocs (à vérifier contre les troncs) ; LOD : silhouettes lointaines à refaire
  pour le kiosque seulement.

### D156 — Rues piétonnes : rue aux Cordiers, rue Saint-Saulge, rue Demetz, rue de Lattre

- **Périmètre** : rue aux Cordiers (55921185, 671039842), rue Saint-Saulge (55921186), départ de la Grande Rue Chauchien (80174705),
  rue du Général-André-Demetz (55921182), rue de Lattre-de-Tassigny (250821488), rue du Lycée-Bonaparte piétonne (250821472).
- **Sans photo de plus** :
  - sol jusqu'aux façades BD TOPO (et non plus un ruban de 6 m sur l'axe), dans la zone de `streetscape` ;
  - **les clôtures de parcelle de ces rues sont retirées** (177 m rue aux Cordiers) : dans la zone, plus aucune clôture de parcelle à
    moins de 1,5 m d'une façade ni le long d'une rue piétonne ; la règle est aussi écrite dans `parcel_fences` pour la prochaine
    régénération complète ;
  - nouvelles classes : `plaza_granite` (pavés de granit gris clair, rue aux Cordiers), `plaza_pavers` (pavés de béton gris, rue
    Saint-Saulge et Grande Rue Chauchien), `plaza_concrete` (D153) pour les rues Demetz et de Lattre ;
  - bancs, corbeilles, bornes et potelets d'OSM gardés ; bornes d'accès aux entrées (photo 4 : borne à feu, borne amovible) ;
  - seuils de maisons : une marche de pierre sous chaque porte quand le sol de la rue est plus bas que le rez-de-chaussée de la fiche
    (pente de 2,9 à 4,7 %) — c'est un ajout du rendu des façades, borné aux fiches de la zone.
- **Avec les photos déjà là** : caniveau central de la rue aux Cordiers (photo 6 : ligne sombre de 30 cm, légèrement courbe) ; bandes
  sombres de bordure de la rue Saint-Saulge (photo 7) ; arbre en bac rond à banc circulaire à l'entrée de la rue aux Cordiers (photo 5) ;
  totems marron de signalisation (photos 4, 5) ; banc courbe de pierre (photo 15).
- **Attend des photos** : la partie nord de la rue Saint-Saulge et la rue du Lycée-Bonaparte piétonne ; la Grande Rue Chauchien ; le
  mobilier exact (jardinières, lanternes murales) de la rue aux Cordiers au-delà des photos 5, 6 et 9.
- **Étapes et fichiers** : `build_streetscape.py`, `manual.json`, `build_public_space.py` (`parcel_fences`), `ground.ts`, `style.ts`,
  `stylized.ts` ou `facades.ts` (seuils), `props.ts` (bornes, totems), tests.
- **Captures** : photos 3, 4, 5, 6, 7 « comme la photo », milieu de la rue aux Cordiers (photos 9, 10, 11), vue de dessus, nuit (photo 6).
- **Tests** : aucune clôture de parcelle dans les rues piétonnes de la zone ; sol continu entre façades (échantillon tous les 2 m :
  aucun point de relief nu à plus de 0,3 m d'une façade) ; files de passants libres (30 cm) ; points « commerce » devant les entrées ;
  caches d'armes à plus de 3 m des bâtiments touchés ; idempotence ; triangles.
- **Risques** : la navigation actuelle a été calculée avec les clôtures : en les retirant, les files ne changent pas (elles les
  évitaient) mais restent plus étroites que la rue ; sans régénérer s6_8, les passants marchent toujours au milieu (question 3).

### D157 — Cafés de la rue du Champ de Mars : Le Commerce, L'Augusto, Havas Voyages, Le Central

- **Périmètre** : les quatre commerces des photos 12, 13 et 14, et les murs « cour » de la rangée nord-ouest (`…852378`, `…854060`,
  `…854061`, `…854063`, `…854064`) qui regardent la place.
- **Sans photo de plus** : `fronts` de `manual.json` (mur 0 de `…854061`, mur 3 de `…854060`, mur 1 et `also` 0 de `…854064`, mur 0 de
  `…853814`) : vitrines et enseignes sur la place, point « commerce » des passants déplacé (`build_monuments_nav.py`, comme D141) ; une
  option `street` dans `fronts` pour passer en « rue » les murs des maisons sans commerce de la rangée (volets, encadrements).
- **Avec les photos déjà là** : couleur des stores (rouge pour Le Commerce et L'Augusto, noir pour Le Central), estrade de terrasse en dalles
  claires bordée de tonneaux plantés (L'Augusto), terrasse fermée de panneaux gris ajourés à parasols noirs (Le Central), bandeau bleu
  « VOYAGES » (Havas), lettres « L'AUGUSTO » sur la façade ; extension de `shopfront.ts` (`terrace` et `awning` pilotés par la fiche :
  couleur, estrade, bordure, écrans), données dans `fronts[…].shop`.
- **Attend des photos** : Le Commerce n'a qu'une photo de 2024 (terrasse possiblement changée) ; une photo récente de face est la
  bienvenue.
- **Étapes et fichiers** : `manual.json`, `build_shop_fronts.py`, `build_monuments_nav.py`, `src/render/shopfront.ts`, `facades.ts`,
  schéma des fiches, tests.
- **Captures** : photos 12, 13, 14 « comme la photo », nuit (vitrines), vue de dessus de la rangée.
- **Tests** : mur d'entrée et commerce sur le mur qui regarde la place ; un point « commerce » unique par commerce, devant l'entrée ;
  terrasses sur le trottoir (jamais sur la chaussée), hors des files de passants (30 cm) ; estrade et tonneaux : obstacles bas ou rien
  (on les traverse, comme D143) ; idempotence ; triangles.
- **Risques** : `build_shop_fronts.py` réécrit les fiches des tuiles : vérifier qu'aucune autre fiche ne change.

### D158 — Boutiques des rues piétonnes : Carrefour City, La Promesse de l'Aube, Territoire d'Homme, Optic 2000

- **Périmètre** : `…853330` (Carrefour City), `…853544` et `…853545` (La Promesse de l'Aube), `…853291` (Territoire d'Homme), `…853987`
  (Optic 2000, angle arrondi).
- **Sans photo de plus** : rien (tout se lit sur les photos 9, 10, 11, 15).
- **Avec les photos déjà là** : `fronts[…].shop.devanture` (D141) mesuré sur chaque photo et ramené à la longueur du mur :
  - La Promesse de l'Aube : gabarit tel quel, deux devantures rouges, lettres de relief, n° 30 ;
  - Territoire d'Homme : cadre blanc sans pilastres, lettres noires sur le bandeau, porte au milieu, banc ;
  - Carrefour City : encadrement de pierre claire, trois baies à cadre noir, vitrophanie verte en aplat, lettres vertes posées sur la
    pierre, enseigne drapeau (et « Diagonal Coiffure » retiré de ce bâtiment) ;
  - Optic 2000 : rez-de-chaussée jaune à vitrines noires sur la suite de murs de l'angle (murs 1, 5, 6, 7), enseigne sur le bandeau.
  Options à ajouter à `devanture.ts` : `letters` (lettres sans panneau), `blade` (enseigne drapeau), `frame` (pierre ou blanc, sans
  pilastres), `decal` (aplat de vitrine), `walls` (suite de murs). Couleurs lues sur les photos.
- **Attend des photos** : Diagonal Coiffure et Kalista (photo de face), James et Chantal & Co, Crêperie des Remparts et Orange, Grande
  Pharmacie Bonaparte et La Poste, L'ideal Coffee, Écouter Voir : chacun se fait dans ce lot s'il arrive une photo de face.
- **Étapes et fichiers** : `manual.json`, `build_shop_fronts.py`, `src/render/devanture.ts`, `facades.ts`, schéma des fiches, tests.
- **Captures** : photos 9, 10, 11, 15 « comme la photo » (et de face), nuit (vitrines allumées), vue de la rue aux Cordiers.
- **Tests** : comme D141 (devanture contenue dans son mur ou sa suite de murs, ordre des travées, enseigne au-dessus, vitrines allumées
  la nuit, pas de fenêtre générique derrière, géométrie finie, coût borné, points « commerce »).
- **Risques** : l'angle arrondi d'Optic 2000 est fait de murs très courts (0,5 à 2,3 m) : la devanture y sera simplifiée.

### Coût prévu

Marquages des places (≈ 400 traits), sols redessinés, rideaux (≈ 1 000), kiosque (≈ 700), terrasses et devantures (≈ 400 chacune) :
de l'ordre de **+6 000 à +9 000 triangles** sur la vue d'ensemble (≈ 436 000), aucun appel de dessin de plus. À mesurer à chaque lot.

## 6. Questions (les réponses changent le travail)

1. **Photo 3** : je la lis dans la **rue du Général-André-Demetz** (béton, zone de rencontre, tilleuls à droite), pas dans la rue du Champ
   de Mars comme l'écrit Google. D'accord ?
2. **Passants** : la consigne interdit `build_nav.py` complet. Sans régénération, les passants gardent leurs files actuelles (au milieu des
   rues piétonnes, sur l'ancienne nappe du Champ de Mars). M'autorises-tu à ajouter à `build_nav.py` une option `--only s6_8` (une seule
   super-tuile, celle de tout le centre), ou on garde la navigation et je vérifie seulement les obstacles contre les files ?
3. **Avenue Charles-de-Gaulle** : appliquer la largeur mesurée (8 m) aussi à la navigation (files des voitures déplacées, risque sur les
   tests de poursuite), ou seulement au sol ?
4. **Périmètre des commerces** : les huit de D157 et D158 te vont-ils ? Le kiosque (photo de banque d'images) et le monument aux morts (pas
   de photo de près) sont-ils dans le périmètre ?
5. **La Manufacture** : OSM la met dans le même bâtiment que la boutique de jeux de La Promesse de l'Aube (26 rue aux Cordiers). Sur ta
   photo 10, la devanture rouge de droite est-elle entièrement La Promesse de l'Aube ?
6. **Clôtures de parcelle** : je propose de les retirer seulement dans la zone du centre (sans relancer `build_public_space.py`) ; la
   règle corrigée ne s'appliquera au reste de la ville qu'à la prochaine régénération complète. D'accord ?

## 7. Photos qui manqueraient (à chaque lot, ce que je fais sans elles est écrit plus haut)

- D153 : l'avenue Charles-de-Gaulle vue dans son axe (côté du stationnement, marquages) ; le carrefour vu du sud (flèches au sol).
- D154 : le grand parking au sol (bordures, massifs, horodateurs, lampadaires).
- D155 : le monument aux morts de face, de près ; les tilleuls vus dessous (troncs).
- D156 : la rue Saint-Saulge côté Champ de Mars, la Grande Rue Chauchien, la rue aux Cordiers entre Carrefour City et la place.
- D157 : Le Commerce, photo récente de face.
- D158 : les devantures de face de Diagonal Coiffure, Kalista, James, Chantal & Co, Crêperie des Remparts, Orange, Grande Pharmacie
  Bonaparte, L'ideal Coffee, Écouter Voir (celles que tu veux voir refaites).
