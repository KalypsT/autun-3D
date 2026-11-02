import { describe, expect, it } from "vitest";
import { NavGraph } from "./nav-graph";
import { PED_STATE, PedSim, type Observer } from "./pedestrians";
import { benchSeats, Seats, type SeatDef } from "./seats";
import { loadRealNav, loadRealWorld } from "./testing";
import { buildColliders } from "./world";

/** Vie de quartier (D198) : bancs, groupes, téléphone, joggeurs, têtes tournées ; et ce qui doit continuer de marcher (fuite, chocs). */
const { terrain, tile } = loadRealWorld();
const { cells } = loadRealNav();
const colliders = buildColliders(tile);
const STEP = 1 / 60;
const graph = (): NavGraph => {
  const g = new NavGraph();
  for (const c of cells) g.add(c);
  return g;
};
const still = (hour = 13, x = 0, y = -20): Observer => ({ x, y, vx: 0, vy: 0, yaw: 0, onFoot: true, vehicle: null, hour });

/** Des bancs le long des files autour du joueur : tous les 6 m sur une grille de 60 m, à 1,2 m de la file, sans mur entre. */
function benchesAround(g: NavGraph, x0: number, y0: number): Seats {
  const defs: SeatDef[] = [];
  for (let dx = -60; dx <= 60; dx += 6) {
    for (let dy = -60; dy <= 60; dy += 6) {
      const hit = g.nearest(x0 + dx, y0 + dy, 3);
      if (!hit) continue;
      const bx = hit.x + 1.2, by = hit.y;
      if (colliders.raycast(hit.x, hit.y, bx, by) !== null) continue;
      defs.push(...benchSeats(bx, by, terrain.heightAt(bx, by), Math.PI / 2));
    }
  }
  const seats = new Seats();
  seats.addTile("essai", defs);
  return seats;
}

function lifeSim(n = 100, seed = 7): { sim: PedSim; seats: Seats } {
  const g = graph();
  const sim = new PedSim(g, terrain, colliders, { capacity: n, seed, life: true });
  const seats = benchesAround(g, 0, -20);
  sim.seats = seats;
  return { sim, seats };
}

function sitters(sim: PedSim): number[] {
  const out: number[] = [];
  for (let i = 0; i < sim.capacity; i++) if (sim.state.alive![i] && sim.state.pose![i] === 5) out.push(i);
  return out;
}

describe("vie de quartier (D198)", () => {
  it("des passants vont s'asseoir sur les bancs, une personne par place, sur la place même ; rien d'absurde", () => {
    const { sim, seats } = lifeSim();
    const obs = still();
    sim.prefill(obs);
    let maxSit = 0;
    for (let k = 0; k < 60 * 120; k++) {
      sim.step(STEP, obs);
      if (k % 60 === 0) {
        maxSit = Math.max(maxSit, sim.stats.sitting ?? 0);
        const seen = new Set<number>();
        for (const s of seats.all()) {
          if (s.occupant < 0) continue;
          expect(seen.has(s.occupant)).toBe(false);
          seen.add(s.occupant);
          expect(sim.state.alive![s.occupant]).toBe(1);
        }
        for (const i of sitters(sim)) {
          const seat = [...seats.all()].find((s) => s.occupant === i)!;
          expect(seat).toBeTruthy();
          expect(Math.hypot(sim.state.x[i]! - seat.x, -sim.state.z[i]! - seat.y)).toBeLessThan(0.05);
        }
        for (let i = 0; i < sim.capacity; i++) if (sim.state.alive![i]) expect(Number.isFinite(sim.state.x[i]! + sim.state.y[i]! + sim.state.z[i]!)).toBe(true);
      }
    }
    expect(maxSit).toBeGreaterThan(2);
  }, 60000);

  it("une alarme fait se lever et fuir les gens assis ; leurs places sont libérées", () => {
    const { sim, seats } = lifeSim();
    const obs = still();
    sim.prefill(obs);
    let k = 0;
    while (sitters(sim).length < 2 && k++ < 60 * 180) sim.step(STEP, obs);
    const sit = sitters(sim);
    expect(sit.length).toBeGreaterThanOrEqual(2);
    const i = sit[0]!;
    sim.alarm(sim.state.x[i]!, -sim.state.z[i]!, 30, 10);
    for (let t = 0; t < 30; t++) sim.step(STEP, obs);
    expect(sim.state.pose![i]).not.toBe(5);
    expect([...seats.all()].some((s) => s.occupant === i)).toBe(false);
  }, 60000);

  it("un passant assis renversé par une voiture tombe, et sa place se libère", () => {
    const { sim, seats } = lifeSim();
    const obs = still();
    sim.prefill(obs);
    let k = 0;
    while (sitters(sim).length < 1 && k++ < 60 * 180) sim.step(STEP, obs);
    const i = sitters(sim)[0]!;
    const x = sim.state.x[i]!, y = -sim.state.z[i]!;
    // Une voiture lancée à 40 km/h vers l'est, qui passe sur la place.
    for (let t = 0; t < 40; t++) {
      const vx = 11, cx = x - 2 + vx * t * STEP;
      sim.step(STEP, { ...obs, vehicle: { x: cx, y, vx, vy: 0, heading: Math.PI / 2 } });
    }
    expect(sim.stats.hits).toBeGreaterThan(0);
    expect([...seats.all()].some((s) => s.occupant === i)).toBe(false);
  }, 60000);

  it("des groupes de deux ou trois marchent côte à côte", () => {
    const { sim } = lifeSim(120, 11);
    sim.seats = null;
    const obs = still();
    sim.prefill(obs);
    let grouped = 0;
    for (let k = 0; k < 60 * 90; k++) {
      sim.step(STEP, obs);
      grouped = Math.max(grouped, sim.stats.grouped ?? 0);
    }
    expect(grouped).toBeGreaterThan(2);
  }, 60000);

  it("joggeurs le matin, pas en début d'après-midi ; personne n'en a sans la vie de quartier", () => {
    const joggers = (hour: number, life: boolean): number => {
      const sim = new PedSim(graph(), terrain, colliders, { capacity: 150, seed: 3, life });
      const obs = still(hour, 300, -300);
      sim.prefill(obs);
      let n = 0;
      for (let k = 0; k < 60 * 40; k++) {
        sim.step(STEP, obs);
        if (k % 30 === 0) for (let i = 0; i < sim.capacity; i++) if (sim.state.alive![i] && sim.state.speed[i]! > 2.6 && sim.state.speed[i]! < 3.35) n++;
      }
      return n;
    };
    const morning = joggers(8, true);
    expect(morning).toBeGreaterThan(joggers(13.5, true));
    expect(morning).toBeGreaterThan(joggers(8, false));
  }, 120000);

  it("au klaxon, de loin, on tourne la tête au lieu de sursauter", () => {
    const g = graph();
    const count = (life: boolean): { looks: number; startled: number } => {
      const sim = new PedSim(g, terrain, colliders, { capacity: 100, seed: 5, life });
      const obs = still();
      sim.prefill(obs);
      for (let k = 0; k < 60; k++) sim.step(STEP, obs);
      sim.clearEvents();
      sim.step(STEP, { ...obs, onFoot: false, vehicle: { x: 0, y: -60, vx: 0, vy: 0.5, heading: 0, hornRange: 60 }, horn: true });
      let looks = 0;
      for (let i = 0; i < sim.capacity; i++) if (sim.state.alive![i] && (sim.state.look?.[i] ?? 0) !== 0) looks++;
      return { looks, startled: sim.events.filter((e) => e.kind === "startled").length };
    };
    const calm = count(true), jumpy = count(false);
    expect(calm.looks).toBeGreaterThan(0);
    expect(calm.startled).toBeLessThan(jumpy.startled);
  }, 60000);

  it("sans la vie de quartier, personne ne s'assoit ni ne marche en groupe (les essais d'endurance restent ceux d'avant)", () => {
    const g = graph();
    const sim = new PedSim(g, terrain, colliders, { capacity: 100, seed: 7 });
    sim.seats = benchesAround(g, 0, -20);
    const obs = still();
    sim.prefill(obs);
    for (let k = 0; k < 60 * 60; k++) sim.step(STEP, obs);
    expect(sim.stats.sitting ?? 0).toBe(0);
    expect(sim.stats.grouped ?? 0).toBe(0);
    for (let i = 0; i < sim.capacity; i++) expect(sim.state.pose![i] === 5 || (sim.state.look?.[i] ?? 0) !== 0).toBe(false);
    expect(PED_STATE.sit).toBeLessThan(PED_STATE.stumble);
  }, 60000);
});
