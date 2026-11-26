import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ENERVE, EnerveEvent, type EnerveEffects } from "../core/events/enerve";
import { LIVREUR, LivreurEvent, findDeliverySpot } from "../core/events/livreur";
import { CHAUFFARD, ChauffardEvent, findChauffard } from "../core/events/chauffard";
import { EventRng, type EventContext, type EventPlayer, type GameEvent } from "../core/events/types";
import { lanePoint } from "../core/driver";
import { PedSim, type Observer } from "../core/pedestrians";
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
  hurt: number;
}

function setup(seed: number) {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed);
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed, life: true });
  peds.signals = signals;
  traffic.setPeds(peds);
  const list = starts(6), lp = { x: 0, y: 0, heading: 0 };
  lanePoint(nav.graph.road, list[seed % list.length]!, 10, lp);
  const player: EventPlayer = { x: lp.x, y: lp.y, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: lp.heading };
  const log: Log = { says: [], honks: 0, hurt: 0 };
  const fx: EnerveEffects = {
    say: (_s, t) => log.says.push(t), cry: () => {}, earn: () => {}, feat: () => {}, crime: () => {}, honk: () => log.honks++, hurtPlayer: (n) => (log.hurt += n),
  };
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
    traffic.step(DT, { kind: "foot", x: player.x, y: player.y, vx: player.vx, vy: player.vy });
    traffic.update(DT, { x: player.x, y: player.y, yaw: player.yaw, speed: player.speed, hour: 9, vehicle: null });
    const obs: Observer = { x: player.x, y: player.y, vx: player.vx, vy: player.vy, yaw: player.yaw, onFoot: true, vehicle: null, hour: 15, vehicles: traffic.bodies(), honks: traffic.takeHonks() };
    if (i++ === 0) peds.prefill(obs);
    peds.clearEvents();
    peds.step(DT, obs);
    traffic.applyImpacts();
    signals.clock.t += DT;
  };
  for (let k = 0; k < 240; k++) frame();
  return { traffic, peds, nav, player, ctx, frame, log, fx };
}

type Setup = ReturnType<typeof setup>;

function run(s: Setup, ev: GameEvent, seconds: number, until?: () => boolean): void {
  for (let i = 0; i < seconds * 60 && !ev.done; i++) {
    s.frame();
    ev.update(s.ctx);
    if (until?.()) return;
  }
}

function borrowed(peds: PedSim): number {
  let n = 0;
  for (let i = 0; i < peds.capacity; i++) if (peds.state.alive![i] && peds.isBorrowed(i)) n++;
  return n;
}

/** Une voiture libre près du joueur, et le joueur posé à 6 m d'elle, sur le côté. */
function angry(seed: number): { s: Setup; ev: EnerveEvent } | null {
  const s = setup(seed);
  const near = s.traffic.freeCars(s.player.x, s.player.y, 120);
  if (!near.length) return null;
  const ev = new EnerveEvent(s.peds, s.traffic, s.fx, near[0]!.id, new EventRng(seed));
  if (!ev.ok) return null;
  const c = s.traffic.eventCar(ev.car)!;
  s.player.x = c.state.x + Math.cos(c.state.heading) * 6;
  s.player.y = c.state.y - Math.sin(c.state.heading) * 6;
  return { s, ev };
}

describe("comportements de conducteurs (phase 4, lot 7)", () => {
  it("conducteur énervé : il klaxonne, descend, gesticule, bouscule le joueur resté tout près, puis se calme et repart", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const a = angry(seed);
      if (!a) continue;
      const { s, ev } = a;
      run(s, ev, ENERVE.honkFor + 0.5);
      expect(s.log.honks).toBeGreaterThan(2);
      expect(ev.phase).toBe("walk");
      expect(ev.driver).toBeGreaterThanOrEqual(0);
      expect(s.log.says).toContain("Non mais ça va pas ?!");
      run(s, ev, 30);
      expect(ev.shoved).toBe(true);
      expect(s.log.hurt).toBe(ENERVE.shoveDamage);
      expect(s.log.says).toContain("Bon… faites attention !");
      expect(ev.done).toBe(true);
      expect(ev.outcome).toBe("excuse");
      expect(borrowed(s.peds)).toBe(0);
      expect(s.traffic.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
      return;
    }
    throw new Error("aucune voiture");
  }, 120000);

  it("conducteur énervé : le joueur prend sa voiture pendant qu'il est descendu, « Ma voiture ! »", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const a = angry(seed);
      if (!a) continue;
      const { s, ev } = a;
      run(s, ev, ENERVE.honkFor + 1);
      const c = s.traffic.eventCar(ev.car)!;
      const got = s.traffic.extract(c.state.x, c.state.y, 1);
      expect(got?.driver).toBe(-1);
      run(s, ev, 1);
      expect(s.log.says).toContain("Ma voiture !");
      expect(ev.outcome).toBe("vole");
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucune voiture");
  }, 120000);

  it("livreur pressé : la camionnette arrive en klaxonnant, s'arrête en double file, le livreur court livrer et repart", () => {
    let delivered = 0, tried = 0;
    for (let seed = 1; seed <= 6 && tried < 4; seed++) {
      const s = setup(seed);
      const rng = new EventRng(seed);
      const spot = findDeliverySpot(s.nav.graph.road, s.ctx, rng);
      if (!spot) continue;
      const ev = new LivreurEvent(s.peds, s.traffic, s.nav.graph, s.fx, spot, rng);
      if (!ev.ok) continue;
      tried++;
      let stopped = false, out = false;
      run(s, ev, LIVREUR.maxLife + 5, () => {
        if (ev.phase === "door") {
          out = true;
          const c = s.traffic.eventCar(ev.van);
          if (c && s.traffic.cars.some((k) => k.sim.id === ev.van && k.hazard && k.noDriver)) stopped = true;
        }
        return false;
      });
      expect(ev.done).toBe(true);
      const vc = s.traffic.eventCar(ev.van);
      console.log(`livreur, graine ${seed} : ${ev.outcome}, phase atteinte ${out ? "porte" : "route"}, camionnette ${vc ? Math.hypot(vc.state.x - spot.x, vc.state.y - spot.y).toFixed(0) + " m de l'arrêt" : "partie"}`);
      if (ev.outcome === "livre") {
        delivered++;
        expect(out && stopped).toBe(true);
        expect(s.log.says).toContain("Pardon, pardon !");
      }
      expect(borrowed(s.peds)).toBe(0);
      expect(s.traffic.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
    }
    expect(tried).toBeGreaterThanOrEqual(3);
    expect(delivered).toBeGreaterThanOrEqual(2);
  }, 600000);

  it("accident en direct : une voiture fonce vers le joueur en grillant les feux ; choc ou pas, tout finit proprement (proportion mesurée)", () => {
    let tried = 0, crashes = 0;
    const outcomes: string[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const s = setup(seed);
      const rng = new EventRng(seed);
      const id = findChauffard(s.traffic, s.ctx, rng);
      if (id < 0) continue;
      const ev = new ChauffardEvent(s.peds, s.traffic, s.fx, id, s.ctx, rng);
      if (!ev.ok) continue;
      tried++;
      run(s, ev, CHAUFFARD.maxFor + 300);
      if (ev.accident) crashes++;
      outcomes.push(ev.outcome!);
      expect(ev.done).toBe(true);
      expect(borrowed(s.peds)).toBe(0);
      expect(s.traffic.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
    }
    console.log(`chauffards : ${tried} essais, ${crashes} chocs ; ${outcomes.join(", ")}`);
    expect(tried).toBeGreaterThanOrEqual(4);
  }, 900000);
});
