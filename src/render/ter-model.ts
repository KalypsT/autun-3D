import * as THREE from "three";
import { TER } from "../core/arrival";
import { box, merge, paint, sharedMaterial } from "./vehicle-model";

/**
 * Autorail TER de l'arrivée à la gare (D338) : une voiture à deux cabines, caisse blanche, bandeau bleu sous les vitres, jupe gris foncé,
 * bouts profilés à pare-brise incliné, deux bogies. Repère : avant vers −z, haut +y, x à droite, origine au rail au milieu de la voiture.
 * Les deux portes du côté droit (le quai quand il roule vers l'est) s'ouvrent en glissant.
 */

const WHITE = "#f2f1ec";
const ROOF = "#c9ccd0";
const BLUE = "#2a5ca8";
const SKIRT = "#3a3f47";
const GLASS = "#22303d";
const DOOR = "#8fa3b8";
const DARK = "#16191d";
const LAMP = "#fff4d0";

export class TerModel {
  readonly group = new THREE.Group();
  private readonly doors: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor() {
    const L = TER.length, W = TER.halfWidth, f = TER.floor, top = TER.roof, half = L / 2;
    const body = L - 2.4;
    const parts: THREE.BufferGeometry[] = [];
    // Caisse : jupe foncée, flancs blancs, bandeau bleu, toit gris et ses coffres.
    parts.push(box(2 * W - 0.2, 0.55, body, 0, f - 0.2, 0, SKIRT));
    parts.push(box(2 * W, top - f - 0.25, body, 0, f + (top - f - 0.25) / 2, 0, WHITE));
    parts.push(box(2 * W - 0.25, 0.3, body - 0.6, 0, top - 0.1, 0, ROOF));
    parts.push(box(1.4, 0.35, 6, 0, top + 0.2, -4, ROOF), box(1.2, 0.3, 4, 0, top + 0.18, 6, ROOF));
    for (const s of [-1, 1]) {
      parts.push(box(0.04, 0.24, body, s * (W + 0.02), f + 0.62, 0, BLUE));
      // Vitres : une bande sombre, coupée aux portes.
      for (const [z0, z1] of [[-half + 1.6, TER.door - 0.9], [TER.door + 0.9, -TER.door - 0.9], [-TER.door + 0.9, half - 1.6]] as const) {
        parts.push(box(0.04, 0.95, z1 - z0, s * (W + 0.02), f + 1.35, (z0 + z1) / 2, GLASS));
      }
      // Encadrement des portes (l'ouverture, sombre, se voit quand le vantail glisse).
      for (const z of [TER.door, -TER.door]) parts.push(box(0.03, 1.95, 1.45, s * (W + 0.005), f + 0.98, -z, DARK));
    }
    // Bouts : cabine plus basse vers l'avant, pare-brise incliné, phares, attelage.
    for (const k of [-1, 1]) {
      const z = k * (body / 2 + 0.6);
      parts.push(box(2 * W - 0.1, top - f - 0.6, 1.2, 0, f + (top - f - 0.6) / 2 - 0.05, z, WHITE));
      parts.push(box(2 * W - 0.3, 0.5, 1.3, 0, f - 0.15, z, SKIRT));
      const glass = new THREE.BoxGeometry(2 * W - 0.5, 1.0, 0.06);
      glass.rotateX(k * 0.42);
      glass.translate(0, f + 1.55, z + k * 0.45);
      parts.push(paint(glass, GLASS));
      const cap = new THREE.BoxGeometry(2 * W - 0.2, 0.08, 1.1);
      cap.translate(0, top - 0.42, z - k * 0.05);
      parts.push(paint(cap, ROOF));
      for (const s of [-1, 1]) parts.push(box(0.3, 0.14, 0.05, s * (W - 0.45), f + 0.35, z + k * 0.62, LAMP));
      parts.push(box(2 * W - 0.2, 0.18, 0.06, 0, f + 0.62, z + k * 0.6, BLUE));
      parts.push(box(0.35, 0.3, 0.6, 0, 0.75, k * (half - 0.1), DARK));
    }
    // Bogies : châssis et quatre roues chacun.
    const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12);
    wheel.rotateZ(Math.PI / 2);
    for (const zb of [-(half - 4.2), half - 4.2]) {
      parts.push(box(2 * W - 0.6, 0.45, 3, 0, 0.6, zb, DARK));
      for (const za of [-1.1, 1.1]) for (const s of [-1, 1]) parts.push(paint(wheel.clone().translate(s * 0.78, 0.42, zb + za), DARK));
    }
    wheel.dispose();
    const geo = merge(parts);
    this.geometries.push(geo);
    const mesh = new THREE.Mesh(geo, sharedMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    // Vantaux des portes du côté droit, mobiles.
    const leaf = box(0.05, 1.9, 1.35, 0, 0, 0, DOOR);
    this.geometries.push(leaf);
    for (const z of [TER.door, -TER.door]) {
      const d = new THREE.Mesh(leaf, sharedMaterial());
      d.position.set(W + 0.04, f + 0.98, -z);
      d.userData["z0"] = -z;
      this.group.add(d);
      this.doors.push(d);
    }
    this.group.rotation.order = "YXZ";
  }

  /** Place l'autorail : milieu au rail en (x, y), altitude du rail `z`, cap (rad, 0 = nord). */
  place(x: number, y: number, z: number, heading: number): void {
    this.group.position.set(x, z, -y);
    this.group.rotation.set(0, -heading, 0);
  }

  /** Portes du côté droit : 0 fermées, 1 ouvertes (le vantail glisse vers l'arrière). */
  setDoors(open: number): void {
    for (const d of this.doors) d.position.z = (d.userData["z0"] as number) + Math.min(Math.max(open, 0), 1) * 1.3;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
  }
}
