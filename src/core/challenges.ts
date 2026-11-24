import { RECORD_KINDS, type RecordKind } from "./records";

/**
 * Défis (plaisir de jeu, phase 3, D319) : trois paliers, bronze, argent et or, pour chacun des records du carnet (D312). On touche la prime
 * d'un palier en le franchissant **pendant la partie** : les records d'avant ne comptent pas (ils survivent à une nouvelle partie, les
 * défis non). Logique pure.
 *
 * Analogie : les médailles d'une saison, quand le carnet de records est le palmarès de toute une carrière.
 */

/** Seuils des trois paliers, dans l'unité des records : mètres, m/s (vitesse), secondes (étoiles), mètres (distances). */
export const CHALLENGE_TIERS: Readonly<Record<RecordKind, readonly [number, number, number]>> = {
  jump: [25, 50, 100],
  topSpeed: [120 / 3.6, 180 / 3.6, 250 / 3.6],
  wheelie: [50, 150, 400],
  stoppie: [10, 30, 80],
  drift: [30, 80, 200],
  stars3: [60, 180, 360],
  stars5: [30, 90, 180],
  foot: [5000, 25000, 100000],
  vehicle: [20000, 100000, 500000],
};

/** Prime de chaque palier (€). */
export const TIER_REWARDS = [100, 300, 800] as const;
export const TIER_NAMES = ["bronze", "argent", "or"] as const;

/** Distances : cumulées sur la partie (et non meilleure valeur). */
const CUMULATIVE: ReadonlySet<RecordKind> = new Set(["foot", "vehicle"]);

/** Un palier franchi : le record, le palier (1 bronze, 2 argent, 3 or) et sa prime. */
export interface ChallengeHit {
  kind: RecordKind;
  tier: 1 | 2 | 3;
  reward: number;
}

/** Ce que la sauvegarde garde des défis : palier atteint par record, distances de la partie. */
export interface SavedChallenges {
  tiers: Partial<Record<RecordKind, number>>;
  foot: number;
  vehicle: number;
}

/** Le but d'un palier, en mots : « saut de 50 m », « 180 km/h », « 3 min à 3 étoiles », « 25 km à pied ». */
export function challengeGoal(kind: RecordKind, tier: 1 | 2 | 3): string {
  const v = CHALLENGE_TIERS[kind][tier - 1]!;
  const time = (s: number): string => (s < 60 ? `${s} s` : s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60}`);
  switch (kind) {
    case "jump": return `saut de ${v} m`;
    case "topSpeed": return `${Math.round(v * 3.6)} km/h`;
    case "wheelie": return `roue arrière de ${v} m`;
    case "stoppie": return `roue avant de ${v} m`;
    case "drift": return `dérapage de ${v} m`;
    case "stars3": return `${time(v)} à 3 étoiles`;
    case "stars5": return `${time(v)} à 5 étoiles`;
    case "foot": return `${v / 1000} km à pied`;
    case "vehicle": return `${v / 1000} km en véhicule`;
  }
}

export class Challenges {
  /** Palier atteint par record (0 : aucun). */
  readonly tiers: Record<RecordKind, number>;
  /** Distances parcourues pendant la partie (m). */
  readonly distance = { foot: 0, vehicle: 0 };

  constructor(saved?: SavedChallenges | null) {
    this.tiers = Object.fromEntries(RECORD_KINDS.map((k) => [k, 0])) as Record<RecordKind, number>;
    if (!saved) return;
    for (const k of RECORD_KINDS) this.tiers[k] = saved.tiers[k] ?? 0;
    this.distance.foot = saved.foot;
    this.distance.vehicle = saved.vehicle;
  }

  /** Une valeur atteinte maintenant (saut, vitesse, figure en cours, temps tenu) : les paliers qu'elle franchit, dans l'ordre. */
  offer(kind: RecordKind, v: number): ChallengeHit[] {
    if (CUMULATIVE.has(kind) || !(v > 0)) return [];
    return this.reach(kind, v);
  }

  /** Ajoute à une distance de la partie (m) : les paliers franchis. */
  add(kind: "foot" | "vehicle", dv: number): ChallengeHit[] {
    if (!(dv > 0) || !Number.isFinite(dv)) return [];
    this.distance[kind] += dv;
    return this.reach(kind, this.distance[kind]);
  }

  /** Valeur de la partie pour un record cumulé (le reste n'est pas gardé : seul le palier compte). */
  progress(kind: RecordKind): number | null {
    return kind === "foot" || kind === "vehicle" ? this.distance[kind] : null;
  }

  /** Nombre de paliers franchis, sur 27. */
  get count(): number {
    return RECORD_KINDS.reduce((n, k) => n + this.tiers[k], 0);
  }

  toSave(): SavedChallenges {
    const tiers: Partial<Record<RecordKind, number>> = {};
    for (const k of RECORD_KINDS) if (this.tiers[k] > 0) tiers[k] = this.tiers[k];
    return { tiers, foot: Math.round(this.distance.foot), vehicle: Math.round(this.distance.vehicle) };
  }

  private reach(kind: RecordKind, v: number): ChallengeHit[] {
    const out: ChallengeHit[] = [];
    const t = CHALLENGE_TIERS[kind];
    while (this.tiers[kind] < 3 && v >= t[this.tiers[kind]]!) {
      const tier = (this.tiers[kind] + 1) as 1 | 2 | 3;
      this.tiers[kind] = tier;
      out.push({ kind, tier, reward: TIER_REWARDS[tier - 1]! });
    }
    return out;
  }
}

/** Défis enregistrés, lus avec méfiance : paliers entiers de 0 à 3, distances finies et positives ; null si absent ou illisible. */
export function parseChallenges(o: unknown): SavedChallenges | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const dist = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, 1e9) : 0);
  const tiers: Partial<Record<RecordKind, number>> = {};
  const t = r["tiers"];
  if (t && typeof t === "object") {
    for (const k of RECORD_KINDS) {
      const v = (t as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) tiers[k] = Math.min(Math.max(Math.round(v), 0), 3);
    }
  }
  return { tiers, foot: dist(r["foot"]), vehicle: dist(r["vehicle"]) };
}
