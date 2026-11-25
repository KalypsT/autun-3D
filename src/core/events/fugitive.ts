import { ORDER, PED_STATE } from "../pedestrians";
import type { EventContext, EventPeds } from "./types";

/**
 * Un fuyard à pied (phase 4 : voleur à l'arraché, pickpocket) : il fuit le joueur sur le graphe piéton (fuite volontaire, D328), s'essouffle,
 * se fait plaquer par un joueur qui le touche en courant vite, ou s'échappe quand le joueur l'a perdu. Partagé par les événements.
 */

export const FUGITIVE = {
  /** Vitesse de départ (m/s : plus que la course du joueur, 5 ; moins que son sprint, 7), puis plus lente après `tire` s (sur 5 s). */
  run: 5.8,
  tired: 4.5,
  tire: 15,
  /** Plaquage : le joueur à pied à moins de … m, à plus de … m/s ; poussée donnée (m/s : une chute). */
  tackleReach: 1.1,
  tackleSpeed: 4,
  tackleImpulse: 4.4,
  /** Échappé : à plus de … m du joueur pendant … s, ou hors de vue et à plus de … m pendant … s. */
  lostFar: 90,
  lostFarFor: 6,
  lostHidden: 55,
  lostHiddenFor: 12,
  /** Il fuit le joueur à moins de … m ; plus loin, le point `home` (la scène). */
  chaseRange: 100,
} as const;

/** Ce qui est arrivé au fuyard à ce pas. */
export type FugitiveState = "running" | "tackled" | "down" | "dead" | "escaped";

const at = { x: 0, y: 0 };

export class Fugitive {
  /** Temps de course (s). */
  t = 0;
  private lostFarT = 0;
  private lostHiddenT = 0;

  constructor(
    private readonly peds: EventPeds,
    readonly slot: number,
    private readonly id: number,
    /** Vitesse de départ et vitesse fatiguée (m/s). */
    private readonly run: number = FUGITIVE.run,
    private readonly tired: number = FUGITIVE.tired,
  ) {}

  /** Le passant de l'emplacement est-il toujours le fuyard (vivant, même identifiant) ? */
  get here(): boolean {
    return this.peds.modeOf(this.slot) >= 0 && this.peds.idOf(this.slot) === this.id;
  }

  /** Position du fuyard. */
  position(out: { x: number; y: number }): void {
    this.peds.position(this.slot, out);
  }

  /**
   * Un pas : il fuit le joueur (ou `home` si le joueur est loin), à `speed` m/s s'il est donné (sinon la course, qui s'essouffle) ; renvoie ce
   * qui lui arrive : plaqué par le joueur à ce pas, à terre (frappé, renversé), mort, échappé, ou encore en course.
   */
  update(ctx: EventContext, homeX: number, homeY: number, speed?: number): FugitiveState {
    const peds = this.peds, p = ctx.player;
    if (!this.here) return "escaped";
    const mode = peds.modeOf(this.slot);
    if (mode === PED_STATE.dead) return "dead";
    if (mode === PED_STATE.down) return "down";
    this.t += ctx.dt;
    peds.position(this.slot, at);
    const d = Math.hypot(at.x - p.x, at.y - p.y);
    // Un fuyard qui trébuche (le joueur l'a bousculé en arrivant) se fait plaquer aussi.
    if (p.onFoot && d < FUGITIVE.tackleReach && p.speed > FUGITIVE.tackleSpeed && mode <= PED_STATE.stumble) {
      const ux = (at.x - p.x) / (d || 1), uy = (at.y - p.y) / (d || 1);
      peds.tackle(this.slot, (ux * 0.5 + (p.vx / p.speed) * 0.5) * FUGITIVE.tackleImpulse, (uy * 0.5 + (p.vy / p.speed) * 0.5) * FUGITIVE.tackleImpulse);
      return "tackled";
    }
    const near = d < FUGITIVE.chaseRange;
    const tiredK = Math.min(1, Math.max(0, (this.t - FUGITIVE.tire) / 5));
    peds.command(this.slot, ORDER.flee, near ? p.x : homeX, near ? p.y : homeY, speed ?? this.run + (this.tired - this.run) * tiredK);
    this.lostFarT = d > FUGITIVE.lostFar ? this.lostFarT + ctx.dt : 0;
    this.lostHiddenT = d > FUGITIVE.lostHidden && !ctx.visible(at.x, at.y) ? this.lostHiddenT + ctx.dt : 0;
    return this.lostFarT > FUGITIVE.lostFarFor || this.lostHiddenT > FUGITIVE.lostHiddenFor ? "escaped" : "running";
  }
}
