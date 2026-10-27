import * as THREE from "three";
import type { HeightField } from "../data/types";
import type { Waypoint } from "../core/waypoint";

/** Repère posé sur la carte, visible dans le monde : une colonne translucide, un losange qui tourne et un anneau au sol. */
const COLOR = "#d9472b";
const HEIGHT = 90;

export class WaypointMarker {
  readonly group = new THREE.Group();
  private readonly gem: THREE.Mesh;
  private readonly column: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private spot: Waypoint | null = null;
  private lastGround = -1;
  private ground = 0;

  constructor(private readonly terrain: HeightField) {
    // Hors brouillard et hors tonalité : la couleur reste franche à 1 km comme à 10 m.
    const solid = (opacity: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: COLOR, transparent: opacity < 1, opacity, fog: false, toneMapped: false, depthWrite: opacity >= 1 });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, HEIGHT, 10, 1, true), solid(0.55));
    this.column.position.y = HEIGHT / 2;
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), solid(1));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 28), new THREE.MeshBasicMaterial({ color: COLOR, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.12;
    this.group.add(this.column, this.gem, this.ring);
    this.group.visible = false;
  }

  set(wp: Waypoint | null): void {
    this.spot = wp;
    this.lastGround = -1;
    this.group.visible = wp !== null;
  }

  /** Chaque image : suit le relief (les blocs fins arrivent après le repère), grossit avec la distance pour rester repérable. */
  update(camX: number, camY: number, time: number): void {
    const wp = this.spot;
    if (!wp) return;
    if (time - this.lastGround > 1) {
      this.lastGround = time;
      this.ground = this.terrain.heightAt(wp.x, wp.y);
    }
    const dist = Math.hypot(wp.x - camX, wp.y - camY);
    const k = Math.min(Math.max(dist / 45, 1), 14);
    this.group.position.set(wp.x, this.ground, -wp.y);
    this.column.scale.set(k, 1, k);
    this.ring.scale.setScalar(k);
    this.gem.scale.setScalar(k);
    // Assez haut pour se voir sans lever la tête de près, et au-dessus des toits de loin.
    this.gem.position.y = 6 + 1.2 * k + Math.sin(time * 2.4) * 0.3 * k;
    this.gem.rotation.y = time * 1.6;
  }
}
