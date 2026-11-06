import * as THREE from "three";
import type { HeightField, RampartLook, RampartTower } from "../data/types";
import { octagon, rampartSides, RAMPART_THICK, towerArc, type ProfiledWall } from "../core/ramparts";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";

/**
 * Remparts (D250 : forme mesurée ; D253 : aspect). Chaque face descend sous le sol de son côté et monte au sommet mesuré ; un mur de
 * soutènement n'a donc que son parapet côté ville et toute sa hauteur côté extérieur.
 *
 * Aspect, d'après les photos de l'utilisateur (docs/plans/remparts.md, §1 bis) : la face est découpée en blocs (assises horizontales alignées
 * d'un segment à l'autre, joints décalés d'une assise à la suivante), chacun d'une teinte de la palette de son type ; une bande plus sombre au
 * pied (remontées d'humidité) ; des plaques de lierre pendant du haut de la face la plus haute ; un chaperon sur le dessus ; une haie sur les
 * murs noyés dans les jardins.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);

interface LookSpec {
  /** Teintes des blocs. */
  palette: THREE.Color[];
  /** Hauteur d'une assise et largeur visée d'un bloc (m). */
  course: number;
  block: number;
  /** Dessus du mur. */
  cap: THREE.Color;
  /** Part des segments qui portent une plaque de lierre. */
  ivy: number;
  /** Haie sur le dessus (mur de jardin). */
  hedge: boolean;
}

const LOOKS: Record<RampartLook, LookSpec> = {
  // Moellons gris-brun irréguliers, plaques de lierre, chaperon clair (boulevard des Résistants Fusillés, photos 1 à 3).
  rubble: { palette: [C("#8e8a83"), C("#99948b"), C("#86827b"), C("#a09a90"), C("#928d85")], course: 0.6, block: 1.5, cap: C("#d4cec0"), ivy: 0.3, hedge: false },
  // Petit appareil beige restauré, en lits réguliers (rue de la Maladière, photos 7 et 8).
  restored: { palette: [C("#cbbd9d"), C("#c4b594"), C("#d1c4a6"), C("#bfb08f")], course: 0.5, block: 1.4, cap: C("#b3a07c"), ivy: 0.08, hedge: false },
  // Restauré récemment, très clair et uniforme (boulevard Laureau, photos 11 et 12).
  bright: { palette: [C("#e1d4b2"), C("#dacdaa"), C("#e6dabb")], course: 0.55, block: 2.0, cap: C("#d6c9a6"), ivy: 0, hedge: false },
  // Plaquettes de schiste brun foncé posées à plat, herbe et arbustes au sommet (rue du Vieux Colombier, photos 9 et 10).
  schist: { palette: [C("#6d655c"), C("#776e62"), C("#655d55"), C("#7e7468"), C("#6a6259")], course: 0.4, block: 1.2, cap: C("#6d7a4b"), ivy: 0.06, hedge: false },
  // Mur bas de moellons sous les jardins, couvertine enduite et haie au-dessus (rue Gaston Joliet, photos 13 et 14).
  garden: { palette: [C("#9c9284"), C("#a69c8d"), C("#928879")], course: 0.5, block: 1.4, cap: C("#e2ded3"), ivy: 0.1, hedge: true },
};

/** Enfoncement du pied des faces sous le sol (m) : pas de jour entre le mur et un relief à mailles de 1 m. */
const SINK = 0.4;
/** Bande sombre au pied (m) et son assombrissement. */
const DAMP = 0.6, DAMP_K = 0.8;
/** Décollement des plaques de lierre (m) et leurs teintes. */
const IVY_OFF = 0.05;
/** Ouvertures sombres (barbacanes). */
const HOLE_DARK = C("#2f2a24");
/** Chute maximale d'une plaque de lierre (m) ; pas de lierre sur un segment dont le sommet varie de plus de IVY_SLOPE m. */
const IVY_DROP = 3, IVY_SLOPE = 1;
const IVY = [C("#42583a"), C("#4d6640"), C("#3a4f33")];
/** Lanières d'une plaque de lierre. */
const IVY_STRIPS = 5;
/** Haie des murs de jardin : hauteur et demi-largeur (m). */
const HEDGE_H = 1.2, HEDGE_HW = 0.45;

/** Entier pseudo-aléatoire stable (identifiant du mur, segment, colonne, assise). */
function hash(a: number, b: number, c: number, d: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface RampartSinks {
  solid: MeshBuilder;
  cap: MeshBuilder;
  /** Teinte des haies du jeu (celle des haies OSM). */
  hedgeColor: THREE.Color;
}

/** Le mur `w` (profil mesuré) dans `sinks`, posé sur `terrain`. */
export function buildRampart(sinks: RampartSinks, w: ProfiledWall, terrain: HeightField): void {
  const look = LOOKS[w.look && w.look !== "mesh" ? w.look : "rubble"];
  const { left, right } = rampartSides(w);
  const n = w.top.length;
  // Pied de chaque face, sous le sol de son côté (relief ou sol mesuré, le plus bas).
  const footL: number[] = [], footR: number[] = [];
  for (let k = 0; k < n; k++) {
    footL.push(Math.min(terrain.heightAt(left[2 * k]!, left[2 * k + 1]!), w.gl[k]!) - SINK);
    footR.push(Math.min(terrain.heightAt(right[2 * k]!, right[2 * k + 1]!), w.gr[k]!) - SINK);
  }
  const id = Math.abs(w.id);
  for (let i = 0; i + 1 < n; i++) {
    const j = i + 1;
    const dx = w.pts[2 * j]! - w.pts[2 * i]!, dy = w.pts[2 * j + 1]! - w.pts[2 * i + 1]!;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    const nx = dy / len, ny = -dx / len; // normale droite
    const ti = w.top[i]!, tj = w.top[j]!;
    // Face droite (de i à j), face gauche (de j à i, pour qu'elle regarde à gauche).
    const rightFace: Face = { ax: right[2 * i]!, ay: right[2 * i + 1]!, bx: right[2 * j]!, by: right[2 * j + 1]!, fa: footR[i]!, fb: footR[j]!, ta: ti, tb: tj, nx, ny };
    const leftFace: Face = { ax: left[2 * j]!, ay: left[2 * j + 1]!, bx: left[2 * i]!, by: left[2 * i + 1]!, fa: footL[j]!, fb: footL[i]!, ta: tj, tb: ti, nx: -nx, ny: -ny };
    blocks(sinks.solid, look, rightFace, len, id, i * 2);
    blocks(sinks.solid, look, leftFace, len, id, i * 2 + 1);
    // Lierre sur la face la plus haute (le côté extérieur d'un mur de soutènement).
    const high = ti - rightFace.fa + tj - rightFace.fb >= ti - leftFace.fb + tj - leftFace.fa ? rightFace : leftFace;
    if (hash(id, i, 7, 7) < look.ivy && Math.abs(ti - tj) < IVY_SLOPE) ivy(sinks.solid, high, id, i);
    // Trous d'écoulement (barbacanes) au pied de la face haute d'un mur de soutènement (photo 10, D255).
    weepHoles(sinks.solid, high, len, id, i);
    // Dessus.
    const L = (k: number, z: number): Vec3 => toThree(left[2 * k]!, left[2 * k + 1]!, z);
    const R = (k: number, z: number): Vec3 => toThree(right[2 * k]!, right[2 * k + 1]!, z);
    sinks.cap.quad(R(i, ti), R(j, tj), L(j, tj), L(i, ti), [0, 1, 0], look.cap);
    if (look.hedge) hedge(sinks.solid, sinks.hedgeColor, w, i, j, ti, tj, nx, ny);
  }
  // Bouts : de la face gauche à la face droite au départ, l'inverse à l'arrivée.
  const p = w.pts, m = p.length;
  const end = (k: number, tx: number, ty: number, first: boolean): void => {
    const zb = Math.min(footL[k]!, footR[k]!), zt = w.top[k]!;
    const a: Face = first
      ? { ax: left[2 * k]!, ay: left[2 * k + 1]!, bx: right[2 * k]!, by: right[2 * k + 1]!, fa: zb, fb: zb, ta: zt, tb: zt, nx: tx, ny: ty }
      : { ax: right[2 * k]!, ay: right[2 * k + 1]!, bx: left[2 * k]!, by: left[2 * k + 1]!, fa: zb, fb: zb, ta: zt, tb: zt, nx: tx, ny: ty };
    blocks(sinks.solid, look, a, RAMPART_THICK, id, first ? -1 : -2);
  };
  const d0 = Math.hypot(p[2]! - p[0]!, p[3]! - p[1]!) || 1, d1 = Math.hypot(p[m - 2]! - p[m - 4]!, p[m - 1]! - p[m - 3]!) || 1;
  end(0, -(p[2]! - p[0]!) / d0, -(p[3]! - p[1]!) / d0, true);
  end(n - 1, (p[m - 2]! - p[m - 4]!) / d1, (p[m - 1]! - p[m - 3]!) / d1, false);
}

/** Une face plane verticale de a à b : pied et sommet à chaque bout, normale (nx, ny). */
interface Face {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  fa: number;
  fb: number;
  ta: number;
  tb: number;
  nx: number;
  ny: number;
}

/** Blocs d'une face : assises alignées en altitude absolue, joints verticaux décalés d'une assise sur deux, bande sombre au pied. */
function blocks(mb: MeshBuilder, look: LookSpec, f: Face, len: number, id: number, seg: number): void {
  const zLow = Math.min(f.fa, f.fb), zHigh = Math.max(f.ta, f.tb);
  if (zHigh - zLow < 0.01) return;
  const cols = Math.max(1, Math.round(len / look.block));
  const n = toThree(f.nx, f.ny, 0);
  const footMax = Math.max(f.fa, f.fb) + SINK;
  const first = Math.floor(zLow / look.course);
  for (let r = first; r * look.course < zHigh; r++) {
    const z0 = r * look.course, z1 = z0 + look.course;
    const shift = r % 2 ? 0.5 : 0;
    const cuts = [0];
    for (let k = 0; k < cols; k++) {
      const u = (k + shift) / cols;
      if (u > 1e-3 && u < 1 - 1e-3) cuts.push(u);
    }
    cuts.push(1);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const u0 = cuts[k]!, u1 = cuts[k + 1]!;
      // Pied et sommet de la face, interpolés le long du segment ; l'assise est coupée dedans.
      const lo0 = f.fa + (f.fb - f.fa) * u0, lo1 = f.fa + (f.fb - f.fa) * u1;
      const hi0 = f.ta + (f.tb - f.ta) * u0, hi1 = f.ta + (f.tb - f.ta) * u1;
      const a0 = Math.min(Math.max(z0, lo0), hi0), a1 = Math.min(Math.max(z0, lo1), hi1);
      const b0 = Math.min(Math.max(z1, lo0), hi0), b1 = Math.min(Math.max(z1, lo1), hi1);
      if (b0 - a0 < 1e-3 && b1 - a1 < 1e-3) continue;
      const h = hash(id, seg, k, r);
      const col = look.palette[Math.floor(h * look.palette.length)]!.clone().multiplyScalar(0.98 + 0.04 * hash(id, seg, k, r + 991));
      if (z1 <= footMax + DAMP) col.multiplyScalar(DAMP_K);
      const P = (u: number, z: number): Vec3 => toThree(f.ax + (f.bx - f.ax) * u, f.ay + (f.by - f.ay) * u, z);
      mb.quad(P(u0, a0), P(u1, a1), P(u1, b1), P(u0, b0), n, col);
    }
  }
}

/** Barbacanes : petites ouvertures sombres à 70 cm au-dessus du sol, tous les 2 m environ, sur une face de plus de 2,5 m. */
const WEEP_Z = 0.7, WEEP_W = 0.16, WEEP_H = 0.22, WEEP_EVERY = 2.0, WEEP_MIN = 2.5;
function weepHoles(mb: MeshBuilder, f: Face, len: number, id: number, seg: number): void {
  const n = Math.max(1, Math.round(len / WEEP_EVERY));
  for (let k = 0; k < n; k++) {
    if (hash(id, seg, k, 41) < 0.25) continue;
    const u = (k + 0.5) / n;
    const foot = f.fa + (f.fb - f.fa) * u + SINK, top = f.ta + (f.tb - f.ta) * u;
    if (top - foot < WEEP_MIN) continue;
    const L = len || 1, du = WEEP_W / 2 / L, z = foot + WEEP_Z;
    const P = (uu: number, zz: number): Vec3 => toThree(f.ax + (f.bx - f.ax) * uu + f.nx * 0.02, f.ay + (f.by - f.ay) * uu + f.ny * 0.02, zz);
    mb.quad(P(u - du, z), P(u + du, z), P(u + du, z + WEEP_H), P(u - du, z + WEEP_H), toThree(f.nx, f.ny, 0), HOLE_DARK);
  }
}

/** Plaque de lierre qui pend du haut de la face, bord bas déchiqueté (lanières de hauteurs différentes). */
function ivy(mb: MeshBuilder, f: Face, id: number, seg: number): void {
  const w = 0.15 + 0.25 * hash(id, seg, 1, 3), c = 0.1 + (0.8 - w) * hash(id, seg, 2, 3);
  const n = toThree(f.nx, f.ny, 0);
  const off = (u: number): [number, number] => [f.ax + (f.bx - f.ax) * u + f.nx * IVY_OFF, f.ay + (f.by - f.ay) * u + f.ny * IVY_OFF];
  for (let k = 0; k < IVY_STRIPS; k++) {
    const u0 = c + (w * k) / IVY_STRIPS, u1 = c + (w * (k + 1)) / IVY_STRIPS;
    const t0 = f.ta + (f.tb - f.ta) * u0, t1 = f.ta + (f.tb - f.ta) * u1;
    const f0 = f.fa + (f.fb - f.fa) * u0, f1 = f.fa + (f.fb - f.fa) * u1;
    const frac = 0.25 + 0.5 * hash(id, seg, k, 5);
    const b0 = t0 - Math.min((t0 - f0 - SINK) * frac, IVY_DROP), b1 = t1 - Math.min((t1 - f1 - SINK) * frac, IVY_DROP);
    if (t0 - b0 < 0.2) continue;
    const [x0, y0] = off(u0), [x1, y1] = off(u1);
    const col = IVY[Math.floor(hash(id, seg, k, 6) * IVY.length)]!;
    mb.quad(toThree(x0, y0, b0), toThree(x1, y1, b1), toThree(x1, y1, t1 - 0.05), toThree(x0, y0, t0 - 0.05), n, col);
  }
}

/** Haie sur le dessus d'un mur de jardin : un volume vert, côtés et dessus. */
function hedge(mb: MeshBuilder, color: THREE.Color, w: ProfiledWall, i: number, j: number, ti: number, tj: number, nx: number, ny: number): void {
  const ax = w.pts[2 * i]!, ay = w.pts[2 * i + 1]!, bx = w.pts[2 * j]!, by = w.pts[2 * j + 1]!;
  const P = (x: number, y: number, s: number, z: number): Vec3 => toThree(x + nx * s, y + ny * s, z);
  const top = color.clone().multiplyScalar(1.1);
  mb.quad(P(ax, ay, HEDGE_HW, ti), P(bx, by, HEDGE_HW, tj), P(bx, by, HEDGE_HW, tj + HEDGE_H), P(ax, ay, HEDGE_HW, ti + HEDGE_H), toThree(nx, ny, 0), color);
  mb.quad(P(bx, by, -HEDGE_HW, tj), P(ax, ay, -HEDGE_HW, ti), P(ax, ay, -HEDGE_HW, ti + HEDGE_H), P(bx, by, -HEDGE_HW, tj + HEDGE_H), toThree(-nx, -ny, 0), color);
  mb.quad(P(ax, ay, HEDGE_HW, ti + HEDGE_H), P(bx, by, HEDGE_HW, tj + HEDGE_H), P(bx, by, -HEDGE_HW, tj + HEDGE_H), P(ax, ay, -HEDGE_HW, ti + HEDGE_H), [0, 1, 0], top);
}

// --- Tours (lot 3, D254) ----------------------------------------------------------------------------------------------------------------

/** Tour ronde (photos du boulevard Mac Mahon et du boulevard des Résistants Fusillés) : socle plus large en bas, cordon vers le tiers de la
 * hauteur, petits trous de boulin. */
const PLINTH_H = 1.4, PLINTH_OUT = 0.3, CORDON_AT = 0.4, CORDON_H = 0.22, CORDON_OUT = 0.08;
const HOLE = C("#3a332b"), CORDON = C("#b9ad97");
/** Tour des Ursulines (photo de l'utilisateur, 11 et 10 boulevard Mac Mahon, LiDAR) : moellons beige-brun, chaînes d'angle claires, pied
 * élargi, fenêtre double romane sous un arc, balustrade claire, toit de zinc, Vierge blanche aux bras ouverts. */
const URSULINES: LookSpec = { palette: [C("#9c8d76"), C("#a5957d"), C("#92846f"), C("#ac9c83")], course: 0.5, block: 1.3, cap: C("#6b7074"), ivy: 0, hedge: false };
const QUOIN = C("#cfc3a6"), ZINC = C("#62686c"), RAIL = C("#d8cfbb"), STATUE = C("#ebe7dc"), DARK = C("#2c2722");
const BATTER_H = 3.5, BATTER_OUT = 0.45, STATUE_H = 4.5;

/** Les tours de la tuile. */
export function buildTowers(sinks: RampartSinks, towers: readonly RampartTower[], terrain: HeightField): void {
  for (const t of towers) {
    if (t.k === "ursulines") buildUrsulines(sinks.solid, t, terrain);
    else buildRoundTower(sinks, t, terrain);
  }
}

/** Faces verticales le long d'un contour (points, normales extérieures par segment), de `foot(x, y)` à `top`, en blocs ; rend les faces. */
function ringFaces(mb: MeshBuilder, look: LookSpec, pts: number[], closed: boolean, foot: (x: number, y: number) => number, z0: number | null, top: number, id: number, salt: number, grow = 0, cx = 0, cy = 0): Face[] {
  const n = pts.length / 2, out: Face[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    let ax = pts[2 * i]!, ay = pts[2 * i + 1]!, bx = pts[2 * j]!, by = pts[2 * j + 1]!;
    if (grow) {
      const ga = grow / (Math.hypot(ax - cx, ay - cy) || 1), gb = grow / (Math.hypot(bx - cx, by - cy) || 1);
      ax += (ax - cx) * ga; ay += (ay - cy) * ga; bx += (bx - cx) * gb; by += (by - cy) * gb;
    }
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-3) continue;
    const nx = (by - ay) / len, ny = -(bx - ax) / len;
    // Normale vers l'extérieur du contour (côté opposé au centre).
    const out1 = (ax + bx) / 2 - cx, out2 = (ay + by) / 2 - cy;
    const s = nx * out1 + ny * out2 >= 0 ? 1 : -1;
    const f: Face = { ax, ay, bx, by, fa: z0 ?? foot(ax, ay), fb: z0 ?? foot(bx, by), ta: top, tb: top, nx: nx * s, ny: ny * s };
    blocks(mb, look, f, len, id, salt * 100 + i);
    out.push(f);
  }
  return out;
}

/** Dessus plat d'un contour (éventail depuis le centre). */
function fan(mb: MeshBuilder, pts: number[], cx: number, cy: number, z: number, col: THREE.Color, closed: boolean): void {
  const n = pts.length / 2;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    mb.tri(toThree(cx, cy, z), toThree(pts[2 * i]!, pts[2 * i + 1]!, z), toThree(pts[2 * j]!, pts[2 * j + 1]!, z), [0, 1, 0], col);
  }
}

function buildRoundTower(sinks: RampartSinks, t: RampartTower, terrain: HeightField): void {
  const look = LOOKS[t.look];
  const { pts } = towerArc(t);
  const id = Math.abs(t.id), top = t.top ?? t.base + 6;
  const foot = (x: number, y: number): number => Math.min(terrain.heightAt(x, y), t.base) - SINK;
  // Fût, socle, cordon.
  const faces = ringFaces(sinks.solid, look, pts, false, foot, null, top, id, 1, 0, t.x, t.y);
  const plinth = ringFaces(sinks.solid, look, pts, false, foot, null, t.base + PLINTH_H, id, 2, PLINTH_OUT, t.x, t.y);
  const zc = t.base + (top - t.base) * CORDON_AT;
  for (const f of ringFaces(new MeshBuilder(), look, pts, false, foot, zc, zc + CORDON_H, id, 3, CORDON_OUT, t.x, t.y)) {
    sinks.solid.quad(toThree(f.ax, f.ay, zc), toThree(f.bx, f.by, zc), toThree(f.bx, f.by, zc + CORDON_H), toThree(f.ax, f.ay, zc + CORDON_H), toThree(f.nx, f.ny, 0), CORDON);
  }
  // Rebord du socle (dessus du ressaut).
  for (const f of plinth) {
    const k = PLINTH_OUT / ((Math.hypot(f.ax - t.x, f.ay - t.y) || 1));
    const ix = f.ax - (f.ax - t.x) * k, iy = f.ay - (f.ay - t.y) * k, jx = f.bx - (f.bx - t.x) * k, jy = f.by - (f.by - t.y) * k;
    const z = t.base + PLINTH_H;
    sinks.solid.quad(toThree(ix, iy, z), toThree(jx, jy, z), toThree(f.bx, f.by, z), toThree(f.ax, f.ay, z), [0, 1, 0], look.cap);
  }
  // Trous de boulin : trois rangs, un segment sur trois.
  for (const [k, f] of faces.entries()) {
    if (k % 3 !== 1) continue;
    for (const h of [0.25, 0.55, 0.8]) {
      const z = t.base + (top - t.base) * h, u0 = 0.4, u1 = 0.55;
      const P = (u: number, zz: number): Vec3 => toThree(f.ax + (f.bx - f.ax) * u + f.nx * 0.02, f.ay + (f.by - f.ay) * u + f.ny * 0.02, zz);
      sinks.solid.quad(P(u0, z), P(u1, z), P(u1, z + 0.2), P(u0, z + 0.2), toThree(f.nx, f.ny, 0), HOLE);
    }
  }
  // Lierre sur une tour sur trois (photo 8), dessus.
  if (hash(id, 0, 9, 9) < 0.35 && faces.length > 4) ivy(sinks.solid, faces[Math.floor(faces.length / 2)]!, id, 99);
  fan(sinks.cap, pts, t.x, t.y, top, look.cap, false);
  // Corde (côté mur), au cas où le mur serait plus bas que la tour.
  const n = pts.length / 2;
  const chord: Face = { ax: pts[2 * n - 2]!, ay: pts[2 * n - 1]!, bx: pts[0]!, by: pts[1]!, fa: t.base, fb: t.base, ta: top, tb: top, nx: -(t.nx ?? 0), ny: -(t.ny ?? 1) };
  blocks(sinks.solid, look, chord, Math.hypot(chord.bx - chord.ax, chord.by - chord.ay), id, 999);
}

/** Prisme (ou tronc de pyramide) régulier vertical à `sides` côtés, de rayon r0 en z0 à r1 en z1, avec son dessus. */
function prism(mb: MeshBuilder, cx: number, cy: number, sides: number, r0: number, r1: number, z0: number, z1: number, rot: number, col: THREE.Color, capCol: THREE.Color | null = col): void {
  for (let i = 0; i < sides; i++) {
    const a = rot + (2 * Math.PI * i) / sides, b = rot + (2 * Math.PI * (i + 1)) / sides, m = (a + b) / 2;
    const p = (r: number, ang: number, z: number): Vec3 => toThree(cx + r * Math.sin(ang), cy + r * Math.cos(ang), z);
    const nz = (r0 - r1) / Math.max(z1 - z0, 1e-3);
    const l = Math.hypot(1, nz);
    mb.quad(p(r0, a, z0), p(r0, b, z0), p(r1, b, z1), p(r1, a, z1), toThree(Math.sin(m) / l, Math.cos(m) / l, nz / l), col);
    if (capCol && r1 > 1e-3) mb.tri(toThree(cx, cy, z1), p(r1, a, z1), p(r1, b, z1), [0, 1, 0], capCol);
  }
}

function buildUrsulines(mb: MeshBuilder, t: RampartTower, terrain: HeightField): void {
  const id = Math.abs(t.id), deck = t.deck ?? t.base + 28, rail = t.rail ?? deck + 0.9, roof = t.roof ?? rail + 1.5;
  // Statue de 4,5 m au plus (photo 1) : le reste de la hauteur mesurée est le socle.
  const statue = t.statue ?? roof + 5, plinth = Math.max(t.plinth ?? roof + 0.5, roof + 0.3, statue - STATUE_H);
  const apo = t.apo ?? 5.4, rot = t.rot ?? 0;
  const oct = octagon(t), foot = (x: number, y: number): number => Math.min(terrain.heightAt(x, y), t.base) - SINK;
  // Fût, pied élargi (talus) et son rebord.
  const faces = ringFaces(mb, URSULINES, oct, true, foot, null, deck - 0.6, id, 1, 0, t.x, t.y);
  ringFaces(mb, URSULINES, octagon(t, BATTER_OUT), true, foot, null, (t.high ?? t.base) + BATTER_H * 0.4 + 0 * t.base, id, 2, 0, t.x, t.y);
  const zb = (t.high ?? t.base) + BATTER_H * 0.4;
  const big = octagon(t, BATTER_OUT);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    mb.quad(toThree(oct[2 * i]!, oct[2 * i + 1]!, zb + 0.25), toThree(oct[2 * j]!, oct[2 * j + 1]!, zb + 0.25), toThree(big[2 * j]!, big[2 * j + 1]!, zb), toThree(big[2 * i]!, big[2 * i + 1]!, zb), [0, 1, 0], URSULINES.palette[0]!);
  }
  // Chaînes d'angle claires, aux huit arêtes.
  for (let i = 0; i < 8; i++) {
    const vx = oct[2 * i]!, vy = oct[2 * i + 1]!;
    for (const [k, f] of [[-1, faces[(i + 7) % 8]!], [1, faces[i]!]] as [number, Face][]) {
      const L = Math.hypot(f.bx - f.ax, f.by - f.ay) || 1, ux = (f.bx - f.ax) / L, uy = (f.by - f.ay) / L;
      const w = 0.4, o = 0.03;
      const ex = vx + ux * (k > 0 ? w : -w), ey = vy + uy * (k > 0 ? w : -w);
      const z0 = Math.min(foot(vx, vy), t.base), z1 = deck - 0.6;
      mb.quad(toThree(vx + f.nx * o, vy + f.ny * o, z0), toThree(ex + f.nx * o, ey + f.ny * o, z0), toThree(ex + f.nx * o, ey + f.ny * o, z1), toThree(vx + f.nx * o, vy + f.ny * o, z1), toThree(f.nx, f.ny, 0), QUOIN);
    }
  }
  // Ouvertures sombres : fenêtres doubles romanes (vers 78 % de la hauteur, côtés ouest et sud), fenêtre double à mi-hauteur, meurtrières.
  const H = deck - t.base;
  const opening = (f: Face, u: number, z: number, w: number, h: number, arch: boolean): void => {
    const L = Math.hypot(f.bx - f.ax, f.by - f.ay) || 1;
    const P = (du: number, zz: number): Vec3 => toThree(f.ax + (f.bx - f.ax) * (u + du / L) + f.nx * 0.03, f.ay + (f.by - f.ay) * (u + du / L) + f.ny * 0.03, zz);
    mb.quad(P(-w / 2, z), P(w / 2, z), P(w / 2, z + h), P(-w / 2, z + h), toThree(f.nx, f.ny, 0), DARK);
    if (arch) for (let k = 0; k < 4; k++) {
      const a0 = (Math.PI * k) / 4, a1 = (Math.PI * (k + 1)) / 4;
      mb.tri(P(0, z + h), P((-Math.cos(a0) * w) / 2, z + h + (Math.sin(a0) * w) / 2), P((-Math.cos(a1) * w) / 2, z + h + (Math.sin(a1) * w) / 2), toThree(f.nx, f.ny, 0), DARK);
    }
  };
  faces.forEach((f, i) => {
    const facing = (Math.atan2(f.nx, f.ny) * 180) / Math.PI;
    const west = Math.abs(((facing - 250 + 540) % 360) - 180) < 30, south = Math.abs(((facing - 200 + 540) % 360) - 180) < 30;
    if (west || south) {
      // Arc clair qui coiffe la baie double, puis les deux baies.
      opening(f, 0.5, t.base + H * 0.76, 2.3, 1.5, true);
      const z = t.base + H * 0.76;
      const L = Math.hypot(f.bx - f.ax, f.by - f.ay) || 1;
      const P = (du: number, zz: number): Vec3 => toThree(f.ax + (f.bx - f.ax) * (0.5 + du / L) + f.nx * 0.04, f.ay + (f.by - f.ay) * (0.5 + du / L) + f.ny * 0.04, zz);
      mb.quad(P(-0.08, z), P(0.08, z), P(0.08, z + 1.5), P(-0.08, z + 1.5), toThree(f.nx, f.ny, 0), QUOIN);
    }
    if (west) opening(f, 0.5, t.base + H * 0.42, 1.2, 1.1, false);
    if (!west && !south && i % 2 === 0) opening(f, 0.5, t.base + H * 0.6, 0.2, 1.0, false);
  });
  // Corniche, terrasse, balustrade, toit de zinc, socle et statue.
  ringFaces(mb, { ...URSULINES, palette: [QUOIN] }, octagon(t, 0.2), true, () => deck - 0.6, deck - 0.6, deck, id, 3, 0, t.x, t.y);
  prism(mb, t.x, t.y, 8, (apo + 0.2) / Math.cos(Math.PI / 8), (apo + 0.2) / Math.cos(Math.PI / 8), deck - 0.05, deck, rot + Math.PI / 8, QUOIN, ZINC);
  for (const grow of [0.15, -0.05]) prism(mb, t.x, t.y, 8, (apo + grow) / Math.cos(Math.PI / 8), (apo + grow) / Math.cos(Math.PI / 8), deck, rail, rot + Math.PI / 8, RAIL, grow < 0 ? null : RAIL);
  prism(mb, t.x, t.y, 8, (apo - 0.6) / Math.cos(Math.PI / 8), 1.1, deck, roof, rot + Math.PI / 8, ZINC, null);
  prism(mb, t.x, t.y, 8, 1.1, 1.0, roof, plinth, rot + Math.PI / 8, ZINC, ZINC);
  // Vierge : robe en tronc de cône, buste, tête, bras ouverts vers l'extérieur de la ville (côté bas).
  const hS = statue - plinth;
  // Proportions d'après le LiDAR (rayon de 1,2 m au niveau des drapés) et la photo 5 : robe large, buste, tête voilée.
  prism(mb, t.x, t.y, 10, 1.0, 0.75, plinth, plinth + hS * 0.55, 0, STATUE, null);
  prism(mb, t.x, t.y, 10, 0.75, 0.42, plinth + hS * 0.55, plinth + hS * 0.82, 0, STATUE, STATUE);
  prism(mb, t.x, t.y, 8, 0.24, 0.24, plinth + hS * 0.82, plinth + hS * 0.86, 0, STATUE, null);
  prism(mb, t.x, t.y, 8, 0.34, 0.16, plinth + hS * 0.86, statue, 0, STATUE, STATUE);
  const face = Math.atan2(-(faces[4]?.nx ?? 0), -(faces[4]?.ny ?? 1));
  for (const side of [-1, 1]) {
    const a = face + side * Math.PI / 2;
    const sx = t.x + Math.sin(a) * 0.5, sy = t.y + Math.cos(a) * 0.5;
    const hx = t.x + Math.sin(a) * 1.5 + Math.sin(face) * 0.4, hy = t.y + Math.cos(a) * 1.5 + Math.cos(face) * 0.4;
    const z0 = plinth + hS * 0.74, z1 = plinth + hS * 0.52;
    const nx = Math.sin(face), ny = Math.cos(face);
    mb.quad(toThree(sx, sy, z0), toThree(hx, hy, z1), toThree(hx, hy, z1 + 0.3), toThree(sx, sy, z0 + 0.3), toThree(nx, ny, 0), STATUE);
    mb.quad(toThree(hx, hy, z1), toThree(sx, sy, z0), toThree(sx, sy, z0 + 0.3), toThree(hx, hy, z1 + 0.3), toThree(-nx, -ny, 0), STATUE);
  }
}
