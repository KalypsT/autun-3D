import { createRng, type Recipe } from "../character";
import { LIFE_POSE } from "../character-rig";
import { lanePoint } from "../driver";
import type { NavGraph } from "../nav-graph";
import { ORDER, PED_STATE } from "../pedestrians";
import type { RoadGraph } from "../road-graph";
import { Walker } from "./walker";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Cortège de mariage (E11, lot 8 de la phase 4) : le samedi après-midi, à l'hôtel de ville. Des invités endimanchés se rassemblent sur le parvis ;
 * les mariés sortent (elle en blanc, lui en sombre) sous les **applaudissements** et la volée des cloches (« Vive les mariés ! ») ; ils montent
 * dans la **voiture blanche** en tête d'une file de quatre à six voitures garées devant la mairie, et le cortège part au pas, dans les règles,
 * en **klaxonnant sans arrêt** pour un tour de ville. Le joueur peut regarder, le suivre… ou voler la voiture des mariés avant le départ.
 */

/** Hôtel de ville (D123 : façade sur le Champ de Mars, au sud) : le centre du bâtiment, le pied du perron, le parvis. */
export const HALL = { x: 20, y: 78, door: { x: 20, y: 59 }, parvis: { x: 20, y: 52 } } as const;

export const MARIAGE = {
  /** Le joueur à moins de … m de la mairie. */
  reach: 300,
  /** Invités : jusqu'à … passants à moins de … m du parvis ; ils se rassemblent en … s au plus. */
  guests: 5,
  guestRange: 90,
  gather: 35,
  /** Voitures du cortège (… à …), espacées de … m. */
  cars: [4, 6] as const,
  gap: 7.5,
  /** Les mariés sortent, restent … s sur le parvis, puis vont à la voiture. */
  pose: 6,
  /** Le cortège : un but à … – … m ; il roule au plus … s ; un coup de klaxon toutes les … – … s. */
  goal: [400, 600] as const,
  convoyFor: 100,
  honk: [0.35, 0.9] as const,
  honkNear: 260,
  maxLife: 360,
} as const;

/** Ce que le mariage demande au jeu : klaxons, applaudissements, cloches. */
export interface MariageEffects extends EventEffects {
  honk(x: number, y: number): void;
  applause(x: number, y: number, seconds: number): void;
  bells(x: number, y: number, seconds: number): void;
}

type Phase = "gather" | "exit" | "board" | "convoy" | "over";

const tmp = { x: 0, y: 0 };
const lp = { x: 0, y: 0, heading: 0 };

/** Tenue de fête : veste ou chemise, pantalon ou jupe sombres, chaussures de ville (les couleurs de la recette, assombries). */
function dressUp(r: Recipe, seed: number): Recipe {
  const rnd = createRng(seed);
  const skirt = r.sex === "f" && rnd() < 0.6;
  return {
    ...r, top: rnd() < 0.6 ? "jacket" : "shirt", topColor: [1, 8, 11, 15, 9, 3][Math.floor(rnd() * 6)]!, bottom: skirt ? "skirt" : "trousers",
    bottomColor: [1, 2, 3][Math.floor(rnd() * 3)]!, shoes: "leather", shoeColor: 1, hat: r.sex === "f" && rnd() < 0.3 ? "hat" : "none", bag: skirt ? "handbag" : "none",
    scarf: false, outfit: "city", umbrella: false,
  };
}

/** La mariée (robe : manteau et jupe blancs) et le marié (costume sombre). */
function bride(r: Recipe): Recipe {
  return { ...r, sex: "f", age: "adult", top: "coat", topColor: 9, bottom: "skirt", bottomColor: 8, shoes: "leather", shoeColor: 0, hat: "none", bag: "none", scarf: false, glasses: "none", outfit: "city", umbrella: false, beard: "none" };
}
function groom(r: Recipe): Recipe {
  return { ...r, sex: "m", age: "adult", top: "jacket", topColor: 8, bottom: "trousers", bottomColor: 2, shoes: "leather", shoeColor: 1, hat: "none", bag: "none", scarf: false, outfit: "city", umbrella: false };
}

export class MariageEvent implements GameEvent {
  readonly kind = "mariage" as const;
  readonly big = true;
  x: number = HALL.parvis.x;
  y: number = HALL.parvis.y;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  phase: Phase = "gather";
  readonly guests: number[] = [];
  readonly cars: number[] = [];
  couple: [number, number] = [-1, -1];
  readonly ok: boolean;
  private t = 0;
  private phaseT = 0;
  private honkT = 0;
  private walkers = new Map<number, Walker>();
  private planned: boolean[] = [];
  private goal = { x: 0, y: 0 };
  private stolen = false;

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic,
    private readonly road: RoadGraph,
    private readonly nav: NavGraph | null,
    private readonly fx: MariageEffects,
    _ctx: EventContext,
    private readonly rng: EventRng,
  ) {
    // Les voitures, garées l'une derrière l'autre sans conducteur (la première blanche) : sur la rue la plus proche du parvis assez longue pour
    // toute la file (une arête d'au moins 25 m : celle juste devant la mairie n'en fait que 18).
    const n = MARIAGE.cars[0] + Math.floor(rng.next() * (MARIAGE.cars[1] - MARIAGE.cars[0] + 1));
    let best: { edge: number; d: number } | null = null;
    for (const r of [0, 15, 30, 45, 60, 75]) {
      for (let k = 0; k < (r ? 12 : 1); k++) {
        const a = (k * Math.PI) / 6, hit = road.nearest(HALL.parvis.x + Math.sin(a) * r, HALL.parvis.y + Math.cos(a) * r, 20);
        if (!hit || !road.drivable(hit.edge) || road.edgeLength(hit.edge) < 25 || road.edgeClass(hit.edge) > 4) continue;
        const d = Math.hypot(hit.x - HALL.parvis.x, hit.y - HALL.parvis.y);
        if (!best || d < best.d) best = { edge: hit.edge, d };
      }
    }
    let ok = !!best;
    if (best) {
      const e = best.edge, len = road.edgeLength(e), ow = road.oneway(e);
      const move = ow === 2 ? e * 2 + 1 : e * 2;
      const s0 = len - 4;
      const seed = Math.floor(rng.next() * 1e9);
      for (let k = 0; k < n; k++) {
        const s = s0 - k * MARIAGE.gap;
        if (s < 3) break;
        lanePoint(road, move, s, lp);
        const c = traffic.stage(lp.x, lp.y, lp.heading, seed + k * 7919, k === 0 ? { model: "berline", paint: "#f4f1ea" } : {});
        if (!c) continue;
        traffic.setNoDriver(c.id, true);
        this.cars.push(c.id);
      }
      ok = this.cars.length >= 3;
    }
    this.ok = ok;
    if (!ok) {
      for (const id of this.cars) traffic.drop(id);
      this.done = true;
      this.outcome = "abandonne";
      return;
    }
    // Les invités : des passants proches, endimanchés, qui viennent sur le parvis.
    const near: number[] = [];
    peds.queryCircle(HALL.parvis.x, HALL.parvis.y, MARIAGE.guestRange, near);
    for (const i of near) {
      if (this.guests.length >= MARIAGE.guests) break;
      if (peds.isBorrowed(i) || peds.attached(i) || peds.modeOf(i) !== PED_STATE.walk || peds.recipe(i).outfit === "work") continue;
      if (!peds.borrow(i)) continue;
      peds.setRecipe(i, dressUp(peds.recipe(i), peds.idOf(i)));
      this.guests.push(i);
      const k = this.guests.length - 1, a = -1.1 + (k / Math.max(1, MARIAGE.guests - 1)) * 2.2, r = 4 + (k % 2) * 1.6;
      // En arc de cercle devant le perron, tournés vers la porte.
      this.walkTo(i, HALL.door.x + Math.sin(a) * r, HALL.door.y - Math.cos(a) * r - 1);
    }
  }

  private here(slot: number): boolean {
    return slot >= 0 && this.peds.modeOf(slot) >= 0 && this.peds.isBorrowed(slot);
  }

  private walkTo(slot: number, x: number, y: number): void {
    const w = new Walker(this.peds, slot);
    w.plan(this.nav, x, y, true);
    this.walkers.set(slot, w);
  }

  /** Un pas vers son but ; vrai une fois arrivé (ou bloqué). */
  private step(slot: number, speed: number, dt: number): boolean {
    const w = this.walkers.get(slot);
    return !w || w.step(speed, 0.6, dt) || w.stuckT > 6;
  }

  lawfulTarget(): boolean {
    return false;
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    const dt = ctx.dt, p = ctx.player;
    this.t += dt;
    this.phaseT += dt;
    if (this.t > MARIAGE.maxLife) return this.finish(this.outcome ?? "cortege");
    // La voiture des mariés prise avant le départ.
    if (!this.stolen && this.phase !== "convoy" && !this.traffic.eventCar(this.cars[0]!)) {
      this.stolen = true;
      this.outcome = "vole";
      const who = this.here(this.couple[0]) ? this.couple[0] : this.guests.find((g) => this.here(g));
      if (who !== undefined && who >= 0) this.fx.say(who, "Notre voiture !", 3);
    }
    switch (this.phase) {
      case "gather": {
        let at = 0;
        for (const g of this.guests) {
          if (!this.here(g)) continue;
          if (this.step(g, 1.5, dt)) {
            at++;
            this.peds.command(g, ORDER.hold, HALL.door.x, HALL.door.y, 0, at % 3 === 0 ? LIFE_POSE.phone : LIFE_POSE.talk);
          }
        }
        if (at >= Math.min(4, this.guests.length) || this.phaseT > MARIAGE.gather) this.exit();
        return;
      }
      case "exit":
        return this.exitStep(dt);
      case "board":
        return this.boardStep(dt);
      case "convoy":
        return this.convoyStep(dt, p);
    }
  }

  /** Les mariés sortent : applaudissements, cloches, « Vive les mariés ! ». */
  private exit(): void {
    const seed = Math.floor(this.rng.next() * 1e9);
    const b = this.peds.appear(HALL.door.x - 0.4, HALL.door.y, seed, Math.PI);
    const g = this.peds.appear(HALL.door.x + 0.4, HALL.door.y, seed ^ 0x2f, Math.PI);
    if (b >= 0) this.peds.setRecipe(b, bride(this.peds.recipe(b)));
    if (g >= 0) this.peds.setRecipe(g, groom(this.peds.recipe(g)));
    this.couple = [b, g];
    for (const s of this.couple) if (s >= 0) this.walkTo(s, HALL.parvis.x + (s === b ? -0.4 : 0.4), HALL.parvis.y + 2);
    this.fx.applause(HALL.door.x, HALL.door.y, 6);
    this.fx.bells(HALL.x, HALL.y, 12);
    const [first, second] = this.guests.filter((x) => this.here(x));
    if (first !== undefined) this.fx.say(first, "Vive les mariés !", 3);
    if (second !== undefined) this.fx.say(second, "Bravo !", 2.5);
    this.phase = "exit";
    this.phaseT = 0;
  }

  /** Les invités applaudissent ; les mariés descendent sur le parvis, s'y arrêtent, puis vont à la voiture blanche. */
  private exitStep(dt: number): void {
    for (const g of this.guests) {
      if (!this.here(g) || this.peds.speedOf(g) > 0.3) continue;
      this.peds.position(this.couple[0] >= 0 ? this.couple[0] : g, tmp);
      this.peds.command(g, ORDER.hold, tmp.x, tmp.y, 0, this.phaseT < 7 ? LIFE_POSE.clap : LIFE_POSE.talk);
    }
    let arrived = 0;
    for (const s of this.couple) if (!this.here(s) || this.step(s, 0.9, dt)) arrived++;
    if (arrived < 2) {
      this.phaseT = Math.min(this.phaseT, 1);
      return;
    }
    // L'un face à l'autre, sous les applaudissements.
    const [b, g] = this.couple;
    if (this.here(b) && this.here(g)) {
      this.peds.position(g, tmp);
      this.peds.command(b, ORDER.hold, tmp.x, tmp.y, 0, LIFE_POSE.talk);
      this.peds.position(b, tmp);
      this.peds.command(g, ORDER.hold, tmp.x, tmp.y, 0, LIFE_POSE.talk);
    }
    if (this.phaseT < MARIAGE.pose + 1) return;
    // Vers les voitures : les mariés à la première ; quelques invités aux suivantes ; les autres restent (ils redeviendront des passants).
    const lead = this.traffic.eventCar(this.cars[0]!);
    if (lead) for (const s of this.couple) if (this.here(s)) this.walkTo(s, lead.state.x - Math.cos(lead.state.heading) * 1.3, lead.state.y + Math.sin(lead.state.heading) * 1.3);
    this.cars.slice(1).forEach((id, k) => {
      const g = this.guests.filter((x) => this.here(x))[k], c = this.traffic.eventCar(id);
      if (g !== undefined && c) this.walkTo(g, c.state.x - Math.cos(c.state.heading) * 1.3, c.state.y + Math.sin(c.state.heading) * 1.3);
    });
    this.phase = "board";
    this.phaseT = 0;
  }

  /** Chacun monte dans sa voiture (il y disparaît) ; puis le cortège part. */
  private boardStep(dt: number): void {
    let waiting = 0;
    for (const [slot, w] of this.walkers) {
      if (!this.here(slot)) continue;
      const boarding = this.couple.includes(slot) || this.guests.indexOf(slot) < this.cars.length - 1;
      if (!boarding) continue;
      if (w.step(1.3, 0.8, dt) || w.stuckT > 6 || this.phaseT > 30) this.peds.vanish(slot);
      else waiting++;
    }
    if (waiting > 0) return;
    // Les invités qui restent sur le parvis redeviennent des passants.
    for (const g of this.guests) if (this.here(g)) this.peds.release(g);
    // Le cortège part pour un tour de ville : un but loin, le même pour toutes (elles prennent le même chemin, l'une derrière l'autre).
    const lead = this.traffic.eventCar(this.cars[0]!) ?? this.traffic.eventCar(this.cars[1]!);
    const from = lead ? lead.state : { x: this.x, y: this.y, heading: 0 };
    for (let k = 0; k < 6; k++) {
      const a = from.heading + (this.rng.next() - 0.5) * 2, r = MARIAGE.goal[0] + this.rng.next() * (MARIAGE.goal[1] - MARIAGE.goal[0]);
      const gx = from.x + Math.sin(a) * r, gy = from.y + Math.cos(a) * r;
      if (this.road.nearest(gx, gy, 60)) {
        this.goal = { x: gx, y: gy };
        break;
      }
    }
    this.planned = this.cars.map(() => false);
    for (const id of this.cars) {
      if (!this.traffic.eventCar(id)) continue;
      this.traffic.setNoDriver(id, false);
      this.traffic.hold(id, 0);
    }
    this.phase = "convoy";
    this.phaseT = 0;
  }

  /** Le cortège roule, dans les règles, en klaxonnant sans arrêt ; au bout d'un moment (ou loin du joueur), chacun reprend sa route. */
  private convoyStep(dt: number, p: { x: number; y: number }): void {
    let lead: { x: number; y: number } | null = null;
    this.cars.forEach((id, k) => {
      const c = this.traffic.eventCar(id);
      if (!c) return;
      lead ??= c.state;
      if (!this.planned[k]) this.planned[k] = this.traffic.planTo(id, this.goal.x, this.goal.y, false);
    });
    if (lead) {
      const l = lead as { x: number; y: number };
      this.x = l.x;
      this.y = l.y;
    }
    this.honkT -= dt;
    if (this.honkT <= 0) {
      this.honkT = MARIAGE.honk[0] + this.rng.next() * (MARIAGE.honk[1] - MARIAGE.honk[0]);
      const live = this.cars.map((id) => this.traffic.eventCar(id)).filter((c) => c !== null);
      const c = live[Math.floor(this.rng.next() * live.length)];
      if (c && Math.hypot(c.state.x - p.x, c.state.y - p.y) < MARIAGE.honkNear) this.fx.honk(c.state.x, c.state.y);
    }
    if (!lead || this.phaseT > MARIAGE.convoyFor || Math.hypot(this.x - p.x, this.y - p.y) > 450) this.finish(this.outcome ?? "cortege");
  }

  markers(out: EventMarker[]): void {
    if (!this.done) out.push({ kind: "scene", x: this.x, y: this.y });
  }

  items(_out: GroundItem[]): void {}

  action(): EventAction | null {
    return null;
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    this.done = true;
    for (const g of this.guests) if (this.here(g)) this.peds.release(g);
    for (const s of this.couple) if (this.here(s)) this.peds.vanish(s);
    for (const id of this.cars) {
      if (!this.traffic.eventCar(id)) continue;
      this.traffic.setNoDriver(id, false);
      this.traffic.hold(id, 0);
      this.traffic.letGo(id);
    }
  }

  abort(): void {
    this.finish(this.outcome ?? "abandonne");
  }
}
