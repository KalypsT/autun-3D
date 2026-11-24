import type { StorageLike } from "./save";

/**
 * Carnet de records (plaisir de jeu, lot 1-4, D312) : les meilleurs exploits et les distances parcourues, enregistrés à part de la partie
 * (clé `autun3d.records`) : ils survivent à une nouvelle partie et, dans DomoThib, suivent le joueur sur le serveur comme sa partie.
 * Analogie : le carnet du sportif, qu'on garde d'une saison à l'autre.
 */

export const RECORDS_KEY = "autun3d.records";

/** Les records, dans l'ordre du carnet. */
export const RECORD_KINDS = ["jump", "topSpeed", "wheelie", "stoppie", "drift", "stars3", "stars5", "foot", "vehicle"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** Records cumulés (distances totales) : on les additionne au lieu de garder le meilleur. */
const CUMULATIVE: ReadonlySet<RecordKind> = new Set(["foot", "vehicle"]);

export const RECORD_LABELS: Record<RecordKind, string> = {
  jump: "Saut le plus long (véhicule)",
  topSpeed: "Vitesse maximale",
  wheelie: "Roue arrière la plus longue",
  stoppie: "Roue avant la plus longue",
  drift: "Dérapage le plus long",
  stars3: "Temps tenu à 3 étoiles ou plus",
  stars5: "Temps tenu à 5 étoiles",
  foot: "Distance à pied",
  vehicle: "Distance en véhicule",
};

/** Valeur lisible : mètres, km/h (la vitesse est enregistrée en m/s), minutes et secondes, kilomètres. */
export function recordText(kind: RecordKind, v: number): string {
  if (v <= 0) return "—";
  if (kind === "topSpeed") return `${Math.round(v * 3.6)} km/h`;
  if (kind === "stars3" || kind === "stars5") {
    const s = Math.floor(v);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  }
  if (kind === "foot" || kind === "vehicle") return v < 1000 ? `${Math.round(v)} m` : `${(v / 1000).toFixed(1).replace(".", ",")} km`;
  return `${Math.round(v)} m`;
}

export type RecordValues = Record<RecordKind, number>;

const empty = (): RecordValues => Object.fromEntries(RECORD_KINDS.map((k) => [k, 0])) as RecordValues;

/** Records lus avec méfiance : nombres finis et positifs, le reste à 0. */
export function parseRecords(text: string | null): RecordValues {
  const out = empty();
  if (!text) return out;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (!o || typeof o !== "object") return out;
    for (const k of RECORD_KINDS) {
      const v = o[k];
      if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e9) out[k] = v;
    }
  } catch {
    /* carnet illisible : on repart de zéro */
  }
  return out;
}

/** Le carnet : meilleurs exploits et cumuls, avec le stockage où il est enregistré (au plus toutes les `SAVE_EVERY` s). */
export class RecordBook {
  readonly values: RecordValues;
  private dirty = false;
  private timer = 0;
  static readonly SAVE_EVERY = 5;

  constructor(private readonly storage: StorageLike | null) {
    let text: string | null;
    try {
      text = storage?.getItem(RECORDS_KEY) ?? null;
    } catch {
      text = null;
    }
    this.values = parseRecords(text);
  }

  /**
   * Propose une valeur pour un record « meilleur de » : la garde si elle dépasse l'ancienne. Renvoie vrai si c'est un nouveau record
   * qui en bat un ancien (le premier exploit ne s'annonce pas comme record : il n'y avait rien à battre).
   */
  offer(kind: RecordKind, v: number): boolean {
    if (CUMULATIVE.has(kind) || !(v > this.values[kind])) return false;
    const beaten = this.values[kind] > 0;
    this.values[kind] = v;
    this.dirty = true;
    return beaten;
  }

  /** Ajoute à un cumul (distances). */
  add(kind: RecordKind, v: number): void {
    if (!CUMULATIVE.has(kind) || !(v > 0)) return;
    this.values[kind] += v;
    this.dirty = true;
  }

  /** À chaque image : enregistre de temps en temps ce qui a changé. */
  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0 || !this.dirty) return;
    this.timer = RecordBook.SAVE_EVERY;
    this.flush();
  }

  /** Enregistre maintenant (pause, départ). */
  flush(): void {
    if (!this.dirty || !this.storage) return;
    try {
      const out: Partial<RecordValues> = {};
      for (const k of RECORD_KINDS) if (this.values[k] > 0) out[k] = Math.round(this.values[k] * 100) / 100;
      this.storage.setItem(RECORDS_KEY, JSON.stringify(out));
      this.dirty = false;
    } catch {
      /* stockage plein ou refusé : on réessaiera */
    }
  }
}
