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
  /** Posture du conducteur : assis qui pédale, assis sans pédaler (moto), debout, ou caché (dans une voiture). */
  readonly pose: "pedal" | "seat" | "stand" | "hidden";
  /**
   * Points d'appui du conducteur : repères attachés à la direction (poignées) et au pédalier ou au châssis (pieds, au point où la plante touche
   * le pédalier, le repose-pied ou le plateau). Ils suivent le guidon qui tourne et les pédales qui tournent. Absents pour une voiture (conducteur caché).
   */
  readonly anchors?: { gripL: THREE.Object3D; gripR: THREE.Object3D; footL: THREE.Object3D; footR: THREE.Object3D };
  /** Fait tourner le pédalier (rad) : seul le vélo en a un. */
  setCrank?(angle: number): void;
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
