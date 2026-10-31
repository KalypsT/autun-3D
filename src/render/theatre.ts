import * as THREE from "three";
import type { HeightField, TheatreSite } from "../data/types";
import {
  designedZ, laneHalf, noise, splitByLanes, theatreLayout, xyOf, type TheatreLane, type TheatreLayout,
} from "../core/theatre";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";
import { T } from "./style";

/**
 * Théâtre romain d'Autun (D133), à pans nets d'après les mesures et les photos de l'utilisateur : orchestre de terre battue, podium,
 * gradins restaurés en pierre grise, précinction herbue, coins de la partie haute et massifs ruinés des extrémités (dessus d'herbe, flancs
 * de maçonnerie), escaliers rayonnants, scène moderne sur le diamètre. Le dessin et les tabliers invisibles (core/theatre.ts) suivent les
 * mêmes altitudes.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const ROW = C("#bdb6a8"), ROW_FRONT = C("#958d80");
const PODIUM = C("#a39989"), COPING = C("#cbc3b2");
const MASONRY = C("#8c7f6b"), MASONRY_DARK = C("#776b59"), COURSE = C("#615646");
const WOOD = C("#6b4a32");
const STEP = C("#b3ab9c"), STEP_FRONT = C("#8d8577");
const SAND = C("#d6ad85"), PAVE = C("#b4ab9b");
const STAGE_TOP = C("#d8d5ce"), STAGE_SIDE = C("#77746e"), STAGE_STEP = C("#c2bfb7"), STAGE_FRONT = C("#9a978f");

/** Pas angulaire maximal des arcs (rad). */
const DU = (5 * Math.PI) / 180;

interface Ctx {
  mb: MeshBuilder;
  L: TheatreLayout;
  ground: (x: number, y: number) => number;
}

const P = (c: Ctx, R: number, u: number, z: number): Vec3 => toThree(...xyOf(c.L, R, u), z);
const radial = (c: Ctx, u: number, sign: number): Vec3 => toThree(sign * Math.cos(c.L.s.a + u), sign * Math.sin(c.L.s.a + u), 0);
/** Normale horizontale d'un flanc rayonnant, vers les u croissants (sign 1) ou décroissants (−1). */
const tangent = (c: Ctx, u: number, sign: number): Vec3 => toThree(-sign * Math.sin(c.L.s.a + u), sign * Math.cos(c.L.s.a + u), 0);

function upNormal(a: Vec3, b: Vec3, d: Vec3): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  return [nx / l, ny / l, nz / l];
}

const steps = (u0: number, u1: number): number => Math.max(1, Math.ceil((u1 - u0) / DU));

/** Ce qui est juste de l'autre côté d'un bord : la surface dessinée, ou le relief (un peu enfoncé : le mur y entre). */
function beyond(c: Ctx, R: number, u: number): number {
  return designedZ(c.L, R, u) ?? c.ground(...xyOf(c.L, R, u)) - 0.3;
}

/**
 * Morceau en secteur d'anneau : dessus de z0 (à r0) à z1 (à r1), linéaire en rayon ; ses quatre bords descendent jusqu'à ce qui est de
 * l'autre côté quand c'est plus bas (`sides` : couleurs des faces en rayon, puis des flancs).
 */
function piece(c: Ctx, u0: number, u1: number, r0: number, r1: number, z0: number, z1: number, top: THREE.Color, front: THREE.Color, side: THREE.Color = front): void {
  const { mb } = c;
  const n = steps(u0, u1);
  const us = Array.from({ length: n + 1 }, (_, i) => u0 + ((u1 - u0) * i) / n);
  for (let i = 0; i < n; i++) {
    const a = P(c, r0, us[i]!, z0), b = P(c, r0, us[i + 1]!, z0), cc = P(c, r1, us[i + 1]!, z1), d = P(c, r1, us[i]!, z1);
    mb.quad(a, b, cc, d, upNormal(a, b, d), top);
  }
  const E = 0.3;
  // Bords en arc (intérieur r0, extérieur r1).
  for (const [R, z, out, sign] of [[r0, z0, r0 - E, -1], [r1, z1, r1 + E, 1]] as const) {
    for (let i = 0; i < n; i++) {
      const ua = us[i]!, ub = us[i + 1]!;
      const ba = Math.min(z, beyond(c, out, ua)), bb = Math.min(z, beyond(c, out, ub));
      if (z - ba < 0.02 && z - bb < 0.02) continue;
      const um = (ua + ub) / 2;
      face(c, [R, ua], [R, ub], ba, bb, z, z, radial(c, um, sign), front);
    }
  }
  // Flancs rayonnants.
  const m = Math.max(1, Math.ceil((r1 - r0) / 1.5));
  for (const [u, sign] of [[u0, -1], [u1, 1]] as const) {
    for (let j = 0; j < m; j++) {
      const ra = r0 + ((r1 - r0) * j) / m, rb = r0 + ((r1 - r0) * (j + 1)) / m;
      const za = z0 + ((z1 - z0) * j) / m, zb = z0 + ((z1 - z0) * (j + 1)) / m;
      const ba = Math.min(za, beyond(c, ra, u + (sign * E) / ra)), bb = Math.min(zb, beyond(c, rb, u + (sign * E) / rb));
      if (za - ba < 0.02 && zb - bb < 0.02) continue;
      face(c, [ra, u], [rb, u], ba, bb, za, zb, tangent(c, u, sign), side);
    }
  }
}

/**
 * Face verticale entre (R, u) a et b, du bas (ba, bb) au haut (za, zb). La maçonnerie (D134) est en moellons : teinte nuancée d'une face à
 * l'autre et assises plus sombres tous les 90 cm (à hauteur absolue, alignées d'une face à l'autre).
 */
function face(c: Ctx, a: [number, number], b: [number, number], ba: number, bb: number, za: number, zb: number, n: Vec3, col: THREE.Color): void {
  const masonry = col === MASONRY || col === MASONRY_DARK;
  const k = masonry ? 0.88 + 0.24 * noise(Math.round(a[0] * 3), Math.round(a[1] * 400), Math.round(ba)) : 1;
  c.mb.quad(P(c, a[0], a[1], ba), P(c, b[0], b[1], bb), P(c, b[0], b[1], zb), P(c, a[0], a[1], za), n, k === 1 ? col : col.clone().multiplyScalar(k));
  if (!masonry) return;
  const lo = Math.max(ba, bb) + 0.4, hi = Math.min(za, zb) - 0.3;
  if (hi - lo < 0.6) return;
  const off = (R: number, u: number, z: number): Vec3 => {
    const q = P(c, R, u, z);
    return [q[0] + n[0] * 0.02, q[1], q[2] + n[2] * 0.02];
  };
  for (let z = Math.ceil(lo / 0.9) * 0.9; z + 0.12 < hi; z += 0.9) {
    c.mb.quad(off(a[0], a[1], z), off(b[0], b[1], z), off(b[0], b[1], z + 0.12), off(a[0], a[1], z + 0.12), n, COURSE);
  }
}

/** Le plus haut du relief sous un morceau plat (coins et milieu), pour que le relief ne perce pas une marche. */
function groundMax(c: Ctx, u0: number, u1: number, r0: number, r1: number): number {
  let z = -Infinity;
  for (const R of [r0, (r0 + r1) / 2, r1]) for (const u of [u0, (u0 + u1) / 2, u1]) z = Math.max(z, c.ground(...xyOf(c.L, R, u)));
  return z;
}

function flat(c: Ctx, u0: number, u1: number, r0: number, r1: number, z: number, top: THREE.Color, front: THREE.Color, side: THREE.Color = front): void {
  const zz = Math.max(z, groundMax(c, u0, u1, r0, r1) + 0.03);
  piece(c, u0, u1, r0, r1, zz, zz, top, front, side);
}

/** Sol posé sur le relief (orchestre, dallage au pied du podium). */
function floor(c: Ctx, u0: number, u1: number, r0: number, r1: number, lift: number, col: THREE.Color): void {
  const n = steps(u0, u1) * 2, m = Math.max(1, Math.ceil((r1 - r0) / 6));
  const pt = (R: number, u: number): Vec3 => {
    const [x, y] = xyOf(c.L, R, u);
    return toThree(x, y, c.ground(x, y) + lift);
  };
  for (let j = 0; j < m; j++) {
    const ra = Math.max(0.01, r0 + ((r1 - r0) * j) / m), rb = r0 + ((r1 - r0) * (j + 1)) / m;
    for (let i = 0; i < n; i++) {
      const ua = u0 + ((u1 - u0) * i) / n, ub = u0 + ((u1 - u0) * (i + 1)) / n;
      const a = pt(ra, ua), b = pt(ra, ub), cc = pt(rb, ub), d = pt(rb, ua);
      c.mb.quad(a, b, cc, d, upNormal(a, b, d), col);
    }
  }
}

/** Escalier : marches de pierre en bas ; en haut, marches d'herbe tenues par des traverses de bois (photo depuis l'aile sud, D134). */
function lane(c: Ctx, l: TheatreLane, top: THREE.Color, front: THREE.Color): void {
  for (const p of l.pieces) {
    const t = (p.r1 - p.r0) / p.steps, h = (p.z1 - p.z0) / p.steps;
    for (let i = 0; i < p.steps; i++) {
      const ra = p.r0 + i * t, rb = ra + t, hw = laneHalf(l, (ra + rb) / 2);
      flat(c, l.u - hw, l.u + hw, ra, rb, p.z0 + (i + 1) * h, top, front, MASONRY_DARK);
    }
  }
}

function stage(c: Ctx): void {
  const { mb, L } = c;
  const g = L.stage, zo = L.s.zo;
  const at = (e: number, t: number, z: number): Vec3 => toThree(g.ox + g.ex * e + g.nx * t, g.oy + g.ey * e + g.ny * t, z);
  const gz = (e: number, t: number): number => c.ground(g.ox + g.ex * e + g.nx * t, g.oy + g.ey * e + g.ny * t) - 0.2;
  const nE = toThree(g.ex, g.ey, 0), nN = toThree(g.nx, g.ny, 0);
  const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
  const box = (t0: number, t1: number, z: number, top: THREE.Color, front: THREE.Color): void => {
    mb.quad(at(0, t0, z), at(g.width, t0, z), at(g.width, t1, z), at(0, t1, z), [0, 1, 0], top);
    mb.quad(at(0, t0, gz(0, t0)), at(g.width, t0, gz(g.width, t0)), at(g.width, t0, z), at(0, t0, z), neg(nN), front);
    mb.quad(at(0, t0, gz(0, t0)), at(0, t1, gz(0, t1)), at(0, t1, z), at(0, t0, z), neg(nE), STAGE_SIDE);
    mb.quad(at(g.width, t0, gz(g.width, t0)), at(g.width, t1, gz(g.width, t1)), at(g.width, t1, z), at(g.width, t0, z), nE, STAGE_SIDE);
  };
  // Marches côté orchestre, puis le plateau ; le fond rejoint le pré.
  const t = g.sd / g.steps, h = (g.zt - zo) / g.steps;
  for (let i = 0; i < g.steps - 1; i++) box(i * t, (i + 1) * t, zo + (i + 1) * h, STAGE_STEP, STAGE_FRONT);
  box((g.steps - 1) * t, g.depth, g.zt, STAGE_TOP, STAGE_FRONT);
  mb.quad(at(0, g.depth, gz(0, g.depth)), at(g.width, g.depth, gz(g.width, g.depth)), at(g.width, g.depth, g.zt), at(0, g.depth, g.zt), nN, STAGE_SIDE);
}

const STEEL = C("#9aa3a8"), POLE = C("#8b9196"), LAMP = C("#3a3f44"), SHRUB = C("#2f6a4a");

/** Pavé quelconque : base (quatre coins x, y), du bas z0 au haut z1, côtés et dessus. */
function prism(mb: MeshBuilder, ring: [number, number][], z0: number, z1: number, col: THREE.Color, top: THREE.Color = col): void {
  const n = ring.length;
  let cx = 0, cy = 0;
  for (const [x, y] of ring) { cx += x / n; cy += y / n; }
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % n]!;
    let nx = by - ay, ny = -(bx - ax);
    if (nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const l = Math.hypot(nx, ny) || 1;
    mb.quad(toThree(ax, ay, z0), toThree(bx, by, z0), toThree(bx, by, z1), toThree(ax, ay, z1), toThree(nx / l, ny / l, 0), col);
  }
  for (let i = 1; i + 1 < n; i++) mb.tri(toThree(...ring[0]!, z1), toThree(...ring[i]!, z1), toThree(...ring[i + 1]!, z1), [0, 1, 0], top);
}

/**
 * Barrières de chantier galvanisées le long des deux côtés de la scène (photos ; obstacles de `theatreWalls`, D136) : panneaux de 2,4 m,
 * poteaux, lisses haute et basse, barreaux tous les 20 cm (deux faces), au niveau des marches puis du plateau.
 */
function barriers(c: Ctx): void {
  const { mb, L } = c;
  const g = L.stage, zo = L.s.zo;
  const t1 = g.sd / g.steps, h = (g.zt - zo) / g.steps;
  const zAt = (t: number): number => (t < g.sd - t1 ? zo + (Math.floor(t / t1) + 1) * h : g.zt);
  const at = (e: number, t: number): [number, number] => [g.ox + g.ex * e + g.nx * t, g.oy + g.ey * e + g.ny * t];
  const rect = (e: number, t: number, de: number, dt: number): [number, number][] => [at(e - de, t - dt), at(e + de, t - dt), at(e + de, t + dt), at(e - de, t + dt)];
  const nE = toThree(g.ex, g.ey, 0), nW = toThree(-g.ex, -g.ey, 0);
  for (const e of [0.15, g.width - 0.15]) {
    const t0 = 0.3, tEnd = g.depth - 0.3;
    const panels = Math.max(1, Math.round((tEnd - t0) / 2.4));
    for (let k = 0; k < panels; k++) {
      const a = t0 + ((tEnd - t0) * k) / panels, b = t0 + ((tEnd - t0) * (k + 1)) / panels;
      const z = Math.min(zAt(a + 0.05), zAt(b - 0.05));
      for (const t of [a + 0.04, b - 0.04]) prism(mb, rect(e, t, 0.025, 0.025), zAt(t), zAt(t) + 1.1, STEEL);
      prism(mb, rect(e, (a + b) / 2, 0.02, (b - a) / 2 - 0.04), z + 1.04, z + 1.1, STEEL);
      prism(mb, rect(e, (a + b) / 2, 0.02, (b - a) / 2 - 0.04), z + 0.12, z + 0.18, STEEL);
      for (let t = a + 0.2; t < b - 0.12; t += 0.2) {
        const [x0, y0] = at(e, t - 0.01), [x1, y1] = at(e, t + 0.01);
        for (const [n, off] of [[nE, 0.01], [nW, -0.01]] as const) {
          const ox = g.ex * off, oy = g.ey * off;
          mb.quad(toThree(x0 + ox, y0 + oy, z + 0.18), toThree(x1 + ox, y1 + oy, z + 0.18), toThree(x1 + ox, y1 + oy, z + 1.04), toThree(x0 + ox, y0 + oy, z + 1.04), n, STEEL);
        }
      }
    }
  }
}

/** Poteau d'éclairage (photos) : fût effilé, traverse et deux projecteurs tournés vers la scène et l'orchestre ; jamais allumé (choix de l'utilisateur). */
function pole(c: Ctx, x: number, y: number, h: number): void {
  const { mb, L } = c;
  const z0 = c.ground(x, y) - 0.2, zt = z0 + 0.2 + h;
  const ring = (r: number): [number, number][] => Array.from({ length: 6 }, (_, i) => [x + r * Math.cos((i * Math.PI) / 3), y + r * Math.sin((i * Math.PI) / 3)]);
  const b = ring(0.13), t = ring(0.08);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6, m = ((i + 0.5) * Math.PI) / 3;
    mb.quad(toThree(...b[i]!, z0), toThree(...b[j]!, z0), toThree(...t[j]!, zt), toThree(...t[i]!, zt), toThree(Math.cos(m), Math.sin(m), 0), POLE);
  }
  // Vers le milieu de l'orchestre : traverse perpendiculaire, projecteurs en avant.
  const dx = L.cx - x, dy = L.cy - y, l = Math.hypot(dx, dy) || 1, fx = dx / l, fy = dy / l, sx = -fy, sy = fx;
  const box = (px: number, py: number, hs: number, hf: number, za: number, zb: number, col: THREE.Color): void =>
    prism(mb, [[px - sx * hs - fx * hf, py - sy * hs - fy * hf], [px + sx * hs - fx * hf, py + sy * hs - fy * hf], [px + sx * hs + fx * hf, py + sy * hs + fy * hf], [px - sx * hs + fx * hf, py - sy * hs + fy * hf]], za, zb, col);
  box(x, y, 0.8, 0.05, zt - 0.5, zt - 0.4, POLE);
  for (const k of [-0.6, 0.6]) box(x + sx * k + fx * 0.2, y + sy * k + fy * 0.2, 0.2, 0.15, zt - 0.4, zt - 0.05, LAMP);
}

/** Arbuste taillé en boule (orthophotographie) : octogone qui se resserre en haut. */
function shrub(c: Ctx, x: number, y: number, h: number): void {
  const z0 = c.ground(x, y) - 0.1;
  const ring = (r: number): [number, number][] => Array.from({ length: 8 }, (_, i) => [x + r * Math.cos((i * Math.PI) / 4), y + r * Math.sin((i * Math.PI) / 4)]);
  const lo = ring(0.6), mid = ring(0.75), hi = ring(0.42);
  const zm = z0 + 0.1 + h * 0.55, zt = z0 + 0.1 + h;
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8, m = ((i + 0.5) * Math.PI) / 4, nx = Math.cos(m), ny = Math.sin(m);
    c.mb.quad(toThree(...lo[i]!, z0), toThree(...lo[j]!, z0), toThree(...mid[j]!, zm), toThree(...mid[i]!, zm), toThree(nx, ny, 0), SHRUB);
    c.mb.quad(toThree(...mid[i]!, zm), toThree(...mid[j]!, zm), toThree(...hi[j]!, zt), toThree(...hi[i]!, zt), toThree(nx * 0.7, ny * 0.7, 0.7), SHRUB.clone().multiplyScalar(1.12));
  }
  for (let i = 1; i < 7; i++) c.mb.tri(toThree(...hi[0]!, zt), toThree(...hi[i]!, zt), toThree(...hi[i + 1]!, zt), [0, 1, 0], SHRUB.clone().multiplyScalar(1.2));
}

/** Dessine le théâtre dans le maillage plein de sa tuile. */
export function buildTheatre(mb: MeshBuilder, s: TheatreSite, terrain: HeightField): void {
  const L = theatreLayout(s);
  const bare = terrain.ground ?? terrain;
  const c: Ctx = { mb, L, ground: (x, y) => bare.heightAt(x, y) };
  const grass = new THREE.Color(T.ground[3]).multiplyScalar(1.08);
  const moss = grass.clone().lerp(MASONRY, 0.3);
  const H = Math.PI / 2;
  // Orchestre : terre battue, dallage au pied du podium.
  floor(c, -H, H, 0, s.ro - 1.0, 0.04, SAND);
  floor(c, -H, H, s.ro - 1.0, s.ro, 0.05, PAVE);
  // Podium (l'escalier de l'axe le traverse), rangs restaurés, précinction.
  const central = L.lanesLow.filter((l) => l.pieces.length > 1);
  for (const [a, b] of splitByLanes(central, L.rest[0], L.rest[1], (s.ro + L.rw0) / 2)) flat(c, a, b, s.ro, L.rw0, L.zpod, COPING, PODIUM);
  for (const row of L.rows) {
    for (const [a, b] of splitByLanes(L.lanesLow, L.rest[0], L.rest[1], (row.r0 + row.r1) / 2)) flat(c, a, b, row.r0, row.r1, row.z, ROW, ROW_FRONT);
  }
  flat(c, L.rest[0], L.rest[1], L.r1, L.r2, L.zp, grass, MASONRY);
  // Coins de la partie haute (herbe, ou rangs restaurés) et massifs ruinés (blocs de maçonnerie au dessus moussu).
  for (const p of L.pieces) {
    if (p.kind === "row") piece(c, p.u0, p.u1, p.r0, p.r1, p.z0, p.z1, ROW, ROW_FRONT, MASONRY_DARK);
    else if (p.kind === "ruin") flat(c, p.u0, p.u1, p.r0, p.r1, p.z0, moss, MASONRY, MASONRY_DARK);
    else piece(c, p.u0, p.u1, p.r0, p.r1, p.z0, p.z1, grass, MASONRY, MASONRY_DARK);
  }
  // Murs rayonnants des voûtes qui affleurent dans l'herbe des coins non restaurés (photos, relevé : bandes plus hautes dans chaque coin).
  for (const b of L.blocks) {
    if (b.stepped || b.rows > 1) continue;
    for (const f of [0.3, 0.7]) {
      const u = b.u0 + (b.u1 - b.u0) * f;
      for (let j = 0; j + 1 < b.prof.length; j++) {
        const [r0, z0] = b.prof[j]!, [r1, z1] = b.prof[j + 1]!;
        const ra = j === 0 ? r0 + 1.5 : r0, rb = j + 2 === b.prof.length ? r1 - 1.5 : r1;
        const za = z0 + ((z1 - z0) * (ra - r0)) / (r1 - r0), zb = z0 + ((z1 - z0) * (rb - r0)) / (r1 - r0);
        const hw = 0.45 / ((ra + rb) / 2);
        piece(c, u - hw, u + hw, ra, rb, za + 0.12, zb + 0.12, MASONRY, MASONRY, MASONRY_DARK);
      }
    }
  }
  for (const l of L.lanesLow) lane(c, l, STEP, STEP_FRONT);
  for (const l of L.lanesUp) lane(c, l, grass, WOOD);
  stage(c);
  barriers(c);
  for (const [x, y, h] of s.poles ?? []) pole(c, x, y, h);
  for (const [x, y, h] of s.shrubs ?? []) shrub(c, x, y, h);
}
