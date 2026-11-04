import * as THREE from "three";
import type { BandstandSite, CurtainSite, HeightField, MemorialSite } from "../data/types";
import { at, bandstandRing, frameOf } from "../core/landmarks";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";

/**
 * Place du Champ de Mars (D155) : tilleuls taillés en rideau (couronne en pavé à dessus chanfreiné sur deux files de troncs nus, comme sur les photos et
 * l'orthophotographie : une fente sombre au milieu de chaque bloc) et kiosque à musique d'après photo (socle de pierre à marches, huit colonnes de fonte,
 * lambrequins, garde-corps, toit à huit pans à faible pente couronné d'un épi) ; monument aux morts d'après photos (D227). Dans le maillage plein de la
 * tuile : aucun appel de dessin de plus.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const TRUNK = C("#4a3a2c"), CROWN = C("#5f8f4a"), CROWN_TOP = C("#79a85c");
const STONE = C("#c9b99a"), IRON = C("#4a3a30"), ROOF = C("#6a5a4c"), ROOF_UNDER = C("#d8cdb4"), LACE = C("#e8dec4"), PLAQUE = C("#2d52a0");
/** Chanfrein du dessus d'un rideau (m) et épaisseur des troncs. */
const CHAMFER = 0.5, TRUNK_HALF = 0.15;

/** Pavé droit orienté (repère f) : s0..s1, t0..t1 (m depuis le centre), z0..z1 absolus. */
export function slab(mb: MeshBuilder, f: ReturnType<typeof frameOf>, s0: number, s1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color, top: THREE.Color = col, ends = true): void {
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
export function buildCurtain(mb: MeshBuilder, s: CurtainSite, terrain: HeightField, leaves: MeshBuilder = mb): void {
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
    slab(leaves, f, u0, u1, -s.w / 2, s.w / 2, zLow, zTop - CHAMFER, CROWN, shade(CROWN, 0.9), i === 0 || i === n - 1);
    slab(leaves, f, u0 + (i === 0 ? CHAMFER : 0), u1 - (i === n - 1 ? CHAMFER : 0), -s.w / 2 + CHAMFER, s.w / 2 - CHAMFER, zTop - CHAMFER, zTop, CROWN_TOP, CROWN_TOP, false);
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

// --- Monument aux morts (D227) ------------------------------------------------------------------------------------------------------

const LIME = C("#efe9d8"), LIME_DARK = C("#d6cdb6"), NICHE = C("#b3a990"), PANEL = C("#e6dec9"), LETTER = C("#9e9482"), CARVED = C("#f6f1e4");
const GARLAND = C("#cdc3a9"), PLAQUE_DARK = C("#3c3a36");
/** Mots du bandeau de la face avant (lettres en aplat, 5 cm par lettre). */
const MEMORIAL_WORDS = ["AUTUN", "A", "SES", "ENFANTS", "MORTS", "POUR", "LA", "PATRIE", "1914-1918"];

/**
 * Monument aux morts de la place du Champ de Mars, d'après les photos de l'utilisateur (D227) : esplanade à deux degrés, grand socle à corniche
 * couvert de plaques de noms (bandeau d'inscription sur la face avant), guirlande au pied du fût ; fût à pilastres d'angle et quatre niches cintrées
 * (femme et enfant devant et derrière, femme voilée sur les côtés) ; chapiteau évasé ; génie ailé debout portant un homme, ailes repliées jusqu'au
 * sommet mesuré. Repère : s vers la face avant (cap `a`), t vers la gauche de qui regarde le monument de face.
 */
export function buildMemorial(mb: MeshBuilder, s: MemorialSite, terrain: HeightField): void {
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const P = (u: number, t: number, z: number): Vec3 => toThree(...at(f, u, t), z);
  const N = (us: number, vt: number, z = 0): Vec3 => {
    const l = Math.hypot(us, vt, z) || 1;
    return toThree((f.ux * us + f.vx * vt) / l, (f.uy * us + f.vy * vt) / l, z / l);
  };
  const box = (s0: number, s1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color, top: THREE.Color = shade(col, 1.04)): void =>
    slab(mb, f, s0, s1, t0, t1, z0, z1, col, top);
  const cbox = (ds: number, wt: number, z0: number, z1: number, col: THREE.Color, top?: THREE.Color): void => box(-ds / 2, ds / 2, -wt / 2, wt / 2, z0, z1, col, top);
  /** Tronc de pyramide rectangulaire centré : (d0 × w0) en z0, (d1 × w1) en z1, faces inclinées. */
  const flare = (d0: number, w0: number, d1: number, w1: number, z0: number, z1: number, col: THREE.Color): void => {
    const h = z1 - z0;
    for (const [ns, nt] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const a0 = ns ? d0 / 2 : w0 / 2, a1 = ns ? d1 / 2 : w1 / 2; // distance de la face
      const b0 = ns ? w0 / 2 : d0 / 2, b1 = ns ? w1 / 2 : d1 / 2; // demi-largeur de la face
      const pt = (a: number, b: number, z: number): Vec3 => P(ns * a - nt * b, nt * a + ns * b, z);
      mb.quad(pt(a0, -b0, z0), pt(a0, b0, z0), pt(a1, b1, z1), pt(a1, -b1, z1), N(ns * h, nt * h, a0 - a1), ns ? col : shade(col, 0.93));
    }
    mb.quad(P(-d1 / 2, -w1 / 2, z1), P(d1 / 2, -w1 / 2, z1), P(d1 / 2, w1 / 2, z1), P(-d1 / 2, w1 / 2, z1), [0, 1, 0], shade(col, 1.04));
  };
  /** Rectangle posé sur une face (normale (ns, nt), à `d` du centre + `off`), de u0 à u1 le long de la face (vers la droite vue de face), z0 à z1. */
  const onFace = (ns: number, nt: number, d: number, u0: number, u1: number, z0: number, z1: number, col: THREE.Color, off = 0.012): void => {
    const pt = (u: number, z: number): Vec3 => P(ns * (d + off) - nt * u, nt * (d + off) + ns * u, z);
    mb.quad(pt(u0, z0), pt(u1, z0), pt(u1, z1), pt(u0, z1), N(ns, nt), col);
  };
  /** Tronc d'ellipse à `n` pans centré en (u, t) : demi-axes (rs le long de s, rt le long de t) en z0 et en z1, dessus fermé. */
  const frustum = (u: number, t: number, rs0: number, rt0: number, rs1: number, rt1: number, z0: number, z1: number, col: THREE.Color, n = 6): void => {
    const pts = (rs: number, rt: number, z: number): Vec3[] => Array.from({ length: n }, (_, i) => {
      const th = (2 * Math.PI * (i + 0.5)) / n;
      return P(u + rs * Math.cos(th), t + rt * Math.sin(th), z);
    });
    const lo = pts(rs0, rt0, z0), hi = pts(rs1, rt1, z1);
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * (i + 1)) / n;
      const j = (i + 1) % n;
      mb.quad(lo[i]!, lo[j]!, hi[j]!, hi[i]!, N(Math.cos(th), Math.sin(th), 0.15), shade(col, 0.9 + 0.1 * Math.cos(th)));
    }
    if (rs1 > 0.01) for (let i = 1; i + 1 < n; i++) mb.tri(hi[0]!, hi[i]!, hi[i + 1]!, [0, 1, 0], col);
  };
  /** Personnage drapé debout tourné vers (ns, nt) : robe, buste, cou et tête ; `k` élargit les épaules. */
  const figure = (u: number, t: number, z0: number, h: number, ns: number, nt: number, col: THREE.Color, k = 1): void => {
    // Demi-axes : `w` en travers du regard, `d` dans le sens du regard (le repère du monument est carré : on échange s et t sur les côtés).
    const ax = (w: number, d: number): [number, number] => (ns ? [d, w] : [w, d]);
    const q = h / 1.8;
    frustum(u, t, ...ax(0.21 * q * k, 0.14 * q), ...ax(0.16 * q * k, 0.12 * q), z0, z0 + 0.52 * h, col);
    frustum(u, t, ...ax(0.16 * q * k, 0.12 * q), ...ax(0.22 * q * k, 0.12 * q), z0 + 0.52 * h, z0 + 0.84 * h, col);
    frustum(u, t, ...ax(0.06 * q, 0.06 * q), ...ax(0.06 * q, 0.06 * q), z0 + 0.84 * h, z0 + 0.88 * h, col, 5);
    frustum(u + ns * 0.01, t + nt * 0.01, ...ax(0.08 * q, 0.09 * q), ...ax(0.085 * q, 0.095 * q), z0 + 0.88 * h, z0 + 0.95 * h, col, 6);
    frustum(u + ns * 0.01, t + nt * 0.01, ...ax(0.085 * q, 0.095 * q), ...ax(0.03 * q, 0.03 * q), z0 + 0.95 * h, z0 + h, col, 6);
  };

  // Esplanade : degrés du bas vers le haut, le premier descend sous le relief.
  let low = Infinity;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const) low = Math.min(low, terrain.heightAt(...at(f, (x * s.steps[0]![0]) / 2, (y * s.steps[0]![1]) / 2)));
  let zp = s.g;
  s.steps.forEach(([d, w, h], i) => {
    cbox(d, w, i === 0 ? Math.min(low, s.g) - 0.3 : zp - 0.05, zp + h, i ? LIME : LIME_DARK, shade(LIME, i ? 1.02 : 0.98));
    zp += h;
  });
  // Plaque sur pied devant le degré du bas, à droite (photos de face).
  {
    const sp = s.steps[0]![0] / 2 + 0.45, tp = -0.9;
    box(sp - 0.04, sp + 0.04, tp - 0.04, tp + 0.04, s.g - 0.2, s.g + 0.55, PLAQUE_DARK);
    const z0 = s.g + 0.5, z1 = s.g + 0.85, b = 0.12; // pupitre incliné vers l'avant
    mb.quad(P(sp + b, tp - 0.3, z0), P(sp + b, tp + 0.3, z0), P(sp - b, tp + 0.3, z1), P(sp - b, tp - 0.3, z1), N(z1 - z0, 0, 2 * b), PLAQUE_DARK);
    mb.quad(P(sp + b - 0.03, tp - 0.25, z0 + 0.04), P(sp + b - 0.03, tp + 0.25, z0 + 0.04), P(sp - b + 0.03, tp + 0.25, z1 - 0.04), P(sp - b + 0.03, tp - 0.25, z1 - 0.04), N(z1 - z0, 0, 2 * b), C("#d8d2c4"));
  }

  // Socle : plinthe, corps couvert de plaques de noms, corniche.
  const [D, W, H] = s.socle;
  cbox(D + 0.16, W + 0.16, zp - 0.05, zp + 0.18, LIME_DARK);
  cbox(D, W, zp + 0.18, zp + H - 0.24, LIME);
  cbox(D + 0.2, W + 0.2, zp + H - 0.24, zp + H - 0.08, shade(LIME, 1.03));
  cbox(D + 0.1, W + 0.1, zp + H - 0.08, zp + H, LIME);
  for (const [ns, nt] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const dist = ns ? D / 2 : W / 2, width = ns ? W : D;
    const front = ns === 1;
    const n = Math.max(3, Math.round(width / 0.52));
    const gap = 0.05, m = 0.14, pw = (width - 2 * m - (n - 1) * gap) / n;
    const z0 = zp + 0.32, z1 = zp + H - (front ? 0.5 : 0.36);
    for (let i = 0; i < n; i++) {
      const u0 = -width / 2 + m + i * (pw + gap), u1 = u0 + pw;
      onFace(ns, nt, dist, u0, u1, z0, z1, PANEL);
      // Noms gravés : lignes sombres sur le panneau.
      const rows = 9, lh = (z1 - z0 - 0.16) / rows;
      for (let r = 0; r < rows; r++) {
        const zl = z0 + 0.08 + r * lh + lh * 0.35;
        const inset = 0.05 + 0.04 * ((i * 7 + r * 3) % 4) / 3;
        onFace(ns, nt, dist, u0 + 0.05, u1 - inset, zl, zl + Math.min(0.035, lh * 0.45), LETTER, 0.018);
      }
    }
    if (front) {
      // Bandeau : AUTUN A SES ENFANTS MORTS POUR LA PATRIE 1914-1918.
      const letters = MEMORIAL_WORDS.reduce((a, w) => a + w.length, 0), lw = 0.052, sp = 0.07;
      let u = -(letters * lw + (MEMORIAL_WORDS.length - 1) * sp) / 2;
      const zb = zp + H - 0.43;
      for (const w of MEMORIAL_WORDS) {
        onFace(ns, nt, dist, u, u + w.length * lw - 0.01, zb, zb + 0.08, LETTER, 0.014);
        u += w.length * lw + sp;
      }
    }
  }

  // Guirlande au pied du fût : glacis et boutons de feuillage sur les quatre faces.
  const [Ds, Ws, zTop] = s.shaft;
  const zs0 = zp + H + 0.35, zs1 = zp + zTop;
  flare(D + 0.04, W + 0.04, Ds + 0.5, Ws + 0.5, zp + H, zp + H + 0.2, GARLAND);
  cbox(Ds + 0.3, Ws + 0.3, zp + H + 0.15, zs0, LIME);
  for (const [ns, nt] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const dist = (ns ? Ds : Ws) / 2 + 0.35, width = ns ? Ws : Ds;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const u = -width / 2 + (width * (i + 0.5)) / n;
      const [cs, ct] = [ns * dist - nt * u, nt * dist + ns * u];
      frustum(cs, ct, 0.13, 0.13, 0.08, 0.08, zp + H + 0.12, zp + H + (i === 2 && ns === 1 ? 0.45 : 0.32), GARLAND, 5);
    }
  }

  // Fût : seuil, piliers d'angle, fond des niches, linteau ; arcs des niches et personnages.
  const PIER = 0.36, DEPTH = 0.3;
  const zn0 = zs0 + 0.22, zn1 = zs1 - 0.35;
  cbox(Ds, Ws, zs0, zn0, LIME);
  cbox(Ds, Ws, zn1, zs1, LIME);
  cbox(Ds - 2 * DEPTH, Ws - 2 * DEPTH, zn0, zn1, NICHE, NICHE);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const s0 = a > 0 ? Ds / 2 - PIER : -Ds / 2, t0 = b > 0 ? Ws / 2 - PIER : -Ws / 2;
    box(s0, s0 + PIER, t0, t0 + PIER, zn0, zn1, LIME);
  }
  for (const [ns, nt] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const dist = (ns ? Ds : Ws) / 2, width = ns ? Ws : Ds;
    const R = width / 2 - PIER, zc = zn1 - R;
    const pt = (u: number, z: number, d = dist): Vec3 => P(ns * d - nt * u, nt * d + ns * u, z);
    const K = 6;
    for (let i = 0; i < K; i++) {
      const a0 = (Math.PI * i) / K, a1 = (Math.PI * (i + 1)) / K;
      const [u0, z0, u1, z1] = [R * Math.cos(a0), zc + R * Math.sin(a0), R * Math.cos(a1), zc + R * Math.sin(a1)];
      // Écoinçon : du coin haut du côté de l'arc jusqu'au segment d'arc.
      const corner = pt((u0 + u1) / 2 >= 0 ? R : -R, zn1);
      mb.tri(corner, pt(u0, z0), pt(u1, z1), N(ns, nt), LIME);
      // Intrados : du nu de la face au fond de la niche, normale vers le centre de l'arc.
      const am = (a0 + a1) / 2;
      mb.quad(pt(u0, z0), pt(u1, z1), pt(u1, z1, dist - DEPTH), pt(u0, z0, dist - DEPTH), N(nt * Math.cos(am), -ns * Math.cos(am), -Math.sin(am)), shade(NICHE, 1.08));
    }
    // Personnages : femme et enfant devant et derrière, femme voilée sur les côtés.
    const fd = dist - DEPTH / 2 - 0.02;
    if (ns) {
      figure(ns * fd, ns * -0.12, zn0, 1.75, ns, 0, CARVED, 1.3);
      figure(ns * (fd + 0.04), ns * 0.33, zn0, 0.95, ns, 0, CARVED, 1.2);
    } else {
      figure(0, nt * fd, zn0, 1.9, 0, nt, CARVED, 1.3);
    }
  }

  // Chapiteau évasé et plinthe de la statue.
  cbox(Ds + 0.2, Ws + 0.2, zs1, zs1 + 0.15, LIME);
  flare(Ds + 0.2, Ws + 0.2, Ds + 0.5, Ws + 0.5, zs1 + 0.15, zs1 + 0.36, LIME);
  cbox(Ds + 0.5, Ws + 0.5, zs1 + 0.36, zs1 + 0.5, shade(LIME, 1.02));
  cbox(1.4, 1.3, zs1 + 0.5, zs1 + 0.7, LIME);

  // Génie ailé portant un homme : les ailes montent jusqu'au sommet mesuré.
  const zst = zs1 + 0.7, ht = Math.max(1.8, s.top - zst), hA = ht - 0.3;
  figure(-0.14, 0, zst, hA, 1, 0, CARVED, 1.5);
  figure(0.22, 0.05, zst, hA * 0.88, 1, 0, CARVED, 1.35);
  box(0.14, 0.4, -0.34, 0.34, zst + 0.62 * hA, zst + 0.69 * hA, CARVED); // bras qui enlacent
  for (const side of [-1, 1]) {
    const w = (u: number, t: number, z: number): Vec3 => P(u, side * t, zst + z);
    const pts = [w(-0.24, 0.16, 0.84 * hA), w(-0.46, 0.5, ht), w(-0.56, 0.84, 0.78 * hA), w(-0.46, 0.62, 0.3 * hA), w(-0.28, 0.24, 0.5 * hA)];
    const nrm = N(0.68, side * 0.32, 0.02); // perpendiculaire au bord racine – pointe ((−0,32 ; 0,68) en plan)
    const back: Vec3 = [-nrm[0], -nrm[1], -nrm[2]];
    for (let i = 1; i + 1 < pts.length; i++) {
      mb.tri(pts[0]!, pts[i]!, pts[i + 1]!, nrm, CARVED);
      mb.tri(pts[0]!, pts[i]!, pts[i + 1]!, back, shade(CARVED, 0.86));
    }
  }
}
