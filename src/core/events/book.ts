import { TIER_REWARDS } from "../challenges";
import type { EventEnd } from "./director";

/**
 * Carnet des événements (phase 4) : les comptes de la partie (voleurs rattrapés, bonnes actions…), trois défis à paliers comme ceux de D319
 * (bronze, argent, or, mêmes primes), et le journal du jour (onglet « Faits divers » du carnet). Logique pure.
 */

export const EVENT_CHALLENGES = [
  { id: "voleurs", label: "Voleurs rattrapés", tiers: [1, 5, 15] },
  { id: "fugitifs", label: "Fugitifs arrêtés", tiers: [1, 3, 8] },
  { id: "bonnes", label: "Bonnes actions", tiers: [5, 20, 50] },
] as const;

export type EventChallengeId = (typeof EVENT_CHALLENGES)[number]["id"];

/** Une ligne du journal : date du jeu, heure, texte (« Vol à l'arraché, rue aux Cordiers · voleur rattrapé »). */
export interface BookLine {
  date: number;
  hour: number;
  text: string;
}

export interface SavedEventBook {
  counts: Partial<Record<EventChallengeId, number>>;
  tiers: Partial<Record<EventChallengeId, number>>;
  lines: BookLine[];
}

/** Un palier franchi : le défi, le palier (1 bronze, 2 argent, 3 or), la prime. */
export interface EventTierHit {
  id: EventChallengeId;
  label: string;
  tier: 1 | 2 | 3;
  goal: number;
  reward: number;
}

/** Le but d'un palier en mots : « 1 voleur rattrapé », « 5 voleurs rattrapés », « 20 bonnes actions ». */
export function eventGoal(id: EventChallengeId, n: number): string {
  const one = n === 1;
  switch (id) {
    case "voleurs": return `${n} ${one ? "voleur rattrapé" : "voleurs rattrapés"}`;
    case "fugitifs": return `${n} ${one ? "fugitif arrêté" : "fugitifs arrêtés"}`;
    case "bonnes": return `${n} ${one ? "bonne action" : "bonnes actions"}`;
  }
}

/** Lignes de journal gardées (les plus récentes). */
const MAX_LINES = 30;

export class EventBook {
  readonly counts: Record<EventChallengeId, number> = { voleurs: 0, fugitifs: 0, bonnes: 0 };
  readonly tiers: Record<EventChallengeId, number> = { voleurs: 0, fugitifs: 0, bonnes: 0 };
  readonly lines: BookLine[] = [];

  constructor(saved?: SavedEventBook | null) {
    if (!saved) return;
    for (const c of EVENT_CHALLENGES) {
      this.counts[c.id] = saved.counts[c.id] ?? 0;
      this.tiers[c.id] = saved.tiers[c.id] ?? 0;
    }
    this.lines.push(...saved.lines.slice(-MAX_LINES));
  }

  /** Un événement fini : ses comptes, et les paliers qu'il fait franchir. */
  record(end: EventEnd): EventTierHit[] {
    const hits: EventTierHit[] = [];
    // Un pickpocket rattrapé est aussi un voleur rattrapé.
    if (end.caught && (end.kind === "vol" || end.kind === "pickpocket")) hits.push(...this.bump("voleurs"));
    if (end.goodDeed) hits.push(...this.bump("bonnes"));
    return hits;
  }

  /** Ajoute une ligne au journal. */
  note(date: number, hour: number, text: string): void {
    this.lines.push({ date, hour, text });
    if (this.lines.length > MAX_LINES) this.lines.shift();
  }

  /** Lignes d'un jour (le plus récent d'abord). */
  day(date: number): BookLine[] {
    return this.lines.filter((l) => l.date === date).reverse();
  }

  private bump(id: EventChallengeId): EventTierHit[] {
    this.counts[id]++;
    const def = EVENT_CHALLENGES.find((c) => c.id === id)!;
    const out: EventTierHit[] = [];
    while (this.tiers[id] < 3 && this.counts[id] >= def.tiers[this.tiers[id]]!) {
      const tier = (this.tiers[id] + 1) as 1 | 2 | 3;
      this.tiers[id] = tier;
      out.push({ id, label: def.label, tier, goal: def.tiers[tier - 1]!, reward: TIER_REWARDS[tier - 1]! });
    }
    return out;
  }

  toSave(): SavedEventBook {
    const counts: Partial<Record<EventChallengeId, number>> = {}, tiers: Partial<Record<EventChallengeId, number>> = {};
    for (const c of EVENT_CHALLENGES) {
      if (this.counts[c.id] > 0) counts[c.id] = this.counts[c.id];
      if (this.tiers[c.id] > 0) tiers[c.id] = this.tiers[c.id];
    }
    return { counts, tiers, lines: this.lines.map((l) => ({ ...l })) };
  }
}

/** Carnet enregistré, lu avec méfiance : comptes entiers positifs, paliers de 0 à 3, lignes valides ; null si absent ou illisible. */
export function parseEventBook(o: unknown): SavedEventBook | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const int = (v: unknown, max: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), max) : 0);
  const counts: Partial<Record<EventChallengeId, number>> = {}, tiers: Partial<Record<EventChallengeId, number>> = {};
  const c = (r["counts"] ?? {}) as Record<string, unknown>, t = (r["tiers"] ?? {}) as Record<string, unknown>;
  for (const d of EVENT_CHALLENGES) {
    if (typeof c === "object" && c[d.id] !== undefined) counts[d.id] = int(c[d.id], 1e6);
    if (typeof t === "object" && t[d.id] !== undefined) tiers[d.id] = int(t[d.id], 3);
  }
  const lines: BookLine[] = [];
  if (Array.isArray(r["lines"])) {
    for (const l of r["lines"].slice(-MAX_LINES)) {
      if (!l || typeof l !== "object") continue;
      const { date, hour, text } = l as Record<string, unknown>;
      if (typeof date === "number" && Number.isFinite(date) && typeof hour === "number" && Number.isFinite(hour) && typeof text === "string" && text.length < 200) {
        lines.push({ date: Math.max(0, Math.round(date)), hour: Math.min(Math.max(hour, 0), 24), text });
      }
    }
  }
  return { counts, tiers, lines };
}
