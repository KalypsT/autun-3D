import type { NavGraph } from "./nav-graph";
import type { RoadGraph } from "./road-graph";
import { Heap } from "./road-route";

/**
 * Guidage vers le repère (plaisir de jeu, lot 1-2, D310) : logique pure. Le plus court chemin (A*) d'un point d'une arête à un point d'une
 * autre, sur le graphe routier (en véhicule, sens uniques respectés) ou sur le graphe piéton (à pied : trottoirs, passages, chemins), rendu
 * en une ligne brisée à dessiner sur la minimap et la carte agrandie. Analogie : le trait du GPS, tiré sur les mêmes rues que les voitures
 * de la circulation et les passants.
 *
 * Un sens de parcours (`move`) vaut `arête × 2 + (0 : de a vers b, 1 : de b vers a)`, comme dans les deux graphes.
 */

/** Ce que l'itinéraire demande à un graphe. */
export interface GuideGraph {
  /** Sens permis qui suivent `m` au nœud où il arrive (ajoutés à `out`). */
  next(m: number, out: number[]): void;
  /** Le sens `m` est-il permis (sens unique, arête praticable) ? */
  canGo(m: number): boolean;
  edgeLength(e: number): number;
  /** Coordonnées du nœud d'arrivée de `m`. */
  arrivalX(m: number): number;
  arrivalY(m: number): number;
  /** Sommets de l'arête de a à b, à plat dans `out` ; renvoie leur nombre. */
  polyline(e: number, out: number[]): number;
  /** Cap (rad, 0 = nord) de l'arête dans le sens a → b à l'abscisse `s`. */
  headingAt(e: number, s: number): number;
}

const tmp = { x: 0, y: 0 };

/** Le graphe piéton vu par l'itinéraire : tout se parcourt dans les deux sens. */
export function pedGuide(nav: NavGraph): GuideGraph {
  const end = (m: number): 0 | 1 => ((m & 1) === 0 ? 1 : 0);
  return {
    next: (m, out) => void nav.next(m >> 1, end(m), out),
    canGo: () => true,
    edgeLength: (e) => nav.edgeLength(e),
    arrivalX: (m) => nav.nodeX(nav.edgeNode(m >> 1, end(m))),
    arrivalY: (m) => nav.nodeY(nav.edgeNode(m >> 1, end(m))),
    polyline: (e, out) => nav.polyline(e, out),
    headingAt: (e, s) => nav.pointAt(e, s, tmp),
  };
}

/** Le graphe routier vu par l'itinéraire : arêtes carrossables, sens uniques respectés. */
export function roadGuide(road: RoadGraph): GuideGraph {
  return {
    next: (m, out) => void road.next(m, out),
    canGo: (m) => road.canGo(m),
    edgeLength: (e) => road.edgeLength(e),
    arrivalX: (m) => road.nodeX(road.arrivalNode(m)),
    arrivalY: (m) => road.nodeY(road.arrivalNode(m)),
    polyline: (e, out) => road.polyline(e, out),
    headingAt: (e, s) => road.pointAt(e, s, tmp),
  };
}

/** Un bout d'itinéraire : arête, abscisse (m depuis le nœud a) et point du graphe le plus proche. */
export interface GuideEnd {
  edge: number;
  s: number;
  x: number;
  y: number;
}

export interface GuideOptions {
  /** Cap du véhicule (rad) : partir à l'opposé coûte `uTurn` mètres de plus (un demi-tour). */
  heading?: number;
  uTurn?: number;
  /** Sens examinés au plus (garde-fou). */
  maxExpand?: number;
}

export interface GuideRoute {
  /** Ligne brisée à plat (x0, y0, x1, y1…), du point de départ au point d'arrivée sur le graphe. */
  points: number[];
  /** Longueur du trajet sur le graphe (m). */
  length: number;
}

/** Demi-tour : ce qu'il coûte de repartir à l'opposé du cap du véhicule (m). */
export const U_TURN = 80;

/** Le plus court chemin de `from` à `to` (null si `to` est inatteignable ou trop loin pour `maxExpand`). */
export function findGuide(g: GuideGraph, from: GuideEnd, to: GuideEnd, opt: GuideOptions = {}): GuideRoute | null {
  const maxExpand = opt.maxExpand ?? 200000;
  const lenFrom = g.edgeLength(from.edge), lenTo = g.edgeLength(to.edge);
  const penalty = (dir: 0 | 1): number => {
    if (opt.heading === undefined) return 0;
    const h = g.headingAt(from.edge, from.s) + (dir === 1 ? Math.PI : 0);
    return Math.cos(h - opt.heading) < 0 ? (opt.uTurn ?? U_TURN) : 0;
  };

  // Même arête : on y va directement si le sens est permis (sinon, par le graphe, comme ailleurs).
  if (from.edge === to.edge) {
    const dir: 0 | 1 = to.s >= from.s ? 0 : 1;
    if (g.canGo(from.edge * 2 + dir) && penalty(dir) === 0) {
      const out: number[] = [];
      slice(g, from.edge, from.s, to.s, out);
      return { points: out, length: Math.abs(to.s - from.s) };
    }
  }

  const h = (m: number): number => Math.hypot(g.arrivalX(m) - to.x, g.arrivalY(m) - to.y);
  const cost = new Map<number, number>();
  const parent = new Map<number, number>();
  const done = new Set<number>();
  /** Fin sur l'arête visée : sens d'entrée → (coût total, sens d'où l'on vient). */
  const finals = new Map<number, { total: number; from: number }>();
  const heap = new Heap();
  const offer = (m: number, c: number, from: number): void => {
    if (c >= (cost.get(m) ?? Infinity)) return;
    cost.set(m, c);
    parent.set(m, from);
    heap.push(c + h(m), m);
  };
  for (const dir of [0, 1] as const) {
    const m = from.edge * 2 + dir;
    if (!g.canGo(m)) continue;
    offer(m, (dir === 0 ? lenFrom - from.s : from.s) + penalty(dir), -1);
  }
  const next: number[] = [];
  let expanded = 0;
  while (heap.size > 0) {
    const m = heap.pop();
    if (m < 0) {
      // Une fin d'itinéraire sortie du tas : c'est la meilleure.
      const n = -1 - m;
      const f = finals.get(n)!;
      const moves: number[] = [];
      for (let c = f.from; c !== -1; c = parent.get(c)!) moves.push(c);
      moves.reverse();
      return { points: build(g, from, to, moves, n), length: f.total };
    }
    if (done.has(m)) continue;
    done.add(m);
    if (++expanded > maxExpand) return null;
    const base = cost.get(m)!;
    next.length = 0;
    g.next(m, next);
    for (const n of next) {
      const e = n >> 1;
      if (e === to.edge) {
        const total = base + ((n & 1) === 0 ? to.s : lenTo - to.s);
        if (total < (finals.get(n)?.total ?? Infinity)) {
          finals.set(n, { total, from: m });
          heap.push(total, -1 - n);
        }
        continue;
      }
      if (done.has(n)) continue;
      offer(n, base + g.edgeLength(e), m);
    }
  }
  return null;
}

const poly: number[] = [];

/** Ajoute à `out` les sommets de l'arête entre les abscisses `s0` et `s1` (dans ce sens), bornes comprises. */
function slice(g: GuideGraph, e: number, s0: number, s1: number, out: number[]): void {
  const n = g.polyline(e, poly);
  // Les abscisses sont celles de la longueur enregistrée de l'arête : on les ramène à la longueur de la ligne brisée.
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(poly[i * 2]! - poly[i * 2 - 2]!, poly[i * 2 + 1]! - poly[i * 2 - 1]!);
  const k = total / Math.max(g.edgeLength(e), 1e-6);
  const a = Math.min(Math.max(s0 * k, 0), total), b = Math.min(Math.max(s1 * k, 0), total);
  const pts: number[] = [];
  const at = (s: number): void => {
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const x0 = poly[i * 2 - 2]!, y0 = poly[i * 2 - 1]!, x1 = poly[i * 2]!, y1 = poly[i * 2 + 1]!;
      const l = Math.hypot(x1 - x0, y1 - y0);
      if (acc + l >= s || i === n - 1) {
        const t = l > 1e-6 ? Math.min(Math.max((s - acc) / l, 0), 1) : 0;
        pts.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        return;
      }
      acc += l;
    }
    pts.push(poly[0]!, poly[1]!);
  };
  // Point de départ, sommets intérieurs dans l'ordre du parcours, point d'arrivée.
  at(a);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const inner: number[] = [];
  let acc = 0;
  for (let i = 1; i < n - 1; i++) {
    acc += Math.hypot(poly[i * 2]! - poly[i * 2 - 2]!, poly[i * 2 + 1]! - poly[i * 2 - 1]!);
    if (acc > lo && acc < hi) inner.push(i);
  }
  if (b < a) inner.reverse();
  for (const i of inner) pts.push(poly[i * 2]!, poly[i * 2 + 1]!);
  at(b);
  for (let i = 0; i < pts.length; i += 2) push(out, pts[i]!, pts[i + 1]!);
}

/** Ajoute un point, sauf s'il répète le précédent. */
function push(out: number[], x: number, y: number): void {
  const n = out.length;
  if (n >= 2 && Math.abs(out[n - 2]! - x) < 0.01 && Math.abs(out[n - 1]! - y) < 0.01) return;
  out.push(x, y);
}

function build(g: GuideGraph, from: GuideEnd, to: GuideEnd, moves: number[], last: number): number[] {
  const out: number[] = [];
  moves.forEach((m, i) => {
    const e = m >> 1, len = g.edgeLength(e), fwd = (m & 1) === 0;
    const s0 = i === 0 ? from.s : fwd ? 0 : len;
    slice(g, e, s0, fwd ? len : 0, out);
  });
  const e = last >> 1, fwd = (last & 1) === 0;
  slice(g, e, fwd ? 0 : g.edgeLength(e), to.s, out);
  return out;
}

/** Longueur d'une ligne brisée à plat (m). */
export function polylineLength(points: readonly number[]): number {
  let l = 0;
  for (let i = 2; i < points.length; i += 2) l += Math.hypot(points[i]! - points[i - 2]!, points[i + 1]! - points[i - 1]!);
  return l;
}

/** Où en est le joueur sur l'itinéraire : segment le plus proche, point projeté, distance à la ligne et distance déjà parcourue (m). */
export interface GuideProgress {
  seg: number;
  x: number;
  y: number;
  off: number;
  along: number;
}

/** Projette (x, y) sur la ligne brisée ; `from` : premier segment examiné (on ne revient pas en arrière d'un itinéraire déjà suivi). */
export function routeProgress(points: readonly number[], x: number, y: number, from = 0): GuideProgress {
  let best: GuideProgress = { seg: 0, x: points[0] ?? x, y: points[1] ?? y, off: Infinity, along: 0 };
  let acc = 0;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const x0 = points[i]!, y0 = points[i + 1]!, x1 = points[i + 2]!, y1 = points[i + 3]!;
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
    if (i / 2 >= from) {
      const t = l2 > 1e-9 ? Math.min(Math.max(((x - x0) * dx + (y - y0) * dy) / l2, 0), 1) : 0;
      const px = x0 + dx * t, py = y0 + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best.off) best = { seg: i / 2, x: px, y: py, off: d, along: acc + l * t };
    }
    acc += l;
  }
  return best;
}
