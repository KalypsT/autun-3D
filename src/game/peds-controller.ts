import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import { PedSim, type Observer } from "../core/pedestrians";
import { gendarmeRecipe } from "../core/character";
import { OFFICER, Officers, type Officer } from "../core/officers";
import type { HeightField } from "../data/types";
import { createCrowd } from "../render/crowd/crowd";
import type { CrowdRenderer } from "../render/crowd/crowd-types";
import type { Signals } from "../core/signals";
import type { NavManager } from "./nav-manager";

/**
 * Les passants du jeu : la simulation (`PedSim`), son rendu (la foule de l'étape P, un seul appel de dessin) et le réglage « Foule ».
 * Les passants n'existent qu'une fois la navigation chargée autour du joueur ; changer le nombre maximal les refabrique (nouvelle foule).
 */
export class PedsController {
  private sim: PedSim | null = null;
  private crowd: CrowdRenderer | null = null;
  private filled = false;
  /** Passants voulus (le réglage « Foule ») ; la foule a en plus `OFFICER.max` emplacements pour les gendarmes à pied (J4). */
  private crowdCap = -1;
  /** Graine de la recette dessinée dans chaque emplacement de gendarme (−1 : vide). */
  private readonly officerSeeds = new Int32Array(OFFICER.max).fill(-1);
  private readonly officerSeen = new Uint8Array(OFFICER.max);
  private shadows = true;
  /** Feux de circulation partagés avec les voitures : les passants attendent le feu des piétons aux passages à feux (J3-3). */
  private signals: Signals | null = null;
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

  /** Passants au plus (sans les emplacements des gendarmes). */
  get capacity(): number {
    return Math.max(this.crowdCap, 0);
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

  /** Passants vivants dans un cercle (leurs emplacements dans `out`) : les pigeons s'en servent pour savoir qui les frôle. */
  queryCircle(x: number, y: number, r: number, out: number[]): number {
    return this.sim?.queryCircle(x, y, r, out) ?? 0;
  }

  /** Passants à moins de `r` de (x, y) pour la circulation : voir `PedSim.forEachNear`. */
  forEachNear(x: number, y: number, r: number, visit: (x: number, y: number, vx: number, vy: number, engaged: boolean) => void): void {
    this.sim?.forEachNear(x, y, r, visit);
  }

  /** Fait sortir quelqu'un d'une voiture (J4) : voir `PedSim.eject` ; −1 sans passants ou sans file piétonne proche. */
  eject(x: number, y: number, seed: number, ux: number, uy: number, push: number, fromX: number, fromY: number): number {
    return this.sim?.eject(x, y, seed, ux, uy, push, fromX, fromY) ?? -1;
  }

  setCapacity(n: number): void {
    n = Math.max(0, n);
    if (n === this.crowdCap) return;
    this.crowdCap = n;
    this.crowd?.dispose();
    this.crowd = null;
    this.sim = null;
    this.filled = false;
    this.officerSeeds.fill(-1);
    // Même sans passants (« Foule : Aucune »), la foule existe pour les gendarmes à pied ; vide, elle ne coûte aucun appel de dessin.
    this.sim = new PedSim(this.nav.graph, this.terrain, this.colliders, { capacity: n + OFFICER.max, seed: this.seed, reserved: OFFICER.max });
    this.sim.signals = this.signals;
    this.crowd = createCrowd(this.scene, this.sim.state);
    this.crowd.setShadows(this.shadows);
    this.sim.onSpawn = (slot, recipe) => this.crowd?.assign?.(slot, recipe);
  }

  setSignals(signals: Signals | null): void {
    this.signals = signals;
    if (this.sim) this.sim.signals = signals;
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    this.crowd?.setShadows(on);
  }

  /** Dessine les gendarmes à pied (J4) dans les emplacements réservés de la foule. */
  setOfficers(officers: readonly Officer[], dt: number): void {
    const sim = this.sim;
    if (!sim) return;
    const base = sim.reservedStart;
    const seen = this.officerSeen;
    seen.fill(0);
    for (const o of officers) {
      if (o.slot >= OFFICER.max) continue;
      seen[o.slot] = 1;
      const fresh = this.officerSeeds[o.slot] !== o.seed;
      if (fresh) this.officerSeeds[o.slot] = o.seed;
      sim.setExternal(base + o.slot, true, fresh ? gendarmeRecipe(o.seed) : null, o.x, o.y, o.heading, o.speed, Officers.pose(o), o.poseT, dt);
    }
    for (let k = 0; k < OFFICER.max; k++) {
      if (seen[k]) continue;
      if (this.officerSeeds[k] !== -1) sim.setExternal(base + k, false, null, 0, 0, 0, 0, 0, 0, 0);
      this.officerSeeds[k] = -1;
    }
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
