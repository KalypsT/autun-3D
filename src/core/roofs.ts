/**
 * Toits praticables (plan `docs/plans/toits.md`, lot 1, D214) : les pans de toit des bâtiments deviennent des surfaces, comme les tabliers
 * de pont (D93). Logique pure : aucune dépendance au rendu.
 *
 * Seuls le joueur et son véhicule marchent et roulent dessus (`withRoofs`) ; le relief reste celui de tous les autres (circulation,
 * passants, gendarmes). Les pans sont ceux que dessine le rendu : ceux du bâtiment remis à la forme de son gabarit (`reshapeBuilding`).
 */
import type { Building, HeightField } from "../data/types";
import { pointInRing } from "./ring";

/**
 * Montée la plus haute (m) qu'un toit peut avoir au-dessus de l'altitude de qui demande (`zHint`) pour compter comme sa surface : un
 * essieu sur un pan à 35° est plus haut que le centre du véhicule, une marche entre deux toits voisins se franchit. Comme `STEP_UP` des
 * tabliers. Au-delà, on est sous le toit (au pied du mur, dans la rue).
 */
export const ROOF_STEP = 1.5;
/**
 * Fente (m) entre deux toits qu'on franchit sans tomber (D218) : les contours de deux bâtiments mitoyens se touchent presque toujours
 * (11 061 côtés partagés), mais 171 laissent 10 à 80 cm. Le bord d'un toit « dépasse » d'autant pour le joueur et son véhicule.
 */
export const ROOF_GAP = 0.3;

/** Un pan : plan z = a·x + b·y + c sur son contour (trous exclus). */
export interface RoofPlane {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  /** Contour extérieur (x0, y0, x1, y1…) et trous. */
  readonly ring: readonly number[];
  readonly holes: readonly (readonly number[])[];
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Les pans d'un bâtiment (déjà remis à la forme de son gabarit). */
export function roofPlanes(b: Building): RoofPlane[] {
  const out: RoofPlane[] = [];
  for (const f of b.faces) {
    if (f.r.length < 6) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < f.r.length; i += 2) {
      x0 = Math.min(x0, f.r[i]!);
      x1 = Math.max(x1, f.r[i]!);
      y0 = Math.min(y0, f.r[i + 1]!);
      y1 = Math.max(y1, f.r[i + 1]!);
    }
    const [a, bb, c] = f.p;
    out.push({ a, b: bb, c, ring: f.r, holes: f.h, x0, y0, x1, y1 });
  }
  return out;
}

const CELL = 8;
/** Pas (m) et marge aux deux bouts (m) du contrôle des toits le long d'une ligne de vue (`Roofs.blocks`). */
const ROOF_SIGHT_STEP = 1;
const ROOF_SIGHT_END = 0.6;

function key(ix: number, iy: number): number {
  return ix * 100003 + iy;
}

/** Pans de toit de la ville, rangés dans une grille ; chargés et déchargés par tuile (étiquette), comme les obstacles. */
export class Roofs {
  private readonly planes: (RoofPlane | null)[] = [];
  private readonly free: number[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly tagged = new Map<string, number[]>();

  /** Ajoute des pans ; `tag` permet de les retirer avec leur tuile. */
  add(planes: readonly RoofPlane[], tag: string | null = null): void {
    for (const p of planes) {
      const reuse = this.free.pop();
      const id = reuse ?? this.planes.length;
      if (reuse === undefined) this.planes.push(p);
      else this.planes[id] = p;
      if (tag !== null) {
        let t = this.tagged.get(tag);
        if (!t) this.tagged.set(tag, (t = []));
        t.push(id);
      }
      for (let ix = Math.floor(p.x0 / CELL); ix <= Math.floor(p.x1 / CELL); ix++) {
        for (let iy = Math.floor(p.y0 / CELL); iy <= Math.floor(p.y1 / CELL); iy++) {
          const k = key(ix, iy);
          const cell = this.grid.get(k);
          if (cell) cell.push(id);
          else this.grid.set(k, [id]);
        }
      }
    }
  }

  /** Retire les pans ajoutés sous cette étiquette. */
  removeTag(tag: string): void {
    const ids = this.tagged.get(tag);
    if (!ids) return;
    for (const id of ids) {
      const p = this.planes[id]!;
      for (let ix = Math.floor(p.x0 / CELL); ix <= Math.floor(p.x1 / CELL); ix++) {
        for (let iy = Math.floor(p.y0 / CELL); iy <= Math.floor(p.y1 / CELL); iy++) {
          const k = key(ix, iy);
          const cell = this.grid.get(k);
          if (!cell) continue;
          const i = cell.indexOf(id);
          if (i >= 0) cell.splice(i, 1);
          if (cell.length === 0) this.grid.delete(k);
        }
      }
      this.planes[id] = null;
      this.free.push(id);
    }
    this.tagged.delete(tag);
  }

  /** Nombre de pans en place. */
  get size(): number {
    return this.planes.length - this.free.length;
  }

  /**
   * Pan sous le point : le plus haut qui ne dépasse pas `zHint + ROOF_STEP` (sans `zHint` : le plus haut), et plus haut que `above`.
   * Null : pas de toit (rue, cour intérieure) ou toit trop haut (on est dessous).
   */
  planeAt(x: number, y: number, zHint?: number, above = -Infinity): RoofPlane | null {
    const cell = this.grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!cell) return null;
    const limit = zHint === undefined ? Infinity : zHint + ROOF_STEP;
    let best: RoofPlane | null = null, bz = above;
    for (const id of cell) {
      const p = this.planes[id]!;
      if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) continue;
      const z = p.a * x + p.b * y + p.c;
      if (z <= bz || z > limit) continue;
      if (!pointInRing(x, y, p.ring) || p.holes.some((h) => pointInRing(x, y, h))) continue;
      best = p;
      bz = z;
    }
    return best;
  }

  /**
   * Un toit coupe-t-il le segment (ax, ay, az) → (bx, by, bz) (D216) ? Le rayon passe sous un pan en un point (on le suit pas à pas,
   * tous les `ROOF_SIGHT_STEP` m, sans les `ROOF_SIGHT_END` premiers et derniers mètres : celui qui est sur le toit ne se cache pas
   * lui-même). Un gendarme dans la rue ne voit pas le joueur couché derrière le faîtage, ni au milieu d'un toit plat.
   */
  blocks(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const len = Math.hypot(bx - ax, by - ay);
    if (len <= 2 * ROOF_SIGHT_END) return false;
    const n = Math.ceil(len / ROOF_SIGHT_STEP);
    for (let i = 1; i < n; i++) {
      const t = i / n, d = t * len;
      if (d < ROOF_SIGHT_END || len - d < ROOF_SIGHT_END) continue;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      const p = this.planeAt(x, y);
      if (p && p.a * x + p.b * y + p.c > z) return true;
    }
    return false;
  }

  /**
   * Altitude de la surface : le toit sous le point s'il est plus haut que `ground` (voir `planeAt`), sinon `ground`. `gap` (m, D218) : sans
   * toit sous le point, on regarde aussi à cette distance autour (huit points) ; une fente entre deux toits mitoyens ne fait pas tomber.
   */
  surface(x: number, y: number, ground: number, zHint?: number, gap = 0): number {
    const p = this.planeAt(x, y, zHint, ground);
    if (p) return p.a * x + p.b * y + p.c;
    if (gap <= 0) return ground;
    let best = ground;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const q = this.planeAt(x + Math.sin(a) * gap, y + Math.cos(a) * gap, zHint, best);
      if (q) best = Math.max(best, q.a * x + q.b * y + q.c);
    }
    return best;
  }
}

/**
 * Le relief avec les toits par-dessus : la surface du joueur et de son véhicule. Comme pour les ponts, `zHint` (l'altitude de qui demande)
 * départage le toit et la rue au pied du mur ; sans lui, c'est la surface la plus haute, donc le toit.
 */
export function withRoofs(terrain: HeightField, roofs: Roofs): HeightField {
  const field: HeightField = {
    heightAt: (x, y, zHint) => roofs.surface(x, y, terrain.heightAt(x, y, zHint), zHint, ROOF_GAP),
    ground: terrain.ground ?? terrain,
    get xMin(): number { return terrain.xMin; },
    get xMax(): number { return terrain.xMax; },
    get yMin(): number { return terrain.yMin; },
    get yMax(): number { return terrain.yMax; },
    get seaLevel(): number | undefined { return terrain.seaLevel; },
    roofless: terrain,
    roofAt: (x, y, zHint) => roofs.planeAt(x, y, zHint, terrain.heightAt(x, y, zHint)),
  };
  if (terrain.railAt) {
    const rail = terrain.railAt.bind(terrain);
    field.railAt = (x, y) => rail(x, y);
  }
  return field;
}
