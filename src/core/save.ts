/** Sauvegarde locale : un seul emplacement, versionné, lu avec méfiance (le stockage du navigateur peut contenir n'importe quoi). */

import type { Waypoint } from "./waypoint";

export const SAVE_VERSION = 1;
export const SAVE_KEY = "autun3d.save";

export type SavedKind = "bike" | "scooter" | "car" | "moto";
const KINDS: readonly string[] = ["bike", "scooter", "car", "moto"];

/** Un véhicule qui n'est plus à sa place d'origine (ou que l'on conduit). */
export interface SavedVehicle {
  id: string;
  kind: SavedKind;
  variant: number;
  x: number;
  y: number;
  heading: number;
}

export interface SaveGame {
  version: number;
  /** Date de l'enregistrement (ms depuis 1970). */
  savedAt: number;
  player: { x: number; y: number };
  camera: { yaw: number; pitch: number };
  /** Identifiant du véhicule conduit, s'il y en a un. */
  riding: string | null;
  vehicles: SavedVehicle[];
  clock: { hour: number; day: number };
  waypoint: Waypoint | null;
}

/** Ce que l'on utilise du stockage du navigateur (`localStorage`) ; un double sert aux tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `localStorage`, ou null s'il est absent ou interdit (fenêtre privée, accès bloqué). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Le monde jouable tient bien en deçà : une coordonnée plus grande est une donnée corrompue. */
const coord = (v: unknown): v is number => finite(v) && Math.abs(v) < 50000;

/** Jour de l'année (1 à 365) après `n` jours de plus. */
export function addDays(day: number, n: number): number {
  return ((((Math.round(day) - 1 + n) % 365) + 365) % 365) + 1;
}

export function serializeSave(save: SaveGame): string {
  return JSON.stringify(save);
}

/** Sauvegarde lue d'un texte ; null si le texte est absent, illisible, d'une autre version ou incohérent. */
export function parseSave(text: string | null): SaveGame | null {
  if (!text) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== "object" || !o) return null;
  const r = o as Record<string, unknown>;
  // Version inconnue (plus récente que ce jeu) : on n'y touche pas. Les anciennes versions seront migrées ici.
  if (r["version"] !== SAVE_VERSION) return null;
  const p = r["player"] as Record<string, unknown> | undefined;
  const cam = r["camera"] as Record<string, unknown> | undefined;
  const clock = r["clock"] as Record<string, unknown> | undefined;
  if (!p || !cam || !clock || !coord(p["x"]) || !coord(p["y"]) || !finite(cam["yaw"]) || !finite(cam["pitch"]) || !finite(clock["hour"]) || !finite(clock["day"])) return null;
  const vehicles: SavedVehicle[] = [];
  if (Array.isArray(r["vehicles"])) {
    for (const v of r["vehicles"] as Record<string, unknown>[]) {
      if (v && typeof v["id"] === "string" && KINDS.includes(v["kind"] as string) && finite(v["variant"]) && coord(v["x"]) && coord(v["y"]) && finite(v["heading"])) {
        vehicles.push({ id: v["id"], kind: v["kind"] as SavedKind, variant: v["variant"], x: v["x"], y: v["y"], heading: v["heading"] });
      }
    }
  }
  const riding = typeof r["riding"] === "string" && vehicles.some((v) => v.id === r["riding"]) ? (r["riding"] as string) : null;
  const w = r["waypoint"] as Record<string, unknown> | null | undefined;
  return {
    version: SAVE_VERSION,
    savedAt: finite(r["savedAt"]) ? r["savedAt"] : 0,
    player: { x: p["x"], y: p["y"] },
    camera: { yaw: cam["yaw"], pitch: Math.min(Math.max(cam["pitch"], -1.5), 1.5) },
    riding,
    vehicles,
    clock: { hour: ((clock["hour"] % 24) + 24) % 24, day: addDays(clock["day"], 0) },
    waypoint: w && coord(w["x"]) && coord(w["y"]) ? { x: w["x"], y: w["y"] } : null,
  };
}

/** Lecture et écriture protégées : jamais d'exception, l'écriture dit si elle a réussi (quota plein, stockage interdit). */
export class SaveStore {
  constructor(private readonly storage: StorageLike | null = browserStorage(), private readonly key = SAVE_KEY) {}

  load(): SaveGame | null {
    try {
      return parseSave(this.storage?.getItem(this.key) ?? null);
    } catch {
      return null;
    }
  }

  write(save: SaveGame): boolean {
    try {
      if (!this.storage) return false;
      this.storage.setItem(this.key, serializeSave(save));
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* rien à faire */
    }
  }
}
