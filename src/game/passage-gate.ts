import * as THREE from "three";
import type { Colliders } from "../core/collision";
import { insidePassage, syncPassageGate } from "../core/passage-gate";
import { buildPassageGates } from "../render/passage-gate";

/**
 * Grilles du passage Balthus dans le jeu (D190) : montrées, et leurs obstacles posés, de 20 h à 7 h. La fermeture attend que le joueur soit sorti du
 * couloir (voir `syncPassageGate`).
 */
export class PassageGates {
  private readonly mesh: THREE.Mesh;
  private readonly state: { closed: boolean | null } = { closed: null };

  constructor(scene: THREE.Scene, private readonly colliders: Colliders) {
    this.mesh = new THREE.Mesh(buildPassageGates(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }));
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  get closed(): boolean {
    return this.state.closed === true;
  }

  update(hour: number, playerX: number, playerY: number): void {
    if (syncPassageGate(this.colliders, hour, this.state, insidePassage(playerX, playerY))) this.mesh.visible = this.state.closed === true;
  }
}
