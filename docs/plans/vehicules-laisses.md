# Véhicules laissés : ils s'effacent une fois qu'on a quitté le quartier (plan)

**Avancement** : **fait** (D301). Plan rédigé le 9 novembre 2026 après D300, à la demande de l'utilisateur. Proposition validée, avec
l'option de **garder le dernier véhicule utilisé**. À faire **avant** `docs/plans/toits-monuments.md`.

## 0. Ce qu'il faut retenir

1. **Aujourd'hui** (`src/game/vehicles.ts`, `Fleet`) : un véhicule « reste là où on le laisse ». Décharger sa tuile ne le retire pas
   (`removeTile`), et ceux qui ont été déplacés ou abîmés sont **enregistrés** (`savedVehicles`) puis recréés au chargement : ils restent
   indéfiniment, d'une partie à l'autre. Une voiture prise sur une place de stationnement n'y revient jamais (sa source est marquée dans
   `sources`, la tuile ne la recrée pas).
2. **Ce qui disparaît déjà** (inchangé) : épaves brûlées (après `EXPLOSION.vanish` = 180 s, à plus de 120 m), épaves noyées (D242),
   véhicule confisqué à l'arrestation, véhicules uniques (gardien, D277), voitures du marché (rangées pendant le marché, `market.ts`).
3. **La règle** : un véhicule non conduit, **hors de sa place**, est « oublié » quand le joueur est resté **à plus de 200 m pendant 45 s**
   d'affilée. 200 m dépasse la distance d'affichage des voitures (170 m) : on ne le voit jamais disparaître.
4. **Ce que devient un véhicule oublié** :

   | Véhicule | Devient |
   |---|---|
   | Voiture, moto, vélo, trottinette d'une place (`voiture-…`, `moto-…`, `velo-…`, `trottinette-…`) | **Revient à sa place, intact**, si sa place est elle aussi à plus de 200 m du joueur ; sinon il attend |
   | Voiture prise à la circulation (`volee-…`), abandonnée par son conducteur (`abandon-…`, police comprise), véhicule de départ (`depart`) | **Supprimé** |
   | Voiture garée seulement cabossée, sans avoir bougé | Revient intacte (les cabosses ne sont plus enregistrées pour toujours) |
   | **Dernier véhicule utilisé** par le joueur | **Jamais oublié**, tant qu'il n'en prend pas un autre (validé par l'utilisateur) |
   | Véhicules uniques, locomotive du petit train, véhicule conduit | Exclus : ils ont leur propre gestion |
   | Épaves brûlées ou noyées | Exclues : leur règle actuelle s'applique |

5. **Sauvegarde** : elle maigrit d'elle-même (un véhicule revenu à sa place n'est plus « déplacé »). Le dernier véhicule utilisé est marqué
   dans la sauvegarde, pour rester gardé après un chargement.

## 1. Le principe technique

- **Origine** (choix fait à la réalisation, D301) : lue sur l'identifiant (`isStallVehicle` : `voiture-`, `moto-`, `velo-`, `trottinette-`),
  sans nouveau champ ni changement de sauvegarde. Un véhicule d'une place retrouvé dans une sauvegarde apprend sa place quand sa tuile le
  recrée ; si la tuile n'est pas construite, il est retiré et la tuile le recréera.
- **Temps d'absence** (dans `Fleet`, par véhicule, secondes) : temps passé hors de portée du joueur ; remis à 0 dès qu'il revient à moins de 200 m, ou
  qu'on le conduit.
- **`Fleet.forget(px, py, dt, keep)`** : appelée toutes les 0,5 s dans `game.ts`, à côté du gardien des véhicules uniques ; `keep` est le
  dernier véhicule utilisé.
  - Pour chaque véhicule ni conduit, ni exclu, ni gardé, et **hors de sa place** (même test que `savedVehicles` : déplacé, ou abîmé) :
    `away += dt` si le joueur est à plus de 200 m, sinon 0.
  - Au-delà de 45 s : `"loose"` → `remove(v)` ; `"stall"` → nouvelle méthode `home(v)` : ancien obstacle retiré, état recréé à la place
    d'origine (`createVehicle`, `settle`), dégâts neufs (`new VehicleDamage(damageProfile(def))`), obstacle reposé, `dirty = true`.
  - `"stall"` dont la place est près du joueur (moins de 200 m) : on attend, pour ne pas le voir apparaître.
  - Retourne les véhicules touchés, pour que `game.ts` les retire de son ensemble `damaged` (fumée, flammes).
- **Marché** (`market.ts`) : une voiture dont la place est sur le marché pendant qu'il est installé ne revient pas à sa place ; elle est
  supprimée et mise dans la réserve du marché (`stash`), qui la ramènera au remballage. Méthode à exposer côté marché.
- **Dernier véhicule utilisé** : `game.ts` garde `lastRidden` (mis à jour au moment où le joueur prend un véhicule, remis à `null` s'il est
  confisqué ou supprimé) ; enregistré dans la sauvegarde (`src/core/save.ts`, identifiant seulement), relu au chargement.
- Les constantes (200 m, 45 s) vont dans un objet `FORGET` exporté, comme `EXPLOSION`, pour être réglées en jouant.

## 2. Lot unique (Sonnet)

- Champs `origin` et `away`, `Fleet.forget`, `Fleet.home`, branchement dans `game.ts`, marché, sauvegarde.
- **Tests** (`src/game/vehicles.test.ts`, `src/core/save.test.ts`) :
  - voiture de stationnement déplacée, joueur loin 45 s → revenue à sa place, intacte, plus enregistrée ;
  - joueur loin 44 s puis revenu près → rien ; le compteur repart à zéro ;
  - sa place est près du joueur → elle attend ;
  - voiture volée laissée → supprimée ; dernier véhicule utilisé → gardé, même après une sauvegarde et un chargement ;
  - prendre un autre véhicule → l'ancien « dernier » redevient oubliable ;
  - véhicule unique, locomotive, épave → non touchés ;
  - marché installé → la voiture du marché ne revient pas sur l'étal.
- Entrées dans `DECISIONS.md`, `PROGRESS.md` et la feuille de route.

## 3. Risques et points à vérifier

- **Recherche par la police** : une voiture volée signalée qui disparaît ne doit pas laisser la police chercher un véhicule absent (vérifier
  `police.ts` et `wanted.ts` : la recherche suit le joueur, pas le véhicule, à confirmer).
- **Tuile déchargée** : un véhicule `"stall"` qui revient à sa place sur une tuile déchargée doit tout de même se poser à la bonne altitude
  (`settle` lit le relief, chargé plus loin que les tuiles de détail : à vérifier) ; sinon, le retour attend le rechargement de la tuile.
- **Réglage** : 200 m et 45 s sont un premier choix, à jouer ; trop court, on perd une voiture en faisant le tour d'un pâté de maisons.
