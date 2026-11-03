# Toits praticables : on survole, on se pose, on marche sur les toits (plan)

**Avancement** : **lot 1 fait** (D214), **lot 2 fait** (D215 ; seuil de glissade tranché : le véhicule glisse au-delà de 30°, le piéton tient ; la marche sur les toits et la caméra, prévues aux lots 3 et 4, y sont avancées), **lot 4 fait** (D216, avant le lot 3 à la demande de l'utilisateur). **lot 5 fait** (D217). **lot 3 fait** (D218) : **chantier terminé**. Reste à régler en jouant : la portée du saut long (4,7 m) et la vitesse de glissade des véhicules.
la voiture passe au-dessus d'une maison, mais s'arrête en plein ciel comme contre un mur.

Coordonnées et conventions habituelles : repère local du jeu (x vers l'est, y vers le nord, z altitude), en mètres.

## 0. Ce qu'il faut retenir

1. **Cause du bug** : les collisions sont en 2D (`src/core/collision.ts`). Chaque bâtiment est le contour de son emprise (`addRing`,
   `src/core/world.ts`), **sans hauteur** : pour le moteur, c'est un mur infini (« Absente : infranchissable (bâtiment) »). La forme vue du
   dessus est juste, puisque le rendu et la collision utilisent le même contour. Seule la hauteur manque. Reproduit dans un test jetable :
   tremplin à 30 % pris à 90 km/h, voiture à 5,5 m du sol, maison de 10 × 8 m derrière. La voiture repart en arrière à −18 km/h avec un
   choc de 25 m/s.
2. **Pourquoi on ne peut pas juste donner une hauteur aux murs** : il n'y a pas de toit. Une voiture qui franchirait le mur retomberait
   **dans** la maison, prisonnière de ses murs. Il faut donc des **surfaces de toit**, comme les tabliers de pont (D93).
3. **Périmètre validé par l'utilisateur** :
   - Toits praticables pour **tous les bâtiments, sauf les monuments** à modèle dédié (cathédrale, mairie, églises, portes romaines, théâtre,
     Hexagone…) : leur toit dessiné ne suit pas les données, ils restent des murs infinis.
   - **Voiture** : elle survole, se pose sur un toit, y roule et en tombe.
   - **À pied**, trois façons de monter : **sortir de la voiture** posée sur un toit, **escalader un bâtiment bas** (2,5 m ou moins,
     l'escalade existante) et passer **d'un toit à l'autre** (en marchant, en escaladant un toit voisin plus haut d'au plus 2,5 m, ou en
     sautant).
   - **Saut long en pleine course**, partout en ville : il porte plus loin, pas plus haut.
   - **Pentes** : on tient jusqu'à environ 30° ; au-delà, voiture et piéton glissent vers le bord.
   - **Chutes** : les dégâts actuels s'appliquent tels quels (la hauteur de chute est déjà mesurée, `PlayerState.landed`).
   - **Cheminées et édicules** (données `chim` et `rooftop`) bloquent. Les autres petits détails dessinés restent traversables.
   - **Vue et tirs en 3D** : la caméra ne bute plus sur le bâtiment sous les pieds ; on tire du toit vers la rue, et réciproquement si l'on
     se voit.
   - **Police** : elle ne monte pas. Les gendarmes à pied **attendent au pied du bâtiment** et tirent quand ils voient le joueur. Les passants
     ne montent jamais.
4. **Hors périmètre** : poursuite par la police sur les toits, échelles ou escaliers placés à la main, toits des monuments, passants sur les
   toits, intérieurs.
5. **Le budget du téléphone** (Honor Magic 8 Pro, 60 i/s) reste la règle : ce chantier ajoute du calcul, pas du rendu, et chaque lot se
   mesure au banc (`?bench=1`) comme d'habitude.

### Modèle conseillé par lot

Même convention que dans les autres plans :
- **(Opus)** : le lot touche le socle (collisions, altitude) ou un fichier long et très partagé (`player.ts`, `vehicle.ts`, la police). Une
  mauvaise approche y coûte cher en reprises.
- **(Sonnet)** : partie bien délimitée, ou modèle déjà posé par un lot précédent.

Si un lot fait en Sonnet déçoit, on le reprend en Opus.

## 1. Le principe technique (pour tous les lots)

### Deux mondes d'altitude

- Le **relief** (`TiledTerrain.heightAt`) ne change pas : circulation, passants, gendarmes, pigeons et rendu du sol continuent de l'utiliser.
- Une **surface avec les toits** (`withRoofs(terrain, roofs)`, nouveau) est un `HeightField` qui renvoie le relief, ou un toit au-dessus
  quand il y en a. Comme pour les ponts, `zHint` (l'altitude de celui qui demande) choisit entre les deux : on est sur le toit ou dans la rue
  au pied du mur. Seuls **le joueur à pied et son véhicule** utilisent cette surface.

### Les toits

- Nouveau module `src/core/roofs.ts` : index des pans de toit par tuile, avec une grille spatiale et un chargement et déchargement par
  étiquette (comme `Colliders`).
- Les pans sont déjà dans les données : `Building.faces`, un plan `z = a·x + b·y + c` et son contour par pan, trous compris. Il faut
  **impérativement** passer par `reshapeBuilding` (`src/core/landmarks.ts`), comme le rendu : les grandes surfaces y deviennent des toits
  plats avec acrotère, les hangars des toits à faible pente, et les toits mesurés au LiDAR y sont appliqués (D143). Sans cela, le toit
  praticable ne serait pas celui qu'on voit.
- `roofAt(x, y, zHint)` renvoie l'altitude et la pente du pan sous le point. Les **cours intérieures** (trous des emprises) n'ont pas de
  toit : on y tombe.
- **Exclusions** : bâtiments ouverts ou cachés (`isOpen`), et bâtiments dont le toit générique n'est pas dessiné (modèles dédiés).
  Règle à poser une fois et à tester : pas de toit dessiné par le rendu générique, alors pas de toit praticable, et le mur reste infini.

### Les murs avec une hauteur

- Les segments des bâtiments reçoivent une **altitude absolue de haut de mur** (`zTop`, tirée de `Building.top`, interpolée le long du
  segment ; pour un pignon, le haut suit le rampant).
- `resolve` reçoit l'**altitude des pieds** (ou du bas de caisse). Un mur de bâtiment bloque si les pieds sont plus bas que son haut, moins
  une petite marche (environ 0,3 m). Avantage : passer d'un toit à un toit voisin de même hauteur se fait naturellement, puisque le mur
  mitoyen ne dépasse pas.
- Les obstacles existants (murets, clôtures, parapets) gardent leur hauteur **relative** au sol. On ne change que les bâtiments, pour ne
  rien casser.
- Cheminées et édicules deviennent de petits contours fermés avec leur `zTop`.

## 2. Lot 1 : le socle (Opus)

**But** : les toits existent comme surfaces, et les murs des bâtiments ont une hauteur. Rien ne change encore pour le joueur.

- `src/core/roofs.ts` : index, `roofAt`, `withRoofs`, exclusions (§1).
- `collision.ts` : `zTop` sur les segments des bâtiments, altitude des pieds dans `resolve` / `resolveInto`, sans changer le comportement
  quand elle n'est pas donnée (circulation, passants : murs infinis comme aujourd'hui).
- `world.ts` : murs de bâtiments avec `zTop`, cheminées et édicules ; chargement et déchargement des toits avec la tuile.
- **Tests** :
  - pans d'un toit à deux pentes, d'un toit plat avec acrotère, d'une cour intérieure ;
  - sur de vraies tuiles : part des bâtiments sans pans exploitables (`q.fallback`), écart entre le toit praticable et le toit dessiné ;
  - **maisons d'après photo (D140)** : leur contour de collision (`houseRing`) est décalé par rapport au contour BD TOPO des pans. Il faut
    vérifier que le toit couvre bien le contour mesuré, et sinon le recaler.
- **Mesure** : coût d'un `roofAt`, appelé plusieurs fois par sous-pas du véhicule.

## 3. Lot 2 : la voiture sur les toits (Opus)

**But** : le bug constaté est corrigé.

- Le véhicule du joueur (`fly = true`) utilise `withRoofs` et passe l'altitude de son bas de caisse aux collisions.
- Il survole un bâtiment s'il vole assez haut, sinon il le percute comme aujourd'hui. Il **se pose sur un toit** (choc de réception
  existant), y roule, et **tombe du bord** (la chute existante, celle du « mur de soutènement de 5 m »). L'acrotère d'un toit plat l'arrête
  comme un muret.
- **Pente de plus de 30°** : la gravité le fait glisser vers le bas du pan. Aujourd'hui, `vehicle.ts` ne tient compte que de la pente dans
  l'axe ; il faut ajouter la pente en travers.
- **Sortie du véhicule sur un toit** : le joueur est posé à l'altitude du toit (sinon, il apparaîtrait au sol, dans la maison).
- **Sauvegarde** : une partie sauvée sur un toit se recharge sur le toit.
- La circulation et les gendarmes ne changent pas.
- **Tests** : le test jetable de l'analyse devient un vrai test (la voiture passe la maison, ou se pose dessus) ; toit à deux pans raide ;
  descente par le bord ; un mur plus haut que la voiture la bloque toujours.

## 4. Lot 3 : le piéton sur les toits (Opus)

**But** : marcher, escalader, sauter de toit en toit.

- `player.ts` utilise `withRoofs` et l'altitude des pieds pour les collisions (aujourd'hui, `clear` se calcule par rapport au sol sous le
  point, ce qui serait faux au pied d'un mur avec les toits).
- **Marche** sur les pans, **glissade** au-delà de 30°, **chute** au bord et dans les cours, avec les dégâts actuels.
- **Escalade d'un bâtiment bas** : le mur d'un bâtiment de 2,5 m ou moins au-dessus du sol devient escaladable (`climb`) ; `climbStep`
  vise le haut du mur en altitude absolue. Même règle d'un toit à l'autre : un toit voisin plus haut d'au plus 2,5 m s'escalade.
- **Saut long en pleine course** :
  - Aujourd'hui, le saut monte de 1,1 m et dure environ 0,63 s ; à la course (5 m/s), il porte déjà à environ 3,2 m d'un sol plat au même
    niveau.
  - Proposition : un appui sur Sauter **en pleine course** donne un élan horizontal en plus, pour une portée d'environ 4,5 à 5 m, à la même
    hauteur (on ne franchit donc pas de clôture plus haute qu'avant).
  - **Le chiffre exact est à valider avec l'utilisateur en jouant** : il change aussi les fuites à pied en ville.
- **Tests** : toit à toit mitoyen, escalade d'un garage puis de la maison voisine, saut au-dessus d'une ruelle de 4 m, glissade sur ardoise,
  chute dans une cour, dégâts d'une chute de 15 m.

## 5. Lot 4 : vue et tirs en 3D (Opus)

**But** : depuis un toit, la caméra et les tirs se comportent bien.

- `Colliders.raycast` reçoit l'altitude aux deux bouts du rayon. Un mur de bâtiment ne coupe le rayon que si le point de passage est plus
  bas que son haut.
- Appelants à revoir :
  - caméra (`src/core/camera-rig.ts`, et `src/game/game.ts` vers la ligne 1325) ;
  - tirs du joueur (`game.ts` vers la ligne 1019) ;
  - vue et tirs de la police (`src/game/police.ts`, `src/core/officers.ts`, `src/core/chase.ts`, `src/core/police.ts`).
  - Les autres appels (apparition de la circulation, pigeons, bancs des passants) restent en 2D.
- La **caméra** monte au-dessus des toits quand le joueur y est, sans traverser un mur plus haut que lui.
- **Tests** : la caméra ne bute pas sur le toit sous les pieds ; le joueur au bord d'un toit voit et touche la rue ; un gendarme au pied du mur,
  collé à la façade, ne voit pas le joueur au milieu d'un toit plat.

## 6. Lot 5 : la police attend en bas, et finitions (Sonnet)

**But** : un toit protège un peu, sans rendre invincible.

- Quand le joueur est sur un toit, les gendarmes à pied ne le poursuivent plus en ligne droite contre le mur. Ils vont au point de la rue le
  plus proche, autour du bâtiment, et **attendent en le cherchant du regard**. Ils tirent s'ils le voient (lot 4).
- Les règles de recherche (`wanted.ts`) ne changent pas : hors de vue, la recherche retombe comme ailleurs.
- **Finitions** : passage sur les fichiers de test longs (`*-soak.test.ts`), mesure au banc sur téléphone, entrées dans `DECISIONS.md`,
  `PROGRESS.md` et la feuille de route.

## 7. Risques et points à vérifier

- **Données des toits** : certains bâtiments ont des pans de secours (`q.fallback`) ou mal triangulés. Il faut mesurer leur part au lot 1
  avant de compter dessus ; pour ceux-là, on prend un toit plat à l'égout.
- **Maisons mitoyennes** : avec des données imprécises, deux toits voisins peuvent laisser une fente de quelques centimètres où l'on
  tomberait. Il faut prévoir une petite tolérance (chercher le toit voisin dans un rayon de 20 à 30 cm).
- **Un vieux bug d'altitude peut ressortir** : sans `zHint`, `heightAt` renvoie la surface la plus haute. Tout appelant du joueur qui
  oublie l'altitude le mettrait sur le toit. Cela concerne les téléportations, la descente de véhicule et le chargement de partie, à passer
  en revue au lot 2.
- **Performance** : `heightAt` est appelé souvent (sous-pas du véhicule, pas du piéton). La recherche dans la grille doit rester très bon
  marché, à mesurer au lot 1.
- **Équilibre** : le saut long et la cachette des toits changent la façon de fuir la police. Il faudra jouer après les lots 3 et 5.
