import * as THREE from "three";
import type { CathedralModel, CathedralSpec, CollegeSpec, CollegeWing, HeightField, Site, TownHallSpec } from "../data/types";
import { at, frameOf, porchLayout, type Frame } from "../core/landmarks";
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
    if (flood) flood.glow.quadGradient(p0, p1, apex, apex, [n[0], slope / nl, n[2]], floodAt(zb), floodAt(zt));
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

// --- Cathédrale d'après photo (D127) ------------------------------------------------------------------------------------------------

/** Tuiles plates brun-ocre (nef, bas-côtés, transept, chœur), toits gris-vert des chapelles, pierre grise de la flèche, baies sombres (photos). */
const TILE_BROWN = C("#a8603c");
const LEAD = C("#7f8f86");
const SPIRE_STONE = C("#aaa294");
const BAY = C("#34404c");
/** Tuiles vernissées du chevet (photos) : fond jaune d'ocre, résille verte, losanges rouges et brun-noir. */
const GLAZE_FILL = C("#d9a83a"), GLAZE_NET = C("#2f6a48"), GLAZE_RED = C("#a8432c"), GLAZE_DARK = C("#2e2723");

type Pt = [number, number];

/**
 * Éclairage de nuit de la cathédrale (D132, photo de nuit) : pendant `buildSaintLazare`, les murs et les flèches sont doublés dans le maillage
 * des vitres allumées (visible la nuit seulement), en dégradé chaud du pied (projecteurs) vers le haut ; les toits restent sombres.
 */
let flood: { glow: MeshBuilder; g: number } | null = null;
const FLOOD_LOW = C("#ffd08a"), FLOOD_HIGH = C("#9e7a52");
function floodAt(z: number): THREE.Color {
  const k = Math.min(1, Math.max(0, (z - flood!.g) / 60));
  return FLOOD_LOW.clone().lerp(FLOOD_HIGH, Math.sqrt(k));
}
/**
 * Baies et encadrements la nuit : redessinés dans le maillage éclairé, après le mur (sans quoi l'éclairage, tiré vers la caméra, les couvre
 * de loin) ; les baies restent sombres, les encadrements prennent la lumière, un peu plus sombre.
 */
const NIGHT_BAY = C("#1c2436");
function nightCopy(col: THREE.Color, z: number, draw: (glow: MeshBuilder, col: THREE.Color) => void): void {
  if (!flood) return;
  const fl = flood, c = col === BAY ? NIGHT_BAY : shade(floodAt(z), 0.8);
  flood = null;
  try {
    draw(fl.glow, c);
  } finally {
    flood = fl;
  }
}

/** Double éclairé d'un quad du repère (a, b en bas, c, d en haut). */
function lit(f: Frame, a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], n: Vec3, k = 1): void {
  if (flood) flood.glow.quadGradient(P(f, ...a), P(f, ...b), P(f, ...c), P(f, ...d), n, shade(floodAt((a[2] + b[2]) / 2), k), shade(floodAt((c[2] + d[2]) / 2), k));
}

/** Mur droit de a à b (s, t), normale `out`, du sol jusqu'aux hauts za (en a) et zb (en b), en pans de 6 m au plus pour suivre le relief. */
function wallST(mb: MeshBuilder, f: Frame, a: Pt, b: Pt, za: number, zb: number, ground: (s: number, t: number) => number, col: THREE.Color): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.01) return;
  const n = N(f, (b[1] - a[1]) / len, -(b[0] - a[0]) / len);
  const k = Math.max(1, Math.ceil(len / 6));
  for (let i = 0; i < k; i++) {
    const u0 = i / k, u1 = (i + 1) / k;
    const p0: Pt = [a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0], p1: Pt = [a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1];
    const z0 = za + (zb - za) * u0, z1 = za + (zb - za) * u1;
    q(mb, f, [...p0, ground(...p0)], [...p1, ground(...p1)], [...p1, z1], [...p0, z0], n, col);
    lit(f, [...p0, ground(...p0)], [...p1, ground(...p1)], [...p1, z1], [...p0, z0], n);
  }
}

/** Murs d'un contour (s, t) dans le sens trigonométrique, haut `top` en chaque sommet. */
function prismST(mb: MeshBuilder, f: Frame, pts: Pt[], top: (p: Pt) => number, ground: (s: number, t: number) => number, col: THREE.Color): void {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    wallST(mb, f, a, b, top(a), top(b), ground, col);
  }
}

const rectST = (s0: number, s1: number, t0: number, t1: number): Pt[] => [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];

/**
 * Baie en plein cintre (ou en arc brisé, `pointed`) sur le mur de a à b (normale sortante à droite de a → b), centrée à `u` mètres de a, de z0
 * au sommet de l'arc z1.
 */
function archOn(mb: MeshBuilder, f: Frame, a: Pt, b: Pt, u: number, w: number, z0: number, z1: number, col: THREE.Color, off = 0.04, pointed = false): void {
  nightCopy(col, (z0 + z1) / 2, (glow, c) => archOn(glow, f, a, b, u, w, z0, z1, c, off, pointed));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ds = (b[0] - a[0]) / len, dt = (b[1] - a[1]) / len;
  const os = dt * off, ot = -ds * off;
  const n = N(f, dt, -ds);
  const at2 = (v: number, z: number): [number, number, number] => [a[0] + ds * (u + v) + os, a[1] + dt * (u + v) + ot, z];
  if (pointed) {
    // Arc brisé équilatéral : deux arcs de rayon w centrés aux naissances opposées.
    const spring = Math.max(z0, z1 - w * 0.866);
    q(mb, f, at2(-w / 2, z0), at2(w / 2, z0), at2(w / 2, spring), at2(-w / 2, spring), n, col);
    const arc: [number, number][] = [];
    for (let i = 0; i <= 3; i++) { const th = Math.PI - (Math.PI / 3) * (i / 3); arc.push([w / 2 + w * Math.cos(th), w * Math.sin(th)]); }
    for (const k of [1, -1]) for (let i = 0; i < 3; i++) {
      mb.tri(P(f, ...at2(0, spring)), P(f, ...at2(k * arc[i]![0], spring + arc[i]![1])), P(f, ...at2(k * arc[i + 1]![0], spring + arc[i + 1]![1])), n, col);
    }
    return;
  }
  const spring = Math.max(z0, z1 - w / 2);
  q(mb, f, at2(-w / 2, z0), at2(w / 2, z0), at2(w / 2, spring), at2(-w / 2, spring), n, col);
  for (let i = 0; i < 6; i++) {
    const a0 = (Math.PI * i) / 6, a1 = (Math.PI * (i + 1)) / 6;
    mb.tri(P(f, ...at2(0, spring)), P(f, ...at2(Math.cos(a0) * (w / 2), spring + Math.sin(a0) * (w / 2))), P(f, ...at2(Math.cos(a1) * (w / 2), spring + Math.sin(a1) * (w / 2))), n, col);
  }
}

/** Ouverture rectangulaire sur le mur de a à b (normale sortante à droite de a → b), centrée à `u` mètres de a, de z0 à z1. */
function rectOn(mb: MeshBuilder, f: Frame, a: Pt, b: Pt, u: number, w: number, z0: number, z1: number, col: THREE.Color, off = 0.03): void {
  nightCopy(col, (z0 + z1) / 2, (glow, c) => rectOn(glow, f, a, b, u, w, z0, z1, c, off));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ds = (b[0] - a[0]) / len, dt = (b[1] - a[1]) / len;
  const p = (v: number, z: number): [number, number, number] => [a[0] + ds * (u + v) + dt * off, a[1] + dt * (u + v) - ds * off, z];
  q(mb, f, p(-w / 2, z0), p(w / 2, z0), p(w / 2, z1), p(-w / 2, z1), N(f, dt, -ds), col);
}

/**
 * Mur plan de a à b (normale sortante à droite de a → b), du sol jusqu'à zt, percé d'une arcade en plein cintre de largeur w centrée à `u`
 * mètres de a, naissance à zs : piédroits pleins jusqu'en haut, tympan au-dessus de l'arc.
 */
function archWall(mb: MeshBuilder, f: Frame, a: Pt, b: Pt, zt: number, u: number, w: number, zs: number, ground: (s: number, t: number) => number, col: THREE.Color): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ds = (b[0] - a[0]) / len, dt = (b[1] - a[1]) / len;
  const pt = (v: number): Pt => [a[0] + ds * v, a[1] + dt * v];
  wallST(mb, f, a, pt(u - w / 2), zt, zt, ground, col);
  wallST(mb, f, pt(u + w / 2), b, zt, zt, ground, col);
  const n = N(f, dt, -ds);
  for (let i = 0; i < 8; i++) {
    const t0 = Math.PI - (Math.PI * i) / 8, t1 = Math.PI - (Math.PI * (i + 1)) / 8;
    const v0 = u + (w / 2) * Math.cos(t0), v1 = u + (w / 2) * Math.cos(t1);
    q(mb, f, [...pt(v0), zs + (w / 2) * Math.sin(t0)], [...pt(v1), zs + (w / 2) * Math.sin(t1)], [...pt(v1), zt], [...pt(v0), zt], n, col);
    lit(f, [...pt(v0), zs + (w / 2) * Math.sin(t0)], [...pt(v1), zs + (w / 2) * Math.sin(t1)], [...pt(v1), zt], [...pt(v0), zt], n);
  }
}

/** Intrados et piédroits de l'arcade d'`archWall` (même a, b, u, w, zs), sur l'épaisseur `depth` vers l'intérieur. */
function archSoffit(mb: MeshBuilder, f: Frame, a: Pt, b: Pt, u: number, w: number, zs: number, depth: number, ground: (s: number, t: number) => number, col: THREE.Color): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ds = (b[0] - a[0]) / len, dt = (b[1] - a[1]) / len;
  const pt = (v: number, d: number): Pt => [a[0] + ds * v - dt * d, a[1] + dt * v + ds * d];
  for (let i = 0; i < 8; i++) {
    const t0 = Math.PI - (Math.PI * i) / 8, t1 = Math.PI - (Math.PI * (i + 1)) / 8, tm = (t0 + t1) / 2;
    const v0 = u + (w / 2) * Math.cos(t0), v1 = u + (w / 2) * Math.cos(t1), z0 = zs + (w / 2) * Math.sin(t0), z1 = zs + (w / 2) * Math.sin(t1);
    const nh = N(f, -ds * Math.cos(tm), -dt * Math.cos(tm));
    q(mb, f, [...pt(v0, 0), z0], [...pt(v1, 0), z1], [...pt(v1, depth), z1], [...pt(v0, depth), z0], [nh[0], -Math.sin(tm), nh[2]], shade(col, 0.88));
  }
  for (const k of [-1, 1]) {
    const v = u + (k * w) / 2;
    const p0 = pt(v, 0), p1 = pt(v, depth);
    q(mb, f, [...p0, ground(...p0)], [...p1, ground(...p1)], [...p1, zs], [...p0, zs], N(f, -ds * k, -dt * k), shade(col, 0.92));
  }
}

/** Disque (oculus) sur le mur de a à b, centré à `u` mètres de a et à l'altitude zc. */
function roundOn(mb: MeshBuilder, f: Frame, a: Pt, b: Pt, u: number, zc: number, r: number, col: THREE.Color, off = 0.04): void {
  nightCopy(col, zc, (glow, c) => roundOn(glow, f, a, b, u, zc, r, c, off));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ds = (b[0] - a[0]) / len, dt = (b[1] - a[1]) / len;
  const p = (v: number, z: number): Vec3 => P(f, a[0] + ds * (u + v) + dt * off, a[1] + dt * (u + v) - ds * off, z);
  for (let i = 0; i < 8; i++) {
    const a0 = (Math.PI * i) / 4, a1 = (Math.PI * (i + 1)) / 4;
    mb.tri(p(0, zc), p(Math.cos(a0) * r, zc + Math.sin(a0) * r), p(Math.cos(a1) * r, zc + Math.sin(a1) * r), N(f, dt, -ds), col);
  }
}

/** Appentis de s0 à s1, du mur haut en tIn (haut zIn) au mur bas en tOut (haut zOut), débord `ov` côté bas. */
function leanTo(mb: MeshBuilder, f: Frame, s0: number, s1: number, tIn: number, tOut: number, zIn: number, zOut: number, ov: number, col: THREE.Color): void {
  const d = Math.sign(tOut - tIn), k = (zOut - zIn) / Math.abs(tOut - tIn);
  pan(mb, f, [s0, tIn, zIn], [s1, tIn, zIn], [s1, tOut + d * ov, zOut + k * ov], [s0, tOut + d * ov, zOut + k * ov], col);
}

type RoofPan = (mb: MeshBuilder, f: Frame, a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number] | null, col: THREE.Color) => void;

/**
 * Pan de tuiles vernissées (a, b à l'égout, c, d en haut ; d null : triangle) : rangs de losanges en quinconce, chacun fait de deux triangles
 * de part et d'autre d'une ligne de rang ; couleurs selon les deux diagonales du réseau : tous les quatre losanges, une résille verte dans
 * un sens et brun-noir dans l'autre, un losange rouge au cœur de chaque maille, fond jaune.
 */
function glazedPan(rows: number, cols: number): RoofPan {
  return (mb, f, a, b, c, d) => {
    const A = P(f, ...a), B = P(f, ...b), Cc = P(f, ...c), D = d ? P(f, ...d) : Cc;
    const n = upNormal(A, B, Cc);
    const lerp = (p: Vec3, r: Vec3, k: number): Vec3 => [p[0] + (r[0] - p[0]) * k, p[1] + (r[1] - p[1]) * k, p[2] + (r[2] - p[2]) * k];
    const pt = (v: number, x: number): Vec3 => lerp(lerp(A, D, v), lerp(B, Cc, v), Math.min(1, Math.max(0, x / cols)));
    const color = (line: number, centre: number): THREE.Color => {
      const du = (Math.round(centre * 2) + line - 1) / 2, dw = (Math.round(centre * 2) - line - 1) / 2;
      const iu = ((du % 4) + 4) % 4, iw = ((dw % 4) + 4) % 4;
      if (iu === 0) return GLAZE_NET;
      if (iw === 0) return GLAZE_DARK;
      return iu === 2 && iw === 2 ? GLAZE_RED : GLAZE_FILL;
    };
    for (let r = 0; r < rows; r++) {
      const v0 = r / rows, v1 = (r + 1) / rows, sh = r % 2 ? 0.5 : 0;
      for (let x = -sh; x < cols; x += 1) {
        // Triangle pointe en haut (moitié haute du losange de la ligne r), puis pointe en bas (moitié basse de celui de la ligne r + 1).
        if (x + 1 > 0) mb.tri(pt(v0, x), pt(v0, x + 1), pt(v1, x + 0.5), n, color(r, x + 0.5));
        if (x > 0 || sh === 0) mb.tri(pt(v1, x - 0.5), pt(v1, x + 0.5), pt(v0, x), n, color(r + 1, x));
      }
      if (sh === 0) mb.tri(pt(v1, cols - 0.5), pt(v1, cols), pt(v0, cols), n, color(r + 1, cols));
    }
  };
}

/** Toit en croupe sur le rectangle (pyramide s'il est carré), de l'égout ze au faîtage zr, faîtage le long du grand côté. */
function hipRoof(mb: MeshBuilder, f: Frame, s0: number, s1: number, t0: number, t1: number, ze: number, zr: number, col: THREE.Color, roofPan: RoofPan = pan): void {
  const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2, h = Math.min(s1 - s0, t1 - t0) / 2;
  const alongS = s1 - s0 >= t1 - t0;
  const r0: [number, number, number] = alongS ? [s0 + h, tm, zr] : [sm, t0 + h, zr];
  const r1: [number, number, number] = alongS ? [s1 - h, tm, zr] : [sm, t1 - h, zr];
  const c = (s: number, t: number): [number, number, number] => [s, t, ze];
  if (alongS) {
    roofPan(mb, f, c(s0, t0), c(s1, t0), r1, r0, col);
    roofPan(mb, f, c(s1, t1), c(s0, t1), r0, r1, shade(col, 0.9));
    roofPan(mb, f, c(s0, t1), c(s0, t0), r0, null, shade(col, 0.95));
    roofPan(mb, f, c(s1, t0), c(s1, t1), r1, null, shade(col, 0.95));
  } else {
    roofPan(mb, f, c(s0, t1), c(s0, t0), r0, r1, col);
    roofPan(mb, f, c(s1, t0), c(s1, t1), r1, r0, shade(col, 0.9));
    roofPan(mb, f, c(s0, t0), c(s1, t0), r0, null, shade(col, 0.95));
    roofPan(mb, f, c(s1, t1), c(s0, t1), r1, null, shade(col, 0.95));
  }
}

/**
 * Cathédrale Saint-Lazare d'après les photos de l'utilisateur et le LiDAR (D127), à pans nets : porche et ses deux tours, nef haute à deux
 * pans, bas-côtés en appentis, chapelles par travée, transept à pignons et bloc carré à toit en croupe au bout du bras ouest, tour de croisée
 * et flèche octogonale à clochetons, chœur, abside polygonale, bas-côtés du chœur. Remplace murs, toit et baies génériques du bâtiment.
 */
export function buildSaintLazare(mb: MeshBuilder, glow: MeshBuilder | null, m: CathedralModel, terrain: HeightField): void {
  flood = glow ? { glow, g: m.g } : null;
  try {
    lazare(mb, m, terrain);
  } finally {
    flood = null;
  }
}

function lazare(mb: MeshBuilder, m: CathedralModel, terrain: HeightField): void {
  const f = frameOf(m.c[0], m.c[1], m.a, 1, 1);
  const ground = (s: number, t: number): number => { const [x, y] = at(f, s, t); return terrain.heightAt(x, y) - 0.3; };
  const wall = STONE;
  const [p0, n0, pA, pB, pe, pr] = m.porch;
  const [w0, w1, tb, tt] = m.towers;
  const [, tr0, nA, nB, ne, nr] = m.nave;
  const [, tr1, tW, tE, te, trr] = m.transept;
  const [blk, be, bt] = m.block;
  const [sx, side, body, tip, sr] = m.tower;
  const [pin, gh] = m.spire;
  const [sc, cA, cB, ce, cr] = m.choir;
  const [r, ae, faces] = m.apse;
  const OV = 0.35;
  const flat = (z: number) => (): number => z;

  // Porche (D131, D132) : façade d'après les photos (grand arc à voussure et colonnes, cordon, galerie de cinq arcades dont trois ajourées,
  // corniche, contreforts entre l'arc et les tours, arcs plus bas sous les tours, fermés de grilles), trois marches sur toute la largeur,
  // salle voûtée en berceau à arcs aveugles, palier, volée jusqu'au seuil entre deux grilles, portail au fond ; arcades jumelles et oculus
  // sur ses flancs au-delà des tours (photo de la fontaine). On y entre : tabliers et obstacles dans `core/landmarks.ts` (porchLayout).
  const L = porchLayout(m);
  const { pc, TH, iA, iB, Rv, zV, Wo, zA, zP, zD } = L;
  const hAt = (s: number, t: number): number => { const [x, y] = at(f, s, t); return terrain.heightAt(x, y); };
  const above = (s0: number, s1: number, t0: number, t1: number, z: number): number => {
    let h = z;
    for (let s = s0; s <= s1 + 0.01; s += Math.max(0.25, (s1 - s0) / 2)) for (let t = t0; t <= t1 + 0.01; t += 0.5) h = Math.max(h, hAt(s, t) + 0.02);
    return h;
  };
  gable(mb, f, p0 - OV, n0, pA - OV, pB + OV, pe - 0.2, pr, TILE_BROWN, wall);
  wallST(mb, f, [p0, pA], [n0, pA], pe, pe, ground, wall);
  wallST(mb, f, [n0, pB], [p0, pB], pe, pe, ground, wall);
  archWall(mb, f, [p0, pB], [p0, pA], pe, pB - pc, Wo, zV, ground, wall);
  archSoffit(mb, f, [p0, pB], [p0, pA], pB - pc, Wo, zV, TH, ground, wall);
  archWall(mb, f, [p0 + TH, pA], [p0 + TH, pB], zV + Rv, pc - pA, Wo, zV, ground, PORCH_IN);
  // Voussure, colonnes engagées et chapiteaux du grand arc ; cordon, galerie d'arcades, corniche ; contreforts entre l'arc et les tours.
  const ring = (off: number, r0: number, r1: number, col: THREE.Color): void => {
    for (let i = 0; i < 12; i++) {
      const b0 = (Math.PI * i) / 12, b1 = (Math.PI * (i + 1)) / 12;
      const p = (r_: number, b: number): [number, number, number] => [p0 - off, pc + r_ * Math.cos(b), zV + r_ * Math.sin(b)];
      q(mb, f, p(r0, b0), p(r1, b0), p(r1, b1), p(r0, b1), N(f, -1, 0), col);
    }
  };
  ring(0.06, Wo / 2 + 0.05, Wo / 2 + 0.55, shade(wall, 1.08));
  ring(0.04, Wo / 2 + 0.55, Wo / 2 + 0.8, shade(wall, 0.86));
  for (const k of [-1, 1]) {
    const tc = pc + k * (Wo / 2 + 0.3);
    column(mb, f, p0 - 0.1, tc, 0.24, ground(p0, tc), zV - 0.5, shade(wall, 1.04));
    box(mb, f, p0 - 0.45, p0 + 0.2, tc - 0.4, tc + 0.4, zV - 0.55, zV, shade(wall, 1.1));
  }
  const zc = zV + Wo / 2 + 1.0;
  box(mb, f, p0 - 0.3, p0, pA, pB, zc, zc + 0.3, shade(wall, 1.06));
  const front: [Pt, Pt] = [[p0, pB], [p0, pA]];
  for (let k = 0; k < 5; k++) {
    const u = pB - pc + (k - 2) * 1.55;
    archOn(mb, f, front[0], front[1], u, 1.3, zc + 0.6, pe - 0.7, shade(wall, 0.84));
    if (k > 0 && k < 4) archOn(mb, f, front[0], front[1], u, 0.7, zc + 1.0, pe - 1.0, BAY, 0.07);
  }
  box(mb, f, p0 - 0.4, p0, pA - 0.2, pB + 0.2, pe - 0.35, pe, shade(wall, 1.06));
  for (const t of [pA, pB]) buttress(mb, f, m.a, p0, t, Math.PI, ground(p0, t), tb - 7.5);
  // Marches de la façade, sol du porche, volée et palier des portes : chaque marche au-dessus du relief (le joueur marche sur le plus haut
  // du relief et de la rampe).
  for (let k = 0; k < 3; k++) {
    const s0 = L.sE + (k * (p0 - L.sE)) / 3;
    box(mb, f, s0, p0 + 0.05, L.tE0, L.tE1, zA - 0.8, above(s0, p0, L.tE0, L.tE1, zA + ((k + 1) * (zP - zA)) / 3), RISER, TREAD);
  }
  box(mb, f, p0, p0 + TH, pc - Wo / 2, pc + Wo / 2, zP - 0.8, above(p0, p0 + TH, pc - Wo / 2, pc + Wo / 2, zP), RISER, TREAD);
  let zStep = above(p0 + TH, L.sR0, iA, iB, zP);
  box(mb, f, p0 + TH, L.sR0, iA, iB, zP - 0.8, zStep, RISER, TREAD);
  const nSteps = Math.max(1, Math.round((zD - zP) / 0.16)), dep = (L.sR1 - L.sR0) / nSteps;
  for (let k = 0; k < nSteps; k++) {
    const s0 = L.sR0 + k * dep;
    zStep = Math.max(zStep, above(s0, s0 + dep, iA, iB, zP + ((k + 1) * (zD - zP)) / nSteps));
    box(mb, f, s0, k === nSteps - 1 ? n0 : s0 + dep, iA, iB, zP - 0.8, zStep, RISER, TREAD);
  }
  // Grilles à pointes de part et d'autre de la volée (passage de 3,2 m au milieu), comme sur la photo.
  const sg = p0 + TH + 0.15;
  for (const [t0, t1] of [[iA, pc - 1.6], [pc + 1.6, iB]] as const) {
    box(mb, f, sg - 0.03, sg + 0.03, t0, t1, hAt(sg, (t0 + t1) / 2) + 1.0, hAt(sg, (t0 + t1) / 2) + 1.06, IRON);
    for (let t = t0 + 0.08; t <= t1; t += 0.16) box(mb, f, sg - 0.015, sg + 0.015, t - 0.015, t + 0.015, hAt(sg, t) - 0.05, hAt(sg, t) + 1.2, IRON);
  }
  wallST(mb, f, [n0, iA], [p0 + TH, iA], zV, zV, ground, PORCH_IN);
  wallST(mb, f, [p0 + TH, iB], [n0, iB], zV, zV, ground, PORCH_IN);
  for (const u of [0.3, 0.7]) {
    archOn(mb, f, [n0, iA], [p0 + TH, iA], (n0 - p0 - TH) * u, 2.8, hAt(n0 - (n0 - p0 - TH) * u, iA) + 0.6, zV - 0.6, shade(PORCH_IN, 0.86));
    archOn(mb, f, [p0 + TH, iB], [n0, iB], (n0 - p0 - TH) * u, 2.8, hAt(p0 + TH + (n0 - p0 - TH) * u, iB) + 0.6, zV - 0.6, shade(PORCH_IN, 0.86));
  }
  for (let i = 0; i < 10; i++) {
    const t0 = (Math.PI * i) / 10, t1 = (Math.PI * (i + 1)) / 10, tm = (t0 + t1) / 2;
    const v = (th: number): [number, number] => [pc - Rv * Math.cos(th), zV + Rv * Math.sin(th)];
    const [ta, za] = v(t0), [tb_, zb] = v(t1);
    const nh = N(f, 0, Math.cos(tm));
    q(mb, f, [p0 + TH, ta, za], [n0, ta, za], [n0, tb_, zb], [p0 + TH, tb_, zb], [nh[0], -Math.sin(tm), nh[2]], shade(PORCH_IN, 0.94 + 0.06 * Math.sin(tm)));
  }
  portal(mb, f, n0, pc, zD);
  for (const [a, b, uc] of [[[p0, pA], [n0, pA], (w0 + n0 - p0) / 2], [[n0, pB], [p0, pB], (n0 - p0 - w1) / 2]] as const) {
    const zg = ground(...(a as Pt));
    for (const k of [-1, 1]) archOn(mb, f, a as Pt, b as Pt, uc + k * 0.85, 1.3, zg + 1, zg + 4.4, BAY, 0.04, true);
    roundOn(mb, f, a as Pt, b as Pt, uc, zg + 5.4, 0.6, BAY);
  }
  // Tours du porche (D130, D132) : arc ouvert sous chaque tour en façade (plus bas que le grand arc, fermé d'une grille), contreforts aux
  // angles extérieurs, deux étages de baies jumelles en plein cintre dans un encadrement en retrait, cordon et corniche, flèche de pierre à
  // quatre pans, clochetons à ses angles.
  for (const [t0, t1, side] of [[pA - w0, pA, -1], [pB, pB + w1, 1]] as const) {
    const w = t1 - t0, s1 = p0 + w, tOut = side < 0 ? t0 : t1;
    wallST(mb, f, [p0, t0], [s1, t0], tb, tb, ground, wall);
    wallST(mb, f, [s1, t0], [s1, t1], tb, tb, ground, wall);
    wallST(mb, f, [s1, t1], [p0, t1], tb, tb, ground, wall);
    const ws = w * 0.62, top = zP + 0.62 * (zV + Wo / 2 - zP), spring = top - ws / 2;
    archWall(mb, f, [p0, t1], [p0, t0], tb, w / 2, ws, spring, ground, wall);
    archSoffit(mb, f, [p0, t1], [p0, t0], w / 2, ws, spring, 1.2, ground, wall);
    archOn(mb, f, [p0 + 1.2, t1], [p0 + 1.2, t0], w / 2, ws, ground(p0 + 1.2, (t0 + t1) / 2), top, BAY, 0);
    const tm = (t0 + t1) / 2;
    for (let t = tm - ws / 2 + 0.1; t < tm + ws / 2; t += 0.16) box(mb, f, p0 + 0.58, p0 + 0.62, t - 0.015, t + 0.015, ground(p0 + 0.6, t), ground(p0 + 0.6, t) + 2.4, IRON);
    box(mb, f, p0 + 0.57, p0 + 0.63, tm - ws / 2, tm + ws / 2, ground(p0 + 0.6, tm) + 2.2, ground(p0 + 0.6, tm) + 2.27, IRON);
    box(mb, f, p0 - 0.25, s1 + 0.25, t0 - 0.25, t1 + 0.25, tb - 0.5, tb, shade(wall, 1.06));
    box(mb, f, p0 - 0.15, s1 + 0.15, t0 - 0.15, t1 + 0.15, tb - 7.2, tb - 6.9, shade(wall, 1.06));
    spire(mb, f, (p0 + s1) / 2, (t0 + t1) / 2, (w / 2 + 0.25) * Math.SQRT2, tb, tt, 4, SPIRE_STONE);
    for (const ps of [p0 + 0.2, s1 - 0.2]) for (const pt_ of [t0 + 0.2, t1 - 0.2]) spire(mb, f, ps, pt_, 0.45, tb, tb + 2.8, 4, SPIRE_STONE);
    for (const [ps, dir] of [[p0, Math.PI], [s1, 0]] as const) {
      buttress(mb, f, m.a, ps, tOut - side * 0.8, dir, ground(ps, tOut), tb - 7.5);
      buttress(mb, f, m.a, ps + (dir ? 0.8 : -0.8), tOut, side > 0 ? Math.PI / 2 : -Math.PI / 2, ground(ps, tOut), tb - 7.5);
    }
    const sides: [Pt, Pt][] = [[[p0, t1], [p0, t0]], [[s1, t0], [s1, t1]], [[p0, t0], [s1, t0]], [[s1, t1], [p0, t1]]];
    for (const [a, b] of sides) for (const [z0, z1] of [[tb - 6.2, tb - 1.2], [tb - 12.8, tb - 8]] as const) {
      archOn(mb, f, a, b, w / 2, w * 0.66, z0 - 0.4, z1 + 0.3, shade(wall, 0.84));
      for (const u of [w * 0.33, w * 0.67]) archOn(mb, f, a, b, u, Math.min(1.1, w * 0.19), z0, z1, BAY, 0.07);
    }
  }
  // Nef : murs jusqu'à l'égout, deux pans, pignon ouest au-dessus du porche ; fenêtres hautes par travée au-dessus des bas-côtés.
  prismST(mb, f, rectST(n0, tr0, nA, nB), flat(ne), ground, wall);
  gable(mb, f, n0 - 0.3, tr0, nA - OV, nB + OV, ne - 0.25, nr, TILE_BROWN, wall);
  box(mb, f, n0, tr0, nA - 0.25, nB + 0.25, ne - 0.45, ne - 0.1, shade(wall, 1.06));
  for (const [s0, s1] of m.chapels) {
    const u = (s0 + s1) / 2 - n0;
    archOn(mb, f, [n0, nA], [tr0, nA], u, 1.5, Math.max(m.aisles[0]![1], m.aisles[1]![1]) + 0.8, ne - 1.2, BAY);
    archOn(mb, f, [tr0, nB], [n0, nB], tr0 - n0 - u, 1.5, Math.max(m.aisles[0]![1], m.aisles[1]![1]) + 0.8, ne - 1.2, BAY);
  }
  // Bas-côtés (appentis) et chapelles : chapelles en caissons à toit gris-vert, grandes baies par travée ; côté est, toit gris-vert continu.
  const sa = [p0 + w0, p0 + w1];
  m.aisles.forEach(([tOut, zIn, zOut], i) => {
    const d = i === 0 ? -1 : 1, tIn = i === 0 ? nA : nB, s0 = sa[i]!;
    const roof = i === 0 ? TILE_BROWN : LEAD;
    const pts: Pt[] = d < 0 ? [[s0, tIn], [s0, tOut], [tr0, tOut], [tr0, tIn]] : [[s0, tOut], [s0, tIn], [tr0, tIn], [tr0, tOut]];
    prismST(mb, f, pts, (p) => (Math.abs(p[1] - tIn) < 0.01 ? zIn : zOut), ground, wall);
    leanTo(mb, f, s0, tr0, tIn, tOut, zIn, zOut, OV, roof);
    m.chapels.forEach((c, b) => {
      const out = c[2 + 2 * i]!, h = c[3 + 2 * i]!;
      if (!h) return;
      const cp: Pt[] = d < 0 ? rectST(c[0], c[1], out, tOut) : rectST(c[0], c[1], tOut, out);
      prismST(mb, f, cp, flat(h), ground, wall);
      q(mb, f, [c[0], cp[0]![1], h], [c[1], cp[0]![1], h], [c[1], cp[2]![1], h], [c[0], cp[2]![1], h], [0, 1, 0], LEAD);
      // Chapelles (D130) : grande baie en arc brisé à meneau, contreforts entre les travées ; côté est (photo de nuit), pinacles au-dessus des
      // contreforts et balustrade ajourée le long du toit.
      const face: [Pt, Pt] = d < 0 ? [[c[0], out], [c[1], out]] : [[c[1], out], [c[0], out]];
      const bw = c[1] - c[0], ww = Math.min(2.6, bw * 0.45), z0 = ground((c[0] + c[1]) / 2, out) + 3;
      archOn(mb, f, face[0], face[1], bw / 2, ww, z0, h - 1.6, BAY, 0.04, true);
      rectOn(mb, f, face[0], face[1], bw / 2, 0.16, z0, h - 1.6 - ww * 0.55, wall, 0.07);
      for (const sb of b === m.chapels.length - 1 ? [c[0], c[1]] : [c[0]]) {
        buttress(mb, f, m.a, sb, out, d < 0 ? -Math.PI / 2 : Math.PI / 2, ground(sb, out), h + (d > 0 ? 0.6 : -0.6));
        if (d > 0) spire(mb, f, sb, out + 0.5, 0.42, h + 0.6, h + 3.6, 4, wall);
      }
      if (d > 0) {
        const fo: [Pt, Pt] = [[c[1], out + 0.12], [c[0], out + 0.12]];
        wallST(mb, f, fo[0], fo[1], h + 0.9, h + 0.9, () => h, shade(wall, 1.06));
        wallST(mb, f, fo[1], fo[0], h + 0.9, h + 0.9, () => h, shade(wall, 0.9));
        const n = Math.floor((bw - 1.2) / 0.6);
        for (let k = 0; k < n; k++) rectOn(mb, f, fo[0], fo[1], 0.6 + 0.6 * (k + 0.5) + (bw - 1.2 - 0.6 * n) / 2, 0.3, h + 0.2, h + 0.7, BAY);
      }
    });
  });
  // Transept : bras à pignons (portail et grande baie au pignon est), bloc carré au bout du bras ouest, toit en croupe.
  const tm = (tr0 + tr1) / 2;
  prismST(mb, f, rectST(tr0, tr1, blk, tE), flat(te), ground, wall);
  gable(mb, f, tr0 - OV, tr1 + OV, blk, tE + 0.3, te - 0.25, trr, TILE_BROWN, wall, true);
  // Portail roman du pignon est (photo de nuit) : avant-corps à petit pignon, voussure claire, porte.
  const zd = ground(tm, tE);
  box(mb, f, tm - 3, tm + 3, tE, tE + 0.9, zd, zd + 7, wall);
  gable(mb, f, tm - 3.2, tm + 3.2, tE - 0.2, tE + 1.1, zd + 7, zd + 9.4, TILE_BROWN, wall, true);
  archOn(mb, f, [tr1, tE + 0.9], [tr0, tE + 0.9], tr1 - tm, 4.2, zd + 0.3, zd + 6.2, shade(STONE, 1.08), 0.03);
  archOn(mb, f, [tr1, tE + 0.9], [tr0, tE + 0.9], tr1 - tm, 2.6, zd + 0.3, zd + 5.2, BAY, 0.06);
  archOn(mb, f, [tr1, tE], [tr0, tE], tr1 - tm, 3.2, ground(tm, tE) + 9, te - 1.2, BAY);
  // Bloc carré (D128) : toit en croupe de tuiles vernissées, deux grandes baies en arc brisé par face libre, contreforts d'angle.
  prismST(mb, f, rectST(tr0, tr1, tW, blk), flat(be), ground, wall);
  hipRoof(mb, f, tr0 - 0.3, tr1 + 0.3, tW - 0.3, blk, be - 0.2, bt, TILE_BROWN, glazedPan(12, 10));
  const blockFaces: [Pt, Pt][] = [[[tr0, blk], [tr0, tW]], [[tr0, tW], [tr1, tW]], [[tr1, tW], [tr1, blk]]];
  for (const [a, b] of blockFaces) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const k of [0.3, 0.7]) archOn(mb, f, a, b, len * k, Math.min(2, len * 0.16), ground(...a) + 3.2, be - 1.4, BAY, 0.04, true);
  }
  for (const [ps, pt_, ang] of [[tr0, tW, Math.PI * 1.25], [tr1, tW, Math.PI * 1.75]] as const) buttress(mb, f, m.a, ps, pt_, ang, ground(ps, pt_), be - 1.5);
  // Tourelle au coin du bloc et du bas-côté du chœur : corps carré, pyramide vernissée (pointe mesurée).
  const [us, ut, uw, utop] = m.turret;
  const uz = utop - uw * 1.6;
  prismST(mb, f, rectST(us - uw / 2, us + uw / 2, ut - uw / 2, ut + uw / 2), flat(uz), ground, wall);
  box(mb, f, us - uw / 2 - 0.15, us + uw / 2 + 0.15, ut - uw / 2 - 0.15, ut + uw / 2 + 0.15, uz - 0.4, uz, shade(wall, 1.06));
  hipRoof(mb, f, us - uw / 2 - 0.15, us + uw / 2 + 0.15, ut - uw / 2 - 0.15, ut + uw / 2 + 0.15, uz, utop, TILE_BROWN, glazedPan(4, 2));
  archOn(mb, f, [us + uw / 2, ut - uw / 2], [us + uw / 2, ut + uw / 2], uw / 2, 0.5, uz - 3.2, uz - 1, BAY, 0.04, true);
  // Tour de croisée (D129) : contreforts d'angle, par face deux baies jumelles en arc brisé sous un arc de décharge, corniche, balustrade
  // ajourée ; flèche octogonale (rayon mesuré), gâbles ajourés au pied des faces tournées vers la nef, le chœur et les bras, crochets sur
  // les arêtes, clochetons d'angle (photo), croix.
  const h = side / 2, c0 = m.t0, zt = Math.min(ne, te);
  prismST(mb, f, rectST(sx - h, sx + h, c0 - h, c0 + h), flat(body), () => zt - 1, shade(wall, 0.97));
  for (const ks of [-1, 1]) for (const kt of [-1, 1]) {
    buttress(mb, f, m.a, sx + ks * h, c0 + kt * (h - 0.8), ks > 0 ? 0 : Math.PI, zt, body - 3);
    buttress(mb, f, m.a, sx + ks * (h - 0.8), c0 + kt * h, kt > 0 ? Math.PI / 2 : -Math.PI / 2, zt, body - 3);
  }
  const tFaces: [Pt, Pt][] = [[[sx - h, c0 + h], [sx - h, c0 - h]], [[sx + h, c0 - h], [sx + h, c0 + h]], [[sx - h, c0 - h], [sx + h, c0 - h]], [[sx + h, c0 + h], [sx - h, c0 + h]]];
  for (const [a, b] of tFaces) {
    archOn(mb, f, a, b, h, 4.6, body - 11.5, body - 1.6, shade(wall, 0.84), 0.04, true);
    for (const u of [h - 1.15, h + 1.15]) archOn(mb, f, a, b, u, 1.4, body - 10.8, body - 4.2, BAY, 0.07, true);
  }
  const hp = h + 0.4;
  box(mb, f, sx - hp, sx + hp, c0 - hp, c0 + hp, body - 0.7, body, shade(wall, 1.06));
  const pFaces: [Pt, Pt][] = [[[sx - hp, c0 + hp], [sx - hp, c0 - hp]], [[sx + hp, c0 - hp], [sx + hp, c0 + hp]], [[sx - hp, c0 - hp], [sx + hp, c0 - hp]], [[sx + hp, c0 + hp], [sx - hp, c0 + hp]]];
  for (const [a, b] of pFaces) {
    wallST(mb, f, a, b, body + 1.1, body + 1.1, () => body, shade(wall, 1.06));
    wallST(mb, f, b, a, body + 1.1, body + 1.1, () => body, shade(wall, 0.9));
    const n = Math.floor((2 * hp - 0.4) / 0.6);
    for (let i = 0; i < n; i++) rectOn(mb, f, a, b, 0.2 + 0.6 * (i + 0.5) + (2 * hp - 0.4 - 0.6 * n) / 2, 0.32, body + 0.25, body + 0.85, BAY);
  }
  const zs = tip - 1.5;
  spire(mb, f, sx, c0, sr, body, zs, 8, SPIRE_STONE);
  const rAt = (z: number): number => sr * (1 - (z - body) / (zs - body));
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (Math.PI * i) / 4, ca = Math.cos(a), sa = Math.sin(a);
    for (let z = body + gh + 1; z < zs - 4; z += 2.8) {
      const r0 = rAt(z), r1 = rAt(z + 0.9);
      const e0 = P(f, sx + ca * r0, c0 + sa * r0, z), e1 = P(f, sx + ca * r1, c0 + sa * r1, z + 0.9);
      const o = P(f, sx + ca * (r0 + 0.55), c0 + sa * (r0 + 0.55), z + 0.35);
      for (const k of [1, -1]) mb.tri(e0, e1, o, N(f, -sa * k, ca * k), shade(SPIRE_STONE, 0.95));
    }
  }
  for (const phi of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const dc = Math.cos(phi), ds = Math.sin(phi), ap = sr * Math.cos(Math.PI / 8) + 0.1, hw = sr * Math.sin(Math.PI / 8);
    const L: Pt = [sx + dc * ap + ds * hw, c0 + ds * ap - dc * hw], R: Pt = [sx + dc * ap - ds * hw, c0 + ds * ap + dc * hw];
    const A: [number, number, number] = [sx + dc * ap, c0 + ds * ap, body + gh];
    const ai = rAt(body + gh) * Math.cos(Math.PI / 8);
    const I: [number, number, number] = [sx + dc * ai, c0 + ds * ai, body + gh];
    mb.tri(P(f, ...L, body), P(f, ...R, body), P(f, ...A), N(f, dc, ds), shade(SPIRE_STONE, 1.08));
    pan(mb, f, [...L, body], A, I, null, shade(SPIRE_STONE, 0.9));
    pan(mb, f, [...R, body], A, I, null, shade(SPIRE_STONE, 0.9));
    archOn(mb, f, L, R, hw, hw * 0.75, body + 0.6, body + gh * 0.62, BAY, 0.03, true);
  }
  for (const ks of [-1, 1]) for (const kt of [-1, 1]) {
    const ps = sx + ks * (h - 0.2), pt_ = c0 + kt * (h - 0.2), zp = body + (pin - body) * 0.4;
    box(mb, f, ps - 0.5, ps + 0.5, pt_ - 0.5, pt_ + 0.5, body, zp, SPIRE_STONE);
    spire(mb, f, ps, pt_, 0.75, zp, pin, 4, SPIRE_STONE);
  }
  box(mb, f, sx - 0.1, sx + 0.1, c0 - 0.1, c0 + 0.1, zs - 0.5, tip, IRON);
  box(mb, f, sx - 0.06, sx + 0.06, c0 - 0.55, c0 + 0.55, tip - 0.65, tip - 0.45, IRON);
  // Chœur, bas-côtés du chœur, abside polygonale à grandes baies (corniche mesurée, plus haute que celle du chœur).
  prismST(mb, f, rectST(tr1, sc, cA, cB), flat(ce), ground, wall);
  gable(mb, f, tr1, sc, cA - OV, cB + OV, ce - 0.25, cr, TILE_BROWN, wall);
  m.choirAisles.forEach(([tOut, zIn, zOut], i) => {
    const tIn = i === 0 ? cA : cB;
    const pts: Pt[] = i === 0 ? [[tr1, tIn], [tr1, tOut], [sc, tOut], [sc, tIn]] : [[tr1, tOut], [tr1, tIn], [sc, tIn], [sc, tOut]];
    prismST(mb, f, pts, (p) => (Math.abs(p[1] - tIn) < 0.01 ? zIn : zOut), ground, wall);
    leanTo(mb, f, tr1, sc, tIn, tOut, zIn, zOut, OV, TILE_BROWN);
  });
  const ac = (cA + cB) / 2;
  const ap = (i: number): Pt => { const a = (Math.PI * i) / faces; return [sc + r * Math.sin(a), ac - r * Math.cos(a)]; };
  // Abside (D128) : toit conique de tuiles vernissées en losanges, corniche, contreforts aux angles, deux étages de baies en arc brisé.
  const glazeApse = glazedPan(7, 4);
  const ra = r + 0.35;
  const apo = (i: number): Pt => { const a = (Math.PI * i) / faces; return [sc + ra * Math.sin(a), ac - ra * Math.cos(a)]; };
  for (let i = 0; i < faces; i++) {
    const a = ap(i), b = ap(i + 1);
    wallST(mb, f, a, b, ae, ae, ground, wall);
    wallST(mb, f, apo(i), apo(i + 1), ae, ae, () => ae - 0.7, shade(wall, 1.06));
    glazeApse(mb, f, [...apo(i), ae - 0.1], [...apo(i + 1), ae - 0.1], [sc, ac, cr], null, TILE_BROWN);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const zg = ground((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    archOn(mb, f, a, b, len / 2, Math.min(2, len * 0.36), zg + 10.5, ae - 2, BAY, 0.04, true);
    archOn(mb, f, a, b, len / 2, Math.min(1.3, len * 0.24), zg + 3, zg + 7.5, BAY, 0.04, true);
  }
  for (let i = 1; i < faces; i++) {
    const [ps, pt_] = ap(i);
    buttress(mb, f, m.a, ps, pt_, Math.atan2(-Math.cos((Math.PI * i) / faces), Math.sin((Math.PI * i) / faces)), ground(ps, pt_), ae - 2.5);
  }
  if (ae > ce) for (const t of [cA, cB]) mb.tri(P(f, sc, t, ce - 0.25), P(f, sc, t, ae - 0.2), P(f, sc, ac, cr), N(f, -1, 0), wall);
}

/** Pierre claire du porche et du portail, bois des portes, sculptures (D131). */
const PORCH_IN = C("#d8cbb0");
const PORTAL_STONE = C("#e2d6ba"), PORTAL_DARK = C("#b9a888"), WOOD = C("#5a3826");

/**
 * Portail de Saint-Lazare (D131, photo de l'utilisateur), sur le mur ouest de la nef (s = n0, face vers le porche), centré en t = c, seuil à
 * zD : deux portes de bois à panneaux, trumeau et sa statue, colonnes et chapiteaux des ébrasements, linteau à frise de figures, tympan du
 * Jugement dernier (Christ en mandorle, deux registres de figures), trois voussures dont une à médaillons. Proportions d'après la photo
 * (portes de 5 m sur 4,2 m, tympan de 6,4 m).
 */
function portal(mb: MeshBuilder, f: Frame, n0: number, c: number, zD: number): void {
  const n = N(f, -1, 0);
  const face = (off: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color): void => q(mb, f, [n0 - off, t0, z0], [n0 - off, t1, z0], [n0 - off, t1, z1], [n0 - off, t0, z1], n, col);
  const fan = (off: number, tc: number, zc: number, r0: number, r1: number, rz: number, a0: number, a1: number, k: number, col: THREE.Color): void => {
    for (let i = 0; i < k; i++) {
      const b0 = a0 + ((a1 - a0) * i) / k, b1 = a0 + ((a1 - a0) * (i + 1)) / k;
      const p = (r: number, b: number): [number, number, number] => [n0 - off, tc + r * Math.cos(b), zc + r * rz * Math.sin(b)];
      if (r0 > 0) q(mb, f, p(r0, b0), p(r1, b0), p(r1, b1), p(r0, b1), n, col);
      else mb.tri(P(f, n0 - off, tc, zc), P(f, ...p(r1, b0)), P(f, ...p(r1, b1)), n, col);
    }
  };
  // Portes et panneaux.
  face(0.03, c - 2.5, c + 2.5, zD, zD + 4.2, WOOD);
  for (const [t0, t1] of [[c - 2.4, c - 0.35], [c + 0.35, c + 2.4]] as const) for (let r = 0; r < 3; r++) face(0.06, t0 + 0.12, t1 - 0.12, zD + 0.25 + r * 1.3, zD + 1.3 + r * 1.3, shade(WOOD, 0.78));
  // Trumeau et statue.
  box(mb, f, n0 - 0.45, n0, c - 0.3, c + 0.3, zD, zD + 4.2, PORTAL_STONE);
  box(mb, f, n0 - 0.8, n0 - 0.45, c - 0.2, c + 0.2, zD + 1.0, zD + 3.3, shade(PORTAL_STONE, 1.05));
  box(mb, f, n0 - 0.75, n0 - 0.5, c - 0.12, c + 0.12, zD + 3.3, zD + 3.6, shade(PORTAL_STONE, 1.05));
  // Colonnes des ébrasements, chapiteaux.
  for (const k of [-1, 1]) for (const d of [3.0, 3.45, 3.9]) {
    column(mb, f, n0 - 0.25, c + k * d, 0.17, zD, zD + 4.75, PORTAL_STONE);
    box(mb, f, n0 - 0.5, n0, c + k * d - 0.24, c + k * d + 0.24, zD + 4.75, zD + 5.1, shade(PORTAL_STONE, 1.06));
  }
  // Linteau et sa frise.
  const zL = zD + 4.85;
  box(mb, f, n0 - 0.3, n0, c - 3.25, c + 3.25, zD + 4.2, zL, PORTAL_STONE);
  for (let t = c - 3.0; t < c + 3.0; t += 0.38) face(0.31, t, t + 0.2, zD + 4.3, zD + 4.75, PORTAL_DARK);
  // Tympan : demi-disque, mandorle et Christ, figures en deux registres.
  const RT = 3.2;
  fan(0.2, c, zL, 0, RT, 1, 0, Math.PI, 12, PORTAL_STONE);
  fan(0.24, c, zL + 1.75, 0, 0.85, 1.5 / 0.85, 0, Math.PI * 2, 12, shade(PORTAL_STONE, 0.84));
  face(0.27, c - 0.32, c + 0.32, zL + 0.55, zL + 2.6, shade(PORTAL_STONE, 1.06));
  face(0.27, c - 0.17, c + 0.17, zL + 2.6, zL + 2.95, shade(PORTAL_STONE, 1.06));
  for (const k of [-1, 1]) for (let x = 1.25; x < 3.0; x += 0.36) {
    const lim = zL + Math.sqrt(RT * RT - (x + 0.11) ** 2) - 0.2;
    face(0.23, c + k * x - 0.11, c + k * x + 0.11, zL + 0.15, Math.min(zL + 1.25, lim), PORTAL_DARK);
    if (lim > zL + 1.7) face(0.23, c + k * x - 0.11, c + k * x + 0.11, zL + 1.45, Math.min(zL + 2.5, lim), PORTAL_DARK);
  }
  // Voussures : la deuxième porte des médaillons.
  fan(0.25, c, zL, RT, 3.6, 1, 0, Math.PI, 12, shade(PORTAL_STONE, 0.9));
  fan(0.3, c, zL, 3.6, 4.25, 1, 0, Math.PI, 12, PORTAL_STONE);
  for (let i = 0; i <= 12; i++) {
    const b = (Math.PI * i) / 12;
    fan(0.33, c + 3.93 * Math.cos(b), zL + 3.93 * Math.sin(b), 0, 0.22, 1, 0, Math.PI * 2, 6, PORTAL_DARK);
  }
  fan(0.28, c, zL, 4.25, 4.6, 1, 0, Math.PI, 12, shade(PORTAL_STONE, 0.95));
}

/** Pierre blanche de l'édicule, pierre sombre des bassins, eau, jet (D131). */
const FOUNT_STONE = C("#e8e1d1"), FOUNT_DARK = C("#7a756b"), FOUNT_WATER = C("#5f8ea0"), FOUNT_JET = C("#d6e8ee");

/**
 * Fontaine Saint-Lazare (D131) d'après la photo de l'utilisateur, à la position, au sol, au haut et au rayon de bassin mesurés : emmarchement
 * et bassin bas à quatre lobes en pierre sombre, eau ; édicule Renaissance de pierre claire à quatre piles (piédestaux, colonnes), arcs en
 * plein cintre sur les quatre faces, entablement à inscription, frontons, vases aux angles ; lanterne à colonnettes et niches, coupolette,
 * pélican ; vasque sur pied et jet au centre. Hauteurs d'après la photo, mises à l'échelle du haut mesuré.
 */
export function buildFountain(mb: MeshBuilder, site: Extract<Site, { t: "fountain" }>, terrain: HeightField): void {
  const f = frameOf(site.x, site.y, site.a, 1, 1);
  const z0 = terrain.heightAt(site.x, site.y);
  const k = (site.top - site.g) / 8.3;
  const z = (h: number): number => z0 + h * k;
  const ground = (s: number, t: number): number => { const [x, y] = at(f, s, t); return terrain.heightAt(x, y) - 0.2; };
  const lobe = (r: number, th: number): Pt => { const rr = r - 0.45 * Math.cos(4 * th); return [rr * Math.cos(th), rr * Math.sin(th)]; };
  const SEG = 32, rb = site.rb;
  // Emmarchement, bassin à lobes, eau.
  for (let i = 0; i < SEG; i++) {
    const a0 = (2 * Math.PI * i) / SEG, a1 = (2 * Math.PI * (i + 1)) / SEG;
    const P0 = lobe(rb + 0.4, a0), P1 = lobe(rb + 0.4, a1), B0 = lobe(rb, a0), B1 = lobe(rb, a1), I0 = lobe(rb - 0.3, a0), I1 = lobe(rb - 0.3, a1);
    wallST(mb, f, P1, P0, z0 + 0.15, z0 + 0.15, ground, FOUNT_DARK);
    q(mb, f, [...P0, z0 + 0.15], [...P1, z0 + 0.15], [...B1, z0 + 0.15], [...B0, z0 + 0.15], [0, 1, 0], shade(FOUNT_DARK, 1.15));
    wallST(mb, f, B1, B0, z0 + 0.6, z0 + 0.6, () => z0 + 0.15, FOUNT_DARK);
    q(mb, f, [...B0, z0 + 0.6], [...B1, z0 + 0.6], [...I1, z0 + 0.6], [...I0, z0 + 0.6], [0, 1, 0], shade(FOUNT_DARK, 1.2));
    wallST(mb, f, I0, I1, z0 + 0.6, z0 + 0.6, () => z0 + 0.4, shade(FOUNT_DARK, 0.85));
    mb.tri(P(f, 0, 0, z0 + 0.4), P(f, ...I0, z0 + 0.4), P(f, ...I1, z0 + 0.4), [0, 1, 0], FOUNT_WATER);
  }
  // Édicule : piédestaux, faces à arc (les piles sont leurs piédroits), colonnes d'angle.
  const H = 1.6, E = H - 0.5;
  for (const ks of [-1, 1]) for (const kt of [-1, 1]) {
    box(mb, f, ks * (H + 0.05) - 0.36, ks * (H + 0.05) + 0.36, kt * (H + 0.05) - 0.36, kt * (H + 0.05) + 0.36, z0 + 0.3, z(1.9), FOUNT_STONE);
    box(mb, f, ks * (H + 0.05) - 0.42, ks * (H + 0.05) + 0.42, kt * (H + 0.05) - 0.42, kt * (H + 0.05) + 0.42, z(1.75), z(1.9), shade(FOUNT_STONE, 1.05));
    column(mb, f, ks * (H + 0.1), kt * (H + 0.1), 0.17, z(1.9), z(4.45), FOUNT_STONE);
    box(mb, f, ks * (H + 0.1) - 0.25, ks * (H + 0.1) + 0.25, kt * (H + 0.1) - 0.25, kt * (H + 0.1) + 0.25, z(4.3), z(4.55), shade(FOUNT_STONE, 1.04));
  }
  const sq = (h: number): [Pt, Pt][] => [[[h, -h], [h, h]], [[h, h], [-h, h]], [[-h, h], [-h, -h]], [[-h, -h], [h, -h]]];
  const outer = sq(H), inner = sq(E);
  outer.forEach(([a, b], i) => {
    archWall(mb, f, a, b, z(4.55), H, 1.9, z(3.5), () => z(1.9), FOUNT_STONE);
    archSoffit(mb, f, a, b, H, 1.9, z(3.5), H - E, () => z(1.9), FOUNT_STONE);
    const [ia, ib] = inner[i]!;
    archWall(mb, f, ib, ia, z(4.55), E, 1.9, z(3.5), () => z(1.9), shade(FOUNT_STONE, 0.85));
    rectOn(mb, f, a, b, H, 2.6, z(4.75), z(4.95), shade(FOUNT_STONE, 0.8), 0.28);
  });
  // Entablement, corniche, frontons, vases.
  box(mb, f, -1.85, 1.85, -1.85, 1.85, z(4.55), z(5.15), shade(FOUNT_STONE, 1.03));
  box(mb, f, -2.0, 2.0, -2.0, 2.0, z(5.15), z(5.35), FOUNT_STONE);
  for (const [a, b] of sq(1.95)) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ds = (b[0] - a[0]) / len, dt = (b[1] - a[1]) / len;
    const m0: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    mb.tri(P(f, m0[0] - ds, m0[1] - dt, z(5.35)), P(f, m0[0] + ds, m0[1] + dt, z(5.35)), P(f, m0[0], m0[1], z(5.9)), N(f, dt, -ds), FOUNT_STONE);
  }
  for (const ks of [-1, 1]) for (const kt of [-1, 1]) {
    column(mb, f, ks * 1.7, kt * 1.7, 0.16, z(5.35), z(5.6), FOUNT_STONE);
    spire(mb, f, ks * 1.7, kt * 1.7, 0.26, z(5.6), z(6.1), 6, shade(FOUNT_STONE, 0.95));
  }
  // Lanterne : socle, tambour octogonal à colonnettes et niches, corniche, coupolette, pélican.
  box(mb, f, -0.95, 0.95, -0.95, 0.95, z(5.35), z(5.95), FOUNT_STONE);
  column(mb, f, 0, 0, 0.62, z(5.95), z(7.55), FOUNT_STONE);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (Math.PI * i) / 2;
    column(mb, f, 0.74 * Math.cos(a), 0.74 * Math.sin(a), 0.08, z(5.95), z(7.55), shade(FOUNT_STONE, 1.05));
    const c = Math.cos((Math.PI * i) / 2), s_ = Math.sin((Math.PI * i) / 2), ap = 0.62 * Math.cos(Math.PI / 8), hw = 0.62 * Math.sin(Math.PI / 8);
    archOn(mb, f, [c * ap + s_ * hw, s_ * ap - c * hw], [c * ap - s_ * hw, s_ * ap + c * hw], hw, 0.34, z(6.3), z(7.2), BAY, 0.03);
  }
  box(mb, f, -0.78, 0.78, -0.78, 0.78, z(7.55), z(7.75), shade(FOUNT_STONE, 1.03));
  spire(mb, f, 0, 0, 0.75, z(7.75), z(8.0), 8, shade(FOUNT_STONE, 0.92));
  box(mb, f, -0.2, 0.2, -0.1, 0.1, z(8.0), z(8.2), shade(FOUNT_STONE, 0.9));
  box(mb, f, 0.12, 0.2, -0.05, 0.05, z(8.15), z(8.3), shade(FOUNT_STONE, 0.9));
  // Vasque sur pied, jet.
  column(mb, f, 0, 0, 0.28, z0 + 0.4, z(1.6), FOUNT_DARK);
  for (let i = 0; i < 8; i++) {
    const a0 = (Math.PI * i) / 4, a1 = (Math.PI * (i + 1)) / 4, am = (a0 + a1) / 2;
    const nh = N(f, Math.cos(am), Math.sin(am));
    q(mb, f, [0.28 * Math.cos(a0), 0.28 * Math.sin(a0), z(1.6)], [0.28 * Math.cos(a1), 0.28 * Math.sin(a1), z(1.6)], [0.85 * Math.cos(a1), 0.85 * Math.sin(a1), z(1.95)],
      [0.85 * Math.cos(a0), 0.85 * Math.sin(a0), z(1.95)], [nh[0] * 0.6, -0.8, nh[2] * 0.6], FOUNT_DARK);
    mb.tri(P(f, 0, 0, z(1.92)), P(f, 0.8 * Math.cos(a0), 0.8 * Math.sin(a0), z(1.92)), P(f, 0.8 * Math.cos(a1), 0.8 * Math.sin(a1), z(1.92)), [0, 1, 0], FOUNT_WATER);
  }
  for (const [us, vt] of [[1, 0], [0, 1]] as const) {
    for (const sg of [1, -1]) {
      q(mb, f, [-0.04 * vt, -0.04 * us, z(1.92)], [0.04 * vt, 0.04 * us, z(1.92)], [0.04 * vt, 0.04 * us, z(2.6)], [-0.04 * vt, -0.04 * us, z(2.6)], N(f, us * sg, vt * sg), FOUNT_JET);
      q(mb, f, [0.86, -0.03 * sg, z0 + 0.4], [0.86, 0.03 * sg, z0 + 0.4], [0.86, 0.03 * sg, z(1.95)], [0.86, -0.03 * sg, z(1.95)], N(f, sg, 0), FOUNT_JET);
    }
  }
}

/** Contrefort au point (s, t) du mur, saillant dans la direction `dir` (angle dans le repère), du sol z0 à z1, glacis en tête. */
function buttress(mb: MeshBuilder, f: Frame, a: number, s: number, t: number, dir: number, z0: number, z1: number): void {
  const [x, y] = at(f, s, t);
  const fb = frameOf(x, y, a + dir, 1, 1);
  box(mb, fb, -0.3, 1.3, -0.55, 0.55, z0, z1 - 1.6, STONE, shade(STONE, 0.9));
  // La nuit, flancs plus sombres que la face : le contrefort se détache du mur éclairé.
  lit(fb, [1.3, -0.55, z0], [1.3, 0.55, z0], [1.3, 0.55, z1 - 1.6], [1.3, -0.55, z1 - 1.6], N(fb, 1, 0), 0.92);
  for (const k of [-1, 1]) lit(fb, [-0.3, k * 0.55, z0], [1.3, k * 0.55, z0], [1.3, k * 0.55, z1 - 1.6], [-0.3, k * 0.55, z1 - 1.6], N(fb, 0, k), 0.72);
  pan(mb, fb, [1.3, -0.55, z1 - 1.6], [1.3, 0.55, z1 - 1.6], [-0.3, 0.55, z1], [-0.3, -0.55, z1], shade(STONE, 1.05));
  for (const k of [-1, 1]) mb.tri(P(fb, 1.3, k * 0.55, z1 - 1.6), P(fb, -0.3, k * 0.55, z1 - 1.6), P(fb, -0.3, k * 0.55, z1), N(fb, 0, k), STONE);
}

// --- Hôtel de ville ---------------------------------------------------------------------------------------------------------------

/** Pierre blonde (soubassement, étage, chaînes), étage noble clair, encadrements et corniche, grilles des arcades (photo, D123) ; marches, ferronnerie, drapeaux. */
const HALL_STONE = C("#e0bd84");
const HALL_LIGHT = C("#f1e9d6");
const HALL_TRIM = C(T.trim);
const HALL_GRILLE = C("#2f3532");
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
const TREAD = C("#e6d9b8"), RISER = C("#bba98a"), IRON = C("#2b302e"), BRICK = C("#b0533a");
const FLAG_BLUE = C("#1f3f8f"), FLAG_WHITE = C("#f4f1ea"), FLAG_RED = C("#d3313a"), FLAG_EU = C("#1f3f9f"), FLAG_STAR = C("#f2c81e");
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
  /** Chaîne d'angle au début (a) ou à la fin (b) du mur : coin saillant d'un pavillon. */
  qa?: boolean;
  qb?: boolean;
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

/** Point du mur à `u` mètres de son début, à `off` devant lui. */
function onWall(w: HallWall, u: number, off: number): ST {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
  return [w.a[0] + ((w.b[0] - w.a[0]) * u) / len + w.out[0] * off, w.a[1] + ((w.b[1] - w.a[1]) * u) / len + w.out[1] * off];
}

/**
 * Pavé plaqué sur un mur : de u0 à u1 le long du mur, de z0 à z1, de `off0` à `off1` devant lui (face avant, dessus, dessous, bouts) ;
 * `flat` : face avant seule (saillies de quelques centimètres : chaînes d'angle, refends).
 */
function block(mb: MeshBuilder, f: Frame, w: HallWall, u0: number, u1: number, z0: number, z1: number, off0: number, off1: number, col: THREE.Color, flat = false): void {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
  const tx = (w.b[0] - w.a[0]) / len, ty = (w.b[1] - w.a[1]) / len;
  const a0 = onWall(w, u0, off0), b0 = onWall(w, u1, off0), a1 = onWall(w, u0, off1), b1 = onWall(w, u1, off1);
  q(mb, f, [a1[0], a1[1], z0], [b1[0], b1[1], z0], [b1[0], b1[1], z1], [a1[0], a1[1], z1], N(f, w.out[0], w.out[1]), col);
  if (flat) return;
  q(mb, f, [a0[0], a0[1], z1], [b0[0], b0[1], z1], [b1[0], b1[1], z1], [a1[0], a1[1], z1], [0, 1, 0], shade(col, 1.04));
  q(mb, f, [a0[0], a0[1], z0], [b0[0], b0[1], z0], [b1[0], b1[1], z0], [a1[0], a1[1], z0], [0, -1, 0], shade(col, 0.8));
  q(mb, f, [a0[0], a0[1], z0], [a1[0], a1[1], z0], [a1[0], a1[1], z1], [a0[0], a0[1], z1], N(f, -tx, -ty), shade(col, 0.9));
  q(mb, f, [b0[0], b0[1], z0], [b1[0], b1[1], z0], [b1[0], b1[1], z1], [b0[0], b0[1], z1], N(f, tx, ty), shade(col, 0.9));
}

/** Bandeau ou corniche sur toute la longueur du mur, prolongé de sa saillie aux deux bouts (les coins saillants se referment). */
function course(mb: MeshBuilder, f: Frame, w: HallWall, z0: number, z1: number, proj: number, col: THREE.Color): void {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  block(mb, f, w, -proj, len + proj, z0, z1, 0, proj, col);
}

/** Fronton cintré (segment de cercle) posé sur le mur : corde de u0 à u1 à l'altitude z, flèche `rise`, épaisseur `off`. */
function segmentPediment(mb: MeshBuilder, f: Frame, w: HallWall, u0: number, u1: number, z: number, rise: number, off: number, col: THREE.Color): void {
  const c = (u1 - u0) / 2, um = (u0 + u1) / 2;
  const R = (c * c + rise * rise) / (2 * rise), zc = z + rise - R, a = Math.asin(c / R);
  const pt = (k: number, o: number): [number, number, number] => {
    const th = -a + (2 * a * k) / 6;
    const [ss, tt] = onWall(w, um + Math.sin(th) * R, o);
    return [ss, tt, zc + Math.cos(th) * R];
  };
  const [cs, ct] = onWall(w, um, off);
  for (let k = 0; k < 6; k++) {
    mb.tri(P(f, cs, ct, z), P(f, ...pt(k, off)), P(f, ...pt(k + 1, off)), N(f, w.out[0], w.out[1]), col);
    const A = P(f, ...pt(k, 0)), B = P(f, ...pt(k + 1, 0)), Cc = P(f, ...pt(k + 1, off)), D = P(f, ...pt(k, off));
    mb.quad(A, B, Cc, D, upNormal(A, B, Cc), shade(col, 1.04));
  }
}

/** Chaîne d'angle : blocs de pierre alternés (longs et courts) depuis un bout du mur, sur la hauteur z0..z1 ; `phase` alterne d'une face à l'autre. */
function quoins(mb: MeshBuilder, f: Frame, w: HallWall, atEnd: boolean, z0: number, z1: number, phase: number, col: THREE.Color): void {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  for (let k = 0, z = z0; z + 0.3 < z1; k++, z += 0.55) {
    const wd = Math.min(len, (k + phase) % 2 ? 0.55 : 0.95);
    const [u0, u1] = atEnd ? [len - wd, len] : [0, wd];
    block(mb, f, w, u0, u1, z, Math.min(z + 0.5, z1), 0, 0.05, col, true);
  }
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

/** Colonne octogonale de rayon r, centrée en (s, t), de z0 à z1. */
function column(mb: MeshBuilder, f: Frame, s: number, t: number, r: number, z0: number, z1: number, col: THREE.Color): void {
  for (let i = 0; i < 8; i++) {
    const a0 = (Math.PI * i) / 4 + Math.PI / 8, a1 = a0 + Math.PI / 4, am = (a0 + a1) / 2;
    q(mb, f, [s + Math.cos(a0) * r, t + Math.sin(a0) * r, z0], [s + Math.cos(a1) * r, t + Math.sin(a1) * r, z0], [s + Math.cos(a1) * r, t + Math.sin(a1) * r, z1],
      [s + Math.cos(a0) * r, t + Math.sin(a0) * r, z1], N(f, Math.cos(am), Math.sin(am)), shade(col, 0.9 + 0.1 * Math.max(0, -Math.sin(am))));
  }
}

/** Pavé du repère avec son dessous clair (entablement, plinthes vues d'en bas). */
function boxUnder(mb: MeshBuilder, f: Frame, s0: number, s1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color, top: THREE.Color = col): void {
  box(mb, f, s0, s1, t0, t1, z0, z1, col, top);
  q(mb, f, [s0, t0, z0], [s1, t0, z0], [s1, t1, z0], [s0, t1, z0], [0, -1, 0], shade(HALL_LIGHT, 0.9));
}

/**
 * Drapeau sur une hampe qui sort du mur (normale −t) en montant à 45°, penchée de côté (`side`) pour qu'on le voie de face : bandes verticales
 * le long de la hampe (tricolore) ou fond bleu à couronne d'étoiles (Europe).
 */
function hallFlag(mb: MeshBuilder, f: Frame, s: number, t: number, z: number, side: number, eu: boolean): void {
  const dS = side * 0.6, dT = -0.8; // direction horizontale de la hampe dans le repère
  const L = 2.6, thick = 0.035;
  const pt = (d: number, zz: number, w = 0): [number, number, number] => [s + dS * d - dT * w, t + dT * d + dS * w, zz];
  for (const k of [1, -1]) q(mb, f, pt(0, z, -thick), pt(0, z, thick), pt(L * 0.7, z + L * 0.7, thick), pt(L * 0.7, z + L * 0.7, -thick), N(f, -dS * k, -dT * k), FLAG_WHITE);
  const fw = 1.35, fh = 0.9, n = N(f, dT, -dS), back = N(f, -dT, dS);
  const stripes: [number, number, THREE.Color][] = eu ? [[0, 1, FLAG_EU]] : [[0, 1 / 3, FLAG_BLUE], [1 / 3, 2 / 3, FLAG_WHITE], [2 / 3, 1, FLAG_RED]];
  for (const [a0, a1, col] of stripes) {
    const d0 = 0.35 + a0 * fw, d1 = 0.35 + a1 * fw;
    for (const nn of [n, back]) mb.quad(P(f, ...pt(d0, z + d0 * 0.7 - fh)), P(f, ...pt(d1, z + d1 * 0.7 - fh)), P(f, ...pt(d1, z + d1 * 0.7)), P(f, ...pt(d0, z + d0 * 0.7)), nn, col);
  }
  if (!eu) return;
  // Douze étoiles en couronne (petits losanges), des deux côtés.
  const dc = 0.35 + fw / 2;
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12, r = 0.27, e = 0.045;
    const d = dc + Math.cos(a) * r, zc = z + dc * 0.7 - fh / 2 + Math.sin(a) * r + (d - dc) * 0.7;
    for (const [nn, w] of [[n, -0.004], [back, 0.004]] as const) {
      mb.quad(P(f, ...pt(d - e, zc, w)), P(f, ...pt(d, zc - e, w)), P(f, ...pt(d + e, zc, w)), P(f, ...pt(d, zc + e, w)), nn, FLAG_STAR);
    }
  }
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
    if (!pv.left) body.push({ ...W([pv.s0, 0], [pv.s0, -PROJ], m.eave), qb: true });
    body.push({ ...W([sOf(pv, 0, -PROJ), -PROJ], [sOf(pv, 1, -PROJ), -PROJ], m.eave, true), qa: true, qb: true });
    if (!pv.right) body.push({ ...W([pv.s1, -PROJ], [pv.s1, 0], m.eave), qa: true });
    s = pv.s1;
  }
  if (L - s > 0.05) body.push(W([s, 0], [L, 0], m.eave, true));
  const t0L = pavs.some((pv) => pv.left) ? -PROJ : 0, t0R = pavs.some((pv) => pv.right) ? -PROJ : 0;
  body.push({ ...W([sR(t0R), t0R], [sR(d), d], m.eave), qa: t0R < 0 }, { ...W([sL(d), d], [sL(t0L), t0L], m.eave), qb: t0L < 0 });
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
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (w.top === m.eave) {
      // Corniche moulurée du corps principal : doucine, larmier saillant, bandeau ; modillons sous le larmier côté façade.
      course(mb, f, w, w.top - 0.8, w.top - 0.5, 0.16, HALL_TRIM);
      course(mb, f, w, w.top - 0.5, w.top - 0.12, 0.42, HALL_TRIM);
      course(mb, f, w, w.top - 0.12, w.top, 0.3, shade(HALL_TRIM, 0.95));
      if (w.front) for (let u = 0.45; u < len - 0.2; u += 0.9) block(mb, f, w, u - 0.09, u + 0.09, w.top - 0.8, w.top - 0.5, 0.16, 0.38, shade(HALL_TRIM, 0.93));
    } else course(mb, f, w, w.top - 0.45, w.top, 0.3, HALL_TRIM);
    if (w.front || w.qa || w.qb) {
      // Cordon au-dessus du soubassement, bandeau sous l'étage.
      course(mb, f, w, L1 - 0.2, L1 + 0.15, 0.16, HALL_TRIM);
      course(mb, f, w, L2 - 0.15, L2 + 0.2, 0.12, HALL_TRIM);
      // Bossages du soubassement : refends horizontaux (joints creux sombres).
      for (let z = m.g + 0.55; z < L1 - 0.35; z += 0.55) {
        const gz = Math.max(ground(...onWall(w, 0, 0)), ground(...onWall(w, len, 0)));
        if (z > gz + 0.1) block(mb, f, w, 0, len, z - 0.035, z + 0.035, 0, 0.012, shade(HALL_STONE, 0.72), true);
      }
    }
    // Chaînes d'angle des pavillons, de l'étage noble à la corniche (les deux faces d'un coin alternent).
    if (w.qa) quoins(mb, f, w, false, L1 + 0.15, w.top - 0.8, w.front ? 0 : 1, shade(HALL_STONE, 1.04));
    if (w.qb) quoins(mb, f, w, true, L1 + 0.15, w.top - 0.8, w.front ? 0 : 1, shade(HALL_STONE, 1.04));
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
    const trim = HALL_TRIM;
    if (!mid) {
      // Arcade du soubassement et sa clé.
      const top = m.g + 0.45 + m.levels[0] - 1.05;
      bay(mb, glow, f, w, u, 1.7, m.g + 0.45, m.levels[0] - 1.05, true, true, false);
      block(mb, f, w, u - 0.17, u + 0.17, top - 0.15, top + 0.32, 0, 0.08, trim);
    }
    if (mid) bay(mb, glow, f, w, u, 1.8, L1 + 0.05, 4.6, true, false, lit);
    else {
      // Étage noble : appui, fenêtre haute, corniche et fronton cintré.
      const z0 = L1 + 1.1, top = z0 + 3.4;
      block(mb, f, w, u - 0.9, u + 0.9, z0 - 0.32, z0 - 0.18, 0, 0.14, trim);
      bay(mb, glow, f, w, u, 1.35, z0, 3.4, false, false, lit);
      block(mb, f, w, u - 1.0, u + 1.0, top + 0.22, top + 0.4, 0, 0.18, trim);
      segmentPediment(mb, f, w, u - 1.0, u + 1.0, top + 0.4, 0.42, 0.16, trim);
    }
    if (mid) bay(mb, glow, f, w, u, 1.45, L2 + 0.8, 3.3, true, false, !lit);
    else {
      // Étage : appui et linteau saillant.
      const z0 = L2 + 0.9, top = z0 + 2.6;
      block(mb, f, w, u - 0.85, u + 0.85, z0 - 0.3, z0 - 0.18, 0, 0.12, trim);
      bay(mb, glow, f, w, u, 1.3, z0, 2.6, false, false, !lit);
      block(mb, f, w, u - 0.9, u + 0.9, top + 0.18, top + 0.34, 0, 0.14, trim);
    }
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

  // Portique, balcon, perron et drapeaux de l'avant-corps central (D125).
  const cpv = centre[0];
  if (m.portico && m.perron && cpv) portico(mb, glow, f, m, cpv, ground);

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
  // Lucarnes, œils-de-bœuf, lucarne-fronton, crêtes, épis, cheminées (D126).
  const stone = HALL_TRIM, glass = C(T.glass[0]);
  for (const [sc, zt] of m.dormers ?? []) {
    // Lucarne ronde du corps principal : face en pierre à plein cintre, oculus, couverture en zinc.
    const tF = 0.1, w = 1.5, zs = zt - w / 2;
    dormer(mb, f, tF, dormerOutline(sc, w, m.eave - 0.2, zs, w / 2), m.eave + slope * tF, (z) => (z - m.eave) / slope, stone, zinc);
    disc(mb, f, sc, tF - 0.03, zs - 0.15, 0.5, 0.5, shade(stone, 0.92));
    disc(mb, f, sc, tF - 0.05, zs - 0.15, 0.36, 0.36, glass);
  }
  for (const [k, pv] of pavs.entries()) {
    const t0 = -PROJ - 0.1, sp = (pv.top - m.eave) / (pv.pt0 - t0), tF = -PROJ + 0.05;
    const tRoof = (z: number): number => t0 + (z - m.eave) / sp, zAtF = m.eave + sp * (tF - t0);
    const sc = (sOf(pv, 0, 0) + sOf(pv, 1, 0)) / 2;
    if (m.oculi && (pv.left || pv.right)) {
      // Œil-de-bœuf des pavillons d'angle (photo) : grande face cintrée, oculus cerclé, petite clé.
      const w = 2.0, zt = m.eave + 4.0, zs = zt - w / 2;
      dormer(mb, f, tF, dormerOutline(sc, w, m.eave - 0.2, zs, w / 2), zAtF, tRoof, stone, zinc);
      disc(mb, f, sc, tF - 0.03, zs - 0.1, 0.72, 0.72, shade(HALL_STONE, 1.04), 14);
      disc(mb, f, sc, tF - 0.05, zs - 0.1, 0.52, 0.52, glass, 14);
      box(mb, f, sc - 0.15, sc + 0.15, tF - 0.12, tF, zs + 0.55, zs + 0.95, stone);
    }
    if (m.fronton && !pv.left && !pv.right) {
      // Lucarne-fronton de l'avant-corps central (hauteur mesurée) : panneau à fronton cintré, cartouche aux armes, volutes de chaque côté.
      const w = 4.4, zt = m.fronton, rise = 0.9, zs = zt - rise;
      dormer(mb, f, tF, dormerOutline(sc, w, m.eave - 0.2, zs, rise), zAtF, tRoof, shade(HALL_STONE, 1.02), zinc);
      const fr = dormerOutline(sc, w, zs - 0.18, zs, rise).slice(1, -1);
      for (let i = 0; i + 1 < fr.length; i++) {
        const [s0, z0] = fr[i]!, [s1, z1] = fr[i + 1]!;
        q(mb, f, [s0, tF - 0.04, z0 - 0.2], [s1, tF - 0.04, z1 - 0.2], [s1, tF - 0.04, z1], [s0, tF - 0.04, z0], N(f, 0, -1), stone);
      }
      const zc = (m.eave + zs) / 2 + 0.2;
      disc(mb, f, sc, tF - 0.04, zc, 0.85, 1.05, stone, 14);
      disc(mb, f, sc, tF - 0.07, zc, 0.6, 0.8, shade(HALL_STONE, 0.9), 14);
      for (const dir of [-1, 1]) {
        const e = sc + (dir * w) / 2;
        for (let i = 0; i < 5; i++) {
          const a0 = (Math.PI / 2) * (i / 5), a1 = (Math.PI / 2) * ((i + 1) / 5);
          mb.tri(P(f, e, tF, m.eave), P(f, e + dir * Math.sin(a0) * 1.1, tF, m.eave + Math.cos(a0) * 1.4), P(f, e + dir * Math.sin(a1) * 1.1, tF, m.eave + Math.cos(a1) * 1.4), N(f, 0, -1), stone);
        }
      }
    }
    // Crête en fer autour du plateau, épi (ou paratonnerre mesuré) au milieu.
    const cr = [[pv.ps0, pv.pt0], [pv.ps1, pv.pt0], [pv.ps1, pv.pt1], [pv.ps0, pv.pt1]] as const;
    for (let i = 0; i < 4; i++) {
      const [a, b] = [cr[i]!, cr[(i + 1) % 4]!];
      const nS = b[1] - a[1], nT = -(b[0] - a[0]), l = Math.hypot(nS, nT) || 1;
      for (const k of [1, -1]) q(mb, f, [a[0], a[1], pv.top], [b[0], b[1], pv.top], [b[0], b[1], pv.top + 0.35], [a[0], a[1], pv.top + 0.35], N(f, (k * nS) / l, (k * nT) / l), IRON);
    }
    const ms = (pv.ps0 + pv.ps1) / 2, mt = (pv.pt0 + pv.pt1) / 2, tip = m.tips?.[k] ?? null;
    box(mb, f, ms - 0.2, ms + 0.2, mt - 0.2, mt + 0.2, pv.top, pv.top + 0.5, zinc);
    spire(mb, f, ms, mt, 0.16, pv.top + 0.5, tip !== null ? Math.min(tip, pv.top + 1.8) : pv.top + 1.9, 4, IRON);
    if (tip !== null && tip > pv.top + 1.8) box(mb, f, ms - 0.03, ms + 0.03, mt - 0.03, mt + 0.03, pv.top + 1.6, tip, IRON);
  }
  for (const [cs, ct, side, top] of m.chim ?? []) {
    // Cheminée de brique (photo), du dessous du toit à son haut mesuré, couronnée d'une dalle.
    const h = side / 2;
    box(mb, f, cs - h, cs + h, ct - h, ct + h, top - 4, top - 0.12, BRICK);
    box(mb, f, cs - h - 0.06, cs + h + 0.06, ct - h - 0.06, ct + h + 0.06, top - 0.12, top, shade(HALL_TRIM, 0.9));
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

/**
 * Lucarne sur un pan qui monte vers +t : face avant verticale en t = tF, de contour `outline` (points (s, z) du bas à droite au bas à gauche
 * en passant par le haut), joues jusqu'au pan, couverture qui rejoint le pan (`tRoof(z)` : profondeur où le pan atteint z).
 */
function dormer(mb: MeshBuilder, f: Frame, tF: number, outline: [number, number][], zRoofAtF: number, tRoof: (z: number) => number, face: THREE.Color, cover: THREE.Color): void {
  const n = outline.length;
  for (let i = 1; i + 1 < n; i++) mb.tri(P(f, outline[0]![0], tF, outline[0]![1]), P(f, outline[i]![0], tF, outline[i]![1]), P(f, outline[i + 1]![0], tF, outline[i + 1]![1]), N(f, 0, -1), face);
  const [sR, zsR] = outline[1]!, [sL, zsL] = outline[n - 2]!;
  if (zsR > zRoofAtF) mb.tri(P(f, sR, tF, zRoofAtF), P(f, sR, tF, zsR), P(f, sR, tRoof(zsR), zsR), N(f, 1, 0), shade(face, 0.88));
  if (zsL > zRoofAtF) mb.tri(P(f, sL, tF, zRoofAtF), P(f, sL, tF, zsL), P(f, sL, tRoof(zsL), zsL), N(f, -1, 0), shade(face, 0.88));
  for (let i = 1; i + 2 < n; i++) {
    const [s0, z0] = outline[i]!, [s1, z1] = outline[i + 1]!;
    pan(mb, f, [s0, tF - 0.06, z0], [s1, tF - 0.06, z1], [s1, tRoof(z1), z1], [s0, tRoof(z0), z0], cover);
  }
}

/** Contour de lucarne : montants de zb à zs, puis arc (plein cintre si `rise` = demi-largeur, segment sinon) jusqu'à zs + rise. */
function dormerOutline(sc: number, w: number, zb: number, zs: number, rise: number): [number, number][] {
  const c = w / 2, R = (c * c + rise * rise) / (2 * rise), zc = zs + rise - R, a = Math.asin(Math.min(1, c / R));
  const out: [number, number][] = [[sc + c, zb], [sc + c, zs]];
  for (let k = 1; k < 8; k++) {
    const th = a - (2 * a * k) / 8;
    out.push([sc + Math.sin(th) * R, zc + Math.cos(th) * R]);
  }
  out.push([sc - c, zs], [sc - c, zb]);
  return out;
}

/** Disque posé sur une face de normale −t (oculus, cartouche), centré en (s, z), rayons rs (le long de s) et rz. */
function disc(mb: MeshBuilder, f: Frame, s: number, t: number, z: number, rs: number, rz: number, col: THREE.Color, sides = 12): void {
  for (let i = 0; i < sides; i++) {
    const a0 = (Math.PI * 2 * i) / sides, a1 = (Math.PI * 2 * (i + 1)) / sides;
    mb.tri(P(f, s, t, z), P(f, s + Math.cos(a0) * rs, t, z + Math.sin(a0) * rz), P(f, s + Math.cos(a1) * rs, t, z + Math.sin(a1) * rz), N(f, 0, -1), col);
  }
}

/**
 * Portique, balcon et perron de l'hôtel de ville (D125), d'après la photo et les mesures : six colonnes (par paires aux bouts, une entre
 * chaque porte) sous un entablement, balcon à balustrade, drapeaux tricolore et européen aux baies du balcon ; perron droit du palier au
 * pied mesurés, entre deux murs d'échiffre pleins, deux rampes, piédestaux et lampadaires à deux lanternes au pied.
 */
function portico(mb: MeshBuilder, glow: MeshBuilder, f: Frame, m: TownHallSpec, cpv: { s0: number; s1: number }, ground: (s: number, t: number) => number): void {
  const [tf0, zTop] = m.portico!;
  const [ps0, ps1, tl, tfoot, zl] = m.perron!;
  const wallT = -PROJ, tf = tf0 + 0.15, p = m.l / m.bays;
  const zFloor = zTop - 1.0, zE = zFloor - 0.95, zBase = zl + 0.05;
  const a0 = cpv.s0 + 0.35, a1 = cpv.s1 - 0.35;
  const bays: number[] = [];
  for (let i = 0; i < m.bays; i++) if ((i + 0.5) * p > cpv.s0 && (i + 0.5) * p < cpv.s1) bays.push((i + 0.5) * p);
  // Entablement : architrave, frise, corniche ; dessous clair.
  boxUnder(mb, f, a0, a1, tf, wallT, zE, zE + 0.35, HALL_TRIM);
  boxUnder(mb, f, a0 + 0.05, a1 - 0.05, tf + 0.05, wallT, zE + 0.35, zFloor - 0.2, shade(HALL_STONE, 1.02));
  boxUnder(mb, f, a0 - 0.15, a1 + 0.15, tf - 0.15, wallT, zFloor - 0.2, zFloor, HALL_TRIM);
  // Colonnes : base, fût, chapiteau.
  const ct = tf + 0.45;
  const cols = [a0 + 0.45, a0 + 1.2, ...bays.slice(0, -1).map((b, i) => (b + bays[i + 1]!) / 2), a1 - 1.2, a1 - 0.45];
  for (const cs of cols) {
    box(mb, f, cs - 0.4, cs + 0.4, ct - 0.4, ct + 0.4, zBase, zBase + 0.4, HALL_TRIM);
    column(mb, f, cs, ct, 0.29, zBase + 0.4, zE - 0.35, HALL_TRIM);
    boxUnder(mb, f, cs - 0.42, cs + 0.42, ct - 0.42, ct + 0.42, zE - 0.35, zE, HALL_TRIM);
  }
  // Balustrade du balcon : plinthe, balustres, main courante, dés au-dessus des colonnes doubles.
  const rail = (s0: number, s1: number, t0: number, t1: number): void => {
    box(mb, f, s0, s1, t0, t1, zFloor, zFloor + 0.18, HALL_TRIM);
    boxUnder(mb, f, s0, s1, t0, t1, zTop - 0.14, zTop, HALL_TRIM);
    const alongS = s1 - s0 > t1 - t0;
    const len = alongS ? s1 - s0 : t1 - t0, n = Math.max(1, Math.round(len / 0.32));
    for (let i = 0; i < n; i++) {
      const c = (alongS ? s0 : t0) + ((i + 0.5) * len) / n, mid = alongS ? (t0 + t1) / 2 : (s0 + s1) / 2;
      const [bs, bt] = alongS ? [c, mid] : [mid, c];
      box(mb, f, bs - 0.07, bs + 0.07, bt - 0.07, bt + 0.07, zFloor + 0.18, zTop - 0.14, HALL_TRIM);
    }
  };
  rail(a0, a1, tf, tf + 0.28);
  rail(a0, a0 + 0.28, tf + 0.28, wallT);
  rail(a1 - 0.28, a1, tf + 0.28, wallT);
  for (const cs of [a0 + 0.82, a1 - 0.82]) box(mb, f, cs - 0.55, cs + 0.55, tf, tf + 0.35, zFloor, zTop + 0.08, HALL_TRIM);
  // Drapeaux aux baies du balcon : tricolore au centre, européen à droite.
  const zFlag = m.g + m.levels[1] + 3.2;
  if (bays.length >= 3) {
    hallFlag(mb, f, bays[1]!, wallT - 0.05, zFlag, -1, false);
    hallFlag(mb, f, bays[2]!, wallT - 0.05, zFlag, 1, true);
  }

  // Perron : marches régulières du palier au pied, posées 5 cm au-dessus du relief (qui reste la surface où l'on marche).
  const sm = (ps0 + ps1) / 2;
  const zFoot = ground(sm, tfoot);
  const lift = 0.05;
  const n = Math.max(1, Math.round((zl - zFoot) / 0.16)), rise = (zl - zFoot) / n, run = (tl - tfoot) / n;
  q(mb, f, [ps0, tl, zl + lift], [ps1, tl, zl + lift], [ps1, wallT, zl + lift], [ps0, wallT, zl + lift], [0, 1, 0], TREAD);
  for (let k = 0; k < n; k++) {
    const t = tl - k * run, zt = zl - k * rise + lift, zb = k === n - 1 ? zFoot - 0.3 : zt - rise;
    q(mb, f, [ps0, t, zb], [ps1, t, zb], [ps1, t, zt], [ps0, t, zt], N(f, 0, -1), RISER);
    if (k < n - 1) q(mb, f, [ps0, t - run, zt - rise], [ps1, t - run, zt - rise], [ps1, t, zt - rise], [ps0, t, zt - rise], [0, 1, 0], TREAD);
  }
  // Murs d'échiffre pleins, du sol de la place au garde-corps (85 cm au-dessus des marches et du palier).
  const zb = zFoot - 0.3, h = 0.85;
  const line = (t: number): number => zFoot + ((t - tfoot) / (tl - tfoot)) * (zl - zFoot) + lift + h;
  for (const [s0, s1] of [[ps0 - 0.45, ps0], [ps1, ps1 + 0.45]] as const) {
    const prof: [number, number][] = [[tfoot, zb], [wallT, zb], [wallT, zl + lift + h], [tl, zl + lift + h], [tfoot, line(tfoot)]];
    for (const [ss, dir] of [[s0, -1], [s1, 1]] as const) {
      for (let i = 1; i + 1 < prof.length; i++) mb.tri(P(f, ss, ...prof[0]!), P(f, ss, ...prof[i]!), P(f, ss, ...prof[i + 1]!), N(f, dir, 0), shade(HALL_STONE, 0.95));
    }
    q(mb, f, [s0, tfoot, line(tfoot)], [s1, tfoot, line(tfoot)], [s1, tl, zl + lift + h], [s0, tl, zl + lift + h], upNormal(P(f, s0, tfoot, line(tfoot)), P(f, s1, tfoot, line(tfoot)), P(f, s1, tl, zl + lift + h)), HALL_TRIM);
    q(mb, f, [s0, tl, zl + lift + h], [s1, tl, zl + lift + h], [s1, wallT, zl + lift + h], [s0, wallT, zl + lift + h], [0, 1, 0], HALL_TRIM);
    q(mb, f, [s0, tfoot, zb], [s1, tfoot, zb], [s1, tfoot, line(tfoot)], [s0, tfoot, line(tfoot)], N(f, 0, -1), HALL_STONE);
    // Piédestal et lampadaire à deux lanternes au pied de l'échiffre.
    const cs = (s0 + s1) / 2, pt = tfoot + 0.25, zp = line(tfoot) + 0.45;
    box(mb, f, cs - 0.4, cs + 0.4, pt - 0.4, pt + 0.4, zb, zp, HALL_STONE, HALL_TRIM);
    box(mb, f, cs - 0.07, cs + 0.07, pt - 0.07, pt + 0.07, zp, zp + 3.0, IRON);
    box(mb, f, cs - 0.55, cs + 0.55, pt - 0.04, pt + 0.04, zp + 2.75, zp + 2.83, IRON);
    for (const ls of [cs - 0.5, cs + 0.5]) {
      box(mb, f, ls - 0.16, ls + 0.16, pt - 0.16, pt + 0.16, zp + 2.83, zp + 3.33, C("#f3e6c0"), IRON);
      for (const [dir, axisT] of [[-1, true], [1, true], [-1, false], [1, false]] as const) {
        const o = 0.165;
        if (axisT) q(glow, f, [ls - 0.13, pt + dir * o, zp + 2.86], [ls + 0.13, pt + dir * o, zp + 2.86], [ls + 0.13, pt + dir * o, zp + 3.3], [ls - 0.13, pt + dir * o, zp + 3.3], N(f, 0, dir), GLOW_HI);
        else q(glow, f, [ls + dir * o, pt - 0.13, zp + 2.86], [ls + dir * o, pt + 0.13, zp + 2.86], [ls + dir * o, pt + 0.13, zp + 3.3], [ls + dir * o, pt - 0.13, zp + 3.3], N(f, dir, 0), GLOW_HI);
      }
    }
  }
  // Deux rampes en fer : poteaux tous les quatre marches, main courante qui suit la pente.
  for (const rs of [ps0 + (ps1 - ps0) / 3, ps0 + (2 * (ps1 - ps0)) / 3]) {
    for (let k = 0; k < n; k += 4) {
      const t = tl - (k + 0.5) * run, zt = zl - (k + 1) * rise + lift;
      box(mb, f, rs - 0.03, rs + 0.03, t - 0.03, t + 0.03, zt, zt + 0.9, IRON);
    }
    const r0: [number, number] = [tl - 0.5 * run, zl - rise + lift + 0.9], r1: [number, number] = [tfoot + 0.5 * run, zFoot + lift + 0.9];
    for (const dir of [-1, 1]) q(mb, f, [rs + dir * 0.03, r1[0], r1[1]], [rs + dir * 0.03, r0[0], r0[1]], [rs + dir * 0.03, r0[0], r0[1] + 0.06], [rs + dir * 0.03, r1[0], r1[1] + 0.06], N(f, dir, 0), IRON);
    q(mb, f, [rs - 0.03, r1[0], r1[1] + 0.06], [rs + 0.03, r1[0], r1[1] + 0.06], [rs + 0.03, r0[0], r0[1] + 0.06], [rs - 0.03, r0[0], r0[1] + 0.06], [0, 1, 0], IRON);
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

// --- Collège (D148) -----------------------------------------------------------------------------------------------------------------

const COLLEGE_STONE = C("#d2c4a4");
const COLLEGE_TILE = C("#9a5a3e");
const COLLEGE_TRIM = C("#e6dcc4");
/** Débord du toit (m), travée des fenêtres (fiche : 3,2 m), hauteur d'un niveau. */
const COLLEGE_OVERHANG = 0.25, COLLEGE_BAY = 3.2, COLLEGE_STOREY = 3.3;

/** Aile la plus proche (au sens du bord de son toit) d'un point du plan, et côté (+1 gauche, −1 droite). */
function nearestWing(wings: readonly CollegeWing[], x: number, y: number): { w: CollegeWing; side: number } {
  let best = wings[0]!, bestSide = 1, bestD = Infinity;
  for (const w of wings) {
    const dx = w.q[0] - w.p[0], dy = w.q[1] - w.p[1], l2 = dx * dx + dy * dy || 1;
    const u = Math.min(1, Math.max(0, ((x - w.p[0]) * dx + (y - w.p[1]) * dy) / l2));
    const cx = w.p[0] + dx * u, cy = w.p[1] + dy * u;
    const side = (x - cx) * -dy + (y - cy) * dx >= 0 ? 1 : -1;
    const d = Math.abs(Math.hypot(x - cx, y - cy) - (side > 0 ? w.wl : w.wr));
    if (d < bestD) [best, bestSide, bestD] = [w, side, d];
  }
  return { w: best, side: bestSide };
}

/** Toit d'une aile : deux pans (égouts propres à chaque côté), croupes, pignons pleins ou prolongés dans l'aile voisine. */
function collegeRoof(mb: MeshBuilder, w: CollegeWing, wall: THREE.Color, tile: THREE.Color): void {
  const f = frameOf(0, 0, 0, 1, 1);
  const dx = w.q[0] - w.p[0], dy = w.q[1] - w.p[1], L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const wl = w.wl + COLLEGE_OVERHANG, wr = w.wr + COLLEGE_OVERHANG;
  // Les égouts se prolongent sous le débord : même pente qu'entre le mur et le faîtage.
  const el = w.el - ((w.r - w.el) * COLLEGE_OVERHANG) / w.wl, er = w.er - ((w.r - w.er) * COLLEGE_OVERHANG) / w.wr;
  const k = (wl + wr) / 2;
  const a0 = w.a === "hip" ? k : 0, a1 = w.b === "hip" ? L - k : L;
  const X = (u: number, v: number): [number, number] => [w.p[0] + ux * u + nx * v, w.p[1] + uy * u + ny * v];
  const pt = (u: number, v: number, z: number): [number, number, number] => [...X(u, v), z];
  pan(mb, f, pt(0, wl, el), pt(L, wl, el), pt(a1, 0, w.r), pt(a0, 0, w.r), tile);
  pan(mb, f, pt(L, -wr, er), pt(0, -wr, er), pt(a0, 0, w.r), pt(a1, 0, w.r), shade(tile, 0.94));
  for (const [end, u, ridgeU, out] of [[w.a, 0, a0, -1], [w.b, L, a1, 1]] as const) {
    if (end === "hip") pan(mb, f, pt(u, wl, el), pt(u, -wr, er), pt(ridgeU, 0, w.r), null, shade(tile, 0.88));
    else {
      const A = P(f, ...pt(u, wl, el)), B = P(f, ...pt(u, -wr, er)), Cc = P(f, ...pt(u, 0, w.r));
      mb.tri(A, B, Cc, N(f, ux * out, uy * out), wall);
    }
  }
}

/**
 * Collège d'après relevé LiDAR (D148) : murs sur le contour BD TOPO (pierre blonde, corniche, rangées de fenêtres tous les 3,2 m, chacune à son
 * niveau au-dessus du sol local), chaque mur montant à l'égout de l'aile dont il longe le toit, puis un toit à deux pans par aile.
 */
export function buildCollege(mb: MeshBuilder, glow: MeshBuilder, m: CollegeSpec, ring: readonly number[], terrain: HeightField): void {
  const f = frameOf(0, 0, 0, 1, 1);
  const ground = (s: number, t: number): number => terrain.heightAt(s, t);
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const a: ST = [ring[2 * i]!, ring[2 * i + 1]!], b: ST = [ring[2 * ((i + 1) % n)]!, ring[2 * ((i + 1) % n) + 1]!];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.3) continue;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const { w: wing, side } = nearestWing(m.wings, mx, my);
    const top = side > 0 ? wing.el : wing.er;
    // Contour dans le sens trigonométrique : l'extérieur est à droite.
    const wall: HallWall = { a, b, out: [(b[1] - a[1]) / len, -(b[0] - a[0]) / len], top, front: false };
    wallBands(mb, f, wall, ground, [], [COLLEGE_STONE]);
    if (len < 1.5) continue;
    course(mb, f, wall, top - 0.7, top - 0.15, 0.22, COLLEGE_TRIM);
    const bays = Math.floor((len - 2.4) / COLLEGE_BAY);
    for (let j = 0; j < bays; j++) {
      const u = len / 2 + (j - (bays - 1) / 2) * COLLEGE_BAY;
      const [sx, sy] = onWall(wall, u, 0);
      const g = ground(sx, sy);
      for (let r = 0, z0 = g + 1.0; z0 + 1.8 < top - 0.9; r++, z0 += COLLEGE_STOREY) bay(mb, glow, f, wall, u, 1.0, z0, 1.7, false, false, (i + j + r) % 3 === 0);
    }
  }
  const tile = m.roof ? C(m.roof) : COLLEGE_TILE;
  for (const w of m.wings) collegeRoof(mb, w, COLLEGE_STONE, tile);
}
