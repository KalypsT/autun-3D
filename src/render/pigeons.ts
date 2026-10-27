import * as THREE from "three";
import type { PigeonState } from "../core/pigeons";

/**
 * Rendu des pigeons (J2-7, D45) : un seul maillage dessiné d'un seul appel, dont les sommets sont recalculés par le processeur à chaque image
 * (≈ 40 oiseaux × 150 sommets : bien moins cher qu'un nuanceur d'os et rien à compiler de plus).
 * Analogie : un théâtre de marionnettes — on déplace les pièces (corps, tête, ailes) puis on les photographie d'un coup.
 *
 * Modèle : repère de l'oiseau en mètres, bec vers −z (comme les personnages), pieds en y = 0, ≈ 32 cm de long. Pièces rigides rattachées à 7 os :
 * 0 corps, 1 tête, 2-3 aile gauche (interne, externe), 4-5 aile droite, 6 pattes.
 */

const BONES = 7;
const BONE = { body: 0, head: 1, leftIn: 2, leftOut: 3, rightIn: 4, rightOut: 5, legs: 6 } as const;
/** Échelle des oiseaux : un vrai pigeon (32 cm) serait un point à 15 m ; 1,3 le garde lisible sans le caricaturer. */
export const PIGEON_SCALE = 1.3;

const SHOULDER_Y = 0.14, SHOULDER_X = 0.05, INNER = 0.11, OUTER = 0.12;
const NECK: readonly [number, number, number] = [0, 0.15, -0.07];
const PITCH_PIVOT: readonly [number, number, number] = [0, 0.09, 0.02];

/** Variantes de plumage : gris bleuté (commun), sombre, clair, rousse. */
const TINTS: readonly (readonly [number, number, number])[] = [[1, 1, 1], [0.62, 0.62, 0.66], [1.5, 1.45, 1.35], [1.12, 0.88, 0.72]];

interface Template {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  bone: Uint8Array;
  /** 1 : la variante de plumage teinte ce sommet (corps, ailes) ; 0 : couleur fixe (bec, pattes). */
  tintable: Uint8Array;
  index: Uint16Array;
  verts: number;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  bone: number[] = [];
  tintable: number[] = [];
  index: number[] = [];

  private vert(p: readonly [number, number, number], n: readonly [number, number, number], c: readonly [number, number, number], bone: number, tint: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.bone.push(bone);
    this.tintable.push(tint);
    return this.bone.length - 1;
  }

  /** Ellipsoïde indexée (`seg` méridiens, `rings` anneaux entre les pôles). Couleur : dégradé de `top` (haut) à `bottom` (bas). */
  ellipsoid(c: readonly [number, number, number], r: readonly [number, number, number], seg: number, rings: number, top: readonly [number, number, number], bottom: readonly [number, number, number], bone: number, tint = 1): void {
    const first = this.bone.length;
    for (let j = 0; j <= rings; j++) {
      const v = j / rings, phi = v * Math.PI;
      for (let i = 0; i < (j === 0 || j === rings ? 1 : seg); i++) {
        const th = (i / seg) * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
        const e: [number, number, number] = [nx / r[0], ny / r[1], nz / r[2]];
        const l = Math.hypot(...e);
        const k = (ny + 1) / 2;
        const col: [number, number, number] = [bottom[0] + (top[0] - bottom[0]) * k, bottom[1] + (top[1] - bottom[1]) * k, bottom[2] + (top[2] - bottom[2]) * k];
        this.vert([c[0] + nx * r[0], c[1] + ny * r[1], c[2] + nz * r[2]], [e[0] / l, e[1] / l, e[2] / l], col, bone, tint);
      }
    }
    // Indices : anneau 0 et dernier réduits à un point.
    const at = (j: number, i: number): number => (j === 0 ? first : j === rings ? first + 1 + (rings - 1) * seg : first + 1 + (j - 1) * seg + (i % seg));
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = at(j, i), b = at(j, i + 1), c2 = at(j + 1, i), d = at(j + 1, i + 1);
        if (j === 0) this.index.push(a, c2, d);
        else if (j === rings - 1) this.index.push(a, c2, b);
        else this.index.push(a, c2, b, b, c2, d);
      }
    }
  }

  /** Quadrilatère plan (sommets a, b, c, d dans l'ordre), double face à l'affichage ; couleurs par sommet. */
  quad(a: readonly [number, number, number], b: readonly [number, number, number], c: readonly [number, number, number], d: readonly [number, number, number], colors: readonly (readonly [number, number, number])[], bone: number, tint = 1): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const i0 = this.vert(a, [nx, ny, nz], colors[0]!, bone, tint), i1 = this.vert(b, [nx, ny, nz], colors[1]!, bone, tint);
    const i2 = this.vert(c, [nx, ny, nz], colors[2]!, bone, tint), i3 = this.vert(d, [nx, ny, nz], colors[3]!, bone, tint);
    this.index.push(i0, i1, i2, i0, i2, i3);
  }

  /** Pyramide à base carrée : pointe `tip`, base centrée en `base` (plan perpendiculaire à z), demi-côté `h`. */
  beak(base: readonly [number, number, number], tip: readonly [number, number, number], h: number, col: readonly [number, number, number], bone: number): void {
    const corners: [number, number, number][] = [[base[0] - h, base[1] - h, base[2]], [base[0] + h, base[1] - h, base[2]], [base[0] + h, base[1] + h, base[2]], [base[0] - h, base[1] + h, base[2]]];
    const ids = corners.map((p) => this.vert(p, [0, 0, -1], col, bone, 0));
    const t = this.vert(tip, [0, 0, -1], col, bone, 0);
    for (let k = 0; k < 4; k++) this.index.push(ids[k]!, ids[(k + 1) % 4]!, t);
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: readonly [number, number, number], bone: number): void {
    const p: [number, number, number][] = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) p.push([x, y, z]);
    const ids = p.map((q) => this.vert(q, [0, 1, 0], col, bone, 0));
    const f = (a: number, b: number, c: number, d: number): void => { this.index.push(ids[a]!, ids[b]!, ids[c]!, ids[a]!, ids[c]!, ids[d]!); };
    f(0, 1, 3, 2); f(4, 6, 7, 5); f(0, 4, 5, 1); f(2, 3, 7, 6); f(0, 2, 6, 4); f(1, 5, 7, 3);
  }
}

function buildTemplate(): Template {
  const b = new Builder();
  const grey: [number, number, number] = [0.46, 0.52, 0.64], light: [number, number, number] = [0.64, 0.68, 0.78], dark: [number, number, number] = [0.24, 0.27, 0.38];
  const neck: [number, number, number] = [0.14, 0.3, 0.34], breast: [number, number, number] = [0.42, 0.38, 0.5];
  const beak: [number, number, number] = [0.78, 0.72, 0.66], leg: [number, number, number] = [0.72, 0.34, 0.4];
  b.ellipsoid([0, 0.115, 0.01], [0.062, 0.058, 0.115], 6, 4, grey, light, BONE.body);
  b.ellipsoid([0, 0.125, -0.05], [0.058, 0.055, 0.06], 5, 3, breast, breast, BONE.body);
  // Ailes repliées : deux flancs sombres aplatis (visibles quand les ailes sont ouvertes aussi, c'est leur base).
  for (const s of [-1, 1]) b.ellipsoid([s * 0.052, 0.128, 0.035], [0.016, 0.04, 0.095], 5, 3, dark, grey, BONE.body);
  b.ellipsoid([0, 0.16, -0.085], [0.03, 0.04, 0.035], 5, 3, neck, neck, BONE.head);
  b.ellipsoid([0, 0.188, -0.1], [0.03, 0.032, 0.034], 6, 4, [0.4, 0.43, 0.5], neck, BONE.head);
  b.beak([0, 0.183, -0.132], [0, 0.18, -0.162], 0.009, beak, BONE.head);
  // Queue : deux plaques sombres en éventail.
  b.quad([-0.03, 0.12, 0.1], [0.03, 0.12, 0.1], [0.05, 0.105, 0.215], [-0.05, 0.105, 0.215], [dark, dark, dark, dark], BONE.body);
  b.box(-0.03, -0.018, 0, 0.075, -0.005, 0.007, leg, BONE.legs);
  b.box(0.018, 0.03, 0, 0.075, -0.005, 0.007, leg, BONE.legs);
  b.box(-0.036, -0.012, 0, 0.007, -0.03, 0.012, leg, BONE.legs);
  b.box(0.012, 0.036, 0, 0.007, -0.03, 0.012, leg, BONE.legs);
  // Ailes : interne (rectangle conique) et externe (pointe effilée), de part et d'autre.
  for (const s of [-1, 1]) {
    const x0 = s * SHOULDER_X, x1 = s * (SHOULDER_X + INNER), x2 = s * (SHOULDER_X + INNER + OUTER);
    const inBone = s < 0 ? BONE.leftIn : BONE.rightIn, outBone = s < 0 ? BONE.leftOut : BONE.rightOut;
    b.quad([x0, SHOULDER_Y, -0.06], [x1, SHOULDER_Y, -0.05], [x1, SHOULDER_Y, 0.075], [x0, SHOULDER_Y, 0.09], [grey, grey, dark, grey], inBone);
    b.quad([x1, SHOULDER_Y, -0.05], [x2, SHOULDER_Y, -0.01], [x2, SHOULDER_Y, 0.04], [x1, SHOULDER_Y, 0.075], [grey, dark, dark, dark], outBone);
  }
  return {
    pos: new Float32Array(b.pos), nor: new Float32Array(b.nor), col: new Float32Array(b.col), bone: new Uint8Array(b.bone), tintable: new Uint8Array(b.tintable),
    index: new Uint16Array(b.index), verts: b.bone.length,
  };
}

const TEMPLATE = buildTemplate();
/** Sommets et triangles d'un oiseau (pour les tests et le budget). */
export const PIGEON_VERTS = TEMPLATE.verts;
export const PIGEON_TRIS = TEMPLATE.index.length / 3;

/** Matrice 3 × 4 (lignes) : m[0..3] première ligne, etc. */
type Aff = Float32Array;

/** m = a · b (transformations affines 3 × 4). */
function mul(out: Aff, a: Aff, b: Aff): void {
  for (let r = 0; r < 3; r++) {
    const a0 = a[r * 4]!, a1 = a[r * 4 + 1]!, a2 = a[r * 4 + 2]!, a3 = a[r * 4 + 3]!;
    out[r * 4] = a0 * b[0]! + a1 * b[4]! + a2 * b[8]!;
    out[r * 4 + 1] = a0 * b[1]! + a1 * b[5]! + a2 * b[9]!;
    out[r * 4 + 2] = a0 * b[2]! + a1 * b[6]! + a2 * b[10]!;
    out[r * 4 + 3] = a0 * b[3]! + a1 * b[7]! + a2 * b[11]! + a3;
  }
}

/** Rotation d'angle `a` autour de l'axe `axis` (0 : x, 2 : z) passant par le point (px, py, pz). */
function setRotAbout(m: Aff, axis: 0 | 2, a: number, px: number, py: number, pz: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  if (axis === 0) m.set([1, 0, 0, 0, 0, c, -s, py - (c * py - s * pz), 0, s, c, pz - (s * py + c * pz)]);
  else m.set([c, -s, 0, px - (c * px - s * py), s, c, 0, py - (s * px + c * py), 0, 0, 1, 0]);
}

/** Mise à l'échelle de `sx` selon x autour de x = px. */
function setScaleX(m: Aff, sx: number, px: number): void {
  m.set([sx, 0, 0, px * (1 - sx), 0, 1, 0, 0, 0, 0, 1, 0]);
}

export class PigeonRenderer {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly col: Float32Array;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly bones: Aff[] = Array.from({ length: BONES }, () => new Float32Array(12));
  private readonly t1 = new Float32Array(12);
  private readonly t2 = new Float32Array(12);
  private readonly t3 = new Float32Array(12);
  private readonly world = new Float32Array(12);
  private readonly bodyM = new Float32Array(12);
  /** Oiseaux dessinés à la dernière mise à jour. */
  drawn = 0;

  constructor(scene: THREE.Scene, private readonly capacity: number) {
    const n = Math.max(1, capacity), v = TEMPLATE.verts;
    this.pos = new Float32Array(n * v * 3);
    this.nor = new Float32Array(n * v * 3);
    this.col = new Float32Array(n * v * 3);
    const index = new Uint16Array(n * TEMPLATE.index.length);
    for (let k = 0; k < n; k++) for (let j = 0; j < TEMPLATE.index.length; j++) index[k * TEMPLATE.index.length + j] = TEMPLATE.index[j]! + k * v;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("normal", new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);
    // Un peu de lumière propre : sous la lumière chaude de la scène un gris bleuté virerait au roux (le plumage doit rester lisible).
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: new THREE.Color(0.04, 0.05, 0.07) });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Recalcule les sommets de tous les oiseaux vivants (au plus `capacity`). */
  update(s: PigeonState): void {
    let k = 0;
    for (let i = 0; i < s.capacity && k < this.capacity; i++) {
      if (!s.alive[i]) continue;
      this.pose(s, i, k++);
    }
    this.drawn = k;
    this.geometry.setDrawRange(0, k * TEMPLATE.index.length);
    this.mesh.visible = k > 0;
    for (const a of ["position", "normal", "color"] as const) this.geometry.getAttribute(a).needsUpdate = true;
  }

  private pose(s: PigeonState, i: number, slot: number): void {
    const [bones, w, t1, t2, t3] = [this.bones, this.world, this.t1, this.t2, this.t3];
    // Repère monde : échelle, cap (three : rotation y = −cap), puis position (three : x, altitude, −y).
    const c = Math.cos(-s.heading[i]!), sn = Math.sin(-s.heading[i]!), k = PIGEON_SCALE;
    w.set([c * k, 0, sn * k, s.x[i]!, 0, k, 0, s.z[i]!, -sn * k, 0, c * k, -s.y[i]!]);
    // Corps : assiette et coup de bec autour du bassin ; les pattes restent droites au sol.
    const pitch = s.pitch[i]! - 0.78 * s.peck[i]!;
    setRotAbout(t1, 0, pitch, PITCH_PIVOT[0], PITCH_PIVOT[1], PITCH_PIVOT[2]);
    mul(this.bodyM, w, t1);
    bones[BONE.body]!.set(this.bodyM);
    // Tête : avance (marche) et plongeon supplémentaire (coup de bec) autour de la base du cou.
    setRotAbout(t1, 0, -0.3 * s.peck[i]!, NECK[0], NECK[1], NECK[2]);
    t2.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, s.bob[i]!]);
    mul(t3, t2, t1);
    mul(bones[BONE.head]!, this.bodyM, t3);
    // Pattes : repliées en vol (écrasées vers la hanche), droites au sol.
    const fold = s.fold[i]!;
    t1.set([1, 0, 0, 0, 0, 1 - 0.65 * fold, 0, 0.075 * 0.65 * fold, 0, 0, 1, 0]);
    mul(bones[BONE.legs]!, fold > 0.2 ? this.bodyM : w, t1);
    // Ailes.
    for (const side of [-1, 1] as const) {
      const inner = side < 0 ? BONE.leftIn : BONE.rightIn, outer = side < 0 ? BONE.leftOut : BONE.rightOut;
      const px = side * SHOULDER_X, qx = side * (SHOULDER_X + INNER);
      // Interne : déploiement selon x puis battement autour de l'axe avant-arrière à l'épaule.
      setScaleX(t1, 0.02 + 0.98 * fold, px);
      setRotAbout(t2, 2, side * s.wing[i]!, px, SHOULDER_Y, 0);
      mul(t3, t2, t1);
      mul(bones[inner]!, this.bodyM, t3);
      // Externe : même chose puis pli supplémentaire autour de l'articulation (coude).
      setRotAbout(t1, 2, side * s.wing2[i]!, qx, SHOULDER_Y, 0);
      mul(t2, t3, t1);
      mul(bones[outer]!, this.bodyM, t2);
    }
    // Sommets.
    const v = TEMPLATE.verts, base = slot * v * 3;
    const tint = TINTS[s.tint[i]!]!;
    for (let j = 0; j < v; j++) {
      const m = bones[TEMPLATE.bone[j]!]!;
      const x = TEMPLATE.pos[j * 3]!, y = TEMPLATE.pos[j * 3 + 1]!, z = TEMPLATE.pos[j * 3 + 2]!;
      const o = base + j * 3;
      this.pos[o] = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!;
      this.pos[o + 1] = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!;
      this.pos[o + 2] = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!;
      const nx = TEMPLATE.nor[j * 3]!, ny = TEMPLATE.nor[j * 3 + 1]!, nz = TEMPLATE.nor[j * 3 + 2]!;
      let ox = m[0]! * nx + m[1]! * ny + m[2]! * nz, oy = m[4]! * nx + m[5]! * ny + m[6]! * nz, oz = m[8]! * nx + m[9]! * ny + m[10]! * nz;
      const l = Math.hypot(ox, oy, oz) || 1;
      ox /= l; oy /= l; oz /= l;
      this.nor[o] = ox;
      this.nor[o + 1] = oy;
      this.nor[o + 2] = oz;
      const f = TEMPLATE.tintable[j]!;
      this.col[o] = TEMPLATE.col[j * 3]! * (f ? tint[0] : 1);
      this.col[o + 1] = TEMPLATE.col[j * 3 + 1]! * (f ? tint[1] : 1);
      this.col[o + 2] = TEMPLATE.col[j * 3 + 2]! * (f ? tint[2] : 1);
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
