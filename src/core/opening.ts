/**
 * Heures d'ouverture des commerces (plan « ville vivante », § 6.2, D200) : logique pure. Les données n'ont pas d'horaires (la chaîne ne
 * garde pas `opening_hours` d'OpenStreetMap) : chaque type de commerce a un horaire type, à la française (fermé le dimanche, sauf
 * boulangeries, tabacs et cafés le matin ; coupure de midi pour les services).
 *
 * Analogie : la pancarte « ouvert / fermé » accrochée à la porte, la même pour toutes les boulangeries de la ville.
 */

/** Horaires types. L'indice sert de case dans le nuanceur des vitrines (au plus 12). */
export const SCHEDULES = ["boulangerie", "café", "bar", "restaurant", "restauration rapide", "boutique", "supérette", "pharmacie", "tabac", "service", "toujours", "fermé"] as const;
export type ScheduleId = number;

const S = Object.fromEntries(SCHEDULES.map((n, i) => [n, i])) as Record<(typeof SCHEDULES)[number], number>;

/** Plages d'ouverture (heures, la fin peut dépasser 24) par jour de la semaine (0 = lundi … 6 = dimanche). */
type Week = readonly (readonly [number, number])[][];
const days = (mon: (readonly [number, number])[], tueSat: (readonly [number, number])[], sun: (readonly [number, number])[]): Week =>
  [mon, tueSat, tueSat, tueSat, tueSat, tueSat, sun];

const WEEKS: readonly Week[] = [
  days([[7, 19.5]], [[7, 19.5]], [[7, 12.5]]),
  days([[7, 24]], [[7, 24]], [[8, 24]]),
  days([[11, 25]], [[11, 25]], [[11, 24]]),
  days([], [[11.75, 14.25], [19, 22.5]], [[11.75, 14.5]]),
  days([[11, 23]], [[11, 23]], [[11, 23]]),
  days([[14, 19]], [[9.5, 19]], []),
  days([[8.5, 20]], [[8.5, 20]], [[9, 12.5]]),
  days([[9, 12.5], [14, 19]], [[9, 12.5], [14, 19]], []),
  days([[7, 19.5]], [[7, 19.5]], [[8, 12.5]]),
  days([], [[9, 12], [14, 18]], []),
  days([[0, 24]], [[0, 24]], [[0, 24]]),
  days([], [], []),
];

const BY_KIND: Record<string, number> = {
  bakery: S["boulangerie"], pastry: S["boulangerie"], confectionery: S["boulangerie"],
  cafe: S["café"], coffee: S["café"], ice_cream: S["café"],
  bar: S["bar"], pub: S["bar"],
  restaurant: S["restaurant"],
  fast_food: S["restauration rapide"],
  convenience: S["supérette"], supermarket: S["supérette"], greengrocer: S["supérette"], butcher: S["supérette"], deli: S["supérette"], farm: S["supérette"],
  pharmacy: S["pharmacie"], chemist: S["pharmacie"], optician: S["pharmacie"], medical_supply: S["pharmacie"],
  tobacco: S["tabac"], newsagent: S["tabac"], "e-cigarette": S["tabac"],
  bank: S["service"], estate_agent: S["service"], travel_agency: S["service"], hairdresser: S["service"], beauty: S["service"], insurance: S["service"],
  post_office: S["service"], funeral_directors: S["service"], car_repair: S["service"], laundry: S["service"], tattoo: S["service"],
  hospital: S["toujours"], fuel: S["toujours"],
  vacant: S["fermé"],
};

/** Horaire type d'un commerce d'après son genre OpenStreetMap (`shop` ou `amenity`) ; inconnu : une boutique. */
export function scheduleOf(kind: string | null | undefined): ScheduleId {
  return (kind ? BY_KIND[kind] : undefined) ?? S["boutique"];
}

/** Ouvert à cette heure (0 à 24) ce jour de la semaine (0 = lundi) ? Une plage qui finit après minuit déborde sur le lendemain. */
export function isOpen(schedule: ScheduleId, weekday: number, hour: number): boolean {
  const week = WEEKS[schedule] ?? WEEKS[S["boutique"]]!;
  const h = ((hour % 24) + 24) % 24, w = ((weekday % 7) + 7) % 7;
  for (const [a, b] of week[w]!) if (h >= a && h < b) return true;
  for (const [, b] of week[(w + 6) % 7]!) if (b > 24 && h < b - 24) return true;
  return false;
}

/** Ouverture de chaque horaire type (1 ouvert, 0 fermé), dans l'ordre de `SCHEDULES` : ce que reçoit le nuanceur. */
export function openingTable(weekday: number, hour: number, out: number[] = new Array<number>(SCHEDULES.length)): number[] {
  for (let i = 0; i < SCHEDULES.length; i++) out[i] = isOpen(i, weekday, hour) ? 1 : 0;
  return out;
}

const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

/** Heure lisible : « 9 h 30 », « 19 h », « minuit ». */
export function hourText(h: number): string {
  const t = ((h % 24) + 24) % 24, m = Math.round((t % 1) * 60), hh = Math.floor(t) + (m === 60 ? 1 : 0);
  if (hh % 24 === 0 && (m === 0 || m === 60)) return "minuit";
  return m === 0 || m === 60 ? `${hh} h` : `${hh} h ${String(m).padStart(2, "0")}`;
}

/** Prochaine ouverture après (jour, heure) dans la semaine qui vient : jours à attendre (0 aujourd'hui) et heure ; null si jamais ouvert. */
export function nextOpening(schedule: ScheduleId, weekday: number, hour: number): { days: number; hour: number } | null {
  const week = WEEKS[schedule] ?? WEEKS[S["boutique"]]!;
  const w = ((weekday % 7) + 7) % 7;
  for (let d = 0; d < 8; d++) {
    const starts = week[(w + d) % 7]!.map(([a]) => a).filter((a) => d > 0 || a > hour).sort((a, b) => a - b);
    if (starts.length) return { days: d, hour: starts[0]! };
  }
  return null;
}

/** « ouvre à 9 h 30 », « ouvre demain à 7 h », « ouvre mardi à 9 h » ; « ne rouvre pas » si l'horaire est toujours fermé. */
export function openingText(schedule: ScheduleId, weekday: number, hour: number): string {
  const n = nextOpening(schedule, weekday, hour);
  if (!n) return "ne rouvre pas";
  const when = n.days === 0 ? "" : n.days === 1 ? "demain " : `${DAY_NAMES[(((weekday + n.days) % 7) + 7) % 7]} `;
  return `ouvre ${when}à ${hourText(n.hour)}`;
}

/** Heure de fermeture de la plage en cours (pour « ouvert jusqu'à 19 h 30 ») ; null si fermé. */
export function closingHour(schedule: ScheduleId, weekday: number, hour: number): number | null {
  const week = WEEKS[schedule] ?? WEEKS[S["boutique"]]!;
  const w = ((weekday % 7) + 7) % 7, h = ((hour % 24) + 24) % 24;
  for (const [a, b] of week[w]!) if (h >= a && h < b) return b;
  for (const [, b] of week[(w + 6) % 7]!) if (b > 24 && h < b - 24) return b - 24;
  return null;
}
