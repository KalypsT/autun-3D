import { EventRng, type EventContext, type EventKind, type EventOutcome, type GameEvent } from "./types";

/**
 * Directeur d'événements (phase 4, `docs/plans/evenements.md`, § 4) : il décide quand un événement démarre, lequel et où, garde le rythme
 * (pas deux fois le même de suite, un grand et un petit au plus, rien quand la police te cherche) et tient le journal du jour.
 *
 * Analogie : le régisseur d'un théâtre de rue. Il ne joue pas les scènes (chaque événement est sa propre petite pièce) ; il regarde l'heure, le
 * quartier et le public, et décide de lever le rideau, rarement assez pour que ça reste une surprise.
 */

/** Réglage « Événements » : Aucun, Rares, Normaux, Fréquents. */
export const EVENT_LEVELS = ["Aucun", "Rares", "Normaux", "Fréquents"] as const;
export const EVENT_LEVEL_DEFAULT = 2;
/** Multiplicateur du rythme pour chaque niveau. */
const LEVEL_RATE = [0, 0.4, 1, 2.5] as const;

export const DIRECTOR = {
  /** Un événement toutes les … s en moyenne au centre en journée, à « Normaux ». */
  meanGap: 180,
  /** Tirage toutes les … s. */
  rollEvery: 2,
  /** Au moins … s entre deux départs (… à « Fréquents »), … s après la fin du précédent. */
  minGap: 60,
  minGapFrequent: 30,
  afterEnd: 45,
  /** Calme après un chargement, une mort, une arrestation (s). */
  quiet: 60,
  /** Le même événement ne revient pas avant … s (… à « Fréquents »). */
  sameAgain: 480,
  sameAgainFrequent: 300,
  /** Entrées gardées dans le journal. */
  journal: 40,
} as const;

/** Poids des zones du graphe piéton (`ZONE` : centre, résidentiel, périphérie, nature). */
const ZONE_RATE = [1, 0.6, 0.35, 0.25] as const;

/** Ce que le directeur sait du moment, en plus de ce que voit un événement. */
export interface DirectorContext extends EventContext {
  hour: number;
  weekday: number;
  /** Pluie (0 à 1). */
  rain: number;
  /** Zone du graphe piéton autour du joueur (0 centre … 3 nature). */
  zone: number;
  /** Étoiles de recherche du joueur. */
  stars: number;
  /** Rien ne doit démarrer (magasin ouvert, nage, toit, menu…). */
  blocked: boolean;
  /** Il y a des passants (« Foule » au-dessus de « Aucune ») et de la circulation. */
  crowd: boolean;
  traffic: boolean;
}

/** Un événement du catalogue : quand il peut avoir lieu, son poids, et comment le lancer (il cherche son lieu ; null s'il n'en trouve pas). */
export interface EventDef {
  kind: EventKind;
  big: boolean;
  /** Nom affiché dans le journal et le carnet. */
  label: string;
  /** Poids relatif dans le tirage à cet instant (0 : impossible maintenant). */
  weight(ctx: DirectorContext): number;
  start(ctx: DirectorContext, rng: EventRng): GameEvent | null;
}

/** Une ligne du journal du jour : « 15 h 20 · vol à l'arraché · voleur rattrapé ». */
export interface JournalEntry {
  date: number;
  hour: number;
  kind: EventKind;
  label: string;
  outcome: EventOutcome;
  x: number;
  y: number;
}

/** Ce que le directeur dit au jeu à la fin d'un événement (carnet, défis). */
export interface EventEnd {
  kind: EventKind;
  outcome: EventOutcome;
  goodDeed: boolean;
  /** Vol : le voleur a été mis à terre. */
  caught: boolean;
}

export class EventDirector {
  level = EVENT_LEVEL_DEFAULT;
  readonly active: GameEvent[] = [];
  readonly journal: JournalEntry[] = [];
  /** Fins d'événements depuis le dernier `takeEnds` (le jeu en tire le carnet). */
  private readonly ends: EventEnd[] = [];
  private readonly defs: EventDef[] = [];
  private readonly rng: EventRng;
  private clock = 0;
  private rollIn = 0;
  private lastStart = -Infinity;
  private lastEnd = -Infinity;
  private quietUntil: number = DIRECTOR.quiet;
  private readonly lastOf = new Map<EventKind, number>();
  private lastKind: EventKind | null = null;
  /** Date et heure du jeu, pour le journal (le jeu les tient à jour). */
  date = 0;
  hour = 12;
  /** Départs (diagnostic), tirages sans lieu trouvé. */
  starts = 0;
  misses = 0;

  constructor(seed: number) {
    this.rng = new EventRng(seed ^ 0x5e17ed);
  }

  register(def: EventDef): void {
    this.defs.push(def);
  }

  defOf(kind: EventKind): EventDef | undefined {
    return this.defs.find((d) => d.kind === kind);
  }

  /** Calme pendant `DIRECTOR.quiet` s (chargement, mort, arrestation) ; les événements en cours s'arrêtent. */
  reset(): void {
    this.clear();
    this.quietUntil = this.clock + DIRECTOR.quiet;
  }

  /** Arrête tout ce qui est en cours (les passants réquisitionnés sont rendus). */
  clear(): void {
    for (const e of this.active) e.abort();
    this.active.length = 0;
  }

  /** Probabilité de lancer un événement à ce tirage (rythme de base × quartier × heure × réglage). */
  rate(ctx: DirectorContext): number {
    const h = ctx.hour;
    const hourRate = h < 6 ? 0.4 : h < 7 ? 0.7 : h < 22 ? 1 : 0.7;
    const r = (LEVEL_RATE[this.level] ?? 0) * (ZONE_RATE[ctx.zone] ?? 0.35) * hourRate / DIRECTOR.meanGap;
    return 1 - Math.exp(-r * DIRECTOR.rollEvery);
  }

  update(ctx: DirectorContext): void {
    this.clock += ctx.dt;
    for (const e of this.active) e.update(ctx);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i]!;
      if (!e.done) continue;
      this.active.splice(i, 1);
      this.lastEnd = this.clock;
      this.close(e);
    }
    if (this.level <= 0) {
      if (this.active.length) this.clear();
      return;
    }
    this.rollIn -= ctx.dt;
    if (this.rollIn > 0) return;
    this.rollIn = DIRECTOR.rollEvery;
    if (!this.canStart(ctx)) return;
    if (this.rng.next() >= this.rate(ctx)) return;
    this.launch(ctx, null);
  }

  /** Lance tout de suite l'événement `kind` (`?event=`, essais) ; faux s'il n'a pas trouvé de lieu. */
  force(kind: EventKind, ctx: DirectorContext): boolean {
    return this.launch(ctx, kind);
  }

  private canStart(ctx: DirectorContext): boolean {
    if (ctx.blocked || ctx.stars > 0 || this.clock < this.quietUntil) return false;
    const frequent = this.level >= 3;
    if (this.clock - this.lastStart < (frequent ? DIRECTOR.minGapFrequent : DIRECTOR.minGap)) return false;
    if (this.clock - this.lastEnd < DIRECTOR.afterEnd * (frequent ? 0.5 : 1)) return false;
    // Un grand et un petit au plus.
    return this.active.length < 2;
  }

  private launch(ctx: DirectorContext, only: EventKind | null): boolean {
    const frequent = this.level >= 3;
    const bigBusy = this.active.some((e) => e.big), smallBusy = this.active.some((e) => !e.big);
    const pool: { def: EventDef; w: number }[] = [];
    let total = 0;
    for (const def of this.defs) {
      if (only && def.kind !== only) continue;
      if (!only) {
        if ((def.big && bigBusy) || (!def.big && smallBusy)) continue;
        const last = this.lastOf.get(def.kind) ?? -Infinity;
        if (this.clock - last < (frequent ? DIRECTOR.sameAgainFrequent : DIRECTOR.sameAgain)) continue;
      }
      const w = only ? 1 : def.weight(ctx);
      if (w <= 0) continue;
      pool.push({ def, w });
      total += w;
    }
    // Jamais deux fois le même de suite, quand un autre est possible.
    if (!only && pool.some((p) => p.def.kind !== this.lastKind)) {
      for (let k = pool.length - 1; k >= 0; k--) {
        if (pool[k]!.def.kind !== this.lastKind) continue;
        total -= pool[k]!.w;
        pool.splice(k, 1);
      }
    }
    // Tirage pondéré, puis on essaie les suivants si le premier ne trouve pas de lieu.
    while (pool.length) {
      let r = this.rng.next() * total, k = 0;
      for (; k < pool.length - 1; k++) {
        r -= pool[k]!.w;
        if (r < 0) break;
      }
      const { def, w } = pool[k]!;
      pool.splice(k, 1);
      total -= w;
      const ev = def.start(ctx, this.rng);
      if (!ev) {
        this.misses++;
        continue;
      }
      this.active.push(ev);
      this.starts++;
      this.lastStart = this.clock;
      this.lastOf.set(def.kind, this.clock);
      this.lastKind = def.kind;
      return true;
    }
    return false;
  }

  /** Un événement fini : au journal (sauf s'il n'a pas eu lieu), et dans les fins que le jeu lit. */
  private close(e: GameEvent): void {
    const outcome = e.outcome ?? "abandonne";
    if (outcome === "abandonne") return;
    const def = this.defOf(e.kind);
    this.journal.push({ date: this.date, hour: this.hour, kind: e.kind, label: def?.label ?? e.kind, outcome, x: e.x, y: e.y });
    if (this.journal.length > DIRECTOR.journal) this.journal.shift();
    this.ends.push({ kind: e.kind, outcome, goodDeed: e.goodDeed, caught: (e as { caught?: boolean }).caught === true });
  }

  takeEnds(out: EventEnd[]): void {
    for (const e of this.ends) out.push(e);
    this.ends.length = 0;
  }

  /** Le passant `slot` est-il un fuyard qu'on peut arrêter sans infraction ? */
  lawfulTarget(slot: number): boolean {
    for (const e of this.active) if (e.lawfulTarget(slot)) return true;
    return false;
  }
}

/** Texte d'une issue, pour le journal (« voleur rattrapé »). */
export function outcomeText(kind: EventKind, outcome: EventOutcome): string {
  if (kind === "vol") {
    return { rendu: "sac rendu", garde: "sac gardé", rattrape: "voleur rattrapé", enfui: "le voleur s'est enfui", perdu: "sac perdu", abandonne: "" }[outcome];
  }
  return { rendu: "rendu", garde: "gardé", rattrape: "rattrapé", enfui: "enfui", perdu: "perdu", abandonne: "" }[outcome];
}
