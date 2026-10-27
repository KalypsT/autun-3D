import { describe, expect, it } from "vitest";
import { NavGraph } from "./nav-graph";
import { PIGEON_MODE, PigeonSim, pigeonCapacity, pigeonRamp, type PigeonPeds } from "./pigeons";
import type { Observer } from "./pedestrians";
import { loadRealNav, loadRealWorld } from "./testing";
import { buildColliders } from "./world";

const { terrain, tile } = loadRealWorld();
const { cells } = loadRealNav();
const colliders = buildColliders(tile);
const STEP = 1 / 60;

const graph = (): NavGraph => {
  const g = new NavGraph();
  for (const c of cells) g.add(c);
  return g;
};
const g = graph();

/** Un coin à pigeons du centre-ville, là où bancs, lieux de culte et coins à pigeons sont les plus nombreux autour. */
const plaza = ((): { x: number; y: number } => {
  let best = { x: 0, y: 0, n: -1 };
  for (const c of cells) {
    for (let i = 0; i < c.poi.count; i++) {
      if (c.poi.kind[i] !== 11) continue;
      let n = 0;
      g.forEachPoi((1 << 0) | (1 << 9) | (1 << 11), c.poi.x[i]!, c.poi.y[i]!, 100, () => n++);
      if (n > best.n) best = { x: c.poi.x[i]!, y: c.poi.y[i]!, n };
    }
  }
  return best;
})();

const obsAt = (x: number, y: number, hour = 13, over: Partial<Observer> = {}): Observer => ({ x, y, vx: 0, vy: 0, yaw: 0, onFoot: true, vehicle: null, hour, ...over });
const make = (cap = 40, seed = 3, inView = false): PigeonSim => new PigeonSim(g, terrain, colliders, { capacity: cap, seed, spawnInView: inView });
function run(sim: PigeonSim, seconds: number, obs: Observer | ((t: number) => Observer), peds: PigeonPeds | null = null): void {
  for (let i = 0; i < seconds * 60; i++) sim.step(STEP, typeof obs === "function" ? obs(i * STEP) : obs, peds);
}
function birds(sim: PigeonSim): number[] {
  const out: number[] = [];
  for (let i = 0; i < sim.capacity; i++) if (sim.state.alive[i]) out.push(i);
  return out;
}

describe("pigeons", () => {
  it("règle le nombre selon l'heure et la foule", () => {
    expect(pigeonRamp(3)).toBe(0);
    expect(pigeonRamp(22)).toBe(0);
    expect(pigeonRamp(13)).toBe(1);
    expect(pigeonRamp(8)).toBeGreaterThan(0);
    expect(pigeonRamp(8)).toBeLessThan(1);
    expect(pigeonCapacity(0)).toBe(0);
    expect(pigeonCapacity(40)).toBe(16);
    expect(pigeonCapacity(100)).toBe(40);
    expect(pigeonCapacity(200)).toBe(40);
  });

  it("pose des volées près des coins à pigeons, de jour, sans valeur absurde", () => {
    const sim = make();
    const obs = obsAt(plaza.x + 60, plaza.y);
    sim.prefill(obs);
    run(sim, 3, obs);
    const alive = birds(sim);
    expect(alive.length).toBeGreaterThanOrEqual(3);
    expect(alive.length).toBeLessThanOrEqual(40);
    for (const i of alive) {
      const st = sim.state;
      expect(Number.isFinite(st.x[i]!) && Number.isFinite(st.y[i]!) && Number.isFinite(st.z[i]!)).toBe(true);
      expect(st.z[i]!).toBeGreaterThanOrEqual(terrain.heightAt(st.x[i]!, st.y[i]!) - 0.02);
      expect(Math.hypot(st.x[i]! - obs.x, st.y[i]! - obs.y)).toBeLessThan(135);
    }
  });

  it("n'en met aucun la nuit", () => {
    const sim = make();
    const obs = obsAt(plaza.x + 60, plaza.y, 3);
    sim.prefill(obs);
    run(sim, 5, obs);
    expect(birds(sim)).toEqual([]);
  });

  it("s'envole quand le joueur approche à pied, puis se pose ailleurs", () => {
    const sim = make(40, 3, true);
    const far = obsAt(plaza.x + 60, plaza.y);
    sim.prefill(far);
    run(sim, 1, far);
    const i = birds(sim).find((k) => sim.modeOf(k) !== PIGEON_MODE.fly)!;
    const px = sim.state.x[i]!, py = sim.state.y[i]!;
    const near = obsAt(px + 2, py);
    run(sim, 1.5, near);
    expect(sim.modeOf(i)).not.toBe(PIGEON_MODE.peck);
    expect(sim.stats.scatters).toBeGreaterThan(0);
    // En vol : altitude de 3 à 6 m au-dessus du sol (vol vers un autre coin), jamais sous terre.
    let top = 0;
    for (let k = 0; k < 8 * 60; k++) {
      sim.step(STEP, far);
      if (sim.state.alive[i] && sim.modeOf(i) === PIGEON_MODE.fly) top = Math.max(top, sim.state.z[i]! - terrain.heightAt(sim.state.x[i]!, sim.state.y[i]!));
    }
    if (sim.state.alive[i]) {
      expect(sim.modeOf(i)).not.toBe(PIGEON_MODE.fly);
      expect(Math.hypot(sim.state.x[i]! - px, sim.state.y[i]! - py)).toBeGreaterThan(10);
      expect(top).toBeGreaterThan(2.5);
      expect(top).toBeLessThan(7);
    }
  });

  it("ne s'envole pas pour un joueur lointain, ni pour un véhicule à l'arrêt à 8 m", () => {
    const sim = make(40, 3, true);
    const far = obsAt(plaza.x + 60, plaza.y);
    sim.prefill(far);
    run(sim, 1, far);
    const before = sim.stats.scatters;
    run(sim, 10, far);
    expect(sim.stats.scatters).toBe(before);
    const i = birds(sim)[0]!;
    const parked = obsAt(sim.state.x[i]! + 8, sim.state.y[i]!, 13, { onFoot: false, vehicle: { x: sim.state.x[i]! + 8, y: sim.state.y[i]!, vx: 0, vy: 0 } });
    run(sim, 2, parked);
    expect(sim.stats.scatters).toBe(before);
  });

  it("fuit devant un véhicule en marche à 12 m, et au klaxon à 30 m", () => {
    const a = make(40, 3, true);
    const far = obsAt(plaza.x + 60, plaza.y);
    a.prefill(far);
    run(a, 1, far);
    const i = birds(a)[0]!;
    const x = a.state.x[i]!, y = a.state.y[i]!;
    run(a, 1, obsAt(x + 12, y, 13, { onFoot: false, vx: -8, vy: 0, vehicle: { x: x + 12, y, vx: -8, vy: 0 } }));
    expect(a.modeOf(i)).not.toBe(PIGEON_MODE.peck);

    const b = make(40, 3, true);
    b.prefill(far);
    run(b, 1, far);
    const j = birds(b)[0]!;
    run(b, 1, obsAt(b.state.x[j]! + 30, b.state.y[j]!, 13, { horn: true }));
    expect(b.stats.scatters).toBeGreaterThan(0);
  });

  it("s'envole parfois quand un passant frôle la volée", () => {
    const sim = make(40, 3, true);
    const far = obsAt(plaza.x + 60, plaza.y);
    sim.prefill(far);
    run(sim, 1, far);
    const always: PigeonPeds = { queryCircle: (_x, _y, _r, out) => { out.push(0); return 1; } };
    run(sim, 20, far, always);
    expect(sim.stats.scatters).toBeGreaterThan(0);
  });

  it("est reproductible pour une graine, et ne dépasse pas sa capacité", () => {
    const sums: number[] = [];
    for (let k = 0; k < 2; k++) {
      const sim = make(24, 11);
      const obs = obsAt(plaza.x + 50, plaza.y);
      sim.prefill(obs);
      for (let s = 0; s < 40 * 60; s++) {
        sim.step(STEP, s > 600 && s < 700 ? obsAt(plaza.x + 3, plaza.y) : obs);
        expect(sim.stats.alive).toBeLessThanOrEqual(24);
      }
      sums.push(sim.checksum());
    }
    expect(sums[0]).toBe(sums[1]);
    expect(sums[0]).not.toBe(0);
  });

  it("quitte la scène à la tombée de la nuit", () => {
    const sim = make();
    sim.prefill(obsAt(plaza.x + 60, plaza.y));
    run(sim, 2, obsAt(plaza.x + 60, plaza.y));
    expect(birds(sim).length).toBeGreaterThan(0);
    run(sim, 40, obsAt(plaza.x + 60, plaza.y, 22));
    expect(birds(sim)).toEqual([]);
  });
});
