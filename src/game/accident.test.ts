import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ACCIDENT, AccidentEvent, findAccidentSite } from "../core/events/accident";
import { EventRng, type EventContext, type EventEffects, type EventPlayer } from "../core/events/types";
import { lanePoint } from "../core/driver";
import { PED_STATE, PedSim, type Observer } from "../core/pedestrians";
import { OFFICER } from "../core/officers";
import { Signals } from "../core/signals";
import { loadRealNav, loadRealRoadWorld } from "../core/testing";
import { NavManager } from "./nav-manager";
import { Traffic } from "./traffic";

const { world, colliders, starts } = loadRealRoadWorld();
const { cells } = loadRealNav();
const DT = 1 / 60;

interface Log {
  says: string[];
  honks: number;
}

function setup(seed: number): { traffic: Traffic; peds: PedSim; nav: NavManager; player: EventPlayer; ctx: EventContext; frame: () => void; log: Log; fx: EventEffects & { honk(x: number, y: number): void } } {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed);
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed, life: true });
  peds.signals = signals;
  traffic.setPeds(peds);
  // Le joueur à pied, au bord d'une route du centre, regardant le long de la route.
  const list = starts(6), lp = { x: 0, y: 0, heading: 0 };
  lanePoint(nav.graph.road, list[seed % list.length]!, 10, lp);
  const player: EventPlayer = { x: lp.x, y: lp.y, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: lp.heading };
  const log: Log = { says: [], honks: 0 };
  const fx = { say: (_s: number, t: string) => log.says.push(t), cry: () => {}, earn: () => {}, feat: () => {}, crime: () => {}, honk: () => log.honks++ };
  const ctx: EventContext = {
    dt: DT, player,
    visible: (x, y) => {
      const a = Math.atan2(x - player.x, y - player.y) - player.yaw;
      return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.87 && Math.hypot(x - player.x, y - player.y) < 140 && colliders.raycast(player.x, player.y, x, y) === null;
    },
    policeNear: () => false,
    lineClear: (x0, y0, x1, y1) => colliders.raycast(x0, y0, x1, y1) === null,
  };
  let i = 0;
  const frame = (): void => {
    traffic.step(DT, { kind: "foot", x: player.x, y: player.y, vx: 0, vy: 0 });
    traffic.update(DT, { x: player.x, y: player.y, yaw: player.yaw, speed: 0, hour: 15, vehicle: null });
    const obs: Observer = { x: player.x, y: player.y, vx: 0, vy: 0, yaw: player.yaw, onFoot: true, vehicle: null, hour: 15, vehicles: traffic.bodies(), honks: traffic.takeHonks() };
    if (i++ === 0) peds.prefill(obs);
    peds.clearEvents();
    peds.step(DT, obs);
    traffic.applyImpacts();
    signals.clock.t += DT;
  };
  for (let k = 0; k < 120; k++) frame();
  return { traffic, peds, nav, player, ctx, frame, log, fx };
}

function start(seed: number): (ReturnType<typeof setup> & { ev: AccidentEvent }) | null {
  const s = setup(seed);
  const rng = new EventRng(seed);
  for (let k = 0; k < 4; k++) {
    const site = findAccidentSite(s.nav.graph.road, s.traffic, s.ctx, rng);
    if (site) {
      const ev = new AccidentEvent(s.peds, s.traffic, s.fx, site, rng);
      if (ev.ok) return { ...s, ev };
    }
    s.player.yaw += Math.PI / 2;
  }
  return null;
}

function run(s: NonNullable<ReturnType<typeof start>>, seconds: number, until?: () => boolean): void {
  for (let i = 0; i < seconds * 60 && !s.ev.done; i++) {
    s.frame();
    s.ev.update(s.ctx);
    if (until?.()) return;
  }
}

function borrowed(peds: PedSim): number {
  let n = 0;
  for (let i = 0; i < peds.capacity; i++) if (peds.state.alive![i] && peds.isBorrowed(i)) n++;
  return n;
}

describe("accident entre deux voitures (phase 4, E4)", () => {
  it("la scène se pose hors de vue, sur une route assez large, devant le joueur : deux voitures cabossées, feux de détresse, conducteurs descendus", () => {
    let found = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      found++;
      const [a, b] = s.ev.cars.map((id) => s.traffic.eventCar(id)!);
      expect(a && b).toBeTruthy();
      const d = Math.hypot(s.ev.x - s.player.x, s.ev.y - s.player.y);
      expect(d).toBeGreaterThan(ACCIDENT.footNear * 0.8);
      expect(d).toBeLessThan(ACCIDENT.footFar + 30);
      expect(s.ctx.visible(s.ev.x, s.ev.y)).toBe(false);
      expect(s.traffic.cars.filter((c) => c.event && c.hazard && c.noDriver)).toHaveLength(2);
      expect(s.traffic.cars.filter((c) => c.event).every((c) => c.sim.damage.tier !== "ok")).toBe(true);
      expect(s.ev.drivers.every((dr) => dr >= 0 && s.peds.isBorrowed(dr))).toBe(true);
      // Elles ne bougent pas.
      const x0 = a!.state.x;
      run(s, 5);
      expect(Math.abs(s.traffic.eventCar(s.ev.cars[0])!.state.x - x0)).toBeLessThan(0.3);
      expect(s.log.says.length).toBeGreaterThan(0);
    }
    expect(found).toBeGreaterThanOrEqual(4);
  }, 60000);

  it("dispute, patrouille qui arrive et se gare, gendarme, constat, chacun remonte ; rien ne reste réquisitionné", () => {
    let constat = 0, tried = 0;
    for (let seed = 1; seed <= 6 && tried < 3; seed++) {
      const s = start(seed);
      if (!s) continue;
      tried++;
      run(s, ACCIDENT.policeAfter[1] + 2, () => s.ev.phase === "police");
      expect(s.ev.phase).toBe("police");
      expect(s.traffic.cars.some((c) => c.police && c.event && c.siren)).toBe(true);
      run(s, 120, () => s.ev.phase === "constat");
      if (s.ev.phase !== "constat") continue;
      expect(s.ev.gendarme).toBeGreaterThanOrEqual(0);
      expect(s.log.says).toContain("Bonjour, vos papiers.");
      run(s, 90);
      expect(s.ev.done).toBe(true);
      if (s.ev.outcome === "constat") constat++;
      expect(borrowed(s.peds)).toBe(0);
      // Les voitures sont lâchées : elles disparaîtront hors de vue.
      expect(s.traffic.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
    }
    expect(tried).toBeGreaterThanOrEqual(2);
    expect(constat).toBeGreaterThanOrEqual(1);
  }, 300000);

  it("le joueur prend une des voitures : personne au volant (pas de vol avec conducteur), son conducteur crie « Ma voiture ! »", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      run(s, 2);
      const car = s.traffic.eventCar(s.ev.cars[0])!;
      const got = s.traffic.extract(car.state.x, car.state.y, 1);
      expect(got?.driver).toBe(-1);
      run(s, 1);
      expect(s.log.says).toContain("Ma voiture !");
      s.ev.abort();
      expect(s.ev.outcome).toBe("vole");
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucun accident posé");
  }, 60000);

  it("un conducteur frappé : la dispute tourne court, chacun s'en va", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      run(s, 2);
      s.peds.applyImpulse(s.ev.drivers[0], 4, 0);
      expect(s.peds.modeOf(s.ev.drivers[0])).toBe(PED_STATE.down);
      run(s, 1);
      expect(s.ev.drivers).toEqual([-1, -1]);
      return;
    }
    throw new Error("aucun accident posé");
  }, 60000);
});
