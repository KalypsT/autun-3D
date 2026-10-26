# Avancement

## Phase : maquette réaliste — quartier du Champ de Mars

| Étape | État |
|---|---|
| 1. Accès et couverture des sources, `docs/SOURCES.md` | ✅ validée |
| 2. Chaîne de données : relief, volumes et toits LiDAR, rues, arbres | ✅ fusionnée (PR #1) |
| 3. Fiches façade (estimées) + générateur + matières | ✅ faite, en attente de ton avis |
| **Étape 1 bis : toute la zone Autun centre, 2,25 km², par tuiles** | ✅ faite, à tester sur téléphone |
| 4.1 Se balader à pied : commandes tactiles, caméra, collisions | ✅ faite, à tester sur téléphone |
| 4.2 Vélo, puis voiture (conduite réaliste) | à faire |
| 4.3 Circulation, passants, pigeons | à faire |
| 4.4 Jour/nuit, plaque de rue, vue du ciel, KTX2, optimisation | à faire |

### Étape 3 (26 octobre 2026)

Fait :
- **Fiches façade** : 353 fiches JSON validées par `docs/facade-fiche.schema.json` (`tools/data/build_facades.py`). Époque et matériaux viennent de la BDNB et de BD TOPO, les niveaux de la hauteur LiDAR, 93 commerces nommés d'OpenStreetMap sont placés sur leur mur de rue. Chaque mur est qualifié (rue, cour, mitoyen). Toutes « estimées » (confiance 0,3 à 0,75) : aucune photo libre sur la zone.
- **Générateur** (`src/render/facades.ts`) : travées, fenêtres, volets, portes, vitrines et enseignes, balcons en fer forgé, corniches, bandeaux, soubassements. 5 300 fenêtres, 197 portes, 85 vitrines, 157 balcons, en sprites à relief (atlas de 2 pages).
- **Matières** : enduit et pierre de taille, tuile plate, tuile mécanique, ardoise, zinc, toit-terrasse ; sols en textures CC0 (asphalte, pavés, gravier, herbe, trottoir, dallage) avec assombrissement près des murs ; ciel en dégradé, brume, jupe sous le relief.
- **Toits** : 27 bâtiments passent en toit maillé sur le LiDAR quand les plans échouent (D11).
- Tests : 15 (relief, soleil, triangulation des toits, fiches, planificateur de façades).

Défauts connus :
- Hôtel de ville et théâtre : toits irréguliers (à modéliser à la main d'après photos, étape suivante).
- Le kiosque à musique forme une bosse sur le terrain (classé « sol » par le LiDAR).
- Arbres : couronnes en blobs plats, sans essence.
- Très près d'un mur, les sprites (≈ 55 px/m) sont un peu flous ; pas de LOD.
- Ombres : une seule carte, bords en escalier ; pas d'occlusion ambiante autre que sur le sol.
- Textures non compressées (KTX2 à faire) ; chargement ≈ 1,1 s de génération sur PC + décodage des PNG/JPEG.
- Les fenêtres ne s'allument pas encore la nuit.
- Largeurs de rues et trottoirs estimés (voir étape 2).

### Étape 4.1 (26 octobre 2026) : se balader à pied

Fait :
- `src/core/` (logique pure, sans rendu) : collisions (`collision.ts`), piéton (`player.ts`), caméra à la troisième personne (`camera-rig.ts`), obstacles du monde (`world.ts`) ; 27 tests dont un test d'intégration sur les vraies données.
- `src/input/controls.ts` : joystick flottant, regard au doigt, clavier, souris ; `src/game/game.ts` : boucle à pas fixe 60 Hz, soleil et ombres qui suivent le joueur, personnage articulé provisoire.
- Le viewer à caméra libre reste disponible avec `?view=` ou `?cam=` (captures, diagnostic) ; sans paramètre, c'est le jeu.
- Test tactile automatisé (`tools/play.sh`) : marche à mi-poussée 0,9 m/s, course à fond 5 m/s, regard au doigt.

Pas encore fait / limites :
- Pas de saut, pas d'escaliers ni de portes : on marche à plat sur le relief. Les passages couverts (Balthus, de la Terrasse) sont bloqués.
- Pas de recentrage automatique de la caméra derrière le personnage.
- Performances sur téléphone non mesurées : en navigateur logiciel le jeu tourne à 13-80 images/s selon l'instant, ce qui ne dit rien du téléphone.
- Personnage en blocs, sans visage ni vêtements d'Autun.

### Agrandissement : 2,25 km² par tuiles (26 octobre 2026)

Fait :
- **Zone** : 6 × 6 tuiles de 250 m alignées sur le Lambert-93, de la cathédrale Saint-Lazare au nord-ouest à la rue du Théâtre romain au sud (1,5 × 1,5 km, quatre dalles LiDAR HD). 3 486 bâtiments, 5 519 arbres, 522 voies, 351 murs et grilles, 464 éléments de mobilier.
- **Données par tuile** (`tools/data/build_tiles.py`) : `public/data/tiles/<col>_<ligne>.json` (bâtiments, fiches, arbres, murs, mobilier, 3 Ko à 1,2 Mo), `lod.json` (silhouettes simplifiées, 0,5 Mo), `world.json` (grille). Relief (4,7 Mo) et cartes de sol (1,4 Mo, 1 m par pixel) restent globaux.
- **Client** : `TileManager` charge en détail les tuiles à moins de 210 m (déchargées au-delà de 300 m), les autres sont des silhouettes à toit plat (un maillage par tuile). Relief par morceaux de 250 m à trois niveaux de pas (2, 5, 12 m) avec jupes. Atlas de façades rempli à la demande (3 pages de 2048, la plus ancienne est recyclée quand tout est plein ; les tuiles concernées se reconstruisent). Collisions étiquetées par tuile, retirées au déchargement.
- **Corrigé** : murs, murets, grilles (barreaux à transparence, piliers) et mobilier urbain (bancs, poubelles, bornes, boîtes aux lettres, toilettes, fontaines, feux) sont maintenant dessinés ; ils étaient seulement des obstacles invisibles.
- **Corrigé** : champs classés « gravier » par erreur (loin des routes et des bâtiments : herbe), parkings en asphalte par défaut.
- Téléchargements : l'API OpenStreetMap par blocs de 500 m remplace Overpass quand celui-ci coupe les connexions ; BDNB complète de la commune (5 823 groupes).
- Tests : 42 (données réelles sur les 36 tuiles).

Mesures (navigateur logiciel, PC) :
- Autour de la place : 6 à 8 tuiles détaillées, ≈ 170 000 à 320 000 triangles, 80 à 150 appels de dessin.
- Toute la zone en détail (test extrême) : 710 000 triangles, 490 appels, construction 14 s.
- **Rien n'est mesuré sur téléphone.** Les budgets (appels de dessin, triangles, mémoire des atlas ≈ 130 Mo) sont des estimations à vérifier.

Limites / à faire :
- Pas de LOD des arbres (absents des tuiles lointaines) ; silhouettes sans pente de toit.
- Une tuile se construit d'un bloc (≈ 100-300 ms sur PC) : à lisser si ça saccade sur téléphone.
- Les façades restent estimées ; monuments à modéliser (hôtel de ville, théâtre, cathédrale, monuments romains).
- Ajouter de la vie : passants, circulation, pigeons (étape 4.3).
- Fidélité des sols (parking du centre-ville, cours de lycée) : à revoir sur photos / orthophoto.

### Direction artistique : essai « conte peint » (26 octobre 2026)

Après test sur téléphone (carte correcte, mais lenteurs, scintillement des fenêtres, esthétique faible), on change de parti pris : garder la cartographie réelle, mais des façades imaginées, en aplats et volumes simples, sans textures.
- `?style=conte` : murs en aplats avec ombre au pied, fenêtres/volets/portes/vitrines/enseignes en volumes (`src/render/stylized.ts`), toits à pans nets avec trame douce, sols en palette, arbres à deux boules, lumière dorée (`src/render/style.ts`). Les silhouettes lointaines utilisent la même palette (`lod.json` porte l'époque et la clé de hachage).
- Sans paramètre, le rendu texturé reste inchangé pour comparer. Pas encore mesuré sur téléphone.
- À faire si le style plaît : monuments modélisés à la main, enseignes, détails (cheminées fumantes, lanternes), ciel et nuages, suppression de l'ancien rendu.

### Repartir de zéro : bâtiments propres + trois ambiances (26 octobre 2026)

- **Bâtiments** (`tools/data/build_roofs.py`) : seules l'emprise et la hauteur BD TOPO servent. Les toits sont générés (quatre pans ou deux pans avec pignons, plateau au-delà de 4,6 m de montée), sans relevé LiDAR : plus de trous ni d'éclats. 727 toits plats, 1 844 à quatre pans, 915 à deux pans.
- **Ambiances** (`?style=affiche|jouets|nuit`, `src/render/style.ts`) : même géométrie, palettes, lumière, ciel et surimpression différents. Les fenêtres s'allument la nuit.
- À choisir ensuite : une direction, puis finitions (sol, ciel, monuments, détails), puis suppression de l'ancien rendu texturé.

### Affiche par défaut, nettoyage (26 octobre 2026)

- Le style « affiche » est le rendu par défaut ; `?style=nuit` donne la nuit. Le rendu texturé réaliste et ses ressources sont supprimés (D17).
- Prochaines étapes : rues, trottoirs, bordures et places dessinés en géométrie (aujourd'hui seulement une carte de couleurs de sol), puis ciel, lampadaires, enseignes, arbres, cycle jour/nuit.
