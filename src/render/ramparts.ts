import * as THREE from "three";
import type { HeightField, RampartLook } from "../data/types";
import { rampartSides, RAMPART_THICK, type ProfiledWall } from "../core/ramparts";
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
