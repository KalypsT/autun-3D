import type { Deck, Platform } from "../data/types";
import { deckGaps } from "./bridges";

/** Marche qu'une entité franchit pour monter sur un tablier ou un quai (m) : au-delà, la surface est au-dessus d'elle (un pont qu'elle longe par-dessous). */
export const STEP_UP = 1.5;
const CELL = 16;
/** Marge de part et d'autre d'un tablier où le relief est corrigé sous une voie qui passe dessous (m), voir `Decks.carve`. */
const CARVE = 3;
/** Hauteur libre sous un tablier en dessous de laquelle `carve` corrige le relief (m, épaisseur du tablier comprise). */
const HEADROOM = 4;
/** Directions des droites de `carve`, autour de la perpendiculaire au tablier (radians). */
const SKEW = [-0.7, -0.35, 0, 0.35, 0.7];
const SKEW_COS = SKEW.map(Math.cos), SKEW_SIN = SKEW.map(Math.sin);

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
  /** Abscisse du début du segment le long du tablier, et sa longueur (m). */
  s0: number;
  len: number;
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
  /** Tronçons du tablier qui enjambent une autre voie (abscisses), voir `deckGaps`. */
  gaps: [number, number][];
  /** Longueur du tablier (m). */
  length: number;
  /** Tronçons de `gaps` corrigés par `carve`, prolongés au-delà des bouts du tablier (calculés une fois, D284). */
  spans: [number, number][];
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
      const e: Entry = { segs: [], flats: [], sectors: [], gaps: [], length: 0, spans: [], cells: [], refs: new Set([tile]) };
      const p = d.p;
      let s0 = 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i + 5 < p.length; i += 3) {
        const ax = p[i]!, ay = p[i + 1]!, az = p[i + 2]!, bx = p[i + 3]!, by = p[i + 4]!, bz = p[i + 5]!;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-6) continue;
        const len = Math.sqrt(len2);
        e.segs.push({ ax, ay, az, dx, dy, dz: bz - az, len2, hw: d.w / 2, rail: d.k === "rail", s0, len });
        s0 += len;
        x0 = Math.min(x0, ax, bx); y0 = Math.min(y0, ay, by); x1 = Math.max(x1, ax, bx); y1 = Math.max(y1, ay, by);
      }
      if (!e.segs.length) continue;
      e.gaps = deckGaps(d, s0);
      e.length = s0;
      // Un tronçon qui va jusqu'au bout du tablier y garde toute sa correction, fondue sur le mètre suivant : l'axe OpenStreetMap du pont
      // est souvent plus court que l'ouvrage (pont-rail du boulevard Pauchard : 6 m pour une trouée plus large).
      e.spans = e.gaps.map(([a, b]): [number, number] => [a <= 0.5 ? -1 : a, b >= s0 - 0.5 ? s0 + 1 : b]);
      this.entries.set(id, e);
      this.index(e, x0 - d.w - CARVE, y0 - d.w - CARVE, x1 + d.w + CARVE, y1 + d.w + CARVE);
    }
    for (const pl of platforms) {
      const known = this.entries.get(pl.id);
      if (known) {
        known.refs.add(tile);
        continue;
      }
      const e: Entry = { segs: [], flats: [{ ring: pl.r, z: pl.z }], sectors: [], gaps: [], length: 0, spans: [], cells: [], refs: new Set([tile]) };
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
      const e: Entry = { segs: [], flats: [], sectors: [sc], gaps: [], length: 0, spans: [], cells: [], refs: new Set([tile]) };
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
        const z = this.sectorZ(sc, x, y);
        if (z !== null && z > best && z <= limit) best = z;
      }
    }
    return best;
  }

  /**
   * Altitude où poser le sol dessiné des rues (chaussées, trottoirs, places, marquages) : comme `surface` sans indication d'altitude,
   * sauf sous les tronçons d'un tablier qui enjambent une autre voie (`gaps`) : là, NaN, rien à poser (on verrait sinon la route du bas
   * relevée jusqu'au tablier, en rampe ou en mur). Le dessus du tablier, dessiné avec l'ouvrage, porte la chaussée du haut.
   */
  pave(x: number, y: number, ground: number): number {
    const list = this.grid.get(this.key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!list) return ground;
    let best = ground, on = false, under = false;
    for (const e of list) {
      for (const s of e.segs) {
        const t = ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.len2;
        if (t < 0 || t > 1) continue;
        const px = s.ax + s.dx * t - x, py = s.ay + s.dy * t - y;
        if (px * px + py * py > s.hw * s.hw) continue;
        const at = s.s0 + s.len * t;
        if (e.gaps.some(([a, b]) => at > a && at < b)) {
          under = true;
          continue;
        }
        on = true;
        best = Math.max(best, s.az + s.dz * t);
      }
      for (const f of e.flats) if (inRing(x, y, f.ring)) { on = true; best = Math.max(best, f.z); }
      for (const sc of e.sectors) {
        const z = this.sectorZ(sc, x, y);
        if (z !== null) { on = true; best = Math.max(best, z); }
      }
    }
    return under && !on ? NaN : best;
  }

  private sectorZ(sc: DeckSector, x: number, y: number): number | null {
    const dx = x - sc.cx, dy = y - sc.cy;
    const r = Math.hypot(dx, dy);
    if (r < sc.r0 || r > sc.r1) return null;
    let u = Math.atan2(dy, dx) - sc.a;
    u -= 2 * Math.PI * Math.round(u / (2 * Math.PI));
    if (Math.abs(u) > sc.h) return null;
    return sc.z0 + ((sc.z1 - sc.z0) * (r - sc.r0)) / (sc.r1 - sc.r0);
  }

  /**
   * Relief corrigé sous les tronçons d'un tablier qui enjambent une voie : le modèle de terrain y bouche parfois le passage (bosse de
   * 4 m sous le pont-rail du boulevard Xavier Pauchard, le LiDAR ayant pris le tablier pour le sol). Sous l'emprise élargie de `CARVE` m
   * de chaque côté, le relief ne dépasse pas la plus basse des droites tirées en travers du tablier entre les deux bords (la voie du bas),
   * sans descendre à plus de HEADROOM sous le tablier ; fondu sur 1 m aux bouts du tronçon. `raw` : le relief brut, `rawAt` : le relief brut ailleurs.
   */
  carve(x: number, y: number, raw: number, rawAt: (x: number, y: number) => number): number {
    const list = this.grid.get(this.key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!list) return raw;
    let z = raw;
    for (const e of list) {
      const spans = e.spans;
      if (!spans.length) continue;
      for (const s of e.segs) {
        const t = ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.len2;
        const first = s.s0 === 0, last = s.s0 + s.len >= e.length - 1e-6;
        if ((t < 0 && !first) || (t > 1 && !last)) continue;
        const at = s.s0 + s.len * t;
        const g = spans.find(([a, b]) => at > a && at < b);
        if (!g) continue;
        const nx = -s.dy / s.len, ny = s.dx / s.len;
        const cx = s.ax + s.dx * t, cy = s.ay + s.dy * t;
        const u = (x - cx) * nx + (y - cy) * ny;
        const reach = s.hw + CARVE;
        if (Math.abs(u) >= reach) continue;
        // La voie du bas passe souvent en biais : droites tirées dans plusieurs directions autour de la perpendiculaire, la plus basse.
        let line = Infinity;
        for (let i = 0; i < SKEW.length; i++) {
          const c = SKEW_COS[i]!, sn = SKEW_SIN[i]!;
          const ux = nx * c - ny * sn, uy = nx * sn + ny * c;
          const k0 = (-reach - u) / c, k1 = (reach - u) / c;
          const za = rawAt(x + ux * k0, y + uy * k0), zb = rawAt(x + ux * k1, y + uy * k1);
          line = Math.min(line, za + ((zb - za) * -k0) / (k1 - k0));
        }
        // Jamais plus bas que nécessaire : le relief reste au plus à HEADROOM sous le tablier (une vallée sous un pont haut ne bouge pas).
        line = Math.max(line, s.az + s.dz * Math.min(1, Math.max(0, t)) - HEADROOM);
        const w = Math.min(1, at - g[0], g[1] - at);
        if (line < z) z = Math.min(z, raw - w * (raw - line));
      }
    }
    return z;
  }
}
