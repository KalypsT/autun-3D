import * as THREE from "three";
import type { Building, BuildingKind, HeightField, StoreModel } from "../data/types";
import { edgeFrame, type EdgeFrame } from "../core/landmarks";
import { hash01, toThree, type MeshBuilder, type Vec3 } from "./geometry";
import type { LandmarkSinks } from "./landmarks";

/**
 * Magasins d'après photo (D143) : le Lidl de Saint-Pantaléon (mur vitré, sas, panneaux perpendiculaires, garde-corps, long mur à casier et zone
 * hachurée) et la pharmacie voisine (galerie à poteaux, vitrage en retrait, bandeau à croix vertes), plus l'abri à chariots du Lidl.
 * Style « affiche » : aplats, vitrages en dégradé, lettres de l'atlas. Tout s'écrit dans les maillages de la tuile (aucun appel de dessin de plus).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const GLASS_LO = C("#5f7f8d"), GLASS_HI = C("#a9c3cc");
const FRAME = C("#3b4247");
const GREY = C("#8b9397");
const GREY_LIGHT = C("#b8bec2");
const RAIL = C("#c9cdcf");
const BLUE = C("#0050aa");
const YELLOW = C("#ffe500");
const RED = C("#e30613");
const WHITE = C("#f4efe4");
const HATCH_YELLOW = C("#f2c230");
const HATCH_BLACK = C("#2a2d2f");
const CONCRETE = C("#9d9a92");
const MARQUISE_TOP = C("#8c9498");
const MARQUISE_UNDER = C("#d9dcdc");

type P2 = [number, number];

const pt = (f: EdgeFrame, s: number, o: number): P2 => [f.x + f.tx * s + f.nx * o, f.y + f.ty * s + f.ny * o];

/** Repère d'un plan vertical quelconque : de (x, y) dans la direction (tx, ty), normale à droite. */
function planeFrame(x: number, y: number, tx: number, ty: number, len: number): EdgeFrame {
  return { x, y, tx, ty, nx: ty, ny: -tx, len };
}

/** Plaque verticale entre a et b (face vers la droite de a vers b), de z0 à z1 à chaque bout. */
function vplate(mb: MeshBuilder, a: P2, b: P2, za0: number, zb0: number, za1: number, zb1: number, lo: THREE.Color, hi: THREE.Color = lo): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n = toThree((b[1] - a[1]) / len, -(b[0] - a[0]) / len, 0);
  const A0 = toThree(a[0], a[1], za0), B0 = toThree(b[0], b[1], zb0), B1 = toThree(b[0], b[1], zb1), A1 = toThree(a[0], a[1], za1);
  if (lo === hi) mb.quad(A0, B0, B1, A1, n, lo);
  else mb.quadGradient(A0, B0, B1, A1, n, lo, hi);
}

/** Plaque sur le plan du repère, de s0 à s1 et de z0 à z1 (altitudes), à la distance `o` du plan. */
function plate(mb: MeshBuilder, f: EdgeFrame, s0: number, s1: number, z0: number, z1: number, o: number, lo: THREE.Color, hi: THREE.Color = lo): void {
  vplate(mb, pt(f, s0, o), pt(f, s1, o), z0, z0, z1, z1, lo, hi);
}

/** Pavé droit dans le repère (s de s0 à s1, distance o de o0 à o1, altitudes z0 à z1) : quatre côtés, dessus et, si `under`, dessous. */
function box(mb: MeshBuilder, f: EdgeFrame, s0: number, s1: number, o0: number, o1: number, z0: number, z1: number, color: THREE.Color, top: THREE.Color = color, under?: THREE.Color): void {
  const c = [pt(f, s0, o0), pt(f, s0, o1), pt(f, s1, o1), pt(f, s1, o0)];
  for (let i = 0; i < 4; i++) vplate(mb, c[i]!, c[(i + 1) % 4]!, z0, z0, z1, z1, color);
  mb.quad(toThree(c[0]![0], c[0]![1], z1), toThree(c[1]![0], c[1]![1], z1), toThree(c[2]![0], c[2]![1], z1), toThree(c[3]![0], c[3]![1], z1), [0, 1, 0], top);
  if (under) mb.quad(toThree(c[3]![0], c[3]![1], z0), toThree(c[2]![0], c[2]![1], z0), toThree(c[1]![0], c[1]![1], z0), toThree(c[0]![0], c[0]![1], z0), [0, -1, 0], under);
}

/** Quadrilatère posé sur le sol (suit le relief), à `lift` au-dessus, face vers le haut ; les coins (s, o) dans l'ordre direct vu d'en haut. */
function ground(mb: MeshBuilder, f: EdgeFrame, corners: [number, number][], terrain: HeightField, lift: number, color: THREE.Color): void {
  const v = corners.map(([s, o]) => {
    const [x, y] = pt(f, s, o);
    return toThree(x, y, terrain.heightAt(x, y) + lift);
  }) as [Vec3, Vec3, Vec3, Vec3];
  mb.quad(v[0], v[1], v[2], v[3], [0, 1, 0], color);
}

/** Vitrage en dégradé bleuté ; il s'allume la nuit (`lit` : part des vitrages allumés). */
function glass(sinks: LandmarkSinks, f: EdgeFrame, s0: number, s1: number, z0: number, z1: number, o: number, lit: number): void {
  plate(sinks.solid, f, s0, s1, z0, z1, o, GLASS_LO, GLASS_HI);
  if (hash01(`${f.x.toFixed(1)},${f.y.toFixed(1)},${s0.toFixed(1)}`) < lit) plate(sinks.glow, f, s0, s1, z0, z1, o + 0.006, C("#ffb04a"), C("#fff0b0"));
}

/** Texte de l'atlas posé sur le plan du repère, centré en s, bas à z, de hauteur h (largeur 6,4 h). */
function label(sinks: LandmarkSinks, f: EdgeFrame, s: number, z: number, h: number, o: number, text: string, color: string, script = false): void {
  const w = h * 6.4;
  const r = sinks.atlas.get(text, color, script);
  const [ax, ay] = pt(f, s - w / 2, o), [bx, by] = pt(f, s + w / 2, o);
  sinks.names.quad(toThree(ax, ay, z), toThree(bx, by, z), toThree(bx, by, z + h), toThree(ax, ay, z + h), toThree(f.nx, f.ny, 0),
    [r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1], WHITE);
}

/** Disque posé sur le plan du repère (centre en s, z ; rayon r), à la distance o. */
function disc(mb: MeshBuilder, f: EdgeFrame, s: number, z: number, r: number, o: number, color: THREE.Color, seg = 14): void {
  const n = toThree(f.nx, f.ny, 0);
  const [cx, cy] = pt(f, s, o);
  for (let i = 0; i < seg; i++) {
    const a0 = (2 * Math.PI * i) / seg, a1 = (2 * Math.PI * (i + 1)) / seg;
    const [x0, y0] = pt(f, s + Math.cos(a0) * r, o), [x1, y1] = pt(f, s + Math.cos(a1) * r, o);
    mb.tri(toThree(cx, cy, z), toThree(x0, y0, z + Math.sin(a0) * r), toThree(x1, y1, z + Math.sin(a1) * r), n, color);
  }
}

/** Croix pleine posée sur le plan du repère (centre en s, z ; demi-longueur r, demi-épaisseur w). */
function cross(mb: MeshBuilder, f: EdgeFrame, s: number, z: number, r: number, w: number, o: number, color: THREE.Color): void {
  plate(mb, f, s - w, s + w, z - r, z + r, o, color);
  plate(mb, f, s - r, s - w, z - w, z + w, o, color);
  plate(mb, f, s + w, s + r, z - w, z + w, o, color);
}

const topAt = (b: Building, i: number, s: number, len: number): number => {
  const n = b.ring.length / 2;
  const t0 = b.top[i % n]!, t1 = b.top[(i + 1) % n]!;
  return t0 + ((t1 - t0) * s) / len;
};

/** Mur plein d'une arête, du sol (suit le relief aux deux bouts) au haut du mur. */
function plainWall(mb: MeshBuilder, b: Building, i: number, terrain: HeightField, color: THREE.Color): void {
  const n = b.ring.length / 2;
  const f = edgeFrame(b.ring, i);
  const a: P2 = [f.x, f.y], e = pt(f, f.len, 0);
  vplate(mb, a, e, terrain.heightAt(a[0], a[1]) - 0.3, terrain.heightAt(e[0], e[1]) - 0.3, b.top[i]!, b.top[(i + 1) % n]!, color);
}

/** Garde-corps tubulaire au-dessus du haut des murs : montants tous les 4 m au plus, une lisse haute (ruban à double face). */
function railing(mb: MeshBuilder, b: Building, edges: number[]): void {
  const H = 1.1;
  for (const i of edges) {
    const f = edgeFrame(b.ring, i);
    if (f.len < 3) continue;
    const k = Math.max(1, Math.ceil((f.len - 0.4) / 4));
    let prev: { s: number; z: number } | null = null;
    for (let j = 0; j <= k; j++) {
      const s = 0.2 + ((f.len - 0.4) * j) / k, z = topAt(b, i, s, f.len);
      box(mb, f, s - 0.025, s + 0.025, -0.17, -0.12, z, z + H, RAIL, RAIL);
      if (prev) {
        const a = pt(f, prev.s, -0.145), c = pt(f, s, -0.145);
        vplate(mb, a, c, prev.z + H - 0.05, z + H - 0.05, prev.z + H, z + H, RAIL);
        vplate(mb, c, a, z + H - 0.05, prev.z + H - 0.05, z + H, prev.z + H, RAIL);
      }
      prev = { s, z };
    }
  }
}

/** Bande de bardage gris au-dessus de `z0` (au-dessus du sol), jusqu'au haut du mur, sur une arête. */
function band(mb: MeshBuilder, b: Building, i: number, terrain: HeightField, z0: number, color: THREE.Color): void {
  const n = b.ring.length / 2;
  const f = edgeFrame(b.ring, i);
  const a: P2 = [f.x, f.y], e = pt(f, f.len, 0);
  const za = terrain.heightAt(a[0], a[1]) + z0, zb = terrain.heightAt(e[0], e[1]) + z0;
  if (b.top[i]! - za < 0.3 || b.top[(i + 1) % n]! - zb < 0.3) return;
  const [ox, oy] = [f.nx * 0.04, f.ny * 0.04];
  vplate(mb, [a[0] + ox, a[1] + oy], [e[0] + ox, e[1] + oy], za, zb, b.top[i]! + 0.02, b.top[(i + 1) % n]! + 0.02, color);
}

// --- Lidl ---------------------------------------------------------------------------------------------------------------------------

function lidl(sinks: LandmarkSinks, b: Building, st: StoreModel, terrain: HeightField): void {
  const mb = sinks.solid;
  const n = b.ring.length / 2;
  const f = edgeFrame(b.ring, st.e);
  const zg = (s: number, o = 0): number => terrain.heightAt(...pt(f, s, o));
  // Bardage gris en haut des murs, socle gris en bas : tout le tour.
  for (let i = 0; i < n; i++) {
    band(mb, b, i, terrain, 4.4, GREY);
    const fi = edgeFrame(b.ring, i);
    if (fi.len > 2) {
      const a: P2 = [fi.x, fi.y], e = pt(fi, fi.len, 0), [ox, oy] = [fi.nx * 0.03, fi.ny * 0.03];
      vplate(mb, [a[0] + ox, a[1] + oy], [e[0] + ox, e[1] + oy], terrain.heightAt(a[0], a[1]) - 0.3, terrain.heightAt(e[0], e[1]) - 0.3,
        terrain.heightAt(a[0], a[1]) + 0.4, terrain.heightAt(e[0], e[1]) + 0.4, CONCRETE);
    }
  }
  // Mur vitré : baies de 2,2 m environ, montants et traverse sombres. Le bandeau gris continue au-dessus.
  const [g0, g1] = st.glass;
  const bays = Math.max(1, Math.round((g1 - g0) / 2.2));
  for (let k = 0; k < bays; k++) {
    const s0 = g0 + ((g1 - g0) * k) / bays, s1 = g0 + ((g1 - g0) * (k + 1)) / bays, z = zg((s0 + s1) / 2);
    glass(sinks, f, s0 + 0.05, s1 - 0.05, z + 0.05, z + 4.3, 0.05, 1);
    plate(mb, f, s0 + 0.04, s1 - 0.04, z + 2.65, z + 2.75, 0.07, FRAME);
  }
  for (let k = 0; k <= bays; k++) {
    const s = g0 + ((g1 - g0) * k) / bays, z = zg(s);
    plate(mb, f, s - 0.06, s + 0.06, z, z + 4.35, 0.07, FRAME);
  }
  // Sas d'entrée : boîte vitrée en saillie de 1,3 m, double porte au milieu, sous une marquise plate de 2,8 m.
  if (st.door) {
    const [c, w] = st.door, d = 1.3, z = zg(c, d);
    const s0 = c - w / 2, s1 = c + w / 2;
    glass(sinks, f, s0, c - 0.03, z + 0.05, z + 2.9, d, 1);
    glass(sinks, f, c + 0.03, s1, z + 0.05, z + 2.9, d, 1);
    plate(mb, f, c - 0.04, c + 0.04, z, z + 2.95, d + 0.02, FRAME);
    for (const s of [s0, s1]) plate(mb, f, s - 0.06, s + 0.06, z, z + 2.95, d + 0.02, FRAME);
    plate(mb, f, s0, s1, z + 2.85, z + 3.1, d + 0.02, FRAME);
    // Côtés du sas, face vers l'extérieur (±t).
    for (const [s, dir] of [[s0, -1], [s1, 1]] as const) {
      const a = pt(f, s, dir < 0 ? 0 : d), e = pt(f, s, dir < 0 ? d : 0);
      vplate(mb, a, e, z + 0.05, z + 0.05, z + 2.9, z + 2.9, GLASS_LO, GLASS_HI);
    }
    const m0 = s0 - 0.6, m1 = s1 + 0.6, zm = z + 3.15;
    box(mb, f, m0, m1, 0, 2.8, zm, zm + 0.25, MARQUISE_TOP, MARQUISE_TOP, MARQUISE_UNDER);
  }
  // Panneaux perpendiculaires au mur, de part et d'autre du sas : carré bleu, disque jaune cerclé de rouge, « LIDL ».
  for (const s of st.blades ?? []) {
    const z = zg(s, 1) + 2.9, h = 1.9, o0 = 0.12, o1 = 1.8;
    box(mb, f, s - 0.04, s + 0.04, o0, o1, z, z + h, BLUE, BLUE, BLUE);
    for (const dir of [1, -1]) {
      const [x, y] = pt(f, s + dir * 0.045, dir > 0 ? o1 : o0);
      // Face tournée vers +t (dir 1) ou -t : le repère va vers l'intérieur de la grande plaque, sa normale (à droite) regarde dehors.
      const pf = planeFrame(x, y, -dir * f.nx, -dir * f.ny, o1 - o0);
      const mid = (o1 - o0) / 2, zc = z + h * 0.58;
      disc(mb, pf, mid, zc, 0.62, 0.004, RED, 16);
      disc(mb, pf, mid, zc, 0.55, 0.012, YELLOW, 16);
      label(sinks, pf, mid, z + 0.08, 0.26, 0.02, "LIDL", "#0050aa");
    }
  }
  // Long mur plein : casier de retrait (rose), grilles de ventilation dans le bardage, zone hachurée jaune et noire au sol.
  if (st.side) {
    const fs = edgeFrame(b.ring, st.side.e);
    const [ls, lw] = st.side.locker, zl = terrain.heightAt(...pt(fs, ls, 0));
    box(mb, fs, ls - lw / 2, ls + lw / 2, 0.02, 0.5, zl, zl + 1.9, C("#e24c85"), C("#f06a9c"));
    plate(mb, fs, ls - lw / 2 + 0.15, ls + lw / 2 - 0.15, zl + 0.95, zl + 1.7, 0.51, C("#2b3238"));
    plate(mb, fs, ls - lw / 2 + 0.15, ls + lw / 2 - 0.15, zl + 0.45, zl + 0.8, 0.51, C("#f3d6e2"));
    for (const s of st.side.vents) {
      const z = terrain.heightAt(...pt(fs, s, 0)) + 5.2;
      plate(mb, fs, s - 1, s + 1, z, z + 1.0, 0.07, C("#5f686c"));
      for (let k = 0; k < 4; k++) plate(mb, fs, s - 0.95, s + 0.95, z + 0.12 + k * 0.22, z + 0.2 + k * 0.22, 0.085, C("#a2abaf"));
    }
    const [h0, h1, d0, d1] = st.side.hatch;
    ground(mb, fs, [[h0, d0], [h0, d1], [h1, d1], [h1, d0]], terrain, 0.07, HATCH_BLACK);
    const sh = (d1 - d0) * 0.5;
    for (let s = h0; s + 0.5 + sh <= h1 + 0.01; s += 1.0) ground(mb, fs, [[s, d0], [s + sh, d1], [s + sh + 0.5, d1], [s + 0.5, d0]], terrain, 0.078, HATCH_YELLOW);
  }
  railing(mb, b, [...Array(n).keys()]);
}

// --- Pharmacie ----------------------------------------------------------------------------------------------------------------------

function pharmacy(sinks: LandmarkSinks, b: Building, kind: BuildingKind, st: StoreModel, terrain: HeightField, wall: THREE.Color): void {
  const mb = sinks.solid;
  const n = b.ring.length / 2;
  const f = edgeFrame(b.ring, st.e);
  const gal = st.gallery ?? 2.2;
  const zg = (s: number, o = 0): number => terrain.heightAt(...pt(f, s, o));
  const zc = zg(f.len / 2) + 2.55;
  // Les autres murs : pleins. Le mur de façade est remplacé par la galerie.
  for (let i = 0; i < n; i++) if (i !== st.e % n) plainWall(mb, b, i, terrain, wall);
  // Retours de la galerie aux deux bouts, fond de la galerie (mur en retrait), plafond et dallage.
  for (const [s, dir] of [[0.02, 1], [f.len - 0.02, -1]] as const) {
    const a = pt(f, s, dir > 0 ? -gal : 0), e = pt(f, s, dir > 0 ? 0 : -gal);
    vplate(mb, a, e, zg(s) - 0.3, zg(s) - 0.3, zc, zc, shade(wall, 0.92));
  }
  plate(mb, f, 0, f.len, zg(f.len / 2) - 0.3, zc, -gal, wall);
  mb.quad(...([[0, -gal], [f.len, -gal], [f.len, 0], [0, 0]] as [number, number][]).map(([s, o]) => toThree(...pt(f, s, o), zc)) as [Vec3, Vec3, Vec3, Vec3], [0, -1, 0], MARQUISE_UNDER);
  ground(mb, f, [[0, -gal], [0, 0], [f.len, 0], [f.len, -gal]], terrain, 0.03, C("#b9b5ac"));
  // Vitrage en retrait : baies de 1,8 m environ, montants sombres, traverse.
  const [g0, g1] = st.glass;
  const bays = Math.max(1, Math.round((g1 - g0) / 1.8));
  for (let k = 0; k < bays; k++) {
    const s0 = g0 + ((g1 - g0) * k) / bays, s1 = g0 + ((g1 - g0) * (k + 1)) / bays, z = zg((s0 + s1) / 2, -gal);
    glass(sinks, f, s0 + 0.04, s1 - 0.04, z + 0.05, z + 2.4, -gal + 0.03, 0.8);
    plate(mb, f, s0 + 0.03, s1 - 0.03, z + 2.4, z + 2.5, -gal + 0.04, FRAME);
  }
  for (let k = 0; k <= bays; k++) {
    const s = g0 + ((g1 - g0) * k) / bays, z = zg(s, -gal);
    plate(mb, f, s - 0.05, s + 0.05, z, z + 2.5, -gal + 0.05, FRAME);
  }
  // Bandeau gris de la façade (dessous de la dalle de toit) : de la hauteur libre au haut du mur, avec filet sombre en bas.
  const zb0 = zg(0) + 2.55, zb1 = zg(f.len) + 2.55;
  vplate(mb, pt(f, 0, 0), pt(f, f.len, 0), zb0, zb1, b.top[st.e % n]!, b.top[(st.e + 1) % n]!, GREY_LIGHT);
  vplate(mb, pt(f, 0, 0.01), pt(f, f.len, 0.01), zb0, zb1, zb0 + 0.07, zb1 + 0.07, FRAME);
  const zf = zc + 0.1;
  label(sinks, f, f.len * 0.53, zf + 0.12, 0.5, 0.03, kind.n ?? "Pharmacie", "#394043");
  const green = C("#3fbf62");
  const [cx, cr] = st.cross ?? [f.len * 0.7, f.len * 0.9];
  cross(mb, f, cx, zf + 0.42, 0.34, 0.11, 0.025, green);
  for (const s of [f.len * 0.1, f.len * 0.3, f.len * 0.85]) cross(mb, f, s, zf + 0.42, 0.14, 0.045, 0.025, s < f.len * 0.2 ? C("#f0952e") : green);
  // Poteaux gris-bleu de la galerie, potelets inox devant.
  const posts = [0.25, f.len * 0.2, f.len * 0.4, f.len * 0.6, f.len * 0.8, f.len - 0.25];
  for (const s of posts) box(mb, f, s - 0.07, s + 0.07, -0.2, -0.06, zg(s) - 0.1, zc, C("#66738f"));
  for (let s = 1.5; s < f.len - 1; s += 3) box(mb, f, s - 0.05, s + 0.05, 0.5, 0.6, zg(s, 0.55), zg(s, 0.55) + 0.95, C("#c5cbce"), C("#e1e5e7"));
  // Grande croix verte lumineuse sur le toit, vue de face comme de dos.
  {
    const zr = topAt(b, st.e, cr, f.len) + 0.1;
    box(mb, f, cr - 0.05, cr + 0.05, -0.45, -0.35, zr, zr + 0.9, FRAME);
    plate(mb, f, cr - 0.5, cr + 0.5, zr + 0.9, zr + 1.9, -0.28, C("#23282b"));
    cross(mb, f, cr, zr + 1.4, 0.42, 0.14, -0.26, green);
    cross(sinks.glow, f, cr, zr + 1.4, 0.42, 0.14, -0.255, C("#7dff9a"));
  }
}

const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);

/** Entrée de la tuile : dessine le magasin d'après photo de ce bâtiment. */
export function buildStore(sinks: LandmarkSinks, b: Building, kind: BuildingKind, terrain: HeightField, wall: THREE.Color): void {
  const st = kind.store;
  if (!st) return;
  if (st.style === "lidl") lidl(sinks, b, st, terrain);
  else pharmacy(sinks, b, kind, st, terrain, wall);
}

// --- Abri à chariots du Lidl ----------------------------------------------------------------------------------------------------------

/**
 * Abri à chariots du Lidl d'après photo : toit plat sombre sur poteaux gris, petits côtés vitrés, grand côté arrière plein avec le panneau Lidl
 * (côté ouvert : le long côté vers `kind.open`), chariots gris emboîtés en deux files, dalle claire.
 */
export function lidlCartShelter(sinks: LandmarkSinks, b: Building, kind: BuildingKind, terrain: HeightField): void {
  const mb = sinks.solid;
  const n = b.ring.length / 2;
  let ux = 1, uy = 0, best = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = b.ring[2 * j]! - b.ring[2 * i]!, dy = b.ring[2 * j + 1]! - b.ring[2 * i + 1]!;
    const l = Math.hypot(dx, dy);
    if (l > best) [best, ux, uy] = [l, dx / l, dy / l];
  }
  const vx = -uy, vy = ux;
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = b.ring[2 * i]!, y = b.ring[2 * i + 1]!;
    const s = x * ux + y * uy, t = x * vx + y * vy;
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
  }
  const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2;
  const cx = ux * sm + vx * tm, cy = uy * sm + vy * tm;
  const hl = (s1 - s0) / 2, hw = (t1 - t0) / 2;
  // Repère centré : s le long du grand côté, o vers le côté ouvert (la normale d'un repère est à droite de sa tangente).
  let ox = vx, oy = vy;
  if (kind.open && kind.open[0] * ox + kind.open[1] * oy < tm) [ox, oy] = [-ox, -oy];
  const sign = uy * ox - ux * oy > 0 ? 1 : -1;
  const f = planeFrame(cx, cy, ux * sign, uy * sign, 2 * hl);
  const z = terrain.heightAt(cx, cy), H = 2.6;
  const STEEL = C("#59636a"), DARK = C("#434c52");
  ground(mb, f, [[-hl, -hw], [-hl, hw], [hl, hw], [hl, -hw]], terrain, 0.04, C("#a9aeb0"));
  box(mb, f, -hl - 0.25, hl + 0.25, -hw - 0.25, hw + 0.25, z + H, z + H + 0.18, DARK, C("#5a6369"), C("#4a5258"));
  // Poteaux : les quatre coins, et le côté ouvert tous les 2,4 m au plus.
  const bays = Math.max(1, Math.round((2 * hl) / 2.4));
  for (let k = 0; k <= bays; k++) {
    const s = -hl + 0.08 + ((2 * hl - 0.16) * k) / bays;
    box(mb, f, s - 0.05, s + 0.05, hw - 0.13, hw - 0.03, z - 0.05, z + H, STEEL);
    if (k === 0 || k === bays) box(mb, f, s - 0.05, s + 0.05, -hw + 0.03, -hw + 0.13, z - 0.05, z + H, STEEL);
  }
  // Fond plein, sombre, avec le panneau Lidl sur sa face intérieure.
  plate(mb, f, -hl, hl, z + 0.3, z + H, -hw + 0.05, DARK);
  vplate(mb, pt(f, hl, -hw + 0.05), pt(f, -hl, -hw + 0.05), z + 0.3, z + 0.3, z + H, z + H, DARK);
  plate(mb, f, -0.7, 0.7, z + 1.2, z + 2.4, -hw + 0.06, BLUE);
  disc(mb, f, 0, z + 1.9, 0.4, -hw + 0.07, RED, 14);
  disc(mb, f, 0, z + 1.9, 0.35, -hw + 0.075, YELLOW, 14);
  label(sinks, f, 0, z + 1.3, 0.16, -hw + 0.08, "LIDL", "#ffffff");
  // Petits côtés vitrés, bandeau sombre au-dessus du côté ouvert, lisse basse.
  for (const dir of [-1, 1]) {
    const a = pt(f, dir * hl, dir < 0 ? -hw : hw), e = pt(f, dir * hl, dir < 0 ? hw : -hw);
    vplate(mb, a, e, z + 0.2, z + 0.2, z + H - 0.05, z + H - 0.05, GLASS_LO, GLASS_HI);
  }
  plate(mb, f, -hl, hl, z + H - 0.45, z + H, hw, DARK);
  plate(mb, f, -hl, hl, z + 0.25, z + 0.33, hw - 0.08, STEEL);
  // Chariots emboîtés en deux files.
  const CART = C("#9aa4a9"), HANDLE = C("#d0d6d9");
  for (const o of [-hw + 1.3, -hw + 2.3]) {
    for (let k = 0; k < 6; k++) {
      const s = -hl + 0.9 + k * 0.34;
      box(mb, f, s - 0.45, s + 0.45, o - 0.27, o + 0.27, z + 0.3, z + 0.85, CART, HANDLE);
      box(mb, f, s + 0.33, s + 0.45, o - 0.27, o + 0.27, z + 0.85, z + 0.98, HANDLE);
    }
  }
}
