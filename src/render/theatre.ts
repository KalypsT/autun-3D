import * as THREE from "three";
import type { HeightField, TheatreSite } from "../data/types";
import {
  designedZ, laneHalf, splitByLanes, terraces, theatreLayout, xyOf, type TheatreLane, type TheatreLayout,
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
const MASONRY = C("#8c7f6b"), MASONRY_DARK = C("#776b59");
const STEP = C("#b3ab9c"), STEP_FRONT = C("#8d8577");
const SAND = C("#d6ad85"), PAVE = C("#b4ab9b");
const STAGE_TOP = C("#d8d5ce"), STAGE_SIDE = C("#77746e"), STAGE_STEP = C("#c2bfb7"), STAGE_FRONT = C("#9a978f");

/** Pas angulaire maximal des arcs (rad). */
const DU = (4 * Math.PI) / 180;

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
      mb.quad(P(c, R, ua, ba), P(c, R, ub, bb), P(c, R, ub, z), P(c, R, ua, z), radial(c, um, sign), front);
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
      mb.quad(P(c, ra, u, ba), P(c, rb, u, bb), P(c, rb, u, zb), P(c, ra, u, za), tangent(c, u, sign), side);
    }
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

function lane(c: Ctx, l: TheatreLane): void {
  for (const p of l.pieces) {
    const t = (p.r1 - p.r0) / p.steps, h = (p.z1 - p.z0) / p.steps;
    for (let i = 0; i < p.steps; i++) {
      const ra = p.r0 + i * t, rb = ra + t, hw = laneHalf(l, (ra + rb) / 2);
      flat(c, l.u - hw, l.u + hw, ra, rb, p.z0 + (i + 1) * h, STEP, STEP_FRONT, MASONRY_DARK);
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
  // Coins de la partie haute et massifs ruinés.
  for (const b of L.blocks) {
    if (b.stepped) {
      for (const [r0, r1, z] of terraces(b)) piece(c, b.u0, b.u1, r0, r1, z, z, moss, MASONRY, MASONRY_DARK);
    } else {
      for (let j = 0; j + 1 < b.prof.length; j++) {
        const [r0, z0] = b.prof[j]!, [r1, z1] = b.prof[j + 1]!;
        piece(c, b.u0, b.u1, r0, r1, z0, z1, grass, MASONRY, MASONRY_DARK);
      }
    }
  }
  for (const l of [...L.lanesLow, ...L.lanesUp]) lane(c, l);
  stage(c);
}
