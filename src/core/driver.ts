import type { Colliders, Resolution } from "./collision";
import type { NavGraph } from "./nav-graph";
import { moveDir, moveEdge, type RoadGraph, type RoadMove } from "./road-graph";
import { driveForce, GRAVITY, steerLimit, type DriveInput, type VehicleSpec, type VehicleState } from "./vehicle";

/**
 * Conducteur simulé (J3-1, D59) : logique pure. Il suit une route (suite de sens de parcours du graphe routier) sur la voie de droite,
 * avec les mêmes commandes qu'un joueur (accélérateur, frein, direction) : `stepVehicle` fait le reste, chocs compris.
 * Analogie : un élève de l'auto-école qui suit le tracé au sol, lit le panneau de vitesse et regarde où il est dans le virage.
 *
 * Le tracé est une ligne brisée rééchantillonnée tous les `DS` mètres : voie décalée à droite de chaque arête, virages arrondis aux jonctions
 * (courbes de Bézier), puis un profil de vitesse (limite, courbure, freinage anticipé). La direction est une poursuite de point
 * (« viser un point devant soi »), la vitesse une régulation qui suit le profil.
 */

/** Pas du tracé (m). */
export const DS = 1.5;
/** Accélération latérale confortable en virage (m/s²), décélération et accélération confortables (m/s²). */
const A_LAT = 2.0;
const A_DEC = 2.4;
const A_ACC = 2.0;
/** Part de la vitesse autorisée que le conducteur adopte, et vitesse plancher (m/s) : une rue limitée à 5 km/h se parcourt tout de même à 15. */
const SPEED_FACTOR = 0.9;
const SPEED_FLOOR = 15 / 3.6;
/** Longueur de route (m) qu'on garde devant soi, et nombre maximal d'arêtes dans la route. */
const AHEAD = 220;
const MAX_MOVES = 14;
/** Écart au tracé (m) au-delà duquel le conducteur est perdu, et temps (s) à l'arrêt sans raison au bout duquel il est bloqué. */
const LOST_DISTANCE = 8;
const STUCK_TIME = 8;
/** Passes d'adoucissement du tracé, et part de la courbure maximale permise par la direction que le tracé a le droit d'utiliser. */
const SMOOTH_PASSES = 10;
const STEER_USE = 0.75;
/** Gain du rappel latéral vers le tracé (voir `Driver.update`). */
const CROSS_GAIN = 0.6;

/** Décalage (m) de la voie de droite : le quart de la chaussée sur une route à double sens, l'axe sur un sens unique. */
export function laneOffset(road: RoadGraph, e: number): number {
  return road.oneway(e) ? 0 : Math.min(road.edgeWidth(e) / 4, 2.2);
}

const tmpLine: number[] = [];

/** Ligne de la voie de droite d'un sens de parcours, dans le sens de la marche (x, y à plat) : les sommets de l'arête décalés à droite, coins en onglet. */
export function laneLine(road: RoadGraph, move: RoadMove, out: number[]): void {
  const e = moveEdge(move);
  const n = road.polyline(e, tmpLine);
  const pts: number[] = [];
  if (moveDir(move) === 0) pts.push(...tmpLine);
  else for (let i = n - 1; i >= 0; i--) pts.push(tmpLine[i * 2]!, tmpLine[i * 2 + 1]!);
  // Les sommets confondus n'ont pas de direction : on les écarte.
  const line: number[] = [pts[0]!, pts[1]!];
  for (let i = 1; i < n; i++) if (Math.hypot(pts[i * 2]! - line[line.length - 2]!, pts[i * 2 + 1]! - line[line.length - 1]!) > 0.05) line.push(pts[i * 2]!, pts[i * 2 + 1]!);
  const m = line.length / 2, off = laneOffset(road, e);
  out.length = 0;
  if (m < 2 || off === 0) {
    out.push(...line);
    return;
  }
  // Normale à droite de la marche : (dy, −dx).
  const normal = (i: number): [number, number] => {
    const dx = line[i * 2 + 2]! - line[i * 2]!, dy = line[i * 2 + 3]! - line[i * 2 + 1]!, l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l];
  };
  for (let i = 0; i < m; i++) {
    const a = i > 0 ? normal(i - 1) : normal(0), b = i < m - 1 ? normal(i) : a;
    const k = 1 + a[0] * b[0] + a[1] * b[1];
    let mx = (a[0] + b[0]) / Math.max(k, 0.3), my = (a[1] + b[1]) / Math.max(k, 0.3);
    const l = Math.hypot(mx, my);
    if (l > 2) {
      mx = (mx / l) * 2;
      my = (my / l) * 2;
    }
    out.push(line[i * 2]! + mx * off, line[i * 2 + 1]! + my * off);
  }
}

function lineLength(line: readonly number[]): number {
  let s = 0;
  for (let i = 2; i < line.length; i += 2) s += Math.hypot(line[i]! - line[i - 2]!, line[i + 1]! - line[i - 1]!);
  return s;
}

/** Partie de la ligne entre les abscisses curvilignes `from` et `to` (m), ajoutée à `out`. */
function cut(line: readonly number[], from: number, to: number, out: number[]): void {
  let s = 0, started = false;
  for (let i = 2; i < line.length; i += 2) {
    const x0 = line[i - 2]!, y0 = line[i - 1]!, x1 = line[i]!, y1 = line[i + 1]!, len = Math.hypot(x1 - x0, y1 - y0);
    if (!started && s + len >= from) {
      const t = len > 1e-9 ? (from - s) / len : 0;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      started = true;
    }
    if (started) {
      if (s + len >= to) {
        const t = len > 1e-9 ? (to - s) / len : 1;
        out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        return;
      }
      out.push(x1, y1);
    }
    s += len;
  }
  if (!started) out.push(line[line.length - 2]!, line[line.length - 1]!);
}

/** Position, cap (rad, 0 = nord, sens horaire) de la voie de droite d'un sens de parcours à la distance `s` (m) de son début. */
export function lanePoint(road: RoadGraph, move: RoadMove, s: number, out: { x: number; y: number; heading: number }): void {
  const line: number[] = [];
  laneLine(road, move, line);
  const seg: number[] = [];
  const total = lineLength(line);
  const a = Math.min(Math.max(s, 0), total);
  cut(line, a, Math.min(a + 0.5, total), seg);
  if (seg.length < 4) cut(line, Math.max(a - 0.5, 0), a, seg);
  const p = seg.length >= 4 ? seg : [line[0]!, line[1]!, line[2]!, line[3]!];
  out.x = p[0]!;
  out.y = p[1]!;
  out.heading = Math.atan2(p[p.length - 2]! - p[0]!, p[p.length - 1]! - p[1]!);
}

/** Tracé d'une route : points tous les `DS` m, cap, vitesse cible, arête de la route à laquelle appartient chaque point. */
export interface Path {
  n: number;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  /** Vitesse conseillée (m/s) : limite, courbure et freinage anticipé. */
  v: Float32Array;
  /** Courbure (1/m, valeur absolue). */
  curv: Float32Array;
  /** Rang, dans la route, du sens de parcours auquel appartient le point. */
  move: Uint8Array;
}

const wrap = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** Courbe de Bézier cubique de A (cap dA) à B (cap dB), points intérieurs seulement, ajoutés à `out`. Pas de demi-tour : voir `Driver.chooseNext`. */
function bezier(ax: number, ay: number, dax: number, day: number, bx: number, by: number, dbx: number, dby: number, out: number[]): void {
  const chord = Math.hypot(bx - ax, by - ay);
  const k = chord * 0.45;
  const steps = Math.max(3, Math.min(14, Math.ceil(chord / 1.2)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    out.push(w0 * ax + w1 * (ax + dax * k) + w2 * (bx - dbx * k) + w3 * bx, w0 * ay + w1 * (ay + day * k) + w2 * (by - dby * k) + w3 * by);
  }
}

/**
 * Adoucit le tracé : chaque point se rapproche de la moyenne de ses voisins, plusieurs fois (le début et la fin restent en place).
 * Les coins serrés de rues courtes, que la voiture ne pourrait pas prendre (rayon de braquage minimal ≈ 3,7 m), s'ouvrent d'un mètre ou deux.
 */
function smoothPath(xs: number[], ys: number[]): void {
  const n = xs.length;
  if (n < 5) return;
  const tx = new Float64Array(n), ty = new Float64Array(n);
  for (let it = 0; it < SMOOTH_PASSES; it++) {
    for (let i = 1; i < n - 1; i++) {
      tx[i] = xs[i]! + 0.5 * ((xs[i - 1]! + xs[i + 1]!) / 2 - xs[i]!);
      ty[i] = ys[i]! + 0.5 * ((ys[i - 1]! + ys[i + 1]!) / 2 - ys[i]!);
    }
    for (let i = 1; i < n - 1; i++) {
      xs[i] = tx[i]!;
      ys[i] = ty[i]!;
    }
  }
}

/** Rayon (m) de dégagement exigé autour du tracé : demi-largeur d'une voiture (≈ 0,9 m) et marge. */
const CLEARANCE = 1.1;
/** Demi-largeur (en points) sur laquelle un écart s'estompe le long du tracé. */
const TAPER = 6;

/**
 * Écarte le tracé des obstacles fixes (murs, bâtiments, troncs, mobilier) : chaque point trop proche est repoussé, puis l'écart
 * s'estompe progressivement de part et d'autre pour que la voiture le prenne en douceur. Les obstacles mobiles (autres voitures,
 * passants) ne sont pas dans `Colliders` : ils relèvent du conducteur à chaque pas.
 */
function clearPath(xs: number[], ys: number[], colliders: Colliders): void {
  const n = xs.length;
  const dx = new Float32Array(n), dy = new Float32Array(n);
  const res: Resolution = { x: 0, y: 0, nx: 0, ny: 0, hit: false };
  let any = false;
  for (let i = 0; i < n; i++) {
    let x = xs[i]!, y = ys[i]!;
    for (let it = 0; it < 3; it++) {
      colliders.resolveInto(res, x, y, CLEARANCE);
      if (!res.hit) break;
      x = res.x;
      y = res.y;
    }
    dx[i] = x - xs[i]!;
    dy[i] = y - ys[i]!;
    if (dx[i] !== 0 || dy[i] !== 0) any = true;
  }
  if (!any) return;
  const ox = new Float32Array(n), oy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let bx = dx[i]!, by = dy[i]!, bm = bx * bx + by * by;
    for (let j = Math.max(0, i - TAPER); j <= Math.min(n - 1, i + TAPER); j++) {
      const w = 1 - Math.abs(i - j) / (TAPER + 1);
      const cx = dx[j]! * w, cy = dy[j]! * w, cm = cx * cx + cy * cy;
      if (cm > bm) {
        bx = cx;
        by = cy;
        bm = cm;
      }
    }
    ox[i] = bx;
    oy[i] = by;
  }
  for (let i = 0; i < n; i++) {
    xs[i] = xs[i]! + ox[i]!;
    ys[i] = ys[i]! + oy[i]!;
  }
}

/**
 * Construit le tracé d'une route. `startS` : abscisse (m) du départ sur la voie du premier sens. `limitOf` : vitesse autorisée (km/h) d'un sens.
 */
export function buildPath(road: RoadGraph, route: readonly RoadMove[], startS: number, limitOf: (m: RoadMove) => number, colliders: Colliders | null = null, spec: VehicleSpec | null = null, endStop = false): Path {
  const lines: number[][] = route.map((m) => {
    const l: number[] = [];
    laneLine(road, m, l);
    return l;
  });
  const lens = lines.map(lineLength);
  // Les raccords arrondis mordent sur la fin de chaque arête et le début de la suivante.
  const cutAt = (i: number): number => Math.max(0.3, Math.min(7, 0.4 * lens[i]!, 0.4 * lens[i + 1]!));
  const pl: number[] = [], pm: number[] = [];
  const pts: number[] = [];
  const push = (x: number, y: number, mv: number, lim: number): void => {
    pts.push(x, y);
    pl.push(lim);
    pm.push(mv);
  };
  let prevDir: [number, number] | null = null;
  for (let i = 0; i < route.length; i++) {
    const from = i === 0 ? Math.min(startS, Math.max(lens[0]! - 0.5, 0)) : cutAt(i - 1);
    const to = i === route.length - 1 ? lens[i]! : lens[i]! - cutAt(i);
    const seg: number[] = [];
    cut(lines[i]!, from, Math.max(to, from), seg);
    if (seg.length < 4) {
      seg.length = 0;
      seg.push(lines[i]![0]!, lines[i]![1]!, lines[i]![2]!, lines[i]![3]!);
    }
    const lim = Math.max(limitOf(route[i]!) / 3.6, SPEED_FLOOR) * SPEED_FACTOR;
    const dx = seg[2]! - seg[0]!, dy = seg[3]! - seg[1]!, dl = Math.hypot(dx, dy) || 1;
    if (prevDir && pts.length >= 2) {
      const ax = pts[pts.length - 2]!, ay = pts[pts.length - 1]!;
      const mid: number[] = [];
      bezier(ax, ay, prevDir[0], prevDir[1], seg[0]!, seg[1]!, dx / dl, dy / dl, mid);
      for (let k = 0; k < mid.length; k += 2) push(mid[k]!, mid[k + 1]!, i - 1, Math.min(lim, pl[pl.length - 1]!));
    }
    for (let k = 0; k < seg.length; k += 2) push(seg[k]!, seg[k + 1]!, i, lim);
    const n = seg.length;
    const ex = seg[n - 2]! - seg[n - 4]!, ey = seg[n - 1]! - seg[n - 3]!, el = Math.hypot(ex, ey) || 1;
    prevDir = [ex / el, ey / el];
  }
  // Rééchantillonnage tous les DS mètres.
  const xs: number[] = [pts[0]!], ys: number[] = [pts[1]!], ms: number[] = [pm[0]!], ls: number[] = [pl[0]!];
  let carry = 0;
  for (let i = 1; i < pts.length / 2; i++) {
    const x0 = pts[i * 2 - 2]!, y0 = pts[i * 2 - 1]!, x1 = pts[i * 2]!, y1 = pts[i * 2 + 1]!, len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    let d = DS - carry;
    while (d <= len) {
      const t = d / len;
      xs.push(x0 + (x1 - x0) * t);
      ys.push(y0 + (y1 - y0) * t);
      ms.push(pm[i]!);
      ls.push(Math.min(pl[i]!, pl[i - 1]!));
      d += DS;
    }
    carry = len - (d - DS);
  }
  if (carry > 0.3) {
    xs.push(pts[pts.length - 2]!);
    ys.push(pts[pts.length - 1]!);
    ms.push(pm[pm.length - 1]!);
    ls.push(pl[pl.length - 1]!);
  }
  const n = xs.length;
  smoothPath(xs, ys);
  if (colliders) clearPath(xs, ys, colliders);
  const x = Float32Array.from(xs), y = Float32Array.from(ys), heading = new Float32Array(n), v = new Float32Array(n), curv = new Float32Array(n), move = Uint8Array.from(ms);
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
    heading[i] = Math.atan2(x[b]! - x[a]!, y[b]! - y[a]!);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 2, 0), b = Math.min(i + 2, n - 1);
    const k = Math.abs(wrap(heading[b]! - heading[a]!)) / Math.max((b - a) * DS, DS);
    curv[i] = k;
    v[i] = Math.min(ls[i]!, Math.sqrt(A_LAT / Math.max(k, 1e-3)), spec ? cornerSpeed(spec, k) : Infinity);
  }
  // Là où la coque de la voiture toucherait un obstacle fixe même sur le tracé écarté, la voie est fermée : on s'arrête avant.
  if (colliders && spec) {
    const res: Resolution = { x: 0, y: 0, nx: 0, ny: 0, hit: false };
    for (let i = 0; i < n; i++) {
      const sx = Math.sin(heading[i]!), sy = Math.cos(heading[i]!);
      for (const [off, r] of spec.hull) {
        if (colliders.resolveInto(res, x[i]! + sx * off, y[i]! + sy * off, r).hit) {
          v[i] = 0;
          break;
        }
      }
    }
  }
  // Route sans suite (impasse, bord du monde) : on s'arrête avant le bout (la voiture dépasse son centre de 2 m).
  if (endStop) {
    const stop = Math.max(1, n - 3);
    for (let i = stop; i < n; i++) v[i] = 0;
  }
  // Freinage anticipé : on doit pouvoir ralentir à A_DEC pour atteindre chaque vitesse plus loin.
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i]!, Math.sqrt(v[i + 1]! * v[i + 1]! + 2 * A_DEC * DS));
  return { n, x, y, heading, v, curv, move };
}

/** Vitesse maximale (m/s) à laquelle la voiture peut tenir une courbure `k` (1/m) en n'utilisant que `STEER_USE` de son braquage : le braquage permis baisse avec la vitesse. */
export function cornerSpeed(spec: VehicleSpec, k: number): number {
  const L = spec.front + spec.rear;
  let best = 1.5;
  for (let v = 1.5; v <= 40; v += 0.5) {
    if ((STEER_USE * Math.tan(steerLimit(spec, v))) / L >= k) best = v;
    else break;
  }
  return best;
}

/** Petit générateur pseudo-aléatoire reproductible (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Driver {
  /** Route suivie : sens de parcours du graphe routier ; le premier est celui où l'on roule. */
  readonly route: RoadMove[] = [];
  path: Path | null = null;
  /** Rang du point du tracé le plus proche de la voiture. */
  index = 0;
  /** Perdu (sorti de la route, route disparue du graphe) ou bloqué : l'appelant le fait disparaître. */
  lost = false;
  /** Pourquoi il est perdu (diagnostic). */
  lostWhy = "";
  /** La route n'a plus de suite (impasse, bord du monde) : le conducteur s'arrête au bout. */
  ended = false;
  private stuckFor = 0;
  private idleFor = 0;
  private readonly random: () => number;
  private readonly gens: number[] = [];
  private startS: number;

  constructor(private readonly nav: NavGraph, start: RoadMove, startS: number, seed: number, private readonly spec: VehicleSpec, private readonly colliders: Colliders | null = null) {
    this.route.push(start);
    this.startS = startS;
    this.random = rng(seed);
  }

  private get road(): RoadGraph {
    return this.nav.road;
  }

  /** Les suites du dernier sens de la route, pondérées : tout droit et rues normales d'abord, impasses courtes et voies de service peu. */
  private chooseNext(last: RoadMove): RoadMove | null {
    const road = this.road;
    const out: RoadMove[] = [];
    road.next(last, out);
    // Impasse : pas de demi-tour (une voiture ne tourne pas dans 3,5 m sans manœuvrer) ; la route s'arrête là.
    if (out.length === 0) return null;
    if (out.length === 1) return out[0]!;
    const heading = (m: RoadMove, atEnd: boolean): number => {
      const l: number[] = [];
      laneLine(road, m, l);
      const n = l.length;
      return atEnd ? Math.atan2(l[n - 2]! - l[n - 4]!, l[n - 1]! - l[n - 3]!) : Math.atan2(l[2]! - l[0]!, l[3]! - l[1]!);
    };
    const h0 = heading(last, true);
    const weights = out.map((m) => {
      const turn = Math.abs(wrap(heading(m, false) - h0));
      let w = turn < 0.5 ? 3 : turn < 1.75 ? 1 : 0.25;
      const e = moveEdge(m);
      if (road.edgeClass(e) === 6) w *= 0.3;
      if (road.arms(road.arrivalNode(m)) === 1) w *= 0.05;
      // Une suite d'où l'on ne pourrait plus repartir (impasse, sens unique sans issue, bord du monde) n'est choisie qu'en dernier recours.
      const onward: RoadMove[] = [];
      if (road.next(m, onward) === 0) w *= 0.001;
      return w;
    });
    let total = 0;
    for (const w of weights) total += w;
    let r = this.random() * total;
    for (let i = 0; i < out.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return out[i]!;
    }
    return out[out.length - 1]!;
  }

  private limitOf = (m: RoadMove): number => this.road.edgeSpeed(moveEdge(m));

  private extend(rank: number): void {
    let ahead = 0;
    // Toujours deux arêtes devant celle où roule la voiture (rang `rank` ; une arête peut dépasser 400 m), puis assez pour AHEAD m.
    for (let i = rank + 1; i < this.route.length; i++) ahead += this.road.edgeLength(moveEdge(this.route[i]!));
    while ((this.route.length < rank + 3 || ahead < AHEAD) && this.route.length < MAX_MOVES) {
      const next = this.chooseNext(this.route[this.route.length - 1]!);
      if (next === null) {
        this.ended = true;
        break;
      }
      this.route.push(next);
      ahead += this.road.edgeLength(moveEdge(next));
    }
  }

  /** Abscisse (m) du début du tracé sur sa première arête. */
  private pathStart = 0;

  /** Refait le tracé : `startS` abscisse de départ sur la première arête (null : celle du tracé actuel). */
  private rebuild(startS: number | null, rank: number): void {
    if (startS !== null) this.pathStart = startS;
    this.extend(rank);
    this.gens.length = 0;
    for (const m of this.route) this.gens.push(this.nav.generation(moveEdge(m)));
    this.path = buildPath(this.road, this.route, this.pathStart, this.limitOf, this.colliders, this.spec, this.ended);
  }

  private valid(): boolean {
    for (let i = 0; i < this.route.length; i++) if (this.gens[i] === 0 || this.nav.generation(moveEdge(this.route[i]!)) !== this.gens[i]) return false;
    return true;
  }

  /** Commandes pour ce pas : à appeler avant `stepVehicle`. */
  update(s: VehicleState, dt: number): DriveInput {
    const spec = this.spec;
    const idle: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };
    if (this.lost) return idle;
    if (!this.path) {
      this.rebuild(this.startS, 0);
      this.index = 0;
    } else if (!this.valid()) {
      this.lost = true;
      this.lostWhy = "route disparue du graphe";
      return idle;
    }
    let path = this.path!;
    // Point du tracé le plus proche. Il ne peut avancer que de ce que la voiture a parcouru depuis le dernier pas (plus une marge) :
    // la fin d'un demi-tour, qui revient près de son début, ne passe ainsi jamais pour l'endroit où l'on est.
    const search = (from: number, to: number, maxTurn: number): { i: number; d: number } => {
      let best = -1, bd = Infinity;
      for (let i = Math.max(from, 0); i <= Math.min(to, path.n - 1); i++) {
        if (s.speed > 0.5 && Math.abs(wrap(path.heading[i]! - s.heading)) > maxTurn) continue;
        const d = Math.hypot(path.x[i]! - s.x, path.y[i]! - s.y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best < 0 ? { i: Math.min(Math.max(from, 0), path.n - 1), d: Infinity } : { i: best, d: bd };
    };
    let hit = search(this.index - 1, this.index + 4 + Math.ceil((Math.abs(s.speed) * dt * 2) / DS), 4);
    // Passage à l'arête suivante : une fois la voiture bien dans la deuxième, on retire de la route celles qui sont derrière
    // (en gardant la dernière : le raccord arrondi qui vient d'être pris reste dans le tracé), on prolonge et on refait le tracé.
    const rank = path.move[hit.i]!;
    // Elle est aussi prolongée quand il reste moins de 100 m de tracé (arêtes de 2 m qui ne reçoivent aucun point), sans changer son début.
    const grow = rank < 2 && !this.ended && (path.n - hit.i) * DS < 100 && this.route.length < MAX_MOVES;
    if (rank >= 2 || grow) {
      // Le nouveau tracé contient les mêmes voies : on retrouve le point où l'on était par sa position et son cap (pas par la voiture,
      // qui peut être au milieu d'un demi-tour où deux branches du tracé passent à quelques mètres l'une de l'autre).
      const px = path.x[hit.i]!, py = path.y[hit.i]!, ph = path.heading[hit.i]!;
      const drop = Math.max(rank - 1, 0);
      this.route.splice(0, drop);
      // Si l'on a retiré des arêtes, le tracé repart 30 m avant la fin de la nouvelle première (la voiture est déjà plus loin).
      this.rebuild(drop > 0 ? Math.max(0, this.road.edgeLength(moveEdge(this.route[0]!)) - 30) : null, drop > 0 ? 1 : rank);
      path = this.path!;
      let best = 0, bd = Infinity;
      for (let i = 0; i < path.n; i++) {
        if (Math.abs(wrap(path.heading[i]! - ph)) > 0.6) continue;
        const d = Math.hypot(path.x[i]! - px, path.y[i]! - py);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      hit = { i: best, d: Math.hypot(path.x[best]! - s.x, path.y[best]! - s.y) };
    }
    this.index = hit.i;
    if (hit.d > LOST_DISTANCE || (path.n - this.index < 4 && !this.ended)) {
      this.lost = true;
      this.lostWhy = hit.d > LOST_DISTANCE ? `écart au tracé ${hit.d.toFixed(1)} m` : "fin de route";
      return idle;
    }
    // Direction : poursuite d'un point devant la voiture.
    const u = Math.max(s.speed, 0);
    // Distance de visée : longue en ligne droite (stable), courte dans un virage, où viser loin ferait couper à l'intérieur (écart ≈ Ld² k / 8).
    let k = 0;
    for (let j = this.index; j <= Math.min(path.n - 1, this.index + 6); j++) k = Math.max(k, path.curv[j]!);
    const Ld = Math.min(Math.max(Math.min(3 + 0.7 * u, Math.sqrt(1.4 / Math.max(k, 0.01))), 2.5), 16);
    const target = Math.min(path.n - 1, this.index + Math.round(Ld / DS));
    const dx = path.x[target]! - s.x, dy = path.y[target]! - s.y;
    const alpha = wrap(Math.atan2(dx, dy) - s.heading);
    // Poursuite de point, plus un rappel vers le tracé proportionnel à l'écart latéral (positif quand le tracé est à droite de la voiture).
    const lateral = (path.x[this.index]! - s.x) * Math.cos(s.heading) - (path.y[this.index]! - s.y) * Math.sin(s.heading);
    const delta = Math.atan2(2 * (spec.front + spec.rear) * Math.sin(alpha), Math.max(Math.hypot(dx, dy), 1)) + Math.atan(CROSS_GAIN * lateral / (u + 1.5));
    const limit = steerLimit(spec, u);
    const steer = Math.min(Math.max(delta / limit, -1), 1);
    // Vitesse : celle que le tracé conseille un peu plus loin (le profil anticipe déjà les freinages).
    let vt = Infinity;
    for (let j = this.index; j <= Math.min(path.n - 1, this.index + 1 + Math.round((u * 0.5) / DS)); j++) vt = Math.min(vt, path.v[j]!);
    const aDes = Math.min(Math.max(1.2 * (vt - u), -3.5), A_ACC);
    let throttle = 0, brake = 0, handbrake = 0;
    const resist = spec.drag * u * u + spec.rolling * spec.mass * GRAVITY + (u > 0.3 ? spec.engineBrake : 0);
    if (aDes >= 0) throttle = Math.min(Math.max((aDes * spec.mass + resist) / Math.max(driveForce(spec, u, 1), 1), 0), 1);
    else if (u < 0.5) handbrake = 1;
    else if (aDes * spec.mass + resist < -0.05 * spec.maxBrake) brake = Math.min(Math.max((-aDes * spec.mass - resist) / spec.maxBrake, 0), 1);
    // Bloqué : à l'arrêt alors que la route est libre.
    this.stuckFor = Math.abs(s.speed) < 0.3 && vt > 1 ? this.stuckFor + dt : 0;
    if (this.stuckFor > STUCK_TIME) {
      this.lost = true;
      this.lostWhy = "bloqué à l'arrêt";
    }
    // Arrivé au bout d'une route sans suite : il attend un moment puis disparaît (l'appelant le retire).
    this.idleFor = this.ended && Math.abs(s.speed) < 0.3 && path.n - this.index < 8 ? this.idleFor + dt : 0;
    if (this.idleFor > 5) {
      this.lost = true;
      this.lostWhy = "au bout de la route";
    }
    return { throttle, brake, steer, handbrake };
  }
}
