import * as THREE from "three";
import type { CathedralSpec, HeightField, Site, TownHallSpec } from "../data/types";
import { at, frameOf, gateLayout, type Frame, type GateLayout } from "../core/landmarks";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";
import { T } from "./style";

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
/** Grès et granit d'Autun : gris rosé. */
const STONE = C("#c9b99a");
const STONE_DARK = C("#8f8170");

/** Point du repère du monument à l'altitude z. */
function P(f: Frame, s: number, t: number, z: number): Vec3 {
  const [x, y] = at(f, s, t);
  return toThree(x, y, z);
}

/** Normale horizontale du repère : n = cos·u + sin·v (u le long de s, v le long de t). */
function N(f: Frame, us: number, vt: number): Vec3 {
  return toThree(f.ux * us + f.vx * vt, f.uy * us + f.vy * vt, 0);
}

/** Quad dans le repère : coins (s, t, z) dans l'ordre, normale donnée. */
function q(mb: MeshBuilder, f: Frame, a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], n: Vec3, col: THREE.Color): void {
  mb.quad(P(f, ...a), P(f, ...b), P(f, ...c), P(f, ...d), n, col);
}

/** Pavé droit du repère : s0..s1, t0..t1, z0..z1 (quatre côtés et dessus). */
function box(mb: MeshBuilder, f: Frame, s0: number, s1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color, top: THREE.Color = col): void {
  q(mb, f, [s0, t0, z0], [s1, t0, z0], [s1, t0, z1], [s0, t0, z1], N(f, 0, -1), col);
  q(mb, f, [s1, t1, z0], [s0, t1, z0], [s0, t1, z1], [s1, t1, z1], N(f, 0, 1), col);
  q(mb, f, [s0, t1, z0], [s0, t0, z0], [s0, t0, z1], [s0, t1, z1], N(f, -1, 0), shade(col, 0.92));
  q(mb, f, [s1, t0, z0], [s1, t1, z0], [s1, t1, z1], [s1, t0, z1], N(f, 1, 0), shade(col, 0.92));
  q(mb, f, [s0, t0, z1], [s1, t0, z1], [s1, t1, z1], [s0, t1, z1], [0, 1, 0], top);
}

// --- Portes romaines ------------------------------------------------------------------------------------------------------------------

/** Haut de l'ouverture en s (arc en plein cintre au-dessus de la naissance), ou null hors de l'ouverture. */
function openingTop(o: { s0: number; s1: number; spring: number }, s: number): number | null {
  if (s <= o.s0 || s >= o.s1) return null;
  const r = (o.s1 - o.s0) / 2, c = (o.s0 + o.s1) / 2;
  return o.spring + Math.sqrt(Math.max(0, r * r - (s - c) ** 2));
}

/**
 * Porte romaine : murs de face percés d'arches et d'arcades (colonnes de 25 cm entre le sol et le haut, moins les ouvertures), tranches des
 * arches (piédroits et intrados), corniches et pilastres en saillie, dessus et bouts.
 */
export function buildGate(mb: MeshBuilder, site: Extract<Site, { t: "gate" }>, terrain: HeightField): void {
  const g = terrain.heightAt(site.x, site.y);
  const lay: GateLayout = gateLayout(site, g);
  const f = lay.frame, H = lay.height, hw = f.hw;
  const z = (h: number): number => g + h;
  const stone = STONE, inner = shade(STONE, 0.72);
  // Faces : colonnes de 25 cm.
  const cuts = new Set<number>([-f.hl, f.hl]);
  for (const o of lay.openings) {
    cuts.add(o.s0);
    cuts.add(o.s1);
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const cols: number[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i]!, b = edges[i + 1]!;
    const n = Math.max(1, Math.ceil((b - a) / 0.25));
    for (let k = 0; k < n; k++) cols.push(a + ((b - a) * k) / n);
  }
  cols.push(f.hl);
  for (let i = 0; i + 1 < cols.length; i++) {
    const s0 = cols[i]!, s1 = cols[i + 1]!, sm = (s0 + s1) / 2;
    // Intervalles pleins de la colonne : du sol au haut, moins les ouvertures qui la traversent.
    const holes = lay.openings.filter((o) => sm > o.s0 && sm < o.s1).sort((a, b) => a.zb - b.zb);
    let base = -0.6;
    const solid = (zlo0: number, zlo1: number, zhi0: number, zhi1: number): void => {
      for (const side of [1, -1]) {
        const t = side * hw;
        const [a, b] = side === 1 ? [s1, s0] : [s0, s1];
        const [la, lb, ha, hb] = side === 1 ? [zlo1, zlo0, zhi1, zhi0] : [zlo0, zlo1, zhi0, zhi1];
        q(mb, f, [a, t, z(la)], [b, t, z(lb)], [b, t, z(hb)], [a, t, z(ha)], N(f, 0, side), stone);
      }
    };
    for (const o of holes) {
      const t0 = openingTop(o, s0) ?? o.spring, t1 = openingTop(o, s1) ?? o.spring;
      if (o.zb > base + 0.01) solid(base, base, o.zb, o.zb);
      // Intrados : le dessous de l'arc entre les deux faces.
      q(mb, f, [s0, -hw, z(t0)], [s1, -hw, z(t1)], [s1, hw, z(t1)], [s0, hw, z(t0)], [0, -1, 0], inner);
      if (o.zb > 0) q(mb, f, [s0, hw, z(o.zb)], [s1, hw, z(o.zb)], [s1, -hw, z(o.zb)], [s0, -hw, z(o.zb)], [0, 1, 0], shade(stone, 1.05));
      // Le haut de l'arc suit la courbe : colonne de t0 / t1 jusqu'à l'ouverture suivante ou au haut.
      const next = holes.find((h) => h.zb > o.zb);
      const top = next ? next.zb : H;
      solid(t0, t1, top, top);
      base = top;
      if (!next) break;
    }
    if (!holes.length) solid(base, base, H, H);
  }
  // Piédroits des ouvertures (côtés verticaux du passage).
  for (const o of lay.openings) {
    for (const [s, dir] of [[o.s0, 1], [o.s1, -1]] as const) {
      q(mb, f, [s, -hw, z(Math.max(o.zb, -0.6))], [s, hw, z(Math.max(o.zb, -0.6))], [s, hw, z(o.spring)], [s, -hw, z(o.spring)], N(f, dir, 0), inner);
    }
  }
  // Dessus, bouts, corniches, pilastres de la galerie.
  q(mb, f, [-f.hl, -hw, z(H)], [f.hl, -hw, z(H)], [f.hl, hw, z(H)], [-f.hl, hw, z(H)], [0, 1, 0], shade(stone, 1.05));
  for (const side of [1, -1]) {
    const s = side * f.hl;
    q(mb, f, [s, side * hw, z(-0.6)], [s, -side * hw, z(-0.6)], [s, -side * hw, z(H)], [s, side * hw, z(H)], N(f, side, 0), shade(stone, 0.9));
  }
  for (const [c0, c1] of lay.cornices) box(mb, f, -f.hl - 0.15, f.hl + 0.15, -hw - 0.18, hw + 0.18, z(c0), z(c1), shade(stone, 1.08));
  for (const s of lay.pilasters) {
    for (const side of [1, -1]) box(mb, f, s - 0.14, s + 0.14, side === 1 ? hw : -hw - 0.1, side === 1 ? hw + 0.1 : -hw, z(lay.gallery[0]), z(lay.cornices[1]![0]), shade(stone, 1.04));
  }
}

// --- Cathédrale -------------------------------------------------------------------------------------------------------------------

/** Toit à deux pans le long de s (ou de t avec `alongT`), égout `ze`, faîtage `zr`, pignons pleins. */
function gable(mb: MeshBuilder, f: Frame, s0: number, s1: number, t0: number, t1: number, ze: number, zr: number, roof: THREE.Color, wall: THREE.Color, alongT = false): void {
  if (!alongT) {
    const tm = (t0 + t1) / 2;
    const slope = (zr - ze) / ((t1 - t0) / 2);
    const nl = Math.hypot(1, slope);
    q(mb, f, [s0, t0, ze], [s1, t0, ze], [s1, tm, zr], [s0, tm, zr], toThree((-f.vx * slope) / nl, (-f.vy * slope) / nl, 1 / nl), roof);
    q(mb, f, [s1, t1, ze], [s0, t1, ze], [s0, tm, zr], [s1, tm, zr], toThree((f.vx * slope) / nl, (f.vy * slope) / nl, 1 / nl), shade(roof, 0.9));
    for (const [s, dir] of [[s0, -1], [s1, 1]] as const) mb.tri(P(f, s, t0, ze), P(f, s, t1, ze), P(f, s, tm, zr), N(f, dir, 0), wall);
  } else {
    const sm = (s0 + s1) / 2;
    const slope = (zr - ze) / ((s1 - s0) / 2);
    const nl = Math.hypot(1, slope);
    q(mb, f, [s0, t1, ze], [s0, t0, ze], [sm, t0, zr], [sm, t1, zr], toThree((-f.ux * slope) / nl, (-f.uy * slope) / nl, 1 / nl), roof);
    q(mb, f, [s1, t0, ze], [s1, t1, ze], [sm, t1, zr], [sm, t0, zr], toThree((f.ux * slope) / nl, (f.uy * slope) / nl, 1 / nl), shade(roof, 0.9));
    for (const [t, dir] of [[t0, -1], [t1, 1]] as const) mb.tri(P(f, s0, t, ze), P(f, s1, t, ze), P(f, sm, t, zr), N(f, 0, dir), wall);
  }
}

/** Pyramide (flèche) à `sides` pans sur un carré ou un octogone de rayon r centré en (s, t), de zb à la pointe zt. */
function spire(mb: MeshBuilder, f: Frame, s: number, t: number, r: number, zb: number, zt: number, sides: number, color: THREE.Color): void {
  const apex = P(f, s, t, zt);
  const slope = r / Math.max(zt - zb, 0.1), nl = Math.hypot(1, slope);
  for (let i = 0; i < sides; i++) {
    const a0 = Math.PI / sides + (2 * Math.PI * i) / sides, a1 = a0 + (2 * Math.PI) / sides, am = (a0 + a1) / 2;
    const p0 = P(f, s + Math.cos(a0) * r, t + Math.sin(a0) * r, zb), p1 = P(f, s + Math.cos(a1) * r, t + Math.sin(a1) * r, zb);
    const n = N(f, Math.cos(am) / nl, Math.sin(am) / nl);
    mb.tri(p0, p1, apex, [n[0], slope / nl, n[2]], shade(color, 0.92 + (i % 2) * 0.1));
  }
}

/** Ouverture sombre en plein cintre sur une face de normale s (côté `dir`), centrée en t, de z0 à z0 + h (arc compris). */
function archFace(mb: MeshBuilder, f: Frame, s: number, dir: number, t: number, w: number, z0: number, h: number, color: THREE.Color): void {
  const n = N(f, dir, 0);
  const spring = z0 + h - w / 2;
  q(mb, f, [s, t - w / 2, z0], [s, t + w / 2, z0], [s, t + w / 2, spring], [s, t - w / 2, spring], n, color);
  for (let i = 0; i < 8; i++) {
    const a0 = (Math.PI * i) / 8, a1 = (Math.PI * (i + 1)) / 8;
    mb.tri(P(f, s, t, spring), P(f, s, t + Math.cos(a0) * (w / 2), spring + Math.sin(a0) * (w / 2)), P(f, s, t + Math.cos(a1) * (w / 2), spring + Math.sin(a1) * (w / 2)), n, color);
  }
}

/**
 * Cathédrale (Saint-Lazare, D95) d'après les volumes mesurés : nef haute à deux pans au-dessus des bas-côtés (le bâtiment générique),
 * transept, chœur et abside en hémicycle, tour de croisée à baies et flèche octogonale à clochetons, deux tours de façade, grand portail.
 */
export function buildCathedral(mb: MeshBuilder, m: CathedralSpec, terrain: HeightField, roofColor: THREE.Color): void {
  const f = frameOf(m.c[0], m.c[1], m.a, 1, 1);
  const g = (s: number, t: number): number => { const [x, y] = at(f, s, t); return terrain.heightAt(x, y) - 0.5; };
  const wall = STONE, slate = C(T.roofs.ardoise);
  const ridge = m.g + m.ridge, eave = ridge - 8;
  const t0 = m.t0;
  // Nef.
  const n0 = m.west + 6, n1 = m.cross - 5.5;
  box(mb, f, n0, n1, t0 - 5.5, t0 + 5.5, g(n0, t0), eave, wall);
  gable(mb, f, n0 - 0.4, n1, t0 - 6, t0 + 6, eave, ridge, roofColor, wall);
  // Transept (pignons au bout des bras).
  const arm = 16;
  box(mb, f, m.cross - 5.5, m.cross + 5.5, t0 - arm, t0 + arm, g(m.cross, t0), eave - 1, wall);
  gable(mb, f, m.cross - 6, m.cross + 6, t0 - arm - 0.3, t0 + arm + 0.3, eave - 1, ridge - 1, roofColor, wall, true);
  // Chœur et abside.
  const c1 = Math.max(m.cross + 6, m.east - 6.5);
  box(mb, f, m.cross + 5.5, c1, t0 - 5, t0 + 5, g(c1, t0), eave - 2, wall);
  gable(mb, f, m.cross + 5.5, c1, t0 - 5.5, t0 + 5.5, eave - 2, ridge - 2, roofColor, wall);
  const R = 5;
  for (let i = 0; i < 9; i++) {
    const a0 = -Math.PI / 2 + (Math.PI * i) / 9, a1 = -Math.PI / 2 + (Math.PI * (i + 1)) / 9, am = (a0 + a1) / 2;
    const p = (a: number, zz: number): [number, number, number] => [c1 + Math.cos(a) * R, t0 + Math.sin(a) * R, zz];
    q(mb, f, p(a0, g(c1 + R, t0)), p(a1, g(c1 + R, t0)), p(a1, eave - 2), p(a0, eave - 2), N(f, Math.cos(am), Math.sin(am)), wall);
    const nl = Math.hypot(1, 6 / R);
    mb.tri(P(f, ...p(a0, eave - 2)), P(f, ...p(a1, eave - 2)), P(f, c1, t0, ridge - 2), [N(f, Math.cos(am) / nl, Math.sin(am) / nl)[0], 0.8, N(f, Math.cos(am) / nl, Math.sin(am) / nl)[2]], shade(roofColor, 0.95));
  }
  // Tour de croisée, baies, flèche octogonale et clochetons.
  const side = 4.6;
  box(mb, f, m.cross - side, m.cross + side, t0 - side, t0 + side, g(m.cross, t0), m.body, shade(wall, 0.97), shade(wall, 0.8));
  for (const [dir, axisT] of [[1, false], [-1, false], [1, true], [-1, true]] as const) {
    for (const k of [-1, 1]) {
      for (const level of [0, 1]) {
        const zb = m.body - 13 + level * 6.5;
        if (!axisT) archFace(mb, f, m.cross + dir * (side + 0.02), dir, t0 + k * 1.9, 1.5, zb, 4.5, C("#3a3634"));
        else {
          // Faces de normale t : même ouverture, tournée d'un quart.
          const n = N(f, 0, dir);
          const tt = t0 + dir * (side + 0.02), ss = m.cross + k * 1.9;
          q(mb, f, [ss + 0.75, tt, zb], [ss - 0.75, tt, zb], [ss - 0.75, tt, zb + 3.75], [ss + 0.75, tt, zb + 3.75], n, C("#3a3634"));
        }
      }
    }
  }
  box(mb, f, m.cross - side - 0.3, m.cross + side + 0.3, t0 - side - 0.3, t0 + side + 0.3, m.body - 0.6, m.body, shade(wall, 1.08));
  spire(mb, f, m.cross, t0, side * 0.95, m.body, m.tip, 8, slate);
  for (const ks of [-1, 1]) for (const kt of [-1, 1]) spire(mb, f, m.cross + ks * (side - 0.6), t0 + kt * (side - 0.6), 0.7, m.body, m.body + 7, 4, slate);
  // Tours de façade et portail.
  const w0 = m.west + 0.5;
  for (const k of [-1, 1]) {
    const tt = t0 + k * 6.2;
    box(mb, f, w0, w0 + 6.5, tt - 3.2, tt + 3.2, g(w0 + 3, tt), m.towers, shade(wall, 0.98));
    spire(mb, f, w0 + 3.25, tt, 3.6, m.towers, m.towers + 4, 4, slate);
  }
  box(mb, f, w0, w0 + 6.5, t0 - 3, t0 + 3, g(w0, t0), eave + 2, wall);
  gable(mb, f, w0, w0 + 6.5, t0 - 3.3, t0 + 3.3, eave + 2, eave + 5, roofColor, wall);
  const zp = g(w0, t0) + 0.5;
  archFace(mb, f, w0 - 0.02, -1, t0, 5.6, zp, 9.5, shade(STONE, 1.08));
  archFace(mb, f, w0 - 0.04, -1, t0, 4.4, zp, 8.6, C("#d8c9a8"));
  q(mb, f, [w0 - 0.06, t0 - 2.2, zp], [w0 - 0.06, t0 + 2.2, zp], [w0 - 0.06, t0 + 2.2, zp + 6.0], [w0 - 0.06, t0 - 2.2, zp + 6.0], N(f, -1, 0), C("#4a3424"));
  q(mb, f, [w0 - 0.06, t0 - 2.2, zp + 6.0], [w0 - 0.06, t0 + 2.2, zp + 6.0], [w0 - 0.06, t0 + 2.2, zp + 6.3], [w0 - 0.06, t0 - 2.2, zp + 6.3], N(f, -1, 0), STONE_DARK);
}

// --- Hôtel de ville ---------------------------------------------------------------------------------------------------------------

/** Pierre blonde (soubassement, étage, chaînes), étage noble clair, encadrements et corniche, grilles des arcades (photo, D123). */
const HALL_STONE = C("#e0bd84");
const HALL_LIGHT = C("#f1e9d6");
const HALL_TRIM = C(T.trim);
const HALL_GRILLE = C("#2f3532");
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
/** Saillie des pavillons sur la façade, débord du toit du corps principal. */
const PROJ = 0.35, OVERHANG = 0.3;

type ST = [number, number];

/** Normale (three) du triangle a, b, c, tournée vers le haut : pans de toit. */
function upNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (ny < 0) [nx, ny, nz] = [-nx, -ny, -nz];
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Pan de toit plan (ou presque) a, b, c, d en (s, t, z) : deux triangles, chacun avec sa normale. */
function pan(mb: MeshBuilder, f: Frame, a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number] | null, col: THREE.Color): void {
  const A = P(f, ...a), B = P(f, ...b), Cc = P(f, ...c);
  mb.tri(A, B, Cc, upNormal(A, B, Cc), col);
  if (d) {
    const D = P(f, ...d);
    mb.tri(A, Cc, D, upNormal(A, Cc, D), col);
  }
}

/** Mur droit de a à b (s, t), normale `out` (dans le repère), du sol jusqu'à `top`, en bandes de couleur coupées aux altitudes `cuts`. */
interface HallWall {
  a: ST;
  b: ST;
  out: ST;
  top: number;
  front: boolean;
}

function wallBands(mb: MeshBuilder, f: Frame, w: HallWall, ground: (s: number, t: number) => number, cuts: number[], colors: THREE.Color[]): void {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const n = N(f, w.out[0], w.out[1]);
  const pieces = Math.max(1, Math.ceil(len / 3));
  for (let i = 0; i < pieces; i++) {
    const f0 = i / pieces, f1 = (i + 1) / pieces;
    const p0: ST = [w.a[0] + (w.b[0] - w.a[0]) * f0, w.a[1] + (w.b[1] - w.a[1]) * f0];
    const p1: ST = [w.a[0] + (w.b[0] - w.a[0]) * f1, w.a[1] + (w.b[1] - w.a[1]) * f1];
    const z0 = ground(...p0) - 0.4, z1 = ground(...p1) - 0.4;
    for (let k = 0; k < colors.length; k++) {
      const lo = k === 0 ? -Infinity : cuts[k - 1]!, hi = Math.min(w.top, k < cuts.length ? cuts[k]! : Infinity);
      const b0 = Math.min(Math.max(z0, lo), hi), b1 = Math.min(Math.max(z1, lo), hi);
      if (hi - b0 < 0.01 && hi - b1 < 0.01) continue;
      q(mb, f, [p0[0], p0[1], b0], [p1[0], p1[1], b1], [p1[0], p1[1], hi], [p0[0], p0[1], hi], n, colors[k]!);
    }
  }
}

/** Bandeau ou corniche le long d'un mur : face avant à `proj` du mur, dessus et dessous. */
function course(mb: MeshBuilder, f: Frame, w: HallWall, z0: number, z1: number, proj: number, col: THREE.Color): void {
  const o = (p: ST, d: number): ST => [p[0] + w.out[0] * d, p[1] + w.out[1] * d];
  const a = o(w.a, proj), b = o(w.b, proj);
  q(mb, f, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], N(f, w.out[0], w.out[1]), col);
  q(mb, f, [w.a[0], w.a[1], z1], [w.b[0], w.b[1], z1], [b[0], b[1], z1], [a[0], a[1], z1], [0, 1, 0], shade(col, 1.04));
  q(mb, f, [w.a[0], w.a[1], z0], [w.b[0], w.b[1], z0], [b[0], b[1], z0], [a[0], a[1], z0], [0, -1, 0], shade(col, 0.8));
}

/**
 * Baie sur un mur, à `u` mètres de son début : encadrement clair, vitre (ou grille sombre), en plein cintre si `arched` (h compte l'arc) ;
 * une baie sur deux ou trois s'allume la nuit.
 */
function bay(mb: MeshBuilder, glow: MeshBuilder, f: Frame, w: HallWall, u: number, wd: number, z0: number, h: number, arched: boolean, grille: boolean, lit: boolean): void {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const dx = (w.b[0] - w.a[0]) / len, dy = (w.b[1] - w.a[1]) / len;
  const pt = (uu: number, z: number, off: number): [number, number, number] => [w.a[0] + dx * uu + w.out[0] * off, w.a[1] + dy * uu + w.out[1] * off, z];
  const n = N(f, w.out[0], w.out[1]);
  const shape = (target: MeshBuilder, half: number, zb: number, top: number, off: number, lo: THREE.Color, hi: THREE.Color): void => {
    const spring = arched ? top - half : top;
    const a = P(f, ...pt(u - half, zb, off)), b = P(f, ...pt(u + half, zb, off)), c = P(f, ...pt(u + half, spring, off)), d = P(f, ...pt(u - half, spring, off));
    target.quadGradient(a, b, c, d, n, lo, hi);
    if (!arched) return;
    const centre = P(f, ...pt(u, spring, off));
    for (let i = 0; i < 6; i++) {
      const a0 = (Math.PI * i) / 6, a1 = (Math.PI * (i + 1)) / 6;
      target.tri(centre, P(f, ...pt(u + Math.cos(a0) * half, spring + Math.sin(a0) * half, off)), P(f, ...pt(u + Math.cos(a1) * half, spring + Math.sin(a1) * half, off)), n, hi);
    }
  };
  shape(mb, wd / 2 + 0.18, z0 - 0.18, z0 + h + (arched ? 0.18 : 0.14), 0.03, HALL_TRIM, HALL_TRIM);
  if (grille) shape(mb, wd / 2, z0, z0 + h, 0.05, HALL_GRILLE, shade(HALL_GRILLE, 1.2));
  else shape(mb, wd / 2, z0, z0 + h, 0.05, C(T.glass[0]), C(T.glass[1]));
  if (lit && !grille) shape(glow, wd / 2, z0, z0 + h, 0.056, GLOW_LO, GLOW_HI);
}

/**
 * Hôtel de ville (D123) d'après photo et relevé LiDAR : corps principal sur la façade (corniche et toit à deux pans), pavillons en légère
 * saillie à toits raides tronqués (deux d'angle, un central), ailes basses autour de la cour (toit à deux pans sur la ligne médiane, croupes
 * aux angles) ; trois niveaux (soubassement et étage en pierre blonde, étage noble clair) et les travées de la façade.
 */
export function buildTownHall(mb: MeshBuilder, glow: MeshBuilder, m: TownHallSpec, terrain: HeightField, roofColor: THREE.Color): void {
  const f = frameOf(m.o[0], m.o[1], m.a, 1, 1);
  const ground = (s: number, t: number): number => terrain.heightAt(...at(f, s, t));
  const R: ST[] = [], H: ST[] = [];
  for (let i = 0; i < m.ring.length; i += 2) R.push([m.ring[i]!, m.ring[i + 1]!]);
  for (let i = 0; i < m.court.length; i += 2) H.push([m.court[i]!, m.court[i + 1]!]);
  const n = R.length, d = m.d, L = m.l, p = L / m.bays;
  const L1 = m.g + m.levels[0], L2 = m.g + m.levels[1];
  // Côtés du corps principal : abscisse du contour à la profondeur t (côtés 0 ← n−1 et 1 → 2).
  const sL = (t: number): number => R[0]![0] + ((R[n - 1]![0] - R[0]![0]) * t) / R[n - 1]![1];
  const sR = (t: number): number => R[1]![0] + ((R[2]![0] - R[1]![0]) * t) / R[2]![1];
  const pavs = m.pav.map(([s0, s1, ps0, ps1, pt0, pt1, top]) => ({ s0, s1, ps0, ps1, pt0, pt1, top, left: s0 < 0.05, right: s1 > L - 0.05 }));
  const sOf = (pv: (typeof pavs)[number], side: 0 | 1, t: number): number => (side === 0 ? (pv.left ? sL(t) : pv.s0) : pv.right ? sR(t) : pv.s1);
  const outOf = (a: ST, b: ST, court = false): ST => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return court ? [-(b[1] - a[1]) / l, (b[0] - a[0]) / l] : [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
  };
  const W = (a: ST, b: ST, top: number, front = false, court = false): HallWall => ({ a, b, out: outOf(a, b, court), top, front });

  // Murs (contour dans le sens trigonométrique : extérieur à droite, cour à gauche).
  const body: HallWall[] = [];
  let s = 0;
  for (const pv of [...pavs].sort((x, y) => x.s0 - y.s0)) {
    if (pv.s0 - s > 0.05) body.push(W([s, 0], [pv.s0, 0], m.eave, true));
    if (!pv.left) body.push(W([pv.s0, 0], [pv.s0, -PROJ], m.eave));
    body.push(W([sOf(pv, 0, -PROJ), -PROJ], [sOf(pv, 1, -PROJ), -PROJ], m.eave, true));
    if (!pv.right) body.push(W([pv.s1, -PROJ], [pv.s1, 0], m.eave));
    s = pv.s1;
  }
  if (L - s > 0.05) body.push(W([s, 0], [L, 0], m.eave, true));
  const t0L = pavs.some((pv) => pv.left) ? -PROJ : 0, t0R = pavs.some((pv) => pv.right) ? -PROJ : 0;
  body.push(W([sR(t0R), t0R], [sR(d), d], m.eave), W([sL(d), d], [sL(t0L), t0L], m.eave));
  // Ailes basses : murs extérieurs au-delà du corps principal, murs de la cour.
  const wings: HallWall[] = [];
  for (let i = 1; i < n; i++) {
    let a = R[i]!, b = R[(i + 1) % n]!;
    if (a[1] < d && b[1] < d) continue;
    if (a[1] < d) a = [a[0] + ((b[0] - a[0]) * (d - a[1])) / (b[1] - a[1]), d];
    if (b[1] < d) b = [a[0] + ((b[0] - a[0]) * (d - a[1])) / (b[1] - a[1]), d];
    wings.push(W(a, b, m.wingEave));
  }
  for (let i = 0; i < n; i++) wings.push(W(H[i]!, H[(i + 1) % n]!, m.wingEave, false, true));

  const colors = [HALL_STONE, HALL_LIGHT, HALL_STONE];
  for (const w of [...body, ...wings]) {
    wallBands(mb, f, w, ground, [L1, L2], colors);
    course(mb, f, w, w.top - 0.45, w.top, 0.3, HALL_TRIM);
    if (w.front) {
      course(mb, f, w, L1 - 0.1, L1 + 0.18, 0.12, HALL_TRIM);
      course(mb, f, w, L2 - 0.1, L2 + 0.18, 0.12, HALL_TRIM);
    }
  }

  // Façade : les travées, à pas régulier ; l'avant-corps central a portes et baies en plein cintre, pas d'arcade (perron).
  const centre = pavs.filter((pv) => !pv.left && !pv.right);
  for (let i = 0; i < m.bays; i++) {
    const sc = (i + 0.5) * p;
    const w = body.find((x) => x.front && Math.min(x.a[0], x.b[0]) <= sc && sc <= Math.max(x.a[0], x.b[0]));
    if (!w) continue;
    const u = sc - w.a[0];
    const mid = centre.some((pv) => pv.s0 < sc && sc < pv.s1);
    const lit = (i * 7 + 3) % 5 < 2;
    if (!mid) bay(mb, glow, f, w, u, 1.7, m.g + 0.45, m.levels[0] - 1.05, true, true, false);
    if (mid) bay(mb, glow, f, w, u, 1.8, L1 + 0.05, 4.6, true, false, lit);
    else bay(mb, glow, f, w, u, 1.35, L1 + 1.1, 3.4, false, false, lit);
    if (mid) bay(mb, glow, f, w, u, 1.45, L2 + 0.8, 3.3, true, false, !lit);
    else bay(mb, glow, f, w, u, 1.3, L2 + 0.9, 2.6, false, false, !lit);
  }
  // Autres murs : fenêtres simples tous les 4 m environ, aux mêmes niveaux, là où elles tiennent entre le sol et la corniche.
  for (const w of [...body.filter((x) => !x.front), ...wings]) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const count = Math.floor((len - 1.5) / 4);
    for (let k = 0; k < count; k++) {
      const u = ((k + 0.5) * len) / count;
      const fr = u / len;
      const gz = ground(w.a[0] + (w.b[0] - w.a[0]) * fr, w.a[1] + (w.b[1] - w.a[1]) * fr);
      for (const [lv, [z0, h]] of ([[m.g + 0.9, 2.4], [L1 + 1.1, 3.2], [L2 + 0.9, 2.6]] as const).entries()) {
        const hh = Math.min(h, w.top - 0.7 - z0);
        if (z0 < gz + 0.4 || hh < 1.2) continue;
        bay(mb, glow, f, w, u, 1.25, z0, hh, false, false, (k * 5 + lv * 3 + Math.round(len)) % 7 < 3);
      }
    }
  }

  // Toits. Corps principal : deux pans entre les pavillons d'angle (le bout est caché dans leur toit), faîtage au milieu.
  const slope = (m.ridge - m.eave) / (d / 2);
  const left = pavs.find((pv) => pv.left), right = pavs.find((pv) => pv.right);
  const A0 = left ? left.s1 - 2.5 : sL(0), B0 = right ? right.s0 + 2.5 : sR(0);
  pan(mb, f, [A0, -OVERHANG, m.eave - slope * OVERHANG], [B0, -OVERHANG, m.eave - slope * OVERHANG], [B0, d / 2, m.ridge], [A0, d / 2, m.ridge], roofColor);
  pan(mb, f, [A0, d, m.eave], [B0, d, m.eave], [B0, d / 2, m.ridge], [A0, d / 2, m.ridge], roofColor);
  for (const [sx, dir, has] of [[A0, -1, left], [B0, 1, right]] as const) {
    if (!has) mb.tri(P(f, sx, 0, m.eave), P(f, sx, d, m.eave), P(f, sx, d / 2, m.ridge), N(f, dir, 0), HALL_STONE);
  }
  // Pavillons : tronc de pyramide de la base (corniche) au plateau mesuré.
  const zinc = shade(roofColor, 1.18);
  for (const pv of pavs) {
    const t0 = -PROJ - 0.1;
    const base: [number, number, number][] = [[sOf(pv, 0, t0) - 0.1, t0, m.eave], [sOf(pv, 1, t0) + 0.1, t0, m.eave], [sOf(pv, 1, d) + 0.1, d, m.eave], [sOf(pv, 0, d) - 0.1, d, m.eave]];
    const top: [number, number, number][] = [[pv.ps0, pv.pt0, pv.top], [pv.ps1, pv.pt0, pv.top], [pv.ps1, pv.pt1, pv.top], [pv.ps0, pv.pt1, pv.top]];
    for (let k = 0; k < 4; k++) pan(mb, f, base[k]!, base[(k + 1) % 4]!, top[(k + 1) % 4]!, top[k]!, k % 2 ? shade(roofColor, 0.94) : roofColor);
    pan(mb, f, top[0]!, top[1]!, top[2]!, top[3]!, zinc);
  }
  // Ailes basses : un pan extérieur et un pan sur cour par côté, faîtage sur la ligne médiane (le côté de la façade n'a que le pan sur cour).
  const M: [number, number][] = R.map((r, i) => [(r[0] + H[i]![0]) / 2, (r[1] + H[i]![1]) / 2]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mi: [number, number, number] = [M[i]![0], M[i]![1], m.wingRidge], mj: [number, number, number] = [M[j]![0], M[j]![1], m.wingRidge];
    if (i !== 0) pan(mb, f, [R[i]![0], R[i]![1], m.wingEave], [R[j]![0], R[j]![1], m.wingEave], mj, mi, roofColor);
    pan(mb, f, [H[i]![0], H[i]![1], m.wingEave], [H[j]![0], H[j]![1], m.wingEave], mj, mi, shade(roofColor, 0.96));
  }
}

/** Clocher lointain : tour et flèche simples, pour l'horizon (D95). `t` : x, y, côté, haut de la tour, pointe. */
export function buildFarTower(mb: MeshBuilder, t: [number, number, number, number, number], terrain: HeightField): void {
  const [x, y, side, body, tip] = t;
  const f = frameOf(x, y, 0, side, side);
  const h = side / 2;
  box(mb, f, -h, h, -h, h, terrain.heightAt(x, y) - 1, body, STONE);
  if (tip - body > 0.8) spire(mb, f, 0, 0, h * (tip - body > 6 ? 0.95 : 1.1), body, tip, tip - body > 6 ? 8 : 4, C(T.roofs.ardoise));
}
