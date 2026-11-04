import * as THREE from "three";
import type { HeightField, PlayhouseModel } from "../data/types";
import { at, playhouseFrame, type Frame } from "../core/landmarks";
import { toThree, type MeshBuilder, type Vec3 } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import { T } from "./style";

/**
 * Théâtre municipal (D223), d'après les photos de l'utilisateur et le relevé LiDAR : corps avant en pierre claire (façade sur la place,
 * pavillons dont le retour fait une travée sur les côtés, côtés en léger retrait), toit d'ardoise brisé à croupes derrière l'attique ;
 * cage de scène plus haute, enduite de gris au-dessus de la corniche, à deux pans le long de l'axe, pignons à rampants et piles d'angle.
 * Niveaux et travées de la photo de face : portes et baies en plein cintre, fenêtres jumelées de l'entresol, grandes baies de l'étage
 * noble au centre ; quatre rangs de baies sur les côtés ; menuiseries rouges. Le détail de la façade (bossages, balcon, frontons,
 * perron, ornements du toit) viendra ensuite.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const STONE = C("#e4d7b8"), STONE_LOW = C("#d8c9a6"), TRIM = C("#efe6cf"), RENDER = C("#b2ab9d"), JOINERY = C("#8c2a25");
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0");
/** Saillie de la corniche, épaisseur de l'attique, débord des pans de la cage de scène. */
const CORNICE = 0.45, ATTIC = 0.3, OVERHANG = 0.2;

type ST = [number, number];
type STZ = [number, number, number];

/** Mur droit de a à b (s, t), normale sortante à droite de a → b (contour trigonométrique). */
interface PWall {
  a: ST;
  b: ST;
  out: ST;
  len: number;
}

const wallOf = (a: ST, b: ST): PWall => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { a, b, len, out: [(b[1] - a[1]) / len, -(b[0] - a[0]) / len] };
};

/** Petit nombre pseudo-aléatoire stable dans [0, 1). */
function rnd(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

class Draw {
  constructor(readonly mb: MeshBuilder, readonly glow: MeshBuilder, readonly f: Frame, readonly ground: (s: number, t: number) => number) {}

  P(s: number, t: number, z: number): Vec3 {
    const [x, y] = at(this.f, s, t);
    return toThree(x, y, z);
  }

  N(us: number, vt: number): Vec3 {
    const f = this.f;
    return toThree(f.ux * us + f.vx * vt, f.uy * us + f.vy * vt, 0);
  }

  /** Point du mur à `u` mètres de son début, à `off` devant lui. */
  on(w: PWall, u: number, off: number): ST {
    return [w.a[0] + ((w.b[0] - w.a[0]) * u) / w.len + w.out[0] * off, w.a[1] + ((w.b[1] - w.a[1]) * u) / w.len + w.out[1] * off];
  }

  /** Pan de toit plan a, b, c (, d) : deux triangles, normales tournées vers le haut. */
  pan(a: STZ, b: STZ, c: STZ, d: STZ | null, col: THREE.Color): void {
    const A = this.P(...a), B = this.P(...b), Cc = this.P(...c);
    this.mb.tri(A, B, Cc, up(A, B, Cc), col);
    if (d) {
      const D = this.P(...d);
      this.mb.tri(A, Cc, D, up(A, Cc, D), col);
    }
  }

  /**
   * Face du mur, du sol (40 cm dessous) jusqu'à `top`, par morceaux de 3 m au plus pour suivre le relief, en bandes de couleur :
   * `bands` donne le haut de chaque bande et sa couleur, de bas en haut.
   */
  face(w: PWall, top: number, bands: [number, THREE.Color][]): void {
    const n = this.N(...w.out);
    const pieces = Math.max(1, Math.ceil(w.len / 3));
    for (let i = 0; i < pieces; i++) {
      const p0 = this.on(w, (w.len * i) / pieces, 0), p1 = this.on(w, (w.len * (i + 1)) / pieces, 0);
      const z0 = this.ground(...p0) - 0.4, z1 = this.ground(...p1) - 0.4;
      let lo0 = z0, lo1 = z1;
      for (const [hiBand, col] of bands) {
        const hi = Math.min(hiBand, top);
        if (hi > lo0 + 0.01 || hi > lo1 + 0.01) {
          const b0 = Math.min(lo0, hi), b1 = Math.min(lo1, hi);
          this.mb.quad(this.P(...p0, b0), this.P(...p1, b1), this.P(...p1, hi), this.P(...p0, hi), n, col);
        }
        lo0 = Math.max(lo0, hi);
        lo1 = Math.max(lo1, hi);
        if (hi >= top) break;
      }
    }
  }

  /** Pavé plaqué sur le mur : de u0 à u1, de z0 à z1, de `off0` à `off1` devant lui ; `flat` : face avant seule. */
  plate(w: PWall, u0: number, u1: number, z0: number, z1: number, off0: number, off1: number, col: THREE.Color, flat = false): void {
    const tx = (w.b[0] - w.a[0]) / w.len, ty = (w.b[1] - w.a[1]) / w.len;
    const a0 = this.on(w, u0, off0), b0 = this.on(w, u1, off0), a1 = this.on(w, u0, off1), b1 = this.on(w, u1, off1);
    this.mb.quad(this.P(...a1, z0), this.P(...b1, z0), this.P(...b1, z1), this.P(...a1, z1), this.N(...w.out), col);
    if (flat) return;
    this.mb.quad(this.P(...a0, z1), this.P(...b0, z1), this.P(...b1, z1), this.P(...a1, z1), [0, 1, 0], shade(col, 1.04));
    this.mb.quad(this.P(...a1, z0), this.P(...b1, z0), this.P(...b0, z0), this.P(...a0, z0), [0, -1, 0], shade(col, 0.8));
    this.mb.quad(this.P(...a0, z0), this.P(...a1, z0), this.P(...a1, z1), this.P(...a0, z1), this.N(-tx, -ty), shade(col, 0.9));
    this.mb.quad(this.P(...b1, z0), this.P(...b0, z0), this.P(...b0, z1), this.P(...b1, z1), this.N(tx, ty), shade(col, 0.9));
  }

  /** Bandeau ou corniche sur toute la longueur du mur, prolongé de sa saillie aux deux bouts (les coins saillants se referment). */
  course(w: PWall, z0: number, z1: number, proj: number, col: THREE.Color): void {
    this.plate(w, -proj, w.len + proj, z0, z1, 0, proj, col);
  }

  /** Forme d'une baie (rectangle, ou plein cintre si `arched` : z1 est le haut de l'arc) posée à `off` devant le mur. */
  shape(target: MeshBuilder, w: PWall, u: number, half: number, z0: number, z1: number, arched: boolean, off: number, lo: THREE.Color, hi: THREE.Color): void {
    const n = this.N(...w.out);
    const spring = arched ? Math.max(z0, z1 - half) : z1;
    const p = (v: number, z: number): Vec3 => this.P(...this.on(w, u + v, off), z);
    target.quadGradient(p(-half, z0), p(half, z0), p(half, spring), p(-half, spring), n, lo, hi);
    if (!arched) return;
    for (let i = 0; i < 8; i++) {
      const a0 = (Math.PI * i) / 8, a1 = (Math.PI * (i + 1)) / 8;
      target.tri(p(0, spring), p(Math.cos(a0) * half, spring + Math.sin(a0) * half), p(Math.cos(a1) * half, spring + Math.sin(a1) * half), n, hi);
    }
  }

  /**
   * Baie à `u` mètres du début du mur, de largeur `wd`, de z0 au haut z1 : encadrement de pierre claire, menuiserie rouge, vitre ou porte
   * pleine (`door`) ; une baie sur trois environ s'allume la nuit (`lit`).
   */
  bay(w: PWall, u: number, wd: number, z0: number, z1: number, arched: boolean, lit: boolean, door = false): void {
    const h = wd / 2;
    this.shape(this.mb, w, u, h + 0.2, z0 - (door ? 0 : 0.15), z1 + 0.2, arched, 0.02, TRIM, TRIM);
    this.shape(this.mb, w, u, h, z0, z1, arched, 0.035, JOINERY, JOINERY);
    if (door) {
      // Porte à deux battants : panneaux pleins en bas, imposte vitrée en haut.
      const zi = z1 - (arched ? h : 0) - 0.9;
      this.shape(this.mb, w, u, h - 0.12, zi + 0.12, z1 - 0.12, arched, 0.045, C(T.glass[0]), C(T.glass[1]));
      this.plate(w, u - 0.04, u + 0.04, z0, zi, 0.045, 0.05, shade(JOINERY, 0.7), true);
      if (lit) this.shape(this.glow, w, u, h - 0.12, zi + 0.12, z1 - 0.12, arched, 0.052, GLOW_LO, GLOW_HI);
      return;
    }
    this.shape(this.mb, w, u, h - 0.1, z0 + 0.1, z1 - 0.1, arched, 0.045, C(T.glass[0]), C(T.glass[1]));
    // Meneau et traverse de la menuiserie.
    this.plate(w, u - 0.035, u + 0.035, z0 + 0.1, z1 - 0.1, 0.045, 0.055, JOINERY, true);
    const zt = z0 + (z1 - z0) * 0.7;
    this.plate(w, u - h + 0.1, u + h - 0.1, zt - 0.035, zt + 0.035, 0.045, 0.055, JOINERY, true);
    if (lit) this.shape(this.glow, w, u, h - 0.1, z0 + 0.1, z1 - 0.1, arched, 0.06, GLOW_LO, GLOW_HI);
  }
}

/** Normale (three) du triangle a, b, c, tournée vers le haut. */
function up(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (ny < 0) [nx, ny, nz] = [-nx, -ny, -nz];
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

export function buildPlayhouse(sinks: LandmarkSinks, m: PlayhouseModel, terrain: HeightField): void {
  const f = playhouseFrame(m);
  const d = new Draw(sinks.solid, sinks.glow, f, (s, t) => terrain.heightAt(...at(f, s, t)));
  const { w: W, ts, iL, iR, tt, tr, g, eave } = m;
  const [floor, cordon, band, corniceLo, corniceHi] = m.levels.map((v) => g + v) as [number, number, number, number, number];
  const [zWall, brk, zBrk, zRidge] = m.roof;
  const [zTe, zTr] = m.tower;
  const sA = iL, sB = W - iR, mid = (sA + sB) / 2, half = (sB - sA) / 2;
  const slate = C(T.roofs.ardoise), zinc = shade(slate, 1.25);

  // --- Murs -----------------------------------------------------------------------------------------------------------------------
  const front = wallOf([0, 0], [W, 0]);
  const retR = wallOf([W, 0], [W, ts]), retL = wallOf([0, ts], [0, 0]);
  const stepR = wallOf([W, ts], [sB, ts]), stepL = wallOf([sA, ts], [0, ts]);
  const sideR = wallOf([sB, ts], [sB, tt]), sideL = wallOf([sA, tt], [sA, ts]);
  const towerR = wallOf([sB, tt], [sB, tr]), towerL = wallOf([sA, tr], [sA, tt]);
  const rear = wallOf([sB, tr], [sA, tr]);
  const stone: [number, THREE.Color][] = [[cordon, STONE_LOW], [Infinity, STONE]];
  for (const wl of [front, retR, retL, stepR, stepL, sideR, sideL]) d.face(wl, eave, stone);
  for (const wl of [towerR, towerL]) d.face(wl, zTe, [[cordon, STONE_LOW], [corniceHi, STONE], [Infinity, RENDER]]);
  d.face(rear, zTe, [[Infinity, RENDER]]);
  // Pignons de la cage de scène, enduits : l'avant dépasse du toit du corps avant, l'arrière domine les bâtiments accolés.
  for (const [t, dir] of [[tt, -1], [tr, 1]] as const) {
    const s0 = dir < 0 ? sA : sB, s1 = dir < 0 ? sB : sA;
    if (dir < 0) sinks.solid.quad(d.P(s0, t, eave - 1), d.P(s1, t, eave - 1), d.P(s1, t, zTe), d.P(s0, t, zTe), d.N(0, dir), RENDER);
    sinks.solid.tri(d.P(s0, t, zTe), d.P(s1, t, zTe), d.P(mid, t, zTr), d.N(0, dir), RENDER);
  }

  // --- Bandeaux, corniche, attique --------------------------------------------------------------------------------------------------
  const body = [front, retR, retL, stepR, stepL, sideR, sideL];
  const all = [...body, towerR, towerL];
  for (const wl of all) {
    // Cordon au-dessus du rez-de-chaussée, corniche (doucine et larmier) sous l'attique, qui court aussi le long de la cage de scène.
    d.course(wl, cordon - 0.15, cordon + 0.15, 0.12, TRIM);
    d.course(wl, corniceLo, corniceLo + 0.35, 0.18, TRIM);
    d.course(wl, corniceLo + 0.35, corniceHi, CORNICE, shade(TRIM, 0.97));
  }
  for (const wl of body) {
    // Attique : couronnement saillant et face intérieure (on la voit d'en haut).
    d.course(wl, eave - 0.18, eave, 0.12, TRIM);
    d.plate(wl, 0, wl.len, eave - 0.18, eave, -ATTIC, 0, TRIM);
    const n = d.N(-wl.out[0], -wl.out[1]);
    const a = d.on(wl, 0, -ATTIC), b = d.on(wl, wl.len, -ATTIC);
    sinks.solid.quad(d.P(...b, zWall - 0.3), d.P(...a, zWall - 0.3), d.P(...a, eave - 0.18), d.P(...b, eave - 0.18), n, shade(STONE, 0.85));
  }
  // Façade et retours des pavillons : bandeau du balcon, refends du rez-de-chaussée.
  for (const wl of [front, retR, retL]) {
    d.course(wl, band - 0.12, band + 0.12, 0.1, TRIM);
    for (let z = g + 0.5; z < cordon - 0.3; z += 0.5) d.plate(wl, 0, wl.len, z - 0.03, z + 0.03, 0, 0.012, shade(STONE_LOW, 0.8), true);
  }

  // --- Baies --------------------------------------------------------------------------------------------------------------------
  const pw = m.pav * W, cw = W - 2 * pw;
  let k = 0;
  const lit = (): boolean => rnd(++k) < 0.34;
  // Pavillons de la façade : fenêtre cintrée au rez-de-chaussée, fenêtre à l'entresol, fenêtre haute à l'étage noble.
  const pavilion = (wl: PWall, u: number): void => {
    d.bay(wl, u, 1.4, floor + 0.9, g + 4.6, true, lit());
    d.bay(wl, u, 1.0, g + 6.7, g + 8.5, false, lit());
    d.bay(wl, u, 1.4, g + 10.1, g + 12.8, false, lit());
  };
  pavilion(front, pw / 2);
  pavilion(front, W - pw / 2);
  for (let i = 0; i < 3; i++) {
    // Avant-corps : portes en plein cintre, fenêtres jumelées de l'entresol, grandes baies cintrées de l'étage noble.
    const u = pw + (cw * (i + 0.5)) / 3;
    d.bay(front, u, 2.4, floor, g + 4.75, true, lit(), true);
    for (const k2 of [-1, 1]) d.bay(front, u + k2 * 0.68, 1.0, g + 6.7, g + 8.5, false, lit());
    d.bay(front, u, 2.4, g + 10.2, g + 13.5, true, lit());
  }
  pavilion(retR, ts / 2);
  pavilion(retL, ts / 2);
  // Côtés : travées régulières d'environ 3,3 m, arcades jusqu'au sol au rez-de-chaussée, puis entresol, étage noble et petites fenêtres
  // sous la corniche.
  for (const wl of [sideR, towerR, sideL, towerL]) {
    const count = Math.max(1, Math.round(wl.len / 3.3));
    for (let i = 0; i < count; i++) {
      const u = (wl.len * (i + 0.5)) / count;
      const gz = d.ground(...d.on(wl, u, 0));
      d.bay(wl, u, 1.5, gz + 0.05, g + 4.6, true, lit(), true);
      d.bay(wl, u, 1.1, g + 6.7, g + 8.4, false, lit());
      d.bay(wl, u, 1.2, g + 10.1, g + 12.9, false, lit());
      d.bay(wl, u, 0.9, g + 13.8, g + 14.8, false, lit());
    }
  }

  // Inscription THEATRE sur l'attique, au milieu (lettres dorées).
  const label = sinks.atlas.get("THEATRE", "#c9a24a");
  const th = 0.5, tw = th * 6.4, zt0 = eave - 0.95;
  d.plate(front, W / 2 - 2.0, W / 2 + 2.0, zt0 - 0.12, zt0 + th + 0.12, 0, 0.06, TRIM);
  const [ax, ay] = at(f, ...d.on(front, W / 2 - tw / 2, 0.07)), [bx, by] = at(f, ...d.on(front, W / 2 + tw / 2, 0.07));
  sinks.names.quad(toThree(ax, ay, zt0), toThree(bx, by, zt0), toThree(bx, by, zt0 + th), toThree(ax, ay, zt0 + th), d.N(0, -1),
    [label.u0, label.v0], [label.u1, label.v0], [label.u1, label.v1], [label.u0, label.v1], new THREE.Color(1, 1, 1));

  // Perron devant l'avant-corps (photo : six marches, plus large que les trois portes) ; il recouvre le talus du relief. Détail (rampes,
  // lanternes) plus tard.
  const steps = 6, riser = (floor - g) / steps, tread = 0.34, landing = 0.9;
  for (let i = 0; i < steps; i++) {
    const hw = cw / 2 + 2.4 + (steps - 1 - i) * 0.12, t0 = -(landing + (steps - 1 - i) * tread);
    const zTop = g + riser * (i + 1);
    box(d, W / 2 - hw, W / 2 + hw, t0, 0, Math.min(d.ground(W / 2, t0), g) - 0.4, zTop, i % 2 ? TRIM : shade(TRIM, 0.96));
  }

  // --- Toits ---------------------------------------------------------------------------------------------------------------------
  // Corps avant : fond plat derrière l'attique (chéneau), puis toit brisé à croupes sur le rectangle des côtés en retrait, du mur de façade
  // jusqu'à la cage de scène : pans raides jusqu'à la brisure, pans faibles jusqu'au faîtage (croupes à 45°).
  const zf = zWall - 0.3;
  d.pan([0, 0, zf], [W, 0, zf], [W, ts, zf], [0, ts, zf], slate);
  d.pan([sA, ts, zf], [sB, ts, zf], [sB, tt, zf], [sA, tt, zf], slate);
  const e = ATTIC + 0.05, k1 = (zBrk - zWall) / brk, ze = zWall + k1 * e;
  const lowFront: STZ[] = [[sA + e, e, ze], [sB - e, e, ze], [sB - brk, brk, zBrk], [sA + brk, brk, zBrk]];
  d.pan(...(lowFront as [STZ, STZ, STZ, STZ]), slate);
  d.pan([sB - e, e, ze], [sB - e, tt, ze], [sB - brk, tt, zBrk], [sB - brk, brk, zBrk], shade(slate, 0.94));
  d.pan([sA + e, tt, ze], [sA + e, e, ze], [sA + brk, brk, zBrk], [sA + brk, tt, zBrk], shade(slate, 0.94));
  const apex: STZ = [mid, half, zRidge];
  d.pan([sA + brk, brk, zBrk], [sB - brk, brk, zBrk], apex, null, shade(slate, 1.05));
  d.pan([sB - brk, brk, zBrk], [sB - brk, tt, zBrk], [mid, tt, zRidge], apex, shade(slate, 0.98));
  d.pan([sA + brk, tt, zBrk], [sA + brk, brk, zBrk], apex, [mid, tt, zRidge], shade(slate, 0.98));
  // Brisure et faîtage soulignés de zinc.
  for (const [a, b] of [[lowFront[3]!, lowFront[2]!], [[sB - brk, brk, zBrk], [sB - brk, tt, zBrk]], [[sA + brk, brk, zBrk], [sA + brk, tt, zBrk]], [apex, [mid, tt, zRidge]]] as [STZ, STZ][]) {
    d.pan([a[0], a[1], a[2] + 0.02], [b[0], b[1], b[2] + 0.02], [b[0], b[1], b[2] + 0.12], [a[0], a[1], a[2] + 0.12], zinc);
  }

  // Cage de scène : deux pans le long de t, débord sur les côtés ; pignons à rampants relevés et piles d'angle.
  const k3 = (zTr - zTe) / half;
  for (const [s0, dir] of [[sA, -1], [sB, 1]] as const) {
    const sx = s0 + dir * OVERHANG, zx = zTe - k3 * OVERHANG;
    d.pan([sx, tt, zx], [sx, tr, zx], [mid, tr, zTr], [mid, tt, zTr], dir < 0 ? slate : shade(slate, 0.92));
  }
  for (const [t, dir] of [[tt, -1], [tr, 1]] as const) {
    // Rampants : chaperon de pierre de 50 cm sur le pignon, 35 cm au-dessus du toit.
    for (const [s0, s1] of [[sA - 0.1, mid], [sB + 0.1, mid]] as const) {
      const z0 = zTe + 0.35 - k3 * 0.1, z1 = zTr + 0.35;
      const a: STZ = [s0, t - 0.25, z0], b: STZ = [s1, t - 0.25, z1], c: STZ = [s1, t + 0.25, z1], dd: STZ = [s0, t + 0.25, z0];
      d.pan(a, b, c, dd, TRIM);
      for (const tq of [t - 0.25, t + 0.25]) {
        const nn = d.N(0, tq < t ? -1 : 1);
        sinks.solid.quad(d.P(s0, tq, z0 - 0.45), d.P(s1, tq, z1 - 0.45), d.P(s1, tq, z1), d.P(s0, tq, z0), nn, shade(TRIM, 0.9));
      }
    }
    for (const s of [sA, sB]) {
      const sc = s + (s === sA ? 0.4 : -0.4), tc = t + (dir < 0 ? 0.4 : -0.4);
      box(d, sc - 0.45, sc + 0.45, tc - 0.45, tc + 0.45, zTe - 1.2, zTe + 0.9, TRIM);
    }
  }
}

/** Pavé droit du repère : s0..s1, t0..t1, z0..z1 (quatre côtés et dessus). */
function box(d: Draw, s0: number, s1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color): void {
  const mb = d.mb;
  mb.quad(d.P(s0, t0, z0), d.P(s1, t0, z0), d.P(s1, t0, z1), d.P(s0, t0, z1), d.N(0, -1), col);
  mb.quad(d.P(s1, t1, z0), d.P(s0, t1, z0), d.P(s0, t1, z1), d.P(s1, t1, z1), d.N(0, 1), col);
  mb.quad(d.P(s0, t1, z0), d.P(s0, t0, z0), d.P(s0, t0, z1), d.P(s0, t1, z1), d.N(-1, 0), shade(col, 0.92));
  mb.quad(d.P(s1, t0, z0), d.P(s1, t1, z0), d.P(s1, t1, z1), d.P(s1, t0, z1), d.N(1, 0), shade(col, 0.92));
  mb.quad(d.P(s0, t0, z1), d.P(s1, t0, z1), d.P(s1, t1, z1), d.P(s0, t1, z1), [0, 1, 0], col);
}
