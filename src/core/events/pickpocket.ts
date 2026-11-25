import { ORDER, PED_STATE } from "../pedestrians";
import { Fugitive } from "./fugitive";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type GameEvent, type GroundItem } from "./types";

/**
 * Pickpocket (E2, lot 2 de la phase 4) : c'est le joueur qu'on vole. Dans une foule dense, un passant le bouscule et lui prend de l'argent
 * (10 % de son solde, de 20 à 200 €) ; « Hé ! » au-dessus de la tête du joueur, le « −80 € » rouge au solde. Le pickpocket s'éloigne d'abord
 * au pas, l'air de rien, puis court quand le joueur se retourne vers lui, court, ou au bout de quelques secondes. Rattrapé (plaqué, frappé,
 * renversé), il lâche les billets : l'argent volé, plus ce qu'il avait déjà pris à d'autres (50 €). Sinon, c'est perdu.
 */

export const PICKPOCKET = {
  /**
   * Il faut au moins … passants à moins de … m du joueur (une rue animée : avec la densité du jeu, une centaine de passants dans 125 m, un
   * cercle de 8 m n'en contient presque jamais six, sauf au marché), et … € sur lui.
   */
  crowd: 3,
  crowdRadius: 12,
  minMoney: 100,
  /** Le pickpocket part à … – … m du joueur. */
  near: 5,
  far: 25,
  /** Il le rejoint à l'allure du joueur plus … (1,6 au moins, au plus …), le touche à moins de … m ; plus de … s sans y arriver : rien. */
  gain: 1.0,
  walk: 2.3,
  reach: 0.75,
  approachTimeout: 20,
  /** Le joueur court (… m/s) avant d'être touché : on renonce. */
  playerRuns: 3,
  /** Prise : … % du solde, entre … et … €, arrondie à 5 €. */
  share: 0.1,
  min: 20,
  max: 200,
  /** Ce qu'il avait déjà volé à d'autres, rendu avec (€). */
  bonus: 50,
  /** Il s'éloigne au pas (m/s) ; il se met à courir quand le joueur le regarde à moins de … m (cône de ±…), court, ou après … s. */
  sneak: 1.7,
  spotted: 12,
  spottedCone: 0.6,
  sneakFor: 7,
  /** Course (m/s) : un peu moins vite que le voleur à l'arraché. */
  run: 5.6,
  tired: 4.4,
  /** Les billets restent … s au sol ; on les ramasse à moins de … m. */
  cashLife: 120,
  pickReach: 1.3,
  leaveFar: 250,
  leaveFor: 20,
} as const;

/** Ce que le pickpocket fait en plus des effets communs : prendre au porte-monnaie, faire parler le joueur. */
export interface PickpocketEffects extends EventEffects {
  /** Prend `amount` € au joueur (sans dette) ; renvoie ce qui a été pris. */
  take(amount: number, label: string): number;
  /** Bulle au-dessus de la tête du joueur. */
  sayPlayer(text: string, seconds: number): void;
}

const tmp = { x: 0, y: 0 };

/** Cherche un pickpocket : le joueur marche dans une rue animée avec assez d'argent ; un passant seul, adulte, à 5 – 25 m, de préférence hors de vue. */
export function findPickpocket(peds: EventPeds, ctx: EventContext, money: number, rng: EventRng): number {
  const p = ctx.player;
  if (!p.onFoot || p.speed > 2.2 || money < PICKPOCKET.minMoney) return -1;
  const around: number[] = [];
  peds.queryCircle(p.x, p.y, PICKPOCKET.crowdRadius, around);
  if (around.filter((i) => peds.modeOf(i) < PED_STATE.stumble).length < PICKPOCKET.crowd) return -1;
  if (ctx.policeNear(p.x, p.y, 50)) return -1;
  const near: number[] = [];
  peds.queryCircle(p.x, p.y, PICKPOCKET.far, near);
  let best = -1, bestScore = -Infinity;
  for (const i of near) {
    if (peds.modeOf(i) !== PED_STATE.walk || peds.isBorrowed(i) || peds.attached(i)) continue;
    const r = peds.recipe(i);
    if (r.age === "senior" || r.outfit === "work" || r.outfit === "sport") continue;
    peds.position(i, tmp);
    const d = Math.hypot(tmp.x - p.x, tmp.y - p.y);
    if (d < PICKPOCKET.near) continue;
    if (ctx.lineClear && !ctx.lineClear(tmp.x, tmp.y, p.x, p.y)) continue;
    const score = (ctx.visible(tmp.x, tmp.y) ? 0 : 1) - d / 40 + rng.next() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

type Phase = "approach" | "sneak" | "run" | "cash" | "over";

export class PickpocketEvent implements GameEvent {
  readonly kind = "pickpocket" as const;
  readonly big = false;
  x = 0;
  y = 0;
  done = false;
  outcome: EventOutcome | null = null;
  readonly goodDeed = false;
  caught = false;
  phase: Phase = "approach";
  /** Argent pris au joueur (€), et posé au sol quand il est rattrapé. */
  stolen = 0;
  readonly cashAt = { x: 0, y: 0 };
  private t = 0;
  private sneakT = 0;
  private cashT = 0;
  private caughtT = 0;
  private awayT = 0;
  private freeT = -1;
  private readonly fugitive: Fugitive;

  constructor(
    private readonly peds: EventPeds,
    private readonly fx: PickpocketEffects,
    readonly thief: number,
    private readonly money: () => number,
  ) {
    peds.borrow(thief);
    this.fugitive = new Fugitive(peds, thief, peds.idOf(thief), PICKPOCKET.run, PICKPOCKET.tired);
    peds.position(thief, tmp);
    this.x = tmp.x;
    this.y = tmp.y;
  }

  lawfulTarget(slot: number): boolean {
    return slot === this.thief && this.fugitive.here && (this.phase === "sneak" || this.phase === "run" || (this.caught && this.caughtT < 2));
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    const p = ctx.player, dt = ctx.dt;
    this.t += dt;
    if (this.caught) this.caughtT += dt;
    this.awayT = Math.hypot(this.x - p.x, this.y - p.y) > PICKPOCKET.leaveFar ? this.awayT + dt : 0;
    if (this.awayT > PICKPOCKET.leaveFor) return this.finish(this.phase === "approach" ? "abandonne" : this.caught ? "perdu" : "enfui");
    switch (this.phase) {
      case "approach":
        return this.approach(ctx);
      case "sneak":
      case "run":
        return this.flee(ctx);
      case "cash":
        this.thiefAfter(dt);
        this.cashT += dt;
        if (this.cashT > PICKPOCKET.cashLife) return this.finish("perdu");
        if (p.onFoot && Math.hypot(this.cashAt.x - p.x, this.cashAt.y - p.y) < PICKPOCKET.pickReach) {
          const back = this.stolen + PICKPOCKET.bonus;
          this.fx.earn(back, "Portefeuille récupéré");
          this.fx.feat(`Portefeuille récupéré · +${back} €`);
          this.finish("rattrape");
        }
        return;
    }
  }

  private approach(ctx: EventContext): void {
    const peds = this.peds, p = ctx.player;
    if (!this.fugitive.here || this.t > PICKPOCKET.approachTimeout || peds.modeOf(this.thief) >= PED_STATE.stumble || !p.onFoot || p.speed > PICKPOCKET.playerRuns) {
      return this.finish("abandonne");
    }
    peds.position(this.thief, tmp);
    const d = Math.hypot(tmp.x - p.x, tmp.y - p.y);
    peds.command(this.thief, ORDER.seek, p.x, p.y, Math.min(PICKPOCKET.walk, Math.max(1.6, p.speed + PICKPOCKET.gain)));
    if (d > PICKPOCKET.reach) return;
    // Il frôle le joueur et prend l'argent ; le joueur s'en rend compte aussitôt.
    const want = Math.round(Math.min(PICKPOCKET.max, Math.max(PICKPOCKET.min, this.money() * PICKPOCKET.share)) / 5) * 5;
    this.stolen = this.fx.take(want, "Pickpocket");
    if (this.stolen <= 0) return this.finish("abandonne");
    this.fx.sayPlayer("Hé ! Mon portefeuille !", 3);
    this.x = tmp.x;
    this.y = tmp.y;
    this.phase = "sneak";
    this.sneakT = 0;
  }

  private flee(ctx: EventContext): void {
    const p = ctx.player;
    if (this.phase === "sneak") {
      this.sneakT += ctx.dt;
      this.fugitive.position(tmp);
      const dx = tmp.x - p.x, dy = tmp.y - p.y, d = Math.hypot(dx, dy);
      const facing = Math.cos(Math.atan2(dx, dy) - p.yaw) > Math.cos(PICKPOCKET.spottedCone);
      if (p.speed > PICKPOCKET.playerRuns || (d < PICKPOCKET.spotted && facing) || this.sneakT > PICKPOCKET.sneakFor) {
        this.phase = "run";
        this.fugitive.t = 0;
      }
    }
    const state = this.fugitive.update(ctx, this.x, this.y, this.phase === "sneak" ? PICKPOCKET.sneak : undefined);
    if (state === "running") return;
    if (state === "escaped") {
      if (this.fugitive.here) this.peds.release(this.thief);
      return this.finish("enfui");
    }
    if (state === "tackled") this.fx.cry("oof", tmp.x, tmp.y);
    // À terre (plaqué, frappé, renversé) ou mort : les billets tombent à côté de lui.
    this.fugitive.position(tmp);
    this.cashAt.x = tmp.x + 0.5;
    this.cashAt.y = tmp.y - 0.3;
    this.caught = true;
    this.caughtT = 0;
    this.phase = "cash";
    this.cashT = 0;
    this.freeT = state === "dead" ? 0 : 12;
    this.fx.feat("Pickpocket rattrapé");
  }

  /** Après sa chute, il se relève et fuit encore un moment, puis redevient un passant. */
  private thiefAfter(dt: number): void {
    if (this.freeT < 0) return;
    this.freeT -= dt;
    if (this.freeT <= 0 || !this.fugitive.here || this.peds.modeOf(this.thief) === PED_STATE.dead) {
      if (this.fugitive.here) this.peds.release(this.thief);
      this.freeT = -1;
    }
  }

  markers(out: EventMarker[]): void {
    if (this.done || this.phase === "approach") return;
    if ((this.phase === "sneak" || this.phase === "run") && this.fugitive.here) {
      this.fugitive.position(tmp);
      out.push({ kind: "fugitive", x: tmp.x, y: tmp.y });
    }
    if (this.phase === "cash") out.push({ kind: "scene", x: this.cashAt.x, y: this.cashAt.y });
  }

  items(out: GroundItem[]): void {
    if (this.phase === "cash") out.push({ kind: "cash", x: this.cashAt.x, y: this.cashAt.y, color: 0 });
  }

  action(): EventAction | null {
    return null;
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    if (this.fugitive.here && this.peds.isBorrowed(this.thief)) this.peds.release(this.thief);
    this.done = true;
  }

  abort(): void {
    if (this.done) return;
    this.outcome ??= "abandonne";
    this.finish(this.outcome);
  }
}
