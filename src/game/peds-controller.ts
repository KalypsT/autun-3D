import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import { PedSim, type Observer } from "../core/pedestrians";
import type { HeightField } from "../data/types";
import { createCrowd } from "../render/crowd/crowd";
import type { CrowdRenderer } from "../render/crowd/crowd-types";
import type { NavManager } from "./nav-manager";

/**
 * Les passants du jeu : la simulation (`PedSim`), son rendu (la foule de l'étape P, un seul appel de dessin) et le réglage « Foule ».
 * Les passants n'existent qu'une fois la navigation chargée autour du joueur ; changer le nombre maximal les refabrique (nouvelle foule).
 */
export class PedsController {
  private sim: PedSim | null = null;
  private crowd: CrowdRenderer | null = null;
  private filled = false;
  private shadows = true;
  /** Durée moyenne (ms, lissée) de la simulation et de la mise à jour du dessin par image, pour la ligne de diagnostic. */
  simMs = 0;
  drawMs = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly nav: NavManager,
    private readonly terrain: HeightField,
    private readonly colliders: Colliders,
    capacity: number,
    private readonly seed = 1,
  ) {
    this.setCapacity(capacity);
  }

  get capacity(): number {
    return this.sim?.capacity ?? 0;
  }

  /** Effet des passants sur le joueur au dernier pas (choc de véhicule, bousculade) ; null sans passants. */
  get impact(): PedSim["impact"] | null {
    return this.sim?.impact ?? null;
  }

  /** Événements de la dernière image (chocs, sursauts, frôlements) : J4 (témoins) et J5 (dégâts) les liront. */
  get events(): PedSim["events"] {
    return this.sim?.events ?? [];
  }

  get stats(): PedSim["stats"] | null {
    return this.sim?.stats ?? null;
  }

  setCapacity(n: number): void {
    if (n === this.capacity) return;
    this.crowd?.dispose();
    this.crowd = null;
    this.sim = null;
    this.filled = false;
    if (n <= 0) return;
    this.sim = new PedSim(this.nav.graph, this.terrain, this.colliders, { capacity: n, seed: this.seed });
    this.crowd = createCrowd(this.scene, this.sim.state);
    this.crowd.setShadows(this.shadows);
    this.sim.onSpawn = (slot, recipe) => this.crowd?.assign?.(slot, recipe);
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    this.crowd?.setShadows(on);
  }

  /** À appeler à chaque image où le jeu tourne (pas en pause) ; `camX`, `camZ` : caméra dans le repère three (niveaux de détail). */
  update(dt: number, obs: Observer, camX: number, camZ: number): void {
    const sim = this.sim, crowd = this.crowd;
    if (!sim || !crowd || this.nav.graph.edgeCount === 0) return;
    if (!this.filled) {
      sim.prefill(obs);
      this.filled = true;
    }
    sim.clearEvents();
    const t0 = performance.now();
    sim.step(dt, obs);
    const t1 = performance.now();
    crowd.update(sim.state, camX, camZ);
    const t2 = performance.now();
    this.simMs += (t1 - t0 - this.simMs) * 0.05;
    this.drawMs += (t2 - t1 - this.drawMs) * 0.05;
  }

  dispose(): void {
    this.crowd?.dispose();
    this.crowd = null;
    this.sim = null;
  }
}
