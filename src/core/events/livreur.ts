import { LIFE_POSE } from "../character-rig";
import { lanePoint } from "../driver";
import type { NavGraph } from "../nav-graph";
import { ORDER, PED_STATE } from "../pedestrians";
import type { RoadGraph } from "../road-graph";
import { Walker } from "./walker";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Livreur pressé (E9, lot 7 de la phase 4) : le matin, une camionnette de livraison arrive vite (conduite pressée : elle grille les feux, sans
 * contresens), klaxonne, et **s'arrête net en double file** devant le joueur, feux de détresse ; le livreur saute dehors, court porter un colis
 * (« Pardon, pardon ! »), revient en courant et repart. C'est du décor ; mais la camionnette arrêtée, moteur tournant, **se vole** sans
 * conducteur à éjecter (« Hé ! Ma camionnette ! »).
 */

export const LIVREUR = {
  /** L'arrêt : sur une route à … – … m devant le joueur (classe 1 à 4, assez loin d'un carrefour). */
  near: 30,
  far: 75,
  endClear: 10,
  /** Klaxon toutes les … – … s en roulant, près du joueur (moins de … m). */
  honk: [2.5, 4.5] as const,
  honkNear: 120,
  /** Il s'arrête à moins de … m de l'arrêt ; il n'est pas arrivé au bout de … s : on abandonne. */
  arrive: 9,
  pass: 35,
  driveMax: 75,
  /** Il court (m/s) à la porte, à … m de la camionnette sur le trottoir ; y reste … s. */
  run: 4.3,
  door: 7,
  doorFor: 5,
  maxLife: 180,
} as const;

/** Un arrêt de livraison : point de la voie (x, y), cap. */
export interface DeliverySpot {
  x: number;
  y: number;
  heading: number;
}

const tmp = { x: 0, y: 0 };
const lp = { x: 0, y: 0, heading: 0 };

/** Où le livreur s'arrête : sur la voie, devant le joueur (sens de sa marche, ou de son regard), loin des carrefours. */
export function findDeliverySpot(road: RoadGraph, ctx: EventContext, rng: EventRng): DeliverySpot | null {
  const p = ctx.player, dir = p.speed > 2 ? Math.atan2(p.vx, p.vy) : p.yaw;
  for (let k = 0; k < 12; k++) {
    const a = dir + (rng.next() - 0.5) * 1.2, r = LIVREUR.near + rng.next() * (LIVREUR.far - LIVREUR.near);
    const hit = road.nearest(p.x + Math.sin(a) * r, p.y + Math.cos(a) * r, 20);
    if (!hit || !road.drivable(hit.edge)) continue;
    const e = hit.edge, len = road.edgeLength(e), cls = road.edgeClass(e);
    if (cls < 1 || cls > 4 || hit.s < LIVREUR.endClear || hit.s > len - LIVREUR.endClear) continue;
    const ow = road.oneway(e);
    const move = ow === 1 ? e * 2 : ow === 2 ? e * 2 + 1 : e * 2 + (rng.next() < 0.5 ? 0 : 1);
    lanePoint(road, move, move & 1 ? len - hit.s : hit.s, lp);
    return { x: lp.x, y: lp.y, heading: lp.heading };
  }
  return null;
}

type Phase = "drive" | "out" | "door" | "back" | "over";

export class LivreurEvent implements GameEvent {
  readonly kind = "livreur" as const;
  readonly big = false;
  x: number;
  y: number;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  phase: Phase = "drive";
  readonly van: number;
  driver = -1;
  readonly ok: boolean;
  private t = 0;
  private phaseT = 0;
  private honkT = 1;
  private walker: Walker | null = null;
  private doorAt = { x: 0, y: 0 };

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic,
    private readonly nav: NavGraph | null,
    private readonly fx: EventEffects & { honk(x: number, y: number): void },
    private readonly spot: DeliverySpot,
    private readonly rng: EventRng,
  ) {
    this.x = spot.x;
    this.y = spot.y;
    const c = traffic.spawnEvent(false, undefined, "camionnette");
    this.van = c ? c.id : -1;
    // Pressé : conduite de poursuite (feux grillés), mais pas à contresens. L'itinéraire se trace une fois la camionnette partie (son tracé
    // n'existe qu'après son premier pas).
    this.ok = !!c;
    if (!this.ok) {
      this.done = true;
      this.outcome = "abandonne";
    }
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
    if (this.t > LIVREUR.maxLife) return this.finish(this.outcome ?? "termine");
    const c = this.traffic.eventCar(this.van);
    if (!c) {
      // Le joueur est parti avec la camionnette.
      if (this.here(this.driver)) {
        this.fx.say(this.driver, "Hé ! Ma camionnette !", 3);
        this.peds.command(this.driver, ORDER.hold, p.x, p.y, 0, LIFE_POSE.point);
      }
      return this.finish(this.phase === "drive" ? "termine" : "vole");
    }
    if (this.driver >= 0 && this.here(this.driver) && this.peds.modeOf(this.driver) >= PED_STATE.stumble) return;
    switch (this.phase) {
      case "drive": {
        if (!this.planned) {
          this.planned = this.traffic.planTo(this.van, this.spot.x, this.spot.y, true, false, 1500);
          if (!this.planned && this.phaseT > 3) return this.finish("abandonne");
        }
        this.honkT -= dt;
        if (this.honkT <= 0) {
          this.honkT = LIVREUR.honk[0] + this.rng.next() * (LIVREUR.honk[1] - LIVREUR.honk[0]);
          if (Math.hypot(c.state.x - p.x, c.state.y - p.y) < LIVREUR.honkNear) this.fx.honk(c.state.x, c.state.y);
        }
        if (this.phaseT > LIVREUR.driveMax) return this.finish("termine");
        // Arrivé ; ou il a dépassé l'arrêt sans s'en approcher à moins de 9 m (l'autre voie, un tracé qui passe à côté) : il s'arrête dès qu'il
        // s'en éloigne, s'il en est passé à moins de 35 m ; ou bloqué dans un bouchon tout près.
        const d = Math.hypot(c.state.x - this.spot.x, c.state.y - this.spot.y);
        this.minD = Math.min(this.minD, d);
        this.slowT = Math.abs(c.state.speed) < 0.5 ? this.slowT + dt : 0;
        const passed = this.minD < LIVREUR.pass && d > this.minD + 2, jammed = d < LIVREUR.pass && this.slowT > 6;
        if (d > LIVREUR.arrive && !passed && !jammed) return;
        // Arrêt net en double file, détresse.
        this.traffic.hold(this.van, 1e6);
        this.traffic.setHazard(this.van, true);
        this.phase = "out";
        this.phaseT = 0;
        return;
      }
      case "out": {
        if (Math.abs(c.state.speed) > 0.5 && this.phaseT < 6) return;
        const h = c.state.heading, rx = Math.cos(h), ry = -Math.sin(h);
        this.traffic.setNoDriver(this.van, true);
        this.driver = this.peds.appear(c.state.x + rx * 1.3, c.state.y + ry * 1.3, c.driver, h + Math.PI / 2);
        if (this.driver < 0) return this.finish("termine");
        const door = this.nav?.nearest(c.state.x + rx * LIVREUR.door, c.state.y + ry * LIVREUR.door, 12);
        this.doorAt = door ? { x: door.x, y: door.y } : { x: c.state.x + rx * 4, y: c.state.y + ry * 4 };
        this.walker = new Walker(this.peds, this.driver);
        this.walker.plan(this.nav, this.doorAt.x, this.doorAt.y);
        this.fx.say(this.driver, "Pardon, pardon !", 2);
        this.phase = "door";
        this.phaseT = 0;
        return;
      }
      case "door": {
        if (!this.here(this.driver)) return this.finish("termine");
        if (!this.walker!.step(LIVREUR.run, 0.7, dt) && this.walker!.stuckT < 4 && this.phaseT < 20) {
          this.doorT = 0;
          return;
        }
        this.doorT += dt;
        this.peds.position(this.driver, tmp);
        this.peds.command(this.driver, ORDER.hold, tmp.x + (tmp.x - c.state.x), tmp.y + (tmp.y - c.state.y), 0, this.doorT < 2.5 ? LIFE_POSE.talk : LIFE_POSE.phone);
        if (!this.said) {
          this.said = true;
          this.fx.say(this.driver, "Un colis ! Signez là, s'il vous plaît.", 2.5);
        }
        if (this.doorT < LIVREUR.doorFor) return;
        const h = c.state.heading;
        this.walker!.plan(this.nav, c.state.x + Math.cos(h) * 1.3, c.state.y - Math.sin(h) * 1.3);
        this.phase = "back";
        this.phaseT = 0;
        return;
      }
      case "back": {
        if (!this.here(this.driver)) return this.finish("livre");
        if (!this.walker!.step(LIVREUR.run, 0.8, dt) && this.walker!.stuckT < 4 && this.phaseT < 20) return;
        this.peds.vanish(this.driver);
        this.driver = -1;
        this.finish("livre");
        return;
      }
    }
  }

  private doorT = 0;
  private said = false;
  private planned = false;
  private minD = Infinity;
  private slowT = 0;

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
    if (this.here(this.driver)) {
      if (outcome === "vole") this.peds.release(this.driver);
      else this.peds.vanish(this.driver);
    }
    if (this.traffic.eventCar(this.van)) {
      this.traffic.setNoDriver(this.van, false);
      this.traffic.setHazard(this.van, false);
      this.traffic.hold(this.van, 0);
      // Il repart, calmement cette fois.
      this.traffic.pursue(this.van, null);
      this.traffic.letGo(this.van);
    }
  }

  abort(): void {
    this.finish(this.outcome ?? "abandonne");
  }
}
