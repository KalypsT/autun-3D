# Ville vivante : calendrier, météo, saisons, passants, rythme de la semaine, petits gestes (plan)

**Avancement** : lot 1-1 (calendrier) fait (D194). Suivant : lot 1-2 (météo, partie logique). Rédigé le 2 novembre 2026 après D193, à la demande de l'utilisateur, après une discussion sur
« comment rendre le monde plus vivant et donner plus envie de se balader » (sans histoire ni missions, qui viendront plus tard).

Coordonnées et conventions habituelles : repère local du jeu (x vers l'est, y vers le nord), en mètres ; heures en heures de jeu (0 à 24).

## 0. Ce qu'il faut retenir

1. **Constat** : le décor est très riche, les systèmes aussi (circulation, police, armes, sons), mais le monde réagit surtout à la violence,
   il est identique à chaque instant (ni météo, ni saison, ni jour de la semaine) et rien ne récompense la flânerie.
2. **Périmètre validé par l'utilisateur** : lot 1 (une ville qui change et qui vit), lot 2 (le rythme de la semaine), et du lot 3 **seulement
   les petits gestes**. Pas maintenant : mode photo, lieux découverts, défis libres, sons d'ambiance et radio.
3. **Le jeu a son temps propre**, non calqué sur la vraie date. **Année raccourcie : une saison = une semaine de jeu (7 jours)**, soit une
   année de 28 jours (≈ 9 h 20 de jeu à 20 min par jour). Chaque jour de jeu correspond à un « jour de l'année » astronomique pour le soleil.
4. **Météo plutôt agréable**, épisodes de pluie, brume, orage ou neige de temps en temps, proportionnels à la saison (tableau du § 2).
5. **Intérieurs de bâtiments** : idée de l'utilisateur, **chantier à part**, plus tard (noté dans la feuille de route), hors de ce plan.
6. **Les enfants** (sortie des écoles, lot 2) : leurs proportions sont **à décider avec l'utilisateur avant de les coder** (déjà noté en P).
7. **Le budget du téléphone** (Honor Magic 8 Pro, 60 i/s) reste la règle : chaque sous-lot qui ajoute du rendu se mesure au banc
   (`?bench=1`, avec les nouveaux paramètres `&weather=` et `&season=`), comme d'habitude.

### Modèle conseillé par sous-lot

L'utilisateur peut changer de modèle entre les sous-lots. Indication donnée dans chaque titre :
- **(Sonnet)** : partie bien délimitée, logique pure ou modèle déjà posé dans le code ; suivre ce plan suffit.
- **(Opus)** : touche les nuanceurs de beaucoup de maillages, la simulation des passants (`pedestrians.ts`, 1 200 lignes, beaucoup d'états)
  ou le rendu par instances ; une mauvaise approche coûte en images par seconde et en reprises.
Si un sous-lot fait en Sonnet donne un résultat décevant ou fait chuter les images par seconde, le reprendre en Opus.

## 1. Le calendrier (lot 1-1, Sonnet)

### Aujourd'hui

- `Atmosphere.day` (`src/render/atmosphere.ts`) est un **jour de l'année (1 à 365)** qui avance d'un cran à chaque minuit (`addDays` de
  `src/core/save.ts`). Défaut : 200 (mi-juillet, `src/main.ts`), `?day=` l'impose.
- `sunPosition(dayOfYear, hour)` (`src/core/sun.ts`) en tire la hauteur du soleil, donc la durée du jour.
- La sauvegarde garde `clock: { hour, day }` (`SaveGame`, `SAVE_VERSION = 4`).
- `audio.update(dt, hour, day)` reçoit aussi le jour (cloches, oiseaux).

### Ce qu'on fait

Nouveau module pur `src/core/calendar.ts` (avec ses tests) :

- **`date`** : nombre entier de jours de jeu écoulés depuis le début de la partie (0, 1, 2…). C'est la seule valeur enregistrée.
- **Jour de la semaine** : `date % 7` (0 = lundi … 6 = dimanche).
- **Saison** : `floor(date / L) % 4` (0 printemps, 1 été, 2 automne, 3 hiver), `L` = durée d'une saison en jours (réglage, 7 par défaut,
  14 en option). **Jour dans la saison** : `date % L` (1er au 7e jour affiché).
- **Avancement dans la saison** `t` ∈ [0, 1[ : `(date % L + hour / 24) / L`. Sert aux transitions douces (couleur des arbres).
- **Jour de l'année astronomique** pour le soleil : `doy = 79 + (saison + t) × 91,25` (modulo 365), soit le printemps au 20 mars (jour 79),
  l'été vers le 21 juin, l'automne vers le 22 septembre, l'hiver vers le 21 décembre. `sun.ts` ne change pas : il reçoit ce `doy`.
- **Saison figée** (réglage) : la saison et `doy` restent ceux du jour figé ; la semaine continue de tourner (marché, écoles).
- **Fêtes**, placées par jour de saison (et non par date réelle, car l'année est raccourcie) :

| Fête | Saison, jours | Ce qui se passe (lot 2-2) |
|---|---|---|
| Illuminations de Noël | automne j7 → hiver j3 | guirlandes dans le centre, sapin place du Champ de Mars, la nuit |
| Marché de Noël | hiver j1 et j2 (après-midi, soir) | chalets sur la place du Champ de Mars (il existe vraiment à Autun) |
| Noël | hiver j2 | rues calmes, cloches |
| Fête de la musique | été j1, de 18 h à 1 h | musiciens sur les places, foule le soir |
| 14 juillet | été j3, vers 23 h | feu d'artifice tiré depuis le plan d'eau du Vallon (lac d'Autun), confirmé par l'utilisateur |

- **Nouvelle partie** : été, 1er jour (lundi), 16 h. Une ancienne sauvegarde (version 4, `day` = jour de l'année) est migrée vers la date
  dont le `doy` est le plus proche, un lundi de cette saison (le jour de la semaine n'existait pas : on ne perd rien).

### Branchements

- `Atmosphere` garde `date` au lieu de `day` ; elle passe `doy` à `sunPosition`. Un accesseur `calendar` donne saison, jour, `t`, fête.
- Sauvegarde **version 5** : `clock: { hour, date }` ; lecture des versions 1 à 4 par migration, avec tests (`save.test.ts`).
- Réglages (`src/core/settings.ts`, menu pause) : « Durée d'une saison » (7 ou 14 jours), « Saison » (« Qui passe » ou l'une des quatre).
- Interface : sous l'horloge, « Mer. · Été, 3e jour » (style des autres textes du bandeau ; à juger sur capture).
- Paramètres d'URL (ajoutés à `FORCING_PARAMS` de `src/game/start.ts`) : `?date=N`, `?season=printemps|ete|automne|hiver`,
  `?weekday=1..7`. `?day=` reste accepté (jour de l'année, converti comme une ancienne sauvegarde).
- L'audio reçoit `doy` (comportement inchangé) et le jour de la semaine (cloches du dimanche, lot 2).

## 2. La météo, partie logique (lot 1-2, Sonnet)

Nouveau module pur `src/core/weather.ts` (avec ses tests).

### Tirage

| Saison | Beau | Nuageux | Pluie | Autre |
|---|---|---|---|---|
| Printemps | 50 % | 30 % | 20 % (averses courtes) | — |
| Été | 70 % | 15 % | 5 % | 10 % d'orage, le soir |
| Automne | 35 % | 30 % | 25 % | 10 % de brume, le matin |
| Hiver | 40 % | 30 % | 15 % | 15 % de neige ou de givre |

- Le temps est découpé en **épisodes de 2 à 4 heures de jeu**, tirés d'une **graine dérivée de la date** (et du numéro d'épisode) : la même
  partie retrouve la même météo après un rechargement, sans rien enregistrer de plus.
- Contraintes : **jamais plus d'un jour de pluie complet d'affilée** (on re-tire) ; l'orage seulement entre 16 h et 23 h ; la brume
  seulement de 5 h à 10 h ; pas de neige au printemps ni en été.
- **Transitions** de 20 à 40 minutes de jeu : les nuages arrivent avant la pluie et partent après. Sortie : un état continu,
  `{ kind, cloud, rain, fog, snow, wet, storm }`, chaque valeur entre 0 et 1. `wet` (sol mouillé) monte avec la pluie et sèche en
  1 à 2 heures après ; `snow` au sol fond plus lentement.
- Paramètre d'URL `?weather=beau|nuageux|pluie|orage|brume|neige` (impose et fige la météo ; ajouté à `FORCING_PARAMS`), et `&weather=`
  dans le banc.

### Effets sur le jeu (logique)

- **Adhérence** : `grip` des fiches de véhicules (`src/core/vehicle-specs.ts`) multiplié par un facteur de sol (sec 1 ; mouillé 0,8 ;
  neige 0,6 ; à régler en conduisant). Chercher où `grip` est lu dans `src/core/vehicle.ts` et appliquer le facteur en un seul endroit.
- **Passants** : `crowdTarget` (`src/core/crowd-density.ts`) multiplié par un facteur météo (pluie 0,45 ; orage 0,3 ; neige 0,6 ; brume 0,9).
  Les passants sous la pluie marchent un peu plus vite.
- **Circulation** : un peu moins dense sous la pluie (facteur 0,8 dans `src/core/traffic-density.ts`), conducteurs plus prudents
  (vitesse de croisière × 0,9).

## 3. La météo, partie rendu (lot 1-3, Opus)

### Aujourd'hui

- `Atmosphere.apply()` règle le ciel (`skyMat`, uniformes `horizon`, `mid`, `zenith`, `stars`, `cloudLight`), le brouillard
  (`scene.fog`, `near` et `far`), le soleil, la lumière d'ambiance et l'exposition, d'après la hauteur du soleil.
- Les fenêtres et lampadaires allumés sont **un seul matériau** (`res.glowMat`, `StyleResources` de `src/render/stylized.ts`) dont
  l'opacité suit la nuit.

### Ce qu'on fait

1. **Ciel et lumière** : un uniforme de couverture nuageuse dans le nuanceur du ciel (`src/render/sky.ts`) ; la palette de `Atmosphere`
   mélangée à une palette « gris » selon `cloud` (soleil plus faible, ombres plus douces, exposition un peu plus basse). Brouillard
   rapproché selon `fog` (brume : `far` ≈ 180 m) et pluie (un peu).
2. **Pluie** : traits de pluie autour de la caméra, **un seul appel de dessin** (maillage instancié ou `LineSegments` recyclés dans une boîte
   qui suit la caméra), densité selon `rain`. Éclaboussures au sol facultatives (à mesurer). Pas de gouttes sur l'écran.
3. **Sol mouillé** : un uniforme global `uWet` injecté (`onBeforeCompile`, comme `atmosphere.ts` le fait déjà pour certains matériaux) dans
   les matériaux de sol, de relief, de route et de toit : couleur plus sombre, rugosité plus basse (reflets du ciel), **flaques** tirées d'un
   bruit en coordonnées du monde (pas de texture de plus si possible). **À faire en premier, mesuré seul** : c'est le poste le plus risqué.
4. **Neige** : même principe, `uSnow` blanchit les surfaces tournées vers le haut (sols, toits, couronnes des arbres) ; flocons comme la pluie,
   plus lents. Givre : `uSnow` faible, le matin seulement.
5. **Orage** : éclairs (flash de la lumière d'ambiance pendant 0,1 à 0,2 s, parfois deux), tonnerre décalé selon une distance tirée.
6. **Sons** (`src/audio/`, synthèse comme le reste) : pluie (bruit filtré, plus fort sous un abri comme le passage Balthus ou le parvis de la
   cathédrale, si c'est simple), tonnerre, vent plus fort par temps couvert, essuie-glaces en voiture sous la pluie. Ajouter les sons à la
   page `?sounds` et à `tools/sounds.sh`.
7. **Phares** : allumés aussi par temps de brume ou de forte pluie (`render/vehicle-lights.ts`).

Captures : même lieu (place du Champ de Mars, rue aux Cordiers, vue aérienne) par beau temps, pluie, brume, orage la nuit, neige.
Mesure : `?bench=1&weather=pluie` et `&weather=neige`, à comparer au banc par beau temps.

## 4. Les saisons, partie rendu (lot 1-4, Opus)

1. **Arbres** (`src/render/trees.ts`, couronnes en `InstancedMesh`) : couleur selon la saison et `t` (vert tendre au printemps, vert franc
   l'été, jaune-roux puis brun en automne, nus l'hiver). Changement de couleur **une fois par heure de jeu au plus** (couleurs d'instances ou
   un uniforme), jamais à chaque image. Hiver : couronne réduite et ajourée (seuil sur un bruit, `alphaTest`, à mesurer) ou silhouette de
   branches ; choisir à l'œil sur capture. Les arbres taillés de la place du Champ de Mars (D155) et le cèdre de la Croix Verte (D142, un
   conifère) suivent leurs propres règles : le cèdre reste vert.
2. **Feuilles au sol** en automne : teinte du gazon et des trottoirs près des arbres (uniforme dans le sol) plutôt que des objets.
3. **Herbe** : plus jaune à la fin de l'été, plus terne l'hiver (teinte du sol).
4. **Vêtements des passants** : la recette de personnage (`src/core/character.ts`, déterministe) reçoit la saison et la météo pour pondérer
   les tables (manteau en hiver, manches courtes l'été). **Parapluies** sous la pluie : une pièce du kit (`character-kit.ts`,
   `render/character-parts.ts`) tenue à la main, pour une partie des passants. Garder un seul appel de dessin pour la foule.
5. **Joueur** : sa tenue ne change pas toute seule (c'est son apparence, choisie dans le menu).

## 5. Des passants qui font quelque chose (lot 1-5, Opus)

### Aujourd'hui

`src/core/pedestrians.ts` : états `walk`, `wait`, `cross`, `idle`, `stumble`, `down`, `dead`. Les passants marchent sur les files de
navigation vers des points d'intérêt (`poi` de `src/data/nav.ts`) et restent debout (`idle`) devant. La pose assise existe pour les
passagers du petit train (`render/train-model.ts`, D119).

### Ce qu'on fait

1. **Assis sur les bancs** : les bancs sont dans le mobilier des tuiles (`furniture`, étiquette OpenStreetMap `bench`). Nouvel état `sit` :
   un passant choisit un banc libre proche (réservation d'une place, deux ou trois places par banc), s'y assoit 2 à 15 minutes de jeu, repart.
   Pose assise ajoutée à `character-pose.ts` (reprendre celle du train). Il se lève et fuit comme les autres en cas d'alerte.
2. **Aux terrasses** (D157, terrasses des cafés) : même état `sit`, sur les chaises de la terrasse, selon l'heure d'ouverture (§ 6) et la
   météo (personne en terrasse sous la pluie).
3. **En groupes** : deux ou trois passants nés ensemble, qui marchent côte à côte et s'arrêtent face à face pour discuter (`idle` en cercle,
   gestes légers des bras).
4. **Au téléphone** : variante d'`idle` et de `walk`, une main à l'oreille.
5. **Chien en laisse** : premier animal. Un modèle de chien simple (pièces instanciées, **un appel de dessin pour tous les chiens**), qui
   suit son maître avec un peu de retard et de flânerie ; laisse en trait. Il fuit avec lui. **Ce modèle sert ensuite aux chiens seuls
   (lot 2-3) et au geste « caresser » (lot 3).**
6. **Joggeurs** : pose de course existante, le matin (7 h à 9 h) et le soir (18 h à 20 h30), plutôt dans les parcs et au bord de l'eau.
7. **Réactions douces** : un passant proche se retourne au klaxon ou à la sonnette (au lieu de seulement sursauter), certains regardent un
   monument en passant (tête tournée).

Proportions à régler avec le réglage « Foule » ; budget : la pose assise ne doit pas coûter plus qu'`idle`. Tests : les cas de fuite et de
combat existants (`pedestrians-combat.test.ts`, `combat-soak.test.ts`) doivent rester verts avec des passants assis.

## 6. Les lumières de la ville (lot 1-6, Opus)

1. **Fenêtres allumées une à une** : aujourd'hui tout `glowMat` s'allume d'un coup. Ajouter une valeur tirée par fenêtre (attribut de sommet,
   écrit à la construction des façades dans `render/facades.ts`) et un seuil uniforme qui suit l'heure : les fenêtres s'allument entre le
   coucher du soleil et 21 h, s'éteignent peu à peu entre 22 h et 1 h, quelques-unes restent allumées toute la nuit, quelques-unes se
   rallument vers 6 h 30. Aucune reconstruction de tuile.
2. **Heures d'ouverture des commerces** : horaires par type (boulangerie 7 h-19 h 30 et le dimanche matin, café 7 h-1 h, boutique
   9 h 30-19 h, fermée le dimanche, grande surface 8 h 30-20 h, pharmacie 9 h-19 h…). Si OpenStreetMap donne `opening_hours` pour un
   commerce, le garder dans les données (chaîne de `build_shop_fronts.py`) ; sinon l'horaire du type. Module pur `src/core/opening.ts`.
3. **Vitrines éclairées le soir** quand c'est ouvert, **rideaux de fer baissés** quand c'est fermé : même technique que les fenêtres
   (attribut par devanture et uniforme), pas de reconstruction. Les enseignes lumineuses (croix de pharmacie, carotte de tabac) suivent
   l'ouverture.
4. **Lampadaires** : allumage progressif sur quelques minutes plutôt que tous ensemble (seuil tiré par lampadaire).
5. Les passants vont vers les commerces ouverts (points « commerce » des données de navigation) ; moins de monde devant un commerce fermé.

## 7. Le rythme de la semaine (lot 2-1)

### Le marché (Opus pour le rendu des étals, le reste Sonnet)

- **Mercredi et vendredi matin, place du Champ de Mars** (confirmé ; le vendredi, il s'installe aussi sous les halles de la mairie).
- Horaires : installation de 5 h à 7 h (camionnettes), plein marché de 7 h à 12 h 30, remballage jusqu'à 13 h 30.
- Étals : modèle simple instancié (tréteaux, bâche à rayures de couleurs, cagettes), placés sur les rangées du grand parking (D154, `lots`)
  et sous les arcades de la mairie le vendredi ; les voitures garées sur ces places disparaissent ces matins-là (placement des véhicules
  garés, `src/core/vehicle-placement.ts`), les camionnettes des marchands se garent derrière.
- Foule dense sur la place (points d'intérêt « marché » temporaires), sons : brouhaha, cris des marchands (synthèse simple).

### Les écoles

- Grilles du lycée Bonaparte (D149) et du collège du Vallon (D174), qui ont déjà des horaires (`src/core/school-gate.ts`).
- Jours d'école : lundi, mardi, jeudi, vendredi toute la journée ; mercredi matin seulement ; pas le week-end. Grille fermée hors école.
- Entrée 7 h 45-8 h 15, sortie 16 h 30-17 h 30 (et 12 h le mercredi) : foule d'élèves devant la grille, voitures de parents arrêtées.
- **Les élèves sont les premiers enfants et adolescents du jeu : proportions à décider avec l'utilisateur avant de coder** (recette de
  `character.ts`, échelle par os ; les lycéens peuvent être des adultes un peu plus petits, les collégiens demandent de vraies proportions).

### Le dimanche, les matins

- Dimanche : boutiques fermées (§ 6), boulangeries ouvertes le matin, moins de circulation, **cloches de Saint-Lazare avant la messe de
  10 h 30** et parvis animé à la sortie (11 h 30-12 h) ; promeneurs plus nombreux l'après-midi dans les parcs et au théâtre romain.
- Matins de semaine : camionnettes de livraison arrêtées en double file devant les commerces (6 h-10 h) ; **camion poubelle** avec deux
  éboueurs à l'arrière, le mardi et le vendredi tôt, qui s'arrête tous les 30 m (lot 2-4).

## 8. Les fêtes (lot 2-2, Opus pour le rendu, Sonnet pour le reste)

Selon le tableau du § 1 :
- **Illuminations** : guirlandes au-dessus des rues du centre (rues de la place du Champ de Mars, Grande Rue Chauchien, rue aux Cordiers),
  sapin illuminé sur la place, la nuit seulement ; un maillage par tuile du centre, allumé avec le seuil des fenêtres.
- **Marché de Noël** : chalets en bois sur la place (variante des étals), foule le soir, vin chaud (son).
- **Fête de la musique** : trois ou quatre groupes de musiciens (passants à instruments, pose dédiée) sur les places, musique synthétisée
  simple par groupe, foule autour.
- **14 juillet** : feu d'artifice à 23 h, **tiré depuis le plan d'eau du Vallon (lac d'Autun)**, confirmé par l'utilisateur : gerbes
  au-dessus du lac et reflets sur l'eau si c'est simple, foule sur les rives à partir de 22 h (particules en un appel de dessin,
  détonations décalées selon la distance).

## 9. Les animaux (lot 2-3, Opus)

Réutiliser le modèle de chien (lot 1-5) et le code des pigeons (`src/core/pigeons.ts`, `render/pigeons.ts`, `game/pigeons-controller.ts`).
- **Chiens seuls** dans les quartiers résidentiels, qui trottent, reniflent, aboient au passage du joueur (son).
- **Chats** la nuit, sur les murets, les capots et les marches, qui fuient à l'approche.
- **Canards** sur l'Arroux et le plan d'eau du Vallon (polygones d'eau de `public/data/structures`, D93), qui nagent en petits groupes.
- **Martinets** en été, en vol au-dessus de la vieille ville en fin de journée (oiseaux instanciés, battement d'ailes dans le nuanceur,
  cris dans le son).
- **Chauves-souris** au crépuscule autour des tours de la cathédrale et des remparts.
- **Hérons** au bord de l'eau, immobiles, qui s'envolent quand on approche.
Chaque espèce : un seul appel de dessin, un plafond (`?animals=0` pour couper, comme `?pigeons=`), apparition et disparition autour du joueur.

## 10. Une circulation plus variée (lot 2-4, Sonnet pour le catalogue, Opus pour les nouveaux comportements)

Chaque nouveau véhicule est une entrée du catalogue (`src/core/vehicle-catalog.ts`, fiche dans `vehicle-specs.ts`, carrosserie dans
`render/car-body.ts` ou un modèle dédié) et un poids dans `src/core/traffic-spawn.ts`.
- **Scooters et motos** dans la circulation, pilote visible (les poses de conducteurs existent, `?proto=riders`).
- **Cyclistes** sur la chaussée, plus lents, que les voitures doublent ou suivent.
- **Bus urbain** : une ou deux lignes en boucle sur le graphe routier avec des arrêts (lire les relations `route=bus` d'OpenStreetMap si
  elles existent pour Autun ; sinon une boucle choisie à la main), qui s'arrête et laisse monter et descendre des passants.
- **Camion poubelle** (lot 2-1), **camionnettes de livraison**, **tracteur** sur les routes de la périphérie.
- **TER** sur la voie ferrée (D93, idée notée en M2) : deux ou trois passages par jour, arrêt en gare, passages à niveau qui se ferment.

## 11. Les petits gestes (lot 3, Sonnet une fois les poses faites ; les poses en Opus)

Un **bouton contextuel**, sur le modèle de « Monter », « Prendre » et « Ramasser » (même place, même style), qui affiche le geste possible
le plus proche. Une pose par geste dans `character-pose.ts`.

| Geste | Où | Ce qui se passe |
|---|---|---|
| S'asseoir | bancs, chaises de terrasse (§ 5) | le joueur s'assoit ; second bouton « Regarder passer le temps » : l'horloge accélère (× 30) tant qu'on ne touche à rien ; on se lève au premier geste |
| Boire | fontaines (mobilier `drinking_water` et `fountain`, fontaine Saint-Lazare D131) | penché quelques secondes ; rend un peu de santé (+5, à régler) |
| Nourrir les pigeons | n'importe où, à pied, pigeons proches | les pigeons accourent et picorent autour (attraction dans `pigeons.ts`) |
| Caresser | chien de passant ou chien seul (§ 5, § 9) | le chien remue la queue ; son maître sourit (tête tournée) |
| Tirer au panier | paniers des terrains (D176, `src/core/hoops.ts`) | lancer avec une trajectoire simple ; panier marqué ou raté ; meilleure série gardée, comme le compteur de roue arrière (`stunt.ts`) |
| Saluer | passants proches | le joueur fait signe ; les passants proches se tournent, certains répondent |
| Entrer dans une boutique | porte d'un commerce ouvert (§ 6) | clochette de la porte, le joueur s'avance sur le seuil, la porte se referme ; **pas d'intérieur** (chantier à part) |

Clavier : une seule touche pour le geste (proposer `F`, à vérifier qu'elle est libre ; `E` reste pour les véhicules).

## 12. Ordre et dépendances

1. **Lot 1-1 calendrier** : tout le reste en dépend (saisons, météo, semaine).
2. **Lot 1-2 météo logique**, puis **1-3 météo rendu** (sol mouillé d'abord, mesuré seul).
3. **Lot 1-4 saisons**.
4. **Lot 1-5 passants** (le chien est un préalable du lot 2-3 et du geste « caresser »).
5. **Lot 1-6 lumières de la ville** (les horaires d'ouverture servent au lot 2 et au geste « entrer »).
6. **Lot 2** : 2-1 semaine (sauf les élèves, après la décision de l'utilisateur), 2-2 fêtes, 2-3 animaux, 2-4 circulation.
7. **Lot 3** : gestes.

Chaque sous-lot : une version jouable sur téléphone, captures au format téléphone en paysage (avant / après), mesure du banc si le rendu change,
une décision dans `docs/DECISIONS.md` (à partir de D194), l'avancement dans `PROGRESS.md`, la feuille de route à jour, les vérifications
`npm run typecheck && npm run lint && npm test && npm run build`. Petites PR, à la demande de l'utilisateur seulement.

## 13. Risques

- **Images par seconde** : sol mouillé (touche presque tous les matériaux), pluie et neige (particules), arbres ajourés l'hiver, passants
  assis et animaux (personnages en plus). Mesurer chaque poste seul ; prévoir des repli (moins de particules, flaques sans reflets).
- **Nuanceurs** : injecter les uniformes (`uWet`, `uSnow`, saison) sans multiplier les variantes de programmes (temps de compilation au
  chargement des tuiles) ; vérifier qu'aucun matériau partagé ne se recompile à chaque changement de météo.
- **Sauvegarde** : migration de la version 4 à la version 5 ; tests de lecture des anciennes versions.
- **Données** : horaires d'ouverture d'OpenStreetMap souvent absents ou incomplets (repli sur le type) ; lignes de bus à vérifier.
- **Simulation des passants** : nouveaux états (`sit`, groupes, chien) à faire cohabiter avec la fuite, les combats, la police, le passage
  Balthus et le théâtre ; garder les bancs de combat et d'endurance verts.

## 14. Reprendre dans une nouvelle conversation

> Lis `README.md`, `PROGRESS.md` (fin), `docs/ROADMAP.md`, les dernières décisions de `docs/DECISIONS.md` (D186 et suivantes) et **ce plan**
> (`docs/plans/ville-vivante.md`). Fais le sous-lot suivant non fait (voir « Avancement » en tête de ce fichier et § 12), en suivant le
> plan ; si tu t'en écartes, dis pourquoi et note-le dans la décision. Échanges, docs et textes du jeu en français, identifiants en anglais,
> tutoiement. Mets à jour « Avancement » en tête de ce fichier à la fin du sous-lot.

Sources pour le marché : [marchés d'Autun (whereisthemarket)](https://whereisthemarket.com/market_city/autun/),
[Marchés d'Autun (JDS)](https://www.jds.fr/autun/foires-et-salons/marches/marches-d-autun-1135906_A).
