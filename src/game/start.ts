import type { SaveGame, SaveStore } from "../core/save";
import { DOOR_STEP, WALK_HEADING } from "../core/arrival";

/** Point de départ des outils (banc, galeries, paramètres de test) : place du Champ de Mars, face au nord (mairie et théâtre au fond). */
const SPAWN = { x: -10, y: -40, heading: 0 };
/** Départ d'une nouvelle partie (D338) : sur le quai 1 de la gare, devant la porte de l'autorail, tourné vers la gare. */
export const STATION_SPAWN = { x: DOOR_STEP[0], y: DOOR_STEP[1], yaw: WALK_HEADING };
/** Heure de départ d'une nouvelle partie (D338) : 8 h 12, le matin, à l'arrivée du train. */
export const NEW_GAME_HOUR = 8.2;

/** ?at=x,y&yaw=radians : point de départ imposé (tests, captures). */
export function gameSpawn(params: URLSearchParams): { x: number; y: number; yaw: number } {
  const at = params.get("at")?.split(",").map(Number);
  const yaw = Number(params.get("yaw") ?? SPAWN.heading);
  return at && at.length === 2 && at.every(Number.isFinite) ? { x: at[0]!, y: at[1]!, yaw } : { x: SPAWN.x, y: SPAWN.y, yaw };
}

/** Paramètres d'URL qui servent aux tests et aux captures : ils imposent la situation de départ et coupent la sauvegarde. */
const FORCING_PARAMS = ["at", "yaw", "ride", "h", "day", "date", "season", "weekday", "speed", "style", "hurt", "weather", "money", "event"];

export interface StartState {
  x: number;
  y: number;
  yaw: number;
  /** Sauvegarde reprise, s'il y en a une. */
  save: SaveGame | null;
  /** Ni lecture ni écriture de la sauvegarde pendant cette session (paramètres de test). */
  noSave: boolean;
  /** Nouvelle partie : arrivée en train à la gare, cinématique et prologue (D338). */
  intro: boolean;
}

/**
 * Où et comment la partie commence. Une sauvegarde valide, dans la zone jouable, est reprise ; sinon, ou avec `?new` (qui remplacera la
 * sauvegarde), c'est une nouvelle partie : arrivée à la gare (D338). Un paramètre de test (`?at=`, `?h=`…) impose le départ et empêche de
 * lire comme d'écrire la sauvegarde, pour qu'un lien partagé ou une capture n'écrase pas la partie du joueur ; `?intro` rejoue l'arrivée à
 * la gare de la même façon, sans toucher à la sauvegarde.
 */
export function resolveStart(params: URLSearchParams, store: SaveStore, zone: readonly [number, number, number, number]): StartState {
  if (params.has("intro")) return { ...STATION_SPAWN, save: null, noSave: true, intro: true };
  if (FORCING_PARAMS.some((k) => params.has(k))) return { ...gameSpawn(params), save: null, noSave: true, intro: false };
  const save = params.has("new") ? null : store.load();
  const inside = save && save.player.x >= zone[0] && save.player.x <= zone[2] && save.player.y >= zone[1] && save.player.y <= zone[3];
  if (!save || !inside) return { ...STATION_SPAWN, save: null, noSave: false, intro: true };
  return { x: save.player.x, y: save.player.y, yaw: save.camera.yaw, save, noSave: false, intro: false };
}
