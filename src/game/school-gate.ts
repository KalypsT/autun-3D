import * as THREE from "three";
import type { Colliders } from "../core/collision";
import { SCHOOL_GATE, syncGate, type SchoolGateSpec } from "../core/school-gate";
import type { HeightField } from "../data/types";
import { buildGateLeaves } from "../render/vallon-gate";

/**
 * Grille du collège du Vallon dans le jeu (D174) : ses vantaux fermés ne sont montrés, et son obstacle posé, qu'en dehors des heures de classe
 * (de 7 h 30 à 18 h elle est ouverte : on passe). L'obstacle est étiqueté (`GATE_TAG`) : il se retire d'un coup à l'ouverture.
 */
export class SchoolGate {
  private readonly mesh: THREE.Mesh;
  private readonly state: { closed: boolean | null } = { closed: null };

  constructor(scene: THREE.Scene, private readonly colliders: Colliders, terrain: HeightField, private readonly spec: SchoolGateSpec = SCHOOL_GATE) {
    this.mesh = new THREE.Mesh(buildGateLeaves(spec, terrain), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }));
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Vrai si la grille est fermée à l'instant. */
  get closed(): boolean {
    return this.state.closed === true;
  }

  update(hour: number): void {
    if (syncGate(this.colliders, hour, this.state, this.spec)) this.mesh.visible = this.state.closed === true;
  }
}
