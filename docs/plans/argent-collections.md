# Plaisir de jeu, phase 3 : argent et collections

Chantier « PJ » de `docs/ROADMAP.md`, phase 3 (24 novembre 2026). Plan court ; les questions et les réponses proposées par défaut sont
en fin de fichier. Rien n'est codé avant les réponses.

## 1. Ce qui existe et ce que ça change

- **Tout s'obtient déjà gratuitement** : on vole n'importe quel véhicule (D50, D75), 14 caches d'armes réapparaissent toutes les 5 min
  (D84, D207), les croix vertes des pharmacies et des hôpitaux rendent toute la santé (D159, D161), les garages réparent gratuitement
  (D113). **Acheter n'a de sens que si l'achat donne ce que le vol ne donne pas** : c'est le point le plus important du plan (§ 4).
- Santé : régénération jusqu'à 50 PV seulement (D80) ; au-delà, il faut un soin. La nourriture a donc une vraie place.
- Mort : réveil à l'hôpital le plus proche 3 h plus tard, armes perdues. Arrestation : 6 h en cellule, armes perdues, véhicule
  conduit confisqué (D75, D80, D238). Rien ne coûte d'argent aujourd'hui.
- Records : clé à part `autun3d.records`, survivent à une nouvelle partie (D312). Bandeau d'exploit au centre (D311).
- Commerces : 199 dans `map/places.json` avec un genre OpenStreetMap, douze horaires types (D200, `core/opening.ts`).
- Sauvegarde : `SAVE_VERSION = 5`, lue avec méfiance, anciennes versions migrées (D35, D84, D194) ; dans DomoThib, sur le serveur (D305).

## 2. L'argent (socle)

- Un **porte-monnaie** en euros (`core/wallet.ts`, logique pure) : solde entier, gains et dépenses nommés (pour le bandeau et les tests).
- **À l'écran** : le solde sous l'horloge, à gauche (la zone du haut au centre est pleine : santé, arme, étoiles) ; un « +250 € » qui
  monte à chaque gain, un « −30 € » rouge à chaque dépense.
- **Gains** (chiffres en § 6) : découvertes (monuments, objets cachés), paliers de records (« défis »), portefeuilles des passants mis à
  terre. Pas de petits boulots ; les événements de la phase 4 s'y brancheront.
- **Dépenses** : véhicules, armes et munitions, nourriture et soins, réparations au garage, et ce que coûtent la mort et l'arrestation.

## 3. Les collections (système commun)

- **Un carnet** (`core/collections.ts`) : des collections faites d'entrées (identifiant stable, position, rayon, récompense), chacune
  « à trouver » ou « trouvée » (avec la date du jeu). Une récompense par entrée, un bonus quand la collection est complète.
- **Découverte** : un même déclencheur pour tout (entrer dans une zone, voir § 7, Q11) ; bandeau d'exploit « Découverte : Porte
  d'Arroux · +600 € », son, vibration ; pour un monument, un bouton « Lire la fiche » pendant quelques secondes (ouvre le carnet en pause).
- **Écran « 📖 Carnet »** dans le menu pause, à onglets : Monuments (fiches), Objets cachés (par quartier), Défis (paliers des records).
- Trois collections dans cette phase :
  1. **Chasse aux monuments** : 20 monuments (liste § 7, Q9), fiche historique courte et sourcée chacun.
  2. **Objets cachés sur les toits** : 30 objets (thème § 7, Q10), tous atteignables par l'escalade et le saut long (D218), vérifié par test.
  3. **Défis** : trois paliers (bronze, argent, or) par record du carnet de D312 ; on touche la prime en franchissant le palier.

## 4. Où et comment on achète

- **Comptoir** : chaque magasin est un point devant son entrée (vraie adresse, d'après OpenStreetMap) ; à moins de 3 m, à pied, un bouton
  rond « Entrer » (comme « Monter ») ouvre un **écran d'achat** qui met le jeu en pause : liste, prix, solde, bouton « Acheter ». Fermé :
  le bouton dit « Fermé · ouvre à 9 h 30 » (horaires de D200). Le magasin apparaît sur la minimap et la carte avec un pictogramme.
- **Véhicules** (ce que le vol ne donne pas) : un véhicule acheté est **à toi** : le prendre n'appelle pas la police, il n'est jamais
  oublié (exception à D301), il garde sa couleur (choisie à l'achat), **il revient chez le concessionnaire s'il est détruit**
  (assurance), et « Mes véhicules » (carnet ou carte) montre où il est. Concessionnaires réels : Dacia Autun (groupe Thivolle) et Peugeot
  pour les voitures et les motos ; Cycles Tacnet et Morvan Bike pour les vélos et la trottinette. Véhicules uniques et de service : pas à
  vendre (ils restent à trouver).
- **Armes** : deux magasins, « James » (armes de poing et d'épaule, munitions) et le Surplus Éduen (armes de guerre, grenades et
  équipement ; à préciser). Les caches deviennent des trouvailles uniques (Q7).
- **Nourriture** (soin immédiat, pas d'inventaire) : boulangeries, cafés, bars, restauration rapide (McDonald's compris), supérettes,
  supermarchés, stations-service, chacun avec ses horaires. **Pharmacies** : soin complet payant ; **hôpitaux** : gratuits (urgences).
- **Garages** : réparation payante, selon les dégâts.

## 5. Mort, arrestation, sauvegarde

- **Mort** : facture de l'hôpital ; on garde ses armes (changement de D80 : maintenant qu'elles coûtent, les perdre serait trop dur).
- **Arrestation** : amende, armes confisquées (comme aujourd'hui) ; un véhicule à toi confisqué part à la fourrière de la gendarmerie, à
  récupérer contre paiement.
- **Sauvegarde en version 6** : solde, véhicules possédés (modèle, couleur, état), carnet (entrées trouvées), défis touchés. Les
  versions 1 à 5 sont migrées avec 0 €, rien de trouvé. Tout cela appartient à la **partie** (une nouvelle partie repart de zéro) ;
  les records restent à part (D312). Quelques centaines d'octets de plus, sans effet sur le quota de DomoThib.

## 6. Échelle proposée (par défaut)

Euros, prix « à la française » mais resserrés : finir les collections paie une belle voiture, pas la sportive.

| Gains | | Dépenses | |
|---|---|---|---|
| Monument (petit / grand) | 300 / 600 € | Vélo, trottinette, VTT | 200 / 300 / 450 € |
| Tous les monuments | +5 000 € | Scooter 125, moto routière, sportive | 2 000 / 6 000 / 11 000 € |
| Objet caché | 150 € | Vieille voiture, citadine, compacte | 3 500 / 6 000 / 9 000 € |
| Tous les objets cachés | +5 000 € | Camionnette, berline, break, petit SUV | 12 000 / 13 000 / 13 000 / 16 000 € |
| Défi bronze / argent / or | 100 / 300 / 800 € | Sportive | 30 000 € |
| Portefeuille d'un passant | 5 à 40 € (1 fois sur 3) | Batte, couteau | 30 / 40 € |
| | | Pistolet, fusil à pompe | 400 / 900 € |
| | | Fusil d'assaut, de précision | 2 500 / 3 500 € |
| | | Munitions (un chargeur) | 30 à 80 € |
| | | Café, viennoiserie | 2 € (+5 PV) |
| | | Sandwich, kebab, menu | 7 € (+35) / 11 € (+60) |
| | | Repas au restaurant, pharmacie | 25 € / 30 € (santé pleine) |
| | | Réparation au garage | 50 à 800 € |
| | | Mort (facture de l'hôpital) | 10 %, 1 000 € au plus |
| | | Arrestation (amende), fourrière | 15 %, 2 500 € au plus ; 300 € |

Ordre de grandeur : monuments ≈ 14 600 € (bonus compris), objets ≈ 9 500 €, défis ≈ 10 800 €, soit ≈ 35 000 € pour tout finir.

## 7. Questions (réponse par défaut entre crochets)

**Réponses de l'utilisateur (24 novembre 2026)** : « ok » pour toutes les réponses par défaut, sauf la 4 : **deux magasins
d'armes**, « James » (chasse, à 200 m au sud de la mairie) pour les armes du genre pistolet, mitraillette, etc., et le **Surplus
Éduen** (3 avenue Charles-de-Gaulle, devanture déjà dessinée d'après photo, D183) pour quelques armes de guerre et des grenades « ou
autres ». Le 25 novembre : « ok » pour les réponses par défaut du lot 7 (James : pistolet, fusil à pompe, fusil de précision, pistolet-mitrailleur ; Surplus : couteau, batte, fusil d'assaut, mitrailleuse, grenades, gilet pare-balles, fumigènes ; la grenade se lance au bouton d'attaque ; caches uniques comptées au carnet). Décisions : D317 et suivantes.

1. **Échelle** : [euros, tableau du § 6].
2. **Ce que donne un véhicule acheté** : [à toi : pas d'étoile en le prenant, jamais oublié, couleur choisie, revient chez le
   concessionnaire s'il est détruit (une heure de jeu plus tard) ; six au plus ; livré devant le magasin].
3. **Où acheter les véhicules** : [voitures et motos chez Dacia Autun (Thivolle, Bellevue) et Peugeot (nord) ; vélos, VTT et trottinette
   chez Cycles Tacnet et Morvan Bike ; véhicules uniques et de service pas à vendre].
4. **Armurerie** : [« James », classé chasse dans OpenStreetMap, à 200 m au sud de la mairie] : c'est bien une armurerie ? Sinon, où ?
5. **Écran d'achat et horaires** : [bouton « Entrer » à 3 m, à pied ; écran en pause ; horaires de D200 : concessionnaires et armurerie
   aux heures des boutiques (fermés le dimanche), nourriture selon le genre, stations-service 6 h-22 h ; pictogrammes sur les cartes].
6. **Gains sans violence** une fois les collections finies : [rien de plus dans cette phase, la phase 4 en apportera] ; ou revendre une
   voiture volée à un garage (une par jour de jeu et par garage).
7. **Caches d'armes** : [elles ne réapparaissent plus : trouvailles uniques, comptées dans le carnet sans prime ; l'armurerie devient la
   source des armes et des munitions] ; ou les garder telles quelles.
8. **Mort et arrestation** : [mort : 10 % du solde (1 000 € au plus), armes gardées ; arrestation : 15 % (2 500 € au plus), armes
   confisquées, véhicule à toi à la fourrière (300 €) ; sans argent, pas de dette].
9. **Monuments retenus** (20) : [**grands, 600 €** : cathédrale Saint-Lazare, porte d'Arroux, porte Saint-André, théâtre romain, temple
   de Janus, Pierre de Couhard, hôtel de ville, théâtre municipal, Lycée militaire, tour des Ursulines et remparts, Croix de la
   Libération, gare ; **petits, 300 €** : monument aux morts, fontaine Saint-Lazare, lycée Bonaparte (ancien collège des Jésuites), tour
   de l'Horloge, pseudo-temple d'Apollon, prison panoptique, hôtel du Chancelier Rolin (musée Rolin), terrils des Télots]. À retirer ou
   ajouter ?
10. **Objets cachés** : [30 statères d'or éduens, « le trésor d'un faussaire » : une pièce d'or qui tourne et brille, un tintement à
    moins de 25 m ; 12 dans le centre, 18 ailleurs ; un tiers faciles (annexe basse), un tiers de toit à toit, un tiers difficiles
    (sauts longs) ; pas sur la carte, le carnet donne le compte par quartier]. Autres thèmes possibles : chats perchés qui miaulent,
    gargouilles, nids de cigognes.
11. **Déclenchement** : [monument : entrer dans une zone autour d'un point de vue (20 à 40 m selon sa taille), à pied ou en véhicule ;
    objet : le toucher (1,2 m) ; monuments à découvrir en « ? » gris sur la carte agrandie, en couleur une fois trouvés].
12. **Fiches** : [600 caractères au plus, une phrase « Le savais-tu ? », la ou les sources ; pas d'image ; textes dans
    `docs/fiches-monuments.md` pour ta relecture avant de les mettre dans le jeu].
13. **Argent à l'écran** : [sous l'horloge, toujours visible ; « +250 € » qui monte à chaque gain].
14. **Sauvegarde** : [version 6, tout dans la partie, records à part ; les défis se touchent en franchissant le palier pendant la partie,
    pas d'après les records d'avant].
15. **Paliers des défis** (bronze / argent / or) : [saut 25 / 50 / 100 m ; vitesse 120 / 180 / 250 km/h ; roue arrière 50 / 150 /
    400 m ; roue avant 10 / 30 / 80 m ; dérapage 30 / 80 / 200 m ; 3 étoiles 1 / 3 / 6 min ; 5 étoiles 30 s / 1 min 30 / 3 min ; à pied
    5 / 25 / 100 km ; en véhicule 20 / 100 / 500 km].
16. **Garages** : [réparation payante, 50 à 800 € selon les dégâts ; pas d'argent, pas de réparation].
17. **Menu pause** : [« Records » devient un onglet du Carnet : le menu garde huit entrées].

## 8. Lots (une décision et un commit par lot)

1. **Socle** : porte-monnaie, affichage, sauvegarde v6, mort et arrestation payantes, portefeuilles des passants, réparation payante.
2. **Fiches des monuments, texte seul** (`docs/fiches-monuments.md`) : tôt, pour que tu les relises pendant que je code la suite.
3. **Carnet et défis** : système commun, écran « Carnet », paliers des records.
4. **Chasse aux monuments** : zones de découverte, carte, fiches dans le jeu (après ta relecture).
5. **Objets cachés** : placement vérifié par un test d'accessibilité, rendu, son, indices par quartier.
6. **Magasins** : comptoirs, horaires, écran d'achat ; nourriture, pharmacies.
7. **Armes** : James, Surplus Éduen (nouvelles armes à préciser), caches.
8. **Véhicules** : concessionnaires, « Mes véhicules », assurance, fourrière.

Chaque lot : tests, captures téléphone paysage (`tools/ui.sh`), PROGRESS.md, feuille de route. PR à la fin de la phase.

## 9. Risques

- **L'argent renouvelable vient surtout de la violence** (portefeuilles) une fois les collections finies. La phase 4 (rattraper un
  voleur, aider après un accident) apportera des gains sans violence ; en attendant, c'est assumé ou on ajoute une autre source (Q6).
- **Fiches** : je n'écris que ce que je peux sourcer (Mérimée, office de tourisme, Inrap, Wikipédia avec ses références) ; la date et la
  source sont sous chaque fiche. Tu as le dernier mot sur le texte.
- **Menu pause** : il a déjà 8 entrées sur 40 px ; « Carnet » en ajoute une. Il faudra deux colonnes ou regrouper (Records dans le Carnet).
- **Horaires** : une journée dure 20 minutes, la nuit un bon tiers ; armurerie et concessionnaires fermés la nuit, c'est voulu mais ça
  peut agacer. À juger en jouant.
