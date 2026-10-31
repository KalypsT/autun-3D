import * as THREE from "three";
import type { Arcade, Building, BuildingKind, HeightField, StoreModel, StoreUnit } from "../data/types";
import { arcadePosts, BRICO_PORTAL_O, canopyPosts, carportShape, edgeFrame, GIFI_CANOPY_D, PAVILION_DEPTH, playLayout, playPoint, type EdgeFrame } from "../core/landmarks";
import { hash01, toThree, type MeshBuilder, type Vec3 } from "./geometry";
import type { LandmarkSinks } from "./landmarks";

/**
 * Magasins d'après photo (D143) : le Lidl de Saint-Pantaléon (mur vitré, sas, panneaux perpendiculaires, garde-corps, long mur à casier et zone
 * hachurée) et la pharmacie voisine (galerie à poteaux, vitrage en retrait, bandeau à croix vertes), plus l'abri à chariots du Lidl.
 * D144 : la zone commerciale de Bellevue : Bricomarché (auvent orange, portique), Intermarché (lames rouges, store du Drive, abris solaires),
 * But (bloc central, auvent, enseigne carrée) et Jardinerie d'Autun (pavillons vitrés à pignon, bannière).
 * D145 : les galeries marchandes de Bellevue (unités à enseigne, auvent vitré, aires de jeux), GiFi (tour d'entrée orange) et Action (bandeau bleu).
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

// --- Zone commerciale de Bellevue (D144) ---------------------------------------------------------------------------------------------

type P3 = [number, number, number];

/** Face plane de trois ou quatre points (repère local), tournée du côté de `hint` : l'ordre est inversé au besoin (sens direct vu du côté de la normale). */
function face(mb: MeshBuilder, pts: P3[], hint: P3, color: THREE.Color): void {
  const [a, b, c] = pts as [P3, P3, P3];
  let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  const ordered = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0 ? [...pts].reverse() : pts;
  if (ordered !== pts) { nx = -nx; ny = -ny; nz = -nz; }
  const v = ordered.map((p) => toThree(p[0], p[1], p[2])) as Vec3[];
  const n = toThree(nx, ny, nz);
  if (v.length === 3) mb.tri(v[0]!, v[1]!, v[2]!, n, color);
  else mb.quad(v[0]!, v[1]!, v[2]!, v[3]!, n, color);
}

/** Poteau carré de demi-côté `hw` centré en (x, y), de z0 à z1. */
function post(mb: MeshBuilder, x: number, y: number, z0: number, z1: number, hw: number, color: THREE.Color): void {
  box(mb, planeFrame(x - hw, y + hw, 1, 0, 2 * hw), 0, 2 * hw, 0, 2 * hw, z0, z1, color, color);
}

/** Vitrage à meneaux : baies de `bay` mètres, montants et traverse de la couleur du cadre, de z + 0,05 à z + h. */
function storefront(sinks: LandmarkSinks, f: EdgeFrame, zg: (s: number, o?: number) => number, g0: number, g1: number, h: number, bay: number, frame: THREE.Color, lit: number, o = 0.05): void {
  const mb = sinks.solid;
  const bays = Math.max(1, Math.round((g1 - g0) / bay));
  for (let k = 0; k < bays; k++) {
    const s0 = g0 + ((g1 - g0) * k) / bays, s1 = g0 + ((g1 - g0) * (k + 1)) / bays, z = zg((s0 + s1) / 2);
    glass(sinks, f, s0 + 0.05, s1 - 0.05, z + 0.05, z + h, o, lit);
    plate(mb, f, s0 + 0.04, s1 - 0.04, z + h - 0.12, z + h, o + 0.02, frame);
  }
  for (let k = 0; k <= bays; k++) {
    const s = g0 + ((g1 - g0) * k) / bays, z = zg(s);
    plate(mb, f, s - 0.06, s + 0.06, z, z + h + 0.02, o + 0.02, frame);
  }
}

/** Porte coulissante centrale : deux vantaux de verre plus clair dans un cadre, de largeur w, centrés en c. */
function slidingDoor(sinks: LandmarkSinks, f: EdgeFrame, zg: (s: number, o?: number) => number, c: number, w: number, h: number, frame: THREE.Color, o: number): void {
  const z = zg(c);
  plate(sinks.solid, f, c - w / 2, c + w / 2, z, z + h, o, frame);
  glass(sinks, f, c - w / 2 + 0.08, c - 0.04, z + 0.05, z + h - 0.1, o + 0.02, 1);
  glass(sinks, f, c + 0.04, c + w / 2 - 0.08, z + 0.05, z + h - 0.1, o + 0.02, 1);
}

/** Socle de béton sur tout le tour (hauteur 40 cm). */
function socle(mb: MeshBuilder, b: Building, terrain: HeightField): void {
  const n = b.ring.length / 2;
  for (let i = 0; i < n; i++) {
    const fi = edgeFrame(b.ring, i);
    if (fi.len <= 2) continue;
    const a: P2 = [fi.x, fi.y], e = pt(fi, fi.len, 0), [ox, oy] = [fi.nx * 0.03, fi.ny * 0.03];
    vplate(mb, [a[0] + ox, a[1] + oy], [e[0] + ox, e[1] + oy], terrain.heightAt(a[0], a[1]) - 0.3, terrain.heightAt(e[0], e[1]) - 0.3,
      terrain.heightAt(a[0], a[1]) + 0.4, terrain.heightAt(e[0], e[1]) + 0.4, CONCRETE);
  }
}

// --- Bricomarché ---------------------------------------------------------------------------------------------------------------------

const ANTHRACITE = C("#363a3f");
const ORANGE = C("#e8570f");
const ORANGE_LIGHT = C("#f27a2c");

/**
 * Bricomarché d'après photo : bardage anthracite, mur vitré sous un auvent orange continu sur poteaux fins, portique orange devant les portes
 * coulissantes, enseigne « BRICO MARCHÉ MAISON-JARDIN » au bout du mur, tondeuses autoportées alignées devant, chariots jaunes à droite.
 */
function bricomarche(sinks: LandmarkSinks, b: Building, st: StoreModel, terrain: HeightField): void {
  const mb = sinks.solid;
  const f = edgeFrame(b.ring, st.e);
  const zg = (s: number, o = 0): number => terrain.heightAt(...pt(f, s, o));
  socle(mb, b, terrain);
  const [g0, g1] = st.glass;
  storefront(sinks, f, zg, g0, g1, 3.9, 2.4, ANTHRACITE, 0.7);
  if (st.door) {
    const [c, w] = st.door;
    slidingDoor(sinks, f, zg, c, w, 3.2, ANTHRACITE, 0.09);
    // Portique orange libre devant les portes : deux montants et une traverse.
    const zp = zg(c, BRICO_PORTAL_O);
    for (const s of [c - w / 2, c + w / 2]) box(mb, f, s - 0.18, s + 0.18, BRICO_PORTAL_O - 0.18, BRICO_PORTAL_O + 0.18, zp, zp + 4.2, ORANGE, ORANGE_LIGHT);
    box(mb, f, c - w / 2 - 0.18, c + w / 2 + 0.18, BRICO_PORTAL_O - 0.18, BRICO_PORTAL_O + 0.18, zp + 3.6, zp + 4.2, ORANGE, ORANGE_LIGHT, shade(ORANGE, 0.8));
  }
  if (st.canopy) {
    const [s0, s1, d] = st.canopy, zc = zg((s0 + s1) / 2) + 4.7;
    box(mb, f, s0, s1, 0, d, zc, zc + 0.5, ORANGE, ORANGE_LIGHT, C("#d6d3cc"));
    for (const s of canopyPosts(st.canopy)) box(mb, f, s - 0.06, s + 0.06, d - 0.31, d - 0.19, zg(s, d - 0.25) - 0.05, zc, ANTHRACITE);
  }
  if (st.sign) {
    const [s, z] = st.sign, z0 = zg(s) + z;
    label(sinks, f, s - 3.2, z0, 1.0, 0.06, "BRICO", "#aeb3b8");
    label(sinks, f, s + 3.2, z0, 1.0, 0.06, "MARCHÉ", "#e0262e");
    label(sinks, f, s, z0 - 0.5, 0.4, 0.06, "MAISON - JARDIN", "#c4c8cc");
  }
  if (st.display) {
    const [d0, d1] = st.display, k = Math.max(1, Math.floor((d1 - d0) / 4.5));
    for (let i = 0; i < k; i++) {
      const s = d0 + 1.5 + ((d1 - d0 - 3) * i) / Math.max(1, k - 1), z = zg(s, 5);
      const body = i % 3 === 1 ? C("#e8b21a") : i % 3 === 2 ? C("#2b2f33") : C("#d9331f");
      box(mb, f, s - 0.6, s + 0.6, 4.55, 5.45, z + 0.15, z + 0.65, body, shade(body, 1.15));
      box(mb, f, s - 0.55, s + 0.55, 4.6, 5.4, z, z + 0.15, C("#1e2124"));
      box(mb, f, s - 0.3, s + 0.1, 4.65, 5.05, z + 0.65, z + 1.0, C("#26292c"));
    }
    // Chariots jaunes emboîtés à droite de l'entrée, sous l'auvent.
    const [, e1] = st.canopy ?? [0, d1];
    for (const s of [e1 - 2.4, e1 - 4.2]) {
      const z = zg(s, 0.9);
      box(mb, f, s - 0.7, s + 0.7, 0.2, 1.0, z + 0.15, z + 1.0, C("#f0c010"), C("#f7d84a"));
    }
  }
}

// --- Intermarché ---------------------------------------------------------------------------------------------------------------------

const SLAT_RED = C("#c5271c");
const SLAT_DARK = C("#8f1d17");

/**
 * Intermarché d'après photos : murs latéraux noirs, bloc de lames verticales rouges sur la façade sud-ouest, vitrage à meneaux blancs, grande
 * enseigne blanche « Intermarché SUPER » allumée la nuit, store rouge du Drive au coin ouest, abris de parking solaires devant la façade.
 */
function intermarche(sinks: LandmarkSinks, b: Building, st: StoreModel, terrain: HeightField): void {
  const mb = sinks.solid;
  const f = edgeFrame(b.ring, st.e);
  const zg = (s: number, o = 0): number => terrain.heightAt(...pt(f, s, o));
  socle(mb, b, terrain);
  if (st.slats) {
    const [s0, s1] = st.slats, step = 0.3;
    const top = (s: number): number => topAt(b, st.e, s, f.len);
    // Fond sombre, puis une lame sur trois de plus : les lames verticales d'un mètre de large se lisent comme des aplats.
    vplate(mb, pt(f, s0, 0.05), pt(f, s1, 0.05), zg(s0) + 4.2, zg(s1) + 4.2, top(s0) + 0.1, top(s1) + 0.1, SLAT_DARK);
    for (let s = s0 + 0.05; s + 0.2 <= s1; s += step) {
      const sm = s + 0.1;
      vplate(mb, pt(f, s, 0.09), pt(f, s + 0.2, 0.09), zg(sm) + 4.2, zg(sm) + 4.2, top(sm) + 0.1, top(sm) + 0.1, SLAT_RED);
    }
  }
  const [g0, g1] = st.glass;
  const WHITE_FRAME = C("#e4e6e8");
  storefront(sinks, f, zg, g0, g1, 4.1, 2.3, WHITE_FRAME, 0.9, 0.1);
  plate(mb, f, g0, g1, zg((g0 + g1) / 2) + 4.1, zg((g0 + g1) / 2) + 4.3, 0.12, WHITE_FRAME);
  if (st.door) slidingDoor(sinks, f, zg, st.door[0], st.door[1], 3.2, WHITE_FRAME, 0.13);
  if (st.sign) {
    const [s, z] = st.sign, z0 = zg(s) + z;
    plate(mb, f, s - 4.4, s + 4.4, z0, z0 + 1.9, 0.14, C("#f3f1ec"));
    plate(sinks.glow, f, s - 4.4, s + 4.4, z0, z0 + 1.9, 0.145, C("#fff0c8"));
    label(sinks, f, s, z0 + 0.5, 1.15, 0.16, "Intermarché", "#e2231a");
    label(sinks, f, s + 2.4, z0 + 0.08, 0.35, 0.16, "SUPER", "#6b7479");
  }
  if (st.tent) {
    // Store rouge du Drive : quatre poteaux blancs, valance, pyramide ; aligné sur la façade.
    const [cx, cy] = st.tent, h = 3.0;
    const o: P2 = [cx - f.tx * h - f.nx * h, cy - f.ty * h - f.ny * h];
    const ft = planeFrame(o[0], o[1], f.tx, f.ty, 2 * h);
    const z = terrain.heightAt(cx, cy);
    for (const [s, q] of [[0.3, 0.3], [2 * h - 0.3, 0.3], [0.3, 2 * h - 0.3], [2 * h - 0.3, 2 * h - 0.3]] as const) {
      const [x, y] = pt(ft, s, q);
      post(mb, x, y, z, z + 2.5, 0.07, C("#eceeef"));
    }
    const TENT = C("#d9232a"), TENT_DARK = C("#a81a20");
    const corner = (s: number, q: number, dz: number): P3 => [...pt(ft, s, q), z + dz];
    const ring4 = [[0, 0], [2 * h, 0], [2 * h, 2 * h], [0, 2 * h]] as const;
    const apex: P3 = [cx, cy, z + 4.3];
    for (let i = 0; i < 4; i++) {
      const [s0, q0] = ring4[i]!, [s1, q1] = ring4[(i + 1) % 4]!;
      const mx = (s0 + s1) / 2 - h, my = (q0 + q1) / 2 - h;
      face(mb, [corner(s0, q0, 2.7), corner(s1, q1, 2.7), apex], [f.tx * mx + f.nx * my, f.ty * mx + f.ny * my, 1], i % 2 ? TENT : shade(TENT, 1.08));
      face(mb, [corner(s0, q0, 2.25), corner(s1, q1, 2.25), corner(s1, q1, 2.7), corner(s0, q0, 2.7)], [f.tx * mx + f.nx * my, f.ty * mx + f.ny * my, 0], TENT_DARK);
    }
  }
}

const PANEL = C("#2d3a58"), PANEL_EDGE = C("#d5d9dc"), PANEL_UNDER = C("#aab0b4"), PANEL_POST = C("#8d969b");

/** Abris de parking solaires (D144) : dalle de panneaux sombres à plan mesuré (pente de 15 % vers le sud-est), tranche claire, dessous clair, poteaux au bord haut. */
function carports(sinks: LandmarkSinks, st: StoreModel, terrain: HeightField): void {
  const mb = sinks.solid;
  for (const cp of st.carports ?? []) {
    const sh = carportShape(cp);
    const top = sh.corners.map(([x, y]) => [x, y, sh.zAt(x, y)] as P3);
    const bot = top.map(([x, y, z]) => [x, y, z - sh.thick] as P3);
    face(mb, top, [0, 0, 1], PANEL);
    face(mb, [...bot].reverse(), [0, 0, -1], PANEL_UNDER);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, [x0, y0] = top[i]!, [x1, y1] = top[j]!;
      const mx = (x0 + x1) / 2 - cp[0], my = (y0 + y1) / 2 - cp[1];
      face(mb, [top[i]!, top[j]!, bot[j]!, bot[i]!], [mx, my, 0], PANEL_EDGE);
    }
    for (const [x, y] of sh.posts) post(mb, x, y, terrain.heightAt(x, y) - 0.1, sh.zAt(x, y) - sh.thick, 0.14, PANEL_POST);
  }
}

// --- But -----------------------------------------------------------------------------------------------------------------------------

/**
 * But d'Autun d'après photo (magasin ouvert) : façade sud-est avec bloc central anthracite plus haut que les ailes blanches, vitrine et portes
 * sous un auvent sombre à bandeau brun-rouge, enseigne carrée rouge « BUT » et « Cosy », triangles gris sur les ailes. Ni volets ni pylône.
 */
function but(sinks: LandmarkSinks, b: Building, st: StoreModel, terrain: HeightField): void {
  const mb = sinks.solid;
  const f = edgeFrame(b.ring, st.e);
  const zg = (s: number, o = 0): number => terrain.heightAt(...pt(f, s, o));
  const n = b.ring.length / 2;
  socle(mb, b, terrain);
  const top = (s: number): number => topAt(b, st.e, s, f.len);
  const DARK = C("#35383d");
  if (st.block) {
    const [b0, b1] = st.block;
    vplate(mb, pt(f, b0, 0.05), pt(f, b1, 0.05), zg(b0) - 0.2, zg(b1) - 0.2, top(b0), top(b1), DARK);
    // Le bloc central dépasse du toit d'un mètre et de 5,5 m en profondeur (lecture de la photo : plus haut que les ailes).
    const zt = top((b0 + b1) / 2) - 0.1;
    box(mb, f, b0, b1, -5.5, 0.12, zt, zt + 1.0, DARK, shade(DARK, 1.25));
  }
  const [g0, g1] = st.glass;
  storefront(sinks, f, zg, g0, g1, 3.7, 2.1, C("#2c2f33"), 0.85, 0.1);
  if (st.door) slidingDoor(sinks, f, zg, st.door[0], st.door[1], 3.1, C("#2c2f33"), 0.13);
  if (st.canopy) {
    const [s0, s1, d] = st.canopy, zc = zg((s0 + s1) / 2) + 3.95;
    box(mb, f, s0, s1, 0, d, zc, zc + 0.45, C("#2a2d31"), C("#3b3f45"), C("#c9ccce"));
    plate(mb, f, s0, s1, zc + 0.05, zc + 0.38, d + 0.01, C("#7d2b27"));
    for (const s of [s0 + 0.4, s1 - 0.4]) post(mb, pt(f, s, d - 0.2)[0], pt(f, s, d - 0.2)[1], zg(s, d - 0.2) - 0.05, zc, 0.07, C("#2a2d31"));
  }
  if (st.sign) {
    const [s, z] = st.sign, z0 = zg(s) + z;
    plate(mb, f, s - 1.8, s + 1.8, z0, z0 + 1.9, 0.14, C("#d2201e"));
    plate(sinks.glow, f, s - 1.8, s + 1.8, z0, z0 + 1.9, 0.145, C("#ff4f3d"));
    label(sinks, f, s, z0 + 0.82, 0.9, 0.16, "BUT", "#ffffff");
    label(sinks, f, s, z0 + 0.2, 0.42, 0.16, "Cosy", "#ffffff", true);
  }
  // Triangles gris sur les ailes blanches : une pointe au sommet du mur, la base au sol.
  for (const e of st.wings ?? []) {
    const fe = edgeFrame(b.ring, e), len = Math.min(fe.len, 10);
    const a = pt(fe, 0.02, 0.04), c = pt(fe, len, 0.04);
    const z0a = terrain.heightAt(a[0], a[1]) + 0.4, z0c = terrain.heightAt(c[0], c[1]) + 0.4;
    face(mb, [[a[0], a[1], z0a], [c[0], c[1], z0c], [a[0], a[1], b.top[e % n]!]], [fe.nx, fe.ny, 0], C("#9a9ea2"));
  }
}

// --- Jardinerie d'Autun --------------------------------------------------------------------------------------------------------------

const TIMBER = C("#7d6f5d");
const TIMBER_DARK = C("#5d5144");
const CREAM_TRIM = C("#f6f3ea");
const LEAF = C("#3e8e41");

/**
 * Jardinerie d'Autun d'après photos : mur crème en tôle ondulée, bannière blanche à la feuille verte, deux pavillons vitrés à pignon de bois en
 * saillie devant le mur nord-ouest (le grand, avec la porte, à gauche du petit).
 */
function jardinerie(sinks: LandmarkSinks, b: Building, st: StoreModel, terrain: HeightField): void {
  const mb = sinks.solid;
  socle(mb, b, terrain);
  if (st.banner) {
    const [e, s0, s1, z0, z1] = st.banner;
    const fb = edgeFrame(b.ring, e);
    const zb = terrain.heightAt(...pt(fb, (s0 + s1) / 2, 0));
    plate(mb, fb, s0, s1, zb + z0, zb + z1, 0.07, CREAM_TRIM);
    plate(mb, fb, s0, s0 + 0.9, zb + z0, zb + z1, 0.075, C("#8b5a36"));
    plate(mb, fb, s1 - 0.9, s1, zb + z0, zb + z1, 0.075, C("#8b5a36"));
    // Feuille verte posée sur un pot : deux triangles et une petite cuvette.
    const lx = s0 + 2.3, zc = zb + z0 + (z1 - z0) * 0.55;
    face(mb, [[...pt(fb, lx, 0.09), zc - 0.55], [...pt(fb, lx + 0.55, 0.09), zc + 0.1], [...pt(fb, lx, 0.09), zc + 0.7]], [fb.nx, fb.ny, 0], LEAF);
    face(mb, [[...pt(fb, lx, 0.09), zc - 0.55], [...pt(fb, lx, 0.09), zc + 0.7], [...pt(fb, lx - 0.5, 0.09), zc + 0.2]], [fb.nx, fb.ny, 0], shade(LEAF, 1.2));
    plate(mb, fb, lx - 0.4, lx + 0.4, zc - 0.85, zc - 0.55, 0.09, C("#c59a2b"));
    label(sinks, fb, (s0 + s1) / 2 + 1.2, zc - 0.05, 1.0, 0.1, "Jardinerie", "#3b3a2c", true);
    label(sinks, fb, (s0 + s1) / 2 + 1.2, zc - 0.7, 0.55, 0.1, "D'AUTUN", "#2d2d2d");
  }
  const D = PAVILION_DEPTH;
  (st.pavilions ?? []).forEach(([e, s0, s1, eave, ridge], idx) => {
    const fp = edgeFrame(b.ring, e);
    const zg = (s: number, o = 0): number => terrain.heightAt(...pt(fp, s, o));
    const z = zg((s0 + s1) / 2, D) , sm = (s0 + s1) / 2;
    const at3 = (s: number, o: number, dz: number): P3 => [...pt(fp, s, o), z + dz];
    // Façade vitrée (meneaux de bois) et pignon vitré au-dessus.
    storefront(sinks, fp, zg, s0, s1, eave - 0.1, 2.2, TIMBER_DARK, 0.9, D);
    face(mb, [at3(s0, D + 0.02, eave), at3(s1, D + 0.02, eave), at3(sm, D + 0.02, ridge)], [fp.nx, fp.ny, 0], C("#8fb0ba"));
    face(sinks.glow, [at3(s0 + 0.6, D + 0.03, eave + 0.1), at3(s1 - 0.6, D + 0.03, eave + 0.1), at3(sm, D + 0.03, ridge - 0.4)], [fp.nx, fp.ny, 0], C("#ffd89a"));
    // Côtés vitrés.
    for (const [s, dir] of [[s0, -1], [s1, 1]] as const) {
      const a = pt(fp, s, dir < 0 ? 0 : D), c = pt(fp, s, dir < 0 ? D : 0);
      vplate(mb, a, c, z + 0.05, z + 0.05, z + eave - 0.1, z + eave - 0.1, GLASS_LO, GLASS_HI);
    }
    // Toit à deux pans de bois, faîtage perpendiculaire au mur, léger débord devant.
    face(mb, [at3(s0 - 0.2, -0.1, eave), at3(s0 - 0.2, D + 0.3, eave), at3(sm, D + 0.3, ridge), at3(sm, -0.1, ridge)], [-fp.tx * 0.6, -fp.ty * 0.6, 1], TIMBER);
    face(mb, [at3(s1 + 0.2, -0.1, eave), at3(s1 + 0.2, D + 0.3, eave), at3(sm, D + 0.3, ridge), at3(sm, -0.1, ridge)], [fp.tx * 0.6, fp.ty * 0.6, 1], shade(TIMBER, 1.12));
    if (idx === 0 && st.door) {
      const [c, w] = st.door;
      plate(mb, fp, c - w / 2, c + w / 2, zg(c, D), zg(c, D) + 2.6, D + 0.05, C("#2b2f2c"));
      glass(sinks, fp, c - w / 2 + 0.1, c + w / 2 - 0.1, zg(c, D) + 0.05, zg(c, D) + 2.5, D + 0.07, 1);
    }
  });
}

// --- Galeries marchandes de Bellevue, GiFi, Action (D145) ----------------------------------------------------------------------------

const PIER = C("#4a4e54");
const CANOPY_TOP = C("#9fbab4"), CANOPY_UNDER = C("#dde8e5"), CANOPY_GREEN = C("#47674c"), CANOPY_RIB = C("#52705a");
const BOARD = C("#9a6b3a");
const GIFI_ORANGE = C("#e0501c");

/** Dalle horizontale dans le repère (s de s0 à s1, o de o0 à o1), de l'altitude za (en s0) à zb (en s1) : dessus (face vers le haut) ou dessous. */
function slab(mb: MeshBuilder, f: EdgeFrame, s0: number, s1: number, o0: number, o1: number, za: number, zb: number, color: THREE.Color, up: boolean): void {
  const c = [pt(f, s0, o0), pt(f, s0, o1), pt(f, s1, o1), pt(f, s1, o0)];
  const z = [za, za, zb, zb];
  const v = c.map(([x, y], i) => toThree(x, y, z[i]!)) as [Vec3, Vec3, Vec3, Vec3];
  if (up) mb.quad(v[0], v[1], v[2], v[3], [0, 1, 0], color);
  else mb.quad(v[3], v[2], v[1], v[0], [0, -1, 0], color);
}

/**
 * Unités d'une galerie ou d'un magasin : sur chaque unité, vitrine à meneaux et porte coulissante (ou mur plein à porte étroite, ou vitrine condamnée),
 * bandeau d'enseigne coloré avec son nom (allumé la nuit), piles sombres entre les unités (galeries).
 */
function unitFronts(sinks: LandmarkSinks, b: Building, units: StoreUnit[], terrain: HeightField, o: { piers: boolean; glassH: number; signZ: number; signH: number }): void {
  const mb = sinks.solid;
  for (const [e, s0, s1, name, bg, fg, mode = "glass", doorAt] of units) {
    const f = edgeFrame(b.ring, e);
    const zg = (s: number, off = 0): number => terrain.heightAt(...pt(f, s, off));
    const top = (s: number): number => topAt(b, e, s, f.len);
    const w = s1 - s0, mid = (s0 + s1) / 2;
    const FR = C("#2c3034");
    if (o.piers) {
      plate(mb, f, s0, s0 + 0.7, zg(s0) - 0.2, top(s0), 0.05, PIER);
      if (!units.some((u) => u[0] === e && Math.abs(u[1] - s1) < 0.3)) plate(mb, f, s1 - 0.7, s1, zg(s1) - 0.2, top(s1), 0.05, PIER);
    }
    const g0 = s0 + (o.piers ? 0.9 : 0.4), g1 = s1 - (o.piers ? 0.9 : 0.4);
    const dc = s0 + (doorAt ?? w / 2), dw = Math.min(2.6, w - 2);
    if (mode === "glass" && g1 - g0 > 2) {
      storefront(sinks, f, zg, g0, g1, o.glassH, 2.6, FR, 0.85, 0.08);
      if (dw > 1.6) slidingDoor(sinks, f, zg, dc, dw, o.glassH - 0.5, FR, 0.11);
    } else if (mode === "board" && g1 - g0 > 2) {
      plate(mb, f, g0, g1, zg(mid) + 0.05, zg(mid) + o.glassH, 0.08, BOARD);
      for (let s = g0 + 1.1; s < g1 - 0.5; s += 1.1) plate(mb, f, s - 0.03, s + 0.03, zg(s) + 0.05, zg(s) + o.glassH, 0.09, shade(BOARD, 0.75));
    } else if (dw > 1.6) {
      // Mur plein : une porte étroite avec son vitrage.
      slidingDoor(sinks, f, zg, dc, Math.min(2.2, dw), o.glassH - 0.5, FR, 0.1);
    }
    if (bg) {
      const col = C(bg), z0 = zg(mid) + o.signZ;
      plate(mb, f, s0 + (o.piers ? 0.7 : 0.1), s1 - (o.piers ? 0.7 : 0.1), z0, z0 + o.signH, 0.1, col);
      plate(sinks.glow, f, s0 + (o.piers ? 0.9 : 0.3), s1 - (o.piers ? 0.9 : 0.3), z0 + 0.1, z0 + o.signH - 0.1, 0.105, col.clone().lerp(C("#fff3d0"), 0.4));
      if (name) {
        const h = Math.max(0.3, Math.min(0.9, (w - 2.5) / 6.4, o.signH * 0.68));
        label(sinks, f, mid, z0 + (o.signH - h) / 2, h, 0.12, name, fg);
      }
    }
  }
}

/** Auvent vitré continu (D145) : dalle de verre teinté, dessous clair, nervures vertes tous les 6 m, poutre avant verte, poteaux fins verts au bord avant. */
function arcade(mb: MeshBuilder, b: Building, a: Arcade, terrain: HeightField): void {
  const [o0, o1] = a.o;
  for (const run of a.runs) {
    const [e, s0, s1] = run;
    const f = edgeFrame(b.ring, e);
    const za = terrain.heightAt(...pt(f, s0, 0)) + a.z, zb = terrain.heightAt(...pt(f, s1, 0)) + a.z;
    const at = (s: number): number => za + ((zb - za) * (s - s0)) / (s1 - s0);
    slab(mb, f, s0, s1, o0, o1, za, zb, CANOPY_TOP, true);
    slab(mb, f, s0, s1, o0, o1, za - 0.25, zb - 0.25, CANOPY_UNDER, false);
    // Poutre avant (face vers l'extérieur) et nervures posées sur le dessus.
    vplate(mb, pt(f, s0, o1), pt(f, s1, o1), za - 0.3, zb - 0.3, za + 0.05, zb + 0.05, CANOPY_GREEN);
    const posts = arcadePosts(b, { runs: [run], o: a.o, z: a.z });
    posts.forEach(([x, y], i) => {
      const s = s0 + 0.3 + ((s1 - s0 - 0.6) * i) / Math.max(1, posts.length - 1);
      post(mb, x, y, terrain.heightAt(x, y) - 0.05, at(s) - 0.3, 0.07, CANOPY_GREEN);
      if (i > 0 && i < posts.length - 1) slab(mb, f, s - 0.05, s + 0.05, o0, o1, at(s - 0.05) + 0.01, at(s + 0.05) + 0.01, CANOPY_RIB, true);
    });
  }
}

/** Aire de jeux d'un parking (D145) : tapis de caoutchouc vert, tour de jeux à toit vert et toboggan argenté, trampoline enterré, banc rouge. */
function playground(mb: MeshBuilder, p: [number, number, number], terrain: HeightField): void {
  const l = playLayout(p), fr = l.frame;
  const P = (u: number, v: number): [number, number] => playPoint(l, u, v);
  const lay = (pts: [number, number][], lift: number, color: THREE.Color): void => {
    const v = pts.map(([x, y]) => toThree(x, y, terrain.heightAt(x, y) + lift)) as [Vec3, Vec3, Vec3, Vec3];
    mb.quad(v[0], v[1], v[2], v[3], [0, 1, 0], color);
  };
  const [mu, mv] = l.mat;
  lay([P(-mu / 2, -mv / 2), P(mu / 2, -mv / 2), P(mu / 2, mv / 2), P(-mu / 2, mv / 2)].reverse(), 0.06, C("#5da06f"));
  // Trampoline : disque sombre cerclé de gris, au ras du sol.
  const [tu, tv, tr] = l.trampoline;
  const ring = (r: number, lift: number, color: THREE.Color): void => {
    const [cx, cy] = P(tu, tv), z = terrain.heightAt(cx, cy) + lift;
    for (let i = 0; i < 10; i++) {
      const a0 = (2 * Math.PI * i) / 10, a1 = (2 * Math.PI * (i + 1)) / 10;
      mb.tri(toThree(cx, cy, z), toThree(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z), toThree(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z), [0, 1, 0], color);
    }
  };
  ring(tr, 0.075, C("#8f979b"));
  ring(tr * 0.75, 0.09, C("#2f3a36"));
  // Repère (s = u, o vers la droite = -v) pour les pavés.
  const f = planeFrame(fr.x, fr.y, fr.ux, fr.uy, mu);
  const [wu, wv] = l.tower, z = terrain.heightAt(...P(wu, wv));
  const GREEN = C("#2f9a54"), WOOD_BROWN = C("#7a5a3c");
  for (const [du, dv] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) box(mb, f, wu + du - 0.06, wu + du + 0.06, -(wv + dv) - 0.06, -(wv + dv) + 0.06, z, z + 2.1, WOOD_BROWN);
  box(mb, f, wu - 0.7, wu + 0.7, -(wv + 0.7), -(wv - 0.7), z + 1.1, z + 1.2, WOOD_BROWN);
  box(mb, f, wu - 0.8, wu + 0.8, -(wv + 0.8), -(wv - 0.8), z + 2.1, z + 2.3, GREEN, shade(GREEN, 1.15));
  // Toboggan : plan incliné du plancher au sol, deux rebords.
  const [su, sv, sl] = l.slide;
  const sp = (u: number, off: number, dz: number): P3 => [...P(u, sv + off), terrain.heightAt(...P(u, sv + off)) + dz];
  face(mb, [sp(su, -0.25, 1.15), sp(su, 0.25, 1.15), sp(su + sl, 0.25, 0.12), sp(su + sl, -0.25, 0.12)], [0, 0, 1], C("#b2bac0"));
  for (const sd of [-0.25, 0.25]) face(mb, [sp(su, sd, 1.15), sp(su, sd, 1.4), sp(su + sl, sd, 0.4), sp(su + sl, sd, 0.12)], [fr.vx * sd, fr.vy * sd, 0], C("#8f989e"));
  // Banc rouge.
  const [bu, bv] = l.bench, zb = terrain.heightAt(...P(bu, bv));
  box(mb, f, bu - 0.8, bu + 0.8, -(bv + 0.2), -(bv - 0.2), zb + 0.4, zb + 0.5, C("#c0392b"), C("#d9503f"));
  box(mb, f, bu - 0.7, bu - 0.6, -(bv + 0.15), -(bv - 0.15), zb, zb + 0.4, FRAME);
  box(mb, f, bu + 0.6, bu + 0.7, -(bv + 0.15), -(bv - 0.15), zb, zb + 0.4, FRAME);
}

/** Galerie marchande : bardage bois miel entre des piles anthracite, bandeaux d'enseigne par unité, auvent vitré, aires de jeux. */
function galerie(sinks: LandmarkSinks, b: Building, st: StoreModel, terrain: HeightField): void {
  socle(sinks.solid, b, terrain);
  unitFronts(sinks, b, st.units ?? [], terrain, { piers: true, glassH: 3.5, signZ: 3.75, signH: 1.35 });
  if (st.arcade) arcade(sinks.solid, b, st.arcade, terrain);
  for (const p of st.play ?? []) playground(sinks.solid, p, terrain);
}

/** GiFi d'après photo : bardage gris à bande haute claire, tour d'entrée orange à enseigne « GiFi » et auvent bas sur deux poteaux, vitrage de part et d'autre. */
function gifi(sinks: LandmarkSinks, b: Building, st: StoreModel, terrain: HeightField): void {
  const mb = sinks.solid;
  const n = b.ring.length / 2;
  const f = edgeFrame(b.ring, st.e);
  const zg = (s: number, o = 0): number => terrain.heightAt(...pt(f, s, o));
  socle(mb, b, terrain);
  for (let i = 0; i < n; i++) band(mb, b, i, terrain, 4.7, C("#c9cdd0"));
  const [g0, g1] = st.glass;
  storefront(sinks, f, zg, g0, g1, 3.2, 2.4, C("#33383c"), 0.8, 0.08);
  if (st.tower) {
    const [c, w, h] = st.tower, z = zg(c, 1.2), D = GIFI_CANOPY_D;
    box(mb, f, c - w / 2, c + w / 2, 0, 1.2, zg(c) - 0.3, zg(c) + h, GIFI_ORANGE, shade(GIFI_ORANGE, 1.15));
    plate(mb, f, c - w / 2, c + w / 2, zg(c) + h - 1.5, zg(c) + h - 1.1, 1.22, C("#ffd23a"));
    plate(sinks.glow, f, c - w / 2 + 0.3, c + w / 2 - 0.3, zg(c) + h - 3.6, zg(c) + h - 1.7, 1.225, C("#ff8a4a"));
    label(sinks, f, c, zg(c) + h - 3.4, 1.0, 1.23, "GiFi", "#ffffff");
    const dw = st.door?.[1] ?? 4.8;
    slidingDoor(sinks, f, zg, c, dw, 2.9, C("#33383c"), 1.24);
    // Auvent d'entrée bas, orange, sur deux poteaux fins.
    box(mb, f, c - dw / 2 - 0.8, c + dw / 2 + 0.8, 1.2, D, z + 3.3, z + 3.55, GIFI_ORANGE, shade(GIFI_ORANGE, 1.15), C("#d6d3cc"));
    for (const s of [c - dw / 2 - 0.4, c + dw / 2 + 0.4]) box(mb, f, s - 0.07, s + 0.07, D - 0.27, D - 0.13, zg(s, D - 0.2) - 0.05, z + 3.3, C("#33383c"));
  }
}

/** Action d'après photo : bandeau d'enseigne bleu au bout sud-ouest, entrée sous l'enseigne, puis des vitrines dont une condamnée par une planche. */
function action(sinks: LandmarkSinks, b: Building, st: StoreModel, terrain: HeightField): void {
  socle(sinks.solid, b, terrain);
  unitFronts(sinks, b, st.units ?? [], terrain, { piers: false, glassH: 3.3, signZ: 3.9, signH: 1.5 });
}

/** Entrée de la tuile : dessine le magasin d'après photo de ce bâtiment. */
export function buildStore(sinks: LandmarkSinks, b: Building, kind: BuildingKind, terrain: HeightField, wall: THREE.Color): void {
  const st = kind.store;
  if (!st) return;
  switch (st.style) {
    case "lidl": lidl(sinks, b, st, terrain); break;
    case "pharmacy": pharmacy(sinks, b, kind, st, terrain, wall); break;
    case "bricomarche": bricomarche(sinks, b, st, terrain); break;
    case "intermarche": intermarche(sinks, b, st, terrain); break;
    case "but": but(sinks, b, st, terrain); break;
    case "jardinerie": jardinerie(sinks, b, st, terrain); break;
    case "galerie": galerie(sinks, b, st, terrain); break;
    case "gifi": gifi(sinks, b, st, terrain); break;
    case "action": action(sinks, b, st, terrain); break;
  }
  carports(sinks, st, terrain);
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
