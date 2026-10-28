/** Sauvegarde locale : un seul emplacement, versionné, lu avec méfiance (le stockage du navigateur peut contenir n'importe quoi). */

import { MAX_HEALTH } from "./health";
import { WEAPON_ORDER, WEAPONS, type SavedArms, type WeaponId } from "./weapons";
import { LEGACY_MODELS, vehicleDef } from "./vehicle-catalog";
import type { Waypoint } from "./waypoint";

/**
 * Version 2 (D50) : un véhicule est enregistré par son modèle du catalogue (`model`) et non plus par son type (`kind`).
 * La version 1 est migrée à la lecture : chaque type devient son modèle d'alors (voir `LEGACY_MODELS`).
 * Version 3 (D80) : la santé du joueur ; les versions 1 et 2 sont lues avec la santé pleine.
 * Version 4 (D84) : les armes (possédées, balles, arme en main) ; les versions 1 à 3 sont lues avec les seuls poings.
 */
export const SAVE_VERSION = 4;
export const SAVE_KEY = "autun3d.save";

/** Un véhicule qui n'est plus à sa place d'origine (ou que l'on conduit). */
export interface SavedVehicle {
  id: string;
  /** Identifiant d'une entrée du catalogue (`vehicleDef`). */
  model: string;
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
  /** Points de vie du joueur (1 à `MAX_HEALTH` : un mort ne s'enregistre pas, il est déjà à l'hôpital). Versions 1 et 2 : santé pleine. */
  health: number;
  /** Armes du joueur (versions 1 à 3 : les seuls poings). */
  arms: SavedArms;
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

/** Armes enregistrées, lues avec méfiance : armes connues et sans doublon, balles entières et bornées, arme en main possédée. */
export function parseArms(o: unknown): SavedArms {
  const out: SavedArms = { owned: [], mag: {}, ammo: {}, current: "fists" };
  if (typeof o !== "object" || !o) return out;
  const r = o as Record<string, unknown>;
  const known = (v: unknown): v is WeaponId => typeof v === "string" && (WEAPON_ORDER as readonly string[]).includes(v);
  if (Array.isArray(r["owned"])) for (const id of r["owned"]) if (known(id) && id !== "fists" && !out.owned.includes(id)) out.owned.push(id);
  for (const id of out.owned) {
    const def = WEAPONS[id];
    if (def.kind !== "gun") continue;
    const mag = (r["mag"] as Record<string, unknown> | undefined)?.[id], ammo = (r["ammo"] as Record<string, unknown> | undefined)?.[id];
    if (finite(mag)) out.mag[id] = Math.min(Math.max(Math.round(mag), 0), def.mag);
    if (finite(ammo)) out.ammo[id] = Math.min(Math.max(Math.round(ammo), 0), def.mag * 6);
  }
  if (known(r["current"]) && (r["current"] === "fists" || out.owned.includes(r["current"]))) out.current = r["current"];
  return out;
}

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
  // Version inconnue (plus récente que ce jeu) : on n'y touche pas. Les anciennes versions sont migrées ici.
  const version = r["version"];
  if (version !== SAVE_VERSION && version !== 3 && version !== 2 && version !== 1) return null;
  const p = r["player"] as Record<string, unknown> | undefined;
  const cam = r["camera"] as Record<string, unknown> | undefined;
  const clock = r["clock"] as Record<string, unknown> | undefined;
  if (!p || !cam || !clock || !coord(p["x"]) || !coord(p["y"]) || !finite(cam["yaw"]) || !finite(cam["pitch"]) || !finite(clock["hour"]) || !finite(clock["day"])) return null;
  const vehicles: SavedVehicle[] = [];
  if (Array.isArray(r["vehicles"])) {
    for (const v of r["vehicles"] as Record<string, unknown>[]) {
      if (!v || typeof v["id"] !== "string" || !finite(v["variant"]) || !coord(v["x"]) || !coord(v["y"]) || !finite(v["heading"])) continue;
      // Version 1 : le type donne le modèle. Modèle inconnu (retiré du catalogue, ou sauvegarde d'un autre jeu) : le véhicule est écarté.
      const model = version === 1 ? LEGACY_MODELS[v["kind"] as string] : v["model"];
      if (typeof model !== "string" || !vehicleDef(model)) continue;
      vehicles.push({ id: v["id"], model, variant: v["variant"], x: v["x"], y: v["y"], heading: v["heading"] });
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
    arms: parseArms(r["arms"]),
    health: finite(r["health"]) ? Math.min(Math.max(r["health"], 1), MAX_HEALTH) : MAX_HEALTH,
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
