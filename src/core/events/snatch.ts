import { CLOTH_COLORS } from "../character";
import { LIFE_POSE } from "../character-rig";
import { ORDER, PED_STATE } from "../pedestrians";
import { Fugitive, FUGITIVE } from "./fugitive";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventPlayer, type GameEvent, type GroundItem } from "./types";

/**
 * Vol à l'arraché (E1, lot 1 de la phase 4, `docs/plans/evenements.md`) : un passant (le voleur) rattrape un autre (la victime) qui porte un sac,
 * le lui arrache et s'enfuit en courant ; la victime tombe ou trébuche, crie « Au voleur ! » et montre le voleur du bras. Le joueur peut le rattraper
 * (le plaquer en sprint, le frapper, le renverser) : le sac tombe ; il le ramasse en marchant dessus, puis le **rend** à la victime (prime) ou le
 * **fouille** (son contenu ; une étoile si un passant le voit). Sans le joueur, le voleur s'échappe et la victime finit par repartir.
 *
 * Analogie : une petite pièce de théâtre à trois rôles, jouée par des figurants pris dans la foule (réquisitionnés) et rendus à la fin.
 */

export const SNATCH = {
  /** Victime : à cette distance du joueur (m) ; voleur : à cette distance de la victime, et au moins `thiefFromPlayer` du joueur. */
  victimNear: 15,
  victimFar: 45,
  thiefNear: 12,
  thiefFar: 40,
  thiefFromPlayer: 15,
  /** Pas de vol si la police est à moins de … m. */
  policeClear: 60,
  /** Le voleur rejoint la victime en marchant vite (son allure à elle plus `gain`, au plus `walk`), puis court les … derniers mètres. */
  walk: 2.8,
  gain: 1.3,
  dash: 3.4,
  dashFrom: 7,
  /** Il arrache le sac à moins de … m ; au-delà de … s sans y arriver, on renonce (rien ne s'est vu). */
  reach: 1.0,
  approachTimeout: 25,
  /** Fuite, plaquage, échappée : ceux du fuyard commun (`FUGITIVE`, 5,8 m/s puis 4,5 après 15 s). */
  /** La victime attend le sac … s ; le sac reste … s au sol. */
  victimWaits: 120,
  bagLife: 120,
  /** Rendre : à pied, à moins de … m de la victime ; ramasser : à moins de … m du sac. */
  returnReach: 2.6,
  pickReach: 1.3,
  /** Prime pour le sac rendu, contenu du sac gardé (€). */
  reward: [100, 250] as const,
  content: [30, 120] as const,
  /** Un passant à moins de … m voit qu'on garde le sac. */
  witness: 25,
  /** Le joueur s'éloigne : au-delà de … m pendant … s, l'événement s'arrête. */
  leaveFar: 250,
  leaveFor: 20,
} as const;

/** Sacs qu'on arrache (pas un sac à dos). */
const SNATCHABLE = new Set(["handbag", "shoulder"]);

export interface SnatchSite {
  victim: number;
  thief: number;
}

const tmp = { x: 0, y: 0 };
const tmp2 = { x: 0, y: 0 };

/**
 * Cherche une victime et un voleur autour du joueur : la victime marche, porte un sac à main ou en bandoulière, à 20 – 60 m du joueur (de préférence
 * à l'écran) ; le voleur marche seul, à 12 – 40 m d'elle, à plus de 15 m du joueur (de préférence hors de l'écran) ; pas de police à 60 m.
 */
export function findSnatchSite(peds: EventPeds, ctx: EventContext, rng: EventRng): SnatchSite | null {
  const p = ctx.player;
  if (!p.onFoot && p.speed > 5.5) return null;
  const near: number[] = [];
  peds.queryCircle(p.x, p.y, SNATCH.victimFar, near);
  const victims: { slot: number; score: number }[] = [];
  for (const i of near) {
    if (peds.modeOf(i) !== PED_STATE.walk || peds.isBorrowed(i) || peds.attached(i) || peds.speedOf(i) > 2.2) continue;
    const r = peds.recipe(i);
    if (!SNATCHABLE.has(r.bag)) continue;
    peds.position(i, tmp);
    const d = Math.hypot(tmp.x - p.x, tmp.y - p.y);
    if (d < SNATCH.victimNear) continue;
    if (ctx.policeNear(tmp.x, tmp.y, SNATCH.policeClear)) continue;
    // À l'écran d'abord, et les plus proches : à 40 m un passant ne fait que quelques pixels sur un téléphone.
    victims.push({ slot: i, score: (ctx.visible(tmp.x, tmp.y) ? 2 : 1) + (1 - d / SNATCH.victimFar) + rng.next() * 0.6 });
  }
  victims.sort((a, b) => b.score - a.score);
  for (const v of victims.slice(0, 4)) {
    peds.position(v.slot, tmp);
    const around: number[] = [];
    peds.queryCircle(tmp.x, tmp.y, SNATCH.thiefFar, around);
    let best = -1, bestScore = -Infinity;
    for (const j of around) {
      if (j === v.slot || peds.modeOf(j) !== PED_STATE.walk || peds.isBorrowed(j) || peds.attached(j)) continue;
      const r = peds.recipe(j);
      if (r.age === "senior" || r.outfit === "work") continue;
      peds.position(j, tmp2);
      const dv = Math.hypot(tmp2.x - tmp.x, tmp2.y - tmp.y), dp = Math.hypot(tmp2.x - p.x, tmp2.y - p.y);
      if (dv < SNATCH.thiefNear || dp < SNATCH.thiefFromPlayer) continue;
      // Il la rejoint en ligne droite : rien entre eux.
      if (ctx.lineClear && !ctx.lineClear(tmp2.x, tmp2.y, tmp.x, tmp.y)) continue;
      const score = (ctx.visible(tmp2.x, tmp2.y) ? 0 : 2) - dv / 40 + rng.next() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    }
    if (best >= 0) return { victim: v.slot, thief: best };
  }
  return null;
}

type Phase = "approach" | "flee" | "after" | "bag" | "carried" | "over";

export class SnatchEvent implements GameEvent {
  readonly kind = "vol" as const;
  readonly big = false;
  x = 0;
  y = 0;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  /** Le voleur a été mis à terre (pour le carnet : voleurs rattrapés). */
  caught = false;
  phase: Phase = "approach";
  private t = 0;
  /** Temps depuis l'arrachage, depuis la mise à terre du voleur, du sac au sol. */
  private since = 0;
  private bagT = 0;
  private awayT = 0;
  private thiefFree = -1;
  private readonly victimId: number;
  private readonly thiefId: number;
  private readonly bag: { kind: string; color: number };
  readonly bagAt = { x: 0, y: 0 };
  private readonly fugitive: Fugitive;
  readonly reward: number;
  readonly content: number;
  private victimHome = { x: 0, y: 0 };
  private victimUp = false;
  /** La victime est repartie (rendue à la foule) : on ne peut plus lui rendre son sac. */
  private victimGone = false;
  /** Temps depuis que le voleur est à terre, et temps restant de la scène après sa fuite. */
  private caughtT = 0;
  private afterT = 0;

  constructor(
    private readonly peds: EventPeds,
    private readonly fx: EventEffects,
    readonly victim: number,
    readonly thief: number,
    rng: EventRng,
  ) {
    peds.borrow(victim);
    peds.borrow(thief);
    this.victimId = peds.idOf(victim);
    this.thiefId = peds.idOf(thief);
    this.fugitive = new Fugitive(peds, thief, this.thiefId);
    const r = peds.recipe(victim);
    this.bag = { kind: r.bag, color: r.bagColor };
    this.reward = rng.between(SNATCH.reward[0], SNATCH.reward[1], 10);
    this.content = rng.between(SNATCH.content[0], SNATCH.content[1], 5);
    peds.position(victim, this.victimHome);
    this.x = this.victimHome.x;
    this.y = this.victimHome.y;
  }

  /** Le passant de cet emplacement est-il encore le même (vivant, même identifiant) ? */
  private present(slot: number, id: number): boolean {
    return this.peds.modeOf(slot) >= 0 && this.peds.idOf(slot) === id;
  }

  private get victimHere(): boolean {
    return !this.victimGone && this.present(this.victim, this.victimId) && this.peds.modeOf(this.victim) !== PED_STATE.dead;
  }

  private get thiefHere(): boolean {
    return this.present(this.thief, this.thiefId);
  }

  lawfulTarget(slot: number): boolean {
    // Pendant sa fuite, et un instant après sa chute (le coup qui l'a fait tomber, un coup de grâce reste un meurtre s'il en meurt).
    return slot === this.thief && this.thiefHere && (this.phase === "flee" || (this.caught && this.caughtT < 2));
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    const dt = ctx.dt, p = ctx.player;
    this.t += dt;
    this.since += dt;
    if (this.caught) this.caughtT += dt;
    // Le joueur est parti loin : on arrête (rien ne se voit plus).
    const dPlayer = Math.hypot(this.x - p.x, this.y - p.y);
    this.awayT = dPlayer > SNATCH.leaveFar ? this.awayT + dt : 0;
    if (this.awayT > SNATCH.leaveFor) return this.finish(this.phase === "approach" ? "abandonne" : this.outcome ?? "enfui");
    switch (this.phase) {
      case "approach":
        return this.approach(ctx);
      case "flee":
        this.victimStep(ctx);
        return this.flee(ctx);
      case "after":
        // Le voleur s'est échappé : la victime reste un moment, téléphone en main, puis repart.
        this.victimStep(ctx);
        this.afterT -= dt;
        if (this.afterT <= 0) this.finish("enfui");
        return;
      case "bag":
        this.victimStep(ctx);
        this.thiefAfter(dt);
        this.bagT += dt;
        if (this.bagT > SNATCH.bagLife) return this.finish("perdu");
        if (p.onFoot && Math.hypot(this.bagAt.x - p.x, this.bagAt.y - p.y) < SNATCH.pickReach) {
          this.phase = "carried";
          this.fx.feat("Sac récupéré");
        }
        return;
      case "carried":
        this.victimStep(ctx);
        this.thiefAfter(dt);
        return;
    }
  }

  private approach(ctx: EventContext): void {
    const peds = this.peds;
    if (!this.victimHere || !this.thiefHere || this.t > SNATCH.approachTimeout) return this.finish("abandonne");
    // Un des deux est tombé, a eu peur (alarme), ou la police arrive : la scène n'a pas lieu.
    if (peds.modeOf(this.victim) >= PED_STATE.stumble || peds.modeOf(this.thief) >= PED_STATE.stumble) return this.finish("abandonne");
    peds.position(this.victim, tmp);
    peds.position(this.thief, tmp2);
    if (ctx.policeNear(tmp.x, tmp.y, SNATCH.policeClear * 0.6)) return this.finish("abandonne");
    this.x = tmp.x;
    this.y = tmp.y;
    // Il vise un point juste derrière elle (elle marche) : il arrive dans son dos.
    const h = peds.headingOf(this.victim);
    const gx = tmp.x - Math.sin(h) * 0.6, gy = tmp.y - Math.cos(h) * 0.6;
    const d = Math.hypot(tmp2.x - tmp.x, tmp2.y - tmp.y);
    peds.command(this.thief, ORDER.seek, gx, gy, d < SNATCH.dashFrom ? SNATCH.dash : Math.min(SNATCH.walk, peds.speedOf(this.victim) + SNATCH.gain));
    if (d < SNATCH.reach) this.snatch(ctx);
  }

  /** L'arrachage : le sac change de main, la victime trébuche ou tombe, crie ; le voleur part en courant. */
  private snatch(ctx: EventContext): void {
    const peds = this.peds;
    const rv = peds.recipe(this.victim), rt = peds.recipe(this.thief);
    peds.setRecipe(this.victim, { ...rv, bag: "none" });
    peds.setRecipe(this.thief, { ...rt, bag: rv.bag, bagColor: rv.bagColor });
    peds.position(this.victim, tmp);
    this.victimHome = { x: tmp.x, y: tmp.y };
    this.x = tmp.x;
    this.y = tmp.y;
    // Tirée par le sac, dans le sens de course du voleur : une fois sur deux elle tombe (chute légère, D212), sinon elle trébuche.
    const h = peds.headingOf(this.thief), push = (this.victimId & 1) === 0 ? 3.9 : 2.4;
    peds.applyImpulse(this.victim, Math.sin(h) * push, Math.cos(h) * push);
    this.fx.cry("scream", tmp.x, tmp.y);
    this.fx.say(this.victim, "Au voleur !", 3.5);
    // Les passants tout proches s'écartent (sursaut, quelques secondes).
    peds.alarm(tmp.x, tmp.y, 6, 3, this.victim);
    peds.command(this.thief, ORDER.flee, ctx.player.x, ctx.player.y, FUGITIVE.run);
    this.phase = "flee";
    this.since = 0;
  }

  /** La victime : relevée, elle montre le voleur du bras, puis attend son sac, téléphone en main ; elle part au bout de 2 minutes. */
  private victimStep(ctx: EventContext): void {
    if (!this.victimHere) return;
    const peds = this.peds;
    if (peds.modeOf(this.victim) >= PED_STATE.stumble) return;
    if (!this.victimUp) {
      this.victimUp = true;
      this.fx.say(this.victim, "Au voleur !", 3);
    }
    // Au bout de 2 minutes, elle repart (sans son sac).
    if (this.since > SNATCH.victimWaits) {
      peds.release(this.victim);
      this.victimGone = true;
      return;
    }
    let fx = this.victimHome.x, fy = this.victimHome.y + 1, pose: number = LIFE_POSE.phone;
    if (this.phase === "flee" && this.since < 6 && this.thiefHere) {
      peds.position(this.thief, tmp2);
      fx = tmp2.x;
      fy = tmp2.y;
      pose = LIFE_POSE.point;
    } else if (this.phase === "carried" || Math.hypot(ctx.player.x - this.victimHome.x, ctx.player.y - this.victimHome.y) < 12) {
      // Le joueur approche (avec son sac ?) : elle le regarde.
      fx = ctx.player.x;
      fy = ctx.player.y;
      pose = 0;
    }
    peds.command(this.victim, ORDER.hold, fx, fy, 0, pose);
  }

  private flee(ctx: EventContext): void {
    const state = this.fugitive.update(ctx, this.victimHome.x, this.victimHome.y);
    if (state === "running") return;
    if (state === "escaped") return this.escaped();
    if (state === "tackled") {
      this.fugitive.position(tmp2);
      this.fx.cry("oof", tmp2.x, tmp2.y);
    }
    this.dropBag(state === "dead");
  }

  /** Le voleur s'est échappé : il garde le sac, redevient un passant ; la victime attend encore un peu puis repart. */
  private escaped(): void {
    if (this.thiefHere) this.peds.release(this.thief);
    this.outcome = "enfui";
    this.phase = "after";
    this.afterT = 20;
  }

  /** Le voleur est à terre (plaqué, frappé, renversé, tué) : le sac tombe à côté de lui. */
  private dropBag(dead: boolean): void {
    const peds = this.peds;
    peds.position(this.thief, tmp2);
    this.bagAt.x = tmp2.x + 0.5;
    this.bagAt.y = tmp2.y + 0.3;
    if (!dead) peds.setRecipe(this.thief, { ...peds.recipe(this.thief), bag: "none" });
    this.caught = true;
    this.caughtT = 0;
    this.outcome = "rattrape";
    this.phase = "bag";
    this.bagT = 0;
    this.thiefFree = dead ? 0 : 15;
    this.fx.feat("Voleur rattrapé");
  }

  /** Après sa chute, le voleur se relève et fuit encore un moment (sans sac), puis redevient un passant. */
  private thiefAfter(dt: number): void {
    if (this.thiefFree < 0) return;
    if (!this.thiefHere || this.peds.modeOf(this.thief) === PED_STATE.dead) {
      if (this.thiefHere) this.peds.release(this.thief);
      this.thiefFree = -1;
      return;
    }
    this.thiefFree -= dt;
    if (this.thiefFree <= 0) {
      this.peds.release(this.thief);
      this.thiefFree = -1;
    }
  }

  markers(out: EventMarker[]): void {
    if (this.done || this.phase === "approach" || this.phase === "after") return;
    out.push({ kind: "scene", x: this.x, y: this.y });
    if (this.phase === "flee" && this.thiefHere) {
      this.peds.position(this.thief, tmp2);
      out.push({ kind: "fugitive", x: tmp2.x, y: tmp2.y });
    }
    if (this.phase === "carried" && this.victimHere) out.push({ kind: "meet", x: this.victimHome.x, y: this.victimHome.y });
  }

  items(out: GroundItem[]): void {
    if (this.phase === "bag") out.push({ kind: "bag", x: this.bagAt.x, y: this.bagAt.y, color: parseInt((CLOTH_COLORS[this.bag.color] ?? "#7a5232").slice(1), 16) });
  }

  action(player: EventPlayer): EventAction | null {
    if (this.phase !== "carried" || !player.onFoot) return null;
    if (this.victimHere && this.peds.modeOf(this.victim) < PED_STATE.stumble) {
      this.peds.position(this.victim, tmp);
      if (Math.hypot(tmp.x - player.x, tmp.y - player.y) < SNATCH.returnReach) return { label: "Rendre le sac", verb: "Rendre", run: () => this.giveBack() };
    }
    return { label: "Fouiller le sac", verb: "Fouiller", run: () => this.keep(player) };
  }

  /** Sac rendu : la victime le reprend, remercie ; prime. */
  private giveBack(): void {
    const peds = this.peds;
    peds.setRecipe(this.victim, { ...peds.recipe(this.victim), bag: this.bag.kind as never, bagColor: this.bag.color });
    this.fx.say(this.victim, "Merci !", 3);
    this.fx.earn(this.reward, "Sac rendu");
    this.fx.feat(`Sac rendu · +${this.reward} €`);
    this.goodDeed = true;
    this.finish("rendu");
  }

  /** Sac gardé : son contenu ; si un passant le voit (la victime en premier), c'est un vol (une étoile, D5 du plan). */
  private keep(player: EventPlayer): void {
    const peds = this.peds;
    this.fx.earn(this.content, "Sac volé");
    const seen: number[] = [];
    peds.queryCircle(player.x, player.y, SNATCH.witness, seen);
    const witnesses = seen.filter((i) => i !== this.thief && peds.modeOf(i) < PED_STATE.stumble);
    if (this.victimHere && witnesses.includes(this.victim)) this.fx.say(this.victim, "Au voleur !", 3);
    if (witnesses.length > 0) this.fx.crime("robbery", player.x, player.y);
    this.finish("garde");
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    this.cleanup();
    this.done = true;
  }

  abort(): void {
    if (this.done) return;
    this.outcome ??= "abandonne";
    this.phase = "over";
    this.cleanup();
    this.done = true;
  }

  /** Rend les figurants à la foule (la victime sans son sac si elle ne l'a pas récupéré ; le voleur avec s'il s'est enfui). */
  private cleanup(): void {
    if (!this.victimGone && this.present(this.victim, this.victimId)) this.peds.release(this.victim);
    if (this.thiefHere) this.peds.release(this.thief);
  }
}
