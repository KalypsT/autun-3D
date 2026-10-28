import { moveEdge, type RoadGraph, type RoadMove } from "./road-graph";

/**
 * Itinéraire sur le graphe routier (J4, D73) : le plus court chemin d'un sens de parcours jusqu'à une arête, par A* (la longueur des arêtes, et la distance
 * à vol d'oiseau jusqu'au but pour guider la recherche). Analogie : le GPS de la voiture de police, qui recalcule quand le fugitif tourne.
 * Logique pure, sans allocation de structure lourde : quelques milliers de sens au plus dans l'anneau (≈ 3 700).
 */

export interface RouteOptions {
  /** Les sens uniques sont ignorés (la police en poursuite). */
  wrongWay?: boolean;
  /** Sens examinés au plus (garde-fou). */
  maxExpand?: number;
}

/** Tas binaire minimal de (priorité, valeur). */
class Heap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, v: number): void {
    const ks = this.keys, vs = this.vals;
    let i = ks.length;
    ks.push(k);
    vs.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p]! <= k) break;
      ks[i] = ks[p]!;
      vs[i] = vs[p]!;
      i = p;
    }
    ks[i] = k;
    vs[i] = v;
  }
  /** Retire la valeur de plus petite priorité. */
  pop(): number {
    const ks = this.keys, vs = this.vals;
    const top = vs[0]!;
    const k = ks.pop()!, v = vs.pop()!;
    const n = ks.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = k;
        if (l < n && ks[l]! < mk) {
          m = l;
          mk = ks[l]!;
        }
        if (r < n && ks[r]! < mk) m = r;
        if (m === i) break;
        ks[i] = ks[m]!;
        vs[i] = vs[m]!;
        i = m;
      }
      ks[i] = k;
      vs[i] = v;
    }
    return top;
  }
}

/**
 * Les sens à parcourir après `from` pour atteindre l'arête `goalEdge` (dans un sens ou dans l'autre), le dernier étant sur cette arête ;
 * `[]` si l'on y est déjà ; null si elle est inatteignable (ou trop loin pour `maxExpand`). (gx, gy) : le point visé, pour guider la recherche.
 */
export function findRoute(road: RoadGraph, from: RoadMove, goalEdge: number, gx: number, gy: number, opt: RouteOptions = {}): RoadMove[] | null {
  if (moveEdge(from) === goalEdge) return [];
  const wrongWay = opt.wrongWay ?? false, maxExpand = opt.maxExpand ?? 6000;
  const g = new Map<RoadMove, number>();
  const parent = new Map<RoadMove, RoadMove>();
  const done = new Set<RoadMove>();
  const heap = new Heap();
  const h = (m: RoadMove): number => {
    const n = road.arrivalNode(m);
    return Math.hypot(road.nodeX(n) - gx, road.nodeY(n) - gy);
  };
  g.set(from, 0);
  heap.push(h(from), from);
  const next: RoadMove[] = [];
  let expanded = 0;
  while (heap.size > 0) {
    const m = heap.pop();
    if (done.has(m)) continue;
    done.add(m);
    if (m !== from && moveEdge(m) === goalEdge) {
      const out: RoadMove[] = [];
      for (let c = m; c !== from; c = parent.get(c)!) out.push(c);
      return out.reverse();
    }
    if (++expanded > maxExpand) return null;
    next.length = 0;
    road.next(m, next, wrongWay);
    const base = g.get(m)!;
    for (const n of next) {
      if (done.has(n)) continue;
      // Le coût d'un sens : la longueur de son arête (on la parcourt en entier pour arriver au nœud suivant) ; l'arête visée ne compte que jusqu'à son milieu.
      const len = road.edgeLength(moveEdge(n));
      const cost = base + (moveEdge(n) === goalEdge ? len / 2 : len);
      if (cost >= (g.get(n) ?? Infinity)) continue;
      g.set(n, cost);
      parent.set(n, m);
      heap.push(cost + (moveEdge(n) === goalEdge ? 0 : h(n)), n);
    }
  }
  return null;
}
