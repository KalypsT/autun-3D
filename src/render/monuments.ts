import * as THREE from "three";
import type { CathedralSpec, HeightField, Site } from "../data/types";
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

/** Clocher lointain : tour et flèche simples, pour l'horizon (D95). `t` : x, y, côté, haut de la tour, pointe. */
export function buildFarTower(mb: MeshBuilder, t: [number, number, number, number, number], terrain: HeightField): void {
  const [x, y, side, body, tip] = t;
  const f = frameOf(x, y, 0, side, side);
  const h = side / 2;
  box(mb, f, -h, h, -h, h, terrain.heightAt(x, y) - 1, body, STONE);
  if (tip - body > 0.8) spire(mb, f, 0, 0, h * (tip - body > 6 ? 0.95 : 1.1), body, tip, tip - body > 6 ? 8 : 4, C(T.roofs.ardoise));
}
