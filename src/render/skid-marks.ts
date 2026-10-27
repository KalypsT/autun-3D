import * as THREE from "three";

/**
 * Traces de pneus : des bandes sombres posées au sol derrière les roues qui glissent.
 * Un seul maillage instancié ; les plus anciennes traces sont réutilisées quand il est plein.
 */

const CAPACITY = 1500;
/** Longueur minimale d'un segment de trace (m). */
const STEP = 0.35;

export class SkidMarks {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly last = new Map<string, { x: number; y: number; z: number }>();
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor() {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: "#24232a", transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = "traces";
  }

  /**
   * Suit une roue (identifiant stable) au point (x, y, z) du repère données : tant que `on`, une bande de
   * largeur `width` relie ses positions successives ; sinon la trace s'interrompt.
   */
  trail(id: string, x: number, y: number, z: number, on: boolean, width: number): void {
    const prev = this.last.get(id);
    if (!on) {
      this.last.delete(id);
      return;
    }
    if (!prev) {
      this.last.set(id, { x, y, z });
      return;
    }
    const dx = x - prev.x, dy = y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < STEP) return;
    if (len < 3) {
      // Bande dans l'axe du déplacement : la longueur locale (z) suit (dx, −dy) dans le repère three.
      this.quat.setFromAxisAngle(this.axis, Math.atan2(-dx, dy));
      // Au-dessus de la chaussée (4,5 cm) et du marquage (8 cm) ; sous le niveau des trottoirs (15 cm).
      this.pos.set((x + prev.x) / 2, (z + prev.z) / 2 + 0.09, -(y + prev.y) / 2);
      this.matrix.compose(this.pos, this.quat, this.scale.set(width, 1, len + 0.05));
      this.mesh.setMatrixAt(this.next, this.matrix);
      this.next = (this.next + 1) % CAPACITY;
      this.mesh.count = Math.max(this.mesh.count, this.next === 0 ? CAPACITY : this.next);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    this.last.set(id, { x, y, z });
  }
}
