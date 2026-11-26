import { AccidentEvent } from "./accident";
import { EventRng, type EventAction, type EventCarView, type EventContext, type EventEffects, type EventMarker, type EventOutcome, type EventPeds, type EventTraffic, type GameEvent, type GroundItem } from "./types";

/**
 * Accident en direct (E10, lot 7 de la phase 4) : une voiture de la circulation qui roule vers le joueur devient **imprudente** : conduite de
 * poursuite (elle accélère, grille les feux rouges, sans contresens), vers un point au-delà du joueur. Si elle percute une autre voiture
 * (choc de plus de 3 m/s : la vraie physique décide, D60), la scène de l'accident prend le relais avec ces deux voitures-là (D330 : détresse,
 * dispute, curieux, bouchon, patrouille, constat). Sinon, c'est un simple feu grillé, sous les yeux du joueur.
 */

export const CHAUFFARD = {
  /** La voiture : à … – … m du joueur, qui roule vers lui (à plus de … m/s). */
  near: 50,
  far: 160,
  minSpeed: 4,
  /** Son but : à … m au-delà du joueur. */
  beyond: 80,
  /** Un choc entre deux voitures de plus de … m/s : l'accident. */
  crash: 3,
  /** Sans choc au bout de … s (ou à plus de … m du joueur, après l'avoir croisé) : feu grillé, elle redevient une voiture ordinaire. */
  maxFor: 35,
  gone: 220,
} as const;

/** Une voiture qui roule vers le joueur, à 50 – 160 m : son identifiant, −1 sinon. */
export function findChauffard(traffic: EventTraffic, ctx: EventContext, rng: EventRng): number {
  const p = ctx.player, list = traffic.freeCars(p.x, p.y, CHAUFFARD.far).filter((c) => {
    const dx = p.x - c.state.x, dy = p.y - c.state.y, d = Math.hypot(dx, dy);
    if (d < CHAUFFARD.near || c.state.speed < CHAUFFARD.minSpeed) return false;
    // Elle vient vers le joueur (son cap à moins de 60° de la direction du joueur).
    return (Math.sin(c.state.heading) * dx + Math.cos(c.state.heading) * dy) / d > 0.5;
  });
  return list.length ? list[Math.floor(rng.next() * list.length)]!.id : -1;
}

export class ChauffardEvent implements GameEvent {
  readonly kind = "chauffard" as const;
  readonly big = true;
  x = 0;
  y = 0;
  done = false;
  outcome: EventOutcome | null = null;
  goodDeed = false;
  readonly car: number;
  /** La scène d'accident, une fois le choc arrivé. */
  accident: AccidentEvent | null = null;
  readonly ok: boolean;
  private t = 0;
  private passed = false;

  constructor(
    private readonly peds: EventPeds,
    private readonly traffic: EventTraffic,
    private readonly fx: EventEffects & { honk(x: number, y: number): void },
    carId: number,
    ctx: EventContext,
    private readonly rng: EventRng,
  ) {
    const c = traffic.claim(carId);
    this.car = c ? c.id : -1;
    const p = ctx.player;
    let ok = false;
    if (c) {
      const dx = p.x - c.state.x, dy = p.y - c.state.y, d = Math.hypot(dx, dy) || 1;
      ok = traffic.planTo(c.id, p.x + (dx / d) * CHAUFFARD.beyond, p.y + (dy / d) * CHAUFFARD.beyond, true, false, 1200);
      this.x = c.state.x;
      this.y = c.state.y;
    }
    this.ok = ok;
    if (!ok) {
      if (c) traffic.letGo(c.id);
      this.done = true;
      this.outcome = "abandonne";
    }
  }

  lawfulTarget(): boolean {
    return false;
  }

  update(ctx: EventContext): void {
    if (this.done) return;
    if (this.accident) return this.follow(ctx);
    this.t += ctx.dt;
    const c = this.traffic.eventCar(this.car), p = ctx.player;
    if (!c) return this.finish("grille");
    this.x = c.state.x;
    this.y = c.state.y;
    // Le choc : avec une autre voiture de la circulation, la scène d'accident ; avec le joueur ou la police, la police s'en occupe.
    if ((c.hitCar ?? -1) >= 0 && (c.hitCarImpact ?? 0) > CHAUFFARD.crash) return this.crash(c);
    if ((c.hit ?? 0) > CHAUFFARD.crash) return this.finish("choc");
    const d = Math.hypot(c.state.x - p.x, c.state.y - p.y);
    if (d < 25) this.passed = true;
    if (this.t > CHAUFFARD.maxFor || (this.passed && d > CHAUFFARD.gone)) this.finish("grille");
  }

  private crash(c: EventCarView): void {
    const other = this.traffic.claim(c.hitCar!) ?? this.traffic.eventCar(c.hitCar!);
    // La police, un bus : on ne pose pas de scène, elle s'arrête là.
    if (!other || other.police) return this.finish("choc");
    this.fx.cry("scream", c.state.x, c.state.y);
    this.accident = new AccidentEvent(this.peds, this.traffic, this.fx, { x: c.state.x, y: c.state.y, heading: c.state.heading, variant: 1 }, this.rng, [c, other]);
    if (!this.accident.ok) {
      this.accident = null;
      return this.finish("choc");
    }
  }

  /** La scène d'accident se déroule ; on reprend son issue. */
  private follow(ctx: EventContext): void {
    const a = this.accident!;
    a.update(ctx);
    this.x = a.x;
    this.y = a.y;
    if (a.done) {
      this.outcome = a.outcome === "abandonne" ? "choc" : a.outcome;
      this.done = true;
    }
  }

  markers(out: EventMarker[]): void {
    this.accident?.markers(out);
  }

  items(_out: GroundItem[]): void {}

  action(): EventAction | null {
    return this.accident?.action() ?? null;
  }

  private finish(outcome: EventOutcome): void {
    if (this.done) return;
    this.outcome = outcome;
    this.done = true;
    if (this.traffic.eventCar(this.car)) {
      this.traffic.pursue(this.car, null);
      this.traffic.letGo(this.car);
    }
  }

  abort(): void {
    if (this.accident) {
      this.accident.abort();
      this.outcome = this.accident.outcome;
      this.done = true;
      return;
    }
    this.finish(this.outcome ?? "abandonne");
  }
}
