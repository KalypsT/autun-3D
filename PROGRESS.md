# Avancement

## Phase : maquette réaliste — quartier du Champ de Mars

| Étape | État |
|---|---|
| 1. Accès et couverture des sources, `docs/SOURCES.md` | ✅ validée |
| 2. Chaîne de données : relief, volumes et toits LiDAR, rues, arbres | ✅ fusionnée (PR #1) |
| 3. Fiches façade (estimées) + générateur + matières | ✅ faite, en attente de ton avis |
| 4. Rendu complet, jeu (commandes, véhicules, circulation), publication | à faire (workflow Pages en place) |

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
