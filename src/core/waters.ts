/**
 * L'eau de la ville (D240) : les plans d'eau et leur niveau (`water.json`, `tools/data/build_water.py`). Le relief publié a été creusé sous
 * chacun d'eux ; ce registre dit où est l'eau et à quelle altitude est sa surface, pour la règle de profondeur (`shore.ts`), les canards ou le
 * reflet du feu d'artifice. La mer (D105) n'y est pas : elle a son propre niveau (`HeightField.seaLevel`). Logique pure.
 *
 * Analogie : un cadastre de l'eau. Chaque parcelle (un morceau de plan d'eau, découpé à la tuile) porte l'altitude de sa surface ; pour savoir
 * si un point est dans l'eau, on regarde seulement les parcelles de son carré de 25 m.
 */

/** Fichier `water.json` : morceaux de plan d'eau (anneau extérieur puis trous, coordonnées aplaties) et plan de leur surface, z = a·x + b·y + c. */
export interface WaterFile {
  v: number;
  pieces: { r: number[][]; z: [number, number, number] }[];
}

interface Piece {
  rings: readonly (readonly number[])[];
  a: number;
  b: number;
  c: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const CELL = 25;
const key = (cx: number, cy: number): number => (cx + 4096) * 8192 + (cy + 4096);

/** Point dans un anneau aplati (règle pair-impair). */
export function inFlatRing(ring: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i]!, yi = ring[2 * i + 1]!, xj = ring[2 * j]!, yj = ring[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class Waters {
  private readonly pieces: Piece[] = [];
  private readonly grid = new Map<number, number[]>();

  constructor(file: WaterFile | null) {
    for (const p of file?.pieces ?? []) {
      const outer = p.r[0];
      if (!outer || outer.length < 6) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < outer.length; i += 2) {
        x0 = Math.min(x0, outer[i]!); x1 = Math.max(x1, outer[i]!);
        y0 = Math.min(y0, outer[i + 1]!); y1 = Math.max(y1, outer[i + 1]!);
      }
      const id = this.pieces.length;
      this.pieces.push({ rings: p.r, a: p.z[0], b: p.z[1], c: p.z[2], x0, y0, x1, y1 });
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const k = key(cx, cy);
          const list = this.grid.get(k);
          if (list) list.push(id);
          else this.grid.set(k, [id]);
        }
      }
    }
  }

  get empty(): boolean {
    return this.pieces.length === 0;
  }

  /** Morceaux (pour le dessin de l'eau lointaine) : anneaux et plan de la surface. */
  get all(): readonly { rings: readonly (readonly number[])[]; level: (x: number, y: number) => number }[] {
    return this.pieces.map((p) => ({ rings: p.rings, level: (x: number, y: number) => p.a * x + p.b * y + p.c }));
  }

  /** Altitude de la surface de l'eau de la ville en (x, y), ou `undefined` hors de l'eau. */
  levelAt(x: number, y: number): number | undefined {
    const list = this.grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!list) return undefined;
    for (const id of list) {
      const p = this.pieces[id]!;
      if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1 || !inFlatRing(p.rings[0]!, x, y)) continue;
      let hole = false;
      for (let k = 1; k < p.rings.length && !hole; k++) hole = inFlatRing(p.rings[k]!, x, y);
      if (!hole) return p.a * x + p.b * y + p.c;
    }
    return undefined;
  }
}
