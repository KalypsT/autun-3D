import { describe, expect, it } from "vitest";
import { pointInRing } from "./collision";
import { NavGraph } from "./nav-graph";
import { PedSim, TIER_RANGE, vehicleThreat, type Observer } from "./pedestrians";
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
const still = (x = 0, y = -20): Observer => ({ x, y, vx: 0, vy: 0, yaw: 0, onFoot: true, vehicle: null });
const makeSim = (g: NavGraph, n = 100, seed = 7, opt: { tiers?: boolean; avoid?: boolean } = {}): PedSim => new PedSim(g, terrain, colliders, { capacity: n, seed, ...opt });

function run(sim: PedSim, steps: number, obs: Observer | ((t: number) => Observer)): void {
  for (let i = 0; i < steps; i++) sim.step(STEP, typeof obs === "function" ? obs(i * STEP) : obs);
}

describe("simulation des passants", () => {
  it("remplit tous les emplacements, les garde pleins en recyclant, et reste dans la couronne du joueur", () => {
    const sim = makeSim(graph());
    const obs = still();
    sim.prefill(obs);
    expect(sim.stats.alive).toBe(0); // `alive` est mis à jour au pas suivant
    run(sim, 1, obs);
    expect(sim.stats.alive).toBe(100);
    run(sim, 60 * 40, obs);
    expect(sim.stats.alive).toBeGreaterThanOrEqual(95);
    const far: number[] = [];
    const p = { x: 0, y: 0 };
    for (let i = 0; i < sim.capacity; i++) {
      if (!sim.state.alive![i]) continue;
      sim.position(i, p);
      if (Math.hypot(p.x - obs.x, p.y - obs.y) > 230) far.push(i);
    }
    expect(far).toEqual([]);
  });

  it("ne produit ni valeur absurde ni passant dans un bâtiment (positions des passants vivants, un échantillon par seconde)", () => {
    const sim = makeSim(graph(), 120);
    const obs = still();
    sim.prefill(obs);
    const grid = new Map<string, number[][]>();
    const CELL = 64;
    for (const b of tile.buildings) {
      const xs = b.ring.filter((_, i) => i % 2 === 0), ys = b.ring.filter((_, i) => i % 2 === 1);
      for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++) {
        for (let j = Math.floor(Math.min(...ys) / CELL); j <= Math.floor(Math.max(...ys) / CELL); j++) {
          const k = `${i},${j}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push(b.ring);
        }
      }
    }
    let total = 0, inside = 0, bad = 0;
    const p = { x: 0, y: 0 };
    for (let t = 0; t < 120; t++) {
      run(sim, 60, obs);
      for (let i = 0; i < sim.capacity; i++) {
        if (!sim.state.alive![i]) continue;
        sim.position(i, p);
        if (!Number.isFinite(p.x + p.y + sim.state.y[i]! + sim.state.yaw[i]! + sim.state.phase[i]!)) bad++;
        total++;
        for (const ring of grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) ?? []) {
          if (pointInRing(p.x, p.y, ring)) {
            inside++;
            break;
          }
        }
      }
    }
    expect(bad).toBe(0);
    expect(total).toBeGreaterThan(10000);
    // Les cours intérieures (trous) ne sont pas testées ici : on tolère 0,5 %.
    expect(inside / total).toBeLessThan(0.005);
  });

  it("est reproductible : même graine et mêmes pas donnent le même état, une autre graine un autre", () => {
    const a = makeSim(graph(), 80, 11), b = makeSim(graph(), 80, 11), c = makeSim(graph(), 80, 12);
    const obs = still();
    for (const s of [a, b, c]) {
      s.prefill(obs);
      run(s, 1200, obs);
    }
    expect(a.checksum()).toBe(b.checksum());
    expect(a.checksum()).not.toBe(c.checksum());
  });

  it("fait naître les passants à l'écart du joueur et hors de son champ de vision, y compris en roulant à 90 km/h", () => {
    const sim = makeSim(graph(), 100);
    const dist: number[] = [];
    let inView = 0;
    let obs: Observer = still();
    sim.onSpawn = (slot) => {
      const p = { x: 0, y: 0 };
      sim.position(slot, p);
      dist.push(Math.hypot(p.x - obs.x, p.y - obs.y));
      if (dist[dist.length - 1]! < 100 && Math.abs(Math.atan2(p.x - obs.x, p.y - obs.y) - obs.yaw) < 0.9) inView++;
    };
    sim.prefill(obs);
    // Le véhicule roule vers l'est, caméra derrière lui, regard vers l'est.
    run(sim, 60 * 25, (t) => (obs = { x: -400 + 25 * t, y: -230, vx: 25, vy: 0, yaw: Math.PI / 2, onFoot: false, vehicle: { x: -400 + 25 * t, y: -230, vx: 25, vy: 0 } }));
    expect(dist.length).toBeGreaterThan(100);
    expect(Math.min(...dist.slice(100))).toBeGreaterThan(20);
    expect(inView / dist.length).toBeLessThan(0.05);
  });

  it("supporte le retrait d'une super-tuile : les passants qui y marchaient disparaissent, d'autres naissent ailleurs", () => {
    const g = graph();
    const sim = makeSim(g, 100);
    const obs = still(40, 40);
    sim.prefill(obs);
    run(sim, 120, obs);
    const spawnsBefore = sim.stats.spawns;
    const id = "s6_8";
    const cell = cells.find((c) => c.id === id)!;
    g.remove(id);
    run(sim, 60, obs);
    expect(sim.stats.despawns).toBeGreaterThan(0);
    g.add(cell);
    run(sim, 60 * 20, obs);
    expect(sim.stats.alive).toBeGreaterThan(80);
    expect(sim.stats.spawns).toBeGreaterThan(spawnsBefore);
  });

  it("utilise les paliers : la plupart des passants lointains, quelques-uns près ; sans palier tous jouent à fond", () => {
    const sim = makeSim(graph(), 120), full = makeSim(graph(), 120, 7, { tiers: false });
    const obs = still();
    for (const s of [sim, full]) {
      s.prefill(obs);
      run(s, 300, obs);
    }
    expect(sim.stats.tiers[0] + sim.stats.tiers[1] + sim.stats.tiers[2]).toBe(sim.stats.alive);
    expect(sim.stats.tiers[2]).toBeGreaterThan(sim.stats.tiers[0]);
    expect(full.stats.tiers).toEqual([full.stats.alive, 0, 0]);
    expect(TIER_RANGE[0]).toBeLessThan(TIER_RANGE[1]);
  });

  it("repère un véhicule qui arrive sur un passage, mais pas un véhicule arrêté ou qui s'éloigne", () => {
    expect(vehicleThreat(30, 0, { x: 0, y: 0, vx: 10, vy: 0 })).toBe(true);
    expect(vehicleThreat(30, 0, { x: 0, y: 0, vx: 0.2, vy: 0 })).toBe(false);
    expect(vehicleThreat(-30, 0, { x: 0, y: 0, vx: 10, vy: 0 })).toBe(false);
    expect(vehicleThreat(30, 20, { x: 0, y: 0, vx: 10, vy: 0 })).toBe(false);
    expect(vehicleThreat(200, 0, { x: 0, y: 0, vx: 10, vy: 0 })).toBe(false);
    expect(vehicleThreat(30, 0, null)).toBe(false);
  });
});
