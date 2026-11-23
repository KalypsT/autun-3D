# Contrat d'intégration d'un jeu dans DomoThib

Ce document dit ce qu'un **dépôt de jeu** doit faire pour entrer dans **DomoThib Games**, la bibliothèque de jeux de DomoThib. Il est écrit pour les sessions qui travaillent dans le dépôt d'un jeu (Maria, Autun 3D, Clé en main…), qui n'ont pas accès au dépôt de DomoThib : il est **copié dans chaque dépôt de jeu** (`docs/domothib.md`), avec la bibliothèque du pont, et mis à jour avec elle.

Source : dépôt `KalypsT/DomoThibv3`, fichiers `docs/modules/jeux-contrat.md` (ce document) et `web/src/features/jeux/sdk/domothib-games.ts` (la bibliothèque). Spécification complète côté DomoThib : `docs/modules/jeux.md` (exigences JEU-01 à JEU-12).

Contrat : **protocole 1**.

---

## 1. Principe

- Le jeu reste un projet indépendant : son dépôt (privé), ses règles, ses tests, sa CI.
- Il est construit en **fichiers statiques** et déployé sur l'**hôte des jeux**, `https://games.loragif.fr/<id>/`, à chaque fusion dans `main`. Il n'y a **qu'une version en ligne** de chaque jeu : la production et la recette de DomoThib affichent la même (chacune avec ses propres joueurs et sauvegardes). Une branche se teste en local, pas dans DomoThib.
- Il ne s'ouvre **que dans DomoThib**, en plein écran, dans un cadre (`iframe`) isolé. Ses fichiers ne sont servis qu'à une session DomoThib : ouvert directement, il affiche « Ce jeu s'ouvre depuis DomoThib. »
- Il parle à DomoThib par la **bibliothèque du pont** (`domothib-games.ts`) : prénom du joueur, sauvegardes sur le serveur, pause et reprise, retour à la bibliothèque. Il ne voit ni l'API de DomoThib, ni aucun jeton.
- Hors de DomoThib (développement local, `npm run dev`), la bibliothèque le dit (`null`) et le jeu garde son fonctionnement autonome.

## 2. Prérequis du dépôt

| Point | Règle |
|---|---|
| Identifiant | Le dossier du jeu sur l'hôte : `^[a-z0-9-]{1,40}$` (`maria`, `autun-3d`, `cle-en-main`). Ne change plus une fois choisi : il porte les sauvegardes. |
| Build | Un build qui produit un dossier de fichiers statiques (`dist/`), avec un `index.html` à sa racine. Vite recommandé. |
| Chemin de base | Le jeu est servi sous `/<id>/` : `base: '/<id>/'` dans Vite (pas `./`, pas `/NomDuDepot/` de GitHub Pages). |
| Mode DomoThib | Un mode de build dédié (`vite build --mode domothib`), qui coupe ce qui ne va pas dans DomoThib (§6). Le build GitHub Pages peut coexister jusqu'à la bascule. |
| Dépôt | Privé une fois la bascule faite. GitHub Pages coupé ensuite. |

## 3. Le manifeste `domothib.json`

Fichier à la racine du build (dans Vite : `public/domothib.json`, copié tel quel dans `dist/`). 16 Ko au plus. DomoThib le relit toutes les 30 s : un changement de nom ou de jaquette apparaît sans rien faire d'autre qu'un déploiement.

```json
{
  "protocole": 1,
  "id": "maria",
  "nom": "Maria",
  "description": "Plateformes et énigmes dans un monde dessiné à la main.",
  "version": "1.4.0",
  "jaquette": "jaquette.webp",
  "orientation": "paysage",
  "ecrans": ["telephone", "tablette"],
  "commandes": ["tactile", "clavier"],
  "sauvegarde": "domothib",
  "poignee": "haut-gauche",
  "pleinEcran": true
}
```

| Champ | Obligatoire | Valeurs | Usage dans DomoThib |
|---|---|---|---|
| `protocole` | oui | `1` | Version du contrat. Un autre nombre : jeu ignoré. |
| `id` | oui | identifiant du §2 | Doit être **égal au nom du dossier** sur l'hôte, sinon jeu ignoré. |
| `nom` | oui | 1 à 40 caractères | Tuile, menu, Paramètres. |
| `description` | non | 200 caractères au plus | Paramètres. |
| `version` | oui | 1 à 20 caractères (`1.4.0`, `0.3.0-beta`) | Paramètres. |
| `jaquette` | non | chemin relatif d'un fichier WebP, PNG ou JPEG du build, 300 Ko au plus, **16:9** (640 × 360 conseillé) | Tuile de la page Jeux. Sans jaquette : le nom sur un fond uni. |
| `orientation` | oui | `paysage`, `portrait`, `libre` | Voile « Tourne ton écran » si l'écran est dans l'autre sens. |
| `ecrans` | oui | sous-ensemble non vide de `telephone`, `tablette` | Mention « Prévu pour le téléphone » ailleurs ; le jeu reste lançable. La tablette de l'entrée est une Galaxy Tab S3 de 2017 (Chrome 138, paysage) : n'y mettre que ce qui y tourne bien. |
| `commandes` | oui | sous-ensemble non vide de `tactile`, `clavier` | Affiché sur la tuile. Le tactile doit suffire sur téléphone et tablette. |
| `sauvegarde` | oui | `domothib` ou `integree` | §4.2 : sur le serveur (recommandé) ou dans le navigateur (repli). |
| `poignee` | non | `haut-gauche` (défaut), `haut-droite`, `bas-gauche`, `bas-droite` | Coin du bouton de DomoThib (menu : reprendre, plein écran, recharger, quitter). Choisir le coin où il gêne le moins le jeu ; laisser environ 56 × 56 px libres dans ce coin. |
| `pleinEcran` | non | `true` (défaut), `false` | Plein écran demandé au lancement. |

Un manifeste invalide n'empêche rien d'autre de fonctionner : le jeu est absent de la bibliothèque et la raison s'affiche dans DomoThib (Paramètres > Écrans > DomoThib Games).

## 4. La bibliothèque du pont

### 4.1 Installation

Copier `domothib-games.ts` **sans le modifier** dans `src/domothib/domothib-games.ts`. Son en-tête donne sa version et son protocole ; pour la mettre à jour, recopier le fichier et ce contrat. Elle n'a aucune dépendance et n'utilise que les API du navigateur.

```ts
import { connectDomoThib } from './domothib/domothib-games';

const domothib = await connectDomoThib(); // null hors de DomoThib, ou après 5 s sans réponse de DomoThib
if (domothib) {
  console.info(`Bonne partie, ${domothib.player.name}`);
}
```

API (les noms sont en anglais, comme tout le code) :

```ts
export const VERSION = '1.1.0';
export const PROTOCOL = 1;

export function connectDomoThib(options?: { timeoutMs?: number }): Promise<DomoThib | null>;

export interface DomoThib {
  readonly game: string;                                // identifiant du jeu
  readonly player: { name: string; initial: string };  // prénom du joueur, rien d'autre
  readonly saves: DomoThibSaves | null;                // null si "sauvegarde": "integree", ou si DomoThib ne gère pas encore les sauvegardes
  onPause(listener: () => void): () => void;           // rend une fonction de désabonnement
  onResume(listener: () => void): () => void;
  onSaveState(listener: (state: 'saved' | 'pending') => void): () => void;
  quit(): void;                                        // retour à la page Jeux (bouton « Quitter » du jeu)
}

export interface DomoThibSaves {
  list(): Promise<{ key: string; revision: number; size: number; modifiedAt: string }[]>;
  read(key: string): Promise<string | null>;
  readAll(): Promise<Record<string, string>>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  openSync(): Promise<DomoThibSyncStorage>;            // §4.3
}

export interface DomoThibSyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;           // envoyé au serveur en arrière-plan ; lève DomoThibError si refusé
  removeItem(key: string): void;
  keys(): string[];
}

export class DomoThibError extends Error {
  readonly code: 'invalid_key' | 'too_large' | 'quota' | 'unavailable' | 'closed' | 'invalid_request';
}
```

`connectDomoThib()` rend `null` aussitôt hors d'un cadre (développement local), ou si le jeu n'a pas été ouvert par le lanceur de DomoThib (origine de DomoThib inconnue), ou si DomoThib répond qu'il ne gère pas ce protocole ; `null` aussi après 5 s sans réponse. Le jeu tourne alors seul, avec son propre stockage. La bibliothèque exporte aussi `connectDomoThibIn`, réservée aux tests de DomoThib : un jeu ne s'en sert pas.

**Versions.** La 1.1.0 apporte les sauvegardes sur le serveur ; elle est compatible avec la 1.0.0 (même protocole). `saves` vaut `null` quand DomoThib répond `saves: false` : jeu en `"sauvegarde": "integree"`, ou DomoThib qui ne gère pas encore les sauvegardes. Le jeu garde alors son stockage habituel : prévoir les deux cas (`domothib?.saves ? … : stockage du navigateur`).

Ce que la bibliothèque fait seule, sans code du jeu :

- **Activité** : elle écoute `pointerdown`, `keydown` et `wheel` et prévient DomoThib au premier toucher, puis au plus une fois toutes les 10 s. C'est ce qui empêche la veille de la tablette de couper une partie en cours. Un jeu qui se joue sans toucher l'écran plus de 2 minutes (cinématique longue) sera coupé par la veille de la tablette : à éviter, ou prévoir une reprise.
- **Connexion** : elle envoie sa demande toutes les 500 ms jusqu'à la réponse (5 s au plus), à l'origine de DomoThib gardée par le lanceur (jamais à `"*"`), vérifie que la réponse vient de la fenêtre parente et de cette origine, et ne répond à rien d'autre.

### 4.2 Sauvegardes

**Avec `"sauvegarde": "domothib"`** (recommandé) : les sauvegardes sont sur le serveur, **par joueur**, et suivent le joueur sur tous ses écrans.

- Une sauvegarde est une entrée **clé → texte**. Le jeu choisit ses clés (`slot-1`, `settings`, `journal-2`…) : `^[A-Za-z0-9._:-]{1,100}$`, sauf `.` et `..`. Il sérialise lui-même ses données (JSON). Une valeur ne contient ni le caractère NUL (`\u0000`) ni de moitié de paire de substitution (`invalid_request`) : `JSON.stringify` d'objets ordinaires n'en produit pas.
- **Lire avant d'écrire.** DomoThib envoie chaque écriture avec la révision de la clé qu'il a vue en dernier (`read`, `readAll`, `list`, `openSync`, ou la dernière écriture). Une clé que le jeu n'a jamais lue est écrite comme nouvelle : si elle existe déjà sur le serveur, c'est un **conflit** (ci-dessous), jamais un écrasement silencieux. Lire ses sauvegardes au démarrage suffit.
- Limites par jeu et par joueur : **2 Mio par valeur, 200 entrées, 20 Mio au total**. Découper un gros journal en plusieurs clés plutôt qu'une seule valeur qui grossit.
- `write` est résolu quand le serveur a enregistré la valeur. **Ne pas l'attendre dans la boucle du jeu** : lancer l'écriture et continuer. DomoThib ne garde que la dernière valeur d'une clé en attente et n'écrit pas la même clé plus d'une fois par seconde : écrire souvent ne coûte rien.
- Serveur injoignable : la valeur reste en attente chez DomoThib et repart seule ; `onSaveState` passe à `pending`, puis `saved`. Le jeu n'a rien à faire (il peut l'afficher).
- **Conflit** (la même partie a été sauvegardée entre-temps sur un autre écran) : DomoThib le gère seul. Il met le jeu en pause et demande au joueur « Reprendre la plus récente » (le jeu est rechargé et relit le serveur) ou « Garder cette partie » (la valeur du jeu remplace celle du serveur). Le jeu n'a rien à faire.
- Rejets à traiter : `too_large`, `quota`, `invalid_key`, `invalid_request` (erreurs du jeu, jamais réessayées). `invalid_key`, `too_large` et `invalid_request` sont rendus aussitôt par la bibliothèque, sans rien envoyer. `unavailable` : DomoThib n'a pas pu lire le serveur (une lecture se refait plus tard) ; `closed` : la valeur a été abandonnée (« Reprendre la plus récente », « Quitter sans sauvegarder », session terminée), le jeu est en train d'être fermé ou rechargé.
- Les **réglages propres à l'écran** (volume, qualité graphique, aide déjà vue) peuvent rester dans le `localStorage` du jeu : ils ne suivent pas le joueur, et c'est voulu.

Brancher un jeu qui a déjà une couche de stockage asynchrone (Maria, Clé en main) revient à en écrire une implémentation de plus :

```ts
// Exemple : implémentation d'une interface de stockage existante du jeu.
class DomoThibSaveStorage implements SaveStorage {
  constructor(private readonly saves: DomoThibSaves) {}
  async load(slot: string) { return this.saves.read(`slot-${slot}`); }
  async save(slot: string, json: string) { await this.saves.write(`slot-${slot}`, json); }
  async delete(slot: string) { await this.saves.remove(`slot-${slot}`); }
}

const domothib = await connectDomoThib();
const storage = domothib?.saves ? new DomoThibSaveStorage(domothib.saves) : openBrowserStorage();
```

**Avec `"sauvegarde": "integree"`** (repli, si l'adaptation coince) : `saves` vaut `null` et le jeu garde son stockage habituel, dans le navigateur, sur l'hôte des jeux. La sauvegarde est alors **commune à tous ceux qui jouent sur le même écran** (sur la tablette, Thibaud et Dréa partagent la même partie), **propre à chaque écran**, et perdue si on efface les données du navigateur. La bibliothèque reste obligatoire (activité, pause, quitter).

Les sauvegardes faites sur GitHub Pages ne sont pas reprises : la première partie dans DomoThib repart de zéro.

### 4.3 Stockage synchrone

Pour un jeu qui lit son stockage de façon synchrone (un `StorageLike` sur `localStorage`, comme Autun 3D) : `openSync()` charge **toutes** les entrées du joueur en une requête au démarrage, puis donne un objet synchrone ; chaque `setItem` et `removeItem` est envoyé au serveur en arrière-plan.

```ts
const domothib = await connectDomoThib();
const storage: StorageLike = domothib?.saves ? await domothib.saves.openSync() : browserStorage();
startGame(storage);
```

Attendre `openSync()` **avant** de lire la partie au démarrage. Comme `localStorage`, `setItem` lève une erreur (`DomoThibError`, `invalid_key` ou `too_large`) sur une clé ou une valeur refusée, sans rien changer ; un refus du serveur reçu plus tard (`quota`) est signalé dans la console. `removeItem` d'une clé absente ne fait rien.

### 4.4 Pause, reprise, quitter

DomoThib envoie **pause** quand : le menu de sa poignée s'ouvre, l'application passe en arrière-plan, l'écran est dans le mauvais sens, un dialogue de conflit s'affiche, la veille de la tablette démarre, le joueur quitte. Puis **resume** quand la cause disparaît. À la pause, le jeu coupe son son, ses minuteries et sa boucle (ou au moins le temps de jeu) ; c'est aussi le bon moment pour sauvegarder.

```ts
domothib?.onPause(() => game.pause());
domothib?.onResume(() => game.resume());
```

Un bouton « Quitter » dans le jeu appelle `domothib.quit()` : DomoThib attend les sauvegardes en cours et revient à sa page Jeux. Ne jamais faire `window.close()` ni naviguer ailleurs.

## 5. Protocole

Pour information : la bibliothèque s'en charge. Messages de fenêtre (`postMessage`) :

| De → vers | Message | Rôle |
|---|---|---|
| Jeu → DomoThib | `{ type: "domothib:ready", protocol: 1, instance }` | Le jeu est chargé et demande la connexion. `instance` identifie le document (une valeur au hasard par chargement) : DomoThib ne répond qu'une fois aux demandes répétées d'un même document ; un nouveau document (jeu rechargé) refait la connexion. |
| DomoThib → jeu | `{ type: "domothib:connect", protocol: 1, game, player: { name, initial }, saves: true \| false }` + `MessagePort` | Connexion. Tout le reste passe par ce port. |
| DomoThib → jeu | `{ type: "domothib:incompatible", protocols: [1] }` | Protocole non géré par ce DomoThib. |

Messages du port :

| De → vers | Message | Réponse |
|---|---|---|
| Jeu → DomoThib | `{ id, type: "saves.list" }` | `{ id, ok: true, result: [ { key, revision, size, modifiedAt } ] }` |
| Jeu → DomoThib | `{ id, type: "saves.read", key }` | `{ id, ok: true, result: "…" \| null }` |
| Jeu → DomoThib | `{ id, type: "saves.readAll" }` | `{ id, ok: true, result: { key: value } }` |
| Jeu → DomoThib | `{ id, type: "saves.write", key, value }` | `{ id, ok: true }` quand le serveur a enregistré |
| Jeu → DomoThib | `{ id, type: "saves.remove", key }` | `{ id, ok: true }` |
| Jeu → DomoThib | `{ type: "activity" }`, `{ type: "quit" }` | — |
| DomoThib → jeu | `{ type: "pause" }`, `{ type: "resume" }`, `{ type: "saveState", state: "saved" \| "pending" }` | — |

Erreurs : `{ id, ok: false, error: "invalid_key" | "too_large" | "quota" | "unavailable" | "invalid_request" }`. Un message de plus de 3 Mo est ignoré.

## 6. Règles du build DomoThib

| Règle | Pourquoi |
|---|---|
| **Aucune ressource extérieure** : polices, images, sons, scripts, bibliothèques et données servis par le jeu lui-même. Pas de Google Fonts, de CDN, de mesure d'audience, d'API tierce. | La politique de sécurité de l'hôte (`'self'`) les bloque ; c'est aussi ce qui garde le jeu confidentiel. Télécharger les polices (fichiers `woff2`) dans le build. |
| **Pas de *service worker*** : `vite-plugin-pwa` et tout manifeste d'application désactivés en mode `domothib`. | L'hôte refuse leur installation (le hors-ligne n'est pas encore géré par DomoThib). |
| Pas de `alert`, `confirm`, `prompt`, `window.open`, ni de navigation de la page (`top.location`). | Le cadre est isolé (`sandbox`) : ces appels sont bloqués. Faire ses dialogues dans le jeu. |
| Ressources du build sous `/<id>/assets/` avec une empreinte dans le nom (comportement par défaut de Vite). | Elles sont gardées en cache un an ; `index.html` et `domothib.json` sont revalidés à chaque ouverture. |
| **Fichiers lourds ou nombreux** (tuiles, modèles, cartes, données copiées depuis `public/`) : aucune limite de taille ni de nombre. Par défaut, ils sont revalidés à chaque usage (`304` s'ils n'ont pas changé, une requête courte par fichier). Pour qu'ils soient gardés en cache un an sans revalidation, les placer sous `public/immuable/<version>/` (servis sous `/<id>/immuable/<version>/…`) et **changer `<version>`** dès que leur contenu change. | Un jeu comme Autun 3D (≈ 2 850 fichiers, ≈ 107 Mo) se recharge alors sans aucune requête pour ses données déjà vues. Le premier chargement télécharge tout ce que le jeu demande : penser aux données mobiles. Les fichiers JSON, texte et WebAssembly sont compressés à l'envoi. |
| WebAssembly et *workers* : permis (`'wasm-unsafe-eval'`, `worker-src 'self' blob:`). `eval` et `new Function` : interdits. | Politique de sécurité de l'hôte. |
| Son : démarré après un premier toucher dans le jeu. | Règle des navigateurs ; le cadre a l'autorisation `autoplay`, mais un premier geste reste plus sûr. |
| Plein écran : laissé à DomoThib (`pleinEcran` du manifeste). | DomoThib met en plein écran le conteneur du cadre, avec sa poignée. |
| Orientation : déclarée dans le manifeste, pas imposée par le jeu. | DomoThib affiche le voile « Tourne ton écran ». |
| Mémoire : pas de fuite en jeu prolongé, ressources libérées entre deux niveaux. | La Tab S3 a 4 Go de mémoire, partagés avec DomoThib. |

## 7. Déploiement

### 7.1 Une fois, sur le VPS (Thibaud)

Pour chaque jeu, avec l'identifiant `<id>` :

```bash
sudo install -d -o jeux-deploy -g jeux-deploy -m 755 /opt/jeux/<id>
ssh-keygen -t ed25519 -N '' -C '<id>-ci' -f /tmp/<id>-ci   # sur un poste, pas sur le VPS
# Dans ~jeux-deploy/.ssh/authorized_keys, une ligne par jeu :
# command="rrsync /opt/jeux/<id>",restrict ssh-ed25519 AAAA… <id>-ci
```

`rrsync` est fourni avec rsync (Ubuntu 24.04 : `/usr/bin/rrsync`) : la clé ne peut qu'écrire par rsync dans `/opt/jeux/<id>/`.

Secrets du dépôt du jeu (GitHub > Settings > Secrets and variables > Actions) : `JEUX_SSH_KEY` (clé privée `/tmp/<id>-ci`, puis la supprimer du poste), `VPS_HOST`, `VPS_KNOWN_HOSTS` (sortie de `ssh-keyscan <VPS_HOST>`).

### 7.2 Workflow du dépôt du jeu

Une pull request **construit et teste** le jeu ; une fusion dans `main` le **déploie** sur l'hôte des jeux (visible aussitôt dans la production et la recette de DomoThib). Exemple (`.github/workflows/deploy.yml`, à adapter aux commandes du dépôt : pnpm pour Clé en main) :

```yaml
name: Déploiement DomoThib
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
jobs:
  deploy:
    if: github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build -- --mode domothib
      - name: Vérifier le manifeste
        run: |
          node -e '
            const m = JSON.parse(require("fs").readFileSync("dist/domothib.json", "utf8"));
            if (m.protocole !== 1 || m.id !== process.env.GAME_ID) { console.error("domothib.json invalide"); process.exit(1); }
          '
        env:
          GAME_ID: maria
      - name: Envoi sur l'hôte des jeux
        if: github.event_name == 'push'
        env:
          SSH_KEY: ${{ secrets.JEUX_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.VPS_KNOWN_HOSTS }}
          VPS_HOST: ${{ secrets.VPS_HOST }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          printf '%s\n' "$SSH_KEY" > ~/.ssh/jeux && chmod 600 ~/.ssh/jeux
          rsync -rlz --delete-after --delay-updates --chmod=D755,F644 \
            -e "ssh -i ~/.ssh/jeux" dist/ "jeux-deploy@$VPS_HOST:./"
```

- `--delay-updates --delete-after` : les nouveaux fichiers remplacent les anciens à la fin du transfert, les anciens disparaissent après ; une partie en cours n'est pas cassée par un envoi à moitié fait.
- `./` désigne le dossier du jeu, `/opt/jeux/<id>/` (imposé par `rrsync`).
- Retour arrière : relancer le workflow sur un commit précédent.
- Le premier déploiement suffit : le jeu apparaît dans DomoThib au plus 30 s plus tard. Rien à changer dans DomoThib.

## 8. Vérifier

1. **En local** : `npm run dev` : le jeu tourne seul, `connectDomoThib()` rend `null`, le stockage du navigateur sert.
2. **Après la fusion** : DomoThib > tiroir > DomoThib Games (production, ou recette pour essayer sans toucher aux sauvegardes de la production). Vérifier : la tuile et sa jaquette ; le lancement en plein écran ; la poignée dans le bon coin, sans gêner ; la pause en ouvrant le menu ; une sauvegarde reprise sur un autre écran ; « Quitter » ; la veille de la tablette qui ne coupe pas une partie en cours.
3. **Confidentialité** : `https://games.loragif.fr/<id>/` ouvert directement affiche « Ce jeu s'ouvre depuis DomoThib. »
4. **Bascule** : dépôt en privé, GitHub Pages coupé.
