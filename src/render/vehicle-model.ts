import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { VehicleState } from "../core/vehicle";

/** Modèles de véhicules : interface commune et petits outils (pièces en couleurs de sommets, fusionnées). */

export interface VehicleModel {
  group: THREE.Group;
  /** Place le véhicule selon son état. */
  update(s: VehicleState): void;
  /** Point d'attache du conducteur (repère local : avant vers −z, haut +y). */
  readonly seat: THREE.Vector3;
  /** Posture du conducteur : assis qui pédale, assis sans pédaler (moto, scooter), assis penché sur le réservoir (moto sportive), debout, ou caché (dans une voiture). */
  readonly pose: "pedal" | "seat" | "tuck" | "stand" | "hidden";
  /**
   * Points d'appui du conducteur : repères attachés à la direction (poignées) et au pédalier ou au châssis (pieds, au point où la plante touche
   * le pédalier, le repose-pied ou le plateau). Ils suivent le guidon qui tourne et les pédales qui tournent. Absents pour une voiture (conducteur caché).
   */
  readonly anchors?: { gripL: THREE.Object3D; gripR: THREE.Object3D; footL: THREE.Object3D; footR: THREE.Object3D };
  /** Fait tourner le pédalier (rad) : seul le vélo en a un. */
  setCrank?(angle: number): void;
  /**
   * Montre les dégâts (D110) : écrasement de chaque zone, 0 à 1 (tout à zéro : neuf). Seules les voitures se déforment ; renvoie les phares
   * et feux cassés de chaque côté (pour éteindre leur lumière la nuit).
   */
  setDamage?(zones: Readonly<Record<"front" | "rear" | "left" | "right", number>>): { headRight: boolean; headLeft: boolean; tailRight: boolean; tailLeft: boolean };
  dispose(): void;
}

let material: THREE.MeshLambertMaterial | null = null;
export function sharedMaterial(): THREE.MeshLambertMaterial {
  material ??= new THREE.MeshLambertMaterial({ vertexColors: true });
  return material;
}

export function paint(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Tube de rayon r entre deux points (`capped` faux : sans bouchons, pour un tube dont les bouts sont cachés). */
export function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, color: string, segments = 6, capped = true): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, segments, 1, !capped);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return paint(g, color);
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color);
}

/** Boîte inclinée d'un angle `tilt` autour de l'axe x (positif : le haut part vers l'arrière), centrée en (x, y, z). */
export function tiltedBox(w: number, h: number, d: number, x: number, y: number, z: number, tilt: number, color: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(tilt);
  g.translate(x, y, z);
  return paint(g, color);
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}


/** Repère vide, placé en (x, y, z) dans le repère de `parent`. */
export function marker(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

export type Ring = THREE.Vector3[];

const ZERO_UV = [0, 0];

function centroid(points: readonly THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  return c.divideScalar(points.length);
}

/**
 * Volume délimité par des anneaux successifs de même nombre de coins (chacun un polygone convexe), faces planes, normales vers l'extérieur.
 * Chaque face latérale est orientée par rapport à l'axe du tronçon (centre de ses deux anneaux), chaque bouchon par rapport à l'anneau voisin :
 * cela suffit pour des sections convexes, même le long d'un profil qui ne l'est pas (capot qui monte, coffre qui redescend).
 */
export function ringLoft(rings: readonly Ring[], color: string): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const tri = (u: THREE.Vector3, v: THREE.Vector3, w: THREE.Vector3, inside: THREE.Vector3): void => {
    n.copy(ab.subVectors(v, u)).cross(ac.subVectors(w, u));
    if (n.lengthSq() < 1e-12) return;
    // La normale doit regarder à l'opposé du point intérieur.
    const mid = ab.copy(u).add(v).add(w).divideScalar(3).sub(inside);
    if (n.dot(mid) < 0) [v, w] = [w, v];
    n.copy(ab.subVectors(v, u)).cross(ac.subVectors(w, u)).normalize();
    for (const p of [u, v, w]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push(ZERO_UV[0]!, ZERO_UV[1]!);
    }
  };
  const centers = rings.map(centroid);
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!, b = rings[i + 1]!, inside = centers[i]!.clone().add(centers[i + 1]!).multiplyScalar(0.5);
    for (let k = 0; k < a.length; k++) {
      const k1 = (k + 1) % a.length;
      tri(a[k]!, a[k1]!, b[k1]!, inside);
      tri(a[k]!, b[k1]!, b[k]!, inside);
    }
  }
  // Bouchons : éventail depuis le premier coin, orienté à l'opposé de l'anneau voisin.
  for (const [cap, next] of [[0, 1], [rings.length - 1, rings.length - 2]] as const) {
    const r = rings[cap]!, inside = centers[cap]!.clone().lerp(centers[next]!, 0.5);
    for (let k = 1; k + 1 < r.length; k++) tri(r[0]!, r[k]!, r[k + 1]!, inside);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return paint(g, color);
}

/** Section ovale d'une pièce arrondie (réservoir, carénage, selle, coque) : centre (0, y) à la position z, demi-largeur w et demi-hauteur h. */
export interface PodStation {
  z: number;
  y: number;
  w: number;
  h: number;
  /** Décalage latéral du centre (pièce d'un seul côté : silencieux, couvercle). */
  x?: number;
}

/** Pièce arrondie : des sections ovales (polygones à `sides` côtés, à plat dessus et dessous) reliées de l'avant vers l'arrière. */
export function podLoft(stations: readonly PodStation[], color: string, sides = 8): THREE.BufferGeometry {
  return ringLoft(stations.map((s) => {
    const ring: Ring = [];
    for (let k = 0; k < sides; k++) {
      const a = ((k + 0.5) / sides) * Math.PI * 2;
      ring.push(new THREE.Vector3((s.x ?? 0) + s.w * Math.cos(a), s.y + s.h * Math.sin(a), s.z));
    }
    return ring;
  }), color);
}

/**
 * Garde-boue : bande courbe autour d'une roue (axe x) de centre (y, z) et de rayon r, de l'angle a0 à a1
 * (0 : vers l'avant, π/2 : en haut, π : vers l'arrière), de largeur w et d'épaisseur t.
 */
export function fender(cy: number, cz: number, r: number, a0: number, a1: number, w: number, t: number, color: string, steps = 6): THREE.BufferGeometry {
  const rings: Ring[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps, sy = Math.sin(a), sz = -Math.cos(a);
    const at = (x: number, rr: number): THREE.Vector3 => new THREE.Vector3(x, cy + rr * sy, cz + rr * sz);
    rings.push([at(-w / 2, r), at(w / 2, r), at(w / 2, r + t), at(-w / 2, r + t)]);
  }
  return ringLoft(rings, color);
}

/** Disque d'axe x (roues, moyeux, disques de frein), centré en (x, y, z). */
export function xDisc(r: number, width: number, x: number, y: number, z: number, color: string, segments = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, width, segments);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/** Disque d'axe z (phares, feux, compteurs, silencieux vus de face), centré en (x, y, z). */
export function zDisc(r: number, depth: number, x: number, y: number, z: number, color: string, segments = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, segments);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}
