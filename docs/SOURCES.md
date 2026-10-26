# Sources de données — maquette réaliste d'Autun

Zone de la maquette : quartier de la mairie, place du Champ de Mars.
WGS84 : lat 46.9488040 → 46.9516020, lon 4.2964430 → 4.3009710.
Lambert-93 (EPSG:2154) : X 798601 → 798940, Y 6650654 → 6650970 (≈ 340 × 316 m).

Vérification faite le 25 octobre 2026 depuis l'environnement de développement.
Elle se rejoue avec `python3 -I tools/data/probe_sources.py`.
Une planche de contrôle se trouve dans [captures/etape1-sources.jpg](captures/etape1-sources.jpg).

## Synthèse

| Source | Accès | Couverture de la zone | Ce qu'elle apporte vraiment | Licence |
|---|---|---|---|---|
| OpenStreetMap (Overpass) | ✅ | 319 bâtiments, 57 voies, 38 commerces, 37 murs | Tracé et noms des rues, sens uniques, revêtements, commerces et leurs noms, bancs, poubelles, murs | ODbL 1.0 |
| IGN BD TOPO v3 (WFS) | ✅ | 337 bâtiments, hauteur pour 100 % | Emprises cadastrales, hauteur, niveaux (71 %), matériaux (≈ 40 %), date (61 %), largeur et sens des chaussées | Licence Ouverte 2.0 |
| IGN LiDAR HD | ✅ | 1 dalle (0798-6651), vol du 18 mars 2025 | Relief réel, forme réelle des toits, arbres réels | Licence Ouverte 2.0 |
| IGN MNT / MNS / MNH 0,5 m | ✅ | Complète | Mêmes infos que le LiDAR, en grilles prêtes à l'emploi | Licence Ouverte 2.0 |
| IGN BD ORTHO 20 cm | ✅ | Vols des 8 et 11 juillet 2023 | Couleur des toits, cours, jardins, sols, marquages au sol | Licence Ouverte 2.0 |
| BDNB (CSTB) | ✅ (API limitée) | 236 groupes de bâtiments | Presque la même chose que BD TOPO (même origine) + adresse BAN, usage, périmètre monument historique | Licence Ouverte 2.0 |
| Panoramax | ✅ | **Aucune photo dans la zone** (la plus proche est à 612 m) | Rien pour l'instant | Par photo (CC-BY-SA 4.0 le plus souvent) |
| Wikimedia Commons | ✅ (limite de débit) | 18 photos géolocalisées | Hôtel de ville (4), théâtre (2), lycée Bonaparte (2), vues de la place | Par image (à vérifier une par une) |
| POP (Mérimée) | ✅ pages web seulement | Au moins 7 édifices protégés dans la zone | Dates, architecte, parties protégées. Pas de photo trouvée pour le théâtre | Texte © Monuments historiques : on ne reprend que des faits |
| Poly Haven | ✅ | — | Textures PBR (pierre, enduit, tuiles, ardoise, pavés, asphalte) | CC0 |
| ambientCG | ✅ (domaine de téléchargement autorisé le 26/10) | — | Textures PBR (tuiles plates notamment) | CC0 |

Données Google (Street View, 3D Tiles…) : non utilisées, comme demandé.

## Détail par source

### OpenStreetMap (API officielle, Overpass en secours)

- Point d'accès : `https://overpass-api.de/api/interpreter` (fonctionne). Les miroirs `overpass.kumi.systems` et `overpass.private.coffee` sont bloqués ; ils ne sont pas nécessaires.
- 25 rues nommées dans la zone, dont la place du Champ de Mars, la rue de l'Hôtel de Ville, la rue Saint-Saulge, la rue aux Cordiers, l'avenue Charles de Gaulle, les passages Balthus et de la Terrasse.
- Ce qui est bien renseigné : `oneway` (33 voies sur 53), `surface` (49 sur 53 : asphalte, pavés `sett`, `paving_stones`), commerces (37 points, avec leur nom), restaurants (13), bancs (16), poubelles (12), parkings vélos, murs (`barrier=wall`, 37).
- **Ce qui manque** : aucune largeur de rue (`width`), aucun trottoir dessiné (`footway=sidewalk` : 0, `sidewalk` : 3 voies), aucun réverbère, seulement 4 arbres isolés et 12 alignements, aucun niveau ni forme de toit sur les bâtiments.
- Petite incohérence : la rue de l'Hôtel de Ville apparaît sous deux graphies (« Hotel » et « Hôtel ») ; on normalise avec le nom BAN de BD TOPO.
- Zone de 2,25 km² : téléchargement par blocs de 500 m via `api.openstreetmap.org/api/0.6/map.json` (Overpass coupait les connexions) ; Overpass reste le secours (`tools/data/fetch.py`).
- Licence : ODbL 1.0. **Conséquence** : nos fichiers de données qui combinent OSM avec d'autres sources forment une base dérivée ; ils doivent être diffusés sous ODbL. Ce n'est pas gênant pour un projet ouvert, mais c'est à savoir.
- Crédit à afficher : « © les contributeurs d'OpenStreetMap ».

### IGN BD TOPO v3 (Géoplateforme, WFS)

- Point d'accès : `https://data.geopf.fr/wfs/ows`, couches `BDTOPO_V3:batiment` et `BDTOPO_V3:troncon_de_route`.
- Bâtiments : 337 emprises. Elles viennent du cadastre recalé (précision annoncée : 3 m). 315 sont reliées au RNB.
  - `hauteur` : 100 % renseigné, de 1,1 à 23,5 m. Cette hauteur vient surtout d'une corrélation d'images (222 bâtiments) ou d'une interpolation (90). Elle est grossière (précision 2,5 m). Le LiDAR la remplace.
  - `nombre_d_etages` : 71 %, de 0 à 5.
  - Matériaux des murs et du toit : environ 40 % utilisables. Ils viennent des fichiers fonciers (déclaratif). Codes : murs `1` pierre, `4` brique… ; toits `1` tuiles, `2` ardoises, `3` zinc ou aluminium.
  - `date_d_apparition` : 61 %, mais arrondie (1700, 1750, 1800, 1850, 1900…). Elle donne une tranche d'époque, pas une date réelle.
  - `usage_1` : résidentiel 131, indifférencié 87, commercial et services 72, annexe 26, religieux 1.
- Chaussées : 47 tronçons, avec `largeur_de_chaussee` (3, 4 ou 5,5 m, très arrondie) et `sens_de_circulation` (19 à double sens, 26 à sens unique). Cela complète OSM, qui n'a aucune largeur.
- Licence : Licence Ouverte Etalab 2.0. Crédit : « IGN – BD TOPO® ».

### IGN LiDAR HD — nuage classé et modèles 0,5 m

- **Autun est couvert.** Toute la zone tient dans une seule dalle de 1 km² : `LHD_FXX_0798_6651_PTS_LAMB93_IGN69.copc.laz` (173 Mo, 26,2 millions de points). Téléchargement direct sur `data.geopf.fr/telechargement` : il fonctionne.
- Acquisition : **18 mars 2025**, édition du 20 octobre 2025. Classement **automatique seulement** (`IGN_AUTO_V5`, pas de reprise manuelle).
- Densité mesurée dans la zone : 27 points/m² en moyenne, **29 points/m² sur les toits** (environ un point tous les 19 cm).

  | Classe | Points/m² |
  |---|---|
  | Sol (2) | 10,5 |
  | Bâtiment (6) | 11,7 (29 par m² de toit) |
  | Végétation haute (5) | 2,9 |
  | Végétation basse et moyenne (3, 4) | 0,3 |
  | Non classé (1) | 1,7 |

- Pas de couleur dans le nuage (format 6 sans RGB) : les couleurs viennent de l'orthophoto.
- Modèles MNT, MNS et MNH à 0,5 m : disponibles en WMS GeoTIFF sur `data.geopf.fr/wms-r` (couches `IGNF_LIDAR-HD_MN*_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93`). On peut découper exactement la zone.
- Ce qu'on en tire :
  - **Relief réel** : le sol descend de 342 m (sud-est) à 317 m (nord-ouest), soit 25 m de dénivelé dans la zone. C'est très visible en jeu.
  - **Toits** : pentes, croupes, faîtages et décrochements sont bien lisibles à cette densité. Les cheminées (au moins 0,5 m) et les lucarnes (environ 1 m de large) forment des amas de 20 à 40 points : on peut les détecter. Les petits ornements, non.
  - **Hauteurs réelles** à l'égout et au faîtage, bien meilleures que BD TOPO. Exemple : le clocher de Notre-Dame monte à environ 365 m sur le MNS, alors que BD TOPO plafonne à 23,5 m de hauteur.
  - **Arbres** : position et hauteur réelles. Mais le vol date de mars, quand les arbres sont **sans feuilles** : les couronnes sont sous-estimées (on ne voit que les branches). On corrigera avec l'orthophoto de juillet, où les arbres sont en feuilles.
- Licence : Licence Ouverte 2.0. Crédit : « IGN – LiDAR HD ».

### IGN BD ORTHO 20 cm

- WMS `HR.ORTHOIMAGERY.ORTHOPHOTOS` sur `data.geopf.fr/wms-r` : il fonctionne. Prises de vue des **8 et 11 juillet 2023**, résolution 20 cm.
- Ce qu'on en tire : la teinte de chaque toit (tuile rouge, tuile vieillie, ardoise, zinc), les sols (asphalte, pavés, gravier de la place, pelouses), les marquages (places de parking du Champ de Mars, passages piétons), les couronnes d'arbres en été.
- Limite : c'est une image verticale. Les façades n'y apparaissent pas, et les toits sont légèrement décalés (devers des bâtiments hauts).
- Licence : Licence Ouverte 2.0. Crédit : « IGN – BD ORTHO® ».

### BDNB (Base de données nationale des bâtiments, CSTB)

- Point d'accès : `https://api.bdnb.io/v1/bdnb/donnees/…` (fonctionne). Le site `bdnb.io` (documentation) est bloqué, mais on n'en a pas besoin.
- Limites de l'accès libre : **10 lignes par appel**, quota de 10 000 appels. Pour la zone, il faut 72 appels (IRIS 710140108) : sans problème.
- 236 groupes de bâtiments dans la zone. Année de construction (194), matériaux des murs (pierre 108, brique et pierre 23…), matériaux des toits (tuiles 97, ardoises 26, ardoises et tuiles 13), niveaux, usage, adresse BAN.
- **Apport réel limité** : année et matériaux viennent des mêmes fichiers fonciers que BD TOPO ; les valeurs sont identiques. Ce que la BDNB ajoute : l'adresse postale, l'usage détaillé (collectif ou individuel, tertiaire), le nombre de logements et la confirmation que **toute la zone est dans un périmètre de monument historique**.
- Licence : Licence Ouverte 2.0. Crédit : « BDNB – CSTB ».

### Panoramax (photos de rue libres)

- L'API `api.panoramax.xyz` fonctionne.
- **Couverture : zéro photo dans la zone.** La tuile vectorielle de niveau 14 (environ 2,4 km de côté) qui contient le Champ de Mars est vide. Les photos les plus proches sont à 600 m au nord-ouest (deux séquences, avril 2019 et juin 2025), hors de la maquette.
- Conséquence : sans nouvelles photos, **toutes les fiches façade seront « estimées »**, sauf les monuments documentés sur Commons. Voir les options plus bas.

### Wikimedia Commons

- API `commons.wikimedia.org` : elle fonctionne, mais renvoie souvent « 429 Trop de requêtes » (l'adresse de sortie est partagée). La chaîne de données devra espacer ses requêtes et garder un cache.
- 18 fichiers géolocalisés dans la zone : hôtel de ville (4 photos), théâtre (2), lycée Bonaparte (2), statue de Vercingétorix, boîte à livres, et 8 vues générales de la place et des rues.
- La licence sera vérifiée **image par image** à l'étape des fiches façade. On ne publie pas les photos dans le jeu : elles servent seulement à décrire les façades. La référence est notée dans chaque fiche.

### POP — Plateforme ouverte du patrimoine (Mérimée)

- Les pages `pop.culture.gouv.fr/notice/merimee/…` sont lisibles. L'API (`api.pop.culture.gouv.fr`) et `data.culture.gouv.fr` sont bloquées ; elles ne sont pas nécessaires.
- Édifices protégés dans la zone (références relevées dans OSM) : théâtre (PA00113552, 1882-1884, architecte Giroud, façades et toitures inscrites), hôtel d'Orsenne (PA00113085), lycée Bonaparte (PA00113150), passage Balthus et passage de la Terrasse (PA00113092), monument aux morts (PA71000078), hôtel de Ganay (PA00113083), immeuble PA00113084.
- L'hôtel de ville et l'église Notre-Dame n'ont pas de notice MH dans la zone : il faudra les modéliser d'après les photos Commons et le LiDAR.
- Les notices donnent des faits (dates, architecte, parties protégées), sans photos exploitables. Le texte est « © Monuments historiques » : on n'en reprend que des faits, sans copier le texte.

### Textures CC0

- **Poly Haven** : API et téléchargements (`dl.polyhaven.org`) fonctionnent. Utilisées aux étapes 3 et 4 pour le rendu réaliste, **abandonné** (voir D17) : plus aucune texture externe n'est embarquée. On y trouve pierre, enduits, tuiles, ardoise, pavés et asphalte, en PBR (couleur, normales, rugosité). Ça suffit pour démarrer.
- **ambientCG** : le catalogue (`ambientcg.com`) répond. Les fichiers sont servis par `acg-download.struffelproductions.com`, **autorisé le 26 octobre 2026** : les téléchargements fonctionnent maintenant.
- Licence : CC0 pour les deux. On les crédite quand même.

## Domaines bloqués

| Domaine | Rôle | Nécessaire ? |
|---|---|---|
| `graph.mapillary.com` (et `www.mapillary.com`) | Photos de rue Mapillary (CC-BY-SA, Meta, pas Google). Demande aussi un jeton gratuit | Seulement si tu veux tester cette piste pour les façades |
| `www.wikidata.org`, `query.wikidata.org` | Liens entre monuments, Commons et Mérimée | Non, OSM donne déjà ces liens |
| `api.pop.culture.gouv.fr`, `data.culture.gouv.fr` | Accès structuré à POP | Non, les pages web suffisent |
| `bdnb.io` | Documentation de la BDNB | Non |
| `cdn.jsdelivr.net` | CDN npm | Non : les paquets passent par `registry.npmjs.org` |

## Risques principaux

1. **Façades sans photos.** Panoramax est vide et Google est interdit. Sans action, les façades seront « estimées » (typologie : époque, matériaux, secteur sauvegardé), sauf les trois monuments. C'est le plus gros écart avec l'objectif « reconnaître la ville bâtiment par bâtiment ».
2. **Arbres d'hiver dans le LiDAR** (vol du 18 mars) : couronnes trop fines. Correction prévue avec l'orthophoto de juillet.
3. **Classement LiDAR automatique** : on attend des erreurs ponctuelles (auvents, grands arbres collés aux façades). On contrôlera avec les emprises BD TOPO.
4. **Largeurs de rues et trottoirs** : OSM n'en a pas, et BD TOPO les arrondit. On les déduira de l'écart entre façades (emprises) et de l'orthophoto. Les bordures (10 à 15 cm de haut) sont à la limite de ce que le sol LiDAR peut montrer.
5. **Époques arrondies** (1750, 1800, 1850…) et matériaux connus pour moins de la moitié des bâtiments : la typologie complètera.
6. **Licence ODbL** : les données combinées avec OSM et publiées dans le dépôt sont sous ODbL.

## Crédits à afficher dans le jeu

> Données : © les contributeurs d'OpenStreetMap (ODbL) · IGN – BD TOPO®, LiDAR HD, BD ORTHO® (Licence Ouverte 2.0) · BDNB – CSTB (Licence Ouverte 2.0) · Photos de référence : Wikimedia Commons, auteurs cités dans les fiches · Moteur : three.js (MIT)

La liste exacte des photos (auteur, licence, lien) sera générée par la chaîne de données à partir des fiches façade.
