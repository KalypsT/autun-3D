import { gendarmeRecipe } from "../character";
import { LIFE_POSE } from "../character-rig";
import type { NavGraph } from "../nav-graph";
import { ORDER, PED_STATE } from "../pedestrians";
import type { RoadGraph } from "../road-graph";
import { roadside, walkLength, Walker } from "./walker";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventPlayer, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Rixe (E7, lot 6 de la phase 4) : le soir, devant un bar ou un restaurant, deux ou trois passants se disputent (« Qu'est-ce que tu regardes ? »),
 * puis en viennent aux **poings** (garde levée, coups qui font trébucher ou tomber, jamais de sang ni de mort : Q3). Des curieux font cercle, les
 * autres s'écartent. Au bout d'une minute environ, une **patrouille** arrive ; un gendarme descend (« Gendarmerie ! On se calme ! ») : l'un
 * s'enfuit, l'autre lève les mains et finit dans la voiture. Le joueur peut les **séparer** (« Séparer », 50 €, une bonne action), ou s'en mêler :
 * frapper l'un d'eux est une agression comme une autre, et celui-là s'en prend alors à lui, aux poings.
 */

export const RIXE = {
  /** La scène : un bar ou un restaurant à … – … m du joueur ; les bagarreurs, des passants (ou des clients en terrasse) à moins de … m de lui. */
  near: 25,
  far: 70,
  pick: 35,
  /** Deux bagarreurs, un troisième une fois sur … */
  third: 0.3,
  /** Ils se rejoignent (au plus … s), se disputent … – … s, puis se battent. */
  gather: 12,
  dispute: [7, 11] as const,
  /** Un coup toutes les … – … s par bagarreur, à moins de … m ; poussée (m/s) : il trébuche, ou une fois sur … il tombe. */
  strike: [1.6, 3.2] as const,
  reach: 1.5,
  push: 2.4,
  fall: 4.2,
  fallChance: 0.25,
  /** Distance de garde entre deux bagarreurs (m). */
  guard: 1.05,
  /** Une réplique toutes les … s. */
  line: 2.4,
  /** Curieux : jusqu'à … passants à moins de … m, en cercle à … m ; les autres s'écartent (alarme de … m). */
  onlookers: 2,
  onlookerRange: 30,
  ring: 6.5,
  alarm: 9,
  /** La patrouille part … – … s après le début des coups ; elle se gare à moins de … m ; sans patrouille, ils se séparent au bout de … s. */
  policeAfter: [40, 65] as const,
  parkReach: 12,
  fightMax: 110,
  /** Le gendarme court (m/s) ; il arrête à moins de … m ; mains en l'air … s. */
  officerRun: 4.2,
  arrestReach: 1.3,
  handsFor: 3,
  /** Le joueur sépare : à moins de … m d'un bagarreur, à pied ; prime (€). */
  separateReach: 1.8,
  reward: 50,
  /** Frappé par le joueur, il s'en prend à lui : un coup toutes les … s à moins de … m, … points de vie ; il lâche le joueur au-delà de … m. */
  hitEvery: 1.3,
  hitReach: 1.35,
  hitDamage: 8,
  giveUp: 20,
  /** Le joueur est parti : au-delà de … m pendant … s, tout s'arrête ; durée maximale (s). */
  leaveFar: 250,
  leaveFor: 20,
  maxLife: 240,
} as const;

const LINES = [
  "Qu'est-ce que tu regardes ?", "Tu me cherches ?", "Répète un peu !", "Dégage !", "Viens, viens !", "C'est toi qui as commencé !",
  "Tu vas voir !", "Lâche-moi !",
] as const;

/** Ce que la rixe demande au jeu en plus : un coup de poing reçu par le joueur (points de vie). */
export interface RixeEffects extends EventEffects {
  hurtPlayer(damage: number, fromX: number, fromY: number): void;
}

type Phase = "gather" | "dispute" | "fight" | "police" | "arrest" | "calm" | "over";

const tmp = { x: 0, y: 0 };

/** La scène d'une rixe : un bar (ou restaurant) à 25 – 70 m, et deux ou trois adultes (passants, clients en terrasse) à moins de 35 m de lui. */
export function findRixe(peds: EventPeds, ctx: EventContext, bars: readonly { x: number; y: number }[], rng: EventRng): { x: number; y: number; fighters: number[] } | null {
  const p = ctx.player;
  const cand = bars.filter((b) => {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    return d > RIXE.near && d < RIXE.far;
  });
  for (let tries = 0; tries < 3 && cand.length; tries++) {
    const bar = cand[Math.floor(rng.next() * cand.length)]!;
    const near: number[] = [];
    peds.queryCircle(bar.x, bar.y, RIXE.pick, near);
    // Debout ou assis en terrasse (ils se lèvent), adultes, pas en tenue de travail.
    const ok = near.filter((i) => {
      if (peds.isBorrowed(i) || peds.attached(i)) return false;
      const m = peds.modeOf(i);
      if (m !== PED_STATE.walk && m !== PED_STATE.sit && m !== PED_STATE.idle && m !== PED_STATE.wait) return false;
      const r = peds.recipe(i);
      return r.age === "adult" && r.outfit !== "work";
    });
    if (ok.length < 2) continue;
    const n = ok.length >= 3 && rng.next() < RIXE.third ? 3 : 2;
    const fighters: number[] = [];
    for (let k = 0; k < n; k++) fighters.push(ok.splice(Math.floor(rng.next() * ok.length), 1)[0]!);
    // La scène : le premier bagarreur, rapproché du bar (sur le trottoir, devant lui).
    peds.position(fighters[0]!, tmp);
    const d = Math.hypot(bar.x - tmp.x, bar.y - tmp.y) || 1, k = Math.max(0, d - 6) / d;
    return { x: tmp.x + (bar.x - tmp.x) * k, y: tmp.y + (bar.y - tmp.y) * k, fighters };
  }
  return null;
}

export class RixeEvent implements GameEvent {
  readonly kind = "rixe" as const;
  readonly big = true;
  x: number;
  y: number;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  phase: Phase = "gather";
  /** Les bagarreurs, les curieux, le gendarme, la voiture de police (−1 : pas encore). */
  readonly fighters: number[];
  readonly onlookers: number[] = [];
  gendarme = -1;
  police = -1;
  /** Le bagarreur qui s'en prend au joueur (−1 : aucun), celui qu'on arrête, celui qui s'enfuit. */
  angry = -1;
  arrested = -1;
  runner = -1;
  /** Le joueur les a séparés. */
  separated = false;
  private readonly ids: number[];
  private readonly strikeT: number[];
  /** Instant (s) du dernier coup que la scène a donné à chacun (une chute plus tard vient d'ailleurs : le joueur, une voiture). */
  private readonly ourHit: number[];
  private t = 0;
  private phaseT = 0;
  private fightT = 0;
  private lineT = 0;
  private lineK = 0;
  private awayT = 0;
  private hitT = 0;
  private dt = 0;
  private readonly policeAt: number;
  private disputeFor: number;
  private target: { x: number; y: number; vx: number; vy: number } | null = null;
  private walker: Walker | null = null;
  private gathered = false;
  private carStuckT = 0;
  private parked = false;

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic | null,
    private readonly road: RoadGraph | null,
    private readonly nav: NavGraph | null,
    private readonly fx: RixeEffects,
    site: { x: number; y: number; fighters: number[] },
    private readonly rng: EventRng,
  ) {
    this.x = site.x;
    this.y = site.y;
    this.fighters = site.fighters.filter((i) => peds.borrow(i));
    this.ids = this.fighters.map((i) => peds.idOf(i));
    this.strikeT = this.fighters.map(() => RIXE.strike[0] + rng.next() * (RIXE.strike[1] - RIXE.strike[0]));
    this.ourHit = this.fighters.map(() => -10);
    this.policeAt = RIXE.policeAfter[0] + rng.next() * (RIXE.policeAfter[1] - RIXE.policeAfter[0]);
    this.disputeFor = RIXE.dispute[0] + rng.next() * (RIXE.dispute[1] - RIXE.dispute[0]);
  }

  private here(slot: number): boolean {
    return slot >= 0 && this.peds.modeOf(slot) >= 0 && this.peds.isBorrowed(slot);
  }

  private fighterHere(k: number): boolean {
    const i = this.fighters[k]!;
    return this.here(i) && this.peds.idOf(i) === this.ids[k];
  }

  /** Où le bagarreur `k` se tient face aux autres : de part et d'autre de la scène (le troisième en retrait, derrière le second). */
  private spot(k: number): { x: number; y: number } {
    const a = k === 0 ? 0 : k === 1 ? Math.PI : Math.PI * 0.8;
    const r = k === 2 ? RIXE.guard * 1.3 : RIXE.guard / 2;
    return { x: this.x + Math.sin(a) * r, y: this.y + Math.cos(a) * r };
  }

  /** L'adversaire du bagarreur `k` (le premier contre les autres). */
  private foe(k: number): number {
    return k === 0 ? (this.fighterHere(1) ? 1 : this.fighterHere(2) ? 2 : -1) : this.fighterHere(0) ? 0 : -1;
  }

  lawfulTarget(): boolean {
    return false;
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    const dt = ctx.dt, p = ctx.player;
    this.dt = dt;
    this.t += dt;
    this.phaseT += dt;
    this.awayT = Math.hypot(this.x - p.x, this.y - p.y) > RIXE.leaveFar ? this.awayT + dt : 0;
    if (this.awayT > RIXE.leaveFor || this.t > RIXE.maxLife) return this.finish(this.outcome ?? "disperse");
    if (this.fighters.some((i, k) => this.ids[k] === this.peds.idOf(i) && this.peds.modeOf(i) === PED_STATE.dead)) return this.finish("perdu");
    this.watchHits(p);
    if (this.angry >= 0) return this.angryStep(p);
    switch (this.phase) {
      case "gather":
        return this.gatherStep();
      case "dispute":
        this.face(LIFE_POSE.point, LIFE_POSE.talk);
        this.talk();
        if (this.phaseT > this.disputeFor) this.go("fight");
        return;
      case "fight":
        return this.fightStep(ctx);
      case "police":
        this.fightStep(ctx);
        return this.policeStep(ctx);
      case "arrest":
        return this.arrestStep();
      case "calm":
        if (this.phaseT > 2.5) this.finish(this.outcome ?? "disperse");
        return;
    }
  }

  private go(phase: Phase): void {
    this.phase = phase;
    this.phaseT = 0;
  }

  /** Ils se rejoignent devant le bar. */
  private gatherStep(): void {
    let arrived = 0;
    this.fighters.forEach((i, k) => {
      if (!this.fighterHere(k)) return;
      const s = this.spot(k);
      this.peds.position(i, tmp);
      if (Math.hypot(tmp.x - s.x, tmp.y - s.y) < 0.6) arrived++;
      else this.peds.command(i, ORDER.seek, s.x, s.y, 1.6);
    });
    if (this.fighters.filter((_, k) => this.fighterHere(k)).length < 2) return this.finish("abandonne");
    if (arrived >= 2 || this.phaseT > RIXE.gather) this.go("dispute");
  }

  /** Chacun face à son adversaire, dans une pose (celui qui parle montre du doigt). */
  private face(speaking: number, listening: number): void {
    this.fighters.forEach((i, k) => {
      if (!this.fighterHere(k) || this.peds.modeOf(i) >= PED_STATE.stumble) return;
      const f = this.foe(k);
      if (f < 0) return;
      this.peds.position(this.fighters[f]!, tmp);
      const pose = speaking === LIFE_POSE.fists ? speaking : this.lineK % 2 === (k === 0 ? 1 : 0) ? speaking : listening;
      // Pendant la bagarre, il garde sa distance de garde face à l'autre (il avance s'il est trop loin).
      const me = { x: 0, y: 0 };
      this.peds.position(i, me);
      const d = Math.hypot(tmp.x - me.x, tmp.y - me.y);
      if (speaking === LIFE_POSE.fists && d > RIXE.guard + 0.4) this.peds.command(i, ORDER.seek, tmp.x + ((me.x - tmp.x) / d) * RIXE.guard, tmp.y + ((me.y - tmp.y) / d) * RIXE.guard, 1.8);
      else this.peds.command(i, ORDER.hold, tmp.x, tmp.y, 0, pose);
    });
  }

  private talk(): void {
    this.lineT -= this.dt;
    if (this.lineT > 0) return;
    this.lineT = RIXE.line;
    const k = this.lineK++ % this.fighters.length;
    if (this.fighterHere(k)) this.fx.say(this.fighters[k]!, LINES[Math.floor(this.rng.next() * LINES.length)]!, 2.2);
  }

  /** Les coups : chacun frappe son adversaire de temps en temps (il trébuche, parfois tombe). Les curieux font cercle ; la patrouille vient. */
  private fightStep(ctx: EventContext): void {
    if (this.phase === "fight") this.fightT += this.dt;
    if (!this.gathered) this.gather();
    this.face(LIFE_POSE.fists, LIFE_POSE.fists);
    if (this.phase === "fight" && this.rng.next() < this.dt / 4) this.talk();
    this.fighters.forEach((i, k) => {
      if (!this.fighterHere(k) || this.peds.modeOf(i) >= PED_STATE.stumble) return;
      this.strikeT[k]! -= this.dt;
      if (this.strikeT[k]! > 0) return;
      this.strikeT[k] = RIXE.strike[0] + this.rng.next() * (RIXE.strike[1] - RIXE.strike[0]);
      const f = this.foe(k);
      if (f < 0) return;
      const j = this.fighters[f]!;
      if (this.peds.modeOf(j) >= PED_STATE.stumble) return;
      const me = { x: 0, y: 0 };
      this.peds.position(i, me);
      this.peds.position(j, tmp);
      const d = Math.hypot(tmp.x - me.x, tmp.y - me.y);
      if (d > RIXE.reach) return;
      const v = this.rng.next() < RIXE.fallChance ? RIXE.fall : RIXE.push;
      this.ourHit[f] = this.t;
      this.peds.applyImpulse(j, ((tmp.x - me.x) / (d || 1)) * v, ((tmp.y - me.y) / (d || 1)) * v);
      this.fx.cry("oof", tmp.x, tmp.y);
    });
    // Sans patrouille (pas de circulation, pas de place), ils finissent par se séparer.
    if (this.phase === "fight") {
      if (this.police < 0 && this.fightT > this.policeAt && this.traffic) this.callPolice(ctx);
      if (this.fightT > RIXE.fightMax) this.calm("disperse");
    }
  }

  /** Une chute que la scène n'a pas donnée (le joueur l'a frappé ; une voiture) : s'il est près, il s'en prend à lui une fois relevé. */
  private watchHits(p: EventPlayer): void {
    if (this.angry >= 0 || this.phase === "arrest" || this.phase === "calm") return;
    this.fighters.forEach((i, k) => {
      if (this.angry >= 0 || !this.fighterHere(k)) return;
      if (this.peds.modeOf(i) < PED_STATE.stumble || this.t - this.ourHit[k]! < 0.6) return;
      this.peds.position(i, tmp);
      if (!p.onFoot || Math.hypot(tmp.x - p.x, tmp.y - p.y) > 3) return;
      this.angry = k;
      this.hitT = RIXE.hitEvery;
      // Les autres en profitent pour filer.
      this.fighters.forEach((o, m) => {
        if (m !== k && this.fighterHere(m)) this.peds.release(o);
      });
    });
  }

  /** Il s'en prend au joueur : il le suit, garde levée, et frappe à portée. Il lâche le joueur parti loin, ou à la patrouille. */
  private angryStep(p: EventPlayer): void {
    const k = this.angry, i = this.fighters[k]!;
    if (!this.fighterHere(k)) return this.finish("disperse");
    if (this.peds.modeOf(i) >= PED_STATE.stumble) return;
    this.peds.position(i, tmp);
    const d = Math.hypot(tmp.x - p.x, tmp.y - p.y);
    if (d > RIXE.giveUp || !p.onFoot) {
      this.fx.say(i, "Ouais, c'est ça, cours !", 2.5);
      return this.finish("disperse");
    }
    if (d > 1.1) this.peds.command(i, ORDER.seek, p.x + ((tmp.x - p.x) / d) * 0.9, p.y + ((tmp.y - p.y) / d) * 0.9, 3.6);
    else this.peds.command(i, ORDER.hold, p.x, p.y, 0, LIFE_POSE.fists);
    this.hitT -= this.dt;
    if (this.hitT <= 0 && d < RIXE.hitReach) {
      this.hitT = RIXE.hitEvery;
      this.fx.hurtPlayer(RIXE.hitDamage, tmp.x, tmp.y);
    }
  }

  /** Les curieux : quelques passants viennent regarder en cercle ; les autres, tout près, s'écartent. */
  private gather(): void {
    this.gathered = true;
    const near: number[] = [];
    this.peds.queryCircle(this.x, this.y, RIXE.onlookerRange, near);
    for (const i of near) {
      if (this.onlookers.length >= RIXE.onlookers) break;
      if (this.fighters.includes(i) || this.peds.modeOf(i) !== PED_STATE.walk || this.peds.isBorrowed(i) || this.peds.attached(i)) continue;
      if (this.peds.borrow(i)) this.onlookers.push(i);
    }
    this.onlookers.forEach((i, k) => {
      const a = 0.9 + k * 1.6;
      this.peds.command(i, ORDER.seek, this.x + Math.sin(a) * RIXE.ring, this.y + Math.cos(a) * RIXE.ring, 1.3);
    });
    this.peds.alarm(this.x, this.y, RIXE.alarm, 0.6, this.fighters[0]);
  }

  /** Les curieux arrivés regardent (certains filment). */
  private watch(): void {
    this.onlookers.forEach((i, k) => {
      if (!this.here(i) || this.peds.speedOf(i) > 0.2) return;
      this.peds.command(i, ORDER.hold, this.x, this.y, 0, k === 1 ? LIFE_POSE.phone : 0);
    });
  }

  /** La patrouille part hors de vue vers la scène, sirène. */
  private callPolice(ctx: EventContext): void {
    this.target ??= roadside(this.road, this.x, this.y, ctx.lineClear);
    const c = this.traffic!.spawnEvent(true, { x: this.x, y: this.y });
    if (!c) {
      this.fightT = this.policeAt - 5;
      return;
    }
    this.police = c.id;
    if (this.traffic!.planTo(c.id, this.target.x, this.target.y)) this.traffic!.setSiren(c.id, true);
    else this.traffic!.pursue(c.id, this.target);
    this.go("police");
  }

  /** La patrouille arrive, se gare ; un gendarme descend et court vers eux : l'un s'enfuit, l'autre lève les mains. */
  private policeStep(_ctx: EventContext): void {
    this.watch();
    const t = this.traffic;
    const c = t && this.police >= 0 ? t.eventCar(this.police) : null;
    if (!c) return this.calm("disperse");
    if (this.gendarme < 0) {
      const tg = this.target!;
      // Arrivée ; ou arrêtée plus de 10 s (bouchon, rue qu'elle ne sait pas prendre) à moins de 110 m à pied : elle se gare là ; au pire au bout
      // de 90 s. Le gendarme finit à pied.
      this.carStuckT = Math.abs(c.state.speed) < 0.6 ? this.carStuckT + this.dt : 0;
      const close = Math.hypot(c.state.x - tg.x, c.state.y - tg.y) < RIXE.parkReach;
      const stuck = this.carStuckT > 10 && Math.floor(this.carStuckT) !== Math.floor(this.carStuckT - this.dt) && walkLength(this.nav, c.state.x, c.state.y, this.x, this.y) < 110;
      if (!close && !stuck && !this.parked && this.phaseT < 90) return;
      this.parked = true;
      t!.pursue(c.id, null);
      t!.hold(c.id, 1e6);
      if (Math.abs(c.state.speed) > 0.6) return;
      t!.setSiren(c.id, true, false);
      const h = c.state.heading;
      this.gendarme = this.peds.appear(c.state.x - Math.cos(h) * 1.4, c.state.y + Math.sin(h) * 1.4, c.driver, h, gendarmeRecipe(c.driver));
      if (this.gendarme < 0) return this.calm("disperse");
      this.fx.say(this.gendarme, "Gendarmerie ! On se calme !", 2.5);
      // Le premier bagarreur encore debout se rend ; les autres s'enfuient (ils redeviennent des passants qui fuient la scène).
      this.fighters.forEach((i, k) => {
        if (!this.fighterHere(k)) return;
        if (this.arrested < 0 && this.peds.modeOf(i) < PED_STATE.stumble) {
          this.arrested = i;
          this.peds.command(i, ORDER.hold, c.state.x, c.state.y, 0, LIFE_POSE.hands);
          this.fx.say(i, "C'est pas moi, c'est lui !", 2.5);
        } else {
          this.runner = i;
          this.peds.command(i, ORDER.flee, c.state.x, c.state.y, 5);
        }
      });
      this.walker = new Walker(this.peds, this.gendarme);
      if (this.arrested >= 0) {
        this.peds.position(this.arrested, tmp);
        this.walker.plan(this.nav, tmp.x, tmp.y);
      }
      this.go("arrest");
    }
  }

  /** Le gendarme rejoint celui qui s'est rendu ; mains en l'air, puis tous deux montent dans la voiture, qui repart. */
  private arrestStep(): void {
    this.watch();
    // Le fuyard : relâché une fois loin (il redevient un passant).
    if (this.runner >= 0 && this.here(this.runner)) {
      this.peds.position(this.runner, tmp);
      if (Math.hypot(tmp.x - this.x, tmp.y - this.y) > 30 || this.phaseT > 15) {
        this.peds.release(this.runner);
        this.runner = -1;
      }
    }
    const c = this.traffic && this.police >= 0 ? this.traffic.eventCar(this.police) : null;
    if (!c || !this.here(this.gendarme)) return this.finish(this.arrested >= 0 ? "arrete" : "disperse");
    if (this.arrested < 0 || !this.here(this.arrested)) {
      // Personne à arrêter : il remonte.
      return this.backToCar(c, [this.gendarme]) ? this.finish("disperse") : undefined;
    }
    if (this.phaseT < 30 && !this.cuffed) {
      this.peds.position(this.arrested, tmp);
      if (this.walker!.step(RIXE.officerRun, RIXE.arrestReach, this.dt)) {
        this.cuffed = true;
        this.cuffT = 0;
        this.fx.say(this.gendarme, "Vous êtes en état d'arrestation.", 2.5);
      } else if (this.walker!.stuckT > 4) this.walker!.plan(this.nav, tmp.x, tmp.y);
      this.peds.command(this.arrested, ORDER.hold, tmp.x + 1, tmp.y, 0, LIFE_POSE.hands);
      return;
    }
    this.cuffT += this.dt;
    if (this.cuffT < RIXE.handsFor) {
      this.peds.position(this.arrested, tmp);
      this.peds.command(this.gendarme, ORDER.hold, tmp.x, tmp.y, 0, LIFE_POSE.talk);
      return;
    }
    if (this.backToCar(c, [this.gendarme, this.arrested]) || this.cuffT > 45) this.finish("arrete");
  }

  private cuffed = false;
  private cuffT = 0;
  private carWalkers: Walker[] | null = null;

  /** Vers la portière arrière de la voiture de police ; ils y disparaissent. Vrai quand tous y sont montés. */
  private backToCar(c: { state: { x: number; y: number; heading: number } }, who: number[]): boolean {
    const h = c.state.heading, dx = c.state.x + Math.cos(h) * 1.4, dy = c.state.y - Math.sin(h) * 1.4;
    if (!this.carWalkers) {
      this.carWalkers = who.map((s) => {
        const w = new Walker(this.peds, s);
        w.plan(this.nav, dx, dy);
        return w;
      });
    }
    let all = true;
    for (const w of this.carWalkers) {
      if (!this.here(w.slot)) continue;
      if (w.step(1.4, 0.7, this.dt) || w.stuckT > 6) this.peds.vanish(w.slot);
      else {
        all = false;
        if (w.slot === this.arrested) this.peds.command(w.slot, ORDER.seek, dx, dy, 1.4, 0);
      }
    }
    return all;
  }

  /** Ils se calment (séparés, ou fatigués) : chacun repart de son côté. */
  private calm(outcome: EventOutcome): void {
    this.outcome = outcome;
    this.fighters.forEach((i, k) => {
      if (!this.fighterHere(k)) return;
      // Chacun de son côté, à quelques mètres, avant de redevenir un passant.
      const s = this.spot(k), dx = s.x - this.x, dy = s.y - this.y, d = Math.hypot(dx, dy) || 1;
      this.peds.command(i, ORDER.seek, this.x + (dx / d) * 6, this.y + (dy / d) * 6, 1.4);
    });
    if (this.police >= 0 && this.gendarme < 0 && this.traffic?.eventCar(this.police)) {
      this.traffic.letGo(this.police);
      this.police = -1;
    }
    this.go("calm");
  }

  markers(out: EventMarker[]): void {
    if (this.done || this.phase === "gather") return;
    out.push({ kind: "scene", x: this.x, y: this.y });
  }

  items(_out: GroundItem[]): void {}

  action(player: EventPlayer): EventAction | null {
    if (this.done || this.separated || this.angry >= 0 || (this.phase !== "dispute" && this.phase !== "fight" && this.phase !== "police") || this.gendarme >= 0) return null;
    if (!player.onFoot) return null;
    const close = this.fighters.some((i, k) => {
      if (!this.fighterHere(k)) return false;
      this.peds.position(i, tmp);
      return Math.hypot(tmp.x - player.x, tmp.y - player.y) < RIXE.separateReach;
    });
    if (!close) return null;
    return {
      label: "Séparer les bagarreurs", verb: "Séparer", icon: "separate",
      run: () => {
        this.separated = true;
        this.goodDeed = true;
        this.fx.earn(RIXE.reward, "Bagarre séparée");
        this.fx.feat(`Bagarre séparée · +${RIXE.reward} €`);
        const [a, b] = this.fighters;
        if (a !== undefined && this.fighterHere(0)) this.fx.say(a, "C'est bon, c'est bon…", 2.5);
        if (b !== undefined && this.fighterHere(1)) this.fx.say(b, "Il m'a cherché !", 2.5);
        this.calm("separe");
      },
    };
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    this.done = true;
    this.fighters.forEach((i, k) => {
      if (this.fighterHere(k)) this.peds.release(i);
    });
    for (const i of this.onlookers) if (this.here(i)) this.peds.release(i);
    if (this.here(this.gendarme)) this.peds.vanish(this.gendarme);
    if (this.police >= 0 && this.traffic?.eventCar(this.police)) {
      this.traffic.hold(this.police, 0);
      this.traffic.letGo(this.police);
    }
  }

  abort(): void {
    this.finish(this.outcome ?? "abandonne");
  }
}
