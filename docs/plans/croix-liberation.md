# La Croix de la Libération : plan (avant enquête)

Plan du 7 novembre 2026, sur `main` (après D264). Rien n'est modifié dans le jeu : ce fichier est le seul ajout. Les photos de l'utilisateur
ne sont pas encore arrivées : tout ce qui touche à la forme de la croix est à lire sur elles (lot 0). Repère local du jeu (x vers l'est, y vers le nord),
mètres ; altitudes au-dessus de `ORIGIN_Z` (330 m) sauf mention « NGF ». Les prochains numéros de décision seront D265 et suivants.

**Attention aux noms** : la route départementale s'appelle ici **RD 256** (ou « route de Montjeu »), jamais « D256 », qui est déjà le numéro d'une décision
(la tour des Ursulines éclairée la nuit).

**Décisions de l'utilisateur (7 novembre)** :
- **faire la croix**, pour elle et surtout pour **la vue sur la ville** depuis la hauteur ;
- **mode belvédère** validé : en hauteur, le jeu voit plus loin ;
- **agrandir la carte** pour l'accès réel : **la RD 256** depuis la ville, puis **la petite route** qui monte de la RD 256 jusqu'à la croix ;
- **de l'espace derrière la croix** : la falaise ne doit pas lui être collée.

## 0. Ce qu'il faut retenir

1. **La croix est déjà dans la zone jouable, au ras de la côte.** Point OpenStreetMap `node/936333171` (`historic=wayside_cross`, `tourism=viewpoint`)
   en **(−840,4 ; −1 808,7)**, tuile `22_28`, à 3 m du bord sud de la ville. Le relief du jeu y vaut ≈ 587 m NGF. Le trait de côte (D105) passe
   **142 m au sud** ; le sol tombe de 585 à 285 m NGF entre 20 et 110 m au sud de la croix (falaise de `coast_lib.shore_cap`).
2. **La croix n'est pas dessinée**, mais ses abords sont déjà dans la tuile `22_28` : le banc OSM (`14105148302`), un petit morceau d'enrobé, des pelouses.
   La carte la connaît (lieu « Croix de la Libération », type point de vue).
3. **Ce qui est sous la mer aujourd'hui** (OpenStreetMap, extrait du 7 novembre) :
   - **la RD 256**, « Route de la Chicolle et Montjeu » (`way/149380971`, 2 475 m, et `way/149380970`, 66 m) : elle quitte la ville au sud-est, vers (284 ; −1 363),
     monte en lacets vers le sud-ouest et atteint un carrefour vers **(−544 ; −2 469)**, 660 m au sud du bord actuel ;
   - **la petite route d'accès** : `way/1053943801` (184 m) puis `way/80229499` (638 m), classées `unclassified` (voie revêtue, voitures admises :
     à confirmer sur photo), qui remontent plein nord du carrefour jusqu'à la croix ;
   - **un parking** (`way/80229518`, ≈ 1 200 m², centre (−857 ; −1 834)), **juste au sud de la croix** : c'est « l'espace derrière la croix ».
4. **Devant la croix, côté ville** : l'**aire de décollage de parapente et de deltaplane** de la FFVL (`way/1232988033`, ≈ 1 800 m², 588 m NGF,
   orientée nord et nord-est, « Creusot vol libre ») : la pente dégagée qui ouvre la vue. Autour : une table de pique-nique, deux poubelles, une caméra,
   un second point de vue à 17 m, un **mât d'antenne de 12 m** à 51 m (`node/8604152250`) ; un autre mât de 44 m à 400 m.
5. **La vue est aujourd'hui impossible** : le brouillard de jour ferme à 800 m (`src/render/style.ts`), les silhouettes s'arrêtent à 1 300 m
   (`VIEW_RANGE`, `src/render/terrain.ts`) ; la cathédrale est à ≈ 1,5 km de la croix, le centre et le nord de la ville bien plus loin.
6. **La chaîne de données ne doit pas être relancée en entier.** Depuis D153, les régénérations complètes sont évitées : un extrait OpenStreetMap plus récent
   change le graphe routier et les files des passants partout, et des tests de la circulation et de la police ne passent plus (D153, `--only s6_8`).
   L'extension se fait **seulement sur les tuiles ajoutées et leurs voisines**, le reste de la ville doit rester identique à l'octet près.

## 1. L'extension de la carte

### 1.1 Les tuiles

| | Tuiles |
|---|---|
| **nouvelles tuiles jouables (9)** | `22_26`, `22_27`, `23_25`, `23_26`, `24_25`, `24_26`, `25_26`, `25_27`, `26_27` (dont `22_27`, `25_27`, `26_27` sont aujourd'hui en bordure) |
| **nouvelle bordure** | l'anneau d'une tuile autour, une quinzaine de tuiles (rangées 24 à 27), où passera la nouvelle côte |
| blocs de 2 km touchés | `(2, 3)` et `(3, 3)` (colonnes 16 à 31, rangées 24 à 31) |

La forme est une **langue de terre qui suit la route**, comme le couloir de la route de Saulieu vers les Télots (D105). Derrière la croix, la terre
s'étend sur au moins 250 m (tuile `22_27`) plus les 125 m de rivage de `coast_lib` : la falaise s'éloigne de 140 m à près de 400 m.
`zone` de `world.json` descend de y −2 062 à y −2 562 (et un peu plus avec la bordure) ; le relief grossier grandit d'autant.

**À vérifier au lot 0** : que le tracé de la côte (zone jouable élargie de 125 m, bruit de ± 45 m) laisse les lacets de la RD 256 entièrement à terre,
sinon ajouter une tuile ; que le carrefour (−544 ; −2 469) et le départ de la petite route sont bien dans `23_25`.

### 1.2 Le piège du relief creusé

`build_coast.py` a **creusé la falaise dans les tuiles existantes** (rangée 28 et bordure) : le relief publié n'est plus celui du LiDAR.
D105 le dit : « si on relance `build_coast.py`, repartir du relief et des structures d'avant ». Le relief d'avant était dans `.cache`, **absent de ce conteneur**.
Il faut donc **refaire le relief à 1 m des tuiles touchées par l'ancienne falaise** (`21_28`, `22_28`, `23_28` et leurs voisines de bordure)
à partir des dalles LiDAR, sans réécrire leurs fichiers de tuile (bâtiments, arbres, sols, mobilier).

### 1.3 Fabrication locale (nouvelle façon de faire)

- `build_all.py` fabrique un bloc entier (toutes ses tuiles sauf `keep`) : ici, ce serait réécrire une soixantaine de tuiles de la ville pour en ajouter neuf.
  **Ajout** : une liste de tuiles à fabriquer (variable d'environnement ou option, par exemple `AUTUN_TILES`), qui réduit l'emprise du bloc
  (et donc les dalles LiDAR à télécharger) et n'écrit que ces tuiles. Les tuiles voisines existantes servent de contexte, comme `keep` (D105).
- Les étapes globales (`build_structures`, `build_kinds`, `build_public_space`, `build_coast`, `build_water`, `build_nav`, `build_map`…) recalculent
  toute la ville. **Ajout** à chacune utile ici : une restriction aux tuiles listées, ou une étape dédiée qui ne fait que ces tuiles
  (comme `build_monuments_nav.py` le fait pour des super-tuiles).
- **Navigation** : on **greffe** les nouvelles voies (RD 256, route d'accès, chemins, parking) sur le graphe existant à leur point de raccord,
  sans refaire les super-tuiles de la ville (règle « graphe routier gardé », D153). Les super-tuiles de 1 km neuves (sud de `s5_7`, `s6_7` et en dessous)
  sont fabriquées entières ; celles qui touchent la ville reçoivent seulement les arêtes ajoutées.
- **Vérification de non-régression** : empreinte (somme de contrôle) de chaque fichier de `public/data` avant et après ; seuls changent les fichiers des tuiles
  ajoutées et de la bordure, `world.json`, le relief grossier, la carte de la zone et les super-tuiles où l'on greffe. Tous les tests passent sans recalibrer.

### 1.4 Ce que l'extension apporte d'elle-même

Relief LiDAR, arbres (forêt de Montjeu), sols (cadastre et orthophoto), la RD 256 et la route d'accès avec leurs bas-côtés, le parking, la circulation
et les passants sur les nouvelles voies, la carte et la minimap. Pas de bâtiment attendu dans ces tuiles (à vérifier : fermes ou maisons le long de la RD 256).

## 2. La croix et ses abords (d'après les photos)

À lire sur les photos au lot 0, puis à mesurer au LiDAR (nuage de points, comme la pyramide de Couhard) :
- **la croix** : forme (croix latine, de Lorraine ?), matériau, hauteur (le nuage de points la mesurera si elle dépasse 3 à 4 m), section des bras ;
- **le socle** : marches, emmarchement, dimensions, inscriptions et plaques (texte à relever) ;
- **le sol** : gravier, terre battue ou dalles autour du pied (la vue Street View montre un sol clair de terre et de gravier), bordures ;
- **les abords** : banc, table, poubelles, mât d'antenne, éventuel garde-corps ou panneau d'orientation (table d'orientation ?), panneaux de l'aire de vol ;
- **le parking** : revêtement, limites (rondins, blocs, talus) ;
- **la clairière** : arbres à retirer devant la croix pour ouvrir la vue, d'après le LiDAR (modèle de hauteur) et les photos de la vue.

Dessin dans le style des autres monuments (`src/render/`, champ propre dans `kinds`, une silhouette lointaine visible de la ville :
la croix se voit d'en bas en vrai, à vérifier sur les photos). Navigation : point « monument » devant la croix (comme D227).

## 3. Le mode belvédère

**But** : depuis la croix, voir la ville entière (cathédrale à 1,5 km, gare et Saint-Pantaléon à 3 à 4 km).

**Idée** : la portée de vue dépend de la hauteur du regard au-dessus du relief environnant. Au sol en ville, rien ne change. Quand la caméra domine
(par exemple plus de 120 m au-dessus de la médiane du relief grossier dans un rayon de 1 km), on pousse progressivement, sur quelques secondes :
- le brouillard (`fog.near`, `fog.far`) jusqu'à 3 à 4 km ;
- la portée des silhouettes (`VIEW_RANGE` et sa marge) d'autant ;
- le plan lointain de la caméra.

Le détail (tuiles complètes) reste à 300 m : au-delà, ce sont les silhouettes, simples par construction. Le relief grossier couvre déjà toute l'emprise.
Les autres hauteurs du sud (Couhard, Montjeu) en profitent sans rien faire de plus.

**À mesurer** (`?bench=1` ou une vue `?view=croix-vue&debug`) : triangles, appels de dessin, images par seconde, mémoire, sur le téléphone de test.
C'est le seul vrai risque du projet. Repli si c'est trop lourd : silhouettes allégées au-delà de 1,5 km (sans toits détaillés), ou portée limitée à la
moitié nord du champ de vision.

**Questions ouvertes** : brume et pluie gardent-elles le droit de fermer la vue (oui, sans doute : c'est réaliste) ? La nuit, lumières de la ville au loin ?

## 4. Découpage

| Lot | Contenu | Données régénérées |
|---|---|---|
| **0. Enquête** | lecture des photos ; script `tools/data/survey_croix.py` : profils LiDAR de la RD 256 et de la route d'accès, contour du parking, nuage de points de la croix, arbres de la clairière ; tracé de la côte prévu ; captures « avant » | aucune |
| **1. Fabrication locale** | outils : fabrication d'une liste de tuiles, étapes globales restreintes, greffe de navigation, contrôle des empreintes ; essai à blanc sur une tuile de bordure sans rien publier | aucune (outils seulement) |
| **2. Extension** | `region.json`, 9 tuiles et la nouvelle bordure, relief refait sous l'ancienne falaise, côte, eau, sols, navigation greffée, carte | oui, locale |
| **3. La croix** | modèle, socle, sol, abords, parking, clairière, silhouette lointaine, point « monument » | `kinds` de la tuile |
| **4. Belvédère** | portée de vue selon la hauteur, mesures sur téléphone | aucune |
| **5. Finitions** | vues `?view=croix`, `croix-vue`, `croix-route`, `croix-haut` ; éclairage de nuit éventuel ; cache d'arme ou détail de jeu au sommet si l'utilisateur le souhaite | selon besoin |

Les lots 3 et 4 ne dépendent pas l'un de l'autre et peuvent passer avant le lot 2 (la croix existe déjà dans la tuile `22_28`) : si l'extension
prend du retard, on voit déjà la croix et la vue en arrivant par les chemins de Couhard.

## 5. Temps de calcul attendus

Mesures connues (D105, toute la ville, cache rempli) : ≈ 2 h 30 pour les 12 blocs, 1 h 10 pour `build_public_space.py`.

- **Le plus long : le lot 2, fabrication des nouvelles tuiles**, à cause du **LiDAR** : les dalles de 1 km (nuages de points classés, quelques centaines de Mo chacune)
  ne sont plus en cache dans ce conteneur et doivent être téléchargées puis traitées (relief, bâtiments, arbres). Avec une emprise réduite aux tuiles ajoutées
  (lot 1), compter **6 à 10 dalles**, soit de l'ordre de **1 à 2 heures** (surtout du téléchargement). Avec les blocs entiers : 16 à 20 dalles et le double.
- Étapes globales restreintes à ces tuiles : quelques minutes chacune (sols du cadastre et orthophoto sur 2 à 3 km² au lieu de 19).
- Une régénération complète de la ville (non retenue) : plus de 4 heures et la recalibration des tests de circulation et de police.

## 6. Photos demandées

1. la croix de face et de profil, avec une personne pour l'échelle ;
2. le socle, les inscriptions, les plaques (de près, lisibles) ;
3. le sol au pied de la croix et les abords (banc, table, poubelles, antenne, panneaux) ;
4. **la vue vers la ville** depuis la croix (portée et cadrage du belvédère) ;
5. la petite route d'accès (revêtement, largeur, bas-côtés) et le parking ;
6. si possible, le carrefour avec la RD 256 et un lacet de la RD 256 ;
7. la croix vue d'en bas, de la ville (pour la silhouette lointaine).
