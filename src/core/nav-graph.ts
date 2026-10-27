import type { NavCell, PedLayer } from "../data/nav";

/**
 * Graphe piéton des super-tuiles chargées, raccordées entre elles par leurs portails (nœuds de même coordonnées de chaque côté d'une frontière).
 * Analogie : des morceaux de plan de métro qu'on pose côte à côte ; deux gares portant le même nom et la même position sont la même gare.
 *
 * Une arête ou un nœud est désigné par un nombre `emplacement × 65 536 + indice local` : sans allocation, stable tant que la super-tuile est chargée.
 * Un morceau retiré ne laisse aucune trace (emplacements recyclés, portails oubliés), pour rouler longtemps sans que la mémoire grossisse.
 */

const SHIFT = 65536;

/** Une arête parcourue dans un sens : `numéro d'arête × 2 + (0 : de a vers b, 1 : de b vers a)`. */
export type Move = number;

export interface NavHit {
  /** Arête (référence globale), abscisse (m, depuis son nœud a), distance du point demandé (m) et point le plus proche. */
  edge: number;
  s: number;
  dist: number;
  x: number;
  y: number;
}

interface Loaded {
  slot: number;
  cell: NavCell;
  /** Grille de 32 m : arêtes dont l'emprise touche chaque case (format CSR sur les cases d'une grille dense couvrant la super-tuile). */
  gridStart: Uint32Array;
  grid: Uint16Array;
  gx: number;
  gy: number;
  cols: number;
  rows: number;
}

const GRID = 32;

export class NavGraph {
  readonly cells = new Map<string, Loaded>();
  private slots: (Loaded | undefined)[] = [];
  private free: number[] = [];
  /** Clé de coordonnées d'un portail → ses nœuds (un par super-tuile qui le porte). */
  private readonly portals = new Map<string, number[]>();
  /** Incrémenté à chaque ajout ou retrait : les caches qui dépendent du graphe (recouvrement) s'en servent. */
  version = 0;

  has(id: string): boolean {
    return this.cells.has(id);
  }

  get edgeCount(): number {
    let n = 0;
    for (const l of this.cells.values()) n += l.cell.ped.edges;
    return n;
  }

  add(cell: NavCell): void {
    this.remove(cell.id);
    const slot = this.free.pop() ?? this.slots.length;
    if (slot >= 30000) throw new Error("navigation : trop de super-tuiles chargées");
    const l = this.index(slot, cell);
    this.slots[slot] = l;
    this.cells.set(cell.id, l);
    for (const [key, node] of cell.ped.portals) {
      const ref = slot * SHIFT + node;
      const list = this.portals.get(key);
      if (list) list.push(ref);
      else this.portals.set(key, [ref]);
    }
    this.version++;
  }

  remove(id: string): boolean {
    const l = this.cells.get(id);
    if (!l) return false;
    for (const key of l.cell.ped.portals.keys()) {
      const list = this.portals.get(key)!;
      const i = list.findIndex((r) => Math.floor(r / SHIFT) === l.slot);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) this.portals.delete(key);
    }
    this.slots[l.slot] = undefined;
    this.free.push(l.slot);
    this.cells.delete(id);
    this.version++;
    return true;
  }

  /** Nombre de clés de portail suivies (doit retomber à 0 quand tout est retiré). */
  get portalCount(): number {
    return this.portals.size;
  }

  private index(slot: number, cell: NavCell): Loaded {
    const p = cell.ped;
    const [x0, y0, x1, y1] = cell.bounds;
    const cols = Math.ceil((x1 - x0) / GRID), rows = Math.ceil((y1 - y0) / GRID);
    const counts = new Uint32Array(cols * rows + 1);
    const box = (e: number): [number, number, number, number] => {
      let lx = Math.min(p.nodeX[p.a[e]!]!, p.nodeX[p.b[e]!]!), hx = Math.max(p.nodeX[p.a[e]!]!, p.nodeX[p.b[e]!]!);
      let ly = Math.min(p.nodeY[p.a[e]!]!, p.nodeY[p.b[e]!]!), hy = Math.max(p.nodeY[p.a[e]!]!, p.nodeY[p.b[e]!]!);
      for (let k = 0; k < p.np[e]!; k++) {
        const x = p.geom[(p.p0[e]! + k) * 2]!, y = p.geom[(p.p0[e]! + k) * 2 + 1]!;
        lx = Math.min(lx, x); hx = Math.max(hx, x); ly = Math.min(ly, y); hy = Math.max(hy, y);
      }
      return [lx, ly, hx, hy];
    };
    const range = (b: [number, number, number, number]): [number, number, number, number] => [
      Math.max(0, Math.floor((b[0] - x0) / GRID)), Math.max(0, Math.floor((b[1] - y0) / GRID)),
      Math.min(cols - 1, Math.floor((b[2] - x0) / GRID)), Math.min(rows - 1, Math.floor((b[3] - y0) / GRID)),
    ];
    const boxes: [number, number, number, number][] = [];
    for (let e = 0; e < p.edges; e++) {
      const r = range(box(e));
      boxes.push(r);
      for (let j = r[1]; j <= r[3]; j++) for (let i = r[0]; i <= r[2]; i++) counts[j * cols + i + 1]!++;
    }
    for (let i = 0; i < cols * rows; i++) counts[i + 1]! += counts[i]!;
    const fill = counts.slice(0, cols * rows);
    const grid = new Uint16Array(counts[cols * rows]!);
    for (let e = 0; e < p.edges; e++) {
      const r = boxes[e]!;
      for (let j = r[1]; j <= r[3]; j++) for (let i = r[0]; i <= r[2]; i++) grid[fill[j * cols + i]!++] = e;
    }
    return { slot, cell, gridStart: counts, grid, gx: x0, gy: y0, cols, rows };
  }

  // --- Accès ---------------------------------------------------------------------------------------------------------

  private layer(ref: number): PedLayer {
    return this.slots[Math.floor(ref / SHIFT)]!.cell.ped;
  }

  edgeA(e: number): number { return Math.floor(e / SHIFT) * SHIFT + this.layer(e).a[e % SHIFT]!; }
  edgeB(e: number): number { return Math.floor(e / SHIFT) * SHIFT + this.layer(e).b[e % SHIFT]!; }
  /** Nœud au début (0) ou à la fin (1) de l'arête. */
  edgeNode(e: number, end: 0 | 1): number { return end === 0 ? this.edgeA(e) : this.edgeB(e); }
  edgeType(e: number): number { return this.layer(e).type[e % SHIFT]!; }
  edgeFlags(e: number): number { return this.layer(e).flags[e % SHIFT]!; }
  edgeWidth(e: number): number { return this.layer(e).width[e % SHIFT]!; }
  edgeFoot(e: number): number { return this.layer(e).foot[e % SHIFT]!; }
  edgeZone(e: number): number { return this.layer(e).zone[e % SHIFT]!; }
  edgeLength(e: number): number { return this.layer(e).length[e % SHIFT]!; }
  /** Identifiant de la voie OpenStreetMap (pour un passage : la voie traversée). */
  edgeWay(e: number): number { return this.layer(e).ref[e % SHIFT]!; }
  nodeX(n: number): number { return this.layer(n).nodeX[n % SHIFT]!; }
  nodeY(n: number): number { return this.layer(n).nodeY[n % SHIFT]!; }
  nodeFlags(n: number): number { return this.layer(n).nodeFlags[n % SHIFT]!; }

  /** Les arêtes de la super-tuile `id`, en références globales. */
  edgesOf(id: string): number[] {
    const l = this.cells.get(id);
    if (!l) return [];
    return Array.from({ length: l.cell.ped.edges }, (_, i) => l.slot * SHIFT + i);
  }

  /**
   * Point de l'arête à l'abscisse `s` (m depuis son nœud a, borné) : écrit x, y dans `out` et renvoie le cap de marche (rad, 0 = nord, sens horaire)
   * dans le sens a → b.
   */
  pointAt(e: number, s: number, out: { x: number; y: number }): number {
    const slot = Math.floor(e / SHIFT), i = e % SHIFT;
    const p = this.slots[slot]!.cell.ped;
    const at = p.cumAt[i]!, np = p.np[i]!;
    const total = p.length[i]!;
    s = Math.min(Math.max(s, 0), total);
    let k = 0;
    while (k < np && p.cum[at + k]! < s) k++;
    const start = k === 0 ? 0 : p.cum[at + k - 1]!;
    const x0 = k === 0 ? p.nodeX[p.a[i]!]! : p.geom[(p.p0[i]! + k - 1) * 2]!, y0 = k === 0 ? p.nodeY[p.a[i]!]! : p.geom[(p.p0[i]! + k - 1) * 2 + 1]!;
    const x1 = k < np ? p.geom[(p.p0[i]! + k) * 2]! : p.nodeX[p.b[i]!]!, y1 = k < np ? p.geom[(p.p0[i]! + k) * 2 + 1]! : p.nodeY[p.b[i]!]!;
    const len = p.cum[at + k]! - start;
    const t = len > 1e-6 ? (s - start) / len : 0;
    out.x = x0 + (x1 - x0) * t;
    out.y = y0 + (y1 - y0) * t;
    return Math.atan2(x1 - x0, y1 - y0);
  }

  /** Les sommets de l'arête (nœud a, sommets intérieurs, nœud b) dans `out` à plat ; renvoie le nombre de points. */
  polyline(e: number, out: number[]): number {
    const p = this.layer(e);
    const i = e % SHIFT;
    out.length = 0;
    out.push(p.nodeX[p.a[i]!]!, p.nodeY[p.a[i]!]!);
    for (let k = 0; k < p.np[i]!; k++) out.push(p.geom[(p.p0[i]! + k) * 2]!, p.geom[(p.p0[i]! + k) * 2 + 1]!);
    out.push(p.nodeX[p.b[i]!]!, p.nodeY[p.b[i]!]!);
    return p.np[i]! + 2;
  }

  /** Nœuds équivalents au nœud `n` (lui-même, et ses jumeaux de l'autre côté d'une frontière de super-tuile). */
  private twins(n: number): number[] {
    const slot = Math.floor(n / SHIFT), i = n % SHIFT;
    const p = this.slots[slot]!.cell.ped;
    if (!(p.nodeFlags[i]! & 1)) return [n];
    return this.portals.get(p.portalKey.get(i) ?? "") ?? [n];
  }

  /**
   * Suites possibles en quittant l'arête `e` par son extrémité `end` (0 : nœud a, 1 : nœud b) : ajoute à `out` des `Move`
   * (arête × 2 + sens), sans l'arête elle-même sauf boucle. Passe les frontières de super-tuile. Renvoie le nombre ajouté.
   */
  next(e: number, end: 0 | 1, out: Move[]): number {
    const n = this.edgeNode(e, end);
    const before = out.length;
    for (const t of this.twins(n)) {
      const slot = Math.floor(t / SHIFT), local = t % SHIFT;
      const p = this.slots[slot]!.cell.ped;
      for (let k = p.adjStart[local]!; k < p.adjStart[local + 1]!; k++) {
        const ei = p.adj[k]!;
        const ref = slot * SHIFT + ei;
        if (ref === e && !(p.a[ei] === p.b[ei])) continue;
        if (p.a[ei] === local) out.push(ref * 2);
        if (p.b[ei] === local) out.push(ref * 2 + 1);
      }
    }
    return out.length - before;
  }

  /** Arête la plus proche du point (x, y) à moins de `maxDist`, ou null. `typeMask` : bits des types acceptés (1 << type). */
  nearest(x: number, y: number, maxDist: number, typeMask = 0x3ff): NavHit | null {
    let best: NavHit | null = null;
    const seen = new Set<number>();
    for (const l of this.cells.values()) {
      const [x0, y0, x1, y1] = l.cell.bounds;
      if (x < x0 - maxDist || x > x1 + maxDist || y < y0 - maxDist || y > y1 + maxDist) continue;
      const c0 = Math.max(0, Math.floor((x - maxDist - l.gx) / GRID)), c1 = Math.min(l.cols - 1, Math.floor((x + maxDist - l.gx) / GRID));
      const r0 = Math.max(0, Math.floor((y - maxDist - l.gy) / GRID)), r1 = Math.min(l.rows - 1, Math.floor((y + maxDist - l.gy) / GRID));
      const p = l.cell.ped;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          for (let k = l.gridStart[r * l.cols + c]!; k < l.gridStart[r * l.cols + c + 1]!; k++) {
            const i = l.grid[k]!;
            const ref = l.slot * SHIFT + i;
            if (seen.has(ref) || !((typeMask >> p.type[i]!) & 1)) continue;
            seen.add(ref);
            const h = this.closest(p, i, x, y);
            if (h.dist <= maxDist && (!best || h.dist < best.dist)) best = { edge: ref, s: h.s, dist: h.dist, x: h.x, y: h.y };
          }
        }
      }
    }
    return best;
  }

  private closest(p: PedLayer, i: number, x: number, y: number): { s: number; dist: number; x: number; y: number } {
    const at = p.cumAt[i]!, np = p.np[i]!;
    let px = p.nodeX[p.a[i]!]!, py = p.nodeY[p.a[i]!]!;
    let best = { s: 0, dist: Infinity, x: px, y: py };
    for (let k = 0; k <= np; k++) {
      const qx = k < np ? p.geom[(p.p0[i]! + k) * 2]! : p.nodeX[p.b[i]!]!, qy = k < np ? p.geom[(p.p0[i]! + k) * 2 + 1]! : p.nodeY[p.b[i]!]!;
      const dx = qx - px, dy = qy - py, len2 = dx * dx + dy * dy;
      const t = len2 > 1e-12 ? Math.min(Math.max(((x - px) * dx + (y - py) * dy) / len2, 0), 1) : 0;
      const cx = px + dx * t, cy = py + dy * t, d = Math.hypot(x - cx, y - cy);
      if (d < best.dist) best = { s: (k === 0 ? 0 : p.cum[at + k - 1]!) + Math.sqrt(len2) * t, dist: d, x: cx, y: cy };
      px = qx;
      py = qy;
    }
    return best;
  }
}
