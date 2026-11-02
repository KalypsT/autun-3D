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

/** Moins de voitures le samedi (×0,85) et le dimanche (×0,6). */
export function trafficWeek(weekday: number): number {
  return weekday === 6 ? 0.6 : weekday === 5 ? 0.85 : 1;
}

/** Les cloches sonnent la messe (volée) le dimanche à 10 h 15 : vrai si l'heure vient de passer 10 h 15 entre `prev` et `hour`. */
export function massPeal(weekday: number, prev: number, hour: number): boolean {
  return weekday === 6 && prev < 10.25 && hour >= 10.25 && hour - prev < 0.25;
}
