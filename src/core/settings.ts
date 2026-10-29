/**
 * Réglages du joueur, enregistrés localement. Les paramètres d'URL (`?dpr=`, `?shadowmap=`, `?shadow=0`, `?detail=`, `?peds=`) restent prioritaires :
 * le réglage correspondant est alors imposé et l'écran des réglages le signale.
 */

import { browserStorage, type StorageLike } from "./save";

export interface Settings {
  /** Définition : densité de pixels maximale (1 à 3). */
  dpr: number;
  /** Ombres : 0 = aucune, sinon taille de la carte d'ombres (2048 ou 4096). */
  shadows: 0 | 2048 | 4096;
  /** Rayon de chargement des tuiles détaillées (m). */
  detail: number;
  /** Sensibilité de la caméra au doigt (1 = comme avant). */
  sensitivity: number;
  /** Minimap : nord toujours en haut au lieu de tourner avec la caméra. */
  minimapNorth: boolean;
  /** Foule : nombre maximal de passants à la fois (0 = aucun). Le nombre réel suit l'heure et le lieu (D39). */
  crowd: number;
  /** Circulation : nombre maximal de voitures à la fois (0 = aucune). Le nombre réel suit l'heure et le lieu (D64). */
  traffic: number;
  /** Volume général des sons (0 = muet, 1 = plein) (J7, D89). */
  volume: number;
  /** Vibrations du téléphone aux chocs, tirs et coups reçus (D90). */
  vibration: boolean;
  /** Plein écran (et paysage verrouillé) au premier appui sur le jeu. */
  fullscreen: boolean;
}

export const DEFAULT_SETTINGS: Settings = { dpr: 2.5, shadows: 4096, detail: 300, sensitivity: 1, minimapNorth: false, crowd: 100, traffic: 20, volume: 0.8, vibration: true, fullscreen: true };

export const DPR_CHOICES = [1.5, 2, 2.5, 3] as const;
export const SHADOW_CHOICES = [0, 2048, 4096] as const;
export const DETAIL_CHOICES = [200, 300, 400] as const;
export const CROWD_CHOICES = [0, 40, 100, 150] as const;
export const TRAFFIC_CHOICES = [0, 10, 20, 30] as const;
export const SENSITIVITY_RANGE = { min: 0.5, max: 2, step: 0.1 } as const;
export const VOLUME_STEP = 0.05;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const nearest = <T extends number>(choices: readonly T[], v: number): T => choices.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/** Réglages lus d'un JSON quelconque : chaque champ invalide retombe sur sa valeur par défaut. */
export function parseSettings(raw: unknown): Settings {
  const o = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const dpr = num(o["dpr"]), shadows = num(o["shadows"]), detail = num(o["detail"]), sens = num(o["sensitivity"]), crowd = num(o["crowd"]), traffic = num(o["traffic"]), volume = num(o["volume"]);
  return {
    dpr: dpr === null ? d.dpr : nearest(DPR_CHOICES, dpr),
    shadows: shadows === null ? d.shadows : nearest(SHADOW_CHOICES, shadows),
    detail: detail === null ? d.detail : nearest(DETAIL_CHOICES, detail),
    sensitivity: sens === null ? d.sensitivity : Math.min(Math.max(Math.round(sens * 10) / 10, SENSITIVITY_RANGE.min), SENSITIVITY_RANGE.max),
    minimapNorth: typeof o["minimapNorth"] === "boolean" ? o["minimapNorth"] : d.minimapNorth,
    crowd: crowd === null ? d.crowd : nearest(CROWD_CHOICES, crowd),
    traffic: traffic === null ? d.traffic : nearest(TRAFFIC_CHOICES, traffic),
    volume: volume === null ? d.volume : roundVolume(volume),
    vibration: typeof o["vibration"] === "boolean" ? o["vibration"] : d.vibration,
    fullscreen: typeof o["fullscreen"] === "boolean" ? o["fullscreen"] : d.fullscreen,
  };
}

/** Volume ramené entre 0 et 1, par pas de 5 %. */
function roundVolume(v: number): number {
  return Math.min(Math.max(Math.round(v / VOLUME_STEP) * VOLUME_STEP, 0), 1);
}

export type SettingKey = keyof Settings;

/**
 * Réglages réellement appliqués : ceux du joueur, sauf si l'URL en impose un. `locked` liste les réglages imposés
 * (à griser dans l'interface). Une valeur d'URL est reprise telle quelle (elle sert aux comparaisons et au banc).
 */
export function effectiveSettings(stored: Settings, params: URLSearchParams): { values: Settings; locked: Set<SettingKey> } {
  const values = { ...stored };
  const locked = new Set<SettingKey>();
  const dpr = num(params.get("dpr") === null ? null : Number(params.get("dpr")));
  if (dpr !== null && dpr > 0) {
    values.dpr = dpr;
    locked.add("dpr");
  }
  if (params.get("shadow") === "0") {
    values.shadows = 0;
    locked.add("shadows");
  } else if (params.has("shadowmap")) {
    const m = num(Number(params.get("shadowmap")));
    if (m !== null && m > 0) {
      values.shadows = m as Settings["shadows"];
      locked.add("shadows");
    }
  }
  const detail = num(params.get("detail") === null ? null : Number(params.get("detail")));
  if (detail !== null && detail > 0) {
    values.detail = detail;
    locked.add("detail");
  }
  // ?peds=0 coupe les passants, ?peds=150 impose leur nombre maximal (captures, comparaisons).
  const peds = num(params.get("peds") === null ? null : Number(params.get("peds")));
  if (peds !== null && peds >= 0) {
    values.crowd = Math.min(Math.floor(peds), 400);
    locked.add("crowd");
  }
  // ?traffic=N impose le nombre maximal de voitures (0 : aucune ; borné à 60).
  const traffic = num(params.get("traffic") === null ? null : Number(params.get("traffic")));
  if (traffic !== null && traffic >= 0) {
    values.traffic = Math.min(Math.floor(traffic), 60);
    locked.add("traffic");
  }
  // ?sound=0 coupe le son (captures, banc), ?volume=0.5 l'impose.
  const volume = params.get("sound") === "0" ? 0 : num(params.get("volume") === null ? null : Number(params.get("volume")));
  if (volume !== null && volume >= 0) {
    values.volume = roundVolume(volume);
    locked.add("volume");
  }
  // ?vibrate=0 coupe les vibrations (essais).
  if (params.get("vibrate") === "0") {
    values.vibration = false;
    locked.add("vibration");
  }
  return { values, locked };
}

export const SETTINGS_KEY = "autun3d.settings";

/** Réglages enregistrés localement : lecture et écriture sans exception (stockage absent, interdit ou plein). */
export class SettingsStore {
  constructor(private readonly storage: StorageLike | null = browserStorage()) {}

  load(): Settings {
    try {
      const text = this.storage?.getItem(SETTINGS_KEY);
      return parseSettings(text ? JSON.parse(text) : null);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  write(settings: Settings): boolean {
    try {
      if (!this.storage) return false;
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  }
}
