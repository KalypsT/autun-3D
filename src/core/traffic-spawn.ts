import type { Colliders } from "./collision";
import { lanePoint } from "./driver";
import type { NavGraph } from "./nav-graph";
import { moveEdge, type RoadMove } from "./road-graph";
import type { VehicleSpec } from "./vehicle";

/**
 * Où faire naître une voiture de la circulation (J3-4, D64) : logique pure. Sur la voie de droite d'une arête carrossable de la couronne
 * `[rIn, rOut]` autour du joueur (qui s'éloigne quand il roule vite), jamais dans son champ de vision (sauf derrière un mur), jamais sur une autre voiture
 * ni sur un obstacle fixe (véhicule garé compris), jamais là où la tuile n'est pas construite, jamais au bord du monde.
 * Analogie : le régisseur qui fait entrer les figurants par les coulisses.
 */

export interface SpawnQuery {
  /** Position du joueur, cap de la caméra (rad, 0 = nord, sens horaire) et vitesse (m/s). */
  px: number;
  py: number;
  yaw: number;
  speed: number;
  /** Demi-angle (rad) du champ de vision au-delà duquel on peut naître : 0,95 couvre un écran de téléphone en paysage avec une marge. */
  halfFov?: number;
  /** Nombres pseudo-aléatoires reproductibles dans [0, 1[. */
  rnd: () => number;
  /** Positions des voitures et du véhicule du joueur (une naissance reste à `minGap` m de chacune). */
  taken: ReadonlyArray<{ x: number; y: number }>;
  minGap?: number;
  /** La tuile qui contient ce point est-elle construite (ses obstacles sont en place) ? */
  solidAt: (x: number, y: number) => boolean;
  colliders: Colliders;
  /** Coque du modèle qui naîtra (la voie doit être libre pour elle). */
  hull: VehicleSpec["hull"];
  /** Nombre d'arêtes essayées au plus. */
  tries?: number;
}

export interface Spawn {
  move: RoadMove;
  /** Abscisse (m) du départ le long de l'arête. */
  s: number;
  x: number;
  y: number;
  heading: number;
  /** Vitesse limite de l'arête (km/h). */
  limit: number;
}

/** Rayons (m) de la couronne de naissance : plus loin quand on va vite (la circulation doit être là avant qu'on arrive). */
export function spawnRing(speed: number): { rIn: number; rOut: number } {
  const rIn = Math.min(60 + 3 * speed, 140);
  return { rIn, rOut: Math.min(rIn + 90, 230) };
}

/** Le point est-il dans le champ de vision du joueur et à découvert (aucun mur entre eux) ? */
export function visibleFrom(px: number, py: number, yaw: number, halfFov: number, x: number, y: number, colliders: Colliders): boolean {
  const bearing = Math.atan2(x - px, y - py);
  const d = Math.atan2(Math.sin(bearing - yaw), Math.cos(bearing - yaw));
  if (Math.abs(d) > halfFov) return false;
  return colliders.raycast(px, py, x, y) === null;
}

export function pickSpawn(nav: NavGraph, q: SpawnQuery): Spawn | null {
  const road = nav.road;
  const { rIn, rOut } = spawnRing(q.speed);
  const halfFov = q.halfFov ?? 0.95, minGap = q.minGap ?? 20;
  // Arêtes dont une extrémité au moins tombe à moins de rOut + 60 m du joueur (la sélection exacte se fait sur le point choisi).
  const candidates: number[] = [];
  for (const l of nav.cells.values()) {
    for (const e of road.edgesOfSlot(l.slot)) {
      if (!road.drivable(e) || road.edgeLength(e) < 25 || road.edgeClass(e) > 5) continue;
      const a = road.edgeA(e), b = road.edgeB(e);
      if ((road.nodeFlags(a) | road.nodeFlags(b)) & 2) continue;
      const mx = (road.nodeX(a) + road.nodeX(b)) / 2, my = (road.nodeY(a) + road.nodeY(b)) / 2;
      const d = Math.hypot(mx - q.px, my - q.py);
      if (d < rIn - road.edgeLength(e) / 2 || d > rOut + road.edgeLength(e) / 2) continue;
      candidates.push(e);
    }
  }
  if (candidates.length === 0) return null;
  const lp = { x: 0, y: 0, heading: 0 };
  const tries = q.tries ?? 14;
  for (let t = 0; t < tries; t++) {
    const e = candidates[Math.floor(q.rnd() * candidates.length)]!;
    let move = e * 2 + (q.rnd() < 0.5 ? 0 : 1);
    if (!road.canGo(move)) move ^= 1;
    if (!road.canGo(move)) continue;
    const len = road.edgeLength(moveEdge(move));
    const margin = Math.min(10, len / 4);
    const s = margin + q.rnd() * Math.max(len - 2 * margin - 15, 1);
    lanePoint(road, move, s, lp);
    const d = Math.hypot(lp.x - q.px, lp.y - q.py);
    if (d < rIn || d > rOut || !q.solidAt(lp.x, lp.y)) continue;
    if (visibleFrom(q.px, q.py, q.yaw, halfFov, lp.x, lp.y, q.colliders)) continue;
    if (q.taken.some((c) => Math.hypot(c.x - lp.x, c.y - lp.y) < minGap)) continue;
    // Place libre pour la coque (un véhicule garé, un poteau, un mur) : on teste chaque cercle.
    const sx = Math.sin(lp.heading), sy = Math.cos(lp.heading);
    if (q.hull.some(([off, r]) => q.colliders.resolve(lp.x + sx * off, lp.y + sy * off, r).hit)) continue;
    return { move, s, x: lp.x, y: lp.y, heading: lp.heading, limit: road.edgeSpeed(moveEdge(move)) };
  }
  return null;
}
