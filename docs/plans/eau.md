# L'eau de la ville : fond, niveau, nage, véhicules qui coulent : plan

Enquête du 5 novembre 2026, sur `main` (après D238). Rien n'est modifié dans le jeu : ce fichier est le seul ajout.
Repère local du jeu (x vers l'est, y vers le nord), mètres ; altitudes relatives à `originZ` (330 m). Les prochains numéros de décision seront D239 et suivants.

Le décor du plan d'eau du Vallon (base de loisirs, pontons, chemin du tour du lac) n'est **pas** dans ce plan : il aura le sien, une fois l'eau en place (§7).

## 0. Ce qu'il faut retenir

1. **L'eau de la ville est une peinture sur le sol.** Les polygones d'eau (`structures/<tuile>.json`, champ `water`) et les ruisseaux (`streams`) sont dessinés
   par `buildWater` (`src/render/structures.ts`) **posés sur le relief nu**, à 6 cm au-dessus. Pour le jeu, il n'y a pas d'eau : seulement un sol bleu.
2. **Ce relief, sous l'eau, c'est la surface de l'eau.** Le LiDAR ne traverse pas l'eau : il rebondit dessus. Sous le plan d'eau du Vallon, le relief est plat à ± 0,4 m
   (§2). On marche donc sur la surface, et une voiture y roule.
3. **La mer (D105) a déjà la bonne mécanique** : un fond creusé (`build_coast.py` réécrit les blocs de relief publiés), un niveau (`world.json`, `sea.z`), et une règle de
   profondeur (`src/core/shore.ts` : à pied jusqu'à 1 m, voiture 0,5 m, deux-roues 0,35 m). L'eau de la ville reprendra ce modèle, avec **son propre niveau par plan d'eau**
   (l'Arroux descend : 2,5 m de dénivelé dans la zone, le Vallon est 22 m au-dessus de la mer).
4. **Aucune donnée publique ne donne la profondeur.** Les fonds seront **inventés**, plausibles et réglables (§3.2).
5. **Pas besoin des données brutes** (`.cache/`, absentes du conteneur) : comme `build_coast.py`, la nouvelle étape lit et réécrit les blocs publiés (`public/data/terrain/*.bin`).
6. Trois lots de jeu, chacun utilisable seul : **le fond et le niveau** (on n'avance plus sur l'eau, on y entre jusqu'à la taille), **la nage**, **les véhicules qui coulent**.
   La mer garde son comportement actuel (on ne nage pas au large).

## 1. Décisions déjà prises (avec l'utilisateur, 5 novembre 2026)

| Sujet | Choix |
|---|---|
| Ordre | l'eau d'abord, à part ; le décor du lac ensuite |
| Nage | oui, **dans l'eau de la ville seulement** ; la mer reste une limite (on y entre jusqu'à la taille) |
| Voiture dans l'eau profonde | elle **coule** et **tombe en panne** pour de bon |
| Gué peu profond (≈ 30 cm) | on passe, freiné ; on ne cale qu'au-delà de ≈ 0,5 m |
| Police | elle **s'arrête au bord** et attend (à pied comme en voiture) |
| Épave noyée | elle **reste au fond**, visible depuis la surface, et **disparaît quand on s'éloigne** (comme les épaves de D111) |
| Plongée | non : la caméra reste au-dessus de l'eau, pas de rendu sous-marin |

## 2. Inventaire de l'eau (données publiées)

Relevé par un script sur `public/data/structures/*.json` et les blocs de relief fins ; altitudes prélevées tous les 2 m dans chaque polygone.
Noms : OpenStreetMap (API, 5 novembre 2026) pour le Vallon ; les autres sont à nommer au lot 0.

**Polygones d'eau** : 62 après fusion des morceaux de tuiles, 48,2 ha en tout.

| Plan d'eau | Surface | Emprise (x ; y) | Altitude : 5 % / médiane / 95 % | Lecture |
|---|---|---|---|---|
| **Plan d'eau du Vallon** (OSM r1205156, `water=pond`) | 20,9 ha | 997–1487 ; 48–662 | −25,79 / −25,41 / −24,95 | plat : surface d'eau ; un seul niveau |
| Arroux (cours principal, probable) | 11,5 ha | −1519–230 ; 188–2539 | −42,69 / −41,73 / −40,24 | **pente** le long du cours : niveau variable |
| Arroux, aval nord (probable) | 4,4 ha | 129–904 ; 2938–4536 | −39,68 / −38,47 / −37,48 | pente |
| Plan d'eau ouest (à nommer) | 3,9 ha | −2130–−1446 ; −447–188 | −44,45 / −42,86 / −42,48 | presque plat |
| 21 autres (étangs, bras, bassins) | 0,1 à 1,3 ha | | | dont 4 dont le 5 % plonge de 5 à 7 m sous la médiane : touchés par la côte (§9 : seule leur bande de 40 m près de la côte reste à la mer) |
| Étang en amont du Vallon, sur le Brisecou (OSM w263507372, sans nom) | 0,19 ha | 1320–1391 ; −53–22 | −23,62 / −23,43 / −22,25 | petit, peu profond |
| Hors du lot : un bassin perché | 0,14 ha | −426–−379 ; −1250–−1128 | +61,6 | dans les collines du sud ; à identifier (réservoir ?) |

**Ruisseaux** (rubans) : 280 tronçons, 28,3 km. Largeurs données par le type OSM : 0,9 m (fossés), 1,6 m (ruisseaux), 6 m (rivières hors polygone, 31 tronçons, surtout
autour de (1050–1700 ; 880–970), (−1600 ; 2700–3050) et (0–400 ; 1160–1440), à identifier au lot 0). **Un seuil** (`weirs`) : (1351 ; 4), à la sortie de l'étang du Brisecou.
**52 tabliers** (ponts, passerelles) dans la zone.

**Autour du Vallon** (OSM, pour le plan du décor, pas pour celui-ci) : base de loisirs Marcel Lucotte (1310 ; 575), location de bateaux (1318 ; 581), **cale de mise à l'eau** (1306 ; 606),
**cinq pontons**, dont quatre flottants ((1283 ; 632), (1029 ; 310), (1036 ; 295), (1127 ; 168)) et un fixe (1292 ; 117), le ruisseau de Brisecou qui entre au sud (buse
sous (1353 ; 42)), un passage à gué en pas japonais (1350 ; 20), l'allée Marcel Lucotte et l'allée Jacques de la Comble, des bancs, des tables, des panneaux « Les oiseaux du lac »
et « Réglementation de pêche ». **Aucune plage ni zone de baignade** dans OSM. Les pontons ne sont pas dessinés dans le jeu aujourd'hui (`man_made=pier` n'est lu par aucune étape).

**Ce qui lit l'eau ou le relief sous l'eau** (à reprendre quand le fond sera creusé) :

| Code | Usage | Effet du fond creusé, sans correction |
|---|---|---|
| `buildWater` (`src/render/structures.ts`) | surface, liseré, rides, posés sur le relief nu | l'eau serait dessinée **au fond** |
| `ground.ts`, couche `water` des sols | aplat bleu posé sur le relief | idem |
| Canards (`src/game/animals.ts:196`) | `ground.heightAt + 0,06` | les canards nageraient au fond |
| Hérons | `terrain.heightAt + z` | pattes dans le vide ou dans la vase ; à poser au bord ou dans moins de 30 cm |
| Feu d'artifice du 14 juillet (`src/game/feasts.ts:65`) | reflet à `terrain.heightAt(1240, 420)` | le reflet descendrait au fond du lac |
| Relief grossier (`terrain/coarse.bin`) et pas de 5 et 12 m | relief lointain | le lac lointain serait un creux ; il faut la surface par-dessus |
| Piles de pont | tirées du tablier jusqu'au relief nu | plus longues, cachées par l'eau : sans effet |
| Minimap, carte | polygones d'eau | sans effet |

## 3. Le fond et le niveau (lot 1)

### 3.1 Le niveau de chaque plan d'eau

- **Un plan par polygone et par tuile** : `z = a·x + b·y + c`, ajusté par moindres carrés sur les cellules du polygone dont l'altitude est à moins de 0,3 m de la médiane
  (on écarte les berges et les îles comprises dans le polygone). Un plan d'eau plat comme le Vallon donne `a = b = 0` ; l'Arroux, découpé en morceaux de 250 m,
  suit sa pente par morceaux (≈ 0,25 m par morceau : les marches aux coutures, quelques centimètres, ne se voient pas). Les plans de deux morceaux voisins sont recalés à leur couture.
- Stocké dans `structures/<tuile>.json` : nouveau champ `wz` (un `[a, b, c]` par polygone de `water`, dans le même ordre) ; version de fichier relevée.
- **Mer** : seule la partie d'un polygone à moins de 40 m de la côte reste à la mer (la plage de `build_coast.py` y est déjà creusée). L'Arroux et le Ternin, qui finissent à la côte, sont donc de l'eau de la ville sur presque toute leur longueur (§9).
- **Révisé au lot 0** : l'ajustement d'un plan est trop bruité (le Vallon sort avec 0,6 m/km de pente, autant que l'Arroux ; seuls 17 % des cellules du grand polygone de l'Arroux sont à moins de 0,3 m de la médiane : il contient bancs et berges). On prend donc **la médiane par morceau de tuile**, lissée avec les morceaux voisins du même cours d'eau, et **un seul niveau pour un plan d'eau fermé** (lac, étang). `wz` reste un plan `[a, b, c]`, avec `a = b = 0` dans ce cas.

### 3.2 Le fond

Nouvelle étape `tools/data/build_water.py`, idempotente, lancée après `build_coast.py` et avant `build_nav.py` (même place que la mer dans la chaîne). Comme `build_coast.py`, elle
réécrit les blocs de relief fins publiés, puis le relief grossier.

- **Cellules creusées** : dans le polygone, et à moins de 0,3 m au-dessus du niveau (la vraie surface d'eau). Une berge ou une île à l'intérieur du polygone n'est pas touchée.
- **Profil** : `fond = niveau − min(P, d · s)`, où `d` est la distance (m) à la cellule sèche la plus proche, `s` la pente de la berge, `P` la profondeur maximale.
  Lissage léger (2 m) pour que le fond n'ait pas de marches.
- **Valeurs proposées**, réglables par plan d'eau dans `manual.json` (clé `water`), toutes **inventées** :

| Plan d'eau | P (profondeur maximale) | s (pente de berge) | On a pied jusqu'à (1,2 m) |
|---|---|---|---|
| Vallon | 3,0 m | 0,25 (berge naturelle) ; 0,08 sur une ou deux zones en pente douce, à placer au plan du décor (cale de mise à l'eau, base de loisirs) | ≈ 5 m du bord (15 m en pente douce) |
| Arroux | 1,6 m, fosses de 2,2 m dans les coudes | 0,2 | ≈ 6 m du bord : on nage au milieu, on a pied sur les côtés |
| Autres étangs | 1,5 m | 0,25 | |
| Bassins de moins de 0,2 ha | 0,8 m | 0,3 | on a toujours pied |

- **Idempotence** : au premier passage, les plans `wz` sont ajustés sur le relief d'origine et écrits dans `structures/`. Aux passages suivants, l'étape repart de ces plans
  (le relief est déjà creusé) : une cellule est « d'eau » si elle est dans le polygone et sous le niveau + 0,3 m, et son fond se recalcule à l'identique. On ne creuse jamais deux fois.
- **Arbres** : une cellule à moins de 2,5 m d'un arbre compte comme sèche. Les arbres du polygone (67 au Vallon, 266 dans l'Arroux, §9) se retrouvent sur un haut-fond ou une berge, jamais au milieu de l'eau profonde.
- **Queue du Vallon** (sud, y < 140 : arbres, arrivée du Brisecou, relief à ± 0,4 m du niveau) : marais peu profond, **0,4 m au plus**.
- **Bassins à bords hauts** (plus de la moitié du bord au-dessus de 0,8 m : #12 vers (−1427 ; 156), #19 et #29 dans les collines du sud) : **1,0 m au plus**, on y a toujours pied : personne n'y est piégé.
- **Ruisseaux** (rubans de 0,9 et 1,6 m) : **pas creusés**. Ils font 1 à 2 cellules de large, le LiDAR y voit déjà à peu près le lit, et l'eau réelle y fait 10 à 30 cm :
  on y marche, ce qui est juste. Ils gagnent seulement un clapotis et un léger freinage (§3.4). Les rivières en ruban de 6 m (§9 : l'Acaron, 2,5 km, et des bouts du Ternin) : **pas creusées non plus** ; le LiDAR voit déjà le lit de l'Acaron, 0,4 à 1,5 m sous ses rives. L'eau y est dessinée dans ce lit, on y marche.

### 3.3 Le dessin de l'eau

- `buildWater` dessine la surface **à plat, au niveau du plan** (`wz`), plus au relief nu : triangulation du polygone (le code de remplissage existe déjà, il faut une variante
  « à altitude donnée »). Le liseré clair et les rides passent au niveau de l'eau.
- La couche `water` des sols (`ground.ts`) n'est plus dessinée là où une surface `wz` existe (sinon un aplat bleu au fond, visible au bord par transparence des pas grossiers).
- **Surface opaque**, dans le style « affiche » actuel. Le fond ne se voit pas. Une variante plus tard : un dégradé plus sombre avec la profondeur (sans transparence).
- **Carte et minimap** (trouvé au lot 0) : elles ne peignent **pas** l'eau de la ville. `build_map.py` la lit dans la couche `water` des sols des tuiles, qui est vide depuis que l'eau est passée dans `structures/`. Le lac du Vallon et l'Arroux sont couleur papier sur la carte. À corriger au lot 1 (`build_map.py` lit `structures/`).
- **Eau lointaine** (trouvé au lot 0, `docs/captures/eau-avant-vallon-haut.jpg`) : au-delà des tuiles détaillées, l'eau n'est pas dessinée du tout ; on voit le sol vert. Il faut une surface d'eau dans les silhouettes lointaines (un maillage plat par super-tuile, quelques centaines de triangles).
- **Relief lointain** : au-delà des tuiles détaillées, le relief grossier montrerait des creux. Deux possibilités, à trancher au lot 1 selon ce qui coûte le moins :
  (a) le relief grossier garde la surface d'origine (on ne creuse que les blocs fins) ; (b) les silhouettes lointaines dessinent aussi la surface de l'eau. **(a) est proposé** :
  on ne voit jamais le fond de loin, et c'est une ligne dans `build_water.py`.
- Les pas de 5 et 12 m du relief proche : vérifier en capture que la berge ne passe pas au-dessus de l'eau (le bord peut se déplacer d'un mètre ou deux) ; sinon, monter la surface
  de quelques centimètres ou étendre le polygone dessiné d'un mètre sous la berge.

### 3.4 La règle de profondeur, partout

- **Registre de l'eau** (`src/core/waters.ts`, nouveau) : les polygones et leurs plans des tuiles chargées, indexés par cellule de 25 m ; `levelAt(x, y)` rend le niveau de l'eau
  (plan d'eau de la ville ou mer) ou `undefined`. Alimenté par le `TileManager` à chaque chargement ou déchargement de tuile, comme les sièges (`Seats`).
- `HeightField` gagne `waterAt?(x, y): { z: number; sea: boolean } | undefined`. `shore.ts` (`waterDepth`, `holdShore`, `shoreNormal`) s'appuie sur lui au lieu de `seaLevel`
  seul : le piéton, la voiture et le deux-roues retrouvent sur le lac **exactement** ce qu'ils font à la mer (entrer jusqu'à la taille, freinage, arrêt au bord).
- **Au lot 1, sans nage**, le résultat est donc : on n'avance plus sur l'eau ; on y entre jusqu'à 1 m et on longe la berge. C'est l'état minimal cohérent.
- Ruisseaux : un clapotis (son) et un freinage de 20 % à pied, rien de plus.
- **Hors des tuiles détaillées** (plus de 210 m du joueur), le registre est vide : la circulation et les piétons suivent la navigation, qui ne passe pas dans l'eau ; à vérifier au lot 1
  (§6, risque 4).

### 3.5 Ce qui suit le niveau

- Canards : posés sur `waterAt().z` ; hérons : seulement là où la profondeur est sous 0,3 m.
- Reflet du feu d'artifice : le niveau du Vallon (`waterAt(1240, 420).z`), plus le relief.
- Arbres, mobilier, murs, lampadaires qui tomberaient dans un polygone creusé : listés au lot 0 (aucun, normalement) ; retirés ou gardés hors du creusement.

## 4. La nage (lot 2)

### 4.1 Le comportement

| | Proposé |
|---|---|
| Passage marche → nage | profondeur au-dessus de **1,2 m** (l'eau à la poitrine) ; retour à la marche sous 1,0 m (écart pour ne pas battre entre les deux) |
| Vitesse | 1,2 m/s ; 1,9 m/s en « courant » (crawl) ; sans limite de durée (le jeu n'a pas d'endurance, voir §8) |
| Altitude | le corps à la surface : bassin à `niveau − 0,35 m`, tête dehors ; une petite houle de 3 cm |
| Interdit en nageant | armes (rangées, reprises à la sortie), saut, escalade, entrer dans un véhicule, s'asseoir |
| Mer | **pas de nage** : la règle actuelle (1 m) reste, `waterAt().sea` le dit |
| Sous un pont | la surface demandée avec l'altitude du nageur (`heightAt(x, y, zHint)`) : on passe sous le tablier sans y être tiré |
| Sauvegarde | l'état « nage » se déduit de la profondeur au chargement : rien à sauver de plus |

### 4.2 Sortir de l'eau (le point délicat)

- **Berge en pente** (le cas courant, puisque le fond est creusé en pente) : on remonte en marchant dès qu'on a pied. Rien de spécial.
- **Bord franc** (quai, mur de berge, ponton plus tard) : si le bord est **à moins de 0,8 m au-dessus de l'eau**, on se hisse (geste court, réutilise le mécanisme d'escalade
  `startClimb` avec une hauteur de départ à la surface). Au-dessus de 0,8 m, c'est un mur : on le longe à la nage.
- **Longs bords hauts** (§9) : deux seulement dépassent 150 m, dans l'Arroux : 496 m vers (−733 ; 1840) et 204 m vers (230 ; 2503). On y ajoute une **sortie aménagée** (marches taillées dans la berge) tous les 100 m environ. Les bassins à bords hauts ont un fond à 1 m (§3.2) : on y a pied.
- **Passerelle basse** : celle de l'Arroux (`248051711`) n'est qu'à 0,34 m au-dessus de l'eau. Un nageur ne passe pas dessous : elle devient un obstacle dans l'eau. Seuil : moins de 0,6 m de hauteur libre.

### 4.3 Le dessin et le son

- **Pose de nage** (`swimPose`, `src/core/character-rig.ts`, logique pure comme `walkPose` et `climbPose`) : brasse, corps incliné de 70° vers l'horizontale, tête relevée,
  cycle de bras et de jambes lié à la vitesse ; au repos, nage sur place (corps plus vertical, battements lents). Crawl en « courant ».
- **Ce qui se voit** : seul le haut du corps dépasse ; l'eau opaque cache le reste sans effort.
- **Effets** : une ride en anneau qui s'étend derrière le nageur (quelques sprites, un appel de dessin), une gerbe en entrant dans l'eau profonde (et en y tombant d'un pont).
- **Sons** (`src/audio/synth.ts`) : plouf à l'entrée, brasse en boucle, sortie qui ruisselle.
- **Caméra** : abaissée de ≈ 0,5 m, jamais sous la surface (plancher au niveau de l'eau + 0,3 m).

### 4.4 La police et les piétons

- Les agents à pied s'arrêtent au bord (la règle de profondeur de §3.4, avec une limite de 1 m pour eux), regardent vers le nageur et attendent ; la recherche (`wanted`) continue
  normalement. **Ils ne tirent pas sur un nageur** (§8).
- Les voitures de police restent sur la route.
- Les piétons ne vont pas à l'eau.

## 5. Les véhicules qui coulent (lot 3)

### 5.1 La voiture

| Profondeur sous le centre du véhicule | Effet |
|---|---|
| jusqu'à 0,5 m | elle roule, **freinée** (le freinage actuel de la mer : `1 − 3·profondeur·dt`) ; gerbes aux roues |
| 0,5 à 0,8 m | elle flotte à moitié : la traction tombe à presque rien, elle dérive en ralentissant ; le moteur **cale** au-delà de 0,7 m |
| au-delà de 0,8 m | elle **coule** : elle s'enfonce en ≈ 6 s, le nez d'abord (le moteur pèse à l'avant), bulles en surface, et se pose au fond |

- **Panne** : nouvelle fin `drowned` à côté de `breakdown` dans `VehicleDamage` (`src/core/damage.ts`) : `end` posé, `usable` faux, **ni feu ni fumée**. Le véhicule ne repart plus.
- **Le joueur** au volant sort tout seul quand le toit passe sous l'eau, à côté de la portière, **en nage** (lot 2). Il peut aussi sortir avant, à la nage ou à pied selon la profondeur.
- **L'épave** reste au fond, dessinée avec un voile bleu foncé (l'eau est opaque : on voit sa silhouette sombre sous la surface, sans transparence réelle : une tache plus sombre
  sur la surface suffit à la signaler). Elle disparaît quand le joueur s'éloigne au-delà de la distance des épaves de D111. Elle n'est pas sauvegardée.
- **Sur la mer** : rien ne change (la voiture s'arrête au bord, D105).

### 5.2 Les deux-roues

- Moto, scooter : au-delà de 0,35 m, le pilote **tombe à l'eau** (il nage ou marche selon la profondeur) ; la machine se couche et coule, **en panne** (même fin `drowned`).
- Vélo, trottinette : le cycliste tombe ; l'engin coule, **inutilisable** (comme un deux-roues sans moteur cassé, D111). Pas de récupération dans ce lot.

### 5.3 La circulation et la police

- La circulation ne quitte pas la route : elle n'entre jamais dans l'eau.
- Une voiture de police qui poursuit ne suit pas le joueur dans l'eau : elle s'arrête au bord (même arrêt que les autres véhicules à 0,5 m, sans couler).
- Une voiture **poussée** dans l'eau (choc) coule comme celle du joueur.

## 6. Risques

1. **Le contour OSM et le vrai bord ne coïncident pas.** Là où le polygone déborde sur la berge, rien n'est creusé (règle des 0,3 m) : pas de trou. Là où il est plus petit que
   l'eau réelle, une bande reste « de l'eau dure » colorée en herbe ou en sol. Mesure au lot 0 (surface plate au niveau, hors polygone, dans un rayon de 10 m) ; correction du contour
   si c'est fréquent, sinon au plan du décor pour le Vallon.
2. **La sortie de l'eau** (§4.2) : c'est le point qui peut coûter plus que prévu, surtout le long des quais de l'Arroux. Signalé dès le lot 0 s'il y a des bassins sans sortie.
3. **Les ponts** : la surface choisie avec `zHint` doit garder le nageur sous le tablier et ne pas le faire « monter » dessus. Tests dédiés.
4. **Hors des tuiles détaillées** le registre de l'eau est vide. Un véhicule de la circulation poussé dans l'eau loin du joueur n'y coule pas ; sans importance (personne ne le voit),
   mais à ne pas laisser rouler sur l'eau quand la tuile se recharge : au chargement, un véhicule garé ou abandonné dans l'eau est retiré.
5. **Poids des données** : seules les tuiles avec de l'eau sont réécrites (environ 40 blocs fins sur 426 ; le relief compressé change à peine de taille). Aucun nouveau fichier lourd.
6. **Performances** : le registre (index de 25 m) coûte une recherche par piéton ou véhicule près de l'eau et par pas ; mesuré au banc (`?bench`) au lot 1.

## 7. Lots

| Lot | Contenu | Résultat dans le jeu | Décision |
|---|---|---|---|
| **0. Relevés** | noms des plans d'eau (OSM) ; liste des polygones touchés par la mer (exclus) ; rivières en ruban de 6 m ; types de berges (pente, quai, mur : hauteur du bord au-dessus du niveau, au LiDAR) ; écarts entre contour et eau réelle ; arbres, mobilier ou murs dans les polygones ; captures « avant » | aucun | D239 |
| **1. Fond et niveau** (fait, §10) | `build_water.py` (plans `wz`, creusement, relief grossier) ; dessin de la surface au niveau, eau lointaine, eau de la ville sur la carte et la minimap ; registre `waters.ts` et `waterAt` ; `shore.ts` généralisé ; canards, hérons, reflet du feu d'artifice | on ne marche plus sur l'eau : on y entre jusqu'à la taille ; véhicules freinés puis arrêtés comme à la mer | D240 |
| **2. Nage** | état nage du joueur ; pose ; sortie (pente, bord bas) ; armes rangées ; sons, rides, gerbes ; caméra ; police qui attend au bord | on nage dans l'eau de la ville ; la mer ne change pas | D241 |
| **3. Véhicules qui coulent** | fin `drowned` ; flottaison, calage, enfoncement ; sortie du conducteur ; épave au fond ; deux-roues | une voiture qui entre dans le lac coule et ne repart plus | D242 |
| Ensuite | plan du **décor du lac** (`docs/plans/vallon-lac.md`) : base de loisirs, cale, pontons (avec bord bas pour sortir de l'eau), chemin du tour du lac, zones en pente douce | | |

Chaque lot est vérifié dans le navigateur (captures, comme d'habitude) avant le suivant ; on peut s'arrêter après n'importe lequel sans laisser le jeu incohérent.

### Tests prévus

- **Lot 1** : plan ajusté (Vallon : pente nulle, niveau −25,4 ± 0,1 ; Arroux : pente dans le sens du courant) ; fond sous le niveau partout dans le polygone, berge intacte,
  profondeur maximale respectée ; idempotence (deux passages, même fichier) ; `waterAt` (dedans, dehors, trou d'un polygone, mer, tuile déchargée) ; `holdShore` sur le lac ;
  surface dessinée au niveau (maillage à altitude constante sur le Vallon) ; canard à la surface ; reflet du feu d'artifice au niveau.
- **Lot 2** : passage marche ↔ nage avec écart ; vitesse ; pas de nage en mer ; sortie par pente et par bord bas, blocage par bord haut ; nage sous un pont (tablier non pris) ;
  armes rangées puis rendues ; pose de nage finie (pas de NaN), tête au-dessus de l'eau ; agent à pied arrêté au bord.
- **Lot 3** : seuils de 0,5 / 0,7 / 0,8 m ; gué à 0,3 m franchi ; fin `drowned` sans feu ; conducteur éjecté en nage ; épave au fond, puis retirée à distance ; moto et vélo ;
  voiture de police arrêtée au bord ; mer inchangée (D105, tests existants de `shore.test.ts`).

## 8. Réponses de l'utilisateur (5 novembre 2026)

1. **Profondeur** : inconnue, et sans importance tant que ça ressemble à un vrai lac (on ne plonge pas). Les valeurs du §3.2 restent.
2. **Police et nageur** : elle ne tire pas, elle attend au bord.
3. **Endurance** : non, on nage sans limite.

## 9. Lot 0 : relevés (5 novembre 2026, D239)

Script : `tools/data/survey_water.py`, sur les données publiées (aucune donnée brute) ; noms par l'API OpenStreetMap ; tous les chiffres dans `tools/data/water_survey.json`.
Captures « avant » : `docs/captures/eau-avant-vallon-haut.jpg` (vue haute), `eau-avant-vallon-surface.jpg` (caméra à 1,7 m, debout sur le lac), `eau-avant-voiture-sur-le-lac.jpg` (voiture arrêtée au milieu du lac).

### 9.1 Les plans d'eau

| # | Nom (OSM) | Surface (en ville) | Niveau | Berges : douce / bord bas / bord haut | Plus long bord haut | Arbres dedans | Ponts (hauteur libre) |
|---|---|---|---|---|---|---|---|
| 0 | Plan d'eau du Vallon | 20,85 ha | −25,41 (écart 0,15 m) | 71 % / 22 % / 7 % (2,2 km) | 68 m vers (1341 ; 534), au bord de la base de loisirs | 67, presque tous dans la queue sud (y < 140) | aucun |
| 1 | L'Arroux, traversée de la ville | 11,44 ha | −42,3 à −40,2 | 44 % / 21 % / 35 % (10,1 km) | **496 m** vers (−733 ; 1840) | 266 | 4 ponts : routes 3,2 et 5,3 m ; passerelles **0,34**, 1,2, 1,6, 2,4 m |
| 2 | L'Arroux, aval nord | 4,28 ha | −40,4 à −37,5 | 79 % / 16 % / 5 % | 56 m | 75 | une passerelle, 3,3 m |
| 3 | L'Arroux, amont ouest | 3,27 ha | −42,9 | 92 % / 5 % / 3 % | 22 m | 50 | aucun |
| 4 | L'Arroux, bras nord | 1,31 ha | −39,9 | 71 % / 11 % / 18 % | **204 m** vers (230 ; 2503) | 33 | aucun |
| 5 | Le Ternin | 0,55 ha | −36,2 | 89 % / 10 % / 1 % | 6 m | 23 | aucun |
| 14 | Étang en amont du Vallon (sur le Brisecou) | 0,19 ha | −23,45 | 40 % / 19 % / 40 % | 48 m | 6 | aucun |
| | 31 autres, de 0,04 à 0,48 ha | | | pentes douces surtout | | | |

- **Mer** : avec la bande de 40 m laissée à la côte, les polygones #11, #16, #18, #22, #35 et #37 restent à la mer (moins de 20 % de leur surface en ville). Tous les autres sont de l'eau de la ville.
- **Plans d'eau perchés** dans les collines du sud (#19 à +61,6 m, #29 à +46,7 m, #26, #28, #36) : des étangs ou réservoirs, traités comme les autres. #19 et #29 ont près de la moitié de leur bord en bord haut, d'où la règle du fond à 1 m (§3.2).
- **Aucun mobilier, mur ni bâtiment** dans un polygone. Seulement des arbres (§3.2).
- **Eau hors contour** (relief plat au niveau de l'eau, hors du polygone, à moins de 15 m) : 212 m² au Vallon, négligeable. Le long de l'Arroux : 4 700, 15 300 et 7 300 m². C'est un indice, pas une preuve : le contour OSM ne suit pas partout l'eau réelle, ou ce sont des grèves et des prés au ras de l'eau. On ne corrige pas au lot 1 ; on regardera en capture.

### 9.2 Les rivières en ruban (6 m) et les ruisseaux

- **L'Acaron** : 2,5 km de ruban, de (−36 ; 1339) à (1594 ; 908) en passant par le collège. Le LiDAR voit déjà le lit, **0,4 à 1,5 m sous les rives**. On ne creuse rien : l'eau sera dessinée dans le lit et on y marchera.
- **Le Ternin** (bouts en ruban, autour de (−1550 ; 2700–3050)) : lit au niveau des rives (le LiDAR ne voit pas de creux). Rien à creuser, on y marche.
- Ruisseaux : 18,3 km à 1,6 m, 6,9 km de fossés à 0,9 m. Inchangés (§3.2).

### 9.3 Ce que les captures montrent

- On se tient debout au milieu du lac, et la voiture y est garée comme sur un parking.
- **L'eau lointaine n'est pas dessinée** : au-delà des tuiles détaillées, la moitié sud du lac est un pré vert (vue haute). Ajouté au lot 1 (§3.3).
- **La minimap ne montre pas le lac** (couleur papier sous la voiture) : la carte ne peint pas l'eau de la ville. Ajouté au lot 1 (§3.3).

### 9.4 Ce qui change dans le plan

- Niveau : médiane par morceau de tuile, un seul niveau pour un plan d'eau fermé (§3.1).
- L'Arroux et le Ternin sont de l'eau de la ville, sauf leur bande de 40 m près de la côte (§3.1).
- Arbres sur haut-fond, queue du Vallon en marais à 0,4 m, bassins à bords hauts à 1 m (§3.2).
- Rivières en ruban : pas creusées (§3.2).
- Carte, minimap et eau lointaine à corriger au lot 1 (§3.3).
- Sorties aménagées sur les deux longs bords hauts de l'Arroux, passerelle basse en obstacle (§4.2).

## 10. Lot 1 : fond et niveau (5 novembre 2026, D240)

Fait. Ce qui diffère du plan :
- **Registre global** : l'eau de la ville est dans un seul fichier, `water.json` (44 ko, chargé au démarrage), et non par tuile. La règle de profondeur marche donc partout, et l'eau lointaine
  se dessine à partir du même fichier (un maillage, un appel de dessin).
- **Profondeur sous la surface où l'on se tient** (`waterDepth(…, zHint)`) : sur un pont, elle est nulle ; dessous, c'est celle du fond. Sans cela, un pont sur l'Arroux serait devenu infranchissable.
- **Niveaux** : un seul pour un plan d'eau fermé (désigné dans `manual.json`, ou de moins d'1 ha, ou dont les morceaux s'accordent à 0,4 m près) ; pour une rivière, le quart bas du relief de
  chaque morceau (les bancs relèvent la médiane), puis un plan qui passe par les coutures avec ses voisins. Écart aux coutures : 4 mm en médiane, 9 cm pour 90 % des points, 25 cm au pire.
- **Relief grossier non creusé** (§3.3, option a).
- Le **creux de l'anse nord-ouest du Vallon** (1 à 5 m sous le niveau, vers (1090 ; 550)) était déjà dans le relief d'origine (trou du LiDAR) : c'est maintenant une zone profonde, invisible sous la surface.
- **Carte et minimap** : `build_map.py --images` refait seulement les images, avec l'eau lue dans `structures/`.

Reste pour le lot 2 : la nage (le personnage s'arrête aujourd'hui à 1 m), les sorties aménagées de l'Arroux, la passerelle basse en obstacle, la police qui attend au bord.

