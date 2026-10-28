/**
 * Règles aux carrefours (J3-2b, D61) : logique pure. Chaque conducteur publie où il en est de son prochain carrefour (`JunctionState`) ;
 * deux conducteurs qui y arrivent par des branches différentes se gênent si leurs trajets se croisent ou se rejoignent, et l'un des deux
 * doit céder selon les règles françaises : rond-point (l'anneau passe avant), panneaux (stop, cédez-le-passage), importance de la route,
 * puis priorité à droite, le tourne-à-gauche cédant à celui qui vient en face. Analogie : chacun regarde le plan du carrefour et se demande
 * « mon trait coupe-t-il le sien, et qui doit laisser passer ? ».
 */

/** État d'un conducteur vis-à-vis de son prochain carrefour (une seule instance par conducteur, réécrite à chaque pas). */
export interface JunctionState {
  /** Un carrefour est devant (à moins de la portée de regard) ou la voiture est dedans. */
  active: boolean;
  /** Position du nœud (m) : deux conducteurs sont au même carrefour si leurs nœuds sont à moins de 0,3 m (les nœuds jumeaux d'une frontière de super-tuile ont des références différentes). */
  x: number;
  y: number;
  /** Arêtes d'arrivée et de départ du conducteur (références du graphe routier). */
  inEdge: number;
  outEdge: number;
  /** Caps (rad) de la route à l'entrée et à la sortie du carrefour ; `turn` = sortie − entrée ramenée à ]−π, π] (négatif : à gauche). */
  inH: number;
  outH: number;
  turn: number;
  /** Distance (m) du nez de la voiture à la ligne d'arrêt le long de la route : négative quand elle est dans le carrefour. */
  dist: number;
  /** Vitesse (m/s). */
  speed: number;
  /** Classe de l'arête d'arrivée (0 : route principale ... 7) et obligation de cédance : 0 aucune, 1 cédez-le-passage, 2 stop. */
  cls: number;
  obligation: number;
  /** Arrive sur l'anneau d'un rond-point, ou y entre. */
  ring: boolean;
  enteringRing: boolean;
  /** Attend à la ligne d'arrêt et depuis combien de temps (s). */
  waiting: boolean;
  waitedFor: number;
  /** Identifiant du conducteur (départage les interblocages). */
  id: number;
}

export function emptyJunction(id: number): JunctionState {
  return { active: false, x: 0, y: 0, inEdge: -1, outEdge: -1, inH: 0, outH: 0, turn: 0, dist: Infinity, speed: 0, cls: 4, obligation: 0, ring: false, enteringRing: false, waiting: false, waitedFor: 0, id };
}

const TWO_PI = Math.PI * 2;
const wrap = (a: number): number => a - TWO_PI * Math.round(a / TWO_PI);
const norm = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;
/** Deux branches dont les directions diffèrent de moins que cela (rad) sont la même branche. */
const SAME_ARM = 0.3;

export const sameJunction = (a: JunctionState, b: JunctionState): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 0.3;

/** Obligation de cédance d'un panneau d'approche (`SIGN` de `road-graph.ts`, sans le bit « direction inconnue ») : stop 2, cédez-le-passage 1, sinon 0. */
export function obligationOf(sign: number): number {
  const kind = sign & 7;
  return kind === 1 ? 2 : kind === 2 ? 1 : 0;
}

/** Écart angulaire (rad) entre la file d'arrivée, la file de départ et l'axe d'une branche : on roule à droite, donc la file qui arrive est à gauche de l'axe de la branche vue du carrefour, celle qui part à droite. */
const LANE = 0.12;

/** Les trajets à travers le carrefour de `a` et de `b` (arrivés par des branches différentes) se croisent-ils ou se rejoignent-ils ? */
export function conflict(a: JunctionState, b: JunctionState): boolean {
  if (a.inEdge === b.inEdge) return false;
  const ai = norm(a.inH + Math.PI), ao = norm(a.outH), bi = norm(b.inH + Math.PI), bo = norm(b.outH);
  const close = (x: number, y: number): boolean => Math.abs(wrap(x - y)) < SAME_ARM;
  // Même branche de sortie : les deux files se rejoignent. Même branche d'arrivée : l'un suit l'autre.
  if (close(ao, bo)) return true;
  if (close(ai, bi)) return false;
  // Chaque trajet est une corde du cercle des branches, de sa file d'arrivée à sa file de départ (les files d'une même branche sont voisines,
  // pas confondues : un tourne-à-gauche croise bien le tout droit qui vient en face). Deux cordes se croisent si leurs extrémités s'alternent.
  const pa = norm(ai - LANE), qa = norm(ao + LANE), pb = norm(bi - LANE), qb = norm(bo + LANE);
  const lo = Math.min(pa, qa), hi = Math.max(pa, qa);
  const inside = (x: number): boolean => x > lo && x < hi;
  return inside(pb) !== inside(qb);
}

/** `a` doit-il laisser passer `b` ? On suppose qu'ils se gênent (`conflict`). */
export function mustYield(a: JunctionState, b: JunctionState): boolean {
  // Rond-point : celui qui est sur l'anneau passe avant celui qui y entre.
  if (a.enteringRing && b.ring) return true;
  if (a.ring || b.ring) return false;
  // Panneaux : celui qui a un stop cède à celui qui a un cédez-le-passage, qui cède à celui qui n'a rien.
  if (a.obligation !== b.obligation) return a.obligation > b.obligation;
  // Importance de la route : la moins importante cède.
  if (a.cls !== b.cls) return a.cls > b.cls;
  // Priorité à droite : on cède à celui dont la branche est à notre droite ; en face, le tourne-à-gauche cède.
  const rel = wrap(b.inH + Math.PI - a.inH);
  if (Math.abs(rel) < 0.4) return a.turn < -0.6 && b.turn >= -0.6;
  return rel > 0 && rel < Math.PI - 0.4;
}
