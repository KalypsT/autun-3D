/**
 * Météo du jeu (plan « ville vivante », § 2) : logique pure, sans rendu, sans rien à enregistrer.
 *
 * Le temps est découpé en épisodes de 2 à 4 heures de jeu, tirés d'une graine dérivée de la date : une partie retrouve la même météo
 * après un rechargement. Chaque épisode a un genre (beau, nuageux, pluie, orage, brume, neige), tiré selon la saison ; un épisode a une
 * chance sur deux de garder le genre du précédent (le temps dure un peu), ce qui ne change pas les parts du tableau. Entre deux épisodes,
 * une transition de 20 à 40 minutes : les nuages arrivent avant la pluie et partent après. La sortie est un état continu, chaque valeur
 * entre 0 et 1 ; le sol mouillé et la neige au sol se déduisent des heures précédentes (ils sèchent et fondent lentement).
 *
 * Analogie : un bulletin météo écrit d'avance pour toute l'année, qu'on relit à l'heure qu'il est.
 */

import type { Season } from "./calendar";

export type WeatherKind = "beau" | "nuageux" | "pluie" | "orage" | "brume" | "neige";
export const WEATHER_KINDS: readonly WeatherKind[] = ["beau", "nuageux", "pluie", "orage", "brume", "neige"];
export const WEATHER_NAMES: Record<WeatherKind, string> = { beau: "Beau temps", nuageux: "Nuageux", pluie: "Pluie", orage: "Orage", brume: "Brume", neige: "Neige" };

/** L'état du ciel et du sol à un instant, chaque valeur entre 0 et 1. */
export interface WeatherState {
  /** Genre de l'épisode en cours (le plus avancé pendant une transition). */
  kind: WeatherKind;
  /** Couverture nuageuse. */
  cloud: number;
  /** Intensité de la pluie qui tombe. */
  rain: number;
  /** Brume (brouillard rapproché). */
  fog: number;
  /** Neige qui tombe. */
  snowfall: number;
  /** Neige (ou givre) au sol. */
  snow: number;
  /** Sol mouillé. */
  wet: number;
  /** Orage (éclairs, tonnerre). */
  storm: number;
}

/** Parts de chaque genre par saison (printemps, été, automne, hiver), en pourcentage (tableau du plan). */
export const WEATHER_TABLE: readonly Readonly<Partial<Record<WeatherKind, number>>>[] = [
  { beau: 50, nuageux: 30, pluie: 20 },
  { beau: 70, nuageux: 15, pluie: 5, orage: 10 },
  { beau: 35, nuageux: 30, pluie: 25, brume: 10 },
  { beau: 40, nuageux: 30, pluie: 15, neige: 15 },
];

/** Heures où un épisode peut commencer pour l'orage (le soir) et la brume (le matin), et l'heure à laquelle il doit être fini. */
const WINDOWS: Partial<Record<WeatherKind, { from: number; to: number; end: number }>> = {
  orage: { from: 15.5, to: 21.5, end: 24 },
  brume: { from: 4.5, to: 8, end: 10.5 },
};

/** Ce que chaque genre vise. La pluie de printemps est plus légère (averses). */
const LOOK: Record<WeatherKind, Omit<WeatherState, "kind" | "snow" | "wet">> = {
  beau: { cloud: 0.12, rain: 0, fog: 0, snowfall: 0, storm: 0 },
  nuageux: { cloud: 0.7, rain: 0, fog: 0, snowfall: 0, storm: 0 },
  pluie: { cloud: 0.95, rain: 0.75, fog: 0.15, snowfall: 0, storm: 0 },
  orage: { cloud: 1, rain: 1, fog: 0.1, snowfall: 0, storm: 1 },
  brume: { cloud: 0.45, rain: 0, fog: 1, snowfall: 0, storm: 0 },
  neige: { cloud: 0.9, rain: 0, fog: 0.3, snowfall: 0.8, storm: 0 },
};

/** Un épisode : du début à la fin (heures depuis minuit de son jour, la fin au plus 24), son genre et sa transition d'entrée (heures). */
export interface Episode {
  start: number;
  end: number;
  kind: WeatherKind;
  fade: number;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Graine d'une journée : la date mélangée (et une graine de partie, 0 par défaut). */
const daySeed = (date: number, salt: number): number => Math.imul((date + 1) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 7, 0xc2b2ae35);

function draw(season: Season, start: number, r: () => number): WeatherKind {
  const table = WEATHER_TABLE[season]!;
  const allowed = (Object.keys(table) as WeatherKind[]).filter((k) => {
    const w = WINDOWS[k];
    return !w || (start >= w.from && start <= w.to);
  });
  // L'orage et la brume n'ont droit qu'à quelques heures par jour : dans leur fenêtre, leur part est relevée pour garder à peu près
  // la part du tableau sur la journée (×4 et ×5), et rendue aux autres genres en dehors.
  const weight = (k: WeatherKind): number => (table[k] ?? 0) * (k === "orage" ? 4 : k === "brume" ? 5 : 1);
  const total = allowed.reduce((s, k) => s + weight(k), 0);
  let x = r() * total;
  for (const k of allowed) {
    x -= weight(k);
    if (x < 0) return k;
  }
  return allowed[allowed.length - 1]!;
}

const cache = new Map<string, Episode[]>();

/** Épisodes d'une journée de jeu, de 0 h à 24 h. `season` est celle de cette date (saison figée comprise). Gardés en mémoire (quelques jours). */
export function dayEpisodes(date: number, season: Season, salt = 0): Episode[] {
  const key = `${date}:${season}:${salt}`;
  let hit = cache.get(key);
  if (!hit) {
    if (cache.size > 16) cache.clear();
    cache.set(key, (hit = drawDay(date, season, salt)));
  }
  return hit;
}

function drawDay(date: number, season: Season, salt: number): Episode[] {
  const raw = (d: number): Episode[] => {
    const r = rng(daySeed(d, salt));
    const out: Episode[] = [];
    let t = 0;
    let prev = null as WeatherKind | null;
    while (t < 24) {
      let len = 2 + r() * 2;
      // Un bout de journée de moins de 2 h rejoint l'épisode précédent.
      if (24 - (t + len) < 2) len = 24 - t;
      const pw = prev ? WINDOWS[prev] : undefined;
      const keep = prev !== null && r() < 0.5 && (!pw || (t >= pw.from && t <= pw.to));
      const kind: WeatherKind = keep ? prev! : draw(season, t, r);
      const w = WINDOWS[kind];
      const end = w ? Math.min(t + len, w.end) : t + len;
      out.push({ start: t, end, kind, fade: (20 + r() * 20) / 60 });
      prev = kind;
      t = end;
    }
    return out;
  };
  const all = (eps: Episode[]): boolean => eps.every((e) => e.kind === "pluie" || e.kind === "orage");
  let eps = raw(date);
  // Jamais deux jours de pluie complets d'affilée : on re-tire (avec une autre graine) une journée toute de pluie qui en suit une autre.
  if (all(eps) && date > 0 && all(raw(date - 1))) eps = drawDay(date + 100003, season, salt + 1);
  return eps;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

type Look = Omit<WeatherState, "kind" | "snow" | "wet">;

/** Ce que le ciel montre à `hour` du jour `date` (sans le sol), avec les transitions entre épisodes. */
function skyAt(date: number, hour: number, seasonOf: (date: number) => Season, salt: number): { look: Look; kind: WeatherKind } {
  const eps = dayEpisodes(date, seasonOf(date), salt);
  let i = eps.findIndex((e) => hour < e.end);
  if (i < 0) i = eps.length - 1;
  const cur = eps[i]!;
  // Épisode précédent (la veille au soir pour le premier de la journée).
  const before = i > 0 ? eps[i - 1]! : (() => {
    const y = date > 0 ? dayEpisodes(date - 1, seasonOf(date - 1), salt) : [cur];
    return y[y.length - 1]!;
  })();
  const a = LOOK[before.kind], b = LOOK[cur.kind];
  const since = hour - cur.start, f = cur.fade;
  if (since >= 2 * f || before.kind === cur.kind) return { look: b, kind: cur.kind };
  // Les nuages se forment d'abord, la pluie (ou la neige) tombe ensuite ; à l'inverse, elle cesse avant que le ciel se dégage.
  // Chaque transition dure `f`, le tout `2f` (au plus 1 h 20, un épisode dure au moins 2 h : pas de transition coupée).
  const wetter = b.rain + b.snowfall > a.rain + a.snowfall;
  const tCloud = smooth(wetter ? since / f : (since - f) / f);
  const tFall = smooth(wetter ? (since - f) / f : since / f);
  const tOther = smooth(since / (2 * f));
  const look: Look = {
    cloud: mix(a.cloud, b.cloud, tCloud),
    rain: mix(a.rain, b.rain, tFall),
    snowfall: mix(a.snowfall, b.snowfall, tFall),
    storm: mix(a.storm, b.storm, tFall),
    fog: mix(a.fog, b.fog, tOther),
  };
  return { look, kind: tOther < 0.5 ? before.kind : cur.kind };
}

/** Heures pour sécher (pluie) et pour fondre (neige). */
const DRY_HOURS = 1.5;
const MELT_HOURS = 5;
/** Pas d'échantillonnage des heures passées (h). */
const LOOKBACK_STEP = 1 / 6;

/**
 * Météo continue à une date et une heure. `seasonOf` donne la saison d'une date (calendrier du jeu) ; `salt` change le tirage
 * (partie différente). Coût : quelques dizaines d'évaluations d'épisodes (à appeler quelques fois par seconde au plus).
 */
export function weatherAt(date: number, hour: number, seasonOf: (date: number) => Season, salt = 0): WeatherState {
  const at = (h: number): Look => {
    let d = date, x = h;
    while (x < 0 && d > 0) {
      d--;
      x += 24;
    }
    return skyAt(d, Math.max(x, 0), seasonOf, salt).look;
  };
  const now = skyAt(date, hour, seasonOf, salt);
  // Sol mouillé : le plus mouillé des heures passées, diminué du temps écoulé depuis (il sèche en 1 h 30).
  let wet = now.look.rain;
  for (let k = LOOKBACK_STEP; k <= DRY_HOURS; k += LOOKBACK_STEP) wet = Math.max(wet, Math.min(1, at(hour - k).rain * 1.3) * (1 - k / DRY_HOURS));
  // Neige au sol : une heure de chute blanchit le sol (moyenne glissante d'une heure), puis elle fond en 5 heures.
  const n = Math.round(MELT_HOURS / LOOKBACK_STEP), win = Math.round(1 / LOOKBACK_STEP);
  const fall: number[] = [];
  for (let j = 0; j <= n + win; j++) fall.push(j === 0 ? now.look.snowfall : at(hour - j * LOOKBACK_STEP).snowfall);
  let snow = 0;
  for (let j = 0; j <= n; j++) {
    let sum = 0;
    for (let q = 0; q < win; q++) sum += fall[j + q]!;
    snow = Math.max(snow, Math.min(1, (1.5 * sum) / win) * (1 - j / n));
  }
  // Givre : en hiver, par temps clair, le matin (de 5 h à 10 h, au plus fort vers 7 h).
  if (seasonOf(date) === 3 && hour >= 5 && hour < 10) {
    const morning = hour < 7 ? (hour - 5) / 2 : 1 - (hour - 7) / 3;
    snow = Math.max(snow, 0.25 * morning * (1 - now.look.cloud));
  }
  return { kind: now.kind, ...now.look, wet: Math.min(1, wet), snow: Math.min(1, snow) };
}

/** Météo imposée (`?weather=`) : l'état établi du genre, sol compris (mouillé sous la pluie, blanc sous la neige). */
export function fixedWeather(kind: WeatherKind): WeatherState {
  const l = LOOK[kind];
  return { kind, ...l, wet: l.rain > 0 ? 1 : 0, snow: l.snowfall > 0 ? 1 : 0 };
}

/** `?weather=beau|nuageux|pluie|orage|brume|neige`, ou null. */
export function weatherParam(params: URLSearchParams): WeatherKind | null {
  const v = params.get("weather");
  return v && (WEATHER_KINDS as readonly string[]).includes(v) ? (v as WeatherKind) : null;
}

/** Résumé pour le compteur de `?debug` : « pluie (nuages 95 %, pluie 75 %, sol mouillé 100 %) ». */
export function weatherInfo(w: WeatherState): string {
  const pc = (v: number): string => `${Math.round(v * 100)} %`;
  const parts = [`nuages ${pc(w.cloud)}`];
  if (w.rain > 0.01) parts.push(`pluie ${pc(w.rain)}`);
  if (w.snowfall > 0.01) parts.push(`neige ${pc(w.snowfall)}`);
  if (w.fog > 0.01) parts.push(`brume ${pc(w.fog)}`);
  if (w.wet > 0.01) parts.push(`sol mouillé ${pc(w.wet)}`);
  if (w.snow > 0.01) parts.push(`sol blanc ${pc(w.snow)}`);
  return `${w.kind} (${parts.join(", ")})`;
}

// --- Effets sur le jeu ---------------------------------------------------------------------------------------------------

/** Adhérence du sol, à multiplier à celle des pneus : sec 1, mouillé 0,8, neige 0,6. */
export function surfaceGrip(w: Pick<WeatherState, "wet" | "snow">): number {
  return Math.min(1 - 0.2 * w.wet, 1 - 0.4 * w.snow);
}

/** Part des passants qui restent dehors : pluie 0,45, orage 0,3, neige 0,6, brume 0,9. */
export function crowdWeather(w: Pick<WeatherState, "rain" | "storm" | "snowfall" | "fog">): number {
  return Math.min(1 - 0.55 * w.rain, 1 - 0.7 * w.storm, 1 - 0.4 * w.snowfall, 1 - 0.1 * w.fog);
}

/** Les passants pressent le pas sous la pluie (jusqu'à +20 %). */
export function walkWeather(w: Pick<WeatherState, "rain">): number {
  return 1 + 0.2 * w.rain;
}

/** Circulation sous la pluie : un peu moins de voitures (×0,8), conducteurs plus prudents (vitesse ×0,9). Neige : pareil. */
export function trafficWeather(w: Pick<WeatherState, "rain" | "snow">): { density: number; caution: number } {
  const k = Math.max(w.rain, w.snow);
  return { density: 1 - 0.2 * k, caution: 1 - 0.1 * k };
}
