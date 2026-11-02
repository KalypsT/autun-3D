/**
 * Calendrier du jeu (plan « ville vivante », § 1) : logique pure, sans rendu.
 *
 * Le jeu a son temps propre, non calqué sur la vraie date. La seule valeur enregistrée est `date`, le nombre entier de jours de jeu
 * écoulés depuis le début de la partie (0, 1, 2…). Tout le reste en découle :
 * - jour de la semaine : `date % 7` (0 = lundi … 6 = dimanche) ;
 * - saison : `floor(date / L) % 4` (0 printemps, 1 été, 2 automne, 3 hiver), `L` étant la durée d'une saison (7 jours par défaut) ;
 * - jour astronomique de l'année (pour le soleil) : du printemps au 20 mars (jour 79) à l'hiver vers le 21 décembre.
 */

export type Season = 0 | 1 | 2 | 3;
export const SEASON_NAMES = ["Printemps", "Été", "Automne", "Hiver"] as const;
/** Noms d'URL (`?season=`), sans accent. */
export const SEASON_KEYS = ["printemps", "ete", "automne", "hiver"] as const;
export const WEEKDAY_SHORT = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."] as const;
export const WEEKDAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

/** Durées de saison proposées (jours de jeu). */
export const SEASON_LENGTHS = [7, 14] as const;
export type SeasonLength = (typeof SEASON_LENGTHS)[number];

/** Réglages du calendrier : durée d'une saison, saison figée (null : les saisons passent). */
export interface CalendarConfig {
  length: SeasonLength;
  frozen: Season | null;
}

export const DEFAULT_CALENDAR: CalendarConfig = { length: 7, frozen: null };

/** Jour de l'année du début du printemps (20 mars), et durée astronomique d'une saison. */
const SPRING_DOY = 79;
const SEASON_DAYS = 365 / 4;

export type FeastId = "illuminations" | "marche-noel" | "noel" | "fete-musique" | "14-juillet";

/**
 * Fêtes, placées par jour de saison (l'année est raccourcie, les vraies dates n'ont pas de sens). Jours 1 à 7 comptés pour une
 * saison de 7 jours (ils sont étirés pour une saison de 14) ; chaque jour de la plage, la fête dure de `from` à `to` heures
 * (`to` au-delà de 24 déborde sur le lendemain).
 */
interface FeastDef {
  id: FeastId;
  label: string;
  /** Saison et jour du début, saison et jour de la fin (inclus). */
  start: [Season, number];
  end: [Season, number];
  from: number;
  to: number;
}

export const FEASTS: readonly FeastDef[] = [
  { id: "illuminations", label: "Illuminations de Noël", start: [2, 7], end: [3, 3], from: 0, to: 24 },
  { id: "marche-noel", label: "Marché de Noël", start: [3, 1], end: [3, 2], from: 14, to: 22 },
  { id: "noel", label: "Noël", start: [3, 2], end: [3, 2], from: 0, to: 24 },
  { id: "fete-musique", label: "Fête de la musique", start: [1, 1], end: [1, 1], from: 18, to: 25 },
  { id: "14-juillet", label: "14 juillet", start: [1, 3], end: [1, 3], from: 22, to: 24.5 },
];

/** Ce que le jeu lit du calendrier, à une date et une heure. */
export interface CalendarDay {
  date: number;
  /** 0 = lundi … 6 = dimanche. */
  weekday: number;
  season: Season;
  /** Jour dans la saison, de 0 à `L - 1` (affiché de 1 à L). */
  dayInSeason: number;
  /** Avancement dans la saison, de 0 à 1 (exclu) : sert aux transitions douces. */
  t: number;
  /** Jour astronomique de l'année (1 à 365) pour la position du soleil. */
  doy: number;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Jour astronomique de l'année (1 à 365, fractionnaire) d'une saison et d'un avancement dans la saison. */
export function seasonDoy(season: number, t: number): number {
  return mod(SPRING_DOY - 1 + (season + t) * SEASON_DAYS, 365) + 1;
}

/** Le calendrier à une date (entière) et une heure. Une saison figée garde sa saison et le milieu de celle-ci pour le soleil ; la semaine continue de tourner. */
export function calendarAt(date: number, hour: number, config: CalendarConfig = DEFAULT_CALENDAR): CalendarDay {
  const d = Math.max(0, Math.floor(date));
  const L = config.length;
  const weekday = d % 7;
  if (config.frozen !== null) return { date: d, weekday, season: config.frozen, dayInSeason: Math.floor(L / 2), t: 0.5, doy: seasonDoy(config.frozen, 0.5) };
  const season = (Math.floor(d / L) % 4) as Season;
  const dayInSeason = d % L;
  const t = Math.min((dayInSeason + mod(hour, 24) / 24) / L, 0.999999);
  return { date: d, weekday, season, dayInSeason, t, doy: seasonDoy(season, t) };
}

/** Texte sous l'horloge : « Mer. · Été, 3e jour ». */
export function calendarLabel(c: CalendarDay): string {
  const n = c.dayInSeason + 1;
  return `${WEEKDAY_SHORT[c.weekday]} · ${SEASON_NAMES[c.season]}, ${n === 1 ? "1er" : `${n}e`} jour`;
}

/** Jour (0 à L - 1) de la saison de L jours qui correspond au jour `j` (1 à 7) d'une saison de 7 jours. */
const scaleDay = (j: number, L: number, last: boolean): number => (last ? Math.round((j * L) / 7) - 1 : Math.round(((j - 1) * L) / 7));

/** Fêtes en cours à cette date et cette heure. Saison figée : ses jours suivent ceux de la semaine (lundi = 1er jour), ses fêtes reviennent chaque semaine. */
export function activeFeasts(date: number, hour: number, config: CalendarConfig = DEFAULT_CALENDAR): FeastId[] {
  const L = config.length;
  const yearH = 4 * L * 24;
  const d = Math.max(0, Math.floor(date));
  const season = config.frozen ?? Math.floor(d / L) % 4;
  const dayInSeason = config.frozen !== null ? Math.floor(((d % 7) * L) / 7) : d % L;
  const now = ((season * L + dayInSeason) * 24 + mod(hour, 24)) % yearH;
  const out: FeastId[] = [];
  for (const f of FEASTS) {
    const d0 = f.start[0] * L + scaleDay(f.start[1], L, false);
    // Une fête d'un jour reste d'un jour quand la saison s'allonge ; une plage s'étire.
    const single = f.start[0] === f.end[0] && f.start[1] === f.end[1];
    const d1 = single ? d0 : f.end[0] * L + scaleDay(f.end[1], L, true);
    for (let day = d0; day <= d1; day++) {
      const a = day * 24 + f.from, b = day * 24 + f.to;
      // Comparaison circulaire sur l'année (une fête peut finir après le dernier jour de l'hiver).
      if (mod(now - a, yearH) < b - a) {
        out.push(f.id);
        break;
      }
    }
  }
  return out;
}

/** Date de départ d'une nouvelle partie : été, 1er jour (un lundi). */
export function newGameDate(L: SeasonLength = 7): number {
  return L;
}

/** Date la plus proche d'un jour astronomique (ancienne sauvegarde, `?day=`) : un lundi de la saison qui contient ce jour, la première année. */
export function dateFromDoy(doy: number, L: SeasonLength = 7): number {
  const x = mod(doy - SPRING_DOY, 365) / SEASON_DAYS;
  const season = Math.min(Math.floor(x), 3);
  const want = (x - season) * L;
  // Lundis de la saison : jours de la saison dont la date est un multiple de 7.
  let best = season * L, bestErr = Infinity;
  for (let d = 0; d < L; d++) {
    const date = season * L + d;
    if (date % 7 !== 0) continue;
    const err = Math.abs(d + 0.5 - want);
    if (err < bestErr) [best, bestErr] = [date, err];
  }
  return best;
}

/**
 * Date équivalente quand la durée des saisons change : même saison, même avancement dans la saison (au jour près), même jour de la
 * semaine, et pas avant la date actuelle (une partie ne recule pas dans le temps).
 */
export function rescaleDate(date: number, from: SeasonLength, to: SeasonLength): number {
  if (from === to) return date;
  const d = Math.max(0, Math.floor(date));
  const year = Math.floor(d / (4 * from));
  const season = Math.floor(d / from) % 4;
  const frac = (d % from) / from;
  const target = year * 4 * to + season * to + Math.floor(frac * to);
  // Même jour de la semaine : on avance jusqu'à le retrouver (au plus 6 jours).
  let out = target + mod((d % 7) - (target % 7), 7);
  // Une saison de 7 jours n'a qu'un jour de chaque sorte : si on est sorti de la saison, on revient d'une semaine.
  if (Math.floor(out / to) % 4 !== season && out - 7 >= 0) out -= 7;
  return out;
}

/** Date imposée par l'URL : `?date=N`, sinon `?day=` (jour de l'année, comme une ancienne sauvegarde) ; puis `?season=` et `?weekday=1..7` la déplacent. */
export function dateFromParams(params: URLSearchParams, fallback: number, L: SeasonLength = 7): number {
  let date = fallback;
  const n = Number(params.get("date"));
  if (params.has("date") && Number.isFinite(n) && n >= 0) date = Math.floor(n);
  else if (params.has("day") && Number.isFinite(Number(params.get("day")))) date = dateFromDoy(Number(params.get("day")), L);
  const s = SEASON_KEYS.indexOf((params.get("season") ?? "") as (typeof SEASON_KEYS)[number]);
  if (s >= 0) {
    const year = Math.floor(date / (4 * L));
    date = year * 4 * L + s * L;
  }
  const w = Number(params.get("weekday"));
  if (params.has("weekday") && Number.isInteger(w) && w >= 1 && w <= 7) {
    // Le jour voulu de la semaine en cours (on garde la saison).
    const monday = date - (date % 7);
    date = monday + (w - 1);
  }
  return date;
}
