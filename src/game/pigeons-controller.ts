import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import type { Observer } from "../core/pedestrians";
import { PigeonSim, type PigeonPeds, type PigeonStats } from "../core/pigeons";
import type { HeightField } from "../data/types";
import { PigeonRenderer } from "../render/pigeons";
import type { NavManager } from "./nav-manager";

/** Au-delà, un pigeon n'est plus qu'un point de deux pixels : on ne le dessine pas. */
const VIEW_RANGE = 100;

/**
 * Les pigeons du jeu : simulation (`PigeonSim`) et rendu (un maillage, un appel de dessin). Ils n'existent qu'une fois la navigation chargée
 * (les coins à pigeons viennent de ses points d'intérêt) ; leur nombre suit le réglage « Foule » (D45).
 */
export class PigeonsController {
  private sim: PigeonSim | null = null;
  private view: PigeonRenderer | null = null;
  private filled = false;
  /** Durée moyenne (ms, lissée) de la simulation et du recalcul des sommets par image. */
  simMs = 0;
  drawMs = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly nav: NavManager,
    private readonly terrain: HeightField,
    private readonly colliders: Colliders,
    capacity: number,
    private readonly seed = 1,
    private readonly spawnInView = false,
  ) {
    this.setCapacity(capacity);
  }

  get capacity(): number {
    return this.sim?.capacity ?? 0;
  }

  get stats(): PigeonStats | null {
    return this.sim?.stats ?? null;
  }

  setCapacity(n: number): void {
    if (n === this.capacity) return;
    this.view?.dispose();
    this.view = null;
    this.sim = null;
    this.filled = false;
    if (n <= 0) return;
    this.sim = new PigeonSim(this.nav.graph, this.terrain, this.colliders, { capacity: n, seed: this.seed, spawnInView: this.spawnInView });
    this.view = new PigeonRenderer(this.scene, n);
  }

  /** Fait s'envoler les volées posées près de (x, y) : un bruit, plus tard un tir (J5). */
  scatter(x: number, y: number, r: number): void {
    this.sim?.scatter(x, y, r);
  }

  update(dt: number, obs: Observer, peds: PigeonPeds | null): void {
    const sim = this.sim, view = this.view;
    if (!sim || !view || this.nav.graph.edgeCount === 0) return;
    if (!this.filled) {
      sim.prefill(obs);
      this.filled = true;
    }
    const t0 = performance.now();
    sim.step(dt, obs, peds);
    const t1 = performance.now();
    view.update(sim.state, obs.x, obs.y, VIEW_RANGE);
    const t2 = performance.now();
    this.simMs += (t1 - t0 - this.simMs) * 0.05;
    this.drawMs += (t2 - t1 - this.drawMs) * 0.05;
  }

  dispose(): void {
    this.view?.dispose();
    this.view = null;
    this.sim = null;
  }
}
