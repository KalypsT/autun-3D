import * as THREE from "three";
import type { CroixSite, HeightField } from "../data/types";
import { croixAt, croixFrame } from "../core/landmarks";
import { MeshBuilder, toThree } from "./geometry";
import { aimAt, drawProjectors, Floodlight } from "./floodlight";
import { GateDraw } from "./gates";

/**
 * Croix de la Libération d'après photo (D267, docs/plans/croix-liberation.md §7 à §9) : croix latine en gros blocs de granite gris bouchardés
 * (assises de hauteurs inégales), bras un peu plus épais que le fût, carré en relief à la croisée, sur une marche ; plate-forme dallée, talus
 * de pierre appareillée à l'est, à l'ouest et au sud (trois plaques au sud), mur droit à couvertine au nord (plaque du Sacré-Cœur et croix de
 * Lorraine) ouvert par un escalier à chaque angle ; deux mâts d'éclairage côté ville ; rochers contre le parking. La nuit, la croix, sa marche
 * et le haut des talus sont éclairés par les mâts (même dégradé que les portes romaines, si le site a `light`).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
// Granite gris des photos (sous le soleil de l'après-midi, le gris moyen tirait au brun) ; dalles, talus et couvertines un ton plus clair.
const GRANITE = C("#a9a8a3"), PAVING = C("#b9b7b0"), TALUS = C("#a19f99"), COPING = C("#c3c0b8"), JOINTS = C("#7d7c77");
const PLAQUE = C("#c9c4bb"), LETTERS = C("#9a2e22"), METAL = C("#5d6166"), LAMP = C("#e8e4d0"), ROCK = C("#87837a");

/** Petit nombre pseudo-aléatoire stable dans [0, 1). */
function rnd(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Teinte d'un bloc (granite inégal, photos 1 et 12). */
const block = (k: number, base = GRANITE): THREE.Color => shade(base.clone().lerp(JOINTS, 0.25 * rnd(k)), 0.93 + 0.12 * rnd(k + 0.5));

type P3 = [number, number, number];

export function buildCroix(mb: MeshBuilder, glow: MeshBuilder | null, s: CroixSite, terrain: HeightField, halo: MeshBuilder | null = null): void {
  const f = croixFrame(s);
  const lit = s.light ? glow : null;
  const ground = (u: number, t: number): number => {
    const [x, y] = croixAt(s, u, t);
    return terrain.heightAt(x, y);
  };
  // Projecteurs (D297) : ceux des deux mâts côté ville (photo 1), au sommet, pointés vers la croisée ; faisceau étroit. D300 (demande de
  // l'utilisateur) : un projecteur au sol côté parking, entre le pied du talus sud et les rochers, un peu à côté de la grande plaque, pour
  // que la face tournée vers le parking ne reste pas sombre.
  const P = (u: number, t: number, z: number): ReturnType<typeof toThree> => { const [x, y] = croixAt(s, u, t); return toThree(x, y, z); };
  const masts = s.masts.map(([u, t, h]) => aimAt(P(u, t, ground(u, t) + h + 0.1), P(0, 0, s.g + s.top * 0.55), { power: 3.2, range: 11, inner: 0.3, outer: 0.6 }));
  const pu = -0.9, ptt = (s.deck[2] - s.talus.s + Math.max(...s.rocks.map((r) => r[1] + r[2]))) / 2;
  const parking = aimAt(P(pu, ptt, ground(pu, ptt) + 0.12), P(0, 0, s.g + s.top * 0.5), { power: 3, range: 10, inner: 0.3, outer: 0.65 });
  const fl = lit ? new Floodlight(lit, [...masts, parking], 0.4) : null;
  if (lit) drawProjectors(mb, lit, halo, [parking], (x, z) => terrain.heightAt(x, -z));
  const d = new GateDraw(mb, null, f, s.g, s.top);
  const dl = new GateDraw(mb, lit, f, s.g, s.top, fl);
  buildPlatform(d, dl, s, ground);
  buildCross(dl, s);
  buildPlaques(d, s, ground);
  buildMasts(d, s, ground);
  buildRocks(d, s, ground);
}

/** Plate-forme : dalles du dessus, talus (onglets aux angles sud), mur nord à couvertine ouvert aux escaliers, escaliers et leurs échiffres. */
function buildPlatform(d: GateDraw, dl: GateDraw, s: CroixSite, ground: (u: number, t: number) => number): void {
  const [u0, u1, t0, t1] = s.deck, g = s.g, tl = s.talus;
  const [[w0, w1], [e0, e1]] = s.stairs.u as [[number, number], [number, number]];
  const run = s.stairs.run, top = g + 0.03;
  // Dessus : dalles d'environ 1 m (hors des escaliers), teintes alternées, jamais sous le relief (il est interpolé mètre par mètre).
  const above = (u: number, t: number, z: number): number => Math.max(z, ground(u, t) + 0.05);
  const us = cuts(u0, u1, 1.0), ts = cuts(t0, t1, 1.0);
  for (let i = 0; i + 1 < us.length; i++) {
    for (let j = 0; j + 1 < ts.length; j++) {
      const a = us[i]!, b = us[i + 1]!, c = ts[j]!, e = ts[j + 1]!;
      const mu = (a + b) / 2, mt = (c + e) / 2;
      if (mt > t1 - run && ((mu > w0 && mu < w1) || (mu > e0 && mu < e1))) continue;
      dl.quad([a, c, above(a, c, top)], [b, c, above(b, c, top)], [b, e, above(b, e, top)], [a, e, above(a, e, top)], [0, 1, 0], shade(PAVING, 0.94 + 0.1 * rnd(i * 31 + j * 7)));
    }
  }
  // Talus : pans inclinés du bord du dessus au pied (relief pris au pied), en assises ; maillés tous les 50 cm et posés au-dessus du relief.
  const foot = (u: number, t: number): number => Math.min(g - 0.2, ground(u, t) + 0.03);
  const slope = (inner: [number, number][], outer: [number, number][], key: number): void => {
    const n = inner.length, rows = 4;
    for (let k = 0; k + 1 < n; k++) {
      const a = inner[k]!, b = inner[k + 1]!, c = outer[k + 1]!, e = outer[k]!;
      const za = foot(e[0], e[1]), zb = foot(c[0], c[1]);
      const pt = (p: [number, number], q: [number, number], zq: number, kk: number): P3 => {
        const u = p[0] + (q[0] - p[0]) * kk, t = p[1] + (q[1] - p[1]) * kk;
        return [u, t, above(u, t, g + (zq - g) * kk)];
      };
      for (let r = 0; r < rows; r++) {
        const k0 = r / rows, k1 = (r + 1) / rows;
        const p0 = pt(a, e, za, k1), p1 = pt(b, c, zb, k1), p2 = pt(b, c, zb, k0), p3 = pt(a, e, za, k0);
        const nn = normalOf(p0, p1, p2);
        d.quad(p0, p1, p2, p3, d.N(nn[0], nn[1], nn[2]), block(key * 1000 + k * 13 + Math.floor(r / 2) * 3.7, TALUS));
      }
    }
  };
  const stepsAlong = (p: [number, number], q: [number, number], step: number): [number, number][] => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / step));
    return Array.from({ length: n + 1 }, (_, i) => [p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n] as [number, number]);
  };
  // Sud : du bord sud du dessus jusqu'au pied, onglets vers les angles des talus est et ouest.
  slope(stepsAlong([u0, t0], [u1, t0], 0.5), stepsAlong([u0 - tl.w, t0 - tl.s], [u1 + tl.e, t0 - tl.s], 0.5), 1);
  slope(stepsAlong([u0, t1], [u0, t0], 0.5), stepsAlong([u0 - tl.w, t1], [u0 - tl.w, t0 - tl.s], 0.5), 2);
  slope(stepsAlong([u1, t0], [u1, t1], 0.5), stepsAlong([u1 + tl.e, t0 - tl.s], [u1 + tl.e, t1], 0.5), 3);
  // Couvertine : le long du bord nord du dessus, entre les escaliers.
  const cop = s.wall.coping;
  d.box(w1, e0, t1 - 0.45, t1 + 0.05, g, g + cop, COPING);
  // Mur nord : parement droit du pied (relief au nord du mur) au dessus ; au droit des talus, son haut suit leur pente (photos 12 et 13).
  const wallTop = (u: number): number => (u < u0 ? g + (foot(u0 - tl.w, t1) - g) * ((u0 - u) / tl.w) : u > u1 ? g + (foot(u1 + tl.e, t1) - g) * ((u - u1) / tl.e) : g + cop);
  const span = (a: number, b: number): void => {
    const xs = cuts(a, b, 0.6);
    for (let i = 0; i + 1 < xs.length; i++) {
      const p = xs[i]!, q = xs[i + 1]!;
      const zp = ground(p, t1 + 0.6) - 0.1, zq = ground(q, t1 + 0.6) - 0.1;
      const hp = wallTop(p), hq = wallTop(q);
      // Assises de 40 cm environ, joints en quinconce par la teinte.
      const rows = Math.max(1, Math.round((Math.max(hp, hq) - Math.min(zp, zq)) / 0.4));
      for (let r = 0; r < rows; r++) {
        const k0 = r / rows, k1 = (r + 1) / rows;
        d.quad([p, t1 + 0.05, zp + (hp - zp) * k0], [q, t1 + 0.05, zq + (hq - zq) * k0], [q, t1 + 0.05, zq + (hq - zq) * k1], [p, t1 + 0.05, zp + (hp - zp) * k1], d.N(0, 1), block(i * 17 + r * 5 + (r % 2) * 0.5));
      }
    }
  };
  span(u0 - tl.w, w0);
  span(w1, e0);
  span(e1, u1 + tl.e);
  // Escaliers des angles nord : marches du dessus au pied du mur, murs d'échiffre de part et d'autre.
  for (const [a, b] of [[w0, w1], [e0, e1]] as [number, number][]) {
    const zb = ground((a + b) / 2, t1 + 0.6);
    const n = s.stairs.n, rise = (g - zb) / n, tread = run / n;
    for (let k = 0; k < n; k++) {
      const tA = t1 - run + k * tread, zTop = g - (k + 1) * rise + rise;
      d.box(a, b, tA, t1 + 0.05, zTop - rise - 0.05, zTop + 0.01, block(k * 3 + a, PAVING), shade(PAVING, 0.98 + 0.06 * rnd(k)));
    }
    for (const u of [a, b]) {
      // Mur d'échiffre (30 cm, de part et d'autre de la volée) : de la couvertine en haut de l'escalier à 35 cm au-dessus de la marche du bas.
      const ua = u === a ? u - 0.3 : u, ub = u === a ? u : u + 0.3;
      const hi = (t: number): number => g + cop + (zb + 0.35 - (g + cop)) * Math.max(0, Math.min(1, (t - (t1 - run)) / run));
      const ts2 = cuts(t1 - run, t1 + 0.05, 0.45);
      for (let i = 0; i + 1 < ts2.length; i++) {
        const ta = ts2[i]!, tb = ts2[i + 1]!, ha = hi(ta), hb = hi(tb);
        for (const uu of [ua, ub]) d.quad([uu, ta, zb - 0.05], [uu, tb, zb - 0.05], [uu, tb, hb], [uu, ta, ha], d.N(uu === ua ? -1 : 1, 0), block(i * 7 + uu * 3));
        d.quad([ua, ta, ha], [ub, ta, ha], [ub, tb, hb], [ua, tb, hb], d.N(0, 0.3, 1), COPING);
      }
      d.quad([ua, t1 + 0.05, zb - 0.05], [ub, t1 + 0.05, zb - 0.05], [ub, t1 + 0.05, hi(t1 + 0.05)], [ua, t1 + 0.05, hi(t1 + 0.05)], d.N(0, 1), block(u * 11));
    }
  }
}

/** La croix : marche, fût en assises, bras (dessous visible), tête, carré en relief à la croisée sur les deux faces. */
function buildCross(d: GateDraw, s: CroixSite): void {
  const g = s.g, { w, d: dp } = s.shaft, hw = w / 2, hd = dp / 2;
  const [za, zb] = s.arms.z, ha = s.arms.span / 2, hda = s.arms.d / 2;
  const { u: pu, t: pt, h: ph } = s.plinth;
  d.box(pu[0], pu[1], pt[0], pt[1], g - 0.1, g + ph, block(901, PAVING), shade(PAVING, 1.04));
  // Fût : assises de 55 à 70 cm, du dessus de la marche au dessous des bras.
  let z = g + ph, k = 0;
  while (z < g + za - 0.05) {
    const h = Math.min(g + za - z, 0.55 + 0.15 * rnd(k * 3.3));
    d.box(-hw, hw, -hd, hd, z, z + h, block(k * 11));
    z += h;
    k++;
  }
  // Bras : deux assises, un peu plus épais que le fût ; dessous dessiné (on le voit d'en bas).
  const zm = g + (za + zb) / 2;
  d.box(-ha, ha, -hda, hda, g + za, zm, block(77));
  d.box(-ha, ha, -hda, hda, zm, g + zb, block(78));
  d.quad([-ha, hda, g + za], [ha, hda, g + za], [ha, -hda, g + za], [-ha, -hda, g + za], [0, -1, 0], shade(GRANITE, 0.62));
  // Tête : au-dessus des bras, jusqu'au sommet mesuré.
  z = g + zb;
  k = 0;
  while (z < g + s.top - 0.02) {
    const h = Math.min(g + s.top - z, 0.6 + 0.1 * rnd(k * 5.1 + 2));
    d.box(-hw, hw, -hd, hd, z, z + h, block(k * 13 + 50));
    z += h;
    k++;
  }
  // Carré en relief à la croisée (photos 1 et 12), sur les deux faces.
  const q = 0.36, zc = g + (za + zb) / 2;
  d.box(-q, q, hda, hda + 0.06, zc - q, zc + q, block(99, COPING));
  d.box(-q, q, -hda - 0.06, -hda, zc - q, zc + q, block(98, COPING));
}

/** Plaques : trois sur le talus sud (la grande au milieu, texte en lignes rouges), une sur le mur nord avec la croix de Lorraine. */
function buildPlaques(d: GateDraw, s: CroixSite, ground: (u: number, t: number) => number): void {
  const [, , t0, t1] = s.deck, g = s.g, tl = s.talus;
  for (const p of s.plaques) {
    if (p.face === "s") {
      // Posée à plat sur le pan du talus sud, à mi-pente.
      const zFoot = ground(p.u, t0 - tl.s - 0.5);
      const drop = g - zFoot, slope = drop / tl.s;
      const tm = t0 - tl.s * 0.5, half = p.l / 2;
      const tA = tm - (half * tl.s) / Math.hypot(tl.s, drop), tB = tm + (half * tl.s) / Math.hypot(tl.s, drop);
      const zAt = (t: number): number => g - (t0 - t) * slope + 0.035;
      const n = d.N(0, -slope, 1);
      d.quad([p.u - p.w / 2, tA, zAt(tA)], [p.u + p.w / 2, tA, zAt(tA)], [p.u + p.w / 2, tB, zAt(tB)], [p.u - p.w / 2, tB, zAt(tB)], n, PLAQUE);
      const lines = p.big ? 13 : 4;
      for (let i = 0; i < lines; i++) {
        const k = (i + 0.7) / (lines + 0.4), ta = tB - (tB - tA) * k, tb = ta - (tB - tA) * 0.025;
        const lw = (p.w * 0.8) * (i === 0 || i === lines - 1 ? 0.7 : 0.55 + 0.35 * rnd(i * 3.3));
        d.quad([p.u - lw / 2, tb, zAt(tb) + 0.005], [p.u + lw / 2, tb, zAt(tb) + 0.005], [p.u + lw / 2, ta, zAt(ta) + 0.005], [p.u - lw / 2, ta, zAt(ta) + 0.005], n, LETTERS);
      }
    } else {
      // Sur le parement du mur nord.
      const t = t1 + 0.07, zb = ground(p.u, t1 + 0.6) + 0.2, zt = zb + p.l, n = d.N(0, 1);
      d.quad([p.u - p.w / 2, t, zb], [p.u + p.w / 2, t, zb], [p.u + p.w / 2, t, zt], [p.u - p.w / 2, t, zt], n, PLAQUE);
      for (let i = 0; i < 2; i++) {
        const z = zt - 0.14 - i * 0.14, lw = p.w * (i === 0 ? 0.6 : 0.85);
        d.quad([p.u - lw / 2, t + 0.005, z - 0.035], [p.u + lw / 2, t + 0.005, z - 0.035], [p.u + lw / 2, t + 0.005, z], [p.u - lw / 2, t + 0.005, z], n, LETTERS);
      }
      if (p.lorraine) {
        const zc = zb + 0.18, bar = (u0: number, u1: number, z0: number, z1: number): void => d.quad([p.u + u0, t + 0.006, z0], [p.u + u1, t + 0.006, z0], [p.u + u1, t + 0.006, z1], [p.u + u0, t + 0.006, z1], n, LETTERS);
        bar(-0.012, 0.012, zc - 0.11, zc + 0.11);
        bar(-0.045, 0.045, zc + 0.05, zc + 0.07);
        bar(-0.065, 0.065, zc - 0.01, zc + 0.01);
      }
    }
  }
}

/** Mâts d'éclairage côté ville (photo 1) : fût gris, projecteur tourné vers la croix. */
function buildMasts(d: GateDraw, s: CroixSite, ground: (u: number, t: number) => number): void {
  for (const [u, t, h] of s.masts) {
    const z0 = ground(u, t) - 0.2;
    d.box(u - 0.07, u + 0.07, t - 0.07, t + 0.07, z0, z0 + 0.2 + h, METAL);
    const l = Math.hypot(u, t) || 1, du = -u / l, dt = -t / l, zh = z0 + 0.2 + h;
    // Projecteur : boîte de 40 × 25 cm au sommet, sa vitre claire tournée vers l'axe.
    d.box(u - 0.2, u + 0.2, t - 0.13, t + 0.13, zh - 0.05, zh + 0.22, shade(METAL, 0.85));
    const pu = u + du * 0.21, pt = t + dt * 0.21;
    const nu = -dt, nt = du;
    d.quad([pu - nu * 0.16, pt - nt * 0.16, zh - 0.02], [pu + nu * 0.16, pt + nt * 0.16, zh - 0.02], [pu + nu * 0.16, pt + nt * 0.16, zh + 0.19], [pu - nu * 0.16, pt - nt * 0.16, zh + 0.19], d.N(du, dt), LAMP);
  }
}

/** Rochers bruts alignés contre le parking (photos 2, 4 et 5) : blocs bas à pans irréguliers. */
function buildRocks(d: GateDraw, s: CroixSite, ground: (u: number, t: number) => number): void {
  s.rocks.forEach(([u, t, r], i) => {
    const z = ground(u, t) - 0.05, hgt = r * (0.9 + 0.5 * rnd(i * 2.1));
    const N = 6;
    const ring = (k: number, rr: number, zz: number): P3 => {
      const a = (2 * Math.PI * k) / N + rnd(i + k) * 0.4;
      const q = rr * (0.8 + 0.35 * rnd(i * 7 + k));
      return [u + Math.cos(a) * q * 1.2, t + Math.sin(a) * q, zz];
    };
    const lo = Array.from({ length: N }, (_, k) => ring(k, r, z)), hi = Array.from({ length: N }, (_, k) => ring(k + 0.5, r * 0.7, z + hgt * 0.75));
    const apex: P3 = [u + (rnd(i) - 0.5) * 0.2 * r, t + (rnd(i + 3) - 0.5) * 0.2 * r, z + hgt];
    const col = shade(ROCK, 0.85 + 0.25 * rnd(i * 1.7));
    // Normales vers l'extérieur du bloc (du centre vers le milieu de la face), plus ou moins levées.
    const out = (p: P3, q: P3, up: number): ReturnType<GateDraw["N"]> => {
      const mx = (p[0] + q[0]) / 2 - u, my = (p[1] + q[1]) / 2 - t, l = Math.hypot(mx, my) || 1;
      return d.N(mx / l, my / l, up);
    };
    for (let k = 0; k < N; k++) {
      const a = lo[k]!, b = lo[(k + 1) % N]!, c = hi[(k + 1) % N]!, e = hi[k]!;
      d.quad(a, b, c, e, out(a, b, 0.3), shade(col, 0.9 + 0.15 * rnd(i * 5 + k)));
      d.mb.tri(d.P(...e), d.P(...c), d.P(...apex), out(e, c, 1.2), shade(col, 1.05));
    }
  });
}

/** Coupes régulières de [a, b] en pas d'environ `step`. */
function cuts(a: number, b: number, step: number): number[] {
  const n = Math.max(1, Math.round((b - a) / step));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

/** Normale (repère u, t, z) du plan passant par trois points, orientée vers le haut ou vers l'extérieur selon l'ordre donné. */
function normalOf(a: P3, b: P3, c: P3): P3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nz < 0) [nx, ny, nz] = [-nx, -ny, -nz];
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
