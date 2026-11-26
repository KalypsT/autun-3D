import { LIFE_POSE } from "../character-rig";
import type { NavGraph } from "../nav-graph";
import { ORDER, PED_STATE } from "../pedestrians";
import type { RoadGraph } from "../road-graph";
import { FireCrew } from "./firecrew";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Feu de poubelle (E12, lot 8 de la phase 4) : le soir et la nuit, une corbeille de rue (mobilier des tuiles) à 30 – 100 m prend feu :
 * d'abord de la fumée, puis des flammes (le feu des voitures de D111, en petit), un crépitement. Deux passants s'arrêtent (« Au feu ! »),
 * l'un filme. Les pompiers arrivent (l'équipe du malaise, D332), se postent de part et d'autre, l'éteignent (les flammes baissent, la fumée
 * reste un moment) et repartent. S'approcher à moins de 1,5 m brûle. Sans pompiers, il s'éteint seul au bout de deux minutes et demie.
 */

export const FEU = {
  /** La corbeille : à … – … m du joueur. */
  near: 30,
  far: 100,
  /** Fumée seule … s, puis le feu ; les pompiers appelés … – … s après le début. */
  smoke: 3,
  callAfter: [12, 22] as const,
  /** Pas de pompiers au bout de … s après l'appel : il s'éteint seul en … s. */
  vanWait: 150,
  dieDown: 20,
  /** Les pompiers éteignent en … s ; la fumée reste … s. */
  douse: 8,
  smolder: 10,
  /** Trop près (moins de … m) : … points de vie toutes les … s. */
  burnReach: 1.5,
  burnDamage: 3,
  burnEvery: 0.5,
  /** Curieux : jusqu'à … passants à moins de … m, à … m du feu. */
  onlookers: 2,
  onlookerRange: 35,
  ring: 6,
  leaveFar: 250,
  leaveFor: 20,
  maxLife: 360,
} as const;

/** Ce que le feu demande au jeu : la brûlure du joueur trop près. */
export interface FeuEffects extends EventEffects {
  hurtPlayer(damage: number, fromX: number, fromY: number): void;
}

/** Une corbeille à 30 – 100 m du joueur, de préférence à l'écran ; null sinon. */
export function findBin(bins: readonly { x: number; y: number }[], ctx: EventContext, rng: EventRng): { x: number; y: number } | null {
  const p = ctx.player, ok = bins.filter((b) => {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    return d > FEU.near && d < FEU.far;
  });
  if (!ok.length) return null;
  const seen = ok.filter((b) => ctx.visible(b.x, b.y));
  const list = seen.length ? seen : ok;
  return list[Math.floor(rng.next() * list.length)]!;
}

type Phase = "smoke" | "burn" | "douse" | "smolder" | "over";

export class FeuEvent implements GameEvent {
  readonly kind = "feu" as const;
  readonly big = true;
  readonly x: number;
  readonly y: number;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  phase: Phase = "smoke";
  /** Force du feu (0 à 1). */
  fire = 0.15;
  readonly onlookers: number[] = [];
  readonly crew: FireCrew | null;
  private t = 0;
  private phaseT = 0;
  private burnT = 0;
  private awayT = 0;
  private readonly callAt: number;
  private called = false;
  private callT = 0;
  private dying = false;

  constructor(
    private readonly peds: EventPeds | null,
    traffic: EventTraffic | null,
    road: RoadGraph | null,
    nav: NavGraph | null,
    private readonly fx: FeuEffects,
    bin: { x: number; y: number },
    rng: EventRng,
  ) {
    this.x = bin.x;
    this.y = bin.y;
    this.callAt = FEU.callAfter[0] + rng.next() * (FEU.callAfter[1] - FEU.callAfter[0]);
    // Les pompiers se postent à 2,2 m de la corbeille, de part et d'autre.
    this.crew = traffic && peds ? new FireCrew(peds, traffic, road, nav, bin.x, bin.y, (k) => ({ x: bin.x + (k ? 2.2 : -2.2), y: bin.y + 0.6 })) : null;
  }

  lawfulTarget(): boolean {
    return false;
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    const dt = ctx.dt, p = ctx.player;
    this.t += dt;
    this.phaseT += dt;
    this.awayT = Math.hypot(this.x - p.x, this.y - p.y) > FEU.leaveFar ? this.awayT + dt : 0;
    if (this.awayT > FEU.leaveFor || this.t > FEU.maxLife) return this.finish(this.outcome ?? "termine");
    // Trop près des flammes : ça brûle.
    this.burnT -= dt;
    if (this.fire > 0.3 && p.onFoot && Math.hypot(p.x - this.x, p.y - this.y) < FEU.burnReach && this.burnT <= 0) {
      this.burnT = FEU.burnEvery;
      this.fx.hurtPlayer(FEU.burnDamage, this.x, this.y);
    }
    this.watchers();
    // Les pompiers : appelés, puis en route ; à leur poste, ils éteignent.
    if (this.crew && !this.called && this.t > this.callAt) this.called = this.crew.call(ctx);
    if (this.called) this.callT += dt;
    const atPost = this.crew && this.called ? this.crew.update(dt) : false;
    switch (this.phase) {
      case "smoke":
        this.fire = 0.15 + 0.85 * Math.min(1, this.phaseT / FEU.smoke) ** 2;
        if (this.phaseT > FEU.smoke) this.go("burn");
        return;
      case "burn":
        // Le feu vit un peu (il ronfle, il baisse, il repart) ; pas de pompiers à temps : il s'éteint seul.
        this.fire = this.dying ? Math.max(0, 1 - this.phaseT / FEU.dieDown) : 0.85 + 0.15 * Math.sin(this.t * 1.7);
        if (atPost) {
          this.crew!.hold(LIFE_POSE.point);
          if (this.crew!.speaker >= 0) this.fx.say(this.crew!.speaker, "On s'en occupe, reculez !", 2.5);
          this.go("douse");
          return;
        }
        if (!this.dying && (!this.crew || (this.called && this.callT > FEU.vanWait) || this.crew.phase === "gone")) {
          this.dying = true;
          this.phaseT = 0;
          this.crew?.stop();
        }
        if (this.dying && this.fire <= 0) {
          this.outcome = "termine";
          this.go("smolder");
        }
        return;
      case "douse":
        this.crew!.hold(LIFE_POSE.point);
        this.fire = Math.max(0, 1 - this.phaseT / FEU.douse);
        if (this.phaseT > FEU.douse) {
          if (this.crew!.speaker >= 0) this.fx.say(this.crew!.speaker, "C'est éteint.", 2.5);
          this.outcome = "eteint";
          this.crew!.sendBack();
          this.go("smolder");
        }
        return;
      case "smolder":
        this.fire = 0;
        if (this.phaseT > FEU.smolder && (!this.crew || this.crew.phase === "gone" || this.phaseT > 60)) this.finish(this.outcome ?? "termine");
        return;
    }
  }

  private go(phase: Phase): void {
    this.phase = phase;
    this.phaseT = 0;
  }

  /** Deux passants s'arrêtent regarder (« Au feu ! »), l'un filme. */
  private watchers(): void {
    const peds = this.peds;
    if (!peds) return;
    if (this.phase === "burn" && this.onlookers.length === 0 && this.phaseT < 1) {
      const near: number[] = [];
      peds.queryCircle(this.x, this.y, FEU.onlookerRange, near);
      for (const i of near) {
        if (this.onlookers.length >= FEU.onlookers) break;
        if (peds.modeOf(i) !== PED_STATE.walk || peds.isBorrowed(i) || peds.attached(i)) continue;
        if (peds.borrow(i)) this.onlookers.push(i);
      }
      this.onlookers.forEach((i, k) => {
        const a = 2.4 + k * 1.3;
        peds.command(i, ORDER.seek, this.x + Math.sin(a) * FEU.ring, this.y + Math.cos(a) * FEU.ring, 1.4);
      });
      if (this.onlookers[0] !== undefined) this.fx.say(this.onlookers[0], "Au feu !", 2.5);
      if (this.onlookers[1] !== undefined) this.fx.say(this.onlookers[1], "Appelez les pompiers !", 2.5);
    }
    this.onlookers.forEach((i, k) => {
      if (peds.modeOf(i) < 0 || !peds.isBorrowed(i) || peds.speedOf(i) > 0.2) return;
      peds.command(i, ORDER.hold, this.x, this.y, 0, k === 1 ? LIFE_POSE.phone : 0);
    });
  }

  markers(out: EventMarker[]): void {
    if (!this.done && this.phase !== "smolder") out.push({ kind: "scene", x: this.x, y: this.y });
  }

  /** Le feu (flammes et fumée), tant qu'il fume. */
  items(out: GroundItem[]): void {
    if (this.done) return;
    out.push({ kind: "fire", x: this.x, y: this.y, color: this.fire });
  }

  action(): EventAction | null {
    return null;
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    this.done = true;
    this.fire = 0;
    for (const i of this.onlookers) if (this.peds && this.peds.modeOf(i) >= 0 && this.peds.isBorrowed(i)) this.peds.release(i);
    this.crew?.stop();
  }

  abort(): void {
    this.finish(this.outcome ?? "abandonne");
  }
}
