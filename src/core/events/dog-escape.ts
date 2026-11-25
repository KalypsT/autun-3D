import { DOG_POSE, runDog, stepDog, type Dog, type DogOwner } from "../dogs";
import { ORDER, PED_STATE } from "../pedestrians";
import { EventRng, type EventAction, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventPlayer, type GameEvent, type GroundItem } from "./types";

/**
 * Chien échappé (E3, lot 2 de la phase 4) : un promeneur lâche la laisse ; son chien part au galop, aboie, zigzague, s'arrête renifler,
 * repart dès qu'on lui court après. Son maître lui court après en criant son nom, et s'essouffle vite. Le joueur peut l'approcher **au pas**
 * (un chien fuit qui lui court dessus) et l'**attraper** (bouton), puis le ramener en laisse à son maître : « Merci ! », 60 à 120 €. Un
 * véhicule qui le frôle l'effraie : il s'enfuit pour de bon (jamais tué, Q3 du plan).
 */

export const DOG_ESCAPE = {
  /** Le maître est à … – … m du joueur. */
  near: 25,
  far: 80,
  /** Galop de départ (m/s, s), puis trot ; écart (m) des buts qu'il se choisit ; s'arrête renifler … – … s. */
  gallop: 5,
  gallopFor: 3,
  trot: 2.6,
  hop: [10, 22] as const,
  sniff: [1, 3] as const,
  /** Quelqu'un qui court (plus de … m/s) à moins de … m le fait détaler (… m/s pendant … s). */
  spookSpeed: 2.5,
  spookReach: 5,
  dart: 5.5,
  dartFor: 2,
  /** On l'attrape à pied, au pas (moins de … m/s), à moins de … m. */
  catchReach: 1.7,
  catchSpeed: 2.2,
  /** Le maître court (m/s) puis marche après … s ; il appelle son chien toutes les … s ; il abandonne au bout de … s. */
  ownerRun: 3.1,
  ownerWalk: 1.5,
  ownerRunFor: 8,
  call: 5,
  ownerGivesUp: 150,
  /** Rendre : à moins de … m du maître ; prime (€). */
  returnReach: 2.6,
  reward: [60, 120] as const,
  /** Un véhicule à plus de … m/s à moins de … m l'effraie pour de bon. */
  carSpeed: 3,
  carReach: 1.8,
  /** Il disparaît quand il est hors de vue et à plus de … m (perdu), ou au-delà de … m. */
  goneHidden: 60,
  goneFar: 160,
  leaveFar: 250,
  leaveFor: 20,
} as const;

/** Noms qu'un maître crie (tirés de sa graine). */
const NAMES = ["Rex", "Filou", "Médor", "Bella", "Oscar", "Câline", "Tobby", "Pépite", "Rocky", "Lulu", "Max", "Nala"] as const;

/** Les chiens, vus par un événement : le jeu (`PedsController`) les tient, les dessine, et les fait voir aux voitures. */
export interface EventDogs {
  /** Les maîtres qui promènent leur chien : emplacement du passant, position. */
  owners(visit: (slot: number, x: number, y: number) => void): void;
  /** Le maître `slot` lâche la laisse : son chien est retiré de sa laisse (null s'il n'en a pas). */
  detach(slot: number): Dog | null;
  /** Le chien revient à son maître (le même chien, en laisse). */
  attach(slot: number, dog: Dog): void;
  /** Le chien est dessiné à cette image (vu par les voitures), tenu en laisse depuis `leash` (repère du jeu) ou libre (null). */
  show(dog: Dog, leash: { x: number; y: number } | null): void;
}

/** Ce que le chien échappé fait en plus : aboyer. */
export interface DogEffects extends EventEffects {
  bark(x: number, y: number): void;
}

const tmp = { x: 0, y: 0 };

/** Cherche un promeneur à 25 – 80 m du joueur, qui marche avec son chien, dans un quartier calme (le directeur choisit la zone). */
export function findDogOwner(peds: EventPeds, dogs: EventDogs, ctx: EventContext, rng: EventRng): number {
  const p = ctx.player;
  let best = -1, bestScore = -Infinity;
  dogs.owners((slot, x, y) => {
    if (peds.modeOf(slot) !== PED_STATE.walk || peds.isBorrowed(slot)) return;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < DOG_ESCAPE.near || d > DOG_ESCAPE.far) return;
    const score = (ctx.visible(x, y) ? 2 : 0) - d / 80 + rng.next() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = slot;
    }
  });
  return best;
}

type Phase = "loose" | "led" | "gone" | "over";

export class DogEscapeEvent implements GameEvent {
  readonly kind = "chien" as const;
  readonly big = false;
  x = 0;
  y = 0;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  phase: Phase = "loose";
  readonly dog: Dog;
  readonly name: string;
  readonly reward: number;
  private t = 0;
  private goal = { x: 0, y: 0 };
  private speed: number = DOG_ESCAPE.gallop;
  private runT: number = DOG_ESCAPE.gallopFor;
  private sniffT = 0;
  private callT = 0;
  private awayT = 0;
  private ownerGone = false;
  private readonly ownerId: number;
  private readonly lead: DogOwner = { x: 0, y: 0, heading: 0, speed: 0, sitting: false, fleeing: false };

  constructor(
    private readonly peds: EventPeds,
    private readonly dogs: EventDogs,
    private readonly fx: DogEffects,
    readonly owner: number,
    dog: Dog,
    private readonly rng: EventRng,
  ) {
    peds.borrow(owner);
    this.ownerId = peds.idOf(owner);
    this.dog = dog;
    this.name = NAMES[this.ownerId % NAMES.length]!;
    this.reward = rng.between(DOG_ESCAPE.reward[0], DOG_ESCAPE.reward[1], 5);
    this.x = dog.x;
    this.y = dog.y;
    // Il part droit devant son maître, au galop.
    const h = peds.headingOf(owner) + (rng.next() - 0.5) * 1.2;
    this.goal = { x: dog.x + Math.sin(h) * 18, y: dog.y + Math.cos(h) * 18 };
    fx.bark(dog.x, dog.y);
    fx.say(owner, `${this.name} !`, 2.5);
  }

  private get ownerHere(): boolean {
    return !this.ownerGone && this.peds.modeOf(this.owner) >= 0 && this.peds.idOf(this.owner) === this.ownerId && this.peds.modeOf(this.owner) !== PED_STATE.dead;
  }

  lawfulTarget(): boolean {
    return false;
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    const dt = ctx.dt, p = ctx.player, d = this.dog;
    this.t += dt;
    this.x = d.x;
    this.y = d.y;
    this.awayT = Math.hypot(d.x - p.x, d.y - p.y) > DOG_ESCAPE.leaveFar ? this.awayT + dt : 0;
    if (this.awayT > DOG_ESCAPE.leaveFor) return this.finish(this.phase === "led" ? "abandonne" : "enfui");
    // Un véhicule qui le frôle : il détale pour de bon.
    if (this.phase !== "gone" && !p.onFoot && p.speed > DOG_ESCAPE.carSpeed && Math.hypot(d.x - p.x, d.y - p.y) < DOG_ESCAPE.carReach) {
      this.fx.bark(d.x, d.y);
      this.flight(p.x, p.y, 40);
      this.phase = "gone";
      this.outcome = "perdu";
    }
    if (this.phase === "led") return this.ledStep(ctx);
    this.ownerStep(ctx);
    if (this.phase === "gone") {
      // Il file loin, puis disparaît quand on ne le voit plus.
      runDog(d, this.goal.x, this.goal.y, DOG_ESCAPE.dart, dt);
      const far = Math.hypot(d.x - p.x, d.y - p.y);
      if ((far > DOG_ESCAPE.goneHidden && !ctx.visible(d.x, d.y)) || far > DOG_ESCAPE.goneFar || Math.hypot(this.goal.x - d.x, this.goal.y - d.y) < 0.5) return this.finish(this.outcome ?? "perdu");
      this.dogs.show(d, null);
      return;
    }
    this.looseStep(ctx);
    this.dogs.show(d, null);
    if (!this.ownerHere && this.phase === "loose") {
      // Le maître a renoncé (ou n'est plus là) : le chien s'en va.
      this.flight(p.x, p.y, 30);
      this.phase = "gone";
      this.outcome = "enfui";
    }
  }

  /** Chien libre : il court vers son but, renifle, repart ; il détale devant quelqu'un qui lui court dessus. */
  private looseStep(ctx: EventContext): void {
    const d = this.dog, p = ctx.player, dt = ctx.dt;
    // Qui lui court dessus ? Le joueur (à pied ou au volant lent), ou son maître.
    let spook: { x: number; y: number } | null = null;
    if (Math.hypot(d.x - p.x, d.y - p.y) < DOG_ESCAPE.spookReach && p.speed > DOG_ESCAPE.spookSpeed) spook = { x: p.x, y: p.y };
    if (this.ownerHere && this.peds.speedOf(this.owner) > DOG_ESCAPE.spookSpeed) {
      this.peds.position(this.owner, tmp);
      if (Math.hypot(d.x - tmp.x, d.y - tmp.y) < DOG_ESCAPE.spookReach) spook = { x: tmp.x, y: tmp.y };
    }
    if (spook && this.runT <= 0.2) {
      this.flight(spook.x, spook.y, 12 + this.rng.next() * 8);
      this.speed = DOG_ESCAPE.dart;
      this.runT = DOG_ESCAPE.dartFor;
      this.sniffT = 0;
      if (this.rng.next() < 0.5) this.fx.bark(d.x, d.y);
    }
    if (this.sniffT > 0) {
      this.sniffT -= dt;
      runDog(d, d.x, d.y, 0, dt, true);
      if (this.sniffT <= 0) this.pickGoal(ctx);
      return;
    }
    this.runT -= dt;
    if (this.runT <= 0) this.speed = DOG_ESCAPE.trot;
    runDog(d, this.goal.x, this.goal.y, this.speed, dt);
    if (Math.hypot(this.goal.x - d.x, this.goal.y - d.y) < 0.6) {
      this.sniffT = DOG_ESCAPE.sniff[0] + this.rng.next() * (DOG_ESCAPE.sniff[1] - DOG_ESCAPE.sniff[0]);
      d.pose = DOG_POSE.sniff;
    }
  }

  /** Nouveau but : à 10 – 22 m, plutôt loin de qui le suit, sans mur entre lui et le but. */
  private pickGoal(ctx: EventContext): void {
    const d = this.dog, p = ctx.player;
    let ax = d.x - p.x, ay = d.y - p.y;
    if (this.ownerHere) {
      this.peds.position(this.owner, tmp);
      ax += d.x - tmp.x;
      ay += d.y - tmp.y;
    }
    const away = Math.atan2(ax, ay);
    for (let k = 0; k < 8; k++) {
      const a = away + (this.rng.next() - 0.5) * (k < 4 ? 2.2 : 5);
      const r = DOG_ESCAPE.hop[0] + this.rng.next() * (DOG_ESCAPE.hop[1] - DOG_ESCAPE.hop[0]);
      const gx = d.x + Math.sin(a) * r, gy = d.y + Math.cos(a) * r;
      if (ctx.lineClear && !ctx.lineClear(d.x, d.y, gx, gy)) continue;
      this.goal = { x: gx, y: gy };
      return;
    }
    // Coincé : il revient un peu sur ses pas.
    this.goal = { x: d.x - Math.sin(away) * 6, y: d.y - Math.cos(away) * 6 };
  }

  /** Il détale loin de (x, y), à `dist` m. */
  private flight(x: number, y: number, dist: number): void {
    const d = this.dog, a = Math.atan2(d.x - x, d.y - y) + (this.rng.next() - 0.5) * 0.8;
    this.goal = { x: d.x + Math.sin(a) * dist, y: d.y + Math.cos(a) * dist };
  }

  /** Le maître court après son chien et l'appelle, puis marche ; il renonce au bout de 2 min 30. */
  private ownerStep(ctx: EventContext): void {
    if (!this.ownerHere) return;
    const d = this.dog, peds = this.peds;
    if (peds.modeOf(this.owner) >= PED_STATE.stumble) return;
    if (this.t > DOG_ESCAPE.ownerGivesUp && this.phase === "loose") {
      this.fx.say(this.owner, "Tant pis…", 2.5);
      peds.release(this.owner);
      this.ownerGone = true;
      return;
    }
    this.callT -= ctx.dt;
    if (this.callT <= 0) {
      this.callT = DOG_ESCAPE.call;
      this.fx.say(this.owner, `${this.name} !`, 2);
    }
    peds.position(this.owner, tmp);
    const near = Math.hypot(d.x - tmp.x, d.y - tmp.y) < 3;
    peds.command(this.owner, ORDER.seek, d.x, d.y, near ? 1.2 : this.t < DOG_ESCAPE.ownerRunFor ? DOG_ESCAPE.ownerRun : DOG_ESCAPE.ownerWalk);
  }

  /** En laisse derrière le joueur ; le maître attend, et vient vers lui quand il approche. */
  private ledStep(ctx: EventContext): void {
    const p = ctx.player, d = this.dog;
    const l = this.lead;
    l.x = p.x;
    l.y = p.y;
    l.heading = p.speed > 0.2 ? Math.atan2(p.vx, p.vy) : l.heading;
    l.speed = p.speed;
    stepDog(d, l, ctx.dt);
    this.dogs.show(d, { x: p.x, y: p.y });
    if (this.ownerHere && this.peds.modeOf(this.owner) < PED_STATE.stumble) {
      this.peds.position(this.owner, tmp);
      const dist = Math.hypot(p.x - tmp.x, p.y - tmp.y);
      // Il voit son chien revenir : il s'approche, puis attend, tourné vers lui.
      if (dist > 3) this.peds.command(this.owner, ORDER.seek, p.x, p.y, dist > 20 ? 2.4 : 1.3);
      else this.peds.command(this.owner, ORDER.hold, p.x, p.y, 0, 0);
    }
    if (!this.ownerHere) {
      // Plus de maître (parti, blessé) : le chien finit par s'en aller.
      this.flight(p.x, p.y, 30);
      this.phase = "gone";
      this.outcome = "perdu";
    }
  }

  markers(out: EventMarker[]): void {
    if (this.done) return;
    if (this.phase === "loose") out.push({ kind: "fugitive", x: this.dog.x, y: this.dog.y });
    if (this.phase === "led" && this.ownerHere) {
      this.peds.position(this.owner, tmp);
      out.push({ kind: "meet", x: tmp.x, y: tmp.y });
    }
  }

  items(_out: GroundItem[]): void {}

  action(p: EventPlayer): EventAction | null {
    if (!p.onFoot) return null;
    const d = this.dog;
    if (this.phase === "loose" && p.speed < DOG_ESCAPE.catchSpeed && Math.hypot(d.x - p.x, d.y - p.y) < DOG_ESCAPE.catchReach) {
      return { label: `Attraper ${this.name}`, verb: "Attraper", run: () => this.grab() };
    }
    if (this.phase === "led" && this.ownerHere) {
      this.peds.position(this.owner, tmp);
      if (Math.hypot(tmp.x - p.x, tmp.y - p.y) < DOG_ESCAPE.returnReach) return { label: `Rendre ${this.name}`, verb: "Rendre", run: () => this.giveBack() };
    }
    return null;
  }

  private grab(): void {
    this.phase = "led";
    this.dog.speed = 0;
    this.fx.feat(`${this.name} rattrapé`);
  }

  private giveBack(): void {
    this.dogs.attach(this.owner, this.dog);
    this.fx.say(this.owner, "Merci !", 3);
    this.fx.earn(this.reward, "Chien rendu");
    this.fx.feat(`${this.name} rendu · +${this.reward} €`);
    this.goodDeed = true;
    this.handedBack = true;
    this.finish("rendu");
  }

  /** Le chien a été rendu à son maître (il ne faut plus le dessiner à part). */
  private handedBack = false;

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.phase = "over";
    // Un maître encore là et un chien pas rendu : le chien revient à lui quand même (il le rattrape hors de vue) plutôt que de disparaître ;
    // un chien enfui ou perdu disparaît avec l'événement, et le maître repart seul.
    if (!this.handedBack && this.ownerHere && outcome === "abandonne") this.dogs.attach(this.owner, this.dog);
    if (this.ownerHere) this.peds.release(this.owner);
    this.done = true;
  }

  abort(): void {
    if (this.done) return;
    this.finish("abandonne");
  }
}
