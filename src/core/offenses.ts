import { NODE_FLAG } from "../data/nav";
import type { RoadGraph, RoadMove } from "./road-graph";
import { RED, type Signals } from "./signals";

/**
 * Infractions de conduite du joueur (J4, D74) : excès de vitesse et feu rouge, lus sur le graphe routier. Logique pure ; c'est le jeu qui décide si
 * la police les a vues. Analogie : le radar et la caméra de feu rouge, qui ne verbalisent que si un gendarme regarde.
 */

/** Excès de vitesse : au-delà de la limite de la rue plus 20 km/h (et 30 km/h au moins). */
export const SPEEDING_MARGIN = 20;
/** Un feu se grille quand on passe à moins de cette distance (m) de son nœud, au rouge, à plus de 3 m/s. */
const RED_REACH = 3;
const RED_SPEED = 3;
/** Un même feu ne compte qu'une fois en … s. */
const RED_REPEAT = 10;
/** Plus loin que cela (m) de toute route : ni limite ni feu (place, parking, trottoir large). */
const ROAD_REACH = 5;

export class RoadWatch {
  /** Au-dessus de la limite plus la marge, en ce moment. */
  speeding = false;
  /** Limite (km/h) de la rue où l'on roule, 0 hors route. */
  limit = 0;
  private time = 0;
  private readonly recent = new Map<number, number>();
  private readonly pt = { x: 0, y: 0 };

  constructor(
    private readonly road: () => RoadGraph | null,
    private readonly signals: () => Signals | null,
  ) {}

  /** À chaque pas où le joueur conduit : position, cap (rad, 0 = nord), vitesse (m/s). Renvoie vrai si un feu rouge vient d'être grillé. */
  update(x: number, y: number, heading: number, speed: number, dt: number): boolean {
    this.time += dt;
    const road = this.road();
    const hit = road?.nearest(x, y, ROAD_REACH) ?? null;
    if (!road || !hit) {
      this.speeding = false;
      this.limit = 0;
      return false;
    }
    this.limit = road.edgeSpeed(hit.edge);
    this.speeding = speed * 3.6 > Math.max(this.limit + SPEEDING_MARGIN, 30);
    const signals = this.signals();
    if (!signals || speed < RED_SPEED) return false;
    // Le sens où l'on roule sur cette arête : celui que le cap suit.
    const along = road.pointAt(hit.edge, hit.s, this.pt);
    const forward = Math.cos(heading - along) >= 0;
    const move: RoadMove = hit.edge * 2 + (forward ? 0 : 1);
    const node = road.arrivalNode(move);
    if (!(road.nodeFlags(node) & NODE_FLAG.signal)) return false;
    if (Math.hypot(road.nodeX(node) - x, road.nodeY(node) - y) > RED_REACH) return false;
    const last = this.recent.get(node);
    if (last !== undefined && this.time - last < RED_REPEAT) return false;
    if (signals.carState(move) !== RED) return false;
    this.recent.set(node, this.time);
    return true;
  }

  /** Arête de la route où l'on roule (diagnostic, tests). */
  edgeAt(x: number, y: number): number {
    const hit = this.road()?.nearest(x, y, ROAD_REACH);
    return hit ? hit.edge : -1;
  }
}

