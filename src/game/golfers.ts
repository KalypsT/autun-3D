import * as THREE from "three";
import { recipeFromSeed } from "../core/character";
import { phaseRate } from "../core/character-rig";
import { GolfRound, type Golfer } from "../core/golfers";
import type { GolfSite, HeightField } from "../data/types";
import { createCrowd } from "../render/crowd/crowd";
import { createCrowdState, type CrowdRenderer, type CrowdState } from "../render/crowd/crowd-types";
import { MeshBuilder, toThree } from "../render/geometry";
import { sharedMaterial } from "../render/vehicle-model";

/** Le golf est actif à moins de cette distance du joueur (m) : au-delà, ni simulation ni dessin. */
const NEAR = 700;
const HOURS: [number, number] = [8, 20];

/** Chariot de golf poussé : deux roues, châssis, sac (repère local : x à droite, y vers l'avant, z vers le haut). */
function trolleyGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, hex: string): void => {
    const c = new THREE.Color(hex);
    const P = (x: number, y: number, z: number): [number, number, number] => toThree(cx + x, cy + y, cz + z);
    mb.quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), [0, 1, 0], c);
    mb.quad(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), toThree(0, -1, 0), c);
    mb.quad(P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz), toThree(0, 1, 0), c);
    mb.quad(P(-hx, -hy, -hz), P(-hx, hy, -hz), P(-hx, hy, hz), P(-hx, -hy, hz), toThree(-1, 0, 0), c);
    mb.quad(P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(hx, -hy, hz), toThree(1, 0, 0), c);
  };
  for (const x of [-0.24, 0.24]) box(x, 0.25, 0.14, 0.03, 0.14, 0.14, "#25282a");
  box(0, 0.1, 0.32, 0.22, 0.03, 0.03, "#7d8388");
  box(0, -0.05, 0.62, 0.02, 0.02, 0.45, "#7d8388");
  box(0, 0.08, 0.62, 0.13, 0.11, 0.38, "#1f2a44");
  box(0, 0.08, 1.06, 0.1, 0.08, 0.08, "#c9ccce");
  return mb.build();
}

/**
 * Les golfeurs dans le jeu (D291) : une petite foule à part (un appel de dessin), menée par `GolfRound`, et les chariots (un appel). On ne
 * joue au golf que de jour, hors pluie, et seulement quand le joueur est assez près pour les voir.
 */
export class GolfersController {
  private round: GolfRound | null = null;
  private site: GolfSite | null = null;
  private state: CrowdState | null = null;
  private crowd: CrowdRenderer | null = null;
  private trolleys: THREE.InstancedMesh | null = null;
  private readonly list: Golfer[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private shadows = true;

  constructor(private readonly scene: THREE.Scene, private readonly terrain: HeightField) {}

  /** Le site du golf, lu dans les tuiles chargées (absent : rien). */
  setSite(site: GolfSite | null): void {
    if (site === this.site) return;
    this.site = site;
    this.dispose();
    if (!site?.holes?.length) return;
    this.round = new GolfRound(site);
    const n = this.round.capacity;
    this.state = createCrowdState(Array.from({ length: n }, (_, i) => recipeFromSeed(77_000 + i * 13)));
    this.state.alive = new Uint8Array(n);
    this.crowd = createCrowd(this.scene, this.state);
    this.crowd.setShadows(this.shadows);
    this.trolleys = new THREE.InstancedMesh(trolleyGeometry(), sharedMaterial(), n);
    this.trolleys.count = 0;
    this.trolleys.frustumCulled = false;
    this.scene.add(this.trolleys);
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    this.crowd?.setShadows(on);
  }

  update(dt: number, px: number, py: number, hour: number, rain: number, camX: number, camZ: number): void {
    const round = this.round, st = this.state, site = this.site;
    if (!round || !st || !site?.holes?.length) return;
    const [hx, hy] = site.holes[0]!;
    const active = hour >= HOURS[0] && hour < HOURS[1] && rain < 0.2 && Math.hypot(px - hx, py - hy) < NEAR + 500;
    st.alive!.fill(0);
    if (!active) {
      this.trolleys!.count = 0;
      this.crowd!.update(st, camX, camZ);
      return;
    }
    round.step(dt);
    const n = round.golfers(this.list);
    let t = 0;
    for (let i = 0; i < n; i++) {
      const g = this.list[i]!;
      st.alive![i] = 1;
      st.x[i] = g.x;
      st.z[i] = -g.y;
      st.y[i] = this.terrain.heightAt(g.x, g.y);
      st.yaw[i] = -g.heading;
      st.speed[i] = g.speed;
      if (g.speed > 0) st.phase[i] = (st.phase[i]! + phaseRate(g.speed, st.recipes[i]!.height) * dt) % (Math.PI * 2);
      if (g.trolley) {
        // Le chariot devant le joueur, un peu à droite.
        const fx = Math.sin(g.heading), fy = Math.cos(g.heading);
        const cx = g.x + fx * 0.75 + fy * 0.25, cy = g.y + fy * 0.75 - fx * 0.25;
        this.q.setFromAxisAngle(this.up, -g.heading);
        this.m.compose(new THREE.Vector3(cx, this.terrain.heightAt(cx, cy), -cy), this.q, new THREE.Vector3(1, 1, 1));
        this.trolleys!.setMatrixAt(t++, this.m);
      }
    }
    this.trolleys!.count = t;
    this.trolleys!.instanceMatrix.needsUpdate = true;
    this.crowd!.update(st, camX, camZ);
  }

  /** Golfeurs visibles (essais). */
  get visible(): number {
    return this.state?.alive ? this.state.alive.reduce((a, b) => a + b, 0) : 0;
  }

  dispose(): void {
    this.crowd?.dispose();
    this.crowd = null;
    if (this.trolleys) {
      this.scene.remove(this.trolleys);
      this.trolleys.geometry.dispose();
      this.trolleys = null;
    }
    this.round = null;
    this.state = null;
  }
}
