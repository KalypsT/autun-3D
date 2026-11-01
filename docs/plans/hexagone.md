# L'Hexagone, son parvis et son parking : plan (phase A)

Enquête du 1ᵉʳ novembre 2026, sur `main` (D163). Rien n'est modifié dans le jeu : ce fichier et trois captures « avant » (`docs/captures/hexagone-avant-*.jpg`)
sont les seuls ajouts. Les photos de l'utilisateur ne sont pas versionnées : seule leur lecture est écrite ici. Repère local du jeu (x vers l'est,
y vers le nord), mètres ; caps en degrés depuis le nord, sens horaire.

## 0. Ce qu'il faut retenir

1. **Le bâtiment est mal construit, pas seulement mal habillé.** L'Hexagone est `BATIMENT0000000348844694` (type `culture`, tuile 27_35). Son
   contour BD TOPO est un anneau de **56 sommets en escalier** (67 × 58 m) : seuls 7 murs dépassent 8 m, le plus long en fait 26 m. La façade de
   la photo (une façade droite à quatre doubles portes sous deux bandeaux de béton) **n'existe pas** comme mur de ce contour. Une simple fiche de
   façade, comme pour l'hôpital de Latouche (D163), ne suffira donc pas.
2. **Le toit est faux.** Les 34 plans LiDAR au-dessus de 6 m ont tous une pente plafonnée à 0,70 (35°) : c'est la pente par défaut de l'ajusteur,
   pas une mesure. Résultat visible sur la capture « avant » : une masse bleu nuit hérissée d'éclats et d'arêtes parasites, alors que la photo
   satellite montre une pyramide à pans réguliers en bac acier bleu-gris, entourée de toits-terrasses.
3. **La façade actuelle est générique** : enduit beige, petites fenêtres « picture » de 1,5 × 1,3 m, rez-de-chaussée « shop » à porte rouge,
   fiche `estimated` à 60 %. Absents : les deux bandeaux de béton en débord, les piliers rosés, les portes vitrées, l'enseigne « HEXAGONE ».
4. **Le parvis est un sol nu.** Le dallage géométrique (losanges et triangles rose brique, beige et gris anthracite), la sphère rayée, les
   topiaires en spirale dans leur bac hexagonal, les mâts à drapeaux, le lampadaire à tête triangulaire et la colonne Morris n'existent pas.
5. **Le parking de l'Hexagone (OSM 251682899) est dans l'état où se trouvait le Champ de Mars avant D154** : des traits de 4,8 m posés tous les
   2,5 m le long d'allées OpenStreetMap, épars et mal orientés (capture « avant »), contre cinq à six rangées régulières sur la vue satellite.
6. **Un doute à vérifier (hors Hexagone)** : les barres d'immeubles voisines (rue Henri-Dunant, rue du 8-Mai-1945) sont rendues avec des toits
   rouges à croupes (pente 0,70 là aussi), alors que la vue satellite montre des toits-terrasses gris à édicules. Même cause probable que le point 2.

## 1. Les photos

| n° | Ce que je lis | Lieu, caméra déduite | Certitude |
|---|---|---|---|
| 1 | Photo diurne, arbres nus. Bâtiment bas à étage unique visible, **deux bandeaux de béton rosé superposés en débord** qui font le tour de la façade, quatre ensembles de portes vitrées doubles sous le bandeau, piliers rosés entre les vitrages, grand toit bleu-gris à joints debout en pyramides à plusieurs pans au-dessus. À gauche, aile basse en enduit beige ; à droite, **sphère rayée** en pierre claire sur socle. Au premier plan, parvis dallé de losanges et de triangles (rose brique, beige, gris sombre), bac hexagonal blanc à gravier noir et topiaires en spirale, lampadaire à tête triangulaire, mâts à drapeaux. | Parvis, face à la façade principale, caméra à 30 m environ de la façade. Façade tournée vers l'**ouest-sud-ouest** (cap sortant ≈ 250° ± 20°, à confirmer sur le contour). | 85 % |
| 2 | Street View juil. 2026. Même façade, plus près, de biais : lettres « ◉ HEXAGONE » sur le bandeau bas, **quatre à cinq ensembles de portes doubles** (nombre exact à compter au lot 0), deux **grandes topiaires en spirale** (≈ 3,5 m) et un second bac au fond, **deux drapeaux (France, Europe)** sur mâts à gauche, **sphère** et **colonne Morris** à droite, arceaux à vélos à gauche, lampadaire à triangle au centre. Arbres feuillus autour. | Parvis, un peu à gauche de la photo 1, cap ≈ 70° (vers l'est-nord-est). | 85 % |
| 3 | Vue satellite Google Maps, **carte tournée d'environ 30°** (le boulevard Latouche descend en diagonale ; même rotation que pour l'hôpital en D163). Toit octogonal à douze pans bleus au centre, couronne de toits-terrasses gris, parvis à losanges au sud-ouest. **Grand parking** au nord-ouest (« Parking Hexagone »), cinq à six rangées de places perpendiculaires aux allées, un petit bâtiment à toit plat dans le parking, rangée d'arbres le long du boulevard Frédéric-Latouche (ouest). Rue du 8-Mai-1945 au nord, rue Henri-Dunant à l'est, deux barres d'immeubles à toits-terrasses. | Orthophotographie IGN à redresser pour les mesures. Hexagone (389 ; 186), parking OSM (327 ; 260), à 95 m au nord-ouest. | 90 % |

Détails à ne pas oublier, lus sur la photo 2 : **l'enseigne n'est pas visible sur la photo 1** (elle a pu être ajoutée ou être cachée par l'angle) ; la colonne Morris porte
des affiches ; l'écart de saison entre les deux photos explique des arbres nus d'un côté et feuillus de l'autre.

## 2. État des données

| Élément | État actuel | Verdict |
|---|---|---|
| Contour | anneau BD TOPO de 56 sommets, 355–422 × 156–214 | trop crénelé pour une façade droite |
| Hauteurs | sol −3,62 ; égout +0,99 (4,6 m) ; faîtage +5,59 (9,2 m) | plausibles ; le faîtage vient d'une face plate de 1 105 m² |
| Toit | `hip`, 14 plans, pente 0,70 partout | **faux** (pente par défaut) |
| Fiche | `estimated`, 0,6 ; `plaster #cfc9bb` ; fenêtres « picture » ; porte rouge | à remplacer |
| Mobilier | aucun objet de parvis | à créer |
| Parking | traits aléatoires (OSM 251682899) ; places trouvées par `findStalls` | à refaire |
| Navigation | super-tuile existante, **non touchée** (convention D154) | inchangée |

## 3. Propositions

### 3.1 Le bâtiment : trois niveaux d'ambition

| | A. Fiche de façade seule | **B. Modèle dédié (recommandé)** | C. B + intérieur |
|---|---|---|---|
| Principe | comme Latouche (D163) : `fiches` + devanture moderne | comme le Temple de Janus ou l'hôtel de ville : volumes mesurés au LiDAR (`build_monuments.py`), détails lus sur photo (`manual.json`) | B, plus salle de spectacle jouable |
| Résultat | façade correcte sur un contour crénelé, toit toujours faux | pyramide régulière, couronne de toits-terrasses, bandeaux en débord, portes vitrées, enseigne | idem |
| Coût | 1 lot | 2 lots | 5 lots ou plus, hors périmètre |
| Défaut | ne règle pas le point 1 ni le point 2 | un type de bâtiment de plus à maintenir | collisions, navigation, éclairage intérieur |

**Recommandation : B.** Le bâtiment actuel est un contour de 56 sommets coiffé d'un toit à pente par défaut ; l'habiller n'en ferait qu'un meilleur déguisement
d'une mauvaise forme. B s'appuie sur une mécanique éprouvée (`CathedralModel`, `TownHallSpec` dans `src/data/types.ts`, rendu dans `src/render/monuments.ts`).
C n'est pas justifié tant que rien dans le jeu n'oblige à entrer dans un bâtiment (je n'ai pas vérifié si un intérieur est prévu ailleurs dans le jeu ; rien dans cette demande n'en parle).

Contenu proposé du modèle B (repère local : centre du toit, axe orienté sur la façade principale) :
- **Pyramide centrale** à douze pans, pente et hauteur au LiDAR (arête à ≈ 9,2 m, égout à ≈ 4,6 m), bac acier bleu-gris à joints debout (texture de lames à 60 cm).
- **Couronne basse** : toits-terrasses gris, un étage, qui font le tour de la pyramide ; l'anneau BD TOPO ne sert plus qu'à contrôler l'emprise.
- **Façade principale** : deux bandeaux de béton rosé en débord (≈ 1,0 m, épaisseurs lues sur la photo, à fixer à ± 0,15 m), piliers entre les vitrages, quatre à cinq travées de portes vitrées doubles, vitrage fumé, enseigne « HEXAGONE » sur le bandeau bas.
- **Autres côtés** : enduit beige, bandeaux répétés, portes de service ; estimés (aucune photo), marqués `estimated` dans la fiche.
- **Nuit** : enseigne et vitrines émissives (le jeu a déjà `glow` dans `MeshBuilder`).

### 3.2 Le parvis

- **Dallage** : trois classes de sol (rose brique, beige, gris anthracite) posées en losanges et triangles réguliers selon un gabarit déduit de la photo 1 et du satellite ; il se range dans `plaza_paving` sans nouveau shader (couleurs par polygone, comme D154 pour l'allée du Champ de Mars).
- **Mobilier** (props, avec collision et cassable selon D160 là où c'est raisonnable) : sphère rayée (≈ 2,5 m) sur socle, deux bacs hexagonaux avec topiaires en spirale, mâts à drapeaux (France, Europe, un troisième), lampadaire à tête triangulaire, colonne Morris avec affiches, arceaux à vélos.
- **Arbres** : ceux du boulevard Latouche et des abords sont déjà dans `trees` (182 sur la tuile) ; à contrôler contre la photo 2 seulement.

### 3.3 Le parking

- **Méthode D154** : redresser l'orthophotographie (le boulevard Latouche devient vertical), lire les pics de lignes blanches, fixer pas et phase de chaque rangée, puis ajouter une entrée `lots` à `streetscape` dans `manual.json`. `build_streetscape.py` remplace les anciennes marques de la zone par des polygones propres, sans toucher à `vehicles.ts` : les voitures garées utilisent les places via `findStalls`.
- **Attendu** : cinq à six rangées (simples ou dos à dos), nombre exact de places à compter sur l'orthophotographie (je ne le chiffre pas avant lecture), allées, îlots d'angle plantés, passage piéton à la sortie rue du 8-Mai-1945.
- **Piège connu (D154)** : les lignes sous les voitures sont invisibles ; si l'orthophotographie est prise un jour de forte occupation, les premières places seront extrapolées au pas. Une photo du parking vide (tôt un dimanche) lèverait le doute.

### 3.4 En option : les toits-terrasses voisins

Test simple avant de décider : pour les barres …377 et …387 (tuile 27_36), comparer le profil LiDAR sur une coupe nord-sud ; si le toit est plat, forcer `roofKind: flat`. À ne faire que si le test le confirme, dans un lot séparé (le changement touche des bâtiments que la demande ne mentionne pas).

## 4. Plan d'implémentation

Chaque lot : un commit, une décision `D164…` dans `docs/DECISIONS.md`, captures avant/après dans `docs/captures/`, `PROGRESS.md` à jour, `npm run typecheck && npm run lint && npm test` verts. Aucune relance de `build_nav.py` (navigation de `main` gardée comme en D154), sauf demande contraire.

| Lot | Contenu | Fichiers principaux | Tests (cible) |
|---|---|---|---|
| **0. Relevés** | redresser l'orthophotographie autour de (389 ; 186) ; mesurer largeur de façade, nombre et largeur des travées, orientation exacte (compas du mur le plus proche de 250°), sol du parvis ; confirmer l'enseigne ; coupe LiDAR de la pyramide | `tools/data/` (script jetable), notes dans la décision | — |
| **1. Volumes et toit** | type `hexagone` : `HexagoneSpec` dans `types.ts`, mesure dans `build_monuments.py` (pyramide, couronne), rendu `buildHexagone` dans `monuments.ts`, rattachement dans `landmarks.ts` ; l'ancien bâtiment …694 passe en `hidden` ou est remplacé | `src/data/types.ts`, `tools/data/build_monuments.py`, `src/render/monuments.ts`, `src/render/landmarks.ts`, `manual.json` | arête entre 8,5 et 10 m ; douze pans ; pas de plan plus penché que sa mesure ; l'ancien volume n'est plus rendu |
| **2. Façade** | bandeaux en débord, piliers, portes vitrées, enseigne, émissif de nuit | `monuments.ts`, texture d'enseigne (`sign-atlas.ts`), `manual.json` | bandeau bas dans l'emprise et en débord ; au moins quatre travées de portes sur la façade ; lettres dans le bandeau |
| **3. Parvis** | gabarit de dallage et zone de nettoyage dans `streetscape` ; sol de la place retiré de l'ancien aplat | `manual.json`, `build_streetscape.py`, tuile 27_35 | dallage trois couleurs, aucune dalle dans l'emprise du bâtiment ni sur la chaussée |
| **4. Mobilier** | sphère, bacs et topiaires, mâts et drapeaux, lampadaire, colonne Morris, arceaux ; collisions, objets cassables selon D160 | `src/render/props.ts`, `src/core/breakables.ts`, `manual.json` | chaque objet à plus de 1,5 m de la façade ; le joueur ne reste pas coincé entre deux bacs |
| **5. Parking** | rangées lues à l'orthophotographie, anciennes marques retirées, îlots, passage piéton | `manual.json` (`lots`), `build_streetscape.py`, `src/data/streetscape.test.ts` | entre N − 10 % et N + 10 % places (N compté au lot 0) ; toutes perpendiculaires à leur rangée à 5° ; aucune dans une allée |
| **6. (option) Toits voisins** | si la coupe LiDAR le confirme : `roofKind: flat` pour les barres …377, …387 | `manual.json`, `build_roofs.py` | pente des toits plats nulle ; hauteur inchangée |

Budget : le jeu rend déjà environ 610 000 triangles autour de l'Hexagone ; le modèle (pyramide, couronne, bandeaux, portes) doit rester sous 15 000 triangles et les sept à dix props sous 8 000.

## 5. Risques et limites

- **Contour et façade en désaccord** : si l'axe de la photo ne tombe pas sur un mur de l'anneau BD TOPO, le modèle B suit la photo et le LiDAR, pas l'anneau. L'écart d'emprise (jusqu'à 2 m) peut faire déborder un bandeau sur le trottoir ; le lot 0 le mesure.
- **Faces non photographiées** : arrière, côtés et couronne de toits-terrasses seront estimés ; la fiche reste `estimated` pour ces murs.
- **Hauteurs et épaisseurs** des bandeaux, lues sur photo à ± 0,15 m, pas mesurées.
- **Saison** : photos prises par temps et saisons différents ; les couleurs du béton et du bac acier changent avec la lumière. Les teintes retenues sont des moyennes à valider à l'écran.
- **Droits** : Street View et captures satellites ne servent que de référence de lecture, comme pour les lots précédents ; rien n'en est copié (textures et dallage sont dessinés).

## 6. Questions pour l'utilisateur (avec une valeur par défaut si vous ne répondez pas)

1. **Option B ou A ?** Par défaut : B. Si vous préférez avancer vite, A donne une façade correcte en un lot mais laisse le toit tel quel.
2. **Photos des autres faces** (arrière, côtés, toits vus de dessus) et **une photo du parking à vide** : par défaut, estimations et extrapolation au pas.
3. **Toits voisins** (§3.4) : lot 6 inclus seulement si la coupe LiDAR le confirme ; dites-moi si vous préférez l'exclure d'office.
4. **Ordre** : par défaut 0 → 1 → 2 → 3 → 4 → 5, le parking en dernier car il ne dépend pas du bâtiment ; dites-moi si le parking passe avant.

## 7. Captures « avant »

![Vu du sud, vers la face arrière](../captures/hexagone-avant-sud.jpg)
![Vue aérienne depuis le sud : le toit bleu nuit, le parvis nu](../captures/hexagone-avant-aerien.jpg)
![Le parking de l'Hexagone : traits aléatoires](../captures/hexagone-avant-parking.jpg)
