import * as THREE from "three";
import type { Zone } from "../core/damage";

/**
 * Carrosserie abîmée de la voiture conduite (D110) : les sommets de la caisse et des détails sont déplacés selon l'écrasement de chaque zone
 * (D109), avec un bruit propre à chaque point (le métal se froisse en facettes, style « affiche ») ; la peinture se ternit là où elle a pris ;
 * phares et feux cassés s'éteignent, vitres touchées se fêlent (verre plus clair). Analogie : une boîte de conserve qu'on cabosse, sans la recouper.
 * Les positions et couleurs d'origine sont gardées : chaque nouvel état repart d'elles (aucune accumulation d'erreurs), et une réparation rend la voiture neuve.
 */

/** Ce qu'il faut savoir de la caisse pour la froisser (repère du véhicule : avant vers −z). */
export interface CrumpleFrame {
  noseZ: number;
  tailZ: number;
  /** Demi-largeur hors tout. */
  halfWidth: number;
  /** Ligne de ceinture : au-dessus, le capot et le coffre se soulèvent en se pliant. */
  belt: number;
  /** Couleurs reconnues dans les détails : phares et clignotants, feux arrière, verre. */
  light: readonly string[];
  tail: readonly string[];
  glass: string;
}

/** Enfoncement maximal (m) d'une zone tout à fait écrasée : avant et arrière, flancs. */
export const CRUSH = { end: 0.34, side: 0.15 } as const;
const BROKEN = new THREE.Color("#3b3d42");
const BROKEN_TAIL = new THREE.Color("#5a2a24");
const CRACKED = new THREE.Color("#a9b4bd");

/** Bruit déterministe dans [−1, 1] d'un point : deux sommets confondus bougent pareil (pas de fente entre faces). */
function noise(x: number, y: number, z: number): number {
  const s = Math.sin(Math.round(x * 50) * 127.1 + Math.round(y * 50) * 311.7 + Math.round(z * 50) * 74.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Déplacement d'un point d'origine selon l'écrasement des zones (0 à 1) : écrit dans `out` (x, y, z), et renvoie l'usure locale (0 à 1),
 * qui ternit la peinture.
 */
export function crumplePoint(x: number, y: number, z: number, zones: Readonly<Record<Zone, number>>, f: CrumpleFrame, out: THREE.Vector3): number {
  out.set(x, y, z);
  const n = noise(x, y, z), length = f.tailZ - f.noseZ;
  let wear = 0;
  // Avant et arrière : le bout recule vers le milieu, se resserre un peu, et le capot ou le coffre se soulève en se pliant.
  for (const [d, end, dir] of [[zones.front, f.noseZ, 1], [zones.rear, f.tailZ, -1]] as const) {
    if (!(d > 0)) continue;
    const reach = (0.35 + 0.6 * d) * Math.min(1, length / 4.2);
    const t = smooth(1 - Math.abs(z - end) / reach);
    if (t <= 0) continue;
    const push = d * CRUSH.end * t;
    out.z += dir * push * (1 + 0.3 * n);
    out.x *= 1 - 0.07 * d * t;
    out.y += y > f.belt * 0.85 ? push * 0.35 * (0.5 + n) : -push * 0.15;
    wear = Math.max(wear, d * t);
  }
  // Flancs : enfoncés vers l'intérieur, surtout au milieu de la longueur et à mi-hauteur.
  for (const [d, side] of [[zones.left, -1], [zones.right, 1]] as const) {
    if (!(d > 0) || x * side <= 0) continue;
    const reach = 0.22 + 0.25 * d;
    const t = smooth(1 - (f.halfWidth - x * side) / reach);
    if (t <= 0) continue;
    const along = 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, (z - f.noseZ) / length)));
    const push = d * CRUSH.side * t * along;
    out.x -= side * push * (1 + 0.35 * n);
    out.y -= push * 0.2 * n;
    wear = Math.max(wear, d * t * along);
  }
  return wear;
}

/** Une géométrie de la voiture conduite (peinture ou détails), avec ses positions et couleurs d'origine. */
export class Crumpler {
  private readonly pos0: Float32Array;
  private readonly col0: Float32Array;
  private readonly v = new THREE.Vector3();
  private readonly lights: THREE.Color[];
  private readonly tails: THREE.Color[];
  private readonly glass: THREE.Color;

  /**
   * `paint` : la caisse peinte (sinon les détails) ; `tarnish` faux : la peinture n'est pas ternie (forme commune dessinée par instances, D112 :
   * seuls les sommets blanc pur prennent la couleur de l'exemplaire).
   */
  constructor(private readonly geo: THREE.BufferGeometry, private readonly frame: CrumpleFrame, private readonly paint: boolean, private readonly tarnish = true) {
    this.pos0 = (geo.getAttribute("position").array as Float32Array).slice();
    this.col0 = (geo.getAttribute("color").array as Float32Array).slice();
    this.lights = frame.light.map((c) => new THREE.Color(c));
    this.tails = frame.tail.map((c) => new THREE.Color(c));
    this.glass = new THREE.Color(frame.glass);
  }

  /** Applique l'état des zones (tout à zéro : la voiture neuve). Renvoie les phares et feux cassés de chaque côté. */
  apply(zones: Readonly<Record<Zone, number>>): BrokenLamps {
    const broken = brokenLamps(zones);
    const pos = this.geo.getAttribute("position") as THREE.BufferAttribute, col = this.geo.getAttribute("color") as THREE.BufferAttribute;
    const p = pos.array as Float32Array, c = col.array as Float32Array, p0 = this.pos0, c0 = this.col0, f = this.frame;
    const tmp = new THREE.Color();
    for (let i = 0; i < p0.length; i += 3) {
      const wear = crumplePoint(p0[i]!, p0[i + 1]!, p0[i + 2]!, zones, f, this.v);
      p[i] = this.v.x;
      p[i + 1] = this.v.y;
      p[i + 2] = this.v.z;
      tmp.setRGB(c0[i]!, c0[i + 1]!, c0[i + 2]!);
      if (this.paint) {
        // Peinture ternie là où la tôle a pris.
        if (this.tarnish) tmp.multiplyScalar(1 - 0.35 * wear);
      } else {
        const x = p0[i]!, z = p0[i + 2]!, right = x > 0;
        if (z < f.noseZ + 0.2 && this.lights.some((l) => close(l, tmp)) && (right ? broken.headRight : broken.headLeft)) tmp.copy(BROKEN);
        else if (z > f.tailZ - 0.2 && this.tails.some((l) => close(l, tmp)) && (right ? broken.tailRight : broken.tailLeft)) tmp.copy(BROKEN_TAIL);
      }
      c[i] = tmp.r;
      c[i + 1] = tmp.g;
      c[i + 2] = tmp.b;
    }
    if (!this.paint) this.crack(zones, c);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    return broken;
  }

  /** Vitres fêlées : chaque triangle de verre dont la zone (d'après son orientation d'origine) est assez écrasée prend un verre clair. */
  private crack(zones: Readonly<Record<Zone, number>>, c: Float32Array): void {
    const p0 = this.pos0, c0 = this.col0, tmp = new THREE.Color();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    for (let i = 0; i < p0.length; i += 9) {
      tmp.setRGB(c0[i]!, c0[i + 1]!, c0[i + 2]!);
      if (!close(tmp, this.glass)) continue;
      a.set(p0[i + 3]! - p0[i]!, p0[i + 4]! - p0[i + 1]!, p0[i + 5]! - p0[i + 2]!);
      b.set(p0[i + 6]! - p0[i]!, p0[i + 7]! - p0[i + 1]!, p0[i + 8]! - p0[i + 2]!);
      d.crossVectors(a, b).normalize();
      // Orientation du triangle : vers l'avant (pare-brise), l'arrière (lunette), un flanc.
      const zone: Zone = Math.abs(d.z) > Math.abs(d.x) ? (d.z < 0 ? "front" : "rear") : d.x < 0 ? "left" : "right";
      if (zones[zone] < 0.55) continue;
      const shade = 0.9 + 0.1 * noise(p0[i]!, p0[i + 1]!, p0[i + 2]!);
      for (let k = 0; k < 9; k += 3) {
        c[i + k] = CRACKED.r * shade;
        c[i + k + 1] = CRACKED.g * shade;
        c[i + k + 2] = CRACKED.b * shade;
      }
    }
  }
}

function close(a: THREE.Color, b: THREE.Color): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.02;
}

/** Phares (avant) et feux (arrière) cassés, à droite (x > 0) et à gauche. */
export interface BrokenLamps {
  headRight: boolean;
  headLeft: boolean;
  tailRight: boolean;
  tailLeft: boolean;
}

/** Un bout écrasé à plus de 45 % casse le phare du côté le plus touché ; à plus de 80 %, les deux. */
export function brokenLamps(zones: Readonly<Record<Zone, number>>): BrokenLamps {
  const side = (end: number, mine: number, other: number, tie: boolean): boolean => end > 0.8 || (end > 0.45 && (mine > other || (mine === other && tie)));
  return {
    headRight: side(zones.front, zones.right, zones.left, true),
    headLeft: side(zones.front, zones.left, zones.right, false),
    tailRight: side(zones.rear, zones.right, zones.left, true),
    tailLeft: side(zones.rear, zones.left, zones.right, false),
  };
}
