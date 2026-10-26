/**
 * Collisions 2D (plan x, y) : segments (murs de bâtiments, murs OSM) et cercles (mobilier, troncs).
 * Logique pure : aucune dépendance au rendu. Une grille spatiale limite les tests aux voisins.
 */

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Resolution {
  x: number;
  y: number;
  /** Normale moyenne des contacts (unitaire), ou (0, 0) sans contact. */
  nx: number;
  ny: number;
  hit: boolean;
}

const CELL = 8;

function key(ix: number, iy: number): number {
  return ix * 100003 + iy;
}

export class Colliders {
  readonly segments: Segment[] = [];
  readonly circles: Circle[] = [];
  /** Obstacles par étiquette (une tuile), pour les retirer d'un coup. */
  private readonly tagged = new Map<string, { segs: number[]; circles: number[] }>();
  private readonly deadSeg = new Set<number>();
  private readonly deadCircle = new Set<number>();
  /** Étiquette appliquée aux obstacles ajoutés ensuite. */
  currentTag: string | null = null;
  private readonly segGrid = new Map<number, number[]>();
  private readonly circleGrid = new Map<number, number[]>();
  private stamp = 0;
  private segSeen: number[] = [];
  private circleSeen: number[] = [];

  addSegment(ax: number, ay: number, bx: number, by: number): void {
    if (Math.hypot(bx - ax, by - ay) < 1e-4) return;
    const id = this.segments.push({ ax, ay, bx, by }) - 1;
    this.segSeen.push(0);
    this.record("segs", id);
    const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
    const y0 = Math.floor(Math.min(ay, by) / CELL), y1 = Math.floor(Math.max(ay, by) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = key(ix, iy);
        const cell = this.segGrid.get(k);
        if (cell) cell.push(id);
        else this.segGrid.set(k, [id]);
      }
    }
  }

  addCircle(x: number, y: number, r: number): void {
    const id = this.circles.push({ x, y, r }) - 1;
    this.circleSeen.push(0);
    this.record("circles", id);
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = key(ix, iy);
        const cell = this.circleGrid.get(k);
        if (cell) cell.push(id);
        else this.circleGrid.set(k, [id]);
      }
    }
  }

  private record(kind: "segs" | "circles", id: number): void {
    if (this.currentTag === null) return;
    let t = this.tagged.get(this.currentTag);
    if (!t) {
      t = { segs: [], circles: [] };
      this.tagged.set(this.currentTag, t);
    }
    t[kind].push(id);
  }

  /** Retire tous les obstacles ajoutés sous cette étiquette. */
  removeTag(tag: string): void {
    const t = this.tagged.get(tag);
    if (!t) return;
    t.segs.forEach((id) => this.deadSeg.add(id));
    t.circles.forEach((id) => this.deadCircle.add(id));
    this.tagged.delete(tag);
  }

  /** Ajoute le contour d'un anneau fermé (x0, y0, x1, y1, …) comme suite de segments. */
  addRing(coords: readonly number[]): void {
    const n = coords.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.addSegment(coords[2 * i]!, coords[2 * i + 1]!, coords[2 * j]!, coords[2 * j + 1]!);
    }
  }

  /** Ajoute une ligne ouverte (x0, y0, x1, y1, …) en segments. */
  addPolyline(coords: readonly number[]): void {
    for (let i = 0; i + 3 < coords.length; i += 2) this.addSegment(coords[i]!, coords[i + 1]!, coords[i + 2]!, coords[i + 3]!);
  }

  /** Repousse un cercle (centre x, y ; rayon r) hors de tous les obstacles voisins. */
  resolve(x: number, y: number, r: number): Resolution {
    let sx = 0, sy = 0, hits = 0;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      const stamp = ++this.stamp;
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
      const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const k = key(ix, iy);
          for (const id of this.segGrid.get(k) ?? []) {
            if (this.segSeen[id] === stamp || this.deadSeg.has(id)) continue;
            this.segSeen[id] = stamp;
            const s = this.segments[id]!;
            const dx = s.bx - s.ax, dy = s.by - s.ay;
            const len2 = dx * dx + dy * dy;
            const t = Math.min(Math.max(((x - s.ax) * dx + (y - s.ay) * dy) / len2, 0), 1);
            const cx = s.ax + t * dx, cy = s.ay + t * dy;
            let ex = x - cx, ey = y - cy;
            const d = Math.hypot(ex, ey);
            if (d >= r) continue;
            if (d < 1e-6) {
              const len = Math.sqrt(len2);
              ex = -dy / len;
              ey = dx / len;
            } else {
              ex /= d;
              ey /= d;
            }
            const push = r - d + 1e-4;
            x += ex * push;
            y += ey * push;
            sx += ex;
            sy += ey;
            hits++;
            moved = true;
          }
          for (const id of this.circleGrid.get(k) ?? []) {
            if (this.circleSeen[id] === stamp || this.deadCircle.has(id)) continue;
            this.circleSeen[id] = stamp;
            const c = this.circles[id]!;
            let ex = x - c.x, ey = y - c.y;
            const d = Math.hypot(ex, ey);
            if (d >= r + c.r) continue;
            if (d < 1e-6) {
              ex = 1;
              ey = 0;
            } else {
              ex /= d;
              ey /= d;
            }
            const push = r + c.r - d + 1e-4;
            x += ex * push;
            y += ey * push;
            sx += ex;
            sy += ey;
            hits++;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    const l = Math.hypot(sx, sy);
    return { x, y, nx: l > 1e-9 ? sx / l : 0, ny: l > 1e-9 ? sy / l : 0, hit: hits > 0 };
  }

  /**
   * Premier obstacle rencontré sur le segment (ax, ay) -> (bx, by) : fraction 0-1 de la longueur, ou null.
   * Seuls les segments sont testés (murs) ; les cercles (mobilier) ne gênent pas la caméra.
   */
  raycast(ax: number, ay: number, bx: number, by: number): number | null {
    let best: number | null = null;
    const stamp = ++this.stamp;
    const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
    const y0 = Math.floor(Math.min(ay, by) / CELL), y1 = Math.floor(Math.max(ay, by) / CELL);
    const rx = bx - ax, ry = by - ay;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (const id of this.segGrid.get(key(ix, iy)) ?? []) {
          if (this.segSeen[id] === stamp || this.deadSeg.has(id)) continue;
          this.segSeen[id] = stamp;
          const s = this.segments[id]!;
          const sx = s.bx - s.ax, sy = s.by - s.ay;
          const den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((s.ax - ax) * sy - (s.ay - ay) * sx) / den;
          const u = ((s.ax - ax) * ry - (s.ay - ay) * rx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
        }
      }
    }
    return best;
  }
}

/** Point dans un polygone (règle pair-impair), anneaux à plat : utile pour les tests et le placement. */
export function pointInRing(x: number, y: number, ring: readonly number[]): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i]!, yi = ring[2 * i + 1]!, xj = ring[2 * j]!, yj = ring[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
