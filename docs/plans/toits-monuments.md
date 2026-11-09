# Bâtiments spéciaux : plus de mur invisible au-dessus (plan)

**Avancement** : **niveau 1 fait** (D302), lots 1 à 4 en une fois. Plan rédigé le 9 novembre 2026 après D300, à la demande de l'utilisateur.
Validé : **niveau 1 sur tous les bâtiments concernés** ; le niveau 2 (toits fidèles au modèle) seulement au cas par cas, si le jeu le demande.

> **Changement d'approche à la réalisation (D302)** : la mesure a montré que le dessin dépasse souvent de loin le faîtage BD TOPO et varie
> beaucoup sur l'emprise (cathédrale : 122,5 m de flèche pour 52,8 m de faîtage). Au lieu d'un haut par bâtiment et d'une table
> `MODEL_CEILING` (§1 ci-dessous), on **relève la hauteur dessinée case par case** (`src/render/hull-build.ts`, `public/data/hulls/`) : le
> haut des murs et le toit en sont tirés, pour tous les bâtiments spéciaux et les sites. Nouveau bâtiment ou modèle modifié : `npm run hulls`
> (le test `src/render/hulls.test.ts` le réclame, et sa garde échoue pour un bâtiment sans relevé). Le reste du plan ci-dessous est l'idée
> d'origine, gardée pour mémoire.

Coordonnées et conventions habituelles : repère local du jeu (x vers l'est, y vers le nord, z altitude), en mètres.

## 0. Ce qu'il faut retenir

1. **Le bug** : les toits praticables (D214 à D218) ont laissé de côté les bâtiments à modèle dédié. Leur contour est posé par
   `c.addRing(ring)` **sans hauteur** (`src/core/world.ts`, `addTileColliders`) ; dans `Colliders.resolveInto` (`src/core/collision.ts`),
   un segment sans `topA` donne `above = Infinity` : il arrête la voiture quelle que soit son altitude. Survoler la cathédrale à 50 m, c'est
   toujours percuter son emprise au sol.
2. **Bâtiments concernés** (tous, validé par l'utilisateur) :
   - **branches dédiées** de `addTileColliders` : cathédrale (porche, D132), lycée militaire (passage, D263), l'Eduen (D231), gendarmerie
     (D238), base nautique (D245), McDonald's et bowling (D234), maison d'après photo (D140), théâtre municipal (D223), gare (D228), hôtel de
     ville (D293, D294) ;
   - **`walkableRoof` faux** (`src/core/landmarks.ts`) : églises, chapelles, auvents (`canopy`), monuments (`mon`), tours (`tower`),
     collèges et lycées, Notre-Dame (`nd`, `ndPart`), chapelle (`chap`), Hexagone (`hex`), Vallon, chariots (`cart`) ;
   - **`landmarkRings`** (sites, hors `tile.buildings`) : portes romaines (piles, tour de Saint-André), temple de Janus, pied de la pierre de
     Couhard, croix de la Libération, kiosque, monument aux morts, tente du golf.
3. **Niveau 1** (ce plan) : chaque contour reçoit un **haut fini** (le point le plus haut du modèle dessiné) et une **surface de toit** au-dessus
   de l'emprise, pour qu'une voiture qui descend dans l'emprise se pose au lieu de tomber dans le bâtiment. Le toit est **approché**, pas
   fidèle au dessin : plat pour les volumes à toit plat, pans BD TOPO (`Building.faces`) pour les toits en pente, qui sont raides et font
   glisser la voiture au-delà de 30° (D215), ce qui masque l'écart avec le modèle.
4. **Hors périmètre** : niveau 2 (toits fidèles au dessin, marche soignée sur la mairie, etc.), intérieurs, police sur les toits.

### Réponse à la question « un nouveau bâtiment spécial aura-t-il la limite tout seul ? »

**Oui, c'est le but du lot 1** : la règle devient **par défaut** au lieu d'être ajoutée bâtiment par bâtiment.

- **Bâtiments venus des données** (BD TOPO, nouvelle extension de carte) : ils ont déjà un toit praticable (D214) ; rien à faire.
- **Nouveau bâtiment à modèle dédié** (un nouveau drapeau dans `kinds`, qui le sort de `walkableRoof`) : il tombe sans rien faire dans la
  règle par défaut, avec haut = faîtage BD TOPO (`Building.ridge`, toujours présent) et toit = pans BD TOPO. Si son modèle dépasse le
  faîtage (flèche, clocher), on ajoute une ligne dans la table des hauts de modèle (§2), sinon la voiture bute au-dessus du faîtage et sous la
  flèche : c'est le seul réglage manuel.
- **Nouvelle branche dédiée** (murs mesurés, comme la gare) ou **nouveau site** (comme le kiosque) : elle doit poser ses murs par l'aide
  commune (§1). Un **test de garde** parcourt toutes les tuiles réelles et échoue s'il reste un segment de bâtiment ou de site sans hauteur :
  un oubli se voit donc tout de suite, au lieu d'être découvert en jouant.

### Modèle conseillé par lot

Même convention que les autres plans : **(Opus)** pour le socle des collisions, **(Sonnet)** pour l'application à un modèle déjà posé.

## 1. Le principe technique

- Nouvelle aide dans `src/core/world.ts` : `addSolidBuilding(c, rings, ceiling, roof, tag)`.
  - `rings` : les contours que pose aujourd'hui chaque branche (contour mesuré, contour BD TOPO, cours) ;
  - `ceiling` : altitude absolue du haut, par sommet ou unique ;
  - `roof` : pans à ajouter à `c.roofs` (`RoofPlane[]`) ; un toit plat se construit d'un seul pan `z = ceiling` sur le contour, cours en trous.
  - Les murs sont posés avec `addRing(ring, tops)` : le comportement des autres usagers ne change pas (sans altitude, passants, circulation et
    gendarmes trouvent toujours un mur infini).
- **Le toit doit couvrir le contour de collision**, pas l'emprise BD TOPO, quand ils diffèrent (gare, théâtre, Eduen, gendarmerie, base
  nautique, McDo, bowling, maison d'après photo) : pour ceux-là, toit plat sur le contour mesuré. Même difficulté que la maison d'après
  photo au lot 1 des toits.
- **Murs ouverts** (polylignes : porche de la cathédrale, passage du lycée militaire) : leurs segments reçoivent le même haut ; le toit
  couvre l'emprise BD TOPO. On garde le passage sous la voûte (le toit est au-dessus, `zHint` choisit le sol).
- **Hauts de modèle** : nouvelle table `MODEL_CEILING` (dans `landmarks.ts`), hauteur au-dessus du sol du point le plus haut de chaque
  modèle dédié (flèche de la cathédrale, clocher de Notre-Dame, tours, portes). Par défaut : `Building.ridge`. Les valeurs se lisent sur le
  modèle (boîte englobante du groupe Three.js au rendu) : un test les compare au rendu pour qu'elles ne dérivent pas.
- **Flèches et tours étroites** : le haut des murs suit la flèche, mais le toit praticable s'arrête à la base de la flèche (pans BD TOPO de
  la nef) ; la flèche reste un contour fermé à son haut, qu'on survole ou qu'on percute.
- **Sites** (`landmarkRings`) : chaque forme rend aussi son haut (`{ ring, top }`) ; petits monuments à toit plat de secours (kiosque,
  monument aux morts, tente, socle de la croix), pyramide de Couhard en pans raides (glissade), piles des portes romaines à leur haut.
- **Tirs et vue** (D216) : les murs à hauteur coupent les rayons comme ceux des maisons ; on tire par-dessus un kiosque depuis un toit.

## 2. Lots

### Lot 1 : socle et règle par défaut (Opus)

- `addSolidBuilding`, table `MODEL_CEILING`, règle par défaut (faîtage, pans BD TOPO) pour tout bâtiment hors `walkableRoof`.
- Branche `!walkableRoof` générique (églises, chapelles, monuments, tours, collèges, Hexagone…) passée sur la règle par défaut.
- **Test de garde** sur les tuiles réelles : aucun segment de bâtiment ou de site sans hauteur (hors exceptions listées et justifiées).
- **Tests** : la voiture du test jetable de D214, lancée au-dessus d'une église, passe au-dessus du faîtage ; plus basse, elle se pose sur la
  nef et glisse au bord ; elle bute toujours contre le clocher plus haut qu'elle ; un passant et une voiture de la circulation trouvent
  toujours un mur.
- **Mesure** : coût de `resolve` et de `roofAt` au banc (`?bench=1`), qui ne doit pas bouger de façon visible.

### Lot 2 : branches à murs mesurés (Sonnet)

- Cathédrale (porche), lycée militaire (passage), Eduen, gendarmerie, base nautique, McDo, bowling, maison d'après photo, théâtre, gare,
  hôtel de ville (murs d'échiffre et piédestaux du perron gardent leur hauteur propre).
- Toit plat sur le contour mesuré, ou pans BD TOPO quand le contour mesuré coïncide.
- **Tests** : se poser sur la gare, sur l'Eduen ; passer sous la voûte du lycée militaire en voiture et à pied comme avant ; entrer dans le
  porche de la cathédrale comme avant.

### Lot 3 : sites et petits monuments (Sonnet)

- `landmarkRings` avec hauteur : portes romaines, Janus, Couhard, croix, kiosque, monument aux morts, tente du golf.
- **Tests** : survol de la porte d'Arroux et de Couhard ; on n'escalade toujours pas le kiosque ni le monument aux morts à pied (le haut reste
  au-dessus de l'escalade de 2,5 m, ou le mur reste marqué non escaladable).

### Lot 4 : finitions

- Passage sur les tests longs (`*-soak.test.ts`), mesure au banc sur téléphone, entrées dans `DECISIONS.md`, `PROGRESS.md` et la feuille de
  route. Liste des bâtiments où l'écart toit approché / toit dessiné se voit en jouant : candidats au niveau 2, à décider avec l'utilisateur.

## 3. Risques et points à vérifier

- **Piéton qui monte** : un toit de secours plat trop bas pourrait devenir accessible par l'escalade (2,5 m) ou de toit à toit, sur un
  monument où l'on ne veut pas marcher. La règle d'escalade doit lire le haut du mur : un kiosque ou un monument aux morts reste non
  escaladable.
- **Police** : elle ne monte pas (D217) ; un joueur posé sur la cathédrale ou la gare est sur un toit comme un autre, les gendarmes attendent
  en bas. À jouer après le lot 2.
- **Écart de forme** : sur un toit approché, la voiture peut flotter de quelques décimètres au-dessus du dessin, ou s'y enfoncer. Acceptable au
  niveau 1 ; c'est ce qui décidera des bâtiments à passer au niveau 2.
- **Sauvegarde** : une partie sauvée sur un de ces toits doit se recharger sur le toit (même chemin que D215).
