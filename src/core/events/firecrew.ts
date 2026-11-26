import { pompierRecipe } from "../character";
import type { NavGraph } from "../nav-graph";
import { ORDER } from "../pedestrians";
import type { RoadGraph } from "../road-graph";
import { FIRE_STATION } from "./malaise";
import { roadside, walkLength, Walker } from "./walker";
import type { EventContext, EventPeds, EventTraffic } from "./types";

/**
 * L'équipe des pompiers d'une scène (phase 4, feu de poubelle) : le fourgon part hors de vue du côté de la caserne, sirène, se gare au bord de la
 * chaussée la plus proche (ou là où il reste bloqué, à moins de 100 m à pied), deux pompiers descendent et vont à leur poste par le graphe
 * piéton ; à la fin, ils remontent et le fourgon repart. Les mêmes règles que le malaise (D332), en un seul objet.
 */

export const CREW = {
  parkReach: 12,
  stuckFor: 10,
  walkFar: 100,
  stuckLong: 20,
  walkFarLong: 220,
  run: 3.2,
} as const;

export type CrewPhase = "idle" | "drive" | "walk" | "post" | "back" | "gone";

const tmp = { x: 0, y: 0 };

export class FireCrew {
  phase: CrewPhase = "idle";
  van = -1;
  readonly firemen: number[] = [];
  private walkers: Walker[] = [];
  private target: { x: number; y: number; vx: number; vy: number } | null = null;
  private parking = false;
  private stuckT = 0;
  private planned = false;
  private t = 0;

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic,
    private readonly road: RoadGraph | null,
    private readonly nav: NavGraph | null,
    /** La scène, et le poste de chaque pompier (k = 0, 1). */
    private readonly x: number,
    private readonly y: number,
    private readonly post: (k: number) => { x: number; y: number },
  ) {}

  /** L'appel : le fourgon naît hors de vue du côté de la caserne ; faux s'il n'y a pas de place (on réessaie plus tard). */
  call(ctx: EventContext): boolean {
    this.target ??= roadside(this.road, this.x, this.y, ctx.lineClear);
    const sx = FIRE_STATION.x - this.x, sy = FIRE_STATION.y - this.y, sd = Math.hypot(sx, sy) || 1;
    const around = sd > 120 ? { x: this.x + (sx / sd) * 90, y: this.y + (sy / sd) * 90 } : { x: this.x, y: this.y };
    const c = this.traffic.spawnEvent(false, around, "pompiers") ?? this.traffic.spawnEvent(false, { x: this.x, y: this.y }, "pompiers");
    if (!c) return false;
    this.van = c.id;
    this.traffic.pursue(c.id, this.target);
    this.phase = "drive";
    this.t = 0;
    return true;
  }

  /** Un pas ; vrai quand les deux pompiers sont à leur poste (phase `post`). */
  update(dt: number): boolean {
    this.t += dt;
    const c = this.van >= 0 ? this.traffic.eventCar(this.van) : null;
    if (this.phase === "drive") {
      if (!c) return this.gone();
      if (!this.planned) {
        this.planned = this.traffic.planTo(c.id, this.target!.x, this.target!.y);
        if (this.planned) this.traffic.setSiren(c.id, true);
      }
      if (!this.parking) {
        this.stuckT = Math.abs(c.state.speed) < 0.6 ? this.stuckT + dt : 0;
        const close = Math.hypot(c.state.x - this.target!.x, c.state.y - this.target!.y) < CREW.parkReach;
        let stuck = false;
        // Bloqué : à moins de 100 m à pied au bout de 10 s, ou de 220 m au bout de 20 s (ils courent le reste).
        if (this.stuckT > CREW.stuckFor && Math.floor(this.stuckT) !== Math.floor(this.stuckT - dt) && Math.hypot(c.state.x - this.x, c.state.y - this.y) < CREW.walkFarLong) {
          const w = walkLength(this.nav, c.state.x, c.state.y, this.x, this.y);
          stuck = w < CREW.walkFar || (this.stuckT > CREW.stuckLong && w < CREW.walkFarLong);
        }
        if (!close && !stuck) return false;
        this.parking = true;
        this.traffic.pursue(c.id, null);
        this.traffic.hold(c.id, 1e6);
        this.traffic.setSiren(c.id, true, false);
      }
      if (Math.abs(c.state.speed) > 0.6) return false;
      const h = c.state.heading, rx = Math.cos(h), ry = -Math.sin(h);
      for (const side of [-1, 1]) {
        const f = this.peds.appear(c.state.x + rx * side * 1.3, c.state.y + ry * side * 1.3, c.driver + side, h, pompierRecipe(c.driver + side));
        if (f < 0) continue;
        const p = this.post(this.firemen.length), w = new Walker(this.peds, f);
        w.plan(this.nav, p.x, p.y);
        this.firemen.push(f);
        this.walkers.push(w);
      }
      if (!this.firemen.length) return this.gone();
      this.phase = "walk";
      this.t = 0;
    }
    if (this.phase === "walk") {
      let at = 0;
      this.walkers.forEach((w) => {
        if (!this.here(w.slot) || w.step(CREW.run, 0.6, dt) || w.stuckT > 8) at++;
      });
      if (at < this.walkers.length && this.t < 60) return false;
      this.phase = "post";
    }
    if (this.phase === "back") {
      if (!c) return this.gone();
      let all = true;
      for (const w of this.walkers) {
        if (!this.here(w.slot)) continue;
        if (w.step(1.4, 0.8, dt) || w.stuckT > 6 || this.t > 40) this.peds.vanish(w.slot);
        else all = false;
      }
      if (all) {
        this.traffic.hold(c.id, 0);
        this.traffic.letGo(c.id);
        this.gone();
      }
      return false;
    }
    return this.phase === "post";
  }

  /** Au poste : chacun tourné vers la scène, dans une pose. */
  hold(pose: number): void {
    for (const f of this.firemen) if (this.here(f)) this.peds.command(f, ORDER.hold, this.x, this.y, 0, pose);
  }

  /** Le travail est fait : ils remontent dans le fourgon, qui repart. */
  sendBack(): void {
    const c = this.van >= 0 ? this.traffic.eventCar(this.van) : null;
    if (!c) {
      this.gone();
      return;
    }
    const h = c.state.heading, bx = c.state.x - Math.sin(h) * 3.1, by = c.state.y - Math.cos(h) * 3.1;
    for (const w of this.walkers) w.plan(this.nav, bx, by);
    this.phase = "back";
    this.t = 0;
  }

  /** Tout s'arrête : les pompiers disparaissent, le fourgon repart. */
  stop(): void {
    for (const f of this.firemen) if (this.here(f)) this.peds.vanish(f);
    if (this.van >= 0 && this.traffic.eventCar(this.van)) {
      this.traffic.hold(this.van, 0);
      this.traffic.letGo(this.van);
    }
    this.gone();
  }

  /** Le premier pompier encore là (pour lui faire dire quelque chose), −1 sinon. */
  get speaker(): number {
    const f = this.firemen[0];
    return f !== undefined && this.here(f) ? f : -1;
  }

  /** Durée (s) depuis le début de la phase en cours. */
  get phaseT(): number {
    return this.t;
  }

  private here(slot: number): boolean {
    if (slot < 0 || this.peds.modeOf(slot) < 0 || !this.peds.isBorrowed(slot)) return false;
    this.peds.position(slot, tmp);
    return true;
  }

  private gone(): false {
    this.phase = "gone";
    this.van = -1;
    return false;
  }
}
