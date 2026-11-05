import * as THREE from "three";
import type { Boat, Deck, HeightField, Shelter } from "../data/types";
import { DeckAxis, deckThickness } from "../core/bridges";
import { shelterPosts, SHELTER_POST } from "../core/piers";
import { hash01, MeshBuilder, toThree, type Vec3 } from "./geometry";

/**
 * Pontons, bateaux et abris du plan d'eau du Vallon (D246). Les pontons sont des tabliers (`st: "pier"`) : planches grises en travers,
 * rives sombres, sans garde-corps ; flotteurs dessous (ponton flottant) ou pieux carrés (ponton fixe, photo du ponton de pêche).
 */
const C = (hex: string): THREE.Color => new THREE.Color(hex);
const PLANKS = ["#9d978c", "#a7a196", "#928c82", "#b0aa9f", "#8b867d"].map(C);
const GAP = C("#4a463f");
const RIM = C("#6f695f");
const FLOAT = C("#3a3d40");
const PILE = C("#5d554b");
/** Planches : pas et jour entre deux planches (m). */
const PLANK = 0.16;
const JOINT = 0.018;

/** Triangle orienté vers `out` (repère three) : l'ordre des sommets suit la normale, quel que soit le sens donné. */
function face(mb: MeshBuilder, a: Vec3, b: Vec3, c: Vec3, out: Vec3, col: THREE.Color): void {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) return;
  nx /= l; ny /= l; nz /= l;
  if (nx * out[0] + ny * out[1] + nz * out[2] < 0) mb.tri(a, c, b, [-nx, -ny, -nz], col);
  else mb.tri(a, b, c, [nx, ny, nz], col);
}

function quad(mb: MeshBuilder, a: Vec3, b: Vec3, c: Vec3, d: Vec3, out: Vec3, col: THREE.Color): void {
  face(mb, a, b, c, out, col);
  face(mb, a, c, d, out, col);
}

/** Pavé d'axe (ux, uy) (données), demi-côtés hl et hw, de z0 à z1 : quatre faces et le dessus. */
function block(mb: MeshBuilder, cx: number, cy: number, ux: number, uy: number, hl: number, hw: number, z0: number, z1: number, col: THREE.Color, bottom = false): void {
  const vx = -uy, vy = ux;
  const p = (s: number, t: number): [number, number] => [cx + ux * s + vx * t, cy + uy * s + vy * t];
  const pts = [p(-hl, -hw), p(hl, -hw), p(hl, hw), p(-hl, hw)];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % 4]!;
    const mx = (ax + bx) / 2 - cx, my = (ay + by) / 2 - cy;
    quad(mb, toThree(ax, ay, z0), toThree(bx, by, z0), toThree(bx, by, z1), toThree(ax, ay, z1), toThree(mx, my, 0), col);
  }
  const t = pts.map(([x, y]) => toThree(x, y, z1)) as [Vec3, Vec3, Vec3, Vec3];
  quad(mb, t[0], t[1], t[2], t[3], [0, 1, 0], col);
  if (bottom) {
    const b = pts.map(([x, y]) => toThree(x, y, z0)) as [Vec3, Vec3, Vec3, Vec3];
    quad(mb, b[0], b[1], b[2], b[3], [0, -1, 0], col.clone().multiplyScalar(0.7));
  }
}

/** Un ponton : planches, rives, dessous, flotteurs ou pieux. `ground` : relief nu (fond du lac). */
export function buildPier(mb: MeshBuilder, d: Deck, ground: HeightField): void {
  const axis = new DeckAxis(d);
  const L = axis.length;
  if (L < 0.5) return;
  const hw = d.w / 2;
  const thick = deckThickness(d);
  const side = (a: { x: number; y: number; tx: number; ty: number }, k: number, inset = 0): [number, number] =>
    [a.x - a.ty * (hw - inset) * k, a.y + a.tx * (hw - inset) * k];
  // Fond sombre (les jours entre les planches), rives et dessous, par tronçons de 1 m.
  const ss: number[] = [];
  for (let s = 0; s < L; s += 1) ss.push(s);
  ss.push(L);
  for (const c of axis.cum) if (c > 0 && c < L) ss.push(c - 0.001, c + 0.001);
  ss.sort((a, b) => a - b);
  for (let i = 0; i + 1 < ss.length; i++) {
    const a = axis.at(ss[i]!), b = axis.at(ss[i + 1]!);
    const [al, bl, ar, br] = [side(a, 1), side(b, 1), side(a, -1), side(b, -1)];
    quad(mb, toThree(al[0], al[1], a.z - 0.03), toThree(bl[0], bl[1], b.z - 0.03), toThree(br[0], br[1], b.z - 0.03), toThree(ar[0], ar[1], a.z - 0.03), [0, 1, 0], GAP);
    quad(mb, toThree(al[0], al[1], a.z - thick), toThree(bl[0], bl[1], b.z - thick), toThree(br[0], br[1], b.z - thick), toThree(ar[0], ar[1], a.z - thick), [0, -1, 0], RIM.clone().multiplyScalar(0.6));
    for (const k of [1, -1]) {
      const [p, q] = k === 1 ? [al, bl] : [ar, br];
      quad(mb, toThree(p[0], p[1], a.z - thick), toThree(q[0], q[1], b.z - thick), toThree(q[0], q[1], b.z + 0.005), toThree(p[0], p[1], a.z + 0.005),
        toThree(-a.ty * k, a.tx * k, 0), RIM);
    }
  }
  // Bouts.
  for (const [s, k] of [[0, -1], [L, 1]] as const) {
    const a = axis.at(s);
    const l = side(a, 1), r = side(a, -1);
    quad(mb, toThree(l[0], l[1], a.z - thick), toThree(r[0], r[1], a.z - thick), toThree(r[0], r[1], a.z + 0.005), toThree(l[0], l[1], a.z + 0.005),
      toThree(a.tx * k, a.ty * k, 0), RIM);
  }
  // Planches en travers.
  let n = 0;
  for (let s = 0; s + PLANK * 0.5 < L; s += PLANK, n++) {
    const a = axis.at(s + JOINT / 2), b = axis.at(Math.min(L, s + PLANK - JOINT / 2));
    const col = PLANKS[Math.floor(hash01(`${d.id}:${n}`) * PLANKS.length)]!;
    const [al, bl, ar, br] = [side(a, 1, 0.02), side(b, 1, 0.02), side(a, -1, 0.02), side(b, -1, 0.02)];
    quad(mb, toThree(al[0], al[1], a.z), toThree(bl[0], bl[1], b.z), toThree(br[0], br[1], b.z), toThree(ar[0], ar[1], a.z), [0, 1, 0], col);
  }
  if (d.fl) {
    // Flotteurs : caissons sombres sous le tablier, là où il y a de l'eau dessous ; 8 cm hors de l'eau (le tablier est à 0,3 m).
    for (let s = 1.2; s < L - 0.8; s += 2.5) {
      const a = axis.at(s);
      if (ground.heightAt(a.x, a.y) > a.z - 0.65) continue;
      block(mb, a.x, a.y, a.tx, a.ty, 0.9, hw - 0.12, a.z - 0.62, a.z - thick, FLOAT, true);
    }
  }
  for (const s of d.pl ?? []) {
    // Pieux carrés aux deux rives, plantés dans le fond.
    const a = axis.at(s);
    for (const k of [1, -1]) {
      const [x, y] = side(a, k, -0.06);
      const z0 = Math.min(ground.heightAt(x, y), a.z - thick) - 0.4;
      block(mb, x, y, a.tx, a.ty, 0.08, 0.08, z0, a.z - 0.02, PILE);
    }
  }
}

/** Demi-largeur de la coque à l'abscisse u (−1 : poupe, 1 : proue), en part de la demi-largeur. */
function beam(k: Boat["k"], u: number): number {
  if (k === "kayak") return Math.max(0, 1 - Math.abs(u) ** 1.8);
  if (u < 0) return 1 - (k === "barque" ? 0.3 : 0.22) * u * u;
  return Math.max(0, 1 - u ** (k === "barque" ? 2 : 2.4));
}

const DEPTH: Record<Boat["k"], number> = { dinghy: 0.5, kayak: 0.32, barque: 0.55 };

/** Bateaux : coque à bouchains (quille, bouchain, plat-bord), pont blanc et cockpit (dériveur), pont fermé (kayak), intérieur en bois (barque). */
export function buildBoats(mb: MeshBuilder, boats: readonly Boat[]): void {
  for (const b of boats) {
    const ux = Math.cos(b.a), uy = Math.sin(b.a), vx = -uy, vy = ux;
    const hl = b.l / 2, hw = b.w / 2, D = DEPTH[b.k];
    const hull = C(b.c), low = hull.clone().multiplyScalar(0.82);
    const at = (u: number, t: number, z: number): Vec3 => toThree(b.x + ux * u * hl + vx * t, b.y + uy * u * hl + vy * t, b.z + z);
    const N = 10;
    const us = Array.from({ length: N + 1 }, (_, i) => -1 + (2 * i) / N);
    // Section : plat-bord, bouchain, quille ; la quille remonte aux deux bouts, le plat-bord à la proue.
    const sec = (u: number): { w: number; top: number; chine: number; keel: number } => {
      const w = hw * beam(b.k, u);
      return { w, top: D + 0.08 * Math.max(0, u) ** 2, chine: 0.22 * D + 0.25 * D * u * u, keel: 0.35 * D * u ** 4 };
    };
    for (let i = 0; i < N; i++) {
      const u0 = us[i]!, u1 = us[i + 1]!, s0 = sec(u0), s1 = sec(u1);
      for (const k of [1, -1]) {
        const out = toThree(vx * k, vy * k, 0.3);
        quad(mb, at(u0, k * s0.w, s0.top), at(u1, k * s1.w, s1.top), at(u1, k * s1.w * 0.8, s1.chine), at(u0, k * s0.w * 0.8, s0.chine), out, hull);
        quad(mb, at(u0, k * s0.w * 0.8, s0.chine), at(u1, k * s1.w * 0.8, s1.chine), at(u1, 0, s1.keel), at(u0, 0, s0.keel), toThree(vx * k, vy * k, -1), low);
      }
      // Dessus.
      const top = b.k === "barque" ? C("#8a6a48") : b.k === "kayak" ? hull : C("#f6f6f2");
      const inset = b.k === "barque" ? 0.92 : 1;
      const zt0 = b.k === "barque" ? 0.3 * D : s0.top, zt1 = b.k === "barque" ? 0.3 * D : s1.top;
      quad(mb, at(u0, s0.w * inset, zt0), at(u1, s1.w * inset, zt1), at(u1, -s1.w * inset, zt1), at(u0, -s0.w * inset, zt0), [0, 1, 0], top);
      if (b.k === "barque") {
        // Bordé intérieur, du plancher au plat-bord.
        for (const k of [1, -1]) {
          quad(mb, at(u0, k * s0.w * 0.92, 0.3 * D), at(u1, k * s1.w * 0.92, 0.3 * D), at(u1, k * s1.w, s1.top), at(u0, k * s0.w, s0.top),
            toThree(-vx * k, -vy * k, 0.3), C("#a07e58"));
        }
      }
    }
    // Tableau arrière (dériveur, barque).
    if (b.k !== "kayak") {
      const s = sec(-1);
      quad(mb, at(-1, s.w, s.top), at(-1, -s.w, s.top), at(-1, -s.w * 0.8, s.chine), at(-1, s.w * 0.8, s.chine), toThree(-ux, -uy, 0), hull);
      face(mb, at(-1, s.w * 0.8, s.chine), at(-1, -s.w * 0.8, s.chine), at(-1, 0, s.keel), toThree(-ux, -uy, -0.5), low);
    }
    if (b.k === "dinghy") {
      // Cockpit gris, un peu en creux à l'œil (dessiné juste au-dessus du pont).
      const ck = C("#bfc4c6");
      for (let i = 1; i < 6; i++) {
        const u0 = us[i]!, u1 = us[i + 1]!, s0 = sec(u0), s1 = sec(u1);
        quad(mb, at(u0, s0.w * 0.72, s0.top + 0.01), at(u1, s1.w * 0.72, s1.top + 0.01), at(u1, -s1.w * 0.72, s1.top + 0.01), at(u0, -s0.w * 0.72, s0.top + 0.01), [0, 1, 0], ck);
      }
      if (b.m) {
        // Mât et bôme, voile ferlée sur la bôme.
        const mx = b.x + ux * 0.25 * hl, my = b.y + uy * 0.25 * hl;
        block(mb, mx, my, ux, uy, 0.04, 0.04, b.z + D, b.z + D + 5.6, C("#c9cdd0"));
        const bx = b.x + ux * (0.25 * hl - 1.0), by = b.y + uy * (0.25 * hl - 1.0);
        block(mb, bx, by, ux, uy, 1.0, 0.07, b.z + D + 0.85, b.z + D + 1.0, C("#e9e6dc"));
      }
    }
    if (b.k === "kayak") {
      const s = sec(0);
      quad(mb, at(-0.25, s.w * 0.55, s.top + 0.01), at(0.12, s.w * 0.55, s.top + 0.01), at(0.12, -s.w * 0.55, s.top + 0.01), at(-0.25, -s.w * 0.55, s.top + 0.01), [0, 1, 0], C("#26292b"));
    }
    if (b.k === "barque") {
      // Deux bancs en travers.
      for (const u of [-0.45, 0.25]) {
        const s = sec(u);
        const cx = b.x + ux * u * hl, cy = b.y + uy * u * hl;
        block(mb, cx, cy, ux, uy, 0.13, s.w * 0.9, b.z + 0.62 * D, b.z + 0.7 * D, C("#9a7550"));
      }
    }
  }
}

/** Abris sur poteaux : toit plat clair à débord, poutres, poteaux plantés dans le sol ou le fond. */
export function buildShelters(mb: MeshBuilder, shelters: readonly Shelter[], ground: HeightField): void {
  const roof = C("#e8e8e2"), edge = C("#cfcfc6"), under = C("#9c9c94"), post = C("#5c5a55");
  for (const s of shelters) {
    const ux = Math.cos(s.a), uy = Math.sin(s.a);
    for (const [x, y] of shelterPosts(s)) {
      block(mb, x, y, ux, uy, SHELTER_POST, SHELTER_POST, ground.heightAt(x, y) - 0.4, s.z, post);
    }
    // Poutres sous le toit, d'un poteau d'angle à l'autre le long des grands côtés (direction de `hw`).
    for (const k of [1, -1]) {
      const cx = s.x + ux * (s.hl - 0.3) * k, cy = s.y + uy * (s.hl - 0.3) * k;
      block(mb, cx, cy, -uy, ux, s.hw - 0.2, 0.08, s.z - 0.25, s.z, post);
    }
    block(mb, s.x, s.y, ux, uy, s.hl + 0.4, s.hw + 0.4, s.z, s.z + 0.18, edge, true);
    const vx = -uy, vy = ux;
    const p = (a: number, b: number): Vec3 => toThree(s.x + ux * a + vx * b, s.y + uy * a + vy * b, s.z + 0.185);
    quad(mb, p(-s.hl - 0.35, -s.hw - 0.35), p(s.hl + 0.35, -s.hw - 0.35), p(s.hl + 0.35, s.hw + 0.35), p(-s.hl - 0.35, s.hw + 0.35), [0, 1, 0], roof);
    const q = (a: number, b: number): Vec3 => toThree(s.x + ux * a + vx * b, s.y + uy * a + vy * b, s.z - 0.005);
    quad(mb, q(-s.hl - 0.4, -s.hw - 0.4), q(s.hl + 0.4, -s.hw - 0.4), q(s.hl + 0.4, s.hw + 0.4), q(-s.hl - 0.4, s.hw + 0.4), [0, -1, 0], under);
  }
}
