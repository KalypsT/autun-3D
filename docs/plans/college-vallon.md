# Le collège du Vallon : bâtiments, cour, terrains de sport, parking : plan (phase A)

Enquête du 1ᵉʳ novembre 2026, sur `main` (après D170). Rien n'est modifié dans le jeu : ce fichier et trois captures « avant »
(`docs/captures/college-avant-*.jpg`) sont les seuls ajouts. Les photos de l'utilisateur ne sont pas versionnées : seule leur lecture est écrite ici.
Repère local du jeu (x vers l'est, y vers le nord), mètres ; les prochains numéros de décision seront D171 et suivants.

## 0. Ce qu'il faut retenir

1. **Le jeu a déjà le collège au bon endroit, mais en maquette.** Tuile 28_39. Bâtiments BD TOPO (boîtes beiges à toit plat, façade générique à volets jaunes, fiche `estimated`
   à 30 %), trois plateaux sportifs bien placés, ruisseau de Brisecou et pont d'entrée présents. Rien ne ressemble aux photos : ni le bloc d'entrée vitré, ni la barre de quatre étages,
   ni le portail.
2. **Le bâtiment principal est un seul contour fusionné** (`…848973`, 20 sommets, 65 × 80 m, 9,3 m, classé `culture` dans `kinds`, nommé « COLLÈGE LE VALLON ») : il mélange au moins trois ailes
   que les photos montrent distinctes (bloc vitré d'entrée, barre de quatre niveaux, volume aveugle en béton). Une simple fiche de façade ne peut pas les séparer : même constat que pour l'Hexagone.
3. **L'entrée est absente.** Le pont de 4,5 m existe (structure `decks`), mais ses parapets sont des dalles beiges pleines, l'enceinte voisine est un grand mur beige (3,5 m, « mesuré 5,8 » dans la tuile), et il n'y a ni portail coulissant, ni portillon, ni panneau
   « Collège le Vallon », ni lampadaire à tête en disque, ni borne d'interphone, ni arbre remarquable derrière la grille.
4. **La cour est un sol sans identité** : sable (couleur de trottoir) autour des bâtiments, alors que l'orthophotographie et les photos montrent de l'enrobé sombre. Ni marches, ni rochers, ni bacs roses,
   ni bouleau pleureur, ni haie devant le bloc d'entrée.
5. **Le parking** (le long de la rue de l'Acaron, au carrefour de l'avenue de la République et de la route d'Arnay) est dans l'état d'avant D154 : des traits épars (78 « marks » dans la tuile) et un aplat d'enrobé. Vue satellite et photo 5 : rangées régulières, flèches de sens peintes, lampadaires, panneau « P ».
6. **Le camion pizza existe déjà** (D115, `unique-pizza-du-vallon`, 503,5 ; 1105, cap 4,23, de 17 h à 22 h). Votre repère (46,960052 ; 4,305498) tombe en **(499,1 ; 1102,5)**, à 5 m au sud-ouest
   de la place actuelle : l'écart est celui que D115 avait volontairement pris (« quelques mètres plus dans le parking »). Voir §3.5 : on le revérifiera quand les rangées seront refaites.

## 1. Les photos

| n° | Ce que je lis | Lieu, caméra déduite | Certitude |
|---|---|---|---|
| 1 | Street View juil. 2026, « Rue de l'Acaron ». On regarde vers le nord-est depuis le passage piéton. L'accès au collège est une **rampe-pont en enrobé** à parapets de béton plein (≈ 1 m, longs murs inclinés), qui mène à une **grille noire** (portail à droite, portillon au milieu) ; panneau « Collège le Vallon » en haut à droite de la grille ; **deux lampadaires à mât mince**, un grand arbre à feuilles larges derrière ; à droite un **îlot de béton** en demi-cercle (parapet de ruisseau, 1,2 m environ) ; panneau « P » ; passage piéton avec « Rue de l'Acaron » peint ; clocher à gauche ; collines au fond. Deux piétons. | rue de l'Acaron, au débouché de la rampe, côté parking | bonne |
| 2 | Photo de presse (hors Street View) de **la grille de près** : portail à deux vantaux en barreaux noirs (≈ 4,5 m) avec **barre d'arrêt** sur le côté, **portillon piéton** à droite avec **panneau d'affichage gris**, boîte aux lettres et **borne d'interphone** dans le pilier de béton ; panneau blanc « **Collège le Vallon** » (logo de silhouettes) sur le pilier ; pancartes (« Attendre l'ouverture complète du portail pour entrer ») ; **lampadaire à tête en disque plat** devant, dans l'axe ; derrière : **grand hêtre ou marronnier** (≈ 20 m), bâtiment de deux niveaux en béton clair à toit plat, **conifères** sur la droite, bâtiment beige à fenêtres en bandes à gauche. Murs de béton à joints verticaux de part et d'autre. | devant la grille, au sol | bonne |
| 3 | Photo de presse hiver (arbres nus) de **la cour et du bâtiment principal**. Au centre un **bloc d'entrée à deux niveaux** en mur-rideau (vitrage sombre, panneaux bleu-vert en haut, **double porte vitrée** précédée de **quatre marches** en gravier, **bacs roses** et **rochers** à droite), un **bouleau pleureur** devant sa gauche, **haie taillée** à gauche. À gauche, **volume aveugle** en béton clair (mur nu, ≈ 7 m). À droite, **barre de quatre niveaux** en béton beige à bandes de fenêtres et allèges en saillie, **bande verticale orangée**, escalier ou cage au bout, caméra de surveillance. Cour d'enrobé large et vide. | milieu de la cour, face au bloc d'entrée | bonne ; orientation à confirmer (§8) |
| 4 | Street View août 2025, « Av. de la République ». **Cour nord ouverte sur l'avenue** (enrobé, marquage de places sur la chaussée au premier plan), petit **bâtiment bas** gris à toit plat à gauche, **bâtiment blanc à étage et escalier extérieur** à droite, buissons, deux peupliers, **grand toit rouge** derrière à gauche (halle ?), collines. | sur l'avenue de la République, face au sud | bonne |
| 5 | Street View juil. 2026, « Rue de l'Acaron ». **Grand parking** vu de l'est : enrobé fissuré, **flèches de sens** (gauche et droite), une rangée de places perpendiculaires (Audi Q3 garée), **lampadaires** à mât long, **drapeaux** et panneaux au fond, feux tricolores à gauche, feuillus à droite. | sur le parking, côté rue de l'Acaron | bonne |
| 6 | Vue satellite Google Maps (nord en haut) : **avenue de la République** en diagonale, **bloc principal** à toits plats gris, grand **toit blanc** (gymnase) au sud-est, **ruisseau de Brisecou** au sud, **trois plateaux** gris-brun au sud du ruisseau, grande cour d'enrobé à l'est et au nord, **parking à gauche** (ouest), petit bâtiment carré en bas à gauche du bloc principal. | — | bonne |
| 7 | Vue satellite du carrefour avec **votre repère** (46,960052 ; 4,305498, « La pizza au feu de bois camion vert »). **Parking** à l'est de la route d'Arnay : ≈ 35 × 45 m, bord nord le long de l'avenue (D107), **rangées de places** sur les deux bords et au centre, **flèches de sens**, petite pelouse plantée à l'ouest, **pont d'entrée** au sud-est. | — | bonne ; nombre de places à compter (§8) |

Détails notés : l'écart de saison (hiver sur la photo 3, été sur les autres) change la couleur des arbres, pas la forme ; le portail est **fermé** sur la photo 2 (pancartes de rentrée) ; la photo 4 est antérieure
de quelques mois aux photos 1 et 5.

## 2. État des données

Relevé sur la tuile 28_39 et ses captures (`docs/captures/college-avant-*.jpg`).

| Élément | État actuel | Verdict |
|---|---|---|
| Bloc principal `…848973` | 20 sommets, 65 × 80 m, toit plat à +9,3 m, 49 196 points LiDAR (8 plans), `culture`, fiche `estimated` | fusion de plusieurs ailes ; **type `culture` à vérifier** (une école devrait être `school`) |
| Bloc ouest `…849004` | 20 × 16 m, 3 niveaux, 9,1 m, 1973, `school` | à comparer à la photo 4 (le bâtiment bas à gauche paraît plus bas ; le LiDAR tranchera) |
| Gymnase `…848924` | 26 × 40 m, toit à croupes (8 plans), égout 4,4 m, faîtage ≈ 9 m, `school` | la vue satellite montre un toit blanc de halle ; **forme de toit à mesurer** |
| Annexes `…848968`, `…848969`, `…848974` | 4 à 20 m de côté, 3,7 à 4,4 m | à rattacher à leur bloc |
| Façades | enduit orangé, volets jaunes, fenêtres « picture » | **faux** (béton clair, bandes, mur-rideau) |
| Entrée | pont 4,5 m, parapets en dalles pleines, mur d'enceinte de 3,5 m (« mesuré 5,8 »), aucun portail ni panneau | à créer |
| Cour | `plaza_asphalt` (4 polygones) et sol de trottoir pour le reste | à reprendre |
| Terrains | 3 `pitch` (2 × `basketball`, 1 × `multi`), positions plausibles (566–643 ; 991–1049) | **sol rouge et bleu** dans le jeu, gris sur la vue satellite ; filets, paniers et buts absents ? |
| Parking | `plaza_asphalt` 27 points autour de (490 ; 1106), 78 traits épars | à refaire (méthode D154, D169) |
| Camion pizza | présent à (503,5 ; 1105), cap 4,23, 17 h à 22 h | à contrôler contre les nouvelles rangées |
| Arbres | 171 sur la tuile, dont un rideau de peupliers au bord de l'avenue | à contrôler (photos 2 et 4) seulement |
| Navigation | super-tuile existante, **non touchée** (convention D154) | inchangée |

## 3. Propositions

### 3.1 Les bâtiments : trois niveaux d'ambition

| | A. Fiches de façade seules | **B. Modèle dédié (recommandé)** | C. B + intérieur |
|---|---|---|---|
| Principe | comme Latouche (D163) : `fiches` et devantures modernes sur les contours BD TOPO | comme le lycée Bonaparte (D148-D151) et l'Hexagone (D165-D166) : ailes mesurées au LiDAR, détails lus sur photo (`manual.json`) | B, plus salles jouables |
| Résultat | bonnes façades sur une forme fausse | **ailes distinctes**, toits mesurés, bloc d'entrée vitré, barre de quatre niveaux, volume aveugle | idem |
| Coût | 1 lot | 3 lots (volumes, façades, détails) | hors périmètre |
| Défaut | ne règle pas le point 2 | un type de bâtiment de plus | collisions, navigation, éclairage intérieur |

**Recommandation : B**, pour la même raison que l'Hexagone : on habillerait une mauvaise forme. Contenu proposé :
- **Ailes** (une par volume lu sur photo et LiDAR) : bloc d'entrée (2 niveaux, mur-rideau), barre de 4 niveaux, volume aveugle, annexes basses ; hauteurs et égouts au LiDAR.
- **Façades** : béton clair à joints de panneaux, **bandes de fenêtres avec allèges en saillie**, **bande orangée verticale**, mur-rideau sombre à panneaux bleu-vert, double porte vitrée, enseigne, caméra de surveillance ; autres côtés estimés (fiche `estimated`).
- **Toits** : plats, acrotère bas, édicules mesurés ; le **gymnase** reprend la forme du toit mesurée.
- **Nuit** : vitrages du bloc d'entrée et enseigne émissifs (`glow` existant).
- Le bloc ouest `…849004` et le gymnase se règlent dans les mêmes lots, selon ce que le lot 0 montre.

### 3.2 L'entrée

- **Rampe-pont** : parapets bas en béton (≈ 1 m, à mesurer), enceinte ramenée à sa vraie hauteur (le mur du jeu fait 3,5 m, mesuré 5,8 : à contrôler au LiDAR, il a pu viser un arbre).
- **Grille** : portail coulissant (≈ 4,5 m) à barreaux noirs avec **barre d'arrêt**, portillon, pilier de béton avec interphone et boîte aux lettres, **panneau « Collège le Vallon »** (dessiné, logo en silhouettes stylisées), panneau d'affichage.
- **Mobilier** : lampadaire à tête en disque, borne, panneau « P », marquage « Rue de l'Acaron » sur la chaussée, **grand arbre** derrière la grille (vérifier qu'il est bien dans `trees`).
- **Comportement** (à choisir, §6) : grille **toujours ouverte** (le plus simple, aucune règle d'horaire) ou ouverte aux heures de classe seulement. Je recommande « toujours ouverte » : la grille de photo 2 est fermée pour la rentrée et, une fois fermée, elle
  couperait le collège sans que le joueur en voie la raison (D114 a pris le même parti : un camion qui disparaît plutôt qu'un camion qui bloque).

### 3.3 La cour et les abords

- **Sols** : enrobé sombre pour la cour (orthophotographie, comme D152 pour le lycée), classes de sol par polygone sans nouveau shader ; marches et palier du bloc d'entrée, gravier devant.
- **Mobilier** (props, avec collision et cassable selon D160 là où c'est raisonnable) : **bacs roses**, **rochers**, **bouleau pleureur**, haie taillée, caméra, bancs sous les arbres ; budget en §4.
- **Cour nord ouverte sur l'avenue** (photo 4) : la clôture noire que le jeu pose le long de l'avenue (capture « bâtiments ») est à vérifier ; on ne la retire que si l'orthophotographie montre que la cour est réellement ouverte.

### 3.4 Les terrains de sport

- **Trois plateaux** au sud du ruisseau (positions déjà bonnes) : revêtement lu sur l'orthophotographie (gris et brun, tracés blancs), **clôture grillagée** si elle existe, paniers de basket, buts, filets.
- **Gymnase** : voir §3.1 ; son accès et sa relation aux plateaux sont à lire (je n'ai pas de photo).
- Aucune photo des plateaux : les paniers et les buts sont des **hypothèses** jusqu'à lecture de l'orthophotographie ou d'une photo.

### 3.5 Le parking et le camion pizza

- **Méthode D154/D169** : redresser l'orthophotographie, lire les pics de lignes blanches, fixer pas et phase de chaque rangée, ajouter une entrée `lots` à `streetscape` dans `manual.json` ; `build_streetscape.py` remplace les 78 traits par des polygones propres,
  sans toucher à `vehicles.ts`. Ajouter les **flèches de sens**, le panneau « P », deux ou trois lampadaires à mât long (photo 5), le passage piéton peint de la photo 1.
- **Attendu** : trois à cinq rangées, le nombre de places est à **compter** sur l'orthophotographie (je ne le chiffre pas avant lecture ; la vue satellite 7 en laisse voir une quarantaine à vue d'œil).
- **Camion pizza** : le repère (499,1 ; 1102,5) est dans le parking, sur la lisière nord, à 5 m de la place actuelle (503,5 ; 1105). Deux choix : **garder la place actuelle** (D115 l'a prise pour que le camion soit à l'axe de la chaussée, cabine vers l'ouest) ou **la ramener au repère**. Dans les deux cas :
  `Fleet.keepClear` écarte les voitures garées sur sa place, et un test (nouveau) vérifie qu'aucune place de stationnement ne coupe son emprise et qu'il tient dans la lisière ; son cap suit la direction des rangées relevée.
- **Piège connu (D154)** : les voitures cachent les lignes ; si l'orthophotographie est prise un jour de forte occupation, certaines places seront extrapolées au pas. La photo 5 montre un parking quasi vide : bon signe.

### 3.6 En option

- **Passants (élèves, surveillants)** devant la grille, aux heures d'entrée et de sortie : le jeu a déjà un point « école » pour le lycée Bonaparte (D149) ; même mécanique ici (`build_monuments_nav.py`). **Hors de ce plan sauf demande** : il faudrait relancer la navigation de cette super-tuile.
- **Cloche ou sonnerie** : pas prévu, rien dans le catalogue sonore actuel ne s'y prête simplement.

## 4. Plan d'implémentation

Chaque lot : un commit, une décision `D171…` dans `docs/DECISIONS.md`, captures avant/après dans `docs/captures/`, `PROGRESS.md` à jour, `npm run typecheck && npm run lint && npm test` verts.
Aucune relance de `build_nav.py` (navigation de `main` gardée comme en D154), sauf demande contraire.

| Lot | Contenu | Fichiers principaux | Tests (cible) |
|---|---|---|---|
| **0. Relevés** | MNS/MNT LiDAR HD et orthophotographie 10 cm : contour exact de chaque aile, hauteurs et égouts, forme du toit du gymnase, nature du bloc ouest, position et axe de la grille, hauteur des parapets, rayon de l'îlot de béton, **nombre et direction des rangées du parking**, revêtement des plateaux ; rattachement des photos 3 et 4 à leur aile ; type `culture` de `…848973` | script jetable `tools/data/survey_college.py`, notes dans le plan (§8) | — |
| **1. Volumes et toits** | type `college-vallon` (comme `hexagone` et `college`) : ailes, toits mesurés, gymnase ; les BD TOPO fusionnées sont masquées ; `kind` corrigé en `school` si le relevé le confirme | `src/data/types.ts`, `tools/data/build_monuments.py`, `src/render/monuments.ts`, `src/render/landmarks.ts`, `manual.json` | emprise dans le contour BD TOPO ± 2 m ; sommet à ± 0,5 m du LiDAR ; aucun triangle caché |
| **2. Façades** | bloc d'entrée vitré, barre de quatre niveaux, volume aveugle, bandes de fenêtres, bande orangée, enseigne, caméra, émissif de nuit | `monuments.ts`, `sign-atlas.ts`, fichier de façade comme `hexagone-facade.ts`, `manual.json` | porte vitrée dans le bloc d'entrée ; allèges dans l'emprise ; enseigne lisible |
| **3. Entrée** | parapets bas, portail et portillon, piliers, panneau, lampadaire à disque, borne, panneau « P », marquage « Rue de l'Acaron » ; grille ouverte (§3.2) | `props.ts`, `breakables.ts`, `manual.json` (`fronts`), `build_streetscape.py` | passage libre de 3 m ; aucun prop dans l'axe de la rampe ; joueur non coincé |
| **4. Cour et abords** | enrobé de la cour, marches, gravier, bacs roses, rochers, bouleau, haie ; clôture de l'avenue réexaminée | `build_courts.py` (`courts` : site du collège), `props.ts`, `manual.json` | aucun sol dans l'emprise des ailes ni sur la rue ; chaque prop à plus de 1,5 m de la façade |
| **5. Terrains de sport** | revêtement lu, tracés, grillage, paniers et buts | `manual.json`, `build_ground.py`, `props.ts` | paniers aux extrémités de leur terrain, à 3,05 m du sol |
| **6. Parking et camion pizza** | rangées lues à l'orthophotographie, flèches, lampadaires ; ancienne marque retirée ; place du camion contrôlée | `manual.json` (`lots`), `build_streetscape.py`, `src/data/streetscape.test.ts`, `src/core/uniques.ts` | entre N − 10 % et N + 10 % places (N compté au lot 0) ; toutes perpendiculaires à leur rangée à 5° ; camion hors de toute place |
| **7. En option** | passants à la grille (§3.6) | `build_monuments_nav.py` | — |

Budget : le jeu rend environ 395 000 triangles sur cette vue (capture « bâtiments ») ; le modèle (ailes, façades, portes) doit rester sous 20 000 triangles, les props de l'entrée, de la cour et des terrains sous 8 000.

## 5. Risques et limites

- **Photos 3 et 4 non rattachées** : je n'ai pas trouvé, sans relevé, quelle aile BD TOPO porte le bloc vitré et laquelle porte la barre de quatre niveaux. Le lot 0 s'en charge ; tant qu'il n'est pas fait, les emprises du §3.1 sont des hypothèses.
- **Faces non photographiées** : arrière, côtés, plateaux et gymnase seront estimés (fiche `estimated` pour ces murs).
- **Hauteurs et épaisseurs** (parapets, marches, bandeaux) lues sur photo à ± 0,15 m, pas mesurées.
- **Saison** : photo hivernale pour le bâtiment principal ; teintes validées à l'écran en été.
- **Droits** : Street View, photos de presse et captures satellites ne servent que de référence de lecture, comme pour les lots précédents ; rien n'en est copié (textures et enseignes sont dessinées, le logo du collège est stylisé).
- **Mon analyse n'a pas vu l'orthophotographie** : tout ce que je dis des terrains et du parking vient de vos captures et des données du jeu ; le lot 0 est précisément l'étape qui le vérifie.

## 6. Questions pour l'utilisateur

1. **Option B ou A ?** Par défaut : B (modèle dédié).
2. **Grille** : toujours ouverte (recommandé) ou fermée la nuit, le dimanche et pendant les vacances ?
3. **Camion pizza** : garder la place actuelle (503,5 ; 1105) ou le ramener exactement à votre repère (499,1 ; 1102,5) ?
4. **Photos en plus** (par défaut, estimations) : les plateaux de sport, le gymnase et le toit blanc, l'arrière du bloc principal, la cour vue depuis la grille, le parking vu du nord (côté avenue).
5. **Passants** (§3.6) : lot 7 inclus ou exclu d'office ?
6. **Ordre** : par défaut 0 → 1 → 2 → 3 → 4 → 5 → 6, le parking en dernier car il ne dépend pas des bâtiments ; dites-moi si le parking ou l'entrée passent avant.

## 7. Captures « avant »

![Vue aérienne du collège : boîtes beiges, cour sans sol, trois plateaux rouges](../captures/college-avant-aerien.jpg)
![L'entrée : rampe à parapets pleins, aucun portail ni panneau](../captures/college-avant-entree.jpg)
![Le bâtiment principal vu du nord : un seul volume à toit plat, façade générique](../captures/college-avant-batiments.jpg)

## 8. À relever au lot 0

- Contour et hauteur de chaque aile ; lequel de `…848973`, `…849004`, `…848924` porte le bloc vitré, la barre de quatre niveaux, le volume aveugle.
- Direction exacte des façades (compas du mur le plus proche), axe de la grille.
- Pas, phase et direction de chaque rangée du parking, nombre de places, orientation des flèches de sens.
- Sol des trois plateaux (couleur, tracés), présence d'un grillage.
- Hauteur des parapets du pont, rayon de l'îlot de béton, position de l'arbre remarquable.
