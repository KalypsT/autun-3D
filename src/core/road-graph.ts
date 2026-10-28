import { ROAD_FLAG, type NavCell, type RoadLayer } from "../data/nav";

/**
 * Graphe routier des super-tuiles chargées (J3-0, D58), raccordées par leurs portails comme le graphe piéton (`nav-graph.ts`).
 * Il partage avec lui les emplacements de super-tuiles : une arête ou un nœud est un nombre `emplacement × 65 536 + indice local`.
 * Une arête routière est un axe non orienté entre deux nœuds ; un sens de parcours (`Move`) est `arête × 2 + (0 : de a vers b, 1 : de b vers a)`.
 * Analogie : le plan des rues d'un jeu de société, où les sens uniques sont des flèches sur les cases et les portails des cartes qui se touchent.
 */

const SHIFT = 65536;
const GRID = 32;

/** Une arête parcourue dans un sens : `numéro d'arête × 2 + (0 : de a vers b, 1 : de b vers a)`. */
export type RoadMove = number;

export const moveEdge = (m: RoadMove): number => Math.floor(m / 2);
export const moveDir = (m: RoadMove): 0 | 1 => (m & 1) as 0 | 1;
export const reverseMove = (m: RoadMove): RoadMove => m ^ 1;

/** Panneaux d'approche (`RoadLayer.signKind`) : 1 stop, 2 cédez-le-passage, 3 feux ; +8 quand OpenStreetMap ne donne pas la direction. */
export const SIGN = { stop: 1, giveWay: 2, signal: 3, unknownDirection: 8 } as const;

export interface RoadHit {
  /** Arête (référence globale), abscisse (m depuis son nœud a), distance au point demandé (m) et point le plus proche. */
  edge: number;
  s: number;
  dist: number;
  x: number;
  y: number;
}

interface Loaded {
  slot: number;
  cell: NavCell;
  r: RoadLayer;
  /** Grille de 32 m (format CSR) des arêtes dont l'emprise touche chaque case. */
  gridStart: Uint32Array;
  grid: Uint16Array;
  cols: number;
  rows: number;
  /** Panneau d'approche par `arête locale × 2 + extrémité d'arrivée` (0 : nœud a, 1 : nœud b). */
  signs: Map<number, number>;
}

export class RoadGraph {
  private slots: (Loaded | undefined)[] = [];
  /** Clé de coordonnées d'un portail → ses nœuds (un par super-tuile qui le porte). */
  private readonly portals = new Map<string, number[]>();

  /** Ajoute la couche routière d'une super-tuile à l'emplacement `slot` (celui du graphe piéton). */
  add(slot: number, cell: NavCell): void {
    const r = cell.road;
    const l = this.index(slot, cell);
    this.slots[slot] = l;
    for (const [key, node] of r.portals) {
      const ref = slot * SHIFT + node;
      const list = this.portals.get(key);
      if (list) list.push(ref);
      else this.portals.set(key, [ref]);
    }
  }

  remove(slot: number): void {
    const l = this.slots[slot];
    if (!l) return;
    for (const key of l.r.portals.keys()) {
      const list = this.portals.get(key);
      if (!list) continue;
      const i = list.findIndex((ref) => Math.floor(ref / SHIFT) === slot);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) this.portals.delete(key);
    }
    this.slots[slot] = undefined;
  }

  /** Nombre de clés de portail suivies (doit retomber à 0 quand tout est retiré). */
  get portalCount(): number {
    return this.portals.size;
  }

  get edgeCount(): number {
    let n = 0;
    for (const l of this.slots) if (l) n += l.r.edges;
    return n;
  }

  private index(slot: number, cell: NavCell): Loaded {
    const r = cell.road;
    const [x0, y0, x1, y1] = cell.bounds;
    const cols = Math.ceil((x1 - x0) / GRID), rows = Math.ceil((y1 - y0) / GRID);
    const counts = new Uint32Array(cols * rows + 1);
    const ranges: number[] = [];
    for (let e = 0; e < r.edges; e++) {
      let lx = Math.min(r.nodeX[r.a[e]!]!, r.nodeX[r.b[e]!]!), hx = Math.max(r.nodeX[r.a[e]!]!, r.nodeX[r.b[e]!]!);
      let ly = Math.min(r.nodeY[r.a[e]!]!, r.nodeY[r.b[e]!]!), hy = Math.max(r.nodeY[r.a[e]!]!, r.nodeY[r.b[e]!]!);
      for (let k = 0; k < r.np[e]!; k++) {
        const x = r.geom[(r.p0[e]! + k) * 2]!, y = r.geom[(r.p0[e]! + k) * 2 + 1]!;
        lx = Math.min(lx, x); hx = Math.max(hx, x); ly = Math.min(ly, y); hy = Math.max(hy, y);
      }
      const c0 = Math.max(0, Math.floor((lx - x0) / GRID)), r0 = Math.max(0, Math.floor((ly - y0) / GRID));
      const c1 = Math.min(cols - 1, Math.floor((hx - x0) / GRID)), r1 = Math.min(rows - 1, Math.floor((hy - y0) / GRID));
      ranges.push(c0, r0, c1, r1);
      for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) counts[j * cols + i + 1]!++;
    }
    for (let i = 0; i < cols * rows; i++) counts[i + 1]! += counts[i]!;
    const fill = counts.slice(0, cols * rows);
    const grid = new Uint16Array(counts[cols * rows]!);
    for (let e = 0; e < r.edges; e++) {
      for (let j = ranges[e * 4 + 1]!; j <= ranges[e * 4 + 3]!; j++) for (let i = ranges[e * 4]!; i <= ranges[e * 4 + 2]!; i++) grid[fill[j * cols + i]!++] = e;
    }
    const signs = new Map<number, number>();
    for (let i = 0; i < r.signNode.length; i++) {
      const e = r.signEdge[i]!, n = r.signNode[i]!;
      if (e >= r.edges) continue;
      if (r.b[e] === n) signs.set(e * 2 + 1, r.signKind[i]!);
      if (r.a[e] === n) signs.set(e * 2, r.signKind[i]!);
    }
    return { slot, cell, r, gridStart: counts, grid, cols, rows, signs };
  }

  // --- Accès ---------------------------------------------------------------------------------------------------------

  private layer(ref: number): RoadLayer {
    return this.slots[Math.floor(ref / SHIFT)]!.r;
  }

  edgeA(e: number): number { return Math.floor(e / SHIFT) * SHIFT + this.layer(e).a[e % SHIFT]!; }
  edgeB(e: number): number { return Math.floor(e / SHIFT) * SHIFT + this.layer(e).b[e % SHIFT]!; }
  edgeNode(e: number, end: 0 | 1): number { return end === 0 ? this.edgeA(e) : this.edgeB(e); }
  /** Classe : 0 primary, 1 secondary, 2 tertiary, 3 unclassified, 4 residential, 5 living_street, 6 service, 7 road. */
  edgeClass(e: number): number { return this.layer(e).cls[e % SHIFT]!; }
  edgeFlags(e: number): number { return this.layer(e).flags[e % SHIFT]!; }
  edgeLanes(e: number): number { return this.layer(e).lanes[e % SHIFT]!; }
  /** Vitesse autorisée (km/h). */
  edgeSpeed(e: number): number { return this.layer(e).speed[e % SHIFT]!; }
  /** Largeur de la chaussée (m). */
  edgeWidth(e: number): number { return this.layer(e).width[e % SHIFT]!; }
  edgeLength(e: number): number { return this.layer(e).length[e % SHIFT]!; }
  /** Identifiant de la voie OpenStreetMap (celui que porte `ref` des passages piétons). */
  edgeWay(e: number): number { return Math.floor(this.layer(e).gid[e % SHIFT]! / 64); }
  nodeX(n: number): number { return this.layer(n).nodeX[n % SHIFT]!; }
  nodeY(n: number): number { return this.layer(n).nodeY[n % SHIFT]!; }
  nodeFlags(n: number): number { return this.layer(n).nodeFlags[n % SHIFT]!; }

  /** Les arêtes de la super-tuile à l'emplacement `slot`, en références globales. */
  edgesOfSlot(slot: number): number[] {
    const l = this.slots[slot];
    return l ? Array.from({ length: l.r.edges }, (_, i) => slot * SHIFT + i) : [];
  }

  /** 0 : à double sens, 1 : sens unique de a vers b, 2 : sens unique de b vers a. */
  oneway(e: number): 0 | 1 | 2 {
    const f = this.edgeFlags(e);
    return f & ROAD_FLAG.onewayForward ? 1 : f & ROAD_FLAG.onewayBack ? 2 : 0;
  }

  /** Une voiture de la circulation peut-elle rouler sur cette arête (ni allée de parking, ni voie réservée aux bus) ? */
  drivable(e: number): boolean {
    return !(this.edgeFlags(e) & (ROAD_FLAG.aisle | ROAD_FLAG.bus));
  }

  /** Le sens `m` est-il permis (arête carrossable, sens unique respecté) ? */
  canGo(m: RoadMove): boolean {
    const e = moveEdge(m);
    if (!this.drivable(e)) return false;
    const o = this.oneway(e);
    return o === 0 || o === 1 + moveDir(m);
  }

  /** Nœud où l'on arrive en parcourant `m`, et celui d'où l'on part. */
  arrivalNode(m: RoadMove): number { return this.edgeNode(moveEdge(m), moveDir(m) === 0 ? 1 : 0); }
  departureNode(m: RoadMove): number { return this.edgeNode(moveEdge(m), moveDir(m) === 0 ? 0 : 1); }

  /** Panneau d'approche à l'arrivée du sens `m` (`SIGN`, éventuellement + `unknownDirection`), ou 0. */
  signAt(m: RoadMove): number {
    const slot = Math.floor(moveEdge(m) / SHIFT);
    return this.slots[slot]!.signs.get((moveEdge(m) % SHIFT) * 2 + (moveDir(m) === 0 ? 1 : 0)) ?? 0;
  }

  /** Nœuds équivalents au nœud `n` (lui-même, et ses jumeaux de l'autre côté d'une frontière de super-tuile). */
  private twins(n: number): number[] {
    const r = this.layer(n);
    if (!(r.nodeFlags[n % SHIFT]! & 1)) return [n];
    return this.portals.get(r.portalKey.get(n % SHIFT) ?? "") ?? [n];
  }

  /**
   * Suites permises en arrivant par le sens `m` : ajoute à `out` les sens carrossables qui partent du nœud d'arrivée (et de ses jumeaux),
   * sans demi-tour (une boucle se reprend dans le même sens). Passe les frontières de super-tuile. Renvoie le nombre ajouté.
   * `wrongWay` : les sens uniques sont ignorés (la police en poursuite, J4).
   */
  next(m: RoadMove, out: RoadMove[], wrongWay = false): number {
    const ok = (ref: RoadMove): boolean => (wrongWay ? this.drivable(moveEdge(ref)) : this.canGo(ref));
    const before = out.length;
    const e = moveEdge(m);
    for (const t of this.twins(this.arrivalNode(m))) {
      const slot = Math.floor(t / SHIFT), local = t % SHIFT;
      const r = this.slots[slot]!.r;
      for (let k = r.adjStart[local]!; k < r.adjStart[local + 1]!; k++) {
        const ei = r.adj[k]!;
        const ref = slot * SHIFT + ei;
        const same = ref === e;
        if (same && r.a[ei] !== r.b[ei]) continue;
        // Une arête en boucle (ses deux bouts sont le même nœud) peut se reprendre, mais seulement dans le même sens : l'autre serait un demi-tour.
        // Elle figure deux fois dans la liste : on ne la compte qu'une fois par extrémité.
        if (r.a[ei] === local && ok(ref * 2) && (!same || moveDir(m) === 0)) out.push(ref * 2);
        if (r.b[ei] === local && ok(ref * 2 + 1) && (!same || moveDir(m) === 1)) out.push(ref * 2 + 1);
      }
    }
    return out.length - before;
  }

  /** Nombre d'arêtes carrossables qui se rejoignent au nœud `n` (jumeaux compris) : 1 = impasse, 3 et plus = carrefour. */
  arms(n: number): number {
    let count = 0;
    for (const t of this.twins(n)) {
      const slot = Math.floor(t / SHIFT), local = t % SHIFT;
      const r = this.slots[slot]!.r;
      for (let k = r.adjStart[local]!; k < r.adjStart[local + 1]!; k++) if (this.drivable(slot * SHIFT + r.adj[k]!)) count++;
    }
    return count;
  }

  /** Arêtes carrossables qui touchent le nœud `n` (jumeaux compris), en références globales, ajoutées à `out`. */
  edgesAt(n: number, out: number[]): number {
    const before = out.length;
    for (const t of this.twins(n)) {
      const slot = Math.floor(t / SHIFT), local = t % SHIFT;
      const r = this.slots[slot]!.r;
      for (let k = r.adjStart[local]!; k < r.adjStart[local + 1]!; k++) if (this.drivable(slot * SHIFT + r.adj[k]!)) out.push(slot * SHIFT + r.adj[k]!);
    }
    return out.length - before;
  }

  /**
   * Point de l'arête à l'abscisse `s` (m depuis son nœud a, borné) : écrit x, y dans `out` et renvoie le cap (rad, 0 = nord, sens horaire)
   * dans le sens a → b.
   */
  pointAt(e: number, s: number, out: { x: number; y: number }): number {
    const slot = Math.floor(e / SHIFT), i = e % SHIFT;
    const r = this.slots[slot]!.r;
    const at = r.cumAt[i]!, np = r.np[i]!;
    s = Math.min(Math.max(s, 0), r.length[i]!);
    let k = 0;
    while (k < np && r.cum[at + k]! < s) k++;
    const start = k === 0 ? 0 : r.cum[at + k - 1]!;
    const x0 = k === 0 ? r.nodeX[r.a[i]!]! : r.geom[(r.p0[i]! + k - 1) * 2]!, y0 = k === 0 ? r.nodeY[r.a[i]!]! : r.geom[(r.p0[i]! + k - 1) * 2 + 1]!;
    const x1 = k < np ? r.geom[(r.p0[i]! + k) * 2]! : r.nodeX[r.b[i]!]!, y1 = k < np ? r.geom[(r.p0[i]! + k) * 2 + 1]! : r.nodeY[r.b[i]!]!;
    const len = r.cum[at + k]! - start;
    const t = len > 1e-6 ? (s - start) / len : 0;
    out.x = x0 + (x1 - x0) * t;
    out.y = y0 + (y1 - y0) * t;
    return Math.atan2(x1 - x0, y1 - y0);
  }

  /** Les sommets de l'arête (nœud a, sommets intérieurs, nœud b) dans `out` à plat ; renvoie le nombre de points. */
  polyline(e: number, out: number[]): number {
    const r = this.layer(e);
    const i = e % SHIFT;
    out.length = 0;
    out.push(r.nodeX[r.a[i]!]!, r.nodeY[r.a[i]!]!);
    for (let k = 0; k < r.np[i]!; k++) out.push(r.geom[(r.p0[i]! + k) * 2]!, r.geom[(r.p0[i]! + k) * 2 + 1]!);
    out.push(r.nodeX[r.b[i]!]!, r.nodeY[r.b[i]!]!);
    return r.np[i]! + 2;
  }

  /** Arête carrossable la plus proche de (x, y) à moins de `maxDist`, ou null. */
  nearest(x: number, y: number, maxDist: number): RoadHit | null {
    let best: RoadHit | null = null;
    const seen = new Set<number>();
    for (const l of this.slots) {
      if (!l) continue;
      const [x0, y0, x1, y1] = l.cell.bounds;
      if (x < x0 - maxDist || x > x1 + maxDist || y < y0 - maxDist || y > y1 + maxDist) continue;
      const c0 = Math.max(0, Math.floor((x - maxDist - x0) / GRID)), c1 = Math.min(l.cols - 1, Math.floor((x + maxDist - x0) / GRID));
      const r0 = Math.max(0, Math.floor((y - maxDist - y0) / GRID)), r1 = Math.min(l.rows - 1, Math.floor((y + maxDist - y0) / GRID));
      for (let j = r0; j <= r1; j++) {
        for (let c = c0; c <= c1; c++) {
          for (let k = l.gridStart[j * l.cols + c]!; k < l.gridStart[j * l.cols + c + 1]!; k++) {
            const i = l.grid[k]!;
            const ref = l.slot * SHIFT + i;
            if (seen.has(ref) || !this.drivable(ref)) continue;
            seen.add(ref);
            const h = this.closest(l.r, i, x, y);
            if (h.dist <= maxDist && (!best || h.dist < best.dist)) best = { edge: ref, s: h.s, dist: h.dist, x: h.x, y: h.y };
          }
        }
      }
    }
    return best;
  }

  private closest(r: RoadLayer, i: number, x: number, y: number): { s: number; dist: number; x: number; y: number } {
    const at = r.cumAt[i]!, np = r.np[i]!;
    let px = r.nodeX[r.a[i]!]!, py = r.nodeY[r.a[i]!]!;
    let best = { s: 0, dist: Infinity, x: px, y: py };
    for (let k = 0; k <= np; k++) {
      const qx = k < np ? r.geom[(r.p0[i]! + k) * 2]! : r.nodeX[r.b[i]!]!, qy = k < np ? r.geom[(r.p0[i]! + k) * 2 + 1]! : r.nodeY[r.b[i]!]!;
      const dx = qx - px, dy = qy - py, len2 = dx * dx + dy * dy;
      const t = len2 > 1e-12 ? Math.min(Math.max(((x - px) * dx + (y - py) * dy) / len2, 0), 1) : 0;
      const cx = px + dx * t, cy = py + dy * t, d = Math.hypot(x - cx, y - cy);
      if (d < best.dist) best = { s: (k === 0 ? 0 : r.cum[at + k - 1]!) + Math.sqrt(len2) * t, dist: d, x: cx, y: cy };
      px = qx;
      py = qy;
    }
    return best;
  }
}
