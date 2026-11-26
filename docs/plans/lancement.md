# Grand Theft Autun : nom, jaquette, écran de chargement, arrivée à la gare (plan)

**Avancement** : **fait** (D338), sauf la police des titres : logo et jaquette faits avec une police de repli, à refaire avec Pricedown
(`python3 tools/logo/make_art.py`). Plan rédigé le 26 novembre 2026, à la demande de l'utilisateur, avec ses réponses. Trois lots, une PR à la fin.

## 0. Ce qu'il faut retenir

1. **Le jeu s'appelle « Grand Theft Autun »**. Rien ne change dans DomoThib : il lit le nom et la jaquette dans `public/domothib.json`,
   relu toutes les 30 s (jaquette gardée 5 min en cache). L'identifiant `autun-3d` (dossier sur l'hôte, sauvegardes du serveur) et les clés
   de stockage `autun3d.*` **ne changent pas**.
2. **Écran de chargement façon GTA** : des captures du jeu plein écran qui se succèdent, zoom lent et fondu, sans légende ; le logo dans un
   coin ; à la fin, « Touche l'écran pour jouer ».
3. **Nouvelle partie à la gare** : le matin, un autorail TER entre en gare, le personnage en descend sur le quai 1 (cinématique passable
   d'un toucher), puis le prologue de l'histoire « Le retour » commence. La partie en cours, elle, reprend directement, comme avant.

## 1. Réponses de l'utilisateur

| Question | Réponse |
|---|---|
| Scène de la jaquette | Capture mise en scène (personnage, voiture, cathédrale, lumière dorée) |
| Logo | Tous les mots de la même taille, comme le logo de Grand Theft Auto ; police des titres de GTA (Pricedown) |
| Police | À récupérer ; sinon fournie par l'utilisateur (le réseau de l'environnement bloque les sites de polices) |
| Images du chargement | Captures du jeu, sans légende |
| Fin du chargement | « Touche l'écran pour jouer » |
| Arrivée | Un train qui entre en gare |
| Heure de départ | Le matin |
| Histoire | « Le retour » |
| Étendue | Intro et premier objectif ; les missions viendront dans une phase à part |
| Parties en cours | Aucune vraie partie à préserver |
| Au lancement | Reprise directe de la partie (pas de menu titre) |

## 2. Lot 1 : nom et jaquette

- « Grand Theft Autun » : manifeste DomoThib (`nom`, `description`), titre de la page, crédits du menu pause, page des sons, export des
  lieux notés, README, `package.json` (description).
- **Logo** (`tools/logo/make_logo.py`, PIL) : « GRAND THEFT AUTUN » sur trois lignes de même hauteur, lettres blanches cernées de noir,
  ombre portée, en police Pricedown. La police ne sert qu'à **fabriquer des images** : elle n'est pas embarquée dans le jeu (pas de licence
  de police web en jeu, rien de plus à charger). Le fichier de police reste hors du dépôt (`.cache/fonts/`, à fournir) ; tant qu'il manque,
  le script prend une police de repli, et le logo est à refaire.
- Produits : `src/assets/logo.webp` (fond transparent, pour l'écran de chargement et l'intro) et `public/jaquette.webp` (640 × 360, ≤ 300 Ko :
  capture mise en scène + logo sur environ la moitié de la hauteur, lisible sur une tuile de 170 px de large).

## 3. Lot 2 : écran de chargement

- Écrit dans `index.html` (HTML et CSS en ligne) : il s'affiche **avant** même le téléchargement de three.js et du jeu.
- Huit captures 1280 × 720 en WebP (`src/assets/loading/*.webp`, environ 100 Ko chacune ; `public/` reste réservé aux données, test de
  garde) : la première est la scène de la jaquette (fil continu avec le voile flouté de DomoThib), les autres des lieux et des moments du jeu
  (poursuite, nuit, coucher de soleil, panorama). Seule la première est demandée d'emblée ; les suivantes quand le jeu démarre.
- Chaque image environ 6 s, zoom lent de 8 % vers un point choisi par image, fondu de 0,8 s. **Animations en CSS seulement** (`transform`,
  `opacity`) : elles restent fluides pendant que le processeur construit les tuiles. `prefers-reduced-motion` : pas de zoom, fondus seuls.
- Logo en bas à gauche ; en bas à droite, un petit indicateur d'avancement (monde, relief, ville) ; erreurs affichées au même endroit.
- Prêt : « Touche l'écran pour jouer » (clignote lentement). Le toucher ferme l'écran (fondu) et compte comme premier geste (son, plein
  écran hors de DomoThib). Le banc, le viewer et les paramètres de test (`?at=`…) passent l'écran pour ne pas fausser les mesures et captures.

## 4. Lot 3 : nouvelle partie à la gare, prologue « Le retour »

**Départ** : quai 1 de la gare (repère de la gare D228 : devant le pavillon), le lundi du premier jour d'été, **8 h 12**. Une partie sans
sauvegarde, « Nouvelle partie » (menu pause) et `?new` y mènent ; `?at=` et les paramètres de test gardent leur départ imposé.

**L'autorail** (`src/render/ter-model.ts`, `src/core/arrival.ts`) : une voiture TER d'environ 29 m (caisse blanche, bandeau bleu, vitres
sombres, bouts profilés, bogies), qui suit la voie le long du quai 1 (tracé tiré des rails des données, altitude `railAt`) : il arrive de
l'ouest, freine, s'arrête devant le pavillon, repart vers l'ouest 30 s après la fin de l'intro, puis disparaît. C'est un obstacle tant qu'il
est là. Pas encore de TER qui circule (idée gardée : il pourra resservir).

**Cinématique d'arrivée** (≈ 25 s ; un toucher la passe) : bandes noires, interface masquée, commandes ignorées, police et événements calmes.
1. Plan large depuis le quai, vers l'ouest : l'autorail approche ; le logo apparaît puis s'efface.
2. Plan rasant le long du train qui ralentit et s'arrête.
3. La porte : le personnage descend et marche quelques pas sur le quai ; carton « Autun — gare SNCF / lundi, 8 h 12 ».
Puis la main revient au joueur, caméra derrière lui. La découverte du monument « Gare » attend la fin de la cinématique.

**Prologue « Le retour »** (`src/core/story.ts`, état enregistré dans la sauvegarde, champ facultatif `story` de la version 6) :
- Étape `arrivee` → `rejoindre` : un SMS de Jojo s'affiche (« T'es vraiment revenu ? Dix ans… Je t'attends au café du Champ de Mars. Fais
  gaffe, y en a qui t'ont pas oublié. »). Objectif affiché « Rejoins Jojo au Champ de Mars », repère posé avec son itinéraire (D310).
- Jojo attend devant le café (personnage fixe). À 4 m de lui : trois bulles (« Regarde-toi ! Le revenant. » ; « Le Gros sait que t'es là.
  Ta dette, il l'a pas oubliée, lui. » ; « Va falloir trouver de l'argent. Vite. »), puis le bandeau « Prologue terminé » — « La suite au
  prochain épisode ». Étape `fin`.
- Une sauvegarde sans `story` (partie d'avant) est traitée comme un prologue terminé : pas d'intro au milieu d'une partie.
- Textes réunis dans `src/core/story.ts`, à relire par l'utilisateur.

## 5. Tests

- Départ : nouvelle partie à la gare, sur le quai, à 8 h 12 ; reprise d'une sauvegarde inchangée ; `?at=` inchangé.
- Sauvegarde : `story` lu avec méfiance (étapes connues seulement), absent = prologue terminé.
- Prologue : enchaînement des étapes (intro passée ou terminée, SMS, objectif, arrivée près de Jojo, fin) en logique pure.
- Autorail : tracé continu, sur la voie du quai 1, arrêt devant le pavillon, freinage sans à-coup.
- Chargement : `public/` toujours limité aux données, au manifeste et à la jaquette ; manifeste au nom du jeu.
- Captures : écran de chargement, les trois plans de l'intro, le SMS et l'objectif, la rencontre avec Jojo, la jaquette.
