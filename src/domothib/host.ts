/**
 * Autun 3D dans DomoThib Games (D305, contrat : docs/domothib.md). Ce module adapte le jeu à la bibliothèque du pont
 * (`domothib-games.ts`, copiée sans changement) : connexion au démarrage, stockage de la partie, pause et reprise.
 *
 * - Build `domothib` (`vite build --mode domothib`) : le jeu se connecte à DomoThib ; hors de DomoThib (ou sans réponse en 5 s), il
 *   tourne seul comme avant.
 * - Build GitHub Pages et `npm run dev` : aucune connexion, rien ne change.
 * - Sauvegarde : avec DomoThib, la partie et l'apparence du joueur sont sur le serveur, par joueur (`saves.openSync()`, contrat §4.3) ;
 *   sinon dans `localStorage`. Les réglages de l'écran restent dans `localStorage`, les lieux notés dans IndexedDB.
 */
import { connectDomoThib, type DomoThib, type DomoThibSaves } from "./domothib-games";
import { browserStorage, type StorageLike } from "../core/save";

/** Ce que le jeu utilise de DomoThib en cours de partie : pause et reprise (menu de la poignée, arrière-plan, veille…), quitter. */
export type GameHost = Pick<DomoThib, "onPause" | "onResume" | "quit">;

/** Le build pour DomoThib (`--mode domothib`). */
export const DOMOTHIB_BUILD = import.meta.env.MODE === "domothib";

/** Tentatives d'ouverture des sauvegardes du joueur (`unavailable` : DomoThib n'a pas pu lire le serveur) et délai entre deux. */
export const OPEN_ATTEMPTS = 3;
export const RETRY_MS = 1000;

/**
 * Stockage de la partie : celui du joueur sur le serveur quand DomoThib le fournit, attendu avant toute lecture ; sinon celui du
 * navigateur. Si DomoThib ne peut pas lire le serveur après quelques essais : aucun stockage (la partie se joue sans être enregistrée),
 * plutôt qu'un stockage du navigateur qui ferait diverger la partie de celle du serveur.
 */
export async function openSaveStorage(
  saves: Pick<DomoThibSaves, "openSync"> | null,
  fallback: () => StorageLike | null = browserStorage,
  attempts = OPEN_ATTEMPTS,
  retryMs = RETRY_MS,
): Promise<StorageLike | null> {
  if (!saves) return fallback();
  for (let i = 1; i <= attempts; i++) {
    try {
      return await saves.openSync();
    } catch (error) {
      console.warn(`DomoThib : sauvegardes illisibles (essai ${i} sur ${attempts})`, error);
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  console.error("DomoThib : sauvegardes indisponibles, la partie ne sera pas enregistrée");
  return null;
}

export interface GameSession {
  /** DomoThib, ou null quand le jeu tourne seul. */
  host: GameHost | null;
  /** Stockage de la partie et de l'apparence (null : rien n'est enregistré). */
  storage: StorageLike | null;
}

/** Au démarrage, avant de lire la partie : connexion à DomoThib (build `domothib` seulement), puis ouverture du stockage. */
export async function connectGame(enabled = DOMOTHIB_BUILD, connect: () => Promise<DomoThib | null> = connectDomoThib): Promise<GameSession> {
  const domothib = enabled ? await connect() : null;
  if (domothib) console.info(`DomoThib : bonne partie, ${domothib.player.name}`);
  return { host: domothib, storage: await openSaveStorage(domothib?.saves ?? null) };
}
