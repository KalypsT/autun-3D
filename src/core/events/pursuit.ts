import { gendarmeRecipe } from "../character";
import { LIFE_POSE } from "../character-rig";
import { ORDER, PED_STATE } from "../pedestrians";
import { Fugitive } from "./fugitive";
import { EventRng, type EventAction, type EventCarView, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Poursuite entre la police et un autre conducteur (E5, lot 4 de la phase 4) : un **fugitif** au volant d'une voiture rapide, né hors de vue,
 * passe près du joueur, toutes sirènes derrière lui (une ou deux gendarmeries) ; il grille les feux, prend les sens uniques à contresens (conduite
 * de poursuite, D73), puis cherche à semer la police en choisissant des buts loin d'elle. Ça finit tout seul : il se **crashe** ou se fait
 * **coincer** (il sort et s'enfuit à pied, ou se rend les mains en l'air ; un gendarme le rattrape et l'emmène), ou il **s'échappe**. Le joueur peut
 * l'aider à finir : le percuter, lui barrer la route, le plaquer s'il fuit à pied ; s'il est arrêté grâce à lui : **prime de la gendarmerie**
 * (500 €, un fugitif arrêté au carnet). Percuter la police reste l'infraction habituelle (D70).
 */

export const PURSUIT = {
  /** Modèles du fugitif (rapides). */
  models: ["sportive", "berline", "compacte"] as const,
  /** Gendarmeries derrière lui : une, ou deux une fois sur deux. */
  secondCar: 0.5,
  /** Il passe d'abord près du joueur (il vise un point à … m de lui), puis il fuit : nouveau but tous les … s ou à moins de … m du but, à … m. */
  passNear: 25,
  passFor: 35,
  replan: 7,
  goalNear: 50,
  goalFar: [300, 500] as const,
  /** Coincé : à moins de … m/s pendant … s ; la police à moins de … m : il se rend (sinon il sort et s'enfuit à pied). */
  stuckSpeed: 1,
  stuckFor: 4,
  surrenderReach: 12,
  /** À pied : course (m/s) et essoufflement. */
  footRun: 5.2,
  footTired: 4.2,
  /** Une voiture de police à moins de … m du fugitif à pied se gare, un gendarme en descend et court (… m/s) ; il l'arrête à moins de … m. */
  deployReach: 30,
  officerRun: 4.7,
  arrestReach: 1.3,
  /** Mains en l'air … s, puis tous deux remontent dans la voiture de police. */
  handsFor: 4,
  /** Prime quand le joueur y a contribué (€), et choc minimal (m/s) contre la voiture du fugitif pour compter. */
  reward: 500,
  ramImpact: 1.5,
  /** Échappé : à plus de … m du joueur et hors de vue pendant … s, ou au-delà de … m. */
  escapeFar: 450,
  escapeFor: 10,
  gone: 650,
  /** Durée maximale (s). */
  maxLife: 240,
} as const;

type Phase = "drive" | "foot" | "arrest" | "over";

const tmp = { x: 0, y: 0 };

export class PursuitEvent implements GameEvent {
  readonly kind = "poursuite" as const;
  readonly big = true;
  x = 0;
  y = 0;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  /** Le joueur a aidé à l'arrêter (percuté sa voiture, plaqué ou frappé à pied) : compte au carnet (fugitifs arrêtés). */
  caught = false;
  phase: Phase = "drive";
  readonly fugitiveCar: number;
  readonly police: number[] = [];
  /** Le fugitif à pied (emplacement de la foule, −1 : au volant) et le gendarme qui l'arrête. */
  runner = -1;
  officer = -1;
  officerCar = -1;
  private fugitive: Fugitive | null = null;
  private surrendered = false;
  private contributed = false;
  private t = 0;
  private replanT = 0;
  private stuckT = 0;
  private lostT = 0;
  private handsT = 0;
  private passing = true;
  private goal = { x: 0, y: 0 };
  /** Ce que la police poursuit à pied (le fugitif sorti de sa voiture). */
  private readonly footTarget = { x: 0, y: 0, vx: 0, vy: 0 };
  readonly ok: boolean;

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic,
    private readonly fx: EventEffects,
    ctx: EventContext,
    private readonly rng: EventRng,
  ) {
    const model = PURSUIT.models[Math.floor(rng.next() * PURSUIT.models.length)]!;
    const car = traffic.spawnEvent(false, undefined, model);
    if (!car) {
      this.fugitiveCar = -1;
      this.ok = false;
      this.done = true;
      this.outcome = "abandonne";
      return;
    }
    this.fugitiveCar = car.id;
    this.x = car.state.x;
    this.y = car.state.y;
    const n = rng.next() < PURSUIT.secondCar ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const pc = traffic.spawnEvent(true, { x: car.state.x, y: car.state.y });
      if (!pc) continue;
      this.police.push(pc.id);
      traffic.pursue(pc.id, car.state);
    }
    if (!this.police.length) {
      traffic.drop(car.id);
      this.ok = false;
      this.done = true;
      this.outcome = "abandonne";
      return;
    }
    this.ok = true;
    // D'abord il passe près du joueur (un peu devant lui).
    const p = ctx.player;
    this.goal = { x: p.x + Math.sin(p.yaw) * PURSUIT.passNear, y: p.y + Math.cos(p.yaw) * PURSUIT.passNear };
    traffic.planTo(car.id, this.goal.x, this.goal.y);
  }

  private car(): EventCarView | null {
    return this.traffic.eventCar(this.fugitiveCar);
  }

  private here(slot: number): boolean {
    return slot >= 0 && this.peds.modeOf(slot) >= 0 && this.peds.isBorrowed(slot);
  }

  lawfulTarget(slot: number): boolean {
    return slot === this.runner && this.phase === "foot";
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    this.t += ctx.dt;
    if (this.t > PURSUIT.maxLife) return this.finish("enfui");
    switch (this.phase) {
      case "drive":
        return this.drive(ctx);
      case "foot":
        return this.foot(ctx);
      case "arrest":
        return this.arrest(ctx);
    }
  }

  /** Le fugitif au volant : il passe près du joueur, puis fuit la police ; il peut se faire coincer ou se crasher. */
  private drive(ctx: EventContext): void {
    const c = this.car(), p = ctx.player, dt = ctx.dt;
    if (!c) return this.finish("enfui");
    this.x = c.state.x;
    this.y = c.state.y;
    if ((c.hit ?? 0) > PURSUIT.ramImpact) this.contributed = true;
    // Échappé : loin du joueur et hors de sa vue.
    const dp = Math.hypot(c.state.x - p.x, c.state.y - p.y);
    this.lostT = dp > PURSUIT.escapeFar && !ctx.visible(c.state.x, c.state.y) ? this.lostT + dt : 0;
    if (this.lostT > PURSUIT.escapeFor || dp > PURSUIT.gone) return this.finish("enfui");
    // Coincé ou hors d'usage : il sort.
    const nearest = this.nearestPolice(c.state.x, c.state.y);
    this.stuckT = Math.abs(c.state.speed) < PURSUIT.stuckSpeed && nearest.d < 25 ? this.stuckT + dt : Math.max(0, this.stuckT - dt);
    if (c.abandoned || this.stuckT > PURSUIT.stuckFor) return this.bail(c, nearest.d < PURSUIT.surrenderReach && !c.abandoned);
    // Itinéraire : passer près du joueur, puis fuir loin de la police.
    this.replanT -= dt;
    if (this.passing && (dp < PURSUIT.passNear + 15 || this.t > PURSUIT.passFor)) {
      this.passing = false;
      this.replanT = 0;
    }
    if (!this.passing && (this.replanT <= 0 || Math.hypot(this.goal.x - c.state.x, this.goal.y - c.state.y) < PURSUIT.goalNear)) {
      this.replanT = PURSUIT.replan;
      const away = nearest.d < Infinity ? Math.atan2(c.state.x - nearest.x, c.state.y - nearest.y) : c.state.heading;
      for (let k = 0; k < 5; k++) {
        const a = away + (this.rng.next() - 0.5) * (1.2 + k * 0.5), r = PURSUIT.goalFar[0] + this.rng.next() * (PURSUIT.goalFar[1] - PURSUIT.goalFar[0]);
        const gx = c.state.x + Math.sin(a) * r, gy = c.state.y + Math.cos(a) * r;
        if (this.traffic.planTo(c.id, gx, gy)) {
          this.goal = { x: gx, y: gy };
          break;
        }
      }
    }
  }

  private nearestPolice(x: number, y: number): { d: number; x: number; y: number; id: number } {
    let best = { d: Infinity, x: 0, y: 0, id: -1 };
    for (const id of this.police) {
      const pc = this.traffic.eventCar(id);
      if (!pc) continue;
      const d = Math.hypot(pc.state.x - x, pc.state.y - y);
      if (d < best.d) best = { d, x: pc.state.x, y: pc.state.y, id };
    }
    return best;
  }

  /** Il sort de sa voiture : mains en l'air si la police est tout près (et la voiture encore bonne), sinon il s'enfuit à pied. */
  private bail(c: EventCarView, surrender: boolean): void {
    this.traffic.hold(c.id, 1e6);
    this.traffic.setNoDriver(c.id, true);
    const h = c.state.heading;
    this.runner = this.peds.appear(c.state.x - Math.cos(h) * 1.5, c.state.y + Math.sin(h) * 1.5, c.driver, h - Math.PI / 2);
    if (this.runner < 0) return this.finish("enfui");
    this.footTarget.x = c.state.x;
    this.footTarget.y = c.state.y;
    for (const id of this.police) this.traffic.pursue(id, this.footTarget);
    if (surrender) {
      this.surrendered = true;
      this.fx.say(this.runner, "C'est bon, c'est bon !", 3);
      this.peds.command(this.runner, ORDER.hold, c.state.x, c.state.y, 0, LIFE_POSE.hands);
    } else {
      this.fugitive = new Fugitive(this.peds, this.runner, this.peds.idOf(this.runner), PURSUIT.footRun, PURSUIT.footTired);
      this.fx.cry("startled", c.state.x, c.state.y);
    }
    this.phase = "foot";
  }

  /** À pied : il fuit (le joueur, ou le gendarme le plus proche) ; les voitures de police le suivent, un gendarme descend et lui court après. */
  private foot(ctx: EventContext): void {
    if (!this.here(this.runner)) return this.finish("enfui");
    const peds = this.peds;
    peds.position(this.runner, tmp);
    this.x = this.footTarget.x = tmp.x;
    this.y = this.footTarget.y = tmp.y;
    // Un gendarme descend de la première voiture de police qui arrive près de lui.
    if (this.officer < 0) {
      for (const id of this.police) {
        const pc = this.traffic.eventCar(id);
        if (!pc || Math.hypot(pc.state.x - tmp.x, pc.state.y - tmp.y) > PURSUIT.deployReach) continue;
        this.traffic.pursue(id, null);
        this.traffic.hold(id, 1e6);
        this.traffic.setSiren(id, true, false);
        const h = pc.state.heading;
        this.officer = peds.appear(pc.state.x - Math.cos(h) * 1.4, pc.state.y + Math.sin(h) * 1.4, pc.driver, h, gendarmeRecipe(pc.driver));
        this.officerCar = id;
        if (this.officer >= 0) this.fx.say(this.officer, this.surrendered ? "Les mains en l'air !" : "Halte ! Gendarmerie !", 2.5);
        break;
      }
    }
    let officerAt: { x: number; y: number } | null = null;
    if (this.here(this.officer)) {
      const o = { x: 0, y: 0 };
      peds.position(this.officer, o);
      officerAt = o;
      peds.command(this.officer, ORDER.seek, tmp.x, tmp.y, this.surrendered ? 1.6 : PURSUIT.officerRun);
      const down = peds.modeOf(this.runner) >= PED_STATE.stumble;
      if (Math.hypot(o.x - tmp.x, o.y - tmp.y) < PURSUIT.arrestReach && (down || this.surrendered || peds.speedOf(this.runner) < 3)) return this.startArrest();
    }
    if (this.surrendered) {
      peds.command(this.runner, ORDER.hold, officerAt?.x ?? tmp.x + 1, officerAt?.y ?? tmp.y, 0, LIFE_POSE.hands);
      return;
    }
    if (!this.fugitive) return;
    const p = ctx.player;
    const state = this.fugitive.update(ctx, tmp.x, tmp.y, undefined, officerAt);
    if (state === "tackled" || ((state === "down" || state === "dead") && Math.hypot(p.x - tmp.x, p.y - tmp.y) < 4)) this.contributed = true;
    if (state === "dead") return this.finish("perdu");
    if (state === "escaped") return this.finish("enfui");
  }

  /** Arrêté : mains en l'air quelques secondes, puis le gendarme l'emmène à sa voiture (ils y disparaissent). */
  private startArrest(): void {
    this.phase = "arrest";
    this.handsT = 0;
    if (this.here(this.officer)) this.fx.say(this.officer, "Vous êtes en état d'arrestation.", 3);
  }

  private arrest(ctx: EventContext): void {
    const peds = this.peds;
    this.handsT += ctx.dt;
    const pc = this.officerCar >= 0 ? this.traffic.eventCar(this.officerCar) : null;
    if (!this.here(this.runner)) return this.finish(this.contributed ? "rattrape" : "arrete");
    peds.position(this.runner, tmp);
    if (this.handsT < PURSUIT.handsFor || !pc) {
      const o = { x: tmp.x + 1, y: tmp.y };
      if (this.here(this.officer)) {
        peds.position(this.officer, o);
        peds.command(this.officer, ORDER.hold, tmp.x, tmp.y, 0, LIFE_POSE.talk);
      }
      // Debout (il était peut-être à terre), mains en l'air, tourné vers le gendarme.
      if (peds.modeOf(this.runner) < PED_STATE.stumble) peds.command(this.runner, ORDER.hold, o.x, o.y, 0, LIFE_POSE.hands);
      if (this.handsT > PURSUIT.handsFor + 20) return this.finish(this.contributed ? "rattrape" : "arrete");
      return;
    }
    // Tous deux vers la portière arrière de la voiture de police ; ils y disparaissent.
    const h = pc.state.heading, dx = pc.state.x + Math.cos(h) * 1.4, dy = pc.state.y - Math.sin(h) * 1.4;
    let arrived = true;
    for (const s of [this.runner, this.officer]) {
      if (!this.here(s)) continue;
      peds.position(s, tmp);
      if (Math.hypot(tmp.x - dx, tmp.y - dy) < 0.7) peds.vanish(s);
      else {
        arrived = false;
        peds.command(s, ORDER.seek, dx, dy, 1.4, s === this.runner ? LIFE_POSE.hands : 0);
      }
    }
    if (arrived || this.handsT > PURSUIT.handsFor + 30) this.finish(this.contributed ? "rattrape" : "arrete");
  }

  markers(out: EventMarker[]): void {
    if (this.done || this.phase === "arrest") return;
    out.push({ kind: "fugitive", x: this.x, y: this.y });
  }

  items(_out: GroundItem[]): void {}

  action(): EventAction | null {
    return null;
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    if (outcome === "rattrape") {
      this.caught = true;
      this.goodDeed = true;
      this.fx.earn(PURSUIT.reward, "Prime de la gendarmerie");
      this.fx.feat(`Prime de la gendarmerie · +${PURSUIT.reward} €`);
    }
    // Le fugitif encore là (enfui à pied) redevient un passant ; un gendarme encore dehors remonte (il disparaît).
    if (this.here(this.runner)) this.peds.release(this.runner);
    if (this.here(this.officer)) this.peds.vanish(this.officer);
    for (const id of this.police) {
      if (!this.traffic.eventCar(id)) continue;
      this.traffic.hold(id, 0);
      this.traffic.letGo(id);
    }
    if (this.traffic.eventCar(this.fugitiveCar)) this.traffic.letGo(this.fugitiveCar);
    this.done = true;
  }

  abort(): void {
    if (this.done) return;
    this.finish(this.outcome ?? "abandonne");
  }
}
