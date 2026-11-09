import * as THREE from "three";
import { MeshBuilder, type Vec3 } from "./geometry";

/**
 * Éclairage des monuments la nuit par projecteurs (D297). Avant, chaque face était recopiée dans le maillage allumé (`glow`, matière sans
 * éclairage) avec un dégradé figé du pied vers le haut : le monument sortait entier, uniformément lumineux. Ici, chaque projecteur a une
 * position au sol, un axe et une ouverture ; un sommet reçoit la somme de ce qui l'atteint (distance, angle d'incidence, place dans le
 * faisceau). La copie est un voile : sa couleur est celle de la pierre éclairée, son opacité la quantité de lumière reçue. Là où rien
 * n'arrive, elle est transparente et l'on voit le mur de nuit (coins non couverts, faces tournées ailleurs, dessus des corniches).
 *
 * Coût : aucun appel de dessin (le voile va dans le maillage allumé de la tuile, les taches au sol dans celui des halos) ; les faces sont
 * découpées en carreaux plus fins près des projecteurs, et les carreaux sans lumière ne sont pas recopiés.
 */

/** Teinte unique des projecteurs de la ville (choix de l'utilisateur) : blanc chaud. */
export const FLOOD_TINT = new THREE.Color("#ffd49a");
/** Tache de lumière au sol devant un projecteur (dans les halos). */
const POOL_TINT = new THREE.Color("#ffc878");

export interface Projector {
  /** Position de la lentille (repère three). */
  p: Vec3;
  /** Axe du faisceau, unitaire (repère three). */
  d: Vec3;
  /** Pleine lumière jusqu'à `inner` de l'axe, plus rien au-delà de `outer` (radians). */
  inner: number;
  outer: number;
  /** Éclairement dans l'axe, de près ; décroît avec la distance au-delà de `range` mètres. */
  power: number;
  range: number;
}

/** Projecteur posé au sol en `foot` (repère three) et pointé vers `target`. */
export function aimAt(foot: Vec3, target: Vec3, o: { inner?: number; outer?: number; power?: number; range?: number } = {}): Projector {
  const dx = target[0] - foot[0], dy = target[1] - foot[1], dz = target[2] - foot[2], l = Math.hypot(dx, dy, dz) || 1;
  return { p: foot, d: [dx / l, dy / l, dz / l], inner: o.inner ?? 0.5, outer: o.outer ?? 0.95, power: o.power ?? 2, range: o.range ?? 6 };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Éclairement reçu au point `p` d'une face de normale `n` (repère three). */
export function irradiance(projectors: readonly Projector[], p: Vec3, n: Vec3): number {
  let e = 0;
  for (const pr of projectors) {
    const vx = p[0] - pr.p[0], vy = p[1] - pr.p[1], vz = p[2] - pr.p[2];
    const d = Math.hypot(vx, vy, vz);
    if (d < 1e-3) continue;
    const lx = vx / d, ly = vy / d, lz = vz / d;
    // La face doit regarder le projecteur ; l'incidence rasante est adoucie (la pierre diffuse, les faisceaux se recouvrent).
    const inc = -(n[0] * lx + n[1] * ly + n[2] * lz);
    if (inc <= 0) continue;
    const off = Math.acos(Math.min(1, Math.max(-1, lx * pr.d[0] + ly * pr.d[1] + lz * pr.d[2])));
    const cone = 1 - smooth(pr.inner, pr.outer, off);
    if (cone <= 0) continue;
    e += (pr.power * cone * (0.3 + 0.7 * inc)) / (1 + (d / pr.range) ** 2);
  }
  return e;
}

/** Opacité du voile pour un éclairement (montée douce, plafonnée). */
export const veil = (e: number): number => Math.min(0.95, 1 - Math.exp(-1.4 * e));

/** Pinceau de nuit d'un monument : chaque face confiée à `quad` / `tri` reçoit son voile de lumière. */
export class Floodlight {
  /** Triangles du voile (mesure). */
  triangles = 0;
  private readonly tmp = [new THREE.Color(), new THREE.Color(), new THREE.Color()] as const;

  /** `grain` : taille des carreaux rapportée à la distance au projecteur le plus proche (plus grand : moins de triangles, taches moins nettes). */
  /**
   * `smooth` : normale servant au calcul de la lumière à la place de celle de la face (surfaces irrégulières comme le blocage de Couhard,
   * dont chaque pan a sa propre orientation : sans elle, le voile fait un damier).
   */
  constructor(readonly glow: MeshBuilder, readonly projectors: readonly Projector[], readonly grain = 0.3, readonly smooth: ((p: Vec3, n: Vec3) => Vec3) | null = null) {}

  /** Taille des carreaux près de `p` : 0,5 m au pied d'un projecteur, jusqu'à 10 × `grain` m loin. */
  private cell(p: Vec3): number {
    let best = Infinity;
    for (const pr of this.projectors) best = Math.min(best, Math.hypot(p[0] - pr.p[0], p[1] - pr.p[1], p[2] - pr.p[2]));
    return Math.min(10 * this.grain, Math.max(0.5, this.grain * best));
  }

  private shade(p: Vec3, n: Vec3, albedo: THREE.Color, out: THREE.Color): number {
    const e = irradiance(this.projectors, p, this.smooth ? this.smooth(p, n) : n);
    // Pierre éclairée : sa couleur dans la teinte des projecteurs, un peu plus claire là où la lumière est forte.
    out.copy(albedo).multiply(FLOOD_TINT).multiplyScalar(0.8 + 0.35 * Math.min(e, 1.5));
    // Vitres éteintes (teintes bleues) : le verre ne renvoie pas la lumière des projecteurs ; sans ce frein, bleu × chaud tourne au vert.
    return albedo.b > albedo.r * 1.1 ? 0.15 * veil(e) : veil(e);
  }

  /** Triangle à voile, sans découpe. */
  private emit(a: Vec3, b: Vec3, c: Vec3, n: Vec3, albedo: THREE.Color): void {
    const [ca, cb, cc] = this.tmp;
    const aa = this.shade(a, n, albedo, ca), ab = this.shade(b, n, albedo, cb), ac = this.shade(c, n, albedo, cc);
    if (aa < 0.02 && ab < 0.02 && ac < 0.02) return;
    this.glow.triColors(a, b, c, n, ca, cb, cc, aa, ab, ac);
    this.triangles++;
  }

  /** Quad (a, b, c, d dans l'ordre du tour), découpé en grille selon la distance aux projecteurs. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, albedo: THREE.Color): void {
    const mid: Vec3 = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
    const cs = this.cell(mid);
    const len = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const nu = Math.min(24, Math.max(1, Math.ceil(Math.max(len(a, b), len(d, c)) / cs)));
    const nv = Math.min(24, Math.max(1, Math.ceil(Math.max(len(a, d), len(b, c)) / cs)));
    const at = (u: number, v: number): Vec3 => {
      const s = u / nu, t = v / nv;
      return [0, 1, 2].map((k) => (1 - t) * ((1 - s) * a[k]! + s * b[k]!) + t * ((1 - s) * d[k]! + s * c[k]!)) as Vec3;
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const p00 = at(i, j), p10 = at(i + 1, j), p11 = at(i + 1, j + 1), p01 = at(i, j + 1);
        this.emit(p00, p10, p11, n, albedo);
        this.emit(p00, p11, p01, n, albedo);
      }
    }
  }

  /** Triangle, coupé en quatre tant que ses côtés dépassent la taille des carreaux. */
  tri(a: Vec3, b: Vec3, c: Vec3, n: Vec3, albedo: THREE.Color, depth = 0): void {
    const mid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const long = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    if (depth >= 4 || long <= this.cell(mid) * 1.2) {
      this.emit(a, b, c, n, albedo);
      return;
    }
    const m = (p: Vec3, q: Vec3): Vec3 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    const ab = m(a, b), bc = m(b, c), ca = m(c, a);
    this.tri(a, ab, ca, n, albedo, depth + 1);
    this.tri(ab, b, bc, n, albedo, depth + 1);
    this.tri(ca, bc, c, n, albedo, depth + 1);
    this.tri(ab, bc, ca, n, albedo, depth + 1);
  }
}

/**
 * Projecteurs visibles et taches au sol (D297) : boîtier gris sombre encastré, lentille allumée (maillage allumé), tache chaude au sol qui
 * s'efface vers les bords (halos, opacité par sommet). `ground` : altitude du sol en (x, z) three.
 */
export function drawProjectors(mb: MeshBuilder, glow: MeshBuilder, halo: MeshBuilder | null, projectors: readonly Projector[], ground: (x: number, z: number) => number): void {
  const CASE = new THREE.Color("#3a3d40"), LENS = new THREE.Color("#fff1cf");
  const clear = new THREE.Color(0, 0, 0);
  for (const pr of projectors) {
    const [x, , z] = pr.p;
    const g = ground(x, z);
    // Boîtier : pavé de 36 × 36 cm, 12 cm au-dessus du sol (le dessus est la lentille, tournée vers le ciel).
    const h = 0.18, top = g + 0.12;
    const P = (dx: number, dz: number, y: number): Vec3 => [x + dx, y, z + dz];
    const sides: [number, number, Vec3][] = [[1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]]];
    for (const [sx, sz, n] of sides) {
      const ox = sx * h, oz = sz * h, px = sz * h, pz = sx * h;
      mb.quad(P(ox - px, oz - pz, g - 0.05), P(ox + px, oz + pz, g - 0.05), P(ox + px, oz + pz, top), P(ox - px, oz - pz, top), n, CASE);
    }
    mb.quad(P(-h, -h, top), P(h, -h, top), P(h, h, top), P(-h, h, top), [0, 1, 0], CASE);
    glow.quad(P(-h + 0.05, -h + 0.05, top + 0.005), P(h - 0.05, -h + 0.05, top + 0.005), P(h - 0.05, h - 0.05, top + 0.005), P(-h + 0.05, h - 0.05, top + 0.005), [0, 1, 0], LENS);
    // Tache au sol : disque de 1,8 m autour du projecteur (un peu en arrière : le faisceau part vers le monument), opaque au milieu, nul au bord.
    if (!halo) continue;
    const hl = Math.hypot(pr.d[0], pr.d[2]) || 1;
    const cx = x - (pr.d[0] / hl) * 0.3, cz = z - (pr.d[2] / hl) * 0.3, r = 1.8, seg = 16;
    const c: Vec3 = [cx, ground(cx, cz) + 0.06, cz];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const e0x = cx + r * Math.cos(a0), e0z = cz + r * Math.sin(a0), e1x = cx + r * Math.cos(a1), e1z = cz + r * Math.sin(a1);
      halo.triColors(c, [e0x, ground(e0x, e0z) + 0.06, e0z], [e1x, ground(e1x, e1z) + 0.06, e1z], [0, 1, 0], POOL_TINT, clear, clear, 1, 0, 0);
    }
  }
}

/**
 * Pinceau qui passe tout ce qu'on lui dessine au voile de `fl` (la couleur donnée est celle de la pierre) : pour les fonctions de dessin
 * qui écrivent dans un `MeshBuilder` (baies, encadrements, modénature).
 */
export class VeilBuilder extends MeshBuilder {
  constructor(private readonly fl: Floodlight) {
    super();
  }

  override tri(a: Vec3, b: Vec3, c: Vec3, n: Vec3, color: THREE.Color): void {
    this.fl.tri(a, b, c, n, color);
  }

  override quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, color: THREE.Color): void {
    this.fl.quad(a, b, c, d, n, color);
  }

  override quadGradient(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, low: THREE.Color): void {
    this.fl.quad(a, b, c, d, n, low);
  }
}

/** Mur qui part du sol, relevé pour placer les projecteurs : pied de a à b (repère three), normale horizontale vers l'extérieur, haut. */
export interface FootWall {
  a: Vec3;
  b: Vec3;
  n: Vec3;
  h: number;
}

/**
 * Projecteurs posés d'office au pied des murs relevés (D297) : un tous les `step` mètres environ, à `out` mètres devant le mur, pointé vers
 * lui à `aim` × sa hauteur (6 m au plus). Une place qui tombe derrière un autre mur relevé (dans le bâtiment, entre deux contreforts trop
 * serrés) ou à moins de 0,8 m d'un mur est écartée. `ground(x, z)` : altitude du sol (repère three).
 */
export function projectorsAlong(walls: readonly FootWall[], ground: (x: number, z: number) => number, o: { step?: number; out?: number; aim?: number; power?: number; range?: number; avoid?: readonly FootWall[] } = {}): Projector[] {
  const step = o.step ?? 8, out = o.out ?? 1.5, aim = o.aim ?? 0.4;
  const all = o.avoid ? [...walls, ...o.avoid] : walls;
  const near = (x: number, z: number, self: FootWall): boolean => all.some((w) => {
    if (w === self) return false;
    const ux = w.b[0] - w.a[0], uz = w.b[2] - w.a[2], l2 = ux * ux + uz * uz;
    if (l2 < 1e-6) return false;
    const k = ((x - w.a[0]) * ux + (z - w.a[2]) * uz) / l2;
    if (k < 0 || k > 1) return false;
    const px = w.a[0] + k * ux - x, pz = w.a[2] + k * uz - z, dist = Math.hypot(px, pz);
    // Derrière ce mur (du côté opposé à sa normale), tout près : dans le bâtiment.
    const behind = (x - w.a[0] - k * ux) * w.n[0] + (z - w.a[2] - k * uz) * w.n[2] < 0;
    return dist < 0.8 || (behind && dist < 4);
  });
  const out_: Projector[] = [];
  for (const w of walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[2] - w.a[2]);
    if (len < 1.5) continue;
    const k = Math.max(1, Math.round(len / step));
    for (let i = 0; i < k; i++) {
      const u = (i + 0.5) / k;
      const wx = w.a[0] + (w.b[0] - w.a[0]) * u, wz = w.a[2] + (w.b[2] - w.a[2]) * u, wy = w.a[1] + (w.b[1] - w.a[1]) * u;
      const x = wx + w.n[0] * out, z = wz + w.n[2] * out;
      if (near(x, z, w)) continue;
      out_.push(aimAt([x, ground(x, z) + 0.12, z], [wx, wy + Math.min(6, aim * w.h), wz], { power: o.power ?? 2.2, range: o.range ?? 9 }));
    }
  }
  return out_;
}
