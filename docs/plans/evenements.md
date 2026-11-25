# Plaisir de jeu, phase 4 : les événements aléatoires (plan)

**Avancement** : plan rédigé le 25 novembre 2026 ; **réponses de l'utilisateur : « ok » pour toutes les réponses par défaut** (§ 9). Les lots
se font **deux par deux**, avec une pause après chaque paire ; la PR à la fin de la phase.

Chantier « PJ » de `docs/ROADMAP.md`, phase 4. Demande : « c'est ce qui doit rendre la ville vraiment vivante : il faut bien le travailler ».
Conventions habituelles : repère local du jeu (x vers l'est, y vers le nord), mètres, heures de jeu (une journée dure 20 minutes réelles).

## 0. Ce qu'il faut retenir

1. **Un événement, c'est une petite histoire de 30 s à 3 min qui arrive près de toi** : on la comprend en deux secondes (un cri, un geste,
   une bulle « Au voleur ! »), on peut s'en mêler ou la laisser filer, et **elle se termine toute seule si tu ne fais rien** (la ville vit
   sans toi). Pas de mission imposée, pas de flèche obligatoire.
2. **Un directeur d'événements** choisit quoi, où et quand, selon le quartier, l'heure, le jour, la météo et ce que tu fais ; il garde un
   rythme (pas deux vols d'affilée, pas d'événement pendant que la police te poursuit) et un **plafond de coût**.
3. **Presque rien de nouveau à dessiner** : les acteurs sont des **passants de la foule réquisitionnés** (et rendus à la foule ensuite), les
   voitures sont celles de la circulation, les effets ceux des armes. Cible : **0 appel de dessin de plus** pour un événement à pied, **+3 au
   plus** pour un événement avec la police (comme une poursuite du joueur, déjà mesurée en D78).
4. **Trois généralisations** à faire, demandées par toi : la **poursuite** vise n'importe quelle cible (aujourd'hui le joueur ou un point de
   fouille), les **passants savent fuir quelqu'un** (choisir les rues qui les éloignent de lui), et la **police s'occupe aussi d'autres que
   toi** (poursuivre un conducteur, arrêter un bagarreur).
5. **Premier lot proposé** : le socle (directeur, acteurs, bulles, repère sur la minimap, récompense) avec **le vol à l'arraché**, l'événement
   qui exerce le plus de socle (fuite volontaire, rattraper, rendre ou garder le sac). Ensuite, un événement nouveau par lot (§ 7).

## 1. Ce qui existe, ce qui manque

| Besoin | Ce qui existe | Ce qui manque |
|---|---|---|
| Acteurs à pied | Foule `PedSim` (D42), emplacements réservés pilotés de l'extérieur (`setExternal`, les gendarmes, D75), sacs à main dans les recettes (`BAGS`), poses de marche, course, chute en trois intensités (D212), trébuchement (D211), assis, téléphone, discussion (D198), visée (D85) | Prendre un passant de la foule et le rendre ; **fuir quelqu'un** (aujourd'hui `panic` court le long de la file, retournée une fois, D83) ; **suivre quelqu'un** ; poses de bagarre, à genoux, mains en l'air, bras tendu qui montre |
| Voitures | Circulation `TrafficSim`, conducteur `Driver` en style « poursuite » (vite, contresens, feux ignorés, D73), arrêts `holdT` (D204), dégâts et abandon (D112), conducteur éjecté qui fuit (`PedSim.eject`, D71), klaxons (D66), civils qui se rangent devant une sirène | **Une cible par voiture en poursuite** (aujourd'hui une seule pour toutes : le joueur ou le point de fouille, `TrafficSim.target`) ; un conducteur qui **fuit** des poursuivants ; poser une scène hors de vue (deux voitures de travers, abîmées) ; feux de détresse |
| Police | Vue, renforts, fouille, gendarmes à pied, arrestation (D73 à D79) ; le `Chaser` ne connaît qu'un point (x, y, vx, vy) : il est déjà générique | `PoliceController` et `Officers` ne visent que le joueur (`Suspect`) : il faut des **affaires** (poursuivre un PNJ, l'arrêter) à côté des étoiles du joueur |
| Récompense | Porte-monnaie et « +250 € » (D317), bandeau d'exploit en file (D311, D319), carnet et défis (D319), bouton contextuel (« Monter », « Ramasser », « Entrer ») | Un onglet « Faits divers » du carnet ; quelques défis |
| Sons | Cris (sursaut, « aïe », cri, « oh »), chocs, klaxons, sirène de gendarmerie avec Doppler, portière, murmure de foule (D313), aboiement | Sirène deux tons des pompiers ; dispute (voix qui s'emportent) ; rien de parlé (voir Q7) |
| Lisibilité | Bandeau d'exploit, minimap | **Bulle de parole** au-dessus d'une tête (« Au voleur ! »), flèche au bord de l'écran quand la scène est hors champ ; repère d'événement sur la minimap |

Limite à connaître : **les conducteurs de la circulation sont invisibles** (vitres opaques, J4-1b repoussée, D72). Un conducteur qui descend
apparaît à sa portière (comme le vol avec conducteur, D71) : c'est acceptable, on ne le voit pas « sortir ».

## 2. Ce qui fait un bon événement (règles communes)

- **Lisible en deux secondes sur un téléphone, même sans le son** : un geste ample (bras tendu, chute, course), une bulle de parole de
  deux ou trois mots, un cri. Si la scène est hors de l'écran, une petite flèche au bord de l'écran pendant 3 s.
- **Proche mais jamais apparu sous tes yeux** : les acteurs sont des passants déjà là ou nés hors de vue (règles de D43 et D64) ; une
  scène posée (accident) l'est hors de vue, sur ton chemin.
- **Une fin dans tous les cas** : rattrapé, enfui, arrêté, secouru, ou abandonné quand tu t'éloignes à plus de 250 m (on nettoie hors de vue).
- **Tu peux t'en mêler, pas obligé** : un repère ocre « ! » sur la minimap pendant l'événement, et c'est tout.
- **Ce que tu fais a un prix ou une récompense** cohérents avec la phase 3 : bonne action payée (100 à 500 €), mauvais choix possible
  (garder le sac), et les règles de la police s'appliquent comme d'habitude (tuer le voleur reste un meurtre).
- **Rares assez pour rester une surprise** : § 4.

## 3. Catalogue

Chaque fiche : déclenchement, lieux, heures, fréquence (poids relatif dans le tirage du directeur, § 4), ce qu'on voit et entend, ce que tu
peux faire, conséquences, ce qu'il faut construire. « Petit » ou « grand » : un grand événement mobilise la police ou plusieurs voitures ;
il y en a **un grand et un petit au plus** en même temps.

### Vue d'ensemble

| # | Événement | Taille | Où | Quand | Lot |
|---|---|---|---|---|---|
| E1 | Vol à l'arraché | petit | centre, places, terrasses, arrêts de bus | 8 h – 22 h | 1 |
| E2 | Pickpocket (c'est toi qu'on vole) | petit | foule dense (centre, marché) | 9 h – 20 h | 2 |
| E3 | Chien échappé | petit | quartiers d'habitation, parcs, bords de l'eau | 7 h – 20 h | 2 |
| E4 | Accident entre deux voitures (constat, dispute, bouchon) | grand | rues et routes avec circulation | toute la journée, plus sous la pluie | 3 |
| E5 | Poursuite entre la police et un autre conducteur | grand | routes principales, puis n'importe où | surtout le soir et la nuit | 4 |
| E6 | Malaise d'un passant (pompiers) | petit (grand quand les pompiers arrivent) | là où il y a du monde | jour, plus l'été l'après-midi | 5 |
| E7 | Rixe | grand | devant les bars et restaurants, places | soir et nuit, surtout vendredi et samedi | 6 |
| E8 | Conducteur énervé (après un accrochage avec toi) | petit | où tu conduis | toujours (provoqué par toi) | 7 |
| E9 | Livreur pressé | petit | centre, matin | 6 h – 11 h, lundi au samedi | 7 |
| E10 | Accident en direct (un conducteur grille un feu) | grand | carrefours à feux | toute la journée | 7 |
| E11 | Cortège de mariage | grand (sans danger) | hôtel de ville, puis les rues | samedi 14 h – 18 h | 8 |
| E12 | Feu de poubelle | petit | rues du centre et des quartiers | soir et nuit | 8 |
| E13 | Braquage d'un commerce (armé) | grand | commerces ouverts tard (tabac, supérette, station-service) | 19 h – 23 h | 9, **si tu le veux** (Q3) |

Écartés de cette phase : petits boulots (taxi, livraisons : plus tard, D317), incendie de bâtiment, hélicoptère, manifestation
(une foule de cent personnes qui marchent ensemble dépasse le budget de la foule).

### E1. Vol à l'arraché (lot 1)

- **Déclenchement** : tu es à pied ou dans un véhicule sous 20 km/h ; une **victime** est choisie parmi les passants qui portent un sac
  (sac à main ou à bandoulière) à 20 – 60 m de toi, qui marchent ou sont assis en terrasse, de préférence dans ton champ de vision ;
  un **voleur** est pris parmi les passants seuls hors de ta vue, à 15 – 40 m derrière elle. Pas de vol à moins de 60 m d'une voiture
  de police ou d'un gendarme.
- **Lieux** : zones « centre » et places (poids fort), rues commerçantes, arrêts de bus, terrasses ; pas en zone « nature ».
- **Heures** : 8 h – 22 h, moins sous la pluie (il y a moins de monde dehors, D195).
- **Fréquence** : poids 3 (le plus courant des petits).
- **Ce qu'on voit et entend** : le voleur marche, puis presse le pas derrière la victime, **arrache le sac** (le sac passe de sa recette à
  celle du voleur : on le voit changer de main) ; la victime trébuche ou tombe (chute légère, D212), **crie**, se relève et tend le bras
  vers le voleur ; bulle « Au voleur ! ». Les passants proches s'écartent (sursaut). Le voleur **s'enfuit en courant** (5,8 m/s au départ,
  plus vite que ta course à 5 m/s, moins vite que ton sprint à 7 m/s ; il faiblit à 4,5 m/s après 15 s), en choisissant aux carrefours
  les rues qui l'éloignent de toi (fuite volontaire, § 5.1), en traversant hors des passages, en bousculant les passants sur son chemin.
  Un point rouge sur la minimap tant que tu le vois ou qu'il est à moins de 60 m.
- **Ce que tu peux faire** :
  - **Le rattraper** : le toucher en sprint le **plaque** (il tombe, lâche le sac), un coup de poing, de batte ou de couteau le fait tomber
    aussi ; en véhicule, le renverser. Le sac tombe au sol (objet à ramasser en marchant dessus, comme les billets de D317).
  - Puis **« Rendre le sac »** (bouton contextuel près de la victime, qui t'attend 2 minutes là où elle a été volée, repère sur la
    minimap) : elle te remercie (bulle « Merci ! »), **prime** (Q4).
  - Ou **le garder** : tu touches ce qu'il contient (moins que la prime) ; la victime te voit faire si tu passes près d'elle (Q4).
  - **Ne rien faire** : le voleur disparaît hors de vue au bout de 30 s à 1 min ; la victime reste un moment, téléphone en main, puis repart.
- **Conséquences** : plaquer, frapper ou renverser le voleur **n'est pas une infraction** tant qu'il porte le sac (Q5) ; le tuer est un
  meurtre comme un autre (D83), tirer reste un coup de feu en public (deux étoiles). Frapper la victime : agression, comme d'habitude.
- **À construire** : directeur, réquisition et retour des passants, fuite volontaire, plaquage, sac (recette et objet au sol), bulle,
  repère, prime, compteur au carnet.

### E2. Pickpocket : c'est toi qu'on vole (lot 2)

- **Déclenchement** : tu marches dans une foule dense (au moins six passants à moins de 8 m), avec au moins 100 € sur toi.
- **Lieux, heures** : centre, marché (mercredi et vendredi matin, D201), parvis à la sortie de la messe ; 9 h – 20 h. **Poids 1**.
- **Ce qu'on voit et entend** : un passant te **bouscule** (tu es ralenti, D44), un « −80 € » rouge au solde, bulle « Hé ! » au-dessus de
  ta tête ; le pickpocket s'éloigne d'abord au pas, puis court quand tu te retournes vers lui (à moins de 10 m) ou dès que tu cours.
- **Ce que tu peux faire** : le rattraper comme E1 : tu récupères ton argent **plus** ce qu'il avait déjà volé (Q4). Sinon c'est perdu.
- **Prise** : 10 % de ton solde, entre 20 et 200 €.
- **À construire** : rien de neuf après E1 (même fuite, même plaquage), un prélèvement au porte-monnaie.

### E3. Chien échappé (lot 2)

- **Déclenchement** : un promeneur avec son chien (D199) à 30 – 80 m de toi ; la laisse lâche.
- **Lieux, heures** : quartiers d'habitation, parcs, bords de l'Arroux et du Vallon ; 7 h – 20 h, pas sous la pluie. **Poids 2**.
- **Ce qu'on voit et entend** : le chien part au galop (aboiements), la laisse traîne ; le maître lui court après en criant (bulle « Rex ! »
  ou un autre nom, tiré de sa graine) et s'essouffle vite. Le chien zigzague, s'arrête renifler, repart quand on approche à moins de 4 m
  (sauf accroupi, voir plus bas), traverse les rues (les voitures freinent pour lui comme pour un piéton).
- **Ce que tu peux faire** : t'approcher **au pas** (il se laisse approcher, il fuit quelqu'un qui court) et **« Attraper »** (bouton
  contextuel à 1,5 m) ; tu le ramènes en marchant (il te suit en laisse), « Rendre » près du maître : prime (Q4). Si une voiture (la tienne
  ou une autre) heurte le chien, il s'enfuit en boitant et l'événement finit mal (pas de chien tué : Q3).
- **À construire** : chien qui fuit et se laisse approcher (sur la base de `dogs.ts`), chien qui te suit, la circulation qui le voit.

### E4. Accident entre deux voitures (lot 3)

- **Déclenchement** : tu conduis ou tu marches près d'une route avec de la circulation (réglage « Circulation » au-dessus de « Aucune »).
  La scène est **posée hors de vue, sur ton chemin probable** (le trajet vers ton repère s'il y en a un, D310 ; sinon la route devant toi),
  à 80 – 200 m en véhicule, 40 – 120 m à pied.
- **Lieux** : arêtes routières de classe principale à non classée, de préférence près d'un carrefour ; pas dans une rue de moins de 5 m.
- **Heures** : toute la journée ; poids ×2 sous la pluie, sur la neige et dans la brume. **Poids 2**.
- **Ce qu'on voit et entend** : deux voitures de la circulation **de travers**, abîmées (dégâts de D112, capot froissé, fumée parfois),
  **feux de détresse orange** qui clignotent ; les deux conducteurs sont descendus et **se disputent** (gestes amples, bulles « Vous
  m'avez coupé la route ! », « C'est vous qui… ! », voix qui s'emportent) ; quelques **curieux** s'arrêtent sur le trottoir. La
  circulation **bouchonne** derrière (les conducteurs attendent ou doublent, D204), **klaxons**. Au bout d'1 à 2 minutes, une **patrouille
  de gendarmerie** arrive, se gare gyrophares allumés, un gendarme descend vers les conducteurs (constat) ; ensuite les conducteurs
  remontent, les voitures repartent ou restent là jusqu'à ce que tu partes (enlevées hors de vue).
- **Ce que tu peux faire** : regarder, contourner (en voiture, par le contresens), klaxonner (les conducteurs du bouchon t'imitent).
  **Voler** une des voitures accidentées (ses clés sont dessus : vol de véhicule garé, une étoile si la police te voit, D70). Frapper un des
  conducteurs : agression. Pas de prime : c'est un événement de décor (Q4).
- **À construire** : poser des voitures de la circulation à une position et un cap donnés, abîmées et arrêtées pour une durée donnée ;
  feux de détresse (le maillage des gyrophares accepte une couleur par instance, D72) ; conducteurs éjectés et réquisitionnés ;
  poses de dispute ; curieux en demi-cercle (§ 5.1) ; patrouille envoyée sur un point (affaire de police, § 5.3).

### E5. Poursuite entre la police et un autre conducteur (lot 4)

- **Déclenchement** : réglage « Circulation » au-dessus de « Aucune » ; tu n'as **aucune étoile**. Un **fugitif** (voiture rapide : sportive,
  berline, compacte volée) naît hors de vue à 200 – 300 m, avec **une ou deux gendarmeries** 30 – 60 m derrière lui, sur un itinéraire
  choisi pour **passer à moins de 40 m de toi** (A* du graphe routier, D73, vers une arête au-delà de toi).
- **Lieux, heures** : routes principales et secondaires d'abord, puis où la fuite le mène ; plus souvent le soir et la nuit (poids ×2 de
  20 h à 4 h). **Poids 1** (rare, spectaculaire).
- **Ce qu'on voit et entend** : les **sirènes** qui approchent (Doppler, déjà là), le fugitif qui passe très vite, à contresens parfois,
  qui grille les feux, frôle les voitures ; les civils se rangent devant les gendarmes (D73). Les passants sur son chemin s'écartent.
- **Comment ça finit** (sans toi) : tiré au départ, puis laissé à la simulation : **il se crashe** (dégâts, D112 : sa voiture abandonne,
  il sort et fuit à pied, les gendarmes descendent et le rattrapent : mains en l'air, il est emmené), **il est coincé** par les
  gendarmeries et arrêté, ou **il s'échappe** (il distance la police, qui abandonne).
- **Ce que tu peux faire** : **l'arrêter** en le percutant ou en lui barrant la route : quand sa voiture est hors d'usage ou immobilisée
  et qu'il est arrêté, **prime de la gendarmerie** (Q4) ; le plaquer à pied s'il s'enfuit à pied. **Le suivre** pour regarder. **L'aider**
  en percutant la police : c'est l'infraction habituelle (voiture de police percutée, D70), et alors la police s'occupe de toi.
- **À construire** : une cible par voiture en poursuite (`SimCar.target`) ; un **conducteur en fuite** (style poursuite, itinéraire vers un
  but loin de ses poursuivants, recalculé quand ils approchent) ; l'affaire de police qui poursuit un PNJ, fait descendre l'équipage et
  arrête quelqu'un d'autre que toi ; la prime.

### E6. Malaise d'un passant (lot 5)

- **Déclenchement** : un passant à 20 – 60 m, dans ton champ de vision, de préférence âgé (recette) ; plus souvent l'été entre 13 h et
  17 h et au marché. **Poids 1,5**.
- **Ce qu'on voit et entend** : il ralentit, porte la main à sa poitrine, s'effondre (il tombe à genoux puis reste couché, poses de D212) ; deux ou trois
  passants se penchent sur lui, un autre téléphone (pose téléphone, D198) ; bulle « Appelez les secours ! ». **Les pompiers** arrivent au
  bout d'1 min 30 à 2 min (fourgon rouge, sirène deux tons « pin-pon »), se garent, deux pompiers descendent, s'agenouillent, l'aident à
  se relever (ou l'emmènent : il disparaît dans le fourgon), repartent.
- **Ce que tu peux faire** : **« Aider »** (bouton contextuel à 1,5 m) : tu t'agenouilles quelques secondes, il reprend ses esprits et se
  relève avant l'arrivée des pompiers : prime modeste (Q4) et « Merci ». Ou bien regarder, ou bien… le détrousser à terre (il lâche ses
  billets comme un passant mis à terre, D317 : c'est un vol à la vue de tous, une étoile s'il y a un témoin ; Q5).
- **À construire** : pose à genoux ; véhicule de pompiers (une entrée de service du catalogue, carrosserie de la camionnette en rouge avec
  bandes, gyrophares bleus, sirène deux tons) ; affaire « secours » qui envoie un véhicule sur un point ; curieux.

### E7. Rixe (lot 6)

- **Déclenchement** : deux à quatre passants (adultes, pas en tenue de travail) près d'un bar ou d'un restaurant (points d'intérêt de type
  10, D40), à 25 – 70 m.
- **Heures** : 20 h – 3 h, poids ×2 le vendredi et le samedi ; jamais le dimanche matin. **Poids 1**.
- **Ce qu'on voit et entend** : d'abord une **dispute** (gestes, bulles « Qu'est-ce que tu regardes ? »), puis **des coups de poing**
  (poses de mêlée, D81, portées sur les passants), des bousculades, quelqu'un tombe ; les autres passants font cercle à distance ou fuient ;
  au bout de 1 à 2 minutes, une patrouille arrive, les bagarreurs s'enfuient ou sont arrêtés.
- **Ce que tu peux faire** : **les séparer** (t'approcher et toucher l'un d'eux sans frapper : il te repousse et la bagarre se calme,
  Q4), **t'en mêler** (frapper l'un d'eux : agression, comme d'habitude ; ils peuvent se retourner contre toi, aux poings), ou regarder.
- **Violence** : **aux poings seulement** par défaut (Q3), sans sang (D80) ; personne ne meurt de la rixe elle-même.
- **À construire** : poses de coup pour la foule (celles du joueur, D81, sur le squelette des passants) ; dégâts entre PNJ ; affaire de
  police « arrestation à pied » ; PNJ qui s'en prennent à toi.

### E8. Conducteur énervé (lot 7)

- **Déclenchement** : tu accroches une voiture de la circulation à faible vitesse (choc de 1,5 à 5 m/s, `Driver.bump`, D66), ou tu la
  bloques longtemps en klaxonnant ; une fois sur quatre au plus.
- **Ce qu'on voit et entend** : le conducteur s'arrête, klaxonne longuement, **descend** et marche vers toi en gesticulant (bulle « Non mais
  ça va pas ?! ») ; si tu es à pied et que tu restes, il te bouscule ; si tu repars, il remonte et te suit un moment en klaxonnant.
- **Ce que tu peux faire** : partir, t'excuser (rester immobile près de lui : il finit par repartir), ou le frapper (agression).
- **À construire** : rien de neuf après E4 et E7 (descendre, marcher vers toi, bousculer).

### E9. Livreur pressé (lot 7)

- **Déclenchement** : une camionnette de livraison de la circulation (D204) passe en « pressé » : conduite de poursuite sans contresens,
  grille un feu orange, double, klaxonne, puis s'arrête net en double file ; le livreur court porter un colis et revient en courant.
- **Heures** : 6 h – 11 h, lundi au samedi, centre. **Poids 1**.
- **Ce que tu peux faire** : rien de particulier (décor), sauf que la camionnette arrêtée moteur tournant **se vole** facilement, et qu'il
  peut **causer un accident** (enchaîne sur E10).

### E10. Accident en direct (lot 7)

- **Déclenchement** : un carrefour à feux devant toi (40 – 120 m) avec une voiture qui arrive au vert sur l'axe croisé ; un conducteur de
  ton côté devient « imprudent » et grille le rouge en accélérant, calé pour arriver au carrefour au même moment que l'autre.
- **Ce qu'on voit et entend** : le **choc** en direct (physique réelle des voitures, D60, dégâts D112, son de choc violent, éventuellement
  fumée), puis la suite d'E4 (détresse, dispute, curieux, bouchon, patrouille).
- **Risque** : le choc n'est pas garanti (la physique décide) ; s'il n'a pas lieu, c'est un simple feu grillé (le plaisir reste). À
  mesurer : la proportion de chocs réussis sur les vraies données.

### E11. Cortège de mariage (lot 8)

- **Déclenchement** : le samedi, de 14 h à 18 h, devant l'hôtel de ville (place du Champ de Mars) ; tu es à moins de 300 m.
- **Ce qu'on voit et entend** : des invités sur le parvis de la mairie (foule habillée), applaudissements et cris de joie à la sortie des
  mariés, puis **un cortège de quatre à six voitures** (la première blanche) qui part en **klaxonnant sans arrêt**, au pas, en ville.
- **Ce que tu peux faire** : regarder, suivre le cortège en klaxonnant (les voitures te répondent), ou… voler la voiture des mariés.
- **À construire** : un convoi de voitures qui se suivent (itinéraire commun), des passants « invités » (tenues de soirée : à voir avec les
  recettes existantes), confettis (le maillage des effets, D84). Écart possible : pas de vrais mariés distincts.

### E12. Feu de poubelle (lot 8)

- **Déclenchement** : une poubelle ou un conteneur du mobilier (tuiles) à 30 – 100 m prend feu ; le soir et la nuit. **Poids 0,7**.
- **Ce qu'on voit et entend** : flammes et fumée (ceux des voitures en feu, D112), passants qui regardent, les pompiers arrivent (E6) et
  l'éteignent.
- **Ce que tu peux faire** : regarder ; t'approcher trop près te brûle (comme une voiture en feu). Pas de prime.

### E13. Braquage d'un commerce (lot 9, seulement si tu le veux)

- **Déclenchement** : un commerce ouvert (tabac, supérette, station-service, D200 et D322) à 30 – 100 m, de 19 h à 23 h. **Poids 0,5**.
- **Ce qu'on voit et entend** : un homme cagoulé (bonnet sombre) sort en courant du commerce, **pistolet à la main**, le commerçant sort
  derrière lui en criant ; une alarme sonne ; le braqueur s'enfuit à pied (ou monte dans une voiture qui l'attend : enchaîne sur E5).
- **Ce que tu peux faire** : le poursuivre, le plaquer, le désarmer (il lâche son arme : ramassable) ; **il tire sur toi** si tu le
  menaces d'une arme ou si tu le rattrapes de face (Q3) ; prime plus forte.
- **Violence** : c'est le seul événement où un PNJ te tire dessus. À ton accord (Q3).

## 4. Le directeur d'événements

### Rythme (réglage « Événements », § 6)

- **Taux de base** à « Normaux » : **un événement qui démarre toutes les 3 minutes réelles en moyenne** quand tu es au centre en
  journée (soit 6 à 7 par journée de jeu de 20 minutes), au hasard (loi exponentielle), avec **au moins 60 s entre deux départs** et 45 s
  après la fin du précédent.
- **Multiplicateurs** : zone (centre 1 ; résidentiel 0,6 ; périphérie 0,35 ; nature 0,25, comme `crowdDensity`, D43) ; heure (0 h – 6 h
  0,4 et seulement les événements de nuit ; 7 h – 22 h 1 ; 22 h – 24 h 0,7) ; réglage (Rares 0,4 ; Normaux 1 ; Fréquents 2,5).
- **Pas d'événement** : dans les 60 premières secondes après un chargement, une mort ou une arrestation ; **quand tu as une étoile ou plus**
  (la police a autre chose à faire, toi aussi) ; dans un magasin, au menu, à la nage, sur un toit (sauf ceux qu'on voit d'en haut : accident,
  poursuite).
- **Variété** : un même événement ne revient pas avant 8 minutes réelles (5 en « Fréquents »), jamais deux fois de suite ; le tirage est
  pondéré par les poids du catalogue, multipliés par l'heure, le jour, la météo et le lieu de chaque fiche.
- **Un grand et un petit au plus** en même temps (un grand : accident, poursuite, rixe, braquage, cortège).

### Comment il choisit (logique pure, testable sans écran)

1. Toutes les 2 s, il tire s'il faut lancer quelque chose (taux ci-dessus).
2. Il liste les événements possibles maintenant (heure, jour, météo, réglages « Foule » et « Circulation », toi à pied ou au volant, ta
   vitesse), et pour chacun **cherche un lieu** (`findSite`) : passants candidats, arête routière sur ton chemin, point d'intérêt (bar,
   commerce, arrêt de bus), dans les bonnes distances, hors de la vue de la police pour un crime. Un événement sans lieu est écarté.
3. Il tire parmi ceux qui restent, selon leurs poids. **Graine** : graine de la partie et numéro d'événement (essais reproductibles).
4. L'événement démarre ; c'est une **machine à états** (préparation hors de vue, déclenchement, déroulement, dénouement, nettoyage) qui
   parle au monde par une interface étroite (`EventWorld`, § 5.4).
5. **Fin** : dénouement atteint, ou toi à plus de 250 m pendant 20 s, ou durée maximale (2 à 5 min selon l'événement). Le nettoyage rend
   les passants à la foule et retire les voitures posées **hors de ta vue** (règle de D64).

### Journal

Le directeur garde le **journal du jour** (heure, événement, rue, issue : « 15 h 20, rue aux Cordiers : vol à l'arraché, voleur rattrapé »).
Il sert au carnet (onglet « Faits divers ») et servira au **flash info de la radio** (phase 5). Les noms de rue viennent des données de la
carte (`ui/map-data.ts`).

## 5. Architecture

### 5.1 Passants : réquisition, fuite volontaire, ordres

- **Réquisition** (`PedSim.borrow(slot)`, `release(slot)`) : le directeur prend un passant **déjà là** (pas de naissance visible) ; la
  simulation ne le fait plus flâner, s'asseoir ni disparaître (ni par la couronne, ni par le surnombre), mais garde pour lui l'évitement,
  les collisions, les chocs, la santé, les alarmes et la police. Rendu, il rejoint sa file sans saut (D213). **Quelques emplacements au
  plus** (8) sont réquisitionnés en même temps.
- **Ordres** (sur un passant réquisitionné) :
  - **fuir** quelqu'un (`flee(slot, menace)`) : course sur le graphe piéton ; à chaque bout d'arête il **choisit la suite qui l'éloigne le
    plus de la menace**, en regardant deux arêtes plus loin (pour ne pas s'enfermer dans une impasse), traverse hors des passages, bouscule
    ceux qu'il croise ; endurance (vitesse qui baisse avec le temps). La menace est une position qui bouge (toi, un gendarme, un chien).
    **Cette fuite remplace aussi la panique actuelle** (`panic`, D71, D83) : un passant effrayé fuit vraiment la scène au lieu de seulement
    retourner sa file une fois (à mesurer sur les tests d'alarme de D83 : « au plus un quart se rapprochent »).
  - **suivre** quelqu'un (`follow(slot, cible, écart)`) : pour le voleur qui approche sa victime, le maître qui court après son chien,
    le bagarreur qui va vers l'autre ; sur le graphe (itinéraire piéton de D310, `pedGuide`) puis en ligne droite à moins de 10 m.
  - **aller à** un point, **tenir une pose** face à quelqu'un (discuter, se disputer, se battre, à genoux, mains en l'air, montrer du bras,
    téléphoner), **dire** une bulle.
  - **curieux** : `gather(x, y, n, rayon)` fait venir n passants proches en demi-cercle autour d'une scène, à 3 – 6 m, qui regardent
    (tête tournée, D198), puis repartent ; ce n'est pas une réquisition (ils restent des passants ordinaires, un état « regarde »).
- **Poses nouvelles** (`character-pose.ts`, `CrowdRigs.solve`) : dispute (gestes plus amples que `talkPose`), coup de poing (celles du
  joueur, D81, adaptées au squelette des passants), à genoux, mains en l'air, bras tendu, main sur la poitrine. Même coût que la marche.
- **Sac** : la recette du voleur reçoit le sac de la victime et la victime le perd (`rigs.assign`, l'emplacement se rhabille sans
  réallouer, D42) ; au sol, le sac est un objet ramassable du maillage des armes au sol (D84, 0 appel de dessin s'il y a déjà un objet).

### 5.2 Circulation : une cible par poursuivant, un conducteur en fuite, des scènes posées

- **Cible par voiture** : `SimCar.target` (une `ChaseTarget` ou une autre `SimCar`) ; sans cible propre, la règle d'aujourd'hui (le joueur
  ou le point de fouille). Les places autour de la cible (D79) se comptent par cible.
- **Conducteur en fuite** (`Flight`, à côté de `Chaser`) : style poursuite (D73), but tiré loin de ses poursuivants (300 – 600 m, du côté
  opposé), recalculé quand l'un d'eux se rapproche à moins de 30 m ou qu'il atteint son but ; marche arrière pour se dégager comme le
  `Chaser`. Trop abîmé (D112), il s'arrête, **sort et fuit à pied** (éjection de D71, puis `flee`).
- **Scène posée** (`Traffic.stage`) : une voiture du modèle voulu, à une position et un cap donnés, abîmée d'un côté, arrêtée pour une
  durée donnée (`holdT`, D204), feux de détresse ; née hors de ta vue (règles de D64) ; retirée hors de vue à la fin.
- **Feux de détresse** : instances orange clignotantes dans le maillage des gyrophares (il prend une couleur par instance, D72) : **0 appel
  de plus** quand une voiture de police est déjà là, +1 sinon.
- **Ce que voient les conducteurs** : un chien ou un passant réquisitionné sur la route est un obstacle comme un autre (déjà le cas pour les
  passants, D63 ; à faire pour le chien).

### 5.3 Police : des affaires à côté des étoiles

- **Affaire** : « poursuivre telle voiture », « arrêter telle personne à pied », « constater sur tel point », « secourir sur tel point »
  (pompiers). `PoliceController` garde ses étoiles et sa poursuite du joueur ; il gère en plus une liste d'affaires, chacune avec ses
  voitures (une à deux), qui naissent hors de vue comme les renforts (D74) et **comptent dans le plafond de la circulation** (des civils
  partent d'autant : la parade de D76 contre les appels de dessin).
- **Gendarmes à pied pour un PNJ** : `Officers` accepte une cible par gendarme (un `Suspect` qui peut être un passant réquisitionné) ;
  l'arrestation d'un PNJ : mains en l'air, le gendarme le mène à la voiture, tous deux disparaissent en y montant.
- **Priorité** : si tu prends des étoiles pendant une affaire, les voitures de l'affaire continuent la leur, les renforts viennent pour toi
  comme aujourd'hui ; si tu percutes une voiture d'une affaire, c'est l'infraction habituelle et elle passe sur toi.
- **Ce que la police ne fait pas** : tirer sur un PNJ (Q3).

### 5.4 Le directeur dans le jeu

- **Logique pure** (`src/core/events/`) : `director.ts` (taux, tirage, plafonds, journal), une machine à états par événement
  (`snatch.ts`, `accident.ts`, `pursuit.ts`…), et l'interface `EventWorld` qu'elles utilisent (passants, circulation, police, sons, bulles,
  porte-monnaie, carnet). Les essais sans écran donnent un faux `EventWorld` ou le vrai, branché sur les vraies données (comme
  `police-soak.test.ts`).
- **Contrôleur** (`src/game/events.ts`, `EventsController`) : branche le vrai monde (`PedsController`, `Traffic`, `PoliceController`,
  `AudioSystem`, interface), avance dans la boucle après la circulation et les passants, est figé par la pause (temps du jeu, donc ralenti
  par le ralenti des sauts, D311). `game.ts` ne fait que l'appeler.
- **Interface** : bulles de parole (`src/ui/speech.ts` : un ou deux éléments DOM au plus, placés par projection, style « affiche » : fond
  crème, liseré sombre, texte court ; flèche au bord de l'écran si la scène est hors champ) ; repère « ! » ocre et point rouge du fuyard sur
  la minimap et la carte agrandie ; bouton contextuel (« Rendre le sac », « Attraper », « Aider ») à la place de « Ramasser » ; bandeau
  d'exploit (« Voleur rattrapé · +180 € »).
- **Sons** : cris et chocs existants ; **nouveaux** : sirène deux tons des pompiers, dispute (salve de syllabes synthétisées, montante),
  applaudissements et klaxons de cortège, alarme de commerce ; ajoutés à la page `?sounds` et à `tools/sounds.sh`.
- **Sauvegarde** : rien d'un événement en cours (comme la circulation) ; les compteurs et le journal du carnet dans la version 6 (champs
  facultatifs, D319).

### 5.5 Budget de coût

- **Appels de dessin** (règle de D65 et D78 : le plafond de 200 est atteint la nuit en « Dense » avec une poursuite) : un événement à pied,
  **0** (passants réquisitionnés, sac dans le maillage des armes au sol) ; chien échappé, **0 à +2** (chiens et laisses, s'il n'y en avait
  pas) ; accident, **0 à +1** (détresse) ; police ou pompiers, **+2 par modèle absent** (gendarmerie, fourgon) et **+1** pour les gyrophares,
  soit **+3 au plus**, comme une poursuite du joueur. La parade reste celle de D76 : les voitures d'une affaire prennent la place de civils.
- **Processeur** : directeur < 0,05 ms par image (un tirage toutes les 2 s, une recherche de lieu bornée) ; un événement < 0,2 ms (quelques
  passants et voitures déjà simulés ; un itinéraire A* de plus toutes les 1,5 s pour un fuyard, < 2 ms sur PC, D73, étalé) ; bulles : DOM
  touché seulement aux changements, position chaque image (deux éléments).
- **Mesure** : `?bench=1&…&events=1` (le banc force un événement à chaque arrêt : vol au premier, accident au deuxième, poursuite qui croise
  le trajet à 50 km/h) ; ligne « Événements : actifs, passants réquisitionnés, voitures, coût » ; **endurance sans écran**
  (`src/game/events-soak.test.ts`, piège 8) : dix minutes en « Fréquents », un joueur qui se promène et un robot qui rattrape les voleurs,
  avec la vraie circulation, la vraie foule et la vraie police ; invariants : tout passant réquisitionné est rendu, toute voiture posée est
  retirée, jamais plus de 8 passants réquisitionnés ni plus de voitures de police que le plafond, rien de non fini, journal cohérent ;
  et les endurances existantes (police, combat) inchangées.

## 6. Réglages et essais

- **Réglage « Événements »** (menu pause, comme « Foule ») : Aucun, Rares, Normaux (défaut), Fréquents.
- `?events=0|1|2|3` impose le réglage ; **`?event=vol`** (ou `pickpocket`, `chien`, `accident`, `poursuite`, `malaise`, `rixe`…) lance cet
  événement tout de suite près de toi (essais, captures) ; `?debug` ajoute une ligne (événements actifs, prochain tirage, réquisitionnés).
- **Captures** : `tools/ui.sh <dossier> <événement>` pour chacun, au format téléphone paysage.

## 7. Lots (une décision et un commit par lot, jouable à chaque fois)

1. **Socle et vol à l'arraché (E1)** : directeur, réglage, réquisition, fuite volontaire (et la panique qui l'utilise), plaquage, sac,
   bulles, repère, prime, compteur du carnet, journal ; endurance sans écran ; banc `&events=1` (vol). *Le plus gros lot : il pose tout le
   côté « à pied ».*
2. **Pickpocket (E2) et chien échappé (E3)** : deux petits événements qui réutilisent le lot 1 (variété rapide).
3. **Accident (E4)** : scènes posées, feux de détresse, conducteurs qui descendent et se disputent, curieux, bouchon, patrouille qui
   constate (première affaire de police).
4. **Poursuite police contre conducteur (E5)** : cible par poursuivant, conducteur en fuite, arrestation d'un PNJ, prime ; endurance de la
   police rejouée avec une affaire en cours.
5. **Malaise et pompiers (E6)** : pose à genoux, « Aider », fourgon de pompiers et sa sirène, affaire « secours ».
6. **Rixe (E7)** : poses de coup pour la foule, dégâts entre PNJ, police qui arrête à pied.
7. **Conducteur énervé (E8), livreur pressé (E9), accident en direct (E10)** : des comportements de conducteurs.
8. **Cortège de mariage (E11) et feu de poubelle (E12)** : des événements sans crime.
9. **Braquage (E13)**, seulement si tu le veux (Q3).
10. **Bilan** : onglet « Faits divers » complet, défis, réglage des fréquences d'après tes parties, banc complet, protocole de mesure sur le
    téléphone, PR de la phase.

Chaque lot : captures avant / après au format téléphone, une décision dans `docs/DECISIONS.md` (à partir de D328), l'avancement dans
`PROGRESS.md`, la feuille de route à jour, `npm run typecheck && npm run lint && npm test && npm run build` (et `--mode domothib`).

## 8. Risques

- **La simulation des passants** (`pedestrians.ts`, 1 760 lignes, beaucoup d'états) : la réquisition et la fuite touchent son cœur. Les
  endurances de combat et de police (D82, D86, D76) et leurs graines réglées (D212) peuvent bouger ; les tests d'alarme de D83 aussi
  si la fuite volontaire remplace la panique. Je les ferai tourner à chaque étape et je dirai ce qui change.
- **Lisibilité sur un petit écran** : un vol à 40 m, c'est un personnage de 30 pixels. D'où la bulle, la flèche au bord, le cri, le repère.
  À juger sur le téléphone dès le lot 1 ; si ce n'est pas assez, on rapproche les distances.
- **Répétition** : six ou sept événements par journée de jeu, c'est vite trop si les mêmes reviennent. D'où les délais par type, la variété
  des lieux et des textes ; à régler en jouant (c'est le premier réglage à juger).
- **Ce qui ne se met pas en scène** : un choc en direct (E10) ou le dénouement d'une poursuite (E5) dépendent de la physique ; il faut
  accepter qu'ils ratent parfois, et mesurer combien.
- **Appels de dessin la nuit en « Dense »** : un événement de police s'ajoute au plafond (+3) ; parade connue (D76).
- **Conducteurs invisibles** : on ne les voit pas sortir, ils apparaissent à la portière (D71). Les vitres « en grille » (D72) restent une
  piste à part, pas dans cette phase.
- **Cohabitation** : marché, fêtes, terrasses, passage Balthus, théâtre, toits, nage, magasins (en pause) ; un événement ne démarre pas là où
  il gênerait (étals, scène de la fête de la musique) et s'arrête proprement si tu meurs, si tu es arrêté ou si tu changes la foule.

## 9. Questions (réponse par défaut entre crochets : « ok » suffit)

**Réponses de l'utilisateur (25 novembre 2026)** : « ok » pour toutes. Caserne des pompiers (Q9) : captures Google Maps fournies ; c'est le
**centre d'incendie et de secours** de l'avenue André Frenaud, à ≈ 110 m au sud-est du rond-point de la route de Beaune, retrouvé dans les
données : bâtiment BD TOPO à (1 602 ; 720), à 275 m au nord-ouest de la gendarmerie (D238). Les pompiers en partiront quand elle est hors
de ta vue (lot 5). Rythme : deux lots, puis une pause.

1. **Premier lot** : [le socle avec le **vol à l'arraché** (E1)]. Ensuite, dans l'ordre du § 7 : [pickpocket et chien, accident, poursuite,
   malaise, rixe, conducteurs, mariage et feu de poubelle, braquage, bilan]. Autre choix possible pour démarrer : l'**accident** (plus
   spectaculaire en voiture, mais il pose d'abord la circulation et laisse le joueur spectateur).
2. **Fréquence** : [« Normaux » par défaut : un départ toutes les 3 minutes en moyenne au centre en journée, au moins 60 s entre deux,
   moins en périphérie et la nuit ; jamais quand tu as une étoile ; un grand et un petit au plus ; même événement pas avant 8 minutes].
   Réglage « Événements » : [Aucun, Rares (×0,4), Normaux, Fréquents (×2,5)].
3. **Violence** : [rixe **aux poings** seulement, sans sang (D80), personne n'y meurt ; la police ne tire jamais sur un PNJ ; chien blessé
   qui s'enfuit en boitant, jamais tué ; **braquage armé** (un PNJ qui te tire dessus) en dernier, **seulement si tu dis oui**]. Veux-tu des
   couteaux dans les rixes, des fusillades entre PNJ ?
4. **Récompenses** (passent par le porte-monnaie et le bandeau d'exploit, D317, D311) :
   [voleur rattrapé et **sac rendu : 100 à 250 €** ; **sac gardé** : son contenu, 30 à 120 €, et la victime crie au voleur si elle te voit
   (une étoile si un témoin, comme un vol) ; pickpocket rattrapé : ton argent **+ 50 €** (ce qu'il avait déjà pris) ; chien rendu **60 à
   120 €** ; malaise secouru **80 €** ; rixe séparée **50 €** ; fugitif arrêté grâce à toi **500 €** (« prime de la gendarmerie ») ;
   braqueur arrêté **800 €** ; accident, mariage, feu de poubelle, livreur : rien (décor)].
   Carnet : [onglet **« Faits divers »** : le journal du jour et les comptes par événement ; trois défis à paliers : **voleurs rattrapés
   1 / 5 / 15**, **fugitifs arrêtés 1 / 3 / 8**, **bonnes actions** (toutes confondues) **5 / 20 / 50**, primes des défis de D319].
5. **Ce qui est permis** : [plaquer, frapper ou renverser un voleur, un pickpocket ou un fugitif **en fuite** n'est pas une infraction ; le
   tuer reste un meurtre ; tirer reste un coup de feu en public ; percuter la voiture d'un fugitif n'est pas une infraction, percuter la
   police l'est ; détrousser quelqu'un à terre est un vol (une étoile avec un témoin)].
6. **Rattraper** : [toucher le fuyard en **sprint le plaque** ; un coup le fait tomber aussi ; en véhicule, le renverser ; le butin tombe au
   sol et se ramasse en marchant dessus ; la victime attend 2 minutes là où elle a été volée].
7. **Lisibilité** : [**bulle de parole** au-dessus de la tête (2 à 4 mots, style affiche) + cri, flèche au bord de l'écran si c'est hors
   champ, repère « ! » sur la minimap] ; **pas de voix de synthèse** du navigateur dans cette phase (elle sonne mal et sera essayée pour le
   flash info de la radio, phase 5). D'accord ?
8. **Le joueur comme cible** : [oui pour le pickpocket (E2) et le conducteur énervé (E8) ; **jamais** de vol de ton véhicule ni d'agression
   gratuite contre toi].
9. **Pompiers** : [fourgon rouge à bande blanche (camionnette repeinte), sirène deux tons ; ils naissent hors de vue comme la police (la
   caserne n'est pas dans les données)]. Sais-tu où est le centre de secours d'Autun ? (on pourrait les faire partir de là plus tard.)
10. **Événements heureux** : [cortège de mariage le samedi à la mairie, feu de poubelle] ; d'autres idées te plaisent ? (musicien de rue
    hors fête de la musique, brocante, course cycliste, livraison d'un piano…)
11. **Police et événements** : [une patrouille vient constater un accident, arrêter des bagarreurs, poursuivre un fugitif ; ses voitures
    comptent dans le plafond de la circulation ; pas d'événement de police pendant que tu as des étoiles].
12. **Sans circulation ni foule** : [« Circulation : Aucune » coupe les événements de voitures (accident, poursuite, livreur, mariage) ;
    « Foule : Aucune » coupe ceux à pied ; la police continue de se créer sa circulation pour toi seulement (D74)].
