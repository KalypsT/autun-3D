import { NODE_FLAG } from "../data/nav";
import { moveDir, moveEdge, type RoadGraph, type RoadMove } from "./road-graph";

/**
 * Feux de circulation (J3-3, D62) : logique pure. Les données donnent les nœuds à feux, pas leurs phases : elles sont fabriquées ici, au premier
 * besoin, et ne dépendent que de la position du nœud et de l'horloge (`clock.t`, secondes de simulation partagées par les voitures et les passants).
 * Deux sortes de feux, selon le nombre de branches : un feu de **carrefour** (3 branches ou plus : deux groupes, les branches qui se font face
 * ensemble, 30 s de vert, 4 s d'orange, tout rouge 2 s, puis l'autre groupe : cycle de 72 s) et un feu de **passage piéton** au milieu d'une
 * rue (2 branches : 30 s de vert, 3 s d'orange, 7 s de rouge qui est la phase piétons : cycle de 40 s). Chaque feu a un décalage qui vient d'un
 * hachage de sa position, pour que les feux ne passent pas tous au vert ensemble. Analogie : un métronome par carrefour, tous réglés
 * différemment.
 */

export const GREEN = 0, AMBER = 1, RED = 2;

/** Cycle d'un carrefour, durée du vert, de l'orange et décalage du second groupe (s). */
const CROSS_CYCLE = 72, CROSS_GREEN = 30, CROSS_AMBER = 4, CROSS_SECOND = 36;
/** Feu de passage piéton au milieu d'une rue : cycle, durée du vert, de l'orange (s) ; le reste est le rouge, phase des piétons. */
const MID_CYCLE = 40, MID_GREEN = 30, MID_AMBER = 3;
/** Un piéton qui arrive à moins de cette distance (m) d'un nœud à feux obéit à ce feu. */
const PED_REACH = 10;

const TWO_PI = Math.PI * 2;
const wrap = (a: number): number => a - TWO_PI * Math.round(a / TWO_PI);

interface Plan {
  mid: boolean;
  offset: number;
  /** Axe (rad, modulo π) du premier groupe. */
  axis: number;
  x: number;
  y: number;
}

/** Cap (rad) avec lequel on arrive au nœud en parcourant `m`, et cap de la branche vue depuis le nœud (direction qui s'éloigne de lui). */
function arrivalHeading(road: RoadGraph, m: RoadMove, tmp: number[]): number {
  const n = road.polyline(moveEdge(m), tmp);
  if (moveDir(m) === 0) return Math.atan2(tmp[n * 2 - 2]! - tmp[n * 2 - 4]!, tmp[n * 2 - 1]! - tmp[n * 2 - 3]!);
  return Math.atan2(tmp[0]! - tmp[2]!, tmp[1]! - tmp[3]!);
}

function hash(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 10) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(y * 10), 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

export class Signals {
  private readonly plans = new Map<string, Plan>();
  private readonly tmp: number[] = [];
  private readonly edges: number[] = [];

  constructor(
    private readonly road: RoadGraph,
    /** Horloge de simulation (s) : à faire avancer par le jeu quand il tourne (la pause la fige). */
    readonly clock: { t: number },
  ) {}

  private plan(node: number): Plan {
    const x = this.road.nodeX(node), y = this.road.nodeY(node);
    const key = `${x.toFixed(1)},${y.toFixed(1)}`;
    let p = this.plans.get(key);
    if (p) return p;
    const road = this.road;
    const arms = road.arms(node);
    // L'axe du premier groupe est celui de la branche la plus importante (classe la plus basse) : la route principale passe au vert en premier.
    this.edges.length = 0;
    road.edgesAt(node, this.edges);
    let best = this.edges[0], bc = 99;
    for (const e of this.edges) {
      if (road.edgeClass(e) < bc) {
        bc = road.edgeClass(e);
        best = e;
      }
    }
    let axis = 0;
    if (best !== undefined) {
      const m = road.edgeB(best) === node ? best * 2 : best * 2 + 1;
      axis = ((arrivalHeading(road, m, this.tmp) % Math.PI) + Math.PI) % Math.PI;
    }
    const mid = arms < 3;
    p = { mid, offset: hash(x, y) % (mid ? MID_CYCLE : CROSS_CYCLE), axis, x, y };
    this.plans.set(key, p);
    return p;
  }

  /** Le nœud a-t-il un feu ? */
  hasSignal(node: number): boolean {
    return (this.road.nodeFlags(node) & NODE_FLAG.signal) !== 0;
  }

  /** Groupe (0 ou 1) d'une branche d'arrivée : celles dont l'axe est à moins de 45° de l'axe du premier groupe. */
  private group(p: Plan, m: RoadMove): number {
    const h = arrivalHeading(this.road, m, this.tmp);
    return Math.abs(wrap(2 * (h - p.axis))) < Math.PI / 2 ? 0 : 1;
  }

  /** État du feu (`GREEN`, `AMBER`, `RED`) pour une voiture qui arrive au nœud en parcourant `m`, ou −1 s'il n'y a pas de feu. */
  carState(m: RoadMove): number {
    const node = this.road.arrivalNode(m);
    if (!this.hasSignal(node)) return -1;
    const p = this.plan(node);
    if (p.mid) {
      const t = (this.clock.t + p.offset) % MID_CYCLE;
      return t < MID_GREEN ? GREEN : t < MID_GREEN + MID_AMBER ? AMBER : RED;
    }
    const g = this.group(p, m);
    const t = (((this.clock.t + p.offset - g * CROSS_SECOND) % CROSS_CYCLE) + CROSS_CYCLE) % CROSS_CYCLE;
    return t < CROSS_GREEN ? GREEN : t < CROSS_GREEN + CROSS_AMBER ? AMBER : RED;
  }

  /**
   * Un piéton peut-il traverser en (x, y) la voie de la route `way` (identifiant OpenStreetMap, le `ref` du passage) ? Vrai quand le feu des
   * voitures de cette route est rouge depuis une seconde ; null s'il n'y a pas de feu à moins de 10 m.
   */
  pedWalk(x: number, y: number, way: number): boolean | null {
    const road = this.road;
    const hit = road.nearest(x, y, PED_REACH);
    if (!hit) return null;
    // Le nœud à feux le plus proche, au bout de l'arête trouvée.
    let node = -1, bd = PED_REACH;
    for (const end of [0, 1] as const) {
      const n = road.edgeNode(hit.edge, end);
      const d = Math.hypot(road.nodeX(n) - x, road.nodeY(n) - y);
      if (this.hasSignal(n) && d < bd) {
        bd = d;
        node = n;
      }
    }
    if (node < 0) return null;
    const p = this.plan(node);
    if (p.mid) {
      const t = (this.clock.t + p.offset) % MID_CYCLE;
      return t >= MID_GREEN + MID_AMBER + 1;
    }
    // Les voitures de la route traversée : le groupe d'une branche de ce nœud qui porte cette voie (sinon le premier).
    this.edges.length = 0;
    road.edgesAt(node, this.edges);
    let g = 0;
    for (const e of this.edges) {
      if (road.edgeWay(e) !== way) continue;
      g = this.group(p, road.edgeB(e) === node ? e * 2 : e * 2 + 1);
      break;
    }
    const t = (((this.clock.t + p.offset - g * CROSS_SECOND) % CROSS_CYCLE) + CROSS_CYCLE) % CROSS_CYCLE;
    return t >= CROSS_GREEN + CROSS_AMBER + 1;
  }
}
