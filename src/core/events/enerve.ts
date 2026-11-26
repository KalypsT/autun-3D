import { LIFE_POSE } from "../character-rig";
import { ORDER, PED_STATE } from "../pedestrians";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventPlayer, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Conducteur énervé (E8, lot 7 de la phase 4) : le joueur accroche une voiture de la circulation à faible vitesse (choc de 1,5 à 5 m/s) ; une
 * fois sur quatre, son conducteur s'arrête, klaxonne longuement, **descend** et vient vers le joueur en gesticulant (« Non mais ça va pas ?! »).
 * Le joueur reste là sans bouger : il se calme et repart (« Bon… faites attention ! ») ; s'il reste à pied tout près, il le bouscule d'abord ;
 * s'il repart en voiture, le conducteur remonte et le suit un moment en klaxonnant ; frappé, il remonte vite et s'en va.
 */

export const ENERVE = {
  /** Choc qui déclenche (m/s), une fois sur … ; pas deux fois en … s. */
  bumpMin: 1.5,
  bumpMax: 5,
  chance: 0.25,
  cooldown: 60,
  /** Klaxon long (s) avant de descendre ; il ne descend que si le joueur est à moins de … m. */
  honkFor: 2,
  reach: 25,
  /** Il marche (m/s) vers le joueur, s'arrête à … m ; une réplique toutes les … s. */
  walk: 1.9,
  stop: 1.1,
  line: 2.6,
  /** Le joueur ne bouge pas (moins de … m/s) pendant … s : il se calme. */
  stillSpeed: 0.5,
  calmAfter: 7,
  /** À pied, tout près (moins de … m) pendant … s : il le bouscule (points de vie). */
  shoveReach: 1.8,
  shoveAfter: 3,
  shoveDamage: 3,
  /** Le joueur part : au-delà de … m, il remonte ; s'il est en voiture, il le suit … s en klaxonnant. */
  leftFar: 18,
  follow: 15,
  maxLife: 120,
} as const;

const LINES = ["Non mais ça va pas ?!", "Vous avez vu ma voiture ?", "Vous savez conduire ?", "Regardez où vous allez !", "C'est pas vrai, ça !"] as const;

/** Ce que le conducteur énervé demande au jeu : un coup de klaxon, une bousculade (points de vie). */
export interface EnerveEffects extends EventEffects {
  honk(x: number, y: number): void;
  hurtPlayer(damage: number, fromX: number, fromY: number): void;
}

type Phase = "honk" | "walk" | "back" | "follow" | "over";

const tmp = { x: 0, y: 0 };

export class EnerveEvent implements GameEvent {
  readonly kind = "enerve" as const;
  readonly big = false;
  x: number;
  y: number;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  phase: Phase = "honk";
  readonly car: number;
  driver = -1;
  shoved = false;
  readonly ok: boolean;
  private t = 0;
  private phaseT = 0;
  private lineT = 0;
  private stillT = 0;
  private nearT = 0;
  private honkT = 0;
  private readonly chase = { x: 0, y: 0, vx: 0, vy: 0 };

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic,
    private readonly fx: EnerveEffects,
    carId: number,
    private readonly rng: EventRng,
  ) {
    const c = traffic.claim(carId);
    this.car = c ? c.id : -1;
    this.x = c?.state.x ?? 0;
    this.y = c?.state.y ?? 0;
    this.ok = !!c;
    if (!c) {
      this.done = true;
      this.outcome = "abandonne";
      return;
    }
    traffic.hold(c.id, 1e6);
  }

  private here(slot: number): boolean {
    return slot >= 0 && this.peds.modeOf(slot) >= 0 && this.peds.isBorrowed(slot);
  }

  lawfulTarget(): boolean {
    return false;
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    const dt = ctx.dt, p = ctx.player;
    this.t += dt;
    this.phaseT += dt;
    if (this.t > ENERVE.maxLife) return this.finish(this.outcome ?? "parti");
    const c = this.traffic.eventCar(this.car);
    // Le joueur a pris sa voiture pendant qu'il était descendu.
    if (!c) {
      if (this.here(this.driver)) {
        this.fx.say(this.driver, "Ma voiture !", 3);
        this.peds.command(this.driver, ORDER.hold, p.x, p.y, 0, LIFE_POSE.point);
      }
      return this.finish("vole");
    }
    this.x = c.state.x;
    this.y = c.state.y;
    switch (this.phase) {
      case "honk":
        this.honkT -= dt;
        if (this.honkT <= 0) {
          this.honkT = 0.35;
          this.fx.honk(c.state.x, c.state.y);
        }
        if (this.phaseT < ENERVE.honkFor) return;
        if (Math.hypot(p.x - c.state.x, p.y - c.state.y) > ENERVE.reach || p.speed > 3) return this.followOrLeave(c, p);
        return this.getOut(c);
      case "walk":
        return this.walkStep(ctx);
      case "back":
        return this.backStep(p, c);
      case "follow":
        return this.followStep(dt, p, c);
    }
  }

  /** Il descend, côté conducteur, et vient vers le joueur. */
  private getOut(c: { state: { x: number; y: number; heading: number }; driver: number }): void {
    const h = c.state.heading;
    this.traffic.setNoDriver(this.car, true);
    this.driver = this.peds.appear(c.state.x - Math.cos(h) * 1.4, c.state.y + Math.sin(h) * 1.4, c.driver, h - Math.PI / 2);
    if (this.driver < 0) return this.finish("parti");
    this.fx.say(this.driver, LINES[0], 2.5);
    this.lineT = ENERVE.line;
    this.phase = "walk";
    this.phaseT = 0;
  }

  /** Il gesticule devant le joueur ; il se calme si le joueur ne bouge pas, le bouscule s'il est à pied tout près, remonte s'il part. */
  private walkStep(ctx: EventContext): void {
    const p = ctx.player, d0 = this.driver;
    if (!this.here(d0)) return this.finish("parti");
    if (this.peds.modeOf(d0) >= PED_STATE.stumble) {
      // Frappé, renversé : il remonte vite et s'en va.
      this.outcome = "frappe";
      this.phase = "back";
      this.phaseT = 0;
      return;
    }
    this.peds.position(d0, tmp);
    const d = Math.hypot(p.x - tmp.x, p.y - tmp.y);
    if (d > ENERVE.leftFar) {
      this.fx.say(d0, p.onFoot ? "C'est ça, sauve-toi !" : "Revenez ici !", 2.5);
      this.outcome = "parti";
      this.phase = "back";
      this.phaseT = 0;
      return;
    }
    if (d > ENERVE.stop + 0.3) this.peds.command(d0, ORDER.seek, p.x + ((tmp.x - p.x) / d) * ENERVE.stop, p.y + ((tmp.y - p.y) / d) * ENERVE.stop, ENERVE.walk);
    else this.peds.command(d0, ORDER.hold, p.x, p.y, 0, this.lineT > ENERVE.line / 2 ? LIFE_POSE.point : LIFE_POSE.talk);
    this.lineT -= ctx.dt;
    if (this.lineT <= 0) {
      this.lineT = ENERVE.line;
      this.fx.say(d0, LINES[1 + Math.floor(this.rng.next() * (LINES.length - 1))]!, 2.3);
    }
    // À pied, tout près : il bouscule le joueur, une fois.
    this.nearT = p.onFoot && d < ENERVE.shoveReach ? this.nearT + ctx.dt : 0;
    if (!this.shoved && this.nearT > ENERVE.shoveAfter) {
      this.shoved = true;
      this.fx.hurtPlayer(ENERVE.shoveDamage, tmp.x, tmp.y);
      this.fx.say(d0, "Et alors ?!", 2);
    }
    // Le joueur ne bouge plus (il s'excuse) : il se calme.
    this.stillT = d < 6 && p.speed < ENERVE.stillSpeed ? this.stillT + ctx.dt : 0;
    if (this.stillT > ENERVE.calmAfter) {
      this.fx.say(d0, "Bon… faites attention !", 2.5);
      this.outcome = "excuse";
      this.phase = "back";
      this.phaseT = 0;
    }
  }

  /** Il retourne à sa portière (il disparaît dedans), puis repart ; si le joueur est parti en voiture, il le suit. */
  private backStep(p: EventPlayer, c: { state: { x: number; y: number; heading: number } }): void {
    const d0 = this.driver;
    const h = c.state.heading, dx = c.state.x - Math.cos(h) * 1.4, dy = c.state.y + Math.sin(h) * 1.4;
    if (this.here(d0)) {
      if (this.peds.modeOf(d0) >= PED_STATE.stumble && this.phaseT < 6) return;
      this.peds.position(d0, tmp);
      if (Math.hypot(tmp.x - dx, tmp.y - dy) > 0.8 && this.phaseT < 20) {
        this.peds.command(d0, ORDER.seek, dx, dy, this.outcome === "frappe" ? 3.5 : 1.8);
        return;
      }
      this.peds.vanish(d0);
      this.driver = -1;
    }
    this.traffic.setNoDriver(this.car, false);
    this.followOrLeave(c, p);
  }

  private followOrLeave(c: { state: { x: number; y: number } }, p: EventPlayer): void {
    this.traffic.hold(this.car, 0);
    if (!p.onFoot && this.outcome !== "frappe" && this.outcome !== "excuse" && Math.hypot(p.x - c.state.x, p.y - c.state.y) < 120) {
      this.outcome ??= "parti";
      this.phase = "follow";
      this.phaseT = 0;
      this.followStep(0, p, c);
      return;
    }
    this.finish(this.outcome ?? "parti");
  }

  /** Il suit le joueur un moment, en klaxonnant. */
  private followStep(dt: number, p: EventPlayer, c: { state: { x: number; y: number } }): void {
    Object.assign(this.chase, { x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    if (this.phaseT === 0) this.traffic.pursue(this.car, this.chase);
    this.honkT -= dt;
    if (this.honkT <= 0) {
      this.honkT = 0.8 + this.rng.next() * 1.2;
      this.fx.honk(c.state.x, c.state.y);
    }
    if (this.phaseT > ENERVE.follow || Math.hypot(p.x - c.state.x, p.y - c.state.y) > 150) this.finish(this.outcome ?? "parti");
  }

  markers(_out: EventMarker[]): void {}

  items(_out: GroundItem[]): void {}

  action(): EventAction | null {
    return null;
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    this.done = true;
    // Sa voiture volée, il reste là, piéton ; sinon il était remonté.
    if (this.here(this.driver)) {
      if (outcome === "vole") this.peds.release(this.driver);
      else this.peds.vanish(this.driver);
    }
    if (this.traffic.eventCar(this.car)) {
      this.traffic.setNoDriver(this.car, false);
      this.traffic.hold(this.car, 0);
      this.traffic.letGo(this.car);
    }
  }

  abort(): void {
    this.finish(this.outcome ?? "abandonne");
  }
}
