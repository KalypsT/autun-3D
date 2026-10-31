import type { Deck, Platform } from "../data/types";

/** Marche qu'une entité franchit pour monter sur un tablier ou un quai (m) : au-delà, la surface est au-dessus d'elle (un pont qu'elle longe par-dessous). */
export const STEP_UP = 1.5;
const CELL = 16;

interface Seg {
  ax: number;
  ay: number;
  az: number;
  dx: number;
  dy: number;
  dz: number;
  len2: number;
  hw: number;
  rail: boolean;
}

interface Flat {
  ring: readonly number[];
  z: number;
}

/**
 * Secteur d'anneau praticable (gradins du théâtre romain, D133) : centre, angle du milieu et demi-ouverture (radians), rayons ; altitude
 * linéaire en rayon de z0 (à r0) à z1 (à r1).
 */
export interface DeckSector {
  id: string;
  cx: number;
  cy: number;
  a: number;
  h: number;
  r0: number;
  r1: number;
  z0: number;
  z1: number;
}

interface Entry {
  segs: Seg[];
  flats: Flat[];
  sectors: DeckSector[];
  cells: number[];
  refs: Set<string>;
}

function inRing(x: number, y: number, r: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Surfaces praticables posées au-dessus du relief : tabliers de pont (axe avec altitude, largeur) et quais (polygone à altitude fixe).
 * Le relief de l'IGN ne porte pas les tabliers (D93) : sans elles, la chaussée plonge vers la rivière. Un tablier présent dans
 * plusieurs tuiles n'est enregistré qu'une fois (compte des tuiles qui le portent).
 */
export class Decks {
  private readonly entries = new Map<string, Entry>();
  private readonly grid = new Map<number, Entry[]>();

  get empty(): boolean {
    return this.entries.size === 0;
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  private index(e: Entry, x0: number, y0: number, x1: number, y1: number): void {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
        const k = this.key(i, j);
        const list = this.grid.get(k) ?? [];
        list.push(e);
        this.grid.set(k, list);
        e.cells.push(k);
      }
    }
  }

  /** Tabliers et quais d'une tuile (les identifiants déjà connus ne font que gagner une référence). */
  add(tile: string, decks: readonly Deck[], platforms: readonly (Platform & { z: number; id: string })[] = []): void {
    for (const d of decks) {
      const id = `d${d.id}`;
      const known = this.entries.get(id);
      if (known) {
        known.refs.add(tile);
        continue;
      }
      const e: Entry = { segs: [], flats: [], sectors: [], cells: [], refs: new Set([tile]) };
      const p = d.p;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i + 5 < p.length; i += 3) {
        const ax = p[i]!, ay = p[i + 1]!, az = p[i + 2]!, bx = p[i + 3]!, by = p[i + 4]!, bz = p[i + 5]!;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-6) continue;
        e.segs.push({ ax, ay, az, dx, dy, dz: bz - az, len2, hw: d.w / 2, rail: d.k === "rail" });
        x0 = Math.min(x0, ax, bx); y0 = Math.min(y0, ay, by); x1 = Math.max(x1, ax, bx); y1 = Math.max(y1, ay, by);
      }
      if (!e.segs.length) continue;
      this.entries.set(id, e);
      this.index(e, x0 - d.w, y0 - d.w, x1 + d.w, y1 + d.w);
    }
    for (const pl of platforms) {
      const known = this.entries.get(pl.id);
      if (known) {
        known.refs.add(tile);
        continue;
      }
      const e: Entry = { segs: [], flats: [{ ring: pl.r, z: pl.z }], sectors: [], cells: [], refs: new Set([tile]) };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < pl.r.length; i += 2) {
        x0 = Math.min(x0, pl.r[i]!); x1 = Math.max(x1, pl.r[i]!); y0 = Math.min(y0, pl.r[i + 1]!); y1 = Math.max(y1, pl.r[i + 1]!);
      }
      this.entries.set(pl.id, e);
      this.index(e, x0, y0, x1, y1);
    }
  }

  /** Secteurs d'anneau d'une tuile (gradins, D133) ; même règle de références que les tabliers. */
  addSectors(tile: string, sectors: readonly DeckSector[]): void {
    for (const sc of sectors) {
      const id = `s${sc.id}`;
      const known = this.entries.get(id);
      if (known) {
        known.refs.add(tile);
        continue;
      }
      const e: Entry = { segs: [], flats: [], sectors: [sc], cells: [], refs: new Set([tile]) };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k <= 8; k++) {
        const th = sc.a - sc.h + (2 * sc.h * k) / 8;
        for (const r of [sc.r0, sc.r1]) {
          const x = sc.cx + r * Math.cos(th), y = sc.cy + r * Math.sin(th);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
      this.entries.set(id, e);
      this.index(e, x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5);
    }
  }

  /** La tuile ne porte plus ses tabliers : ceux qu'aucune autre tuile chargée ne porte disparaissent. */
  remove(tile: string): void {
    for (const [id, e] of this.entries) {
      if (!e.refs.delete(tile) || e.refs.size > 0) continue;
      this.entries.delete(id);
      for (const k of e.cells) {
        const list = this.grid.get(k);
        if (!list) continue;
        const i = list.indexOf(e);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) this.grid.delete(k);
      }
    }
  }

  /**
   * Altitude de la surface en (x, y) : le relief `ground`, ou un tablier ou un quai plus haut. Avec `zHint` (l'altitude actuelle de
   * l'entité), seules les surfaces à moins de STEP_UP au-dessus comptent : on reste sous un pont qu'on longe, on monte sur celui qu'on
   * aborde par sa culée. `rail` ne retient que les tabliers ferroviaires (rails dessinés), sans hint.
   */
  surface(x: number, y: number, ground: number, zHint?: number, rail = false): number {
    const list = this.grid.get(this.key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!list) return ground;
    let best = ground;
    const limit = zHint === undefined ? Infinity : zHint + STEP_UP;
    for (const e of list) {
      for (const s of e.segs) {
        if (rail && !s.rail) continue;
        const t = ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.len2;
        if (t < 0 || t > 1) continue;
        const px = s.ax + s.dx * t - x, py = s.ay + s.dy * t - y;
        if (px * px + py * py > s.hw * s.hw) continue;
        const z = s.az + s.dz * t;
        if (z > best && z <= limit) best = z;
      }
      if (rail) continue;
      for (const f of e.flats) if (f.z > best && f.z <= limit && inRing(x, y, f.ring)) best = f.z;
      for (const sc of e.sectors) {
        const dx = x - sc.cx, dy = y - sc.cy;
        const r = Math.hypot(dx, dy);
        if (r < sc.r0 || r > sc.r1) continue;
        let u = Math.atan2(dy, dx) - sc.a;
        u -= 2 * Math.PI * Math.round(u / (2 * Math.PI));
        if (Math.abs(u) > sc.h) continue;
        const z = sc.z0 + ((sc.z1 - sc.z0) * (r - sc.r0)) / (sc.r1 - sc.r0);
        if (z > best && z <= limit) best = z;
      }
    }
    return best;
  }
}
