import * as THREE from "three";
import type { HeightField, HouseModel, HouseOpening } from "../data/types";
import { at, houseEdges, houseFrame, houseOutline, type HouseEdge } from "../core/landmarks";
import { MeshBuilder } from "./geometry";
import { fillOnTerrain } from "./ground";
import { GateDraw } from "./gates";

/**
 * Maison d'après photo (D140), à pans nets : plain-pied enduit à soubassement, toit à croupes en L (pans précalculés par
 * build_monuments.py, noues aux rencontres), rangs de tuiles plates et taches de lichen, arêtiers, débord, gouttières et descentes ;
 * lucarnes à croupe, cheminée crépie à chapeau et parabole ; ouvertures cintrées à volets persiennés repliés contre le mur ; entrée
 * couverte (poteau, sablières, jambe de force) ; terrasse de dalles et allée gravillonnée. La nuit, quelques vitres et les appliques
 * s'allument (maillage des vitres allumées).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const PLINTH = C("#cbc2ae"), GUTTER = C("#8b8f8f"), GLASS = C("#2f383c"), FRAME = C("#5b3a22"), WOOD = C("#8a5a34"), LAMP = C("#26282a");
const LICHEN = C("#a39d86"), METAL = C("#9a9c9a"), DISH = C("#e8e2d8"), SLAB = C("#dcd8cc"), GRAVEL = C("#e9e5da");
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");

/** Petit nombre pseudo-aléatoire stable dans [0, 1). */
function rnd(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

type ST = [number, number];

function inside(r: ST[], s: number, t: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [si, ti] = r[i]!, [sj, tj] = r[j]!;
    if (ti > t !== tj > t && s < si + ((t - ti) * (sj - si)) / (tj - ti)) c = !c;
  }
  return c;
}

/** Morceaux de la droite a·s + b·t = v à l'intérieur du polygone (en paires de points). */
function levelSegments(r: ST[], a: number, b: number, v: number): [ST, ST][] {
  const hits: { u: number; p: ST }[] = [];
  const n = Math.hypot(a, b), ds = -b / n, dt = a / n;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!;
    const fp = a * p[0] + b * p[1] - v, fq = a * q[0] + b * q[1] - v;
    if ((fp < 0) === (fq < 0) || fp === fq) continue;
    const k = fp / (fp - fq), x: ST = [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
    hits.push({ u: x[0] * ds + x[1] * dt, p: x });
  }
  hits.sort((x, y) => x.u - y.u);
  const out: [ST, ST][] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i]!.p, hits[i + 1]!.p]);
  return out;
}

export function buildHouse(mb: MeshBuilder, glow: MeshBuilder | null, m: HouseModel, terrain: HeightField): void {
  const f = houseFrame(m);
  const d = new GateDraw(mb, null, f, m.g, 1);
  const lit = glow ? new GateDraw(glow, null, f, m.g, 1) : null;
  const Z = (h: number): number => m.g + h;
  const foot = (s: number, t: number): number => terrain.heightAt(...at(f, s, t)) - 0.3;
  const WALL = C(m.colors.wall), ROOF = C(m.colors.roof), SHUT = C(m.colors.shutter);
  const ze = Z(m.eave);
  const [[s0, s1, t0, t1], [sw, , , tw]] = m.walls;
  const [pw, pd, dw, dh] = m.porch;

  // --- Murs enduits et soubassement, en pans de 3 m au plus pour suivre le sol --------------------------------------------------------
  const ring = houseOutline(m);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ns = (b[1] - a[1]) / len, nt = -(b[0] - a[0]) / len, n = d.N(ns, nt);
    const k = Math.max(1, Math.ceil(len / 3));
    for (let j = 0; j < k; j++) {
      const p = (u: number): ST => [a[0] + ((b[0] - a[0]) * u) / k, a[1] + ((b[1] - a[1]) * u) / k];
      const [pa, pb] = [p(j), p(j + 1)];
      d.quad([...pa, foot(...pa)], [...pb, foot(...pb)], [...pb, ze], [...pa, ze], n, WALL);
      const o = (q: ST): ST => [q[0] + ns * 0.02, q[1] + nt * 0.02];
      d.quad([...o(pa), foot(...pa)], [...o(pb), foot(...pb)], [...o(pb), foot(...pb) + 0.55], [...o(pa), foot(...pa) + 0.55], n, PLINTH);
    }
  }

  // --- Toit : pans, dessous du débord, rangs de tuiles, lichen, arêtiers -----------------------------------------------------------
  const zEdge = m.eave - m.ov * m.pitch;
  m.roof.forEach((face, fi) => {
    const [a, b, c] = face.k;
    const r: ST[] = [];
    for (let i = 0; i < face.r.length; i += 2) r.push([face.r[i]!, face.r[i + 1]!]);
    const zAt = (s: number, t: number): number => Z(a * s + b * t + c);
    const nl = Math.hypot(a, b, 1), n = d.N(-a / nl, -b / nl, 1 / nl), under = d.N(0, 0, -1);
    const col = shade(ROOF, 0.97 + 0.06 * rnd(fi));
    const tris = THREE.ShapeUtils.triangulateShape(r.map(([s, t]) => new THREE.Vector2(s, t)), []);
    for (const [i, j, k] of tris) {
      const P = (q: ST, dz: number): [number, number, number] => [q[0], q[1], zAt(...q) + dz];
      d.mb.tri(d.P(...P(r[i!]!, 0)), d.P(...P(r[j!]!, 0)), d.P(...P(r[k!]!, 0)), n, col);
      d.mb.tri(d.P(...P(r[i!]!, -0.14)), d.P(...P(r[j!]!, -0.14)), d.P(...P(r[k!]!, -0.14)), under, shade(WALL, 0.62));
    }
    // Rangs de tuiles plates : un trait sombre tous les 32 cm de montée, parallèle à l'égout.
    const gl = Math.hypot(a, b);
    for (let h = zEdge + 0.32; h < m.eave + 6; h += 0.32) {
      for (const [p, q] of levelSegments(r, a, b, h - c)) {
        const back = 0.045 / gl;
        const P = (x: ST, k: number): [number, number, number] => [x[0] + (a / gl) * back * k, x[1] + (b / gl) * back * k, Z(h) + 0.012 + back * gl * k];
        d.quad(P(p, 0), P(q, 0), P(q, 1), P(p, 1), n, shade(ROOF, 0.72));
      }
    }
    // Taches de lichen (photos) : plaques claires semées sur le pan.
    const ss = r.map((q) => q[0]), tt = r.map((q) => q[1]);
    const [smin, smax, tmin, tmax] = [Math.min(...ss), Math.max(...ss), Math.min(...tt), Math.max(...tt)];
    for (let k = 0; k < 40; k++) {
      const s = smin + rnd(fi * 100 + k) * (smax - smin), t = tmin + rnd(fi * 100 + k + 0.5) * (tmax - tmin), w = 0.07 + 0.12 * rnd(fi * 100 + k + 0.7);
      const pts: ST[] = [[s - w, t - w * 0.6], [s + w, t - w * 0.6], [s + w * 0.8, t + w * 0.6], [s - w * 0.7, t + w * 0.5]];
      // À 30 cm au moins des bords du pan (les arêtiers les couperaient).
      if (![[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([ks, kt]) => inside(r, s + ks! * (w + 0.3), t + kt! * (w + 0.3)))) continue;
      const P = (q: ST): [number, number, number] => [q[0], q[1], zAt(...q) + 0.02];
      d.quad(P(pts[0]!), P(pts[1]!), P(pts[2]!), P(pts[3]!), n, LICHEN.clone().lerp(ROOF, 0.45 + 0.3 * rnd(k)));
    }
    // Arêtiers et faîtages : les bords du pan au-dessus de l'égout, coiffés d'une bande sombre (chaque pan pose sa moitié).
    for (let i = 0; i < r.length; i++) {
      const p = r[i]!, q = r[(i + 1) % r.length]!;
      if (zAt(...p) < Z(zEdge) + 0.05 && zAt(...q) < Z(zEdge) + 0.05) continue;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) continue;
      // Vers l'intérieur du pan.
      let ins = -(q[1] - p[1]) / len, int = (q[0] - p[0]) / len;
      const mid: ST = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (!inside(r, mid[0] + ins * 0.05, mid[1] + int * 0.05)) [ins, int] = [-ins, -int];
      const P = (x: ST, k: number): [number, number, number] => [x[0] + ins * 0.1 * k, x[1] + int * 0.1 * k, zAt(x[0] + ins * 0.1 * k, x[1] + int * 0.1 * k) + 0.06 - 0.03 * k];
      d.quad(P(p, 0), P(q, 0), P(q, 1), P(p, 1), n, shade(ROOF, 0.6));
    }
  });

  // Rive du débord, gouttières et descentes.
  const o = m.ov;
  const eaveRing: ST[] = [[s0 - o, t0 - o], [s1 + o, t0 - o], [s1 + o, tw + o], [sw - o, tw + o], [sw - o, t1 + o], [s0 - o, t1 + o]];
  for (let i = 0; i < eaveRing.length; i++) {
    const a = eaveRing[i]!, b = eaveRing[(i + 1) % eaveRing.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ns = (b[1] - a[1]) / len, nt = -(b[0] - a[0]) / len;
    const zt = Z(zEdge);
    const off = (q: ST, k: number): ST => [q[0] + ns * k, q[1] + nt * k];
    d.quad([...off(a, 0.02), zt - 0.16], [...off(b, 0.02), zt - 0.16], [...off(b, 0.02), zt + 0.02], [...off(a, 0.02), zt + 0.02], d.N(ns, nt), GUTTER);
    d.quad([...off(a, 0.02), zt - 0.16], [...off(b, 0.02), zt - 0.16], [...off(b, -0.14), zt - 0.16], [...off(a, -0.14), zt - 0.16], d.N(0, 0, -1), shade(GUTTER, 0.7));
  }
  for (const [s, t, ns, nt] of [[s0 + 0.25, t1, 0, 1], [s1 - 0.25, tw, 0, 1], [s1, t0 + 0.25, 1, 0], [s0 + 0.25, t0, 0, -1]] as const) {
    const s2 = s + ns * 0.12, t2 = t + nt * 0.12;
    d.box(s2 - 0.05, s2 + 0.05, t2 - 0.05, t2 + 0.05, foot(s2, t2) + 0.3, Z(zEdge) - 0.05, GUTTER);
  }

  // --- Lucarnes à croupe : façade enduite, joues et toit de tuiles ---------------------------------------------------------------
  for (const [pan, sc, w] of m.dormers) {
    const T = pan === "main" ? t1 : tw;
    const roofZ = (t: number): number => Z(m.eave + m.pitch * (T - t));
    const tf = T - 0.9, zr = roofZ(tf), zt = zr + 1.25, hw = w / 2, ov = 0.12;
    const zr2 = zt + (hw + ov) * 1.0;
    const tBack = T - (zr2 - Z(m.eave)) / m.pitch, tCheek = T - (zt - Z(m.eave)) / m.pitch;
    const nF = d.N(0, 1);
    d.quad([sc - hw, tf, zr - 0.05], [sc + hw, tf, zr - 0.05], [sc + hw, tf, zt], [sc - hw, tf, zt], nF, WALL);
    for (const [s, dir] of [[sc - hw, -1], [sc + hw, 1]] as const) {
      d.mb.tri(d.P(s, tf, zr - 0.05), d.P(s, tf, zt), d.P(s, tCheek, zt), d.N(dir, 0), shade(ROOF, 0.85));
    }
    // Toit à croupe : croupe avant et deux longs pans jusqu'au toit.
    const fs = tf + ov, apex = fs - (hw + ov);
    const nl = Math.SQRT2;
    d.mb.tri(d.P(sc - hw - ov, fs, zt), d.P(sc + hw + ov, fs, zt), d.P(sc, apex, zr2), d.N(0, 1 / nl, 1 / nl), ROOF);
    for (const dir of [-1, 1]) {
      const se = sc + dir * (hw + ov);
      d.quad([se, fs, zt], [se, tCheek, zt], [sc, tBack, zr2], [sc, apex, zr2], d.N(dir / nl, 0, 1 / nl), shade(ROOF, 0.94));
    }
    d.quad([sc - hw - ov, fs, zt - 0.1], [sc + hw + ov, fs, zt - 0.1], [sc + hw + ov, fs, zt], [sc - hw - ov, fs, zt], nF, GUTTER);
    // Fenêtre : volets fermés sur le corps, ouverts sur l'aile (photos).
    const wz0 = zr + 0.22, wz1 = zt - 0.18, ww = Math.min(0.62, w / 2 - 0.02);
    d.quad([sc - ww - 0.06, tf + 0.02, wz0 - 0.06], [sc + ww + 0.06, tf + 0.02, wz0 - 0.06], [sc + ww + 0.06, tf + 0.02, wz1 + 0.06], [sc - ww - 0.06, tf + 0.02, wz1 + 0.06], nF, FRAME);
    if (pan === "main") {
      shutterLeaf(d, sc - ww, sc, tf + 0.035, 0, 1, wz0, wz1, SHUT);
      shutterLeaf(d, sc, sc + ww, tf + 0.035, 0, 1, wz0, wz1, SHUT);
    } else {
      d.quad([sc - ww / 2, tf + 0.035, wz0], [sc + ww / 2, tf + 0.035, wz0], [sc + ww / 2, tf + 0.035, wz1], [sc - ww / 2, tf + 0.035, wz1], nF, GLASS);
      lit?.quad([sc - ww / 2, tf + 0.04, wz0], [sc + ww / 2, tf + 0.04, wz0], [sc + ww / 2, tf + 0.04, wz1], [sc - ww / 2, tf + 0.04, wz1], nF, GLOW_LO);
    }
  }

  // --- Cheminée crépie, chapeau métallique, parabole --------------------------------------------------------------------------------
  {
    const [cs, ct, top] = m.chim;
    const low = Math.min(...[[-0.3, -0.25], [0.3, -0.25], [0.3, 0.25], [-0.3, 0.25]].map(([ds, dt]) => {
      const s = cs + ds!, t = ct + dt!;
      return Math.max(...m.roof.filter((fc) => inside(pairsOf(fc.r), s, t)).map((fc) => Z(fc.k[0] * s + fc.k[1] * t + fc.k[2])), ze);
    }));
    d.box(cs - 0.3, cs + 0.3, ct - 0.25, ct + 0.25, low - 0.1, Z(top) - 0.25, shade(WALL, 0.95));
    d.box(cs - 0.38, cs + 0.38, ct - 0.33, ct + 0.33, Z(top) - 0.06, Z(top), METAL);
    d.box(cs - 0.22, cs + 0.22, ct - 0.17, ct + 0.17, Z(top) - 0.25, Z(top) - 0.06, shade(METAL, 0.45));
    // Parabole sur le côté sud-ouest de la cheminée (photo), tournée vers le sud-est.
    const pc: ST = [cs - 0.45, ct + 0.1], zc = Z(top) - 0.75, R = 0.38;
    for (let i = 0; i < 8; i++) {
      const a0 = (Math.PI * 2 * i) / 8, a1 = (Math.PI * 2 * (i + 1)) / 8;
      const P = (aa: number): [number, number, number] => [pc[0] + Math.cos(aa) * R, pc[1] + 0.12, zc + Math.sin(aa) * R];
      d.mb.tri(d.P(pc[0], pc[1] + 0.02, zc), d.P(...P(a0)), d.P(...P(a1)), d.N(0, 1), DISH);
    }
  }

  // --- Ouvertures ---------------------------------------------------------------------------------------------------------------------
  const edges = houseEdges(m);
  for (const op of m.openings) opening(d, lit, edges, op, Z, SHUT, (s, t) => foot(s, t) + 0.3);

  // --- Entrée couverte : porte au fond, poteau, sablières, jambe de force ---------------------------------------------------------
  {
    const tb = tw - pd, sm = sw + pw / 2, z0 = Z(0.08);
    d.quad([sm - dw / 2 - 0.06, tb + 0.02, z0], [sm + dw / 2 + 0.06, tb + 0.02, z0], [sm + dw / 2 + 0.06, tb + 0.02, z0 + dh + 0.06], [sm - dw / 2 - 0.06, tb + 0.02, z0 + dh + 0.06], d.N(0, 1), FRAME);
    d.quad([sm - dw / 2, tb + 0.035, z0], [sm + dw / 2, tb + 0.035, z0], [sm + dw / 2, tb + 0.035, z0 + dh], [sm - dw / 2, tb + 0.035, z0 + dh], d.N(0, 1), shade(SHUT, 0.9));
    d.quad([sm - dw / 2 + 0.15, tb + 0.045, z0 + dh * 0.6], [sm + dw / 2 - 0.15, tb + 0.045, z0 + dh * 0.6], [sm + dw / 2 - 0.15, tb + 0.045, z0 + dh - 0.15], [sm - dw / 2 + 0.15, tb + 0.045, z0 + dh - 0.15], d.N(0, 1), GLASS);
    lit?.quad([sm - dw / 2 + 0.15, tb + 0.05, z0 + dh * 0.6], [sm + dw / 2 - 0.15, tb + 0.05, z0 + dh * 0.6], [sm + dw / 2 - 0.15, tb + 0.05, z0 + dh - 0.15], [sm - dw / 2 + 0.15, tb + 0.05, z0 + dh - 0.15], d.N(0, 1), GLOW_HI);
    const ps = sw + 0.08, pt = tw - 0.08;
    d.box(ps - 0.08, ps + 0.08, pt - 0.08, pt + 0.08, foot(ps, pt) + 0.3, ze, WOOD);
    d.box(ps - 0.06, sw + pw, pt - 0.06, pt + 0.06, ze - 0.24, ze, shade(WOOD, 0.9));
    d.box(ps - 0.06, ps + 0.06, tb, pt + 0.06, ze - 0.24, ze, shade(WOOD, 0.9));
    // Jambe de force vers le bout de l'aile : barre oblique de 4 cm.
    const zb = ze - 0.95, zu = ze - 0.24, sb = ps + 0.08, su = ps + 0.75;
    d.quad([sb, pt + 0.05, zb], [sb, pt + 0.05, zb + 0.12], [su, pt + 0.05, zu], [su - 0.12, pt + 0.05, zu], d.N(0, 1), WOOD);
    d.quad([sb, pt - 0.05, zb], [sb, pt - 0.05, zb + 0.12], [su, pt - 0.05, zu], [su - 0.12, pt - 0.05, zu], d.N(0, -1), WOOD);
  }

  // --- Terrasse de dalles (le long du corps et sous l'entrée) et allée gravillonnée le long du bout de l'aile -------------------------
  const W = (q: ST): number[] => at(f, q[0], q[1]);
  const slab: ST[] = [[s0 - 0.2, t1], [sw, t1], [sw, tw - pd], [sw + pw, tw - pd], [sw + pw, t1 + 3.8], [s0 - 0.2, t1 + 3.8]];
  fillOnTerrain(mb, [slab.flatMap(W)], 0.1, SLAB, terrain);
  const gravel: ST[] = [[sw + pw, tw], [s1 + 0.6, tw], [s1 + 0.6, tw + 1.3], [sw + pw, tw + 1.3]];
  fillOnTerrain(mb, [gravel.flatMap(W)], 0.09, GRAVEL, terrain);
}

function pairsOf(flat: number[]): ST[] {
  const out: ST[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

/** Volet persienné d'une lucarne, à plat sur sa façade (de u0 à u1 le long de s, face vers +t), lames tous les 16 cm. */
function shutterLeaf(d: GateDraw, u0: number, u1: number, t: number, ns: number, nt: number, z0: number, z1: number, col: THREE.Color): void {
  const n = d.N(ns, nt);
  d.quad([u0, t, z0], [u1, t, z0], [u1, t, z1], [u0, t, z1], n, col);
  for (let z = z0 + 0.12; z < z1 - 0.08; z += 0.16) d.quad([u0 + 0.05, t + nt * 0.008, z], [u1 - 0.05, t + nt * 0.008, z], [u1 - 0.05, t + nt * 0.008, z + 0.035], [u0 + 0.05, t + nt * 0.008, z + 0.035], n, shade(col, 0.7));
}

/** Point du mur `e` à la distance u, décalé de `off` vers l'extérieur. */
function onEdge(e: HouseEdge, u: number, off: number): ST {
  const dx = (e.b[0] - e.a[0]) / e.len, dy = (e.b[1] - e.a[1]) / e.len;
  return [e.a[0] + dx * u + e.n[0] * off, e.a[1] + dy * u + e.n[1] * off];
}

/** Ouverture cintrée (arc surbaissé) à volets repliés contre le mur, ou applique. */
function opening(d: GateDraw, lit: GateDraw | null, edges: HouseEdge[], op: HouseOpening, Z: (h: number) => number, shutter: THREE.Color, ground: (s: number, t: number) => number): void {
  const e = edges[op[0]]!, u = op[1];
  const n = d.N(e.n[0], e.n[1]);
  const quad = (target: GateDraw, u0: number, u1: number, z0: number, z1: number, off: number, col: THREE.Color, rise = 0): void => {
    const p0 = onEdge(e, u0, off), p1 = onEdge(e, u1, off);
    if (rise <= 0) {
      target.quad([...p0, z0], [...p1, z0], [...p1, z1], [...p0, z1], n, col);
      return;
    }
    // Arc surbaissé : quatre tranches dont le haut suit une parabole de flèche `rise`.
    const k = 4;
    for (let i = 0; i < k; i++) {
      const a = u0 + ((u1 - u0) * i) / k, b = u0 + ((u1 - u0) * (i + 1)) / k;
      const top = (x: number): number => z1 + rise * (1 - ((2 * (x - u0)) / (u1 - u0) - 1) ** 2);
      const pa = onEdge(e, a, off), pb = onEdge(e, b, off);
      target.quad([...pa, z0], [...pb, z0], [...pb, top(b)], [...pa, top(a)], n, col);
    }
  };
  const base = ground(...onEdge(e, u, 0));
  if (op[2] === "lamp") {
    const p = onEdge(e, u, 0.06), z = Z(2.05);
    const [ps, pt] = p, t0 = e.n;
    d.box(ps - 0.07 * Math.abs(t0[1]) - 0.04 * Math.abs(t0[0]), ps + 0.07 * Math.abs(t0[1]) + 0.04 * Math.abs(t0[0]),
      pt - 0.07 * Math.abs(t0[0]) - 0.04 * Math.abs(t0[1]), pt + 0.07 * Math.abs(t0[0]) + 0.04 * Math.abs(t0[1]), z, z + 0.24, LAMP);
    if (lit) quad(lit, u - 0.06, u + 0.06, z + 0.04, z + 0.2, 0.11, GLOW_HI);
    return;
  }
  const [, , kind, w, h, sill] = op;
  const isDoor = kind === "door2" || kind === "door4";
  const z0 = isDoor ? Math.max(Z(0.08), base) : Z(sill ?? 1), z1 = z0 + h - (isDoor ? 0.18 : 0.1), rise = isDoor ? 0.18 : 0.1;
  quad(d, u - w / 2 - 0.07, u + w / 2 + 0.07, z0 - (isDoor ? 0 : 0.07), z1 + 0.04, 0.015, FRAME, rise + 0.03);
  quad(d, u - w / 2, u + w / 2, z0, z1, 0.03, GLASS, rise);
  if (isDoor) quad(d, u - 0.03, u + 0.03, z0, z1 + rise, 0.04, FRAME);
  if (lit && (kind === "door2" || kind === "window1")) quad(lit, u - w / 2, u + w / 2, z0, z1, 0.035, GLOW_LO, rise);
  // Volets repliés contre le mur : la moitié de la largeur de chaque côté (deux vantaux pliés pour la porte-fenêtre à quatre volets), ou
  // un seul volet à droite pour la petite fenêtre.
  const leaves: [number, number][] = kind === "window1" ? [[w / 2 + 0.06, w * 1.5 + 0.06]] : [[-w - 0.06, -w / 2 - 0.06], [w / 2 + 0.06, w + 0.06]];
  for (const [a, b] of leaves) louvered(d, onEdge(e, u + a, 0.05), onEdge(e, u + b, 0.05), e.n, z0, z1 + rise * 0.6, shutter, kind === "door4");
}

/** Volet persienné à plat contre le mur, de p0 à p1 (lames tous les 16 cm). */
function louvered(d: GateDraw, p0: ST, p1: ST, nrm: [number, number], z0: number, z1: number, col: THREE.Color, folded: boolean): void {
  const n = d.N(nrm[0], nrm[1]);
  d.quad([...p0, z0], [...p1, z0], [...p1, z1], [...p0, z1], n, col);
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ux = (p1[0] - p0[0]) / len, uy = (p1[1] - p0[1]) / len;
  const q0: ST = [p0[0] + ux * 0.05 + nrm[0] * 0.008, p0[1] + uy * 0.05 + nrm[1] * 0.008], q1: ST = [p1[0] - ux * 0.05 + nrm[0] * 0.008, p1[1] - uy * 0.05 + nrm[1] * 0.008];
  for (let z = z0 + 0.12; z < z1 - 0.08; z += 0.16) d.quad([...q0, z], [...q1, z], [...q1, z + 0.035], [...q0, z + 0.035], n, shade(col, 0.72));
  // Montant central : deux vantaux repliés l'un sur l'autre.
  if (folded) {
    const m: ST = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2];
    d.quad([m[0] - ux * 0.02, m[1] - uy * 0.02, z0], [m[0] + ux * 0.02, m[1] + uy * 0.02, z0], [m[0] + ux * 0.02, m[1] + uy * 0.02, z1], [m[0] - ux * 0.02, m[1] - uy * 0.02, z1], n, shade(col, 0.6));
  }
}
