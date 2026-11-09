import * as THREE from "three";
import type { CouhardSite, HeightField } from "../data/types";
import { couhardAt, couhardPanel, couhardPosts, couhardRadius, frameOf } from "../core/landmarks";
import { MeshBuilder, toThree } from "./geometry";
import { aimAt, drawProjectors, Floodlight } from "./floodlight";
import { GateDraw } from "./gates";

/**
 * Pierre de Couhard d'après photo (D222, docs/plans/couhard.md) : un cône de blocage tendu entre les sections mesurées au LiDAR (un rayon par
 * secteur de 15° tous les mètres), pans plats irréguliers ; moellons gris-brun, bandes de mortier beige, base restaurée plus claire au
 * sud-est ; trou de fouille sombre au sud-sud-est ; touffes et petits bouleaux sur les ressauts ; piquets en bois, panneaux « Interdit de
 * pénétrer — Chute de pierres », panneau d'information. Éclairée la nuit comme le temple de Janus (même dégradé, si le site a `light`).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const STONE = C("#7e766b"), MORTAR = C("#c2b59c"), RESTORED = C("#cfc3ab"), HOLE = C("#2e2620"), RIM = C("#5e4f40"), GRASS = C("#7c8a4c");
const WOOD = C("#8a6a45"), BIRCH = C("#d9d3c6"), LEAVES = C("#7f9a48");
const SIGN = C("#7a2f1e"), SIGN_TEXT = C("#e8c547"), PLATE = C("#e2c23e"), PANEL = C("#d9d2bf"), FRAME = C("#4a4a46");

/** Secteurs du maillage (6°) ; les sections mesurées (15°) sont interpolées. */
const CAPS = 60;
/** Bandes de mortier plus claires (niveaux, photo 4). */
const BANDS = new Set([3, 9, 10, 15]);

/** Petit nombre pseudo-aléatoire stable dans [0, 1). */
function rnd(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Écart angulaire signé a - b, en degrés, dans [-180, 180). */
const dcap = (a: number, b: number): number => ((((a - b + 180) % 360) + 360) % 360) - 180;

/** Niveaux du maillage : ceux du relevé, plus des demi-niveaux autour de la cavité (son contour reste net). */
export function couhardLevels(s: CouhardSite): number[] {
  const out = [...s.lv];
  for (let z = Math.floor(s.cav.z[0]) - 0.5; z < s.cav.z[1] + 1; z += 1) if (z > 0 && z < s.lv[s.lv.length - 1]!) out.push(z);
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Rayon au niveau `z` (m au-dessus du pré, entre deux niveaux mesurés) et au cap `cap`, sans la cavité. */
function radiusAt(s: CouhardSite, z: number, cap: number): number {
  let i = 0;
  while (i + 2 < s.lv.length && s.lv[i + 1]! <= z) i++;
  const z0 = s.lv[i]!, z1 = s.lv[i + 1]!, k = Math.min(1, Math.max(0, (z - z0) / (z1 - z0)));
  return couhardRadius(s, i, cap) * (1 - k) + couhardRadius(s, i + 1, cap) * k;
}

/** Enfoncement du creux autour du trou (0 à 1, bosse lisse) au cap et au niveau donnés. */
export function couhardHole(s: CouhardSite, z: number, cap: number): number {
  const { cap: c0, half, z: [za, zb] } = s.cav;
  const u = dcap(cap, c0) / half, v = (z - (za + zb) / 2) / ((zb - za) / 2);
  if (Math.abs(u) >= 1 || Math.abs(v) >= 1) return 0;
  return (1 - u * u) * (1 - v * v);
}

/** Rayon de la surface (creux compris, sans le blocage) au niveau `z` et au cap `cap`. */
function surfaceAt(s: CouhardSite, z: number, cap: number): number {
  return radiusAt(s, z, cap) - couhardHole(s, z, cap) * s.cav.d;
}

export function buildCouhard(mb: MeshBuilder, glow: MeshBuilder | null, s: CouhardSite, terrain: HeightField, halo: MeshBuilder | null = null): void {
  const [cx, cy] = s.c;
  // Projecteurs (D297, sans photo de nuit) : quatre au pied, entre la pierre et la clôture, pointés vers le milieu de la hauteur ; le dos
  // des ressauts et la cheminée restent dans la pénombre.
  let fl: Floodlight | null = null;
  if (s.light && glow) {
    const gr = (x: number, z: number): number => terrain.heightAt(x, -z);
    const projectors = [30, 120, 210, 300].map((cap) => {
      const [x, y] = couhardAt(s, cap, radiusAt(s, 0, cap) + 1.1), [wx, wy] = couhardAt(s, cap, radiusAt(s, 6, cap));
      return aimAt(toThree(x, y, terrain.heightAt(x, y) + 0.12), toThree(wx, wy, s.g + 6), { power: 3.4, range: 12, inner: 0.45, outer: 0.95 });
    });
    // La lumière suit la forme d'ensemble (normale tirée de l'axe, un peu levée), pas les pans du blocage : sans quoi le voile fait un damier.
    const [ox, , oz] = toThree(cx, cy, 0);
    fl = new Floodlight(glow, projectors, 0.4, (p, n) => {
      const rx = p[0] - ox, rz = p[2] - oz, rl = Math.hypot(rx, rz) || 1;
      const mx = (0.85 * rx) / rl + 0.15 * n[0], my = 0.3 + 0.15 * n[1], mz = (0.85 * rz) / rl + 0.15 * n[2], ml = Math.hypot(mx, my, mz);
      return [mx / ml, my / ml, mz / ml];
    });
    drawProjectors(mb, glow, halo, projectors, gr);
  }
  const d = new GateDraw(mb, s.light ? glow : null, frameOf(cx, cy, 0, 1, 1), s.g, s.top * 1.1, fl);
  const zs = couhardLevels(s);
  const caps = Array.from({ length: CAPS }, (_, k) => (360 * k) / CAPS);
  // Sommets [s, t, z] (repère centré sur l'axe : s vers l'est, t vers le nord) et enfoncement de la cavité.
  const V: [number, number, number][][] = [], H: number[][] = [];
  zs.forEach((z, li) => {
    const row: [number, number, number][] = [], hr: number[] = [];
    caps.forEach((cap, k) => {
      const h = couhardHole(s, z, cap);
      // Blocage : ± 12 cm (± 18 cm au-dessus du ressaut, ± 6 cm dans la cheminée), rien au pied (il suit le contour d'obstacle) ni dans le
      // creux (le trou y est peint).
      const amp = (z < 0.5 ? 0 : z > 17 ? 0.06 : z > 11 ? 0.18 : 0.12) * (1 - Math.min(1, h * 4));
      const r = Math.max(0.15, surfaceAt(s, z, cap) + (rnd(li * 97 + k * 13) - 0.5) * 2 * amp);
      const [x, y] = couhardAt(s, cap, r);
      row.push([x - cx, y - cy, z < 0.01 ? terrain.heightAt(x, y) - 0.3 : s.g + z]);
      hr.push(h);
    });
    V.push(row);
    H.push(hr);
  });
  const sub = (p: number[], q: number[]): number[] => [p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!];
  for (let li = 0; li + 1 < zs.length; li++) {
    const z = zs[li]!, lvl = Math.floor(z);
    for (let k = 0; k < CAPS; k++) {
      const k1 = (k + 1) % CAPS;
      const a = V[li]![k]!, b = V[li]![k1]!, c = V[li + 1]![k1]!, e = V[li + 1]![k]!;
      // Normale : (e - b) × (c - a), vers l'extérieur.
      const u = sub(e, b), w = sub(c, a);
      let nx = u[1]! * w[2]! - u[2]! * w[1]!, ny = u[2]! * w[0]! - u[0]! * w[2]!, nz = u[0]! * w[1]! - u[1]! * w[0]!;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const cap = caps[k]! + 180 / CAPS, hole = Math.max(H[li]![k]!, H[li]![k1]!, H[li + 1]![k]!, H[li + 1]![k1]!);
      const h = rnd(li * 131 + k * 7.3);
      const col = STONE.clone().lerp(MORTAR, 0.18 + 0.25 * h);
      if (BANDS.has(lvl)) col.lerp(MORTAR, 0.4);
      // Base restaurée, plus claire (photo 2, face sud-est) ; pied rejointoyé tout autour ; le creux, plus sombre.
      if ((Math.abs(dcap(cap, 155)) < 50 && z < 9) || z < 1.5) col.lerp(RESTORED, z < 1.5 ? 0.45 : 0.65);
      if (hole > 0) col.multiplyScalar(1 - 0.18 * hole);
      // Touffes d'herbe sur les replats, une face sur trois.
      if (nz > 0.7 && rnd(li * 7 + k * 0.37) < 0.35) col.lerp(GRASS, 0.4);
      col.multiplyScalar(0.95 + 0.08 * rnd(li * 17 + k * 3.1));
      d.quad(a, b, c, e, d.N(nx, ny, nz), col);
    }
  }
  // Sommet : un éventail du dernier anneau à la pointe mesurée.
  const last = V[V.length - 1]!, tip: [number, number, number] = [s.tip[0], s.tip[1], s.g + s.top];
  for (let k = 0; k < CAPS; k++) {
    const a = last[k]!, b = last[(k + 1) % CAPS]!;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ml = Math.hypot(m[0]!, m[1]!) || 1;
    mb.tri(d.P(...a), d.P(...b), d.P(...tip), d.N(m[0]! / ml, m[1]! / ml, 0.8), shade(STONE.clone().lerp(MORTAR, 0.3), 0.95 + 0.1 * rnd(k)));
  }
  buildHole(new GateDraw(mb, null, frameOf(cx, cy, 0, 1, 1), s.g, 1), s);
  buildTufts(new GateDraw(mb, null, frameOf(cx, cy, 0, 1, 1), s.g, 1), s);
  buildFence(new GateDraw(mb, null, frameOf(0, 0, 0, 1, 1), 0, 1), s, terrain);
}

/** Trou de fouille (photos 2 et 3) : ovale sombre au fond du creux, bordé de moellons plus sombres ; reste noir la nuit. */
function buildHole(d: GateDraw, s: CouhardSite): void {
  const [w, hh, zc] = s.cav.hole, c0 = s.cav.cap, N = 18;
  const layer = (k: number, off: number, col: THREE.Color): void => {
    const pt = (th: number): [number, number, number] => {
      const z = zc + (hh / 2) * k * Math.sin(th), r0 = surfaceAt(s, z, c0);
      const cap = c0 + (((w / 2) * k * Math.cos(th)) / r0) * (180 / Math.PI);
      const [x, y] = couhardAt(s, cap, surfaceAt(s, z, cap) + off);
      return [x - s.c[0], y - s.c[1], s.g + z];
    };
    const a = (c0 * Math.PI) / 180, n = d.N(Math.sin(a), Math.cos(a), 0.1), mid = pt(0);
    const centre: [number, number, number] = [(mid[0] + pt(Math.PI)[0]) / 2, (mid[1] + pt(Math.PI)[1]) / 2, s.g + zc];
    for (let j = 0; j < N; j++) d.mb.tri(d.P(...centre), d.P(...pt((2 * Math.PI * j) / N)), d.P(...pt((2 * Math.PI * (j + 1)) / N)), n, col);
  };
  layer(1.3, 0.05, RIM);
  layer(1, 0.09, HOLE);
}

/** Touffes d'herbe et petits bouleaux sur les ressauts (photo 4). */
function buildTufts(d: GateDraw, s: CouhardSite): void {
  s.tufts.forEach(([cap, lv], i) => {
    const r = radiusAt(s, lv, cap) + 0.15, [x, y] = couhardAt(s, cap, r), ox = x - s.c[0], oy = y - s.c[1], z = s.g + lv;
    const tree = i % 2 === 0, hgt = tree ? 1.0 + 0.5 * rnd(i) : 0.4;
    if (tree) d.box(ox - 0.03, ox + 0.03, oy - 0.03, oy + 0.03, z - 0.3, z + hgt * 0.6, BIRCH);
    const cr = tree ? 0.5 + 0.2 * rnd(i + 0.5) : 0.4, zc = z + (tree ? hgt * 0.7 : 0.1);
    const leaf = shade(LEAVES, 0.85 + 0.25 * rnd(i + 0.7));
    // Couronne : octaèdre aplati.
    const P = (dx: number, dy: number, dz: number): [number, number, number] => [ox + dx, oy + dy, zc + dz];
    const ring: [number, number, number][] = [P(cr, 0, 0), P(0, cr, 0), P(-cr, 0, 0), P(0, -cr, 0)];
    for (let j = 0; j < 4; j++) {
      const p = ring[j]!, q = ring[(j + 1) % 4]!;
      for (const top of [true, false]) {
        const apex = P(0, 0, top ? cr * 0.9 : -cr * 0.5);
        const mx = (p[0] + q[0]) / 2 - ox, my = (p[1] + q[1]) / 2 - oy, l = Math.hypot(mx, my) || 1;
        d.mb.tri(d.P(...p), d.P(...q), d.P(...apex), d.N(mx / l, my / l, top ? 0.8 : -0.6), top ? leaf : shade(leaf, 0.8));
      }
    }
  });
}

/** Piquets en bois au pied, panneaux « Interdit de pénétrer — Chute de pierres » (photo 4), panneau d'information (photo 1). Repère du monde. */
function buildFence(d: GateDraw, s: CouhardSite, terrain: HeightField): void {
  const { h } = s.fence;
  for (const [x, y] of couhardPosts(s)) {
    const z = terrain.heightAt(x, y);
    d.box(x - 0.06, x + 0.06, y - 0.06, y + 0.06, z - 0.2, z + h, WOOD, shade(WOOD, 0.85));
  }
  for (const cap of s.signs) {
    const r = couhardRadius(s, 0, cap) + s.fence.gap - 0.3;
    const [x, y] = couhardAt(s, cap, r), z = terrain.heightAt(x, y);
    const a = (cap * Math.PI) / 180, ox = Math.sin(a), oy = Math.cos(a), tx = Math.cos(a), ty = -Math.sin(a);
    const pt = (u: number, v: number, zz: number): [number, number, number] => [x + tx * u + ox * v, y + ty * u + oy * v, zz];
    d.box(x - 0.04, x + 0.04, y - 0.04, y + 0.04, z - 0.2, z + 1.05, FRAME);
    const n = d.N(ox, oy, 0), back = d.N(-ox, -oy, 0), f = 0.05;
    const board = (u0: number, u1: number, z0: number, z1: number, col: THREE.Color, off = f): void => {
      d.quad(pt(u0, off, z + z0), pt(u1, off, z + z0), pt(u1, off, z + z1), pt(u0, off, z + z1), n, col);
    };
    board(-0.32, 0.32, 0.62, 1.05, SIGN);
    board(-0.26, 0.26, 0.92, 0.98, SIGN_TEXT, f + 0.01);
    board(-0.26, 0.26, 0.8, 0.86, SIGN_TEXT, f + 0.01);
    board(-0.3, 0.3, 0.42, 0.58, PLATE);
    board(-0.22, 0.22, 0.48, 0.52, SIGN, f + 0.01);
    d.quad(pt(0.32, f - 0.02, z + 0.42), pt(-0.32, f - 0.02, z + 0.42), pt(-0.32, f - 0.02, z + 1.05), pt(0.32, f - 0.02, z + 1.05), back, shade(FRAME, 1.3));
  }
  // Panneau d'information : pupitre sur deux pieds, tourné vers le pré.
  const [px, py] = couhardPanel(s), pz = terrain.heightAt(px, py);
  const a = (s.panel[0] * Math.PI) / 180, ox = Math.sin(a), oy = Math.cos(a), tx = Math.cos(a), ty = -Math.sin(a);
  for (const u of [-0.4, 0.4]) {
    const x = px + tx * u, y = py + ty * u;
    d.box(x - 0.05, x + 0.05, y - 0.05, y + 0.05, pz - 0.2, pz + 0.95, FRAME);
  }
  const pt = (u: number, v: number, zz: number): [number, number, number] => [px + tx * u + ox * v, py + ty * u + oy * v, pz + zz];
  const n = d.N(ox * 0.6, oy * 0.6, 0.8);
  d.quad(pt(-0.55, 0.25, 0.85), pt(0.55, 0.25, 0.85), pt(0.55, -0.15, 1.2), pt(-0.55, -0.15, 1.2), n, FRAME);
  d.quad(pt(-0.5, 0.24, 0.9), pt(0.5, 0.24, 0.9), pt(0.5, -0.12, 1.2), pt(-0.5, -0.12, 1.2), n, PANEL);
  d.quad(pt(-0.55, 0.25, 0.85), pt(0.55, 0.25, 0.85), pt(0.55, -0.15, 1.2), pt(-0.55, -0.15, 1.2), d.N(-ox * 0.6, -oy * 0.6, -0.8), shade(FRAME, 0.8));
}
