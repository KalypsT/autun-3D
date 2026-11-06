/**
 * Le rythme de la semaine (plan « ville vivante », § 7, D201) : logique pure. Marché du mercredi et du vendredi matin sur la place du
 * Champ de Mars, jours d'école, dimanche (messe à Saint-Lazare, promeneurs l'après-midi, moins de voitures).
 *
 * Jours : 0 = lundi … 6 = dimanche (`calendar.ts`).
 */

import { CATHEDRAL } from "./sound-model";

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Jours de marché : mercredi et vendredi. */
export const MARKET_DAYS = [2, 4] as const;

/**
 * Le marché, de 0 (rien) à 1 (plein) : installation de 5 h à 7 h (les étals apparaissent un à un), plein de 7 h à 12 h 30,
 * remballage jusqu'à 13 h 30.
 */
export function marketLevel(weekday: number, hour: number): number {
  if (!(MARKET_DAYS as readonly number[]).includes(weekday)) return 0;
  if (hour < 5 || hour >= 13.5) return 0;
  if (hour < 7) return (hour - 5) / 2;
  if (hour < 12.5) return 1;
  return 1 - (hour - 12.5);
}

/**
 * Emprise du marché : le grand parking du Champ de Mars (rangées de D154), dans son repère (origine (−45 ; −57), `u` le long de la rue du
 * Champ de Mars vers le nord-est, à 32,7° de l'est ; `v` vers le sud-est).
 */
export const MARKET = { ox: -45, oy: -57, angle: (32.7 * Math.PI) / 180, u: [-26, 43] as const, v: [-19, 19] as const };

/** Le point (x, y) est-il sur le marché ? */
export function inMarket(x: number, y: number): boolean {
  const dx = x - MARKET.ox, dy = y - MARKET.oy;
  const c = Math.cos(MARKET.angle), s = Math.sin(MARKET.angle);
  const u = dx * c + dy * s, v = dx * s - dy * c;
  return u >= MARKET.u[0] && u <= MARKET.u[1] && v >= MARKET.v[0] && v <= MARKET.v[1];
}

/** Centre du marché (repère du jeu). */
export function marketCenter(): [number, number] {
  const um = (MARKET.u[0] + MARKET.u[1]) / 2, vm = (MARKET.v[0] + MARKET.v[1]) / 2;
  const c = Math.cos(MARKET.angle), s = Math.sin(MARKET.angle);
  return [MARKET.ox + um * c + vm * s, MARKET.oy + um * s - vm * c];
}

/** Jours de classe : lundi, mardi, jeudi, vendredi toute la journée ; mercredi matin ; pas le week-end. Heures d'ouverture de la grille. */
export function schoolOpen(weekday: number, hour: number, from = 7.5, to = 18): boolean {
  if (weekday >= 5) return false;
  const end = weekday === 2 ? 12.5 : to;
  return hour >= from && hour < end;
}

/**
 * Plus ou moins de passants selon le jour et l'endroit (multiplie la cible de la foule) : marché (plus du double autour des étals),
 * sortie de la messe le dimanche (parvis de Saint-Lazare, 11 h 30 à 12 h), promeneurs du dimanche après-midi dans les parcs et la nature.
 */
export function crowdWeek(weekday: number, hour: number, x: number, y: number, zone: number): number {
  let k = 1;
  const m = marketLevel(weekday, hour);
  if (m > 0) {
    const [cx, cy] = marketCenter();
    k *= 1 + 1.4 * m * (1 - smooth(60, 160, Math.hypot(x - cx, y - cy)));
  }
  if (weekday === 6) {
    const mass = smooth(11.2, 11.5, hour) * (1 - smooth(12, 12.4, hour));
    k *= 1 + 1.5 * mass * (1 - smooth(60, 140, Math.hypot(x - CATHEDRAL.x, y - CATHEDRAL.y)));
    // Zone 3 : nature (parcs, bords de l'eau) ; 2 : périphérie.
    if (zone === 3) k *= 1 + 1.2 * smooth(13.5, 14.5, hour) * (1 - smooth(18, 19, hour));
  }
  return k;
}

/** Emprise du plan d'eau du Vallon et de son tour (D249) : x0, y0, x1, y1 (repère local, m). */
export const VALLON_BOX = [950, -70, 1560, 700] as const;

/**
 * Promeneurs et joggeurs du tour du lac du Vallon (D249, plan vallon-lac §7) : une promenade très courue. Dans l'emprise du lac, une
 * fois et demie plus de passants ; le week-end l'après-midi (13 h 30 à 19 h), encore 60 % de plus ; l'été en fin de journée (17 h 30 à
 * 21 h), 30 % de plus ; l'hiver, 30 % de moins. Hors de l'emprise : 1. `season` : 0 printemps, 1 été, 2 automne, 3 hiver.
 */
export function crowdVallon(weekday: number, hour: number, season: number, x: number, y: number): number {
  const [x0, y0, x1, y1] = VALLON_BOX;
  if (x < x0 || x > x1 || y < y0 || y > y1) return 1;
  let k = 1.5;
  if (weekday >= 5) k *= 1 + 0.6 * smooth(13, 13.5, hour) * (1 - smooth(19, 19.5, hour));
  if (season === 1) k *= 1 + 0.3 * smooth(17, 17.5, hour) * (1 - smooth(21, 21.5, hour));
  if (season === 3) k *= 0.7;
  return k;
}

/** Moins de voitures le samedi (×0,85) et le dimanche (×0,6). */
export function trafficWeek(weekday: number): number {
  return weekday === 6 ? 0.6 : weekday === 5 ? 0.85 : 1;
}

/** Les cloches sonnent la messe (volée) le dimanche à 10 h 15 : vrai si l'heure vient de passer 10 h 15 entre `prev` et `hour`. */
export function massPeal(weekday: number, prev: number, hour: number): boolean {
  return weekday === 6 && prev < 10.25 && hour >= 10.25 && hour - prev < 0.25;
}

/** Places de la fête de la musique (D202) : place du Champ de Mars (kiosque), place du Terreau, parvis de Saint-Lazare, rue aux Cordiers. */
export const MUSIC_SPOTS: readonly { x: number; y: number; heading: number; key: number }[] = [
  { x: -18, y: -48, heading: 0.6, key: 0 },
  { x: 60, y: -528, heading: 2.4, key: 5 },
  { x: 30, y: -548, heading: 3.4, key: 7 },
  { x: 14, y: -186, heading: -0.6, key: 3 },
];

/**
 * Foule des fêtes (D202) : deux fois plus de monde autour des musiciens le soir de la fête de la musique, le triple au bord du plan
 * d'eau du Vallon pour le feu du 14 juillet, le double sur le marché de Noël. `feasts` : fêtes en cours (`activeFeasts`).
 */
export function crowdFeast(feasts: readonly string[], x: number, y: number, lake: { x: number; y: number }): number {
  let k = 1;
  if (feasts.includes("fete-musique")) {
    let near = 0;
    for (const s of MUSIC_SPOTS) near = Math.max(near, 1 - smooth(40, 120, Math.hypot(x - s.x, y - s.y)));
    k *= 1 + 1.2 * near;
  }
  if (feasts.includes("14-juillet")) k *= 1 + 2 * (1 - smooth(300, 600, Math.hypot(x - lake.x, y - lake.y)));
  if (feasts.includes("marche-noel")) {
    const [cx, cy] = marketCenter();
    k *= 1 + 1.2 * (1 - smooth(60, 160, Math.hypot(x - cx, y - cy)));
  }
  return k;
}

/**
 * Véhicules de service voulus (D204) : un bus de 6 h 30 à 20 h 30 du lundi au samedi ; le camion poubelle le mardi et le vendredi de 5 h à 8 h ;
 * deux camionnettes de livraison du lundi au samedi de 6 h à 10 h.
 */
export function servicesWanted(weekday: number, hour: number): { bus: number; benne: number; livraison: number } {
  const workday = weekday <= 5;
  return {
    bus: workday && hour >= 6.5 && hour < 20.5 ? 1 : 0,
    benne: (weekday === 1 || weekday === 4) && hour >= 5 && hour < 8 ? 1 : 0,
    livraison: workday && hour >= 6 && hour < 10 ? 2 : 0,
  };
}
