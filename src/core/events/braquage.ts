import { gendarmeRecipe, robberRecipe } from "../character";
import { GUN_POSE, LIFE_POSE } from "../character-rig";
import type { NavGraph } from "../nav-graph";
import { shotHitChance } from "../officers";
import { ORDER, PED_STATE } from "../pedestrians";
import type { RoadGraph } from "../road-graph";
import { Fugitive } from "./fugitive";
import { roadside, Walker } from "./walker";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventPlayer, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Braquage d'un commerce (E13, lot 9 de la phase 4 ; accord de l'utilisateur, Q3 du plan) : le soir, un commerce ouvert à 30 – 100 m ; un homme
 * **cagoulé** (bonnet et capuche noirs) en sort en courant, **pistolet à la main** ; l'alarme sonne, le commerçant sort derrière lui (« Au voleur !
 * Il a une arme ! »), les passants s'écartent. Le braqueur fuit le joueur sur le graphe piéton (le fuyard de D329, un peu plus rapide).
 * **Il tire sur le joueur** (c'est le seul événement où un PNJ le fait) s'il le menace d'une arme à moins de 25 m, ou s'il le rattrape **de face** à
 * moins de 7 m : il s'arrête, vise, tire (comme un gendarme armé, D85 : 12 points de vie, la chance de toucher selon la distance et la vitesse),
 * trois coups au plus, puis repart. **Plaqué ou frappé**, il lâche son arme (elle se ramasse) et lève les mains ; une patrouille vient l'arrêter :
 * **prime de 800 €**, un voleur rattrapé au carnet. Le tuer reste un meurtre ; il peut aussi s'échapper.
 */

export const BRAQUAGE = {
  /** Le commerce : ouvert, à … – … m du joueur. */
  near: 30,
  far: 100,
  /** Course (m/s) et essoufflement (un peu plus vite que le voleur à l'arraché). */
  run: 6,
  tired: 4.8,
  /** Il fait face et tire : menacé d'une arme à moins de … m, ou rattrapé de face à moins de … m. */
  threatReach: 25,
  frontReach: 7,
  /** Un tir toutes les … s, … au plus par face-à-face ; … points de vie ; il repart si le joueur est à plus de … m ; pas de nouveau face-à-face avant … s. */
  fireEvery: 1.2,
  shots: 3,
  damage: 12,
  breakOff: 15,
  aimCool: 6,
  /** Alarme (s) ; le commerçant crie … s avant de rentrer ; les passants à moins de … m s'écartent. */
  alarm: 25,
  keeperFor: 10,
  scatter: 15,
  /** Arrêté : mains en l'air ; sans patrouille, emmené au bout de … s. */
  aloneFor: 12,
  officerRun: 4.2,
  reward: 800,
  leaveFar: 250,
  leaveFor: 20,
  maxLife: 300,
} as const;

/** Ce que le braquage demande au jeu : un tir sur le joueur (rendu, son, points de vie), l'arme lâchée au sol, l'alarme du commerce. */
export interface BraquageEffects extends EventEffects {
  shoot(x0: number, y0: number, x1: number, y1: number, hit: boolean, damage: number): void;
  dropGun(x: number, y: number): void;
  alarm(x: number, y: number, seconds: number): void;
}

/** Un commerce ouvert : position du commerce, et le point du trottoir devant lui (la porte). */
export interface ShopSite {
  x: number;
  y: number;
  doorX: number;
  doorY: number;
}

/** Un commerce ouvert à 30 – 100 m du joueur, de préférence à l'écran, avec un trottoir devant ; null sinon. */
export function findShop(shops: readonly { x: number; y: number }[], nav: NavGraph, ctx: EventContext, rng: EventRng): ShopSite | null {
  const p = ctx.player, ok = shops.filter((s) => {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    return d > BRAQUAGE.near && d < BRAQUAGE.far;
  });
  const seen = ok.filter((s) => ctx.visible(s.x, s.y));
  const list = seen.length ? seen : ok;
  for (let k = 0; k < 4 && list.length; k++) {
    const s = list[Math.floor(rng.next() * list.length)]!, door = nav.nearest(s.x, s.y, 25);
    if (door) return { x: s.x, y: s.y, doorX: door.x, doorY: door.y };
  }
  return null;
}

type Phase = "flee" | "aim" | "hands" | "arrest" | "over";

const tmp = { x: 0, y: 0 };

export class BraquageEvent implements GameEvent {
  readonly kind = "braquage" as const;
  readonly big = true;
  x: number;
  y: number;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  /** Le joueur l'a arrêté (plaqué, frappé, renversé) : prime, voleur rattrapé. */
  caught = false;
  phase: Phase = "flee";
  readonly robber: number;
  keeper = -1;
  gendarme = -1;
  police = -1;
  /** Tirs sur le joueur depuis le début (essais). */
  fired = 0;
  readonly ok: boolean;
  private readonly id: number;
  private readonly fugitive: Fugitive | null;
  private t = 0;
  private phaseT = 0;
  private fireT = 0;
  private shotsHere = 0;
  private aimCool = 0;
  private awayT = 0;
  private armed = true;
  private walker: Walker | null = null;
  private target: { x: number; y: number; vx: number; vy: number } | null = null;
  private cuffT = -1;

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic | null,
    private readonly road: RoadGraph | null,
    private readonly nav: NavGraph | null,
    private readonly fx: BraquageEffects,
    private readonly shop: ShopSite,
    rng: EventRng,
  ) {
    this.x = shop.doorX;
    this.y = shop.doorY;
    const seed = Math.floor(rng.next() * 1e9);
    const away = Math.atan2(shop.doorX - shop.x, shop.doorY - shop.y);
    this.robber = peds.appear(shop.doorX, shop.doorY, seed, away, robberRecipe(seed));
    this.ok = this.robber >= 0;
    this.id = this.ok ? peds.idOf(this.robber) : -1;
    this.fugitive = this.ok ? new Fugitive(peds, this.robber, this.id, BRAQUAGE.run, BRAQUAGE.tired) : null;
    if (!this.ok) {
      this.done = true;
      this.outcome = "abandonne";
      return;
    }
    peds.setHeld(this.robber, true);
    fx.alarm(shop.x, shop.y, BRAQUAGE.alarm);
    fx.cry("scream", shop.doorX, shop.doorY);
    peds.alarm(shop.doorX, shop.doorY, BRAQUAGE.scatter, 0.8, this.robber);
    // Le commerçant sort derrière lui, montre le braqueur et crie.
    this.keeper = peds.appear(shop.doorX - Math.sin(away) * 0.6, shop.doorY - Math.cos(away) * 0.6, seed ^ 0x77, away);
    if (this.keeper >= 0) fx.say(this.keeper, "Au voleur ! Il a une arme !", 3);
  }

  private here(slot: number): boolean {
    return slot >= 0 && this.peds.modeOf(slot) >= 0 && this.peds.isBorrowed(slot);
  }

  private get robberHere(): boolean {
    return this.here(this.robber) && this.peds.idOf(this.robber) === this.id;
  }

  /** En fuite (ou à viser le joueur), on peut l'arrêter sans infraction (Q5 du plan) ; le tuer reste un meurtre. */
  lawfulTarget(slot: number): boolean {
    return slot === this.robber && (this.phase === "flee" || this.phase === "aim");
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    const dt = ctx.dt, p = ctx.player;
    this.t += dt;
    this.phaseT += dt;
    this.aimCool -= dt;
    this.keeperStep();
    this.awayT = Math.hypot(this.x - p.x, this.y - p.y) > BRAQUAGE.leaveFar ? this.awayT + dt : 0;
    if (this.awayT > BRAQUAGE.leaveFor || this.t > BRAQUAGE.maxLife) return this.finish(this.caught ? "rattrape" : "enfui");
    if (!this.robberHere) return this.finish(this.caught ? "rattrape" : "enfui");
    this.peds.position(this.robber, tmp);
    this.x = tmp.x;
    this.y = tmp.y;
    const mode = this.peds.modeOf(this.robber);
    if (mode === PED_STATE.dead) {
      this.drop();
      return this.finish("perdu");
    }
    switch (this.phase) {
      case "flee":
      case "aim": {
        // À terre (plaqué, frappé, renversé) par le joueur tout près : arrêté.
        if (mode >= PED_STATE.stumble && Math.hypot(p.x - tmp.x, p.y - tmp.y) < 4) return this.caughtNow();
        if (this.phase === "aim") return this.aimStep(dt, p);
        const state = this.fugitive!.update(ctx, this.shop.x, this.shop.y);
        if (state === "tackled") return this.caughtNow();
        if (state === "escaped") return this.finish("enfui");
        if (state === "running" && this.threatened(p)) this.startAim(p);
        return;
      }
      case "hands":
        return this.handsStep(ctx);
      case "arrest":
        return this.arrestStep(dt);
    }
  }

  /** Le joueur le menace d'une arme (à moins de 25 m), ou le rattrape de face (à moins de 7 m). */
  private threatened(p: EventPlayer): boolean {
    if (!p.onFoot || this.aimCool > 0 || !this.armed) return false;
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy);
    if (p.aiming && d < BRAQUAGE.threatReach) return true;
    if (d > BRAQUAGE.frontReach) return false;
    // De face : le joueur devant lui (le braqueur court vers lui, ou se retourne : à moins de 60° de son cap).
    const h = this.peds.headingOf(this.robber);
    return (Math.sin(h) * dx + Math.cos(h) * dy) / (d || 1) > 0.5;
  }

  private startAim(p: EventPlayer): void {
    this.phase = "aim";
    this.phaseT = 0;
    this.shotsHere = 0;
    this.fireT = 0.5;
    this.fx.say(this.robber, p.aiming ? "Lâche ça !" : "Recule !", 2);
  }

  /** Il s'arrête, vise le joueur et tire ; trois coups au plus, ou le joueur s'éloigne : il repart. */
  private aimStep(dt: number, p: EventPlayer): void {
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    this.peds.command(this.robber, ORDER.hold, p.x, p.y, 0, GUN_POSE.aim);
    this.fireT -= dt;
    if (this.fireT <= 0 && this.shotsHere < BRAQUAGE.shots) {
      this.fireT = BRAQUAGE.fireEvery;
      this.shotsHere++;
      this.fired++;
      const hit = Math.random() < shotHitChance(d, p.speed, false);
      let tx = p.x, ty = p.y;
      if (!hit) {
        const ux = (p.x - this.x) / (d || 1), uy = (p.y - this.y) / (d || 1), side = Math.random() < 0.5 ? -1 : 1;
        tx += -uy * side * 1.4 + ux * 3;
        ty += ux * side * 1.4 + uy * 3;
      }
      const h = Math.atan2(p.x - this.x, p.y - this.y);
      this.fx.shoot(this.x + Math.sin(h) * 0.55, this.y + Math.cos(h) * 0.55, tx, ty, hit, BRAQUAGE.damage);
      this.peds.alarm(this.x, this.y, 30, 1, this.robber);
    }
    if ((this.shotsHere >= BRAQUAGE.shots && this.fireT < 0.4) || d > BRAQUAGE.breakOff) {
      this.aimCool = BRAQUAGE.aimCool;
      this.phase = "flee";
      this.phaseT = 0;
      // Il reprend sa fuite (l'ordre « fuir » est redonné au pas suivant).
    }
  }

  /** Plaqué, frappé : il lâche son arme, lève les mains ; la patrouille vient. */
  private caughtNow(): void {
    this.caught = true;
    this.goodDeed = true;
    this.drop();
    this.phase = "hands";
    this.phaseT = 0;
    this.fx.feat(`Braqueur arrêté · +${BRAQUAGE.reward} €`);
  }

  private drop(): void {
    if (!this.armed) return;
    this.armed = false;
    this.peds.setHeld(this.robber, false);
    this.fx.dropGun(this.x + 0.6, this.y);
  }

  /** Mains en l'air ; la patrouille arrive, se gare, un gendarme vient le chercher. Sans circulation, il est emmené au bout d'un moment. */
  private handsStep(ctx: EventContext): void {
    if (this.peds.modeOf(this.robber) >= PED_STATE.stumble) return;
    if (this.phaseT < 0.5) this.fx.say(this.robber, "C'est bon, c'est bon !", 3);
    this.peds.command(this.robber, ORDER.hold, ctx.player.x, ctx.player.y, 0, LIFE_POSE.hands);
    const t = this.traffic;
    if (!t) {
      if (this.phaseT > BRAQUAGE.aloneFor) {
        this.peds.vanish(this.robber);
        this.finish("rattrape");
      }
      return;
    }
    if (this.police < 0) {
      this.target ??= roadside(this.road, this.x, this.y, ctx.lineClear);
      const c = t.spawnEvent(true, { x: this.x, y: this.y });
      if (!c) return;
      this.police = c.id;
      if (t.planTo(c.id, this.target.x, this.target.y)) t.setSiren(c.id, true);
      else t.pursue(c.id, this.target);
      return;
    }
    const c = t.eventCar(this.police);
    if (!c) return this.finish("rattrape");
    const close = Math.hypot(c.state.x - this.target!.x, c.state.y - this.target!.y) < 14;
    if (!close && this.phaseT < 60) return;
    t.pursue(c.id, null);
    t.hold(c.id, 1e6);
    if (Math.abs(c.state.speed) > 0.6) return;
    t.setSiren(c.id, true, false);
    const h = c.state.heading;
    this.gendarme = this.peds.appear(c.state.x - Math.cos(h) * 1.4, c.state.y + Math.sin(h) * 1.4, c.driver, h, gendarmeRecipe(c.driver));
    if (this.gendarme < 0) return this.finish("rattrape");
    this.fx.say(this.gendarme, "Gendarmerie ! Pas un geste !", 2.5);
    this.walker = new Walker(this.peds, this.gendarme);
    this.walker.plan(this.nav, this.x, this.y);
    this.phase = "arrest";
    this.phaseT = 0;
  }

  /** Le gendarme le rejoint, l'arrête, et tous deux montent dans la voiture. */
  private arrestStep(dt: number): void {
    const c = this.traffic && this.police >= 0 ? this.traffic.eventCar(this.police) : null;
    if (!c || !this.here(this.gendarme)) return this.finish("rattrape");
    if (this.cuffT < 0) {
      this.peds.command(this.robber, ORDER.hold, this.x + 1, this.y, 0, LIFE_POSE.hands);
      if (this.walker!.step(BRAQUAGE.officerRun, 1.3, dt) || this.walker!.stuckT > 6 || this.phaseT > 40) {
        this.cuffT = 0;
        this.fx.say(this.gendarme, "Vous êtes en état d'arrestation.", 2.5);
        const h = c.state.heading, dx = c.state.x + Math.cos(h) * 1.4, dy = c.state.y - Math.sin(h) * 1.4;
        this.walker!.plan(this.nav, dx, dy);
        this.robberWalker = new Walker(this.peds, this.robber);
        this.robberWalker.plan(this.nav, dx, dy);
      }
      return;
    }
    this.cuffT += dt;
    if (this.cuffT < 3) return;
    let all = true;
    for (const w of [this.walker!, this.robberWalker!]) {
      if (!this.here(w.slot)) continue;
      if (w.step(1.4, 0.8, dt) || w.stuckT > 6 || this.cuffT > 45) this.peds.vanish(w.slot);
      else all = false;
    }
    if (all) this.finish("rattrape");
  }

  private robberWalker: Walker | null = null;
  private keeperT = 0;

  /** Le commerçant crie et montre le braqueur, puis rentre. */
  private keeperStep(): void {
    if (!this.here(this.keeper)) return;
    this.keeperT += 1 / 60;
    if (this.keeperT > BRAQUAGE.keeperFor) {
      this.peds.vanish(this.keeper);
      this.keeper = -1;
      return;
    }
    if (this.robberHere) {
      this.peds.position(this.robber, tmp);
      this.peds.command(this.keeper, ORDER.hold, tmp.x, tmp.y, 0, LIFE_POSE.point);
    }
  }

  markers(out: EventMarker[]): void {
    if (this.done) return;
    out.push({ kind: this.phase === "flee" || this.phase === "aim" ? "fugitive" : "scene", x: this.x, y: this.y });
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
    if (outcome === "rattrape") this.fx.earn(BRAQUAGE.reward, "Prime de la gendarmerie");
    if (this.robberHere) {
      this.peds.setHeld(this.robber, false);
      // Échappé : il redevient un passant (sans son arme) ; arrêté, il part avec les gendarmes.
      if (outcome === "rattrape") this.peds.vanish(this.robber);
      else this.peds.release(this.robber);
    }
    if (this.here(this.keeper)) this.peds.vanish(this.keeper);
    if (this.here(this.gendarme)) this.peds.vanish(this.gendarme);
    if (this.traffic && this.police >= 0 && this.traffic.eventCar(this.police)) {
      this.traffic.hold(this.police, 0);
      this.traffic.letGo(this.police);
    }
  }

  abort(): void {
    this.finish(this.outcome ?? (this.caught ? "rattrape" : "abandonne"));
  }
}
