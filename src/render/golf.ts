import * as THREE from "three";
import type { GolfSite, HeightField } from "../data/types";
import { practiceFrame } from "../core/golf";
import { toThree, type MeshBuilder, type Vec3 } from "./geometry";

/**
 * Golf municipal (D289), d'après les photos de l'utilisateur : la tente blanche de la terrasse du club-house, les tables carrées en bois et
 * leurs chaises en résine tressée, les parasols blancs, le panneau vert « Bienvenue – Golf municipal » devant le muret de l'entrée, les deux
 * mâts à drapeaux. Tout en plaques et en prismes : quelques milliers de triangles.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const TENT = C("#f4f2ea"), TENT_ROOF = C("#ffffff"), WOOD = C("#c8a77e"), METAL = C("#9aa0a3"), RATTAN = C("#3a3533");
const CANVAS = C("#f1ece0"), SIGN = C("#2e8a4b"), WHITE = C("#f7f5ee"), POLE = C("#e9e9e4"), BANNER = [C("#ffffff"), C("#d6413a")];

/** Prisme vertical sur un contour (repère données), de z0 à z1 : côtés et dessus. */
function prism(mb: MeshBuilder, pts: [number, number][], z0: number, z1: number, col: THREE.Color, top = true): void {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i]![0] * pts[(i + 1) % n]![1] - pts[(i + 1) % n]![0] * pts[i]![1];
  const s = area >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % n]!;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    mb.quad(toThree(x1, y1, z0), toThree(x2, y2, z0), toThree(x2, y2, z1), toThree(x1, y1, z1), toThree((s * (y2 - y1)) / len, (-s * (x2 - x1)) / len, 0), col);
  }
  if (top) for (let i = 1; i + 1 < n; i++) mb.tri(toThree(pts[0]![0], pts[0]![1], z1), toThree(pts[i]![0], pts[i]![1], z1), toThree(pts[i + 1]![0], pts[i + 1]![1], z1), [0, 1, 0], col);
}

/** Boîte centrée en (x, y), demi-côtés hx (le long de `rot`) et hy, de z0 à z1. */
function box(mb: MeshBuilder, x: number, y: number, hx: number, hy: number, rot: number, z0: number, z1: number, col: THREE.Color): void {
  const c = Math.cos(rot), s = Math.sin(rot);
  const p = (u: number, v: number): [number, number] => [x + u * c - v * s, y + u * s + v * c];
  prism(mb, [p(-hx, -hy), p(hx, -hy), p(hx, hy), p(-hx, hy)], z0, z1, col);
}

function pole(mb: MeshBuilder, x: number, y: number, r: number, z0: number, z1: number, col: THREE.Color, seg = 6): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < seg; i++) pts.push([x + r * Math.cos((2 * Math.PI * i) / seg), y + r * Math.sin((2 * Math.PI * i) / seg)]);
  prism(mb, pts, z0, z1, col);
}

/** Tente à deux pans : rectangle `r` (4 coins), côtés de `h` m, faîtage à `ridge` m dans l'axe du grand côté. */
function tent(mb: MeshBuilder, s: GolfSite["tent"], terrain: HeightField): void {
  const q: [number, number][] = [];
  for (let i = 0; i < 8; i += 2) q.push([s.r[i]!, s.r[i + 1]!]);
  let g = Infinity;
  for (const [x, y] of q) g = Math.min(g, terrain.heightAt(x, y));
  prism(mb, q, g - 0.1, g + s.h, TENT, false);
  // Grand côté : q0-q1 ou q1-q2.
  const long01 = Math.hypot(q[1]![0] - q[0]![0], q[1]![1] - q[0]![1]) >= Math.hypot(q[2]![0] - q[1]![0], q[2]![1] - q[1]![1]);
  const [a, b, c, d] = long01 ? [q[0]!, q[1]!, q[2]!, q[3]!] : [q[1]!, q[2]!, q[3]!, q[0]!];
  const mid = (p: [number, number], k: [number, number]): [number, number] => [(p[0] + k[0]) / 2, (p[1] + k[1]) / 2];
  const r0 = mid(a, d), r1 = mid(b, c);
  const V = (p: [number, number], z: number): Vec3 => toThree(p[0], p[1], z);
  const eave = g + s.h, top = g + s.ridge;
  const up: Vec3 = [0, 1, 0];
  mb.quad(V(a, eave), V(b, eave), V(r1, top), V(r0, top), up, TENT_ROOF);
  mb.quad(V(d, eave), V(c, eave), V(r1, top), V(r0, top), up, TENT_ROOF.clone().multiplyScalar(0.94));
  // Pignons.
  mb.tri(V(a, eave), V(d, eave), V(r0, top), toThree(r0[0] - r1[0], r0[1] - r1[1], 0), TENT);
  mb.tri(V(b, eave), V(c, eave), V(r1, top), toThree(r1[0] - r0[0], r1[1] - r0[1], 0), TENT);
}

/** Table carrée de 0,8 m sur pied central, quatre chaises tressées autour. */
function table(mb: MeshBuilder, x: number, y: number, rot: number, terrain: HeightField): void {
  const g = terrain.heightAt(x, y);
  pole(mb, x, y, 0.05, g, g + 0.72, METAL);
  box(mb, x, y, 0.4, 0.4, rot, g + 0.72, g + 0.76, WOOD);
  for (let k = 0; k < 4; k++) {
    const a = rot + (k * Math.PI) / 2, cx = x + Math.cos(a) * 0.72, cy = y + Math.sin(a) * 0.72;
    box(mb, cx, cy, 0.22, 0.22, a, g + 0.42, g + 0.47, RATTAN);
    for (const [u, v] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) {
      pole(mb, cx + u * Math.cos(a) - v * Math.sin(a), cy + u * Math.sin(a) + v * Math.cos(a), 0.02, g, g + 0.42, METAL, 4);
    }
    const bx = cx + Math.cos(a) * 0.22, by = cy + Math.sin(a) * 0.22;
    box(mb, bx, by, 0.03, 0.22, a, g + 0.47, g + 0.9, RATTAN);
  }
}

/** Parasol blanc : mât, toile en pyramide à huit pans de 1,5 m de rayon. */
function parasol(mb: MeshBuilder, x: number, y: number, terrain: HeightField): void {
  const g = terrain.heightAt(x, y);
  pole(mb, x, y, 0.03, g, g + 2.45, METAL);
  const seg = 8, r = 1.5, z0 = g + 2.1, z1 = g + 2.5;
  for (let i = 0; i < seg; i++) {
    const a0 = (2 * Math.PI * i) / seg, a1 = (2 * Math.PI * (i + 1)) / seg;
    mb.tri(toThree(x + r * Math.cos(a0), y + r * Math.sin(a0), z0), toThree(x + r * Math.cos(a1), y + r * Math.sin(a1), z0), toThree(x, y, z1), [0, 1, 0],
      CANVAS.clone().multiplyScalar(i % 2 ? 0.95 : 1));
  }
}

/** Panneau vert à cadre blanc devant le muret : balle et clubs croisés à gauche, lignes de texte suggérées à droite. */
function sign(mb: MeshBuilder, s: GolfSite["sign"], terrain: HeightField): void {
  const [ax, ay] = s.a, [bx, by] = s.b;
  const L = Math.hypot(bx - ax, by - ay) || 1, tx = (bx - ax) / L, ty = (by - ay) / L, nx = ty, ny = -tx;
  const g = Math.min(terrain.heightAt(ax, ay), terrain.heightAt(bx, by));
  const at = (u: number, off: number): [number, number] => [ax + tx * u + nx * off, ay + ty * u + ny * off];
  const face = (u0: number, u1: number, z0: number, z1: number, off: number, col: THREE.Color): void => {
    const p0 = at(u0, off), p1 = at(u1, off);
    mb.quad(toThree(p0[0], p0[1], g + z0), toThree(p1[0], p1[1], g + z0), toThree(p1[0], p1[1], g + z1), toThree(p0[0], p0[1], g + z1), toThree(nx, ny, 0), col);
  };
  // Plaque (épaisseur 4 cm) et ses deux pieds.
  const c0 = at(0, 0.02), c1 = at(L, 0.02);
  box(mb, (c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, L / 2, 0.02, Math.atan2(ty, tx), g + s.z0, g + s.z1, SIGN);
  for (const u of [0.15, L - 0.15]) {
    const p = at(u, 0.0);
    box(mb, p[0], p[1], 0.04, 0.04, Math.atan2(ty, tx), g, g + s.z0, METAL);
  }
  const H = s.z1 - s.z0, off = 0.045;
  // Cadre blanc.
  face(0.06, L - 0.06, s.z1 - 0.1, s.z1 - 0.06, off, WHITE);
  face(0.06, L - 0.06, s.z0 + 0.06, s.z0 + 0.1, off, WHITE);
  face(0.06, 0.1, s.z0 + 0.06, s.z1 - 0.06, off, WHITE);
  face(L - 0.1, L - 0.06, s.z0 + 0.06, s.z1 - 0.06, off, WHITE);
  // Balle et clubs croisés (à gauche, un tiers de la largeur).
  const w = L * 0.3, zc = s.z0 + H * 0.55;
  for (const sgn of [-1, 1]) {
    for (let k = 0; k < 8; k++) {
      const t0 = k / 8, t1 = (k + 1) / 8;
      const u0 = 0.2 + w * (sgn > 0 ? t0 : 1 - t0), u1 = 0.2 + w * (sgn > 0 ? t1 : 1 - t1);
      const z0 = zc - H * 0.3 + H * 0.6 * t0, z1 = zc - H * 0.3 + H * 0.6 * t1;
      face(Math.min(u0, u1), Math.max(u0, u1), Math.min(z0, z1), Math.max(z0, z1) + 0.04, off + 0.002 * (sgn + 2), WHITE);
    }
  }
  face(0.2 + w / 2 - 0.09, 0.2 + w / 2 + 0.09, zc - H * 0.38, zc - H * 0.24, off + 0.008, WHITE);
  // « Bienvenue » (grandes lettres), « Golf municipal », « de la ville d'Autun », puis deux lignes d'horaires.
  const u0 = 0.35 + w;
  const lines: [number, number, number][] = [[0.83, 0.1, 0.95], [0.62, 0.08, 0.85], [0.47, 0.05, 0.6], [0.2, 0.03, 0.9], [0.12, 0.03, 0.7]];
  for (const [zf, hh, wf] of lines) {
    const width = (L - u0 - 0.2) * wf;
    for (let x = 0; x + 0.06 < width; x += 0.11) face(u0 + x, u0 + x + 0.07, s.z0 + H * zf, s.z0 + H * zf + hh, off + 0.006, WHITE);
  }
}

/** Mât de 6 m, oriflamme verticale blanche à bande rouge accrochée en haut (les deux drapeaux de l'entrée). */
function flag(mb: MeshBuilder, x: number, y: number, k: number, terrain: HeightField): void {
  const g = terrain.heightAt(x, y);
  pole(mb, x, y, 0.04, g, g + 6, POLE);
  const a = 0.6 + k;
  box(mb, x + Math.cos(a) * 0.38, y + Math.sin(a) * 0.38, 0.33, 0.01, a, g + 3.2, g + 5.8, BANNER[0]!);
  box(mb, x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6, 0.08, 0.012, a, g + 3.4, g + 5.6, BANNER[1]!);
}

const CONCRETE = C("#cfcbc2"), MAT = C("#2f8a55"), TIMBER = C("#a8743f"), SHELTER_TOP = C("#8f969a"), SHELTER_UNDER = C("#efe3c8");
const TARGET = C("#f5f5f0"), TARGET_FLAG = C("#d6413a");

/** Practice (D290, photos 6 et 7) : dalles et tapis verts, abri à charpente bois et toit à un pan, cibles rondes. */
function practice(mb: MeshBuilder, p: NonNullable<GolfSite["practice"]>, terrain: HeightField): void {
  const { at, L, rot } = practiceFrame(p);
  for (let u = p.step / 2; u < L; u += p.step) {
    const [x, y] = at(u, -p.depth / 2);
    const g = terrain.heightAt(x, y);
    box(mb, x, y, p.step / 2 - 0.08, p.depth / 2, rot, g - 0.2, g + 0.12, CONCRETE);
    const [mx, my] = at(u, -0.95);
    box(mb, mx, my, 0.75, 0.75, rot, g + 0.12, g + 0.15, MAT);
  }
  // Abri : poteaux à l'avant (côté terrain) et à l'arrière, tous les 4 m ; toit à un pan, plus haut à l'avant.
  const [s0, s1] = p.shelter;
  const back = -p.depth - 2.2, front = 0.3;
  const n = Math.max(1, Math.round((s1 - s0) / 4));
  let gmin = Infinity;
  for (let k = 0; k <= n; k++) {
    const u = s0 + ((s1 - s0) * k) / n;
    for (const [v, h] of [[front, 3.2], [back, 2.7]] as const) {
      const [x, y] = at(u, v);
      const g = terrain.heightAt(x, y);
      gmin = Math.min(gmin, g);
      box(mb, x, y, 0.1, 0.1, rot, g - 0.1, g + h, TIMBER);
    }
  }
  const [fa, fb, ba, bb] = [at(s0 - 0.4, front + 0.8), at(s1 + 0.4, front + 0.8), at(s0 - 0.4, back - 0.5), at(s1 + 0.4, back - 0.5)];
  const zf = gmin + 3.25, zb = gmin + 2.75;
  const V = (q: [number, number], z: number): Vec3 => toThree(q[0], q[1], z);
  mb.quad(V(fa, zf + 0.08), V(fb, zf + 0.08), V(bb, zb + 0.08), V(ba, zb + 0.08), [0, 1, 0], SHELTER_TOP);
  mb.quad(V(fa, zf), V(fb, zf), V(bb, zb), V(ba, zb), [0, -1, 0], SHELTER_UNDER);
  // Pannes de bois sous le toit, à l'avant et à l'arrière.
  for (const [v, z] of [[front, zf - 0.12], [back, zb - 0.12]] as const) {
    const [x, y] = at((s0 + s1) / 2, v);
    box(mb, x, y, (s1 - s0) / 2 + 0.2, 0.09, rot, z - 0.16, z, TIMBER);
  }
  // Cibles : poteau, anneau blanc vertical de 1,2 m de rayon, fanion rouge.
  for (const [x, y] of p.targets) {
    const g = terrain.heightAt(x, y);
    pole(mb, x, y, 0.04, g, g + 1.5, TARGET);
    const seg = 10, R = 1.2;
    for (let k = 0; k < seg; k++) {
      const a0 = (2 * Math.PI * k) / seg, a1 = (2 * Math.PI * (k + 1)) / seg;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const P = (a: number): [number, number, number] => [x + Math.cos(a) * R * c, y + Math.cos(a) * R * sn, g + 1.5 + Math.sin(a) * R];
      const q0 = P(a0), q1 = P(a1);
      const mxp = (q0[0] + q1[0]) / 2, myp = (q0[1] + q1[1]) / 2, mz = (q0[2] + q1[2]) / 2;
      box(mb, mxp, myp, 0.05, 0.05, rot, mz - 0.38, mz + 0.38, TARGET);
    }
    pole(mb, x + 0.3, y, 0.02, g, g + 2.6, TARGET, 4);
    box(mb, x + 0.5, y, 0.2, 0.01, 0, g + 2.25, g + 2.55, TARGET_FLAG);
  }
}

export function buildGolf(mb: MeshBuilder, s: GolfSite, terrain: HeightField): void {
  if (s.practice) practice(mb, s.practice, terrain);
  tent(mb, s.tent, terrain);
  for (const [x, y, r] of s.tables) table(mb, x, y, r, terrain);
  for (const [x, y] of s.parasols) parasol(mb, x, y, terrain);
  sign(mb, s.sign, terrain);
  s.flags.forEach(([x, y], k) => flag(mb, x, y, k, terrain));
}

