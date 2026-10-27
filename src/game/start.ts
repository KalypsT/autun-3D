import type { SaveGame, SaveStore } from "../core/save";

/** Point de départ : place du Champ de Mars, face au nord (mairie et théâtre au fond). */
const SPAWN = { x: -10, y: -40, heading: 0 };

/** ?at=x,y&yaw=radians : point de départ imposé (tests, captures). */
export function gameSpawn(params: URLSearchParams): { x: number; y: number; yaw: number } {
  const at = params.get("at")?.split(",").map(Number);
  const yaw = Number(params.get("yaw") ?? SPAWN.heading);
  return at && at.length === 2 && at.every(Number.isFinite) ? { x: at[0]!, y: at[1]!, yaw } : { x: SPAWN.x, y: SPAWN.y, yaw };
}

/** Paramètres d'URL qui servent aux tests et aux captures : ils imposent la situation de départ et coupent la sauvegarde. */
const FORCING_PARAMS = ["at", "yaw", "ride", "h", "day", "speed", "style"];

export interface StartState {
  x: number;
  y: number;
  yaw: number;
  /** Sauvegarde reprise, s'il y en a une. */
  save: SaveGame | null;
  /** Ni lecture ni écriture de la sauvegarde pendant cette session (paramètres de test). */
  noSave: boolean;
}

/**
 * Où et comment la partie commence. Une sauvegarde valide, dans la zone jouable, est reprise ; `?new` l'ignore (et la remplacera) ;
 * un paramètre de test (`?at=`, `?h=`…) impose le départ et empêche de lire comme d'écrire la sauvegarde, pour qu'un lien partagé
 * ou une capture n'écrase pas la partie du joueur.
 */
export function resolveStart(params: URLSearchParams, store: SaveStore, zone: readonly [number, number, number, number]): StartState {
  const spawn = gameSpawn(params);
  if (FORCING_PARAMS.some((k) => params.has(k))) return { ...spawn, save: null, noSave: true };
  const save = params.has("new") ? null : store.load();
  const inside = save && save.player.x >= zone[0] && save.player.x <= zone[2] && save.player.y >= zone[1] && save.player.y <= zone[3];
  if (!save || !inside) return { ...spawn, save: null, noSave: false };
  return { x: save.player.x, y: save.player.y, yaw: save.camera.yaw, save, noSave: false };
}
