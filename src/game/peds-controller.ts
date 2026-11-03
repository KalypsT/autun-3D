import type { Seats } from "../core/seats";
import * as THREE from "three";
import { createDog, stepDog, type Dog, type DogOwner } from "../core/dogs";
import { DogView } from "../render/dogs";
import type { Colliders } from "../core/collision";
import { PedSim, type Observer } from "../core/pedestrians";
import type { Arena } from "../core/melee";
import { gendarmeRecipe } from "../core/character";
import { OFFICER, Officers, type Officer } from "../core/officers";
import type { HeightField } from "../data/types";
import { createCrowd } from "../render/crowd/crowd";
import type { CrowdRenderer, CrowdScope } from "../render/crowd/crowd-types";
import type { Signals } from "../core/signals";
import type { NavManager } from "./nav-manager";

/**
 * Les passants du jeu : la simulation (`PedSim`), son rendu (la foule de l'étape P, un seul appel de dessin) et le réglage « Foule ».
 * Les passants n'existent qu'une fois la navigation chargée autour du joueur ; changer le nombre maximal les refabrique (nouvelle foule).
 */
export class PedsController implements Arena {
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
  /** Chiens en laisse (D199) : un par maître vivant, et leur dessin (un appel pour les chiens, un pour les laisses). */
  readonly dogs: Dog[] = [];
  private dogView: DogView | null = null;
  private readonly owner: DogOwner = { x: 0, y: 0, heading: 0, speed: 0, sitting: false, fleeing: false };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly nav: NavManager,
    private readonly terrain: HeightField,
    private readonly colliders: Colliders,
    capacity: number,
    private readonly seed = 1,
    /** Places assises des tuiles chargées (D198) ; null : personne ne s'assoit. */
    private readonly seats: Seats | null = null,
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

  /** Combat du joueur (J5-1) : voir `Arena` ; sans passants rien n'est à portée. */
  pick(x: number, y: number, heading: number, range: number, halfAngle: number, max: number, out: number[]): number {
    if (!this.sim) {
      out.length = 0;
      return 0;
    }
    return this.sim.pick(x, y, heading, range, halfAngle, max, out);
  }

  position(slot: number, out: { x: number; y: number }): void {
    this.sim?.position(slot, out);
  }

  /** Pieds et hauteur du corps (tir, D205) : voir `PedSim.span`. */
  span(slot: number, out: { z: number; h: number }): void {
    if (this.sim) this.sim.span(slot, out);
    else {
      out.z = 0;
      out.h = 0;
    }
  }

  hurt(slot: number, damage: number, ux: number, uy: number, impulse: number): number {
    const sim = this.sim;
    if (!sim) return 0;
    // Un emplacement réservé est un gendarme (J5-5) : le coup va à `Officers` (via `officerHurt`), pas à la simulation des passants.
    if (slot >= sim.reservedStart) return this.officerHurt ? this.officerHurt(slot - sim.reservedStart, damage, ux, uy, impulse) : 0;
    return sim.damage(slot, damage, ux, uy, impulse);
  }

  /** Ce que reçoit un gendarme frappé ou touché : emplacement dans la liste réservée, dégâts, direction, impulsion ; renvoie 0, 1 (touché) ou 2 (tué). Branché par le jeu sur `Officers.hurt`. */
  officerHurt: ((index: number, damage: number, ux: number, uy: number, impulse: number) => number) | null = null;

  /** Premier passant sur un rayon (J5-3) : voir `PedSim.rayPed`. */
  rayPed(x: number, y: number, dx: number, dy: number, maxDist: number, out: { slot: number; dist: number }): boolean {
    if (!this.sim) {
      out.slot = -1;
      out.dist = maxDist;
      return false;
    }
    return this.sim.rayPed(x, y, dx, dy, maxDist, out);
  }

  /** Alarme (J5-4) : voir `PedSim.alarm`. */
  alarm(x: number, y: number, radius: number, flee: number): number {
    return this.sim?.alarm(x, y, radius, flee) ?? 0;
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
    this.dogs.length = 0;
    // Même sans passants (« Foule : Aucune »), la foule existe pour les gendarmes à pied ; vide, elle ne coûte aucun appel de dessin.
    this.sim = new PedSim(this.nav.graph, this.terrain, this.colliders, { capacity: n + OFFICER.max, seed: this.seed, reserved: OFFICER.max, life: true });
    this.sim.signals = this.signals;
    this.sim.seats = this.seats;
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
    this.dogView?.setShadows(on);
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
      // Visée : le temps passé à `setExternal` est celui depuis le dernier tir (la secousse du pistolet) ; un mort garde la pose couchée
      // (`setExternal` fige son temps).
      const pose = Officers.pose(o);
      const t = o.armed && o.mode === "run" ? o.sinceShot : o.poseT;
      sim.setExternal(base + o.slot, true, fresh ? gendarmeRecipe(o.seed) : null, o.x, o.y, o.heading, o.speed, pose, t, dt, o.armed && o.mode !== "dead", o.mode === "dead", o.pushDir, o.pushAmp);
    }
    for (let k = 0; k < OFFICER.max; k++) {
      if (seen[k]) continue;
      if (this.officerSeeds[k] !== -1) sim.setExternal(base + k, false, null, 0, 0, 0, 0, 0, 0, 0);
      this.officerSeeds[k] = -1;
    }
  }

  /** À appeler à chaque image où le jeu tourne (pas en pause) ; `camX`, `camZ` : caméra dans le repère three (niveaux de détail). */
  /** Regard dans une lunette (D207), ou null : voir `CrowdScope`. */
  scope: CrowdScope | null = null;

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
    crowd.update(sim.state, camX, camZ, this.scope);
    this.updateDogs(dt, sim);
    const t2 = performance.now();
    this.simMs += (t1 - t0 - this.simMs) * 0.05;
    this.drawMs += (t2 - t1 - this.drawMs) * 0.05;
  }

  /** Chiens : naissent avec leur maître, le suivent, disparaissent avec lui (ou quand il tombe). */
  private updateDogs(dt: number, sim: PedSim): void {
    const seen = new Set<number>();
    const o = this.owner;
    sim.forEachDogOwner((slot, id, x, y, heading, speed, sitting, fleeing) => {
      o.x = x; o.y = y; o.heading = heading; o.speed = speed; o.sitting = sitting; o.fleeing = fleeing;
      let d = this.dogs.find((k) => k.slot === slot && k.owner === id);
      if (!d) {
        if (this.dogs.length >= 24) return;
        d = createDog(id, slot, o);
        this.dogs.push(d);
      }
      seen.add(slot);
      stepDog(d, o, dt);
    });
    for (let k = this.dogs.length - 1; k >= 0; k--) if (!seen.has(this.dogs[k]!.slot)) this.dogs.splice(k, 1);
    if (!this.dogView && this.dogs.length) {
      this.dogView = new DogView(this.scene);
      this.dogView.setShadows(this.shadows);
    }
    const st = sim.state;
    this.dogView?.update(this.dogs, (x, y) => this.terrain.heightAt(x, y), (d, out) => {
      const i = d.slot;
      // La main gauche du maître (côté du chien), à hauteur de hanche (un peu plus bas assis).
      const h = -st.yaw[i]!, rx = Math.cos(h) * d.side, ry = -Math.sin(h) * d.side;
      const sit = st.pose![i] === 5;
      out.set(st.x[i]! + rx * 0.24, st.y[i]! + (sit ? 0.62 : 0.82) * (st.recipes[i]!.height / 1.75), st.z[i]! - ry * 0.24);
      return true;
    });
  }

  dispose(): void {
    this.crowd?.dispose();
    this.crowd = null;
    this.sim = null;
    this.dogView?.dispose();
    this.dogView = null;
    this.dogs.length = 0;
  }
}
