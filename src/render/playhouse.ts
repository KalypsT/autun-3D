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
 * noble au centre ; quatre rangs de baies sur les côtés ; menuiseries rouges. Détail de la façade (D224) : pilastres à chapiteaux,
 * clés d'arcs, guirlandes, fenêtres des pavillons à fronton cintré et mascaron, modillons, attique à dés et panneaux sculptés, fronton
 * central à cartouche et volutes, chaînes d'angle de la cage de scène. D225 : balcon sur consoles, petits balcons des pavillons, perron
 * mesuré à rampes, lanternes. D226 : lucarnes à oculus des pavillons, pots-à-feu, épis, paratonnerre, lyre rayonnante du pignon arrière
 * (forme approchée), escalier de secours de l'arrière.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const STONE = C("#e4d7b8"), STONE_LOW = C("#d8c9a6"), TRIM = C("#efe6cf"), RENDER = C("#b2ab9d"), JOINERY = C("#8c2a25");
const GLOW_LO = C("#ffb04a"), GLOW_HI = C("#fff0b0"), IRON = C("#25292a");
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

  /** Clé d'arc saillante, son haut à z. */
  keystone(w: PWall, u: number, z: number, wd = 0.36, h = 0.55): void {
    this.plate(w, u - wd / 2, u + wd / 2, z - h, z, 0.02, 0.14, TRIM);
  }

  /** Pilastre de u − wd/2 à u + wd/2, de z0 à z1 : fût, base et chapiteau (gorgerin, corbeille évasée, abaque). */
  pilaster(w: PWall, u: number, wd: number, z0: number, z1: number): void {
    this.plate(w, u - wd / 2, u + wd / 2, z0 + 0.3, z1, 0, 0.1, shade(STONE, 1.03));
    this.plate(w, u - wd / 2 - 0.06, u + wd / 2 + 0.06, z0, z0 + 0.3, 0, 0.15, TRIM);
    this.plate(w, u - wd / 2 - 0.03, u + wd / 2 + 0.03, z1, z1 + 0.12, 0, 0.13, TRIM);
    this.plate(w, u - wd / 2 - 0.05, u + wd / 2 + 0.05, z1 + 0.12, z1 + 0.42, 0.02, 0.18, shade(TRIM, 0.96));
    this.plate(w, u - wd / 2 - 0.12, u + wd / 2 + 0.12, z1 + 0.42, z1 + 0.56, 0, 0.24, TRIM);
  }

  /** Fronton cintré (segment de cercle) : corde de u0 à u1 à l'altitude z, flèche `rise`, saillie `off` (face, dessus et tympan). */
  segment(w: PWall, u0: number, u1: number, z: number, rise: number, off: number, col: THREE.Color, back = 0): void {
    const c = (u1 - u0) / 2, um = (u0 + u1) / 2;
    const R = (c * c + rise * rise) / (2 * rise), zc = z + rise - R, a = Math.asin(c / R);
    const pt = (k: number, o: number): Vec3 => {
      const th = -a + (2 * a * k) / 8;
      return this.P(...this.on(w, um + Math.sin(th) * R, o), zc + Math.cos(th) * R);
    };
    const n = this.N(...w.out), nb = this.N(-w.out[0], -w.out[1]);
    for (let k = 0; k < 8; k++) {
      this.mb.tri(this.P(...this.on(w, um, off), z), pt(k, off), pt(k + 1, off), n, col);
      if (back < 0) this.mb.tri(this.P(...this.on(w, um, back), z), pt(k, back), pt(k + 1, back), nb, shade(col, 0.85));
      const A = pt(k, back), B = pt(k + 1, back), Cc = pt(k + 1, off), D = pt(k, off);
      this.mb.quad(A, B, Cc, D, up(A, B, Cc), shade(col, 1.04));
    }
  }

  /** Ovale plaqué sur le mur (mascaron, cartouche) : centre (u, z), demi-axes rs le long du mur et rz, à `off` devant lui. */
  oval(w: PWall, u: number, z: number, rs: number, rz: number, off: number, col: THREE.Color, sides = 12): void {
    const n = this.N(...w.out), c = this.P(...this.on(w, u, off), z);
    for (let i = 0; i < sides; i++) {
      const a0 = (Math.PI * 2 * i) / sides, a1 = (Math.PI * 2 * (i + 1)) / sides;
      this.mb.tri(c, this.P(...this.on(w, u + Math.cos(a0) * rs, off), z + Math.sin(a0) * rz), this.P(...this.on(w, u + Math.cos(a1) * rs, off), z + Math.sin(a1) * rz), n, col);
    }
  }

  /** Mascaron (photo : tête sculptée dans le tympan des pavillons) : visage ovale, chevelure en couronne, yeux et bouche en creux. */
  mascaron(w: PWall, u: number, z: number, o = 0): void {
    this.oval(w, u, z + 0.04, 0.34, 0.36, o + 0.05, shade(TRIM, 0.93), 14);
    this.oval(w, u, z - 0.02, 0.22, 0.28, o + 0.09, TRIM, 12);
    for (const k of [-1, 1]) this.oval(w, u + k * 0.08, z + 0.06, 0.035, 0.025, o + 0.1, shade(STONE, 0.55), 6);
    this.oval(w, u, z - 0.16, 0.06, 0.025, o + 0.1, shade(STONE, 0.55), 6);
  }

  /** Guirlande en feston de u0 à u1, accrochée à z, flèche `drop` : bande épaisse au milieu, effilée aux bouts. */
  swag(w: PWall, u0: number, u1: number, z: number, drop: number, col: THREE.Color): void {
    const n = this.N(...w.out), steps = 8;
    const at2 = (k: number, dz: number): Vec3 => {
      const f = k / steps, u = u0 + (u1 - u0) * f;
      return this.P(...this.on(w, u, 0.07), z - drop * Math.sin(Math.PI * f) + dz);
    };
    for (let k = 0; k < steps; k++) {
      const th0 = 0.04 + 0.14 * Math.sin((Math.PI * k) / steps), th1 = 0.04 + 0.14 * Math.sin((Math.PI * (k + 1)) / steps);
      this.mb.quad(at2(k, -th0), at2(k + 1, -th1), at2(k + 1, th1), at2(k, th0), n, col);
    }
  }

  /** Panneau sculpté (attique) : cadre saillant, fond en léger creux, guirlande. */
  panel(w: PWall, u0: number, u1: number, z0: number, z1: number): void {
    for (const [a, b, c, e] of [[u0, u1, z0, z0 + 0.08], [u0, u1, z1 - 0.08, z1], [u0, u0 + 0.08, z0, z1], [u1 - 0.08, u1, z0, z1]] as const) {
      this.plate(w, a, b, c, e, 0, 0.05, TRIM, true);
    }
    this.plate(w, u0 + 0.08, u1 - 0.08, z0 + 0.08, z1 - 0.08, 0, 0.01, shade(STONE, 0.9), true);
    if (u1 - u0 > 1.2) this.swag(w, u0 + 0.3, u1 - 0.3, z1 - 0.2, (z1 - z0) * 0.4, shade(TRIM, 0.92));
  }

  /** Modillons sous le larmier de la corniche, tous les `pitch` mètres le long du mur. */
  modillions(w: PWall, z0: number, z1: number, pitch: number): void {
    for (let u = pitch / 2; u < w.len; u += pitch) this.plate(w, u - 0.08, u + 0.08, z0, z1, 0.15, 0.4, shade(TRIM, 0.95));
  }

  /** Barre de fer de section carrée (côté 2·r) de a à b, en (s, t, z). */
  bar(a: STZ, b: STZ, r: number, col: THREE.Color = IRON): void {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
    // Deux directions perpendiculaires à la barre.
    let px = -dy, py = dx, pz = 0;
    if (Math.hypot(px, py) < 1e-6) { px = 1; py = 0; }
    const pl = Math.hypot(px, py, pz);
    px /= pl; py /= pl; pz /= pl;
    const qx = (dy * pz - dz * py) / L, qy = (dz * px - dx * pz) / L, qz = (dx * py - dy * px) / L;
    const c = (k: number, j: number, e: STZ): Vec3 => this.P(e[0] + (px * k + qx * j) * r, e[1] + (py * k + qy * j) * r, e[2] + (pz * k + qz * j) * r);
    const sides: [number, number, number, number][] = [[1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1], [-1, 1, 1, 1]];
    for (const [k0, j0, k1, j1] of sides) {
      const nk = (k0 + k1) / 2, nj = (j0 + j1) / 2;
      const [nx, ny] = at(this.f, px * nk + qx * nj, py * nk + qy * nj);
      const n0 = at(this.f, 0, 0);
      const nz = pz * nk + qz * nj, nl = Math.hypot(nx - n0[0], ny - n0[1], nz) || 1;
      this.mb.quad(c(k0, j0, a), c(k1, j1, a), c(k1, j1, b), c(k0, j0, b), toThree((nx - n0[0]) / nl, (ny - n0[1]) / nl, nz / nl), col);
    }
  }

  /** Dalle horizontale de contour `pts` (s, t), de z0 à z1 : dessus, dessous, chants. */
  slab(pts: ST[], z0: number, z1: number): void {
    const n = pts.length;
    for (let i = 1; i + 1 < n; i++) {
      this.mb.tri(this.P(...pts[0]!, z1), this.P(...pts[i]!, z1), this.P(...pts[i + 1]!, z1), [0, 1, 0], TRIM);
      this.mb.tri(this.P(...pts[0]!, z0), this.P(...pts[i]!, z0), this.P(...pts[i + 1]!, z0), [0, -1, 0], shade(TRIM, 0.82));
    }
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, b = pts[(i + 1) % n]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nn = this.N((b[1] - a[1]) / l, -(b[0] - a[0]) / l);
      this.mb.quad(this.P(...a, z0), this.P(...b, z0), this.P(...b, z1), this.P(...a, z1), nn, shade(TRIM, 0.95));
      this.mb.quad(this.P(...a, z0), this.P(...b, z0), this.P(...b, z1), this.P(...a, z1), [-nn[0], -nn[1], -nn[2]], shade(TRIM, 0.95));
    }
  }

  /** Balustrade de a à b (s, t) posée à z0, haute de h : plinthe, balustres en poire tous les 28 cm, main courante. */
  balustrade(a: ST, b: ST, z0: number, h: number): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, vx = -uy, vy = ux;
    const rect = (u0: number, u1: number, hw: number, z1: number, z2: number, col: THREE.Color): void => {
      const P = (u: number, v: number): ST => [a[0] + ux * u + vx * v, a[1] + uy * u + vy * v];
      const q = [P(u0, -hw), P(u1, -hw), P(u1, hw), P(u0, hw)];
      for (let i = 0; i < 4; i++) {
        const p0 = q[i]!, p1 = q[(i + 1) % 4]!, l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        this.mb.quad(this.P(...p0, z1), this.P(...p1, z1), this.P(...p1, z2), this.P(...p0, z2), this.N((p1[1] - p0[1]) / l, -(p1[0] - p0[0]) / l), col);
      }
      this.mb.quad(this.P(...q[0]!, z2), this.P(...q[1]!, z2), this.P(...q[2]!, z2), this.P(...q[3]!, z2), [0, 1, 0], shade(col, 1.04));
    };
    rect(0, len, 0.12, z0, z0 + 0.12, TRIM);
    const top = z0 + h - 0.12;
    const n = Math.max(1, Math.round(len / 0.28));
    for (let i = 0; i < n; i++) {
      const u = (len * (i + 0.5)) / n;
      rect(u - 0.035, u + 0.035, 0.035, z0 + 0.12, top, shade(TRIM, 0.97));
      rect(u - 0.065, u + 0.065, 0.065, z0 + 0.2, z0 + 0.2 + (top - z0 - 0.12) * 0.45, shade(TRIM, 0.97));
    }
    rect(-0.03, len + 0.03, 0.14, top, z0 + h, TRIM);
  }

  /** Console à volute sous un balcon : profil en quart d'ellipse du mur (bas, z1) à la saillie `depth` (haut, z0), largeur wd. */
  console(w: PWall, u: number, z0: number, z1: number, depth: number, wd: number): void {
    const prof: [number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const th = (Math.PI / 2) * (i / 6);
      prof.push([depth * Math.sin(th), z1 + (z0 - z1) * (1 - Math.cos(th))]);
    }
    const tx = (w.b[0] - w.a[0]) / w.len, ty = (w.b[1] - w.a[1]) / w.len;
    for (const k of [-1, 1]) {
      const n = this.N(tx * k, ty * k), uu = u + (k * wd) / 2;
      for (let i = 0; i < 6; i++) {
        this.mb.tri(this.P(...this.on(w, uu, 0), z0), this.P(...this.on(w, uu, prof[i]![0]), prof[i]![1]), this.P(...this.on(w, uu, prof[i + 1]![0]), prof[i + 1]![1]), n, shade(TRIM, 0.9));
      }
    }
    for (let i = 0; i < 6; i++) {
      const [o0, z0a] = prof[i]!, [o1, z1a] = prof[i + 1]!;
      const A = this.P(...this.on(w, u - wd / 2, o0), z0a), B = this.P(...this.on(w, u + wd / 2, o0), z0a);
      const Cc = this.P(...this.on(w, u + wd / 2, o1), z1a), D = this.P(...this.on(w, u - wd / 2, o1), z1a);
      // Normale du profil, vers l'avant et le bas (tangente (do, dz) → (dz, −do)).
      const dO = o1 - o0, dZ = z1a - z0a, nl = Math.hypot(dO, dZ) || 1;
      const ho = this.N(...w.out);
      this.mb.quad(A, B, Cc, D, [(ho[0] * dZ) / nl, -dO / nl, (ho[2] * dZ) / nl], TRIM);
    }
    // Enroulement du bas : petit disque sur chaque joue.
    for (const k of [-1, 1]) {
      const tx2 = (w.b[0] - w.a[0]) / w.len, ty2 = (w.b[1] - w.a[1]) / w.len, n = this.N(tx2 * k, ty2 * k), uu = u + (k * wd) / 2 + k * 0.01;
      const c = this.P(...this.on(w, uu, 0.16), z1 + 0.16);
      for (let i = 0; i < 8; i++) {
        const a0 = (Math.PI * 2 * i) / 8, a1 = (Math.PI * 2 * (i + 1)) / 8;
        this.mb.tri(c, this.P(...this.on(w, uu, 0.16 + Math.cos(a0) * 0.13), z1 + 0.16 + Math.sin(a0) * 0.13), this.P(...this.on(w, uu, 0.16 + Math.cos(a1) * 0.13), z1 + 0.16 + Math.sin(a1) * 0.13), n, TRIM);
      }
    }
  }

  /** Lanterne suspendue à une potence qui sort du mur de `reach` mètres à l'altitude z : cage de fer, vitres allumées la nuit. */
  lantern(w: PWall, u: number, z: number, reach: number): void {
    const [s0, t0] = this.on(w, u, 0), [s1, t1] = this.on(w, u, reach);
    this.bar([s0, t0, z], [s1, t1, z], 0.03);
    this.bar([s0, t0, z - 0.45], [this.on(w, u, reach * 0.6)[0], this.on(w, u, reach * 0.6)[1], z], 0.025);
    this.bar([s1, t1, z], [s1, t1, z - 0.2], 0.02);
    const zb = z - 0.85, zt = z - 0.3, r = 0.16;
    const glass = C("#f3e2b0");
    const sides: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const [ds, dt] of sides) {
      // Face vitrée (le repère du mur : ds le long, dt devant).
      const tx = (w.b[0] - w.a[0]) / w.len, ty = (w.b[1] - w.a[1]) / w.len;
      const ex = tx * ds + w.out[0] * dt, ey = ty * ds + w.out[1] * dt, fx = -ey, fy = ex;
      const c0: ST = [s1 + ex * r + fx * r, t1 + ey * r + fy * r], c1: ST = [s1 + ex * r - fx * r, t1 + ey * r - fy * r];
      const n = this.N(ex, ey);
      this.mb.quad(this.P(...c0, zb), this.P(...c1, zb), this.P(...c1, zt), this.P(...c0, zt), n, glass);
      this.glow.quadGradient(this.P(...c0, zb), this.P(...c1, zb), this.P(...c1, zt), this.P(...c0, zt), n, GLOW_LO, GLOW_HI);
      this.bar([...c0, zb], [...c0, zt], 0.018);
    }
    box(this, s1 - r - 0.03, s1 + r + 0.03, t1 - r - 0.03, t1 + r + 0.03, zb - 0.08, zb, IRON);
    // Chapeau en pyramide et anneau.
    const tip: STZ = [s1, t1, zt + 0.22];
    const cs: ST[] = [[s1 - r - 0.05, t1 - r - 0.05], [s1 + r + 0.05, t1 - r - 0.05], [s1 + r + 0.05, t1 + r + 0.05], [s1 - r - 0.05, t1 + r + 0.05]];
    for (let i = 0; i < 4; i++) this.pan([...cs[i]!, zt], [...cs[(i + 1) % 4]!, zt], tip, null, IRON);
  }

  /** Chaîne d'angle : blocs alternés (90 et 50 cm) depuis un bout du mur, de z0 à z1. */
  quoins(w: PWall, atEnd: boolean, z0: number, z1: number, phase: number): void {
    for (let k = 0, z = z0; z + 0.3 < z1; k++, z += 0.6) {
      const wd = (k + phase) % 2 ? 0.5 : 0.9;
      const [u0, u1] = atEnd ? [w.len - wd, w.len] : [0, wd];
      this.plate(w, u0, u1, z, Math.min(z + 0.55, z1), 0, 0.04, shade(TRIM, 0.95), true);
    }
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
  const [, cordon, band, corniceLo, corniceHi] = m.levels.map((v) => g + v) as [number, number, number, number, number];
  // Sol des portes : le palier du perron mesuré (D225).
  const floor = m.perron[4];
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

  // --- Détail de la façade (D224) ------------------------------------------------------------------------------------------------
  const zCap = g + 13.9, zArch = zCap + 0.56;
  // Pilastres : aux deux bords de chaque pavillon (doublés contre l'avant-corps) du cordon aux chapiteaux, entre les grandes baies de
  // l'avant-corps au-dessus du balcon ; aux deux bouts des retours.
  const pilasters: [PWall, number, number][] = [
    [front, 0.35, cordon + 0.15], [front, pw - 0.3, cordon + 0.15], [front, pw + 0.3, band + 0.12],
    [front, pw + cw / 3, band + 0.12], [front, pw + (2 * cw) / 3, band + 0.12],
    [front, W - pw - 0.3, band + 0.12], [front, W - pw + 0.3, cordon + 0.15], [front, W - 0.35, cordon + 0.15],
    [retR, 0.35, cordon + 0.15], [retR, ts - 0.35, cordon + 0.15], [retL, 0.35, cordon + 0.15], [retL, ts - 0.35, cordon + 0.15],
  ];
  for (const [wl, u, z0] of pilasters) d.pilaster(wl, u, 0.55, z0, zCap);
  for (const wl of [front, retR, retL]) d.course(wl, zArch - 0.02, zArch + 0.2, 0.12, TRIM);
  // Clés des arcs : portes et fenêtres cintrées du rez-de-chaussée, grandes baies ; guirlandes de part et d'autre de chaque clé.
  for (let i = 0; i < 3; i++) {
    const u = pw + (cw * (i + 0.5)) / 3, p0 = pw + (cw * i) / 3 + (i === 0 ? 0.3 : 0), p1 = pw + (cw * (i + 1)) / 3 - (i === 2 ? 0.3 : 0);
    d.keystone(front, u, g + 5.35);
    d.keystone(front, u, zCap + 0.25, 0.42, 0.6);
    d.swag(front, p0 + 0.4, u - 0.3, zCap + 0.4, 0.4, shade(TRIM, 0.92));
    d.swag(front, u + 0.3, p1 - 0.4, zCap + 0.4, 0.4, shade(TRIM, 0.92));
  }
  // Pavillons (façade et retours) : clé de la fenêtre du bas, appui à l'entresol, fenêtre haute à appui, corniche et fronton cintré à
  // mascaron.
  const pavDetail = (wl: PWall, u: number): void => {
    d.keystone(wl, u, g + 5.15);
    d.plate(wl, u - 0.7, u + 0.7, g + 6.52, g + 6.62, 0, 0.12, TRIM);
    d.plate(wl, u - 0.95, u + 0.95, g + 9.9, g + 10.02, 0, 0.14, TRIM);
    d.plate(wl, u - 1.05, u + 1.05, g + 12.98, g + 13.16, 0, 0.2, TRIM);
    d.segment(wl, u - 1.05, u + 1.05, g + 13.16, 0.75, 0.2, TRIM);
    d.mascaron(wl, u, g + 13.5, 0.2);
  };
  pavDetail(front, pw / 2);
  pavDetail(front, W - pw / 2);
  pavDetail(retR, ts / 2);
  pavDetail(retL, ts / 2);
  // Entresol de l'avant-corps : appuis des fenêtres jumelées.
  for (let i = 0; i < 3; i++) d.plate(front, pw + (cw * (i + 0.5)) / 3 - 1.3, pw + (cw * (i + 0.5)) / 3 + 1.3, g + 6.52, g + 6.62, 0, 0.1, TRIM);
  // Côtés : clés des arcades, appuis et corniches des fenêtres de l'étage noble.
  for (const wl of [sideR, towerR, sideL, towerL]) {
    const count = Math.max(1, Math.round(wl.len / 3.3));
    for (let i = 0; i < count; i++) {
      const u = (wl.len * (i + 0.5)) / count;
      d.keystone(wl, u, g + 5.15);
      d.plate(wl, u - 0.8, u + 0.8, g + 9.92, g + 10.02, 0, 0.12, TRIM);
      d.plate(wl, u - 0.85, u + 0.85, g + 13.1, g + 13.25, 0, 0.16, TRIM);
    }
  }
  // Modillons sous le larmier de la corniche (plus serrés sur la façade et les retours).
  for (const wl of all) d.modillions(wl, corniceLo + 0.05, corniceLo + 0.35, wl === front || wl === retR || wl === retL ? 0.6 : 0.9);
  // Chaînes d'angle de pierre aux coins arrière de la cage de scène, dans l'enduit.
  d.quoins(towerR, true, corniceHi, zTe, 0);
  d.quoins(rear, false, corniceHi, zTe, 1);
  d.quoins(rear, true, corniceHi, zTe, 0);
  d.quoins(towerL, false, corniceHi, zTe, 1);

  // Attique : dés au-dessus des pilastres, panneaux sculptés entre eux (hors du fronton central).
  const fw = 4.6, f0 = W / 2 - fw / 2, f1 = W / 2 + fw / 2, vol = 0.9;
  const dice: [PWall, number[]][] = [[front, pilasters.filter(([wl]) => wl === front).map(([, u]) => u)], [retR, [0.35, ts - 0.35]], [retL, [0.35, ts - 0.35]]];
  for (const [wl, us] of dice) {
    const sorted = [...us].sort((a, b) => a - b);
    for (const u of sorted) d.plate(wl, u - 0.4, u + 0.4, corniceHi, eave - 0.18, 0, 0.1, shade(STONE, 1.02));
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i]! + 0.55, b = sorted[i + 1]! - 0.55;
      if (wl === front && b > f0 - vol && a < f1 + vol) {
        // Le fronton coupe la travée : un panneau de chaque côté.
        if (f0 - vol - 0.15 - a > 0.6) d.panel(wl, a, f0 - vol - 0.15, corniceHi + 0.2, eave - 0.4);
        if (b - (f1 + vol + 0.15) > 0.6) d.panel(wl, f1 + vol + 0.15, b, corniceHi + 0.2, eave - 0.4);
        continue;
      }
      if (b - a > 0.6) d.panel(wl, a, b, corniceHi + 0.2, eave - 0.4);
    }
  }

  // Fronton central (haut mesuré) : massif plus haut que l'attique, corniche, fronton cintré, cartouche ; volutes de chaque côté ;
  // panneau à l'inscription THEATRE en lettres dorées.
  const zF = eave + 0.55, rise = Math.max(0.5, m.fronton - zF - 0.1);
  d.plate(front, f0, f1, corniceHi, zF, -0.8, 0.16, STONE);
  d.plate(front, f0 - 0.12, f1 + 0.12, zF - 0.15, zF, -0.8, 0.26, TRIM);
  d.segment(front, f0 - 0.12, f1 + 0.12, zF, rise, 0.26, TRIM, -0.8);
  d.oval(front, W / 2, zF + rise * 0.42, 0.5, Math.min(0.42, rise * 0.4), 0.27, shade(TRIM, 0.92), 14);
  d.oval(front, W / 2, zF + rise * 0.42, 0.36, Math.min(0.3, rise * 0.29), 0.3, TRIM, 14);
  for (const dir of [-1, 1]) {
    const e = W / 2 + (dir * fw) / 2, n = d.N(0, -1), base: Vec3 = d.P(...d.on(front, e, 0.1), corniceHi);
    for (let i = 0; i < 6; i++) {
      const a0 = (Math.PI / 2) * (i / 6), a1 = (Math.PI / 2) * ((i + 1) / 6), h = zF - 0.15 - corniceHi;
      sinks.solid.tri(base, d.P(...d.on(front, e + dir * Math.sin(a0) * vol, 0.1), corniceHi + Math.cos(a0) * h),
        d.P(...d.on(front, e + dir * Math.sin(a1) * vol, 0.1), corniceHi + Math.cos(a1) * h), n, shade(TRIM, 0.95));
    }
  }
  const label = sinks.atlas.get("THEATRE", "#c9a24a");
  const th = 0.5, tw = th * 6.4, zt0 = eave - 0.4;
  d.plate(front, W / 2 - 1.9, W / 2 + 1.9, zt0 - 0.12, zt0 + th + 0.12, 0.16, 0.21, shade(STONE, 0.97));
  const [ax, ay] = at(f, ...d.on(front, W / 2 - tw / 2, 0.22)), [bx, by] = at(f, ...d.on(front, W / 2 + tw / 2, 0.22));
  sinks.names.quad(toThree(ax, ay, zt0), toThree(bx, by, zt0), toThree(bx, by, zt0 + th), toThree(ax, ay, zt0 + th), d.N(0, -1),
    [label.u0, label.v0], [label.u1, label.v0], [label.u1, label.v1], [label.u0, label.v1], new THREE.Color(1, 1, 1));

  // --- Balcon, perron, lanternes (D225) ------------------------------------------------------------------------------------------
  // Balcon de l'avant-corps sur quatre consoles (aux axes des pilastres), balustrade à balustres, dés aux consoles et aux bouts.
  const bz = band - 0.2, bd = 1.0, consoles = [pw, pw + cw / 3, pw + (2 * cw) / 3, W - pw];
  box(d, pw - 0.1, W - pw + 0.1, -bd, 0, bz, bz + 0.32, TRIM);
  sinks.solid.quad(d.P(pw - 0.1, -bd, bz), d.P(W - pw + 0.1, -bd, bz), d.P(W - pw + 0.1, 0, bz), d.P(pw - 0.1, 0, bz), [0, -1, 0], shade(TRIM, 0.82));
  for (const u of consoles) d.console(front, u, bz, bz - 1.8, bd - 0.05, 0.45);
  const bTop = bz + 0.32;
  const rail: [ST, ST][] = [[[pw - 0.05, -bd + 0.12], [W - pw + 0.05, -bd + 0.12]], [[pw - 0.05, -bd + 0.12], [pw - 0.05, 0]], [[W - pw + 0.05, -bd + 0.12], [W - pw + 0.05, 0]]];
  for (const [p0, p1] of rail) d.balustrade(p0, p1, bTop, 0.9);
  for (const u of consoles) box(d, u - 0.2, u + 0.2, -bd + 0.12 - 0.2, -bd + 0.12 + 0.2, bTop, bTop + 1.0, shade(TRIM, 1.02));
  // Petits balcons des pavillons (façade et retours) : balustrade sur dalle, deux consoles.
  for (const [wl, u] of [[front, pw / 2], [front, W - pw / 2], [retR, ts / 2], [retL, ts / 2]] as const) {
    const a0 = d.on(wl, u - 0.95, 0), a1 = d.on(wl, u + 0.95, 0), b0 = d.on(wl, u - 0.95, 0.42), b1 = d.on(wl, u + 0.95, 0.42);
    d.slab([a0, a1, b1, b0], bz + 0.2, bz + 0.38);
    for (const k of [-0.7, 0.7]) d.console(wl, u + k, bz + 0.2, bz - 0.5, 0.38, 0.22);
    const c0 = d.on(wl, u - 0.9, 0.34), c1 = d.on(wl, u + 0.9, 0.34);
    d.balustrade(c0, c1, bz + 0.38, 0.62);
    d.balustrade(d.on(wl, u - 0.9, 0), c0, bz + 0.38, 0.62);
    d.balustrade(d.on(wl, u + 0.9, 0), c1, bz + 0.38, 0.62);
  }
  // Lanternes suspendues à des potences entre les portes (photo), allumées la nuit.
  for (const u of [pw + cw / 3, pw + (2 * cw) / 3]) d.lantern(front, u, g + 6.95, 0.75);

  // Perron mesuré (palier, pied, largeur à mi-volée) : marches régulières d'environ 15 cm, plus larges vers le bas (photo), posées sur le
  // relief, qui monte avec elles ; rampes en fer le long des deux bouts.
  const [p0, p1, tFoot, zFoot, zLand] = m.perron;
  const pc = (p0 + p1) / 2, steps = Math.max(2, Math.round((zLand - zFoot) / 0.15)), riser = (zLand - zFoot) / steps;
  const landing = 0.9, tread = Math.max(0.25, (-tFoot - landing) / steps);
  const halfAt = (i: number): number => (p1 - p0) / 2 - 0.4 + (steps - 1 - i) * 0.2;
  for (let i = 0; i < steps; i++) {
    const hw = halfAt(i), t0 = -(landing + (steps - 1 - i) * tread);
    box(d, pc - hw, pc + hw, t0, 0, Math.min(d.ground(pc, t0), zFoot) - 0.4, zFoot + riser * (i + 1), i % 2 ? TRIM : shade(TRIM, 0.96));
  }
  for (const dir of [-1, 1]) {
    const tB = -(landing + (steps - 1) * tread) + 0.15, sB = pc + dir * (halfAt(0) - 0.15), sT = pc + dir * (halfAt(steps - 1) - 0.15);
    const zB = zFoot + riser + 0.9, zT = zLand + 0.9;
    d.bar([sB, tB, zB], [sT, -landing, zT], 0.05);
    d.bar([sT, -landing, zT], [sT, -0.05, zT], 0.05);
    const n = Math.max(2, Math.ceil((landing + (steps - 1) * tread) / 0.9));
    for (let k = 0; k <= n; k++) {
      const f2 = k / n, s2 = sB + (sT - sB) * f2, t2 = tB + (-landing - tB) * f2, z2 = zB + (zT - zB) * f2;
      d.bar([s2, t2, z2 - 0.92], [s2, t2, z2], 0.035);
    }
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
      // Pot-à-feu sur chaque pile (photos de l'arrière).
      potAFeu(d, sc, tc, zTe + 0.9, 1.0);
    }
  }

  // --- Ornements du toit (D226) -------------------------------------------------------------------------------------------------
  // Lucarnes des pavillons (photo : petit édicule à fronton triangulaire et oculus, posé sur l'attique au-dessus de chaque pavillon).
  const zLuc = g + 18.8, wl2 = 1.05;
  for (const u of [pw / 2, W - pw / 2]) {
    const t0 = -0.08, t1 = 1.3, zb = eave - 0.45, zs = zLuc - 0.6;
    box(d, u - wl2, u + wl2, t0, t1, zb, zs, STONE);
    // Fronton triangulaire (avant et arrière), corniche, toit à deux pans.
    box(d, u - wl2 - 0.1, u + wl2 + 0.1, t0 - 0.06, t1, zs - 0.12, zs, TRIM);
    for (const [t, dir] of [[t0 - 0.06, -1], [t1, 1]] as const) sinks.solid.tri(d.P(u - wl2 - 0.1, t, zs), d.P(u + wl2 + 0.1, t, zs), d.P(u, t, zLuc), d.N(0, dir), TRIM);
    for (const dir of [-1, 1]) d.pan([u + dir * (wl2 + 0.15), t0 - 0.08, zs - 0.03], [u + dir * (wl2 + 0.15), t1, zs - 0.03], [u, t1, zLuc + 0.03], [u, t0 - 0.08, zLuc + 0.03], dir < 0 ? zinc : shade(zinc, 0.92));
    // Oculus cerclé.
    d.oval(front, u, (zb + zs) / 2 + 0.05, 0.42, 0.42, 0.1, shade(TRIM, 1.0), 14);
    d.oval(front, u, (zb + zs) / 2 + 0.05, 0.3, 0.3, 0.13, C(T.glass[0]), 14);
    if (rnd(u) < 0.5) {
      const zc = (zb + zs) / 2 + 0.05, n = d.N(0, -1), c = d.P(...d.on(front, u, 0.135), zc);
      for (let i = 0; i < 12; i++) {
        const a0 = (Math.PI * 2 * i) / 12, a1 = (Math.PI * 2 * (i + 1)) / 12;
        sinks.glow.tri(c, d.P(...d.on(front, u + Math.cos(a0) * 0.3, 0.135), zc + Math.sin(a0) * 0.3), d.P(...d.on(front, u + Math.cos(a1) * 0.3, 0.135), zc + Math.sin(a1) * 0.3), n, GLOW_LO);
      }
    }
  }
  // Pots-à-feu sur l'attique : aux deux coins de la façade et sur les dés doublés entre pavillons et avant-corps (photo).
  for (const u of [0.35, pw, W - pw, W - 0.35]) potAFeu(d, u, 0.12, eave, 1.0);
  // Épis de faîtage au-dessus des pavillons, sur le pan avant (photo : tiges fines jusqu'à 20,5 m environ).
  for (const u of [pw / 2, W - pw / 2]) {
    const t = 2.6, z = zWall + ((zBrk - zWall) / brk) * t;
    box(d, u - 0.12, u + 0.12, t - 0.12, t + 0.12, z - 0.3, z + 0.4, zinc);
    d.bar([u, t, z + 0.4], [u, t, g + 20.5], 0.025);
    for (const zz of [z + 0.9, z + 1.5]) box(d, u - 0.07, u + 0.07, t - 0.07, t + 0.07, zz, zz + 0.14, IRON);
  }
  // Paratonnerre à la pointe du pignon avant de la cage de scène (photo de face).
  d.bar([mid, tt, zTr + 0.35], [mid, tt, zTr + 3.0], 0.02);
  // Ornement de la pointe du pignon arrière (photos Street View, pas de vue rapprochée : forme approchée) : lyre de métal sombre sur un
  // socle, entourée de rayons.
  lyre(d, mid, tr, zTr + 0.35);
  // Escalier de secours de l'arrière, près du coin sud-ouest (photo de la rue Jondeau) : paliers de caillebotis et volées alternées,
  // garde-corps, au-dessus des bâtiments accolés.
  const fx0 = sA + 1.2, fx1 = fx0 + 2.6, ft = tr + 1.2;
  const lv = [g + 8.5, g + 12.0, g + 15.5, g + 19.0];
  for (const [i, z] of lv.entries()) {
    const left = i % 2 === 0;
    const ps = left ? fx0 : fx1 - 1.0;
    box(d, ps, ps + 1.0, tr, ft, z - 0.06, z, IRON);
    d.bar([ps, ft, z], [ps, ft, z + 1.0], 0.02);
    d.bar([ps + 1.0, ft, z], [ps + 1.0, ft, z + 1.0], 0.02);
    d.bar([ps, ft, z + 1.0], [ps + 1.0, ft, z + 1.0], 0.02);
    for (const sx of [ps, ps + 1.0]) d.bar([sx, ft, z], [sx, tr, z - 0.6], 0.02);
    const nz = lv[i + 1];
    if (nz === undefined) continue;
    // Volée vers le palier suivant, de l'autre côté : limons, marches, main courante.
    const sa = left ? ps + 1.0 : ps, sb = left ? fx1 - 1.0 : fx0 + 1.0;
    for (const tq of [tr + 0.15, ft - 0.05]) d.bar([sa, tq, z], [sb, tq, nz], 0.03);
    const n = Math.round((nz - z) / 0.2);
    for (let k = 1; k < n; k++) {
      const f2 = k / n, sk = sa + (sb - sa) * f2, zk = z + (nz - z) * f2;
      box(d, sk - 0.12, sk + 0.12, tr + 0.15, ft - 0.05, zk - 0.03, zk, IRON);
    }
    d.bar([sa, ft - 0.05, z + 0.95], [sb, ft - 0.05, nz + 0.95], 0.018);
  }
}

/** Solide de révolution à huit pans autour de (s, t) : profil [rayon, z] de bas en haut, dessus fermé. */
function lathe(d: Draw, s: number, t: number, prof: [number, number][], col: THREE.Color): void {
  const sides = 8;
  for (let i = 0; i + 1 < prof.length; i++) {
    const [r0, z0] = prof[i]!, [r1, z1] = prof[i + 1]!;
    for (let k = 0; k < sides; k++) {
      const a0 = (Math.PI * 2 * k) / sides, a1 = (Math.PI * 2 * (k + 1)) / sides, am = (a0 + a1) / 2;
      const nh = d.N(Math.cos(am), Math.sin(am)), dz = z1 - z0, dr = r0 - r1, l = Math.hypot(dz, dr) || 1;
      d.mb.quad(d.P(s + Math.cos(a0) * r0, t + Math.sin(a0) * r0, z0), d.P(s + Math.cos(a1) * r0, t + Math.sin(a1) * r0, z0),
        d.P(s + Math.cos(a1) * r1, t + Math.sin(a1) * r1, z1), d.P(s + Math.cos(a0) * r1, t + Math.sin(a0) * r1, z1),
        [(nh[0] * dz) / l, dr / l, (nh[2] * dz) / l], shade(col, 0.92 + 0.08 * Math.max(0, -Math.sin(am))));
    }
  }
  const [rt, zt] = prof[prof.length - 1]!;
  for (let k = 0; k < sides; k++) {
    const a0 = (Math.PI * 2 * k) / sides, a1 = (Math.PI * 2 * (k + 1)) / sides;
    d.mb.tri(d.P(s, t, zt), d.P(s + Math.cos(a0) * rt, t + Math.sin(a0) * rt, zt), d.P(s + Math.cos(a1) * rt, t + Math.sin(a1) * rt, zt), [0, 1, 0], col);
  }
}

/** Pot-à-feu de pierre posé à z : socle, vase à panse et col, flamme en pointe ; hauteur totale ≈ 1,2 × k. */
function potAFeu(d: Draw, s: number, t: number, z: number, k: number): void {
  box(d, s - 0.24 * k, s + 0.24 * k, t - 0.24 * k, t + 0.24 * k, z, z + 0.2 * k, TRIM);
  lathe(d, s, t, [[0.1, 0.2], [0.24, 0.35], [0.28, 0.5], [0.2, 0.68], [0.12, 0.74], [0.2, 0.8], [0.06, 0.88]].map(([r, h]) => [r! * k, z + h! * k] as [number, number]), TRIM);
  lathe(d, s, t, [[0.09 * k, z + 0.88 * k], [0.13 * k, z + 0.98 * k], [0.01, z + 1.25 * k]], shade(TRIM, 0.95));
}

/** Lyre rayonnante de métal sombre posée à z sur un socle, dans le plan du pignon (t fixe) : bras courbes, cordes, rayons. */
function lyre(d: Draw, s: number, t: number, z: number): void {
  const METAL = C("#3a3d3b");
  box(d, s - 0.3, s + 0.3, t - 0.3, t + 0.3, z, z + 0.4, TRIM);
  const zb = z + 0.4, h = 1.6;
  for (const k of [-1, 1]) {
    // Bras : arc qui s'écarte puis se referme vers le haut, terminé par une petite volute.
    let prev: STZ = [s + k * 0.12, t, zb];
    for (let i = 1; i <= 6; i++) {
      const f2 = i / 6, r = 0.12 + 0.45 * Math.sin(Math.PI * Math.min(1, f2 * 0.85)) + 0.05 * f2;
      const pt: STZ = [s + k * r, t, zb + h * f2];
      d.bar(prev, pt, 0.04, METAL);
      prev = pt;
    }
  }
  d.bar([s - 0.45, t, zb + h * 0.92], [s + 0.45, t, zb + h * 0.92], 0.035, METAL);
  for (const ds of [-0.15, 0, 0.15]) d.bar([s + ds, t, zb + 0.15], [s + ds, t, zb + h * 0.92], 0.012, METAL);
  // Rayons autour de la lyre.
  const zc = zb + h * 0.55;
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.05 + (0.9 * i) / 8), r0 = 1.0, r1 = i % 2 ? 1.45 : 1.75;
    d.bar([s + Math.cos(a) * r0, t, zc + Math.sin(a) * r0], [s + Math.cos(a) * r1, t, zc + Math.sin(a) * r1], 0.035, METAL);
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
