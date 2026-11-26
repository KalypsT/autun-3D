import { pompierRecipe } from "../character";
import { LIFE_POSE } from "../character-rig";
import { ORDER, PED_STATE } from "../pedestrians";
import type { NavGraph } from "../nav-graph";
import type { RoadGraph } from "../road-graph";
import { roadside, walkLength, Walker } from "./walker";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventPlayer, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Malaise d'un passant (E6, lot 5 de la phase 4) : sous les yeux du joueur, un passant s'arrête, porte la main à sa poitrine et s'effondre ; un
 * passant se penche sur lui, un autre appelle les secours. Les **pompiers** partent de la caserne (avenue André Frenaud : ils naissent hors de vue,
 * du côté de la caserne), sirène deux tons, se garent, deux pompiers descendent, s'agenouillent près de lui, puis le relèvent ou l'emmènent dans le
 * fourgon. Le joueur peut l'**aider** avant eux (« Aider », un genou à terre quelques secondes) : il reprend ses esprits, « Merci », 80 € et une
 * bonne action ; les pompiers, en route, font demi-tour.
 */

export const MALAISE = {
  /** Le passant : à … – … m du joueur, à l'écran. */
  near: 20,
  far: 60,
  /** Main sur la poitrine pendant … s, puis il s'effondre. */
  chestFor: 2.5,
  /** Ceux qui s'arrêtent pour l'aider : jusqu'à … passants à moins de … m ; ils arrivent … s après la chute. */
  helpers: 2,
  helperRange: 30,
  helperAfter: 1.5,
  /** Une réplique toutes les … s. */
  line: 3.5,
  /** Les pompiers partent … – … s après la chute (l'appel) ; ils se garent à moins de … m du point visé ; soins pendant … s. */
  callAfter: [20, 35] as const,
  parkReach: 12,
  /** Arrêté plus de … s à moins de … m (à pied) du malade (bouchon, rue qu'il ne sait pas prendre) : il se gare là, les pompiers finissent à pied. */
  stuckFor: 10,
  walkFar: 100,
  stuckLong: 20,
  walkFarLong: 220,
  care: 10,
  /** Les pompiers n'arrivent pas jusqu'à lui en … s (un mur entre eux) : il se relève seul. */
  careWait: 40,
  /** Évacué dans le fourgon une fois sur … (sinon relevé sur place). */
  evacuate: 0.4,
  /** Sans circulation (pas de pompiers), ou les pompiers pas arrivés … s après l'appel : il se relève seul (au bout de … s à terre au moins). */
  vanWait: 120,
  aloneFor: 70,
  /** Le joueur l'aide : à moins de … m, à pied, pendant … s ; prime (€). */
  helpReach: 1.8,
  helpFor: 4,
  reward: 80,
  /** Relevé (s), puis il remercie et repart. */
  getup: 1.5,
  thanks: 5,
  /** Le joueur est parti : au-delà de … m pendant … s, tout s'arrête ; durée maximale (s). */
  leaveFar: 250,
  leaveFor: 20,
  maxLife: 300,
} as const;

/**
 * La caserne des pompiers d'Autun (centre de secours, avenue André Frenaud ; position donnée par l'utilisateur, repère du jeu) : le fourgon naît
 * hors de vue du côté de la caserne.
 */
export const FIRE_STATION = { x: 1602, y: 720 } as const;

/** Ce que le malaise demande au jeu en plus : le joueur un genou à terre (il porte secours). */
export interface MalaiseEffects extends EventEffects {
  kneel(on: boolean): void;
}

type Phase = "chest" | "down" | "care" | "leave" | "thanks" | "over";

const tmp = { x: 0, y: 0 };

/** Cherche le passant qui fait un malaise : à 20 – 60 m, à l'écran, qui marche seul (pas de chien) ; de préférence âgé. −1 sinon. */
export function findMalaise(peds: EventPeds, ctx: EventContext, rng: EventRng): number {
  const p = ctx.player, near: number[] = [];
  peds.queryCircle(p.x, p.y, MALAISE.far, near);
  let best = -1, bestScore = -Infinity;
  for (const i of near) {
    if (peds.isBorrowed(i) || peds.attached(i) || peds.sitting(i) || peds.modeOf(i) !== PED_STATE.walk) continue;
    peds.position(i, tmp);
    const d = Math.hypot(tmp.x - p.x, tmp.y - p.y);
    if (d < MALAISE.near || !ctx.visible(tmp.x, tmp.y)) continue;
    const score = (peds.recipe(i).age === "senior" ? 2 : 0) + rng.next();
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return best;
}

export class MalaiseEvent implements GameEvent {
  readonly kind = "malaise" as const;
  readonly big = true;
  x = 0;
  y = 0;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  phase: Phase = "chest";
  /** Le passant, ceux qui l'aident (le premier se penche sur lui, le second téléphone), les deux pompiers, le fourgon (−1 : pas encore). */
  readonly victim: number;
  readonly helpers: number[] = [];
  readonly firemen: number[] = [];
  van = -1;
  /** Le joueur est un genou à terre près de lui (depuis … s ; −1 : non). */
  helpT = -1;
  /** Le joueur l'a aidé à se relever. */
  helped = false;
  private readonly victimId: number;
  private t = 0;
  private phaseT = 0;
  private downT = 0;
  private lineT = 1;
  private lineK = 0;
  private awayT = 0;
  private readonly callAt: number;
  private target: { x: number; y: number; vx: number; vy: number } | null = null;
  private evac = false;
  private kneeling = false;
  private cared = false;
  private vanStuckT = 0;
  private parking = false;
  private careWaitT = 0;
  private walkers: Walker[] = [];
  private returning = false;
  private dt = 0;
  private thanked = false;

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic | null,
    private readonly road: RoadGraph | null,
    /** Le graphe piéton : les pompiers y contournent les murs (null : tout droit). */
    private readonly nav: NavGraph | null,
    private readonly fx: MalaiseEffects,
    victim: number,
    private readonly rng: EventRng,
  ) {
    this.victim = victim;
    this.victimId = peds.idOf(victim);
    peds.borrow(victim);
    peds.position(victim, tmp);
    this.x = tmp.x;
    this.y = tmp.y;
    const h = peds.headingOf(victim);
    peds.command(victim, ORDER.hold, tmp.x + Math.sin(h), tmp.y + Math.cos(h), 0, LIFE_POSE.chest);
    fx.cry("oof", tmp.x, tmp.y);
    this.callAt = MALAISE.callAfter[0] + rng.next() * (MALAISE.callAfter[1] - MALAISE.callAfter[0]);
  }

  private here(slot: number): boolean {
    return slot >= 0 && this.peds.modeOf(slot) >= 0 && this.peds.isBorrowed(slot);
  }

  private get victimHere(): boolean {
    return this.here(this.victim) && this.peds.idOf(this.victim) === this.victimId;
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
    this.awayT = Math.hypot(this.x - p.x, this.y - p.y) > MALAISE.leaveFar ? this.awayT + dt : 0;
    if (this.awayT > MALAISE.leaveFor || this.t > MALAISE.maxLife) return this.finish(this.outcome ?? "termine");
    // Bousculé, frappé, renversé : il n'est plus à soigner (le joueur s'en est pris à lui) ; on laisse la foule s'en occuper.
    if (!this.victimHere) return this.finish(this.phase === "leave" ? "evacue" : "termine");
    if (this.peds.modeOf(this.victim) >= PED_STATE.stumble) return this.finish(this.peds.modeOf(this.victim) === PED_STATE.dead ? "perdu" : "termine");
    this.helpStep(ctx);
    this.vanStep();
    switch (this.phase) {
      case "chest":
        if (this.phaseT > MALAISE.chestFor) this.collapse();
        return;
      case "down":
        return this.downStep(dt, ctx);
      case "care":
        return this.careStep();
      case "thanks":
        return this.thanksStep(p);
      case "leave":
        return this.leaveStep();
    }
  }

  /** Il s'effondre : à genoux, puis à plat ventre ; les passants proches s'arrêtent. */
  private collapse(): void {
    this.phase = "down";
    this.phaseT = 0;
    this.peds.command(this.victim, ORDER.hold, this.x, this.y, 0, LIFE_POSE.collapse);
    this.fx.cry("hurt", this.x, this.y);
    const near: number[] = [];
    this.peds.queryCircle(this.x, this.y, MALAISE.helperRange, near);
    near.sort((a, b) => this.dist(a) - this.dist(b));
    for (const i of near) {
      if (this.helpers.length >= MALAISE.helpers) break;
      if (i === this.victim || this.peds.isBorrowed(i) || this.peds.attached(i) || this.peds.sitting(i) || this.peds.modeOf(i) !== PED_STATE.walk) continue;
      if (this.peds.recipe(i).outfit === "work" && this.rng.next() < 0.5) continue;
      if (this.peds.borrow(i)) this.helpers.push(i);
    }
  }

  private dist(slot: number): number {
    this.peds.position(slot, tmp);
    return Math.hypot(tmp.x - this.x, tmp.y - this.y);
  }

  /** À terre : le premier passant se penche sur lui (un genou à terre), le second appelle les secours ; puis on attend les pompiers. */
  private downStep(dt: number, ctx: EventContext): void {
    this.downT += dt;
    if (this.phaseT > MALAISE.helperAfter) {
      this.helpers.forEach((h, k) => {
        if (!this.here(h)) return;
        // Le premier à côté de lui, le second à 3 m (il téléphone).
        const a = k * 2.1 + 0.6, r = k === 0 ? 0.95 : 3;
        const gx = this.x + Math.sin(a) * r, gy = this.y + Math.cos(a) * r;
        this.peds.position(h, tmp);
        const arrived = Math.hypot(tmp.x - gx, tmp.y - gy) < 0.5;
        if (!arrived) this.peds.command(h, ORDER.seek, gx, gy, k === 0 ? 2.6 : 1.6);
        else this.peds.command(h, ORDER.hold, this.x, this.y, 0, k === 0 ? LIFE_POSE.kneel : LIFE_POSE.phone);
      });
      this.talk(dt);
    }
    // L'appel : les pompiers partent de la caserne ; sans circulation, il se relève seul au bout d'un moment.
    if (this.van < 0 && this.downT > this.callAt && this.traffic && !this.helped) this.callFiremen(ctx);
    // Sans circulation, ou les pompiers bloqués loin (bouchon) : il se relève seul au bout d'un moment ; le fourgon repart.
    if ((!this.traffic || this.downT > this.callAt + MALAISE.vanWait) && this.downT > MALAISE.aloneFor) {
      if (this.van >= 0 && this.traffic?.eventCar(this.van)) this.traffic.letGo(this.van);
      this.van = -1;
      this.standUp("termine");
    }
  }

  /** Les répliques de ceux qui l'aident. */
  private talk(dt: number): void {
    this.lineT -= dt;
    if (this.lineT > 0) return;
    this.lineT = MALAISE.line;
    const sir = this.peds.recipe(this.victim).sex === "f" ? "Madame" : "Monsieur";
    const [kneeler, caller] = this.helpers;
    const lines: [number | undefined, string][] = [
      [kneeler, `${sir}, ça va ?`], [caller, "Appelez les secours !"], [caller, "Allô, les pompiers ?"], [kneeler, `${sir}, vous m'entendez ?`],
      [caller, "Ils arrivent !"], [kneeler, "Restez avec nous…"],
    ];
    const [who, text] = lines[this.lineK % lines.length]!;
    this.lineK++;
    if (who !== undefined && this.here(who) && (this.helpT < 0 || who !== kneeler)) this.fx.say(who, text, 2.6);
  }

  /** Le fourgon des pompiers naît hors de vue, du côté de la caserne, et file vers le bord de la route le plus proche du malade. */
  private callFiremen(ctx: EventContext): void {
    const t = this.traffic!;
    // La chaussée la plus proche du malade où une voiture peut aller, et d'où l'on va jusqu'à lui à pied en ligne droite.
    this.target ??= roadside(this.road, this.x, this.y, ctx.lineClear);
    const sx = FIRE_STATION.x - this.x, sy = FIRE_STATION.y - this.y, sd = Math.hypot(sx, sy) || 1;
    const around = sd > 120 ? { x: this.x + (sx / sd) * 90, y: this.y + (sy / sd) * 90 } : { x: this.x, y: this.y };
    const c = t.spawnEvent(false, around, "pompiers") ?? t.spawnEvent(false, { x: this.x, y: this.y }, "pompiers");
    if (!c) {
      // Pas de place : on réessaie dans 5 s.
      this.downT = this.callAt - 5;
      return;
    }
    this.van = c.id;
    // Itinéraire jusqu'au bord de la route (conduite d'urgence : feux grillés, contresens permis), sirène ; sinon la conduite de poursuite vers le point.
    if (t.planTo(c.id, this.target.x, this.target.y)) t.setSiren(c.id, true);
    else t.pursue(c.id, this.target);
  }

  /** Le fourgon : arrivé, il se gare (gyrophares sans la sirène), deux pompiers descendent. */
  private vanStep(): void {
    if (this.van < 0 || !this.traffic || this.firemen.length || this.phase === "thanks" || this.phase === "leave") return;
    const c = this.traffic.eventCar(this.van);
    if (!c) {
      this.van = -1;
      return;
    }
    const tg = this.target!;
    if (!this.parking) {
      // Arrivé : il freine et se gare. Arrêté longtemps (bouchon) assez près, sans mur entre lui et le malade : il se gare là, les pompiers
      // finissent à pied.
      this.vanStuckT = Math.abs(c.state.speed) < 0.6 ? this.vanStuckT + this.dt : 0;
      const close = Math.hypot(c.state.x - tg.x, c.state.y - tg.y) < MALAISE.parkReach;
      // (Le trajet à pied compte, pas la distance : de l'autre côté d'un mur, le détour peut faire 200 m ; on ne le mesure qu'une fois par seconde.)
      let stuck = false;
      // Bloqué : à moins de 100 m à pied au bout de 10 s, ou de 220 m au bout de 20 s (les pompiers courent le reste).
      if (this.vanStuckT > MALAISE.stuckFor && Math.hypot(c.state.x - this.x, c.state.y - this.y) < MALAISE.walkFarLong && Math.floor(this.vanStuckT) !== Math.floor(this.vanStuckT - this.dt)) {
        const w = walkLength(this.nav, c.state.x, c.state.y, this.x, this.y);
        stuck = w < MALAISE.walkFar || (this.vanStuckT > MALAISE.stuckLong && w < MALAISE.walkFarLong);
      }
      if (!close && !stuck) return;
      this.parking = true;
      this.traffic.pursue(c.id, null);
      this.traffic.hold(c.id, 1e6);
      this.traffic.setSiren(c.id, true, false);
    }
    if (Math.abs(c.state.speed) > 0.6) return;
    const h = c.state.heading, rx = Math.cos(h), ry = -Math.sin(h);
    for (const side of [-1, 1]) {
      const f = this.peds.appear(c.state.x + rx * side * 1.3, c.state.y + ry * side * 1.3, c.driver + side, h, pompierRecipe(c.driver + side));
      if (f < 0) continue;
      const k = this.firemen.length, g = this.careSpot(k), w = new Walker(this.peds, f);
      w.plan(this.nav, g.x, g.y);
      this.firemen.push(f);
      this.walkers.push(w);
    }
    if (this.firemen.length) this.fx.say(this.firemen[0]!, "Pompiers ! Écartez-vous.", 2.5);
    this.phase = "care";
    this.phaseT = 0;
    this.evac = this.rng.next() < MALAISE.evacuate;
  }

  /** Où le pompier `k` s'agenouille : de part et d'autre du malade. */
  private careSpot(k: number): { x: number; y: number } {
    const a = k * Math.PI + 1.2;
    return { x: this.x + Math.sin(a) * 0.95, y: this.y + Math.cos(a) * 0.95 };
  }

  /** Les pompiers s'agenouillent près de lui ; les passants qui l'aidaient s'écartent et repartent. Puis il se relève, ou on l'emmène. */
  private careStep(): void {
    let arrived = 0;
    this.firemen.forEach((f, k) => {
      if (!this.here(f)) return;
      if (this.walkers[k]!.step(3.2, 0.5, this.dt)) {
        arrived++;
        this.peds.command(f, ORDER.hold, this.x, this.y, 0, LIFE_POSE.kneel);
      }
    });
    if (arrived === 0) {
      this.phaseT = 0;
      this.careWaitT += this.dt;
      // Ils n'arrivent pas jusqu'à lui (un mur, un grillage) : il finit par se relever seul, ils remontent.
      if (this.careWaitT > MALAISE.careWait) this.standUp("termine");
      return;
    }
    // Les passants s'écartent dès que les pompiers sont là.
    for (const h of this.helpers) if (this.here(h)) this.peds.release(h);
    this.helpers.length = 0;
    if (!this.cared && this.phaseT > 3 && this.here(this.firemen[0]!)) {
      this.cared = true;
      this.fx.say(this.firemen[0]!, "On s'occupe de vous.", 2.5);
    }
    if (this.phaseT > MALAISE.care) this.standUp(this.evac ? "evacue" : "soigne");
  }

  /** Il se relève (relevé de la chute), puis remercie, ou part avec les pompiers. */
  private standUp(outcome: EventOutcome): void {
    this.outcome = outcome;
    this.peds.command(this.victim, ORDER.hold, this.x + 1, this.y, 0, LIFE_POSE.getup);
    for (const f of this.firemen) if (this.here(f)) this.peds.command(f, ORDER.hold, this.x, this.y, 0, 0);
    this.phase = outcome === "evacue" ? "leave" : "thanks";
    this.phaseT = 0;
  }

  /** Relevé : il remercie (le joueur s'il l'a aidé, sinon les pompiers), puis repart ; les pompiers remontent. */
  private thanksStep(p: EventPlayer): void {
    if (this.phaseT < MALAISE.getup) return;
    if (!this.thanked) {
      this.thanked = true;
      this.fx.say(this.victim, this.helped ? "Merci… ça va mieux." : "Merci, ça va aller.", 3);
      const to = this.helped ? p : this.firemen.length && this.here(this.firemen[0]!) ? this.pos(this.firemen[0]!) : { x: this.x + 1, y: this.y };
      this.peds.command(this.victim, ORDER.hold, to.x, to.y, 0, LIFE_POSE.talk);
    }
    if (this.phaseT < MALAISE.getup + MALAISE.thanks) return;
    if (this.firemen.length && !this.backToVan(false) && this.phaseT < 60) return;
    this.finish(this.outcome ?? "termine");
  }

  /** Évacué : il se relève, et tous trois montent dans le fourgon (ils y disparaissent), qui repart. */
  private leaveStep(): void {
    if (this.phaseT < MALAISE.getup) return;
    if (this.backToVan(true) || this.phaseT > 40) this.finish("evacue");
  }

  /** Pompiers (et le malade s'il part avec eux) vers l'arrière du fourgon ; vrai quand tous y sont montés. */
  private backToVan(withVictim: boolean): boolean {
    const c = this.van >= 0 && this.traffic ? this.traffic.eventCar(this.van) : null;
    if (!c) return true;
    const h = c.state.heading, bx = c.state.x - Math.sin(h) * 3.1, by = c.state.y - Math.cos(h) * 3.1;
    if (!this.returning) {
      this.returning = true;
      this.walkers = [...this.firemen, this.victim].map((s) => {
        const w = new Walker(this.peds, s);
        w.plan(this.nav, bx, by);
        return w;
      });
    }
    let all = true;
    for (const w of this.walkers) {
      const s = w.slot;
      if (!this.here(s) || (s === this.victim && !withVictim)) continue;
      // Arrivé à l'arrière du fourgon, il monte ; coincé derrière un muret plus de 6 s, il en fait le tour sans qu'on le voie (il disparaît).
      if (w.step(s === this.victim ? 1.0 : 1.4, 0.8, this.dt) || w.stuckT > 6) this.peds.vanish(s);
      else all = false;
    }
    return all;
  }

  private pos(slot: number): { x: number; y: number } {
    const o = { x: 0, y: 0 };
    this.peds.position(slot, o);
    return o;
  }

  /** Le joueur un genou à terre près de lui : au bout de 4 s, il reprend ses esprits. Il s'éloigne ou se relève : l'aide s'arrête. */
  private helpStep(ctx: EventContext): void {
    if (this.helpT < 0) return;
    const p = ctx.player;
    if (!p.onFoot || p.speed > 1 || Math.hypot(p.x - this.x, p.y - this.y) > MALAISE.helpReach + 0.6) {
      this.helpT = -1;
      this.setKneel(false);
      return;
    }
    this.helpT += ctx.dt;
    if (this.helpT < MALAISE.helpFor) return;
    this.helpT = -1;
    this.setKneel(false);
    this.helped = true;
    this.goodDeed = true;
    this.fx.earn(MALAISE.reward, "Malaise secouru");
    this.fx.feat(`Malaise secouru · +${MALAISE.reward} €`);
    // Les pompiers en route font demi-tour ; ceux qui l'aidaient repartent.
    if (this.van >= 0 && this.traffic && !this.firemen.length) {
      this.traffic.letGo(this.van);
      this.van = -1;
    }
    for (const h of this.helpers) if (this.here(h)) this.peds.release(h);
    this.helpers.length = 0;
    this.standUp("secouru");
  }

  private setKneel(on: boolean): void {
    if (on === this.kneeling) return;
    this.kneeling = on;
    this.fx.kneel(on);
  }

  markers(out: EventMarker[]): void {
    if (this.done || this.phase === "chest") return;
    out.push({ kind: "scene", x: this.x, y: this.y });
  }

  items(_out: GroundItem[]): void {}

  action(player: EventPlayer): EventAction | null {
    if (this.done || this.helped || this.helpT >= 0 || (this.phase !== "down" && this.phase !== "care") || this.firemen.length) return null;
    if (!player.onFoot || Math.hypot(player.x - this.x, player.y - this.y) > MALAISE.helpReach) return null;
    return {
      label: "Aider la personne à terre", verb: "Aider", icon: "help",
      run: () => {
        this.helpT = 0;
        this.setKneel(true);
        const [kneeler] = this.helpers;
        if (kneeler !== undefined && this.here(kneeler)) this.fx.say(kneeler, "Vous savez faire ?", 2);
      },
    };
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    this.done = true;
    this.setKneel(false);
    if (this.victimHere) this.peds.release(this.victim);
    for (const h of this.helpers) if (this.here(h)) this.peds.release(h);
    for (const f of this.firemen) if (this.here(f)) this.peds.vanish(f);
    if (this.van >= 0 && this.traffic?.eventCar(this.van)) {
      this.traffic.hold(this.van, 0);
      this.traffic.letGo(this.van);
    }
  }

  abort(): void {
    this.finish(this.outcome ?? "abandonne");
  }
}
