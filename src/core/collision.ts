/**
 * Collisions 2D (plan x, y) : segments (murs de bâtiments, murs OSM) et cercles (mobilier, troncs).
 * Logique pure : aucune dépendance au rendu. Une grille spatiale limite les tests aux voisins.
 */
import { Roofs } from "./roofs";

export { pointInRing } from "./ring";

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Obstacle bas (clôture, muret) : il arrête les déplacements, pas les rayons (vue, tirs, caméra passent par-dessus). */
  low?: boolean;
  /** Hauteur au-dessus du sol (m) d'un mur, d'une clôture ou d'une haie : on passe par-dessus en sautant assez haut. Absente : infranchissable (bâtiment). */
  height?: number;
  /** On peut l'escalader (grille, muret, haie basse). */
  climb?: boolean;
  /**
   * Mur de bâtiment (D214) : altitude absolue de son haut en A et en B (pignon : le haut suit le rampant). Qui donne l'altitude de ses
   * pieds (`resolve`, `feet`) passe par-dessus quand ils sont à moins de `WALL_STEP` sous ce haut ; sans elle, le mur reste infini.
   */
  topA?: number;
  topB?: number;
  /**
   * Obstacle sous un tablier (pile de pont, D220) : il n'arrête que qui donne son altitude (pieds, rayon) et passe sous `topA` ; sans
   * altitude, il est ignoré (passants et voitures de la circulation sur le pont ne s'y heurtent pas).
   */
  under?: boolean;
}

/** Hauteur (m) dont les pieds peuvent être sous le haut d'un mur de bâtiment et passer quand même : le bord d'un toit, une petite marche. */
export const WALL_STEP = 0.3;
/** Mur de bâtiment qu'on escalade (D218) : son haut à au plus … m au-dessus des pieds (garage, annexe, toit voisin un peu plus haut). */
export const BUILDING_CLIMB = 2.5;

/** Hauteur et escalade d'un obstacle franchissable. */
export interface Top {
  height: number;
  climb: boolean;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
  /** Mobilier cassable (D160) : identifiant et nature ; absent pour un obstacle plein. */
  brk?: { id: number; kind: string };
}

/** Un mobilier arraché par un véhicule : où, de quelle nature, et la direction (unitaire) et la vitesse (m/s) du véhicule qui l'a heurté. */
export interface BrokenEvent {
  id: number;
  kind: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
}

export interface Resolution {
  x: number;
  y: number;
  /** Normale moyenne des contacts (unitaire), ou (0, 0) sans contact. */
  nx: number;
  ny: number;
  hit: boolean;
  /** Segment escaladable touché (indice dans `segments`), ou −1. */
  wall?: number;
  /** Cercle cassable touché (indice dans `circles`), ou −1 ; `soft` : tous les contacts de ce pas sont des cercles cassables. */
  brk?: number;
  soft?: boolean;
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
  /** Emplacements libérés par removeTag, réutilisés par les ajouts suivants : la mémoire ne grossit pas quand on charge et décharge des tuiles. */
  private readonly freeSeg: number[] = [];
  private readonly freeCircle: number[] = [];
  /** Étiquette appliquée aux obstacles ajoutés ensuite. */
  currentTag: string | null = null;
  /** Pans de toit (D214), chargés et déchargés avec les obstacles de leur tuile. */
  readonly roofs = new Roofs();
  /** Mobilier arraché depuis le dernier appel de `takeBroken` (le jeu le lit à chaque image). */
  private readonly broken: BrokenEvent[] = [];
  private readonly segGrid = new Map<number, number[]>();
  private readonly circleGrid = new Map<number, number[]>();
  private stamp = 0;
  private segSeen: number[] = [];
  private circleSeen: number[] = [];

  addSegment(ax: number, ay: number, bx: number, by: number, low = false, top: Top | null = null, tops: readonly [number, number] | null = null, under = false): void {
    if (Math.hypot(bx - ax, by - ay) < 1e-4) return;
    const rec: Segment = low ? { ax, ay, bx, by, low } : { ax, ay, bx, by };
    if (under) rec.under = true;
    if (top) {
      rec.height = top.height;
      if (top.climb) rec.climb = true;
    }
    if (tops) {
      rec.topA = tops[0];
      rec.topB = tops[1];
    }
    const reuse = this.freeSeg.pop();
    let id: number;
    if (reuse === undefined) {
      id = this.segments.push(rec) - 1;
      this.segSeen.push(0);
    } else {
      id = reuse;
      this.segments[id] = rec;
      this.deadSeg.delete(id);
    }
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

  addCircle(x: number, y: number, r: number, brk?: { id: number; kind: string }): void {
    const rec: Circle = brk ? { x, y, r, brk } : { x, y, r };
    const reuse = this.freeCircle.pop();
    let id: number;
    if (reuse === undefined) {
      id = this.circles.push(rec) - 1;
      this.circleSeen.push(0);
    } else {
      id = reuse;
      this.circles[id] = rec;
      this.deadCircle.delete(id);
    }
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
    this.roofs.removeTag(tag);
    const t = this.tagged.get(tag);
    if (!t) return;
    for (const id of t.segs) {
      const sg = this.segments[id]!;
      this.unlink(this.segGrid, id, Math.floor(Math.min(sg.ax, sg.bx) / CELL), Math.floor(Math.max(sg.ax, sg.bx) / CELL), Math.floor(Math.min(sg.ay, sg.by) / CELL), Math.floor(Math.max(sg.ay, sg.by) / CELL));
      this.deadSeg.add(id);
      this.freeSeg.push(id);
    }
    for (const id of t.circles) {
      const c = this.circles[id]!;
      this.unlink(this.circleGrid, id, Math.floor((c.x - c.r) / CELL), Math.floor((c.x + c.r) / CELL), Math.floor((c.y - c.r) / CELL), Math.floor((c.y + c.r) / CELL));
      this.deadCircle.add(id);
      this.freeCircle.push(id);
    }
    this.tagged.delete(tag);
  }

  /**
   * Arrache le cercle cassable `id` (D160) : il ne gêne plus rien et un événement est mis en file. Il reste réservé à son étiquette,
   * qui le libérera avec la tuile : une tuile rechargée le remet en place.
   */
  breakCircle(id: number, dx: number, dy: number, speed: number): void {
    const c = this.circles[id];
    if (!c?.brk || this.deadCircle.has(id)) return;
    this.unlink(this.circleGrid, id, Math.floor((c.x - c.r) / CELL), Math.floor((c.x + c.r) / CELL), Math.floor((c.y - c.r) / CELL), Math.floor((c.y + c.r) / CELL));
    this.deadCircle.add(id);
    this.broken.push({ id: c.brk.id, kind: c.brk.kind, x: c.x, y: c.y, dx, dy, speed });
  }

  /** Mobilier arraché depuis le dernier appel. */
  takeBroken(): BrokenEvent[] {
    return this.broken.splice(0);
  }

  /** Retire l'obstacle `id` des cellules de la grille qu'il touchait. */
  private unlink(grid: Map<number, number[]>, id: number, x0: number, x1: number, y0: number, y1: number): void {
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = key(ix, iy);
        const cell = grid.get(k);
        if (!cell) continue;
        const i = cell.indexOf(id);
        if (i >= 0) cell.splice(i, 1);
        if (cell.length === 0) grid.delete(k);
      }
    }
  }

  /** Nombre d'obstacles en place (segments, cercles), emplacements libérés exclus. */
  get live(): { segments: number; circles: number } {
    return { segments: this.segments.length - this.freeSeg.length, circles: this.circles.length - this.freeCircle.length };
  }

  /**
   * Ajoute le contour d'un anneau fermé (x0, y0, x1, y1, …) comme suite de segments. `tops` : altitude absolue du haut du mur à chaque
   * sommet (mur de bâtiment, D214) ; absent : mur infini. `under` : obstacle sous un tablier (voir `Segment.under`).
   */
  addRing(coords: readonly number[], tops: readonly number[] | null = null, under = false): void {
    const n = coords.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.addSegment(coords[2 * i]!, coords[2 * i + 1]!, coords[2 * j]!, coords[2 * j + 1]!, false, null, tops ? [tops[i]!, tops[j]!] : null, under);
    }
  }

  /** Ajoute une ligne ouverte (x0, y0, x1, y1, …) en segments ; `low` : obstacle bas, transparent aux rayons ; `top` : hauteur, escalade. */
  addPolyline(coords: readonly number[], low = false, top: Top | null = null): void {
    for (let i = 0; i + 3 < coords.length; i += 2) this.addSegment(coords[i]!, coords[i + 1]!, coords[i + 2]!, coords[i + 3]!, low, top);
  }

  /**
   * Repousse un cercle (centre x, y ; rayon r) hors de tous les obstacles voisins. `clear` : hauteur des pieds au-dessus du sol (m), en saut ;
   * les murs, clôtures et haies moins hauts sont ignorés. `feet` : altitude absolue des pieds (D214) ; les murs de bâtiment dont le haut
   * est à moins de `WALL_STEP` au-dessus sont ignorés (on passe d'un toit à l'autre, on survole une maison). Sans elle, ils sont infinis.
   */
  resolve(x: number, y: number, r: number, clear = 0, feet?: number): Resolution {
    return this.resolveInto({ x: 0, y: 0, nx: 0, ny: 0, hit: false }, x, y, r, clear, feet);
  }

  /** Comme `resolve`, sans allouer : écrit le résultat dans `out` (réutilisable) et le renvoie. Pour les foules, appelée à chaque image. */
  resolveInto(out: Resolution, x: number, y: number, r: number, clear = 0, feet?: number): Resolution {
    let sx = 0, sy = 0, hits = 0, wall = -1, brk = -1, hard = 0;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      const stamp = ++this.stamp;
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
      const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const k = key(ix, iy);
          const segs = this.segGrid.get(k);
          if (segs) for (const id of segs) {
            if (this.segSeen[id] === stamp || this.deadSeg.has(id)) continue;
            this.segSeen[id] = stamp;
            const s = this.segments[id]!;
            if (clear > 0 && s.height !== undefined && s.height <= clear) continue;
            if (s.under && feet === undefined) continue;
            const dx = s.bx - s.ax, dy = s.by - s.ay;
            const len2 = dx * dx + dy * dy;
            const t = Math.min(Math.max(((x - s.ax) * dx + (y - s.ay) * dy) / len2, 0), 1);
            const above = feet !== undefined && s.topA !== undefined ? s.topA + t * (s.topB! - s.topA) - feet : Infinity;
            if (above <= WALL_STEP) continue;
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
            hard++;
            if (!s.under && (s.climb || above <= BUILDING_CLIMB)) wall = id;
            moved = true;
          }
          const circs = this.circleGrid.get(k);
          if (circs) for (const id of circs) {
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
            if (c.brk) brk = id;
            else hard++;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    const l = Math.hypot(sx, sy);
    out.x = x;
    out.y = y;
    out.nx = l > 1e-9 ? sx / l : 0;
    out.ny = l > 1e-9 ? sy / l : 0;
    out.hit = hits > 0;
    out.wall = wall;
    out.brk = brk;
    out.soft = hits > 0 && hard === 0;
    return out;
  }

  /**
   * Ligne de vue en 3D (D216) entre deux points (x, y, altitude) : ni mur que le rayon ne passe pas par-dessus, ni toit entre eux.
   * `circles` : les obstacles ronds (voitures garées, troncs) cachent aussi, comme pour `raycast`.
   */
  sight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, circles = false): boolean {
    return this.raycast(ax, ay, bx, by, circles, az, bz) === null && !this.roofs.blocks(ax, ay, az, bx, by, bz);
  }

  /**
   * Premier obstacle rencontré sur le segment (ax, ay) -> (bx, by) : fraction 0-1 de la longueur, ou null.
   * Par défaut, seuls les segments sont testés (murs) ; les cercles (mobilier, véhicules garés) ne gênent pas la caméra, ni les obstacles bas (clôtures).
   * `circles` : les cercles comptent aussi (balles et ligne de tir, D113 : on s'abrite derrière une voiture garée).
   * `az`, `bz` : altitude du rayon à ses deux bouts (D215) ; un mur de bâtiment que le rayon passe par-dessus ne l'arrête pas. Sans elles,
   * les murs de bâtiment sont infinis.
   */
  raycast(ax: number, ay: number, bx: number, by: number, circles = false, az?: number, bz?: number): number | null {
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
          if (s.low || (s.under && (az === undefined || bz === undefined))) continue;
          const sx = s.bx - s.ax, sy = s.by - s.ay;
          const den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((s.ax - ax) * sy - (s.ay - ay) * sx) / den;
          const u = ((s.ax - ax) * ry - (s.ay - ay) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1 || (best !== null && t >= best)) continue;
          if (az !== undefined && bz !== undefined && s.topA !== undefined && az + t * (bz - az) >= s.topA + u * (s.topB! - s.topA)) continue;
          best = t;
        }
        if (!circles) continue;
        // Obstacles ronds (véhicules garés, troncs, poteaux, D113) : première entrée du rayon dans le cercle ; un départ dans le cercle ne compte pas.
        for (const id of this.circleGrid.get(key(ix, iy)) ?? []) {
          if (this.circleSeen[id] === stamp || this.deadCircle.has(id)) continue;
          this.circleSeen[id] = stamp;
          const c = this.circles[id]!;
          const fx = ax - c.x, fy = ay - c.y, a = rx * rx + ry * ry;
          const b = 2 * (fx * rx + fy * ry), q = fx * fx + fy * fy - c.r * c.r;
          if (q <= 0 || a < 1e-12) continue;
          const disc = b * b - 4 * a * q;
          if (disc < 0) continue;
          const t = (-b - Math.sqrt(disc)) / (2 * a);
          if (t >= 0 && t <= 1 && (best === null || t < best)) best = t;
        }
      }
    }
    return best;
  }
}
