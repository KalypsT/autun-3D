import * as THREE from "three";
import type { BandstandSite, CurtainSite, HeightField } from "../data/types";
import { at, bandstandRing, frameOf } from "../core/landmarks";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";

/**
 * Place du Champ de Mars (D155) : tilleuls taillés en rideau (couronne en pavé à dessus chanfreiné sur deux files de troncs nus, comme sur les photos et
 * l'orthophotographie : une fente sombre au milieu de chaque bloc) et kiosque à musique d'après photo (socle de pierre à marches, huit colonnes de fonte,
 * lambrequins, garde-corps, toit à huit pans à faible pente couronné d'un épi). Dans le maillage plein de la tuile : aucun appel de dessin de plus.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const TRUNK = C("#4a3a2c"), CROWN = C("#5f8f4a"), CROWN_TOP = C("#79a85c");
const STONE = C("#c9b99a"), IRON = C("#4a3a30"), ROOF = C("#6a5a4c"), ROOF_UNDER = C("#d8cdb4"), LACE = C("#e8dec4"), PLAQUE = C("#2d52a0");
/** Chanfrein du dessus d'un rideau (m) et épaisseur des troncs. */
const CHAMFER = 0.5, TRUNK_HALF = 0.15;

/** Pavé droit orienté (repère f) : s0..s1, t0..t1 (m depuis le centre), z0..z1 absolus. */
function slab(mb: MeshBuilder, f: ReturnType<typeof frameOf>, s0: number, s1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color, top: THREE.Color = col, ends = true): void {
  const P = (s: number, t: number, z: number): Vec3 => toThree(...at(f, s, t), z);
  const N = (us: number, vt: number): Vec3 => toThree(f.ux * us + f.vx * vt, f.uy * us + f.vy * vt, 0);
  mb.quad(P(s0, t0, z0), P(s1, t0, z0), P(s1, t0, z1), P(s0, t0, z1), N(0, -1), col);
  mb.quad(P(s1, t1, z0), P(s0, t1, z0), P(s0, t1, z1), P(s1, t1, z1), N(0, 1), col);
  if (ends) {
    mb.quad(P(s0, t1, z0), P(s0, t0, z0), P(s0, t0, z1), P(s0, t1, z1), N(-1, 0), shade(col, 0.92));
    mb.quad(P(s1, t0, z0), P(s1, t1, z0), P(s1, t1, z1), P(s1, t0, z1), N(1, 0), shade(col, 0.92));
  }
  mb.quad(P(s0, t0, z1), P(s1, t0, z1), P(s1, t1, z1), P(s0, t1, z1), [0, 1, 0], top);
}

/** Rideau de tilleuls : un tronçon de couronne par pas de troncs (le relief le suit), les troncs nus dessous. */
export function buildCurtain(mb: MeshBuilder, s: CurtainSite, terrain: HeightField): void {
  const f = frameOf(s.c[0], s.c[1], s.a, s.l, s.w);
  const n = Math.max(1, Math.round(s.l / s.pitch));
  const step = s.l / n;
  const gr = (u: number, t = 0): number => terrain.heightAt(...at(f, u, t));
  for (let i = 0; i < n; i++) {
    const u0 = -s.l / 2 + step * i, u1 = u0 + step, um = (u0 + u1) / 2;
    const g = Math.max(gr(u0), gr(u1), gr(um));
    const zTop = gr(um) + s.top;
    const zLow = Math.min(gr(um, -s.w / 2), gr(um, s.w / 2), gr(um)) + s.trunk;
    // Couronne : pavé jusqu'au chanfrein, puis un dessus plus étroit.
    slab(mb, f, u0, u1, -s.w / 2, s.w / 2, zLow, zTop - CHAMFER, CROWN, shade(CROWN, 0.9), i === 0 || i === n - 1);
    slab(mb, f, u0 + (i === 0 ? CHAMFER : 0), u1 - (i === n - 1 ? CHAMFER : 0), -s.w / 2 + CHAMFER, s.w / 2 - CHAMFER, zTop - CHAMFER, zTop, CROWN_TOP, CROWN_TOP, false);
    for (const r of s.rows) {
      const t = r * s.w;
      slab(mb, f, um - TRUNK_HALF, um + TRUNK_HALF, t - TRUNK_HALF, t + TRUNK_HALF, Math.min(g, gr(um, t)) - 0.2, zLow, TRUNK, TRUNK, false);
    }
  }
}

/** Kiosque à musique. */
export function buildBandstand(mb: MeshBuilder, s: BandstandSite, terrain: HeightField): void {
  const zf = s.hi + s.floor;
  const ro = s.r - 0.5; // socle : le contour BD TOPO est celui du toit, qui déborde
  const outer = bandstandRing(s, ro);
  const n = s.nv;
  const h = (p: [number, number]): number => terrain.heightAt(p[0], p[1]);
  const P = (p: [number, number], z: number): Vec3 => toThree(p[0], p[1], z);
  const nrm = (a: [number, number], b: [number, number]): Vec3 => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return toThree(dy / L, -dx / L, 0);
  };
  // Marches : sur le côté le plus bas, largeur 2,4 m, contremarche 0,19 m.
  const lowIdx = (() => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const a = s.ph + (2 * Math.PI * (i + 0.5)) / n;
      const d = Math.abs(Math.atan2(Math.sin(a - s.low), Math.cos(a - s.low)));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  })();
  // Socle : huit faces de pierre, du terrain (0,4 m sous lui) au plancher ; dessus du plancher.
  for (let i = 0; i < n; i++) {
    const a = outer[i]!, b = outer[(i + 1) % n]!;
    mb.quad(P(a, Math.min(h(a), zf) - 0.4), P(b, Math.min(h(b), zf) - 0.4), P(b, zf), P(a, zf), nrm(a, b), STONE);
    mb.quad(P(a, zf), P(b, zf), P(b, zf + 0.12), P(a, zf + 0.12), nrm(a, b), shade(STONE, 1.08));
  }
  const flat: Vec3 = [0, 1, 0];
  for (let i = 1; i + 1 < n; i++) mb.tri(P(outer[0]!, zf + 0.12), P(outer[i]!, zf + 0.12), P(outer[i + 1]!, zf + 0.12), flat, shade(STONE, 1.1));
  // Volée de marches devant le côté bas.
  {
    const a = outer[lowIdx]!, b = outer[(lowIdx + 1) % n]!;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const ox = mx - s.c[0], oy = my - s.c[1], L = Math.hypot(ox, oy) || 1;
    const nx = ox / L, ny = oy / L, tx = -ny, ty = nx;
    const zg = Math.min(h([mx + nx * 1, my + ny * 1]), zf - 0.2);
    const k = Math.max(2, Math.min(10, Math.round((zf - zg) / 0.19)));
    for (let j = 0; j < k; j++) {
      const d0 = (k - j) * 0.32, d1 = d0 - 0.32;
      const z1 = zf - (j * (zf - zg)) / k - 0.0, z0 = zg - 0.2;
      const A: [number, number] = [mx + nx * d1 - tx * 1.2, my + ny * d1 - ty * 1.2], B: [number, number] = [mx + nx * d1 + tx * 1.2, my + ny * d1 + ty * 1.2];
      const Co: [number, number] = [mx + nx * d0 + tx * 1.2, my + ny * d0 + ty * 1.2], D: [number, number] = [mx + nx * d0 - tx * 1.2, my + ny * d0 - ty * 1.2];
      const nn = toThree(nx, ny, 0);
      // Contremarche (face extérieure) et dessus du degré.
      mb.quad(P(D, z0), P(Co, z0), P(Co, z1), P(D, z1), nn, shade(STONE, 0.95));
      mb.quad(P(D, z1), P(Co, z1), P(B, z1), P(A, z1), flat, shade(STONE, 1.05));
    }
  }
  // Colonnes de fonte aux sommets, garde-corps entre elles (sauf à l'escalier), lambrequins sous l'égout.
  const zc1 = zf + s.eave - 0.15;
  const col: [number, number][] = bandstandRing(s, ro - 0.3);
  const post = (p: [number, number]): void => {
    const q = (dx: number, dy: number): [number, number] => [p[0] + dx, p[1] + dy];
    const hh = s.post / 2;
    const pts = [q(-hh, -hh), q(hh, -hh), q(hh, hh), q(-hh, hh)];
    for (let i = 0; i < 4; i++) {
      const a = pts[i]!, b = pts[(i + 1) % 4]!;
      mb.quad(P(a, zf + 0.12), P(b, zf + 0.12), P(b, zc1), P(a, zc1), nrm(a, b), IRON);
    }
  };
  for (const p of col) post(p);
  for (let i = 0; i < n; i++) {
    const a = col[i]!, b = col[(i + 1) % n]!;
    const out = nrm(a, b), inn: Vec3 = [-out[0], 0, -out[2]];
    if (i !== lowIdx) {
      // Garde-corps : lisse et main courante (deux barres plates), traversables à l'œil.
      for (const [z0, z1] of [[zf + 0.35, zf + 0.42], [zf + 0.95, zf + 1.03]] as const) {
        mb.quad(P(a, z0), P(b, z0), P(b, z1), P(a, z1), out, IRON);
        mb.quad(P(b, z0), P(a, z0), P(a, z1), P(b, z1), inn, IRON);
      }
    }
    // Lambrequin ajouré (aplat crème) sous l'égout.
    mb.quad(P(a, zc1 - 0.55), P(b, zc1 - 0.55), P(b, zc1), P(a, zc1), out, LACE);
    mb.quad(P(b, zc1 - 0.55), P(a, zc1 - 0.55), P(a, zc1), P(b, zc1), inn, LACE);
  }
  // Plaque bleue sur la face du socle qui regarde l'escalier voisin (côté opposé aux marches : lisible depuis la place).
  {
    const k = (lowIdx + 2) % n, a = outer[k]!, b = outer[(k + 1) % n]!;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, out = nrm(a, b);
    const tx = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), ty = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    const e = 0.02, w = 0.4, nx = out[0], ny = -out[2];
    const A: [number, number] = [mx - tx * w + nx * e, my - ty * w + ny * e], B: [number, number] = [mx + tx * w + nx * e, my + ty * w + ny * e];
    mb.quad(P(A, zf - 0.55), P(B, zf - 0.55), P(B, zf - 0.3), P(A, zf - 0.3), out, PLAQUE);
  }
  // Toit à huit pans de faible pente : égout au rayon du contour, sommet sous l'épi (0,7 m).
  const eaveZ = zf + s.eave, apexZ = s.top - 0.7;
  const roof = bandstandRing(s, s.r);
  const apex: Vec3 = toThree(s.c[0], s.c[1], apexZ);
  for (let i = 0; i < n; i++) {
    const a = roof[i]!, b = roof[(i + 1) % n]!;
    const mxn = ((a[0] + b[0]) / 2 - s.c[0]), myn = ((a[1] + b[1]) / 2 - s.c[1]), L = Math.hypot(mxn, myn);
    const slope = (apexZ - eaveZ) / L, nl = Math.hypot(1, slope);
    const nU = toThree((mxn / L) * (slope / nl), (myn / L) * (slope / nl), 1 / nl);
    mb.tri(P(a, eaveZ), P(b, eaveZ), apex, nU, ROOF);
    mb.tri(P(b, eaveZ), P(a, eaveZ), apex, [-nU[0], -nU[1], -nU[2]], ROOF_UNDER);
    // Rive : tranche de l'égout.
    mb.quad(P(a, eaveZ - 0.12), P(b, eaveZ - 0.12), P(b, eaveZ), P(a, eaveZ), nrm(a, b), shade(ROOF, 0.8));
  }
  // Épi : fût fin et boule.
  const sp = (r: number, z0: number, z1: number, col2: THREE.Color): void => {
    const pts: [number, number][] = [[s.c[0] - r, s.c[1] - r], [s.c[0] + r, s.c[1] - r], [s.c[0] + r, s.c[1] + r], [s.c[0] - r, s.c[1] + r]];
    for (let i = 0; i < 4; i++) {
      const a = pts[i]!, b = pts[(i + 1) % 4]!;
      mb.quad(P(a, z0), P(b, z0), P(b, z1), P(a, z1), nrm(a, b), col2);
    }
  };
  sp(0.04, apexZ, s.top, IRON);
  sp(0.12, apexZ + 0.25, apexZ + 0.45, IRON);
}
