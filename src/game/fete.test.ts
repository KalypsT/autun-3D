import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HALL, MARIAGE, MariageEvent, type MariageEffects } from "../core/events/mariage";
import { FEU, FeuEvent, findBin } from "../core/events/feu";
import { EventRng, type EventContext, type EventPlayer, type GameEvent, type GroundItem } from "../core/events/types";
import { lanePoint } from "../core/driver";
import { LIFE_POSE } from "../core/character-rig";
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
  applause: number;
  bells: number;
}

function setup(seed: number, at: { x: number; y: number } | null, withTraffic = true) {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = withTraffic ? new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed) : null;
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed, life: true });
  peds.signals = signals;
  traffic?.setPeds(peds);
  const lp = { x: 0, y: 0, heading: 0 };
  lanePoint(nav.graph.road, starts(6)[seed % 6]!, 10, lp);
  const player: EventPlayer = { x: at?.x ?? lp.x, y: at?.y ?? lp.y, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: at ? 0 : lp.heading };
  const log: Log = { says: [], honks: 0, hurt: 0, applause: 0, bells: 0 };
  const fx: MariageEffects & { hurtPlayer(n: number): void } = {
    say: (_s, t) => log.says.push(t), cry: () => {}, earn: () => {}, feat: () => {}, crime: () => {}, honk: () => log.honks++, hurtPlayer: (n) => (log.hurt += n),
    applause: () => log.applause++, bells: () => log.bells++,
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
    traffic?.step(DT, { kind: "foot", x: player.x, y: player.y, vx: 0, vy: 0 });
    traffic?.update(DT, { x: player.x, y: player.y, yaw: player.yaw, speed: 0, hour: 15, vehicle: null });
    const obs: Observer = { x: player.x, y: player.y, vx: 0, vy: 0, yaw: player.yaw, onFoot: true, vehicle: null, hour: 15, vehicles: traffic?.bodies() ?? [], honks: traffic?.takeHonks() ?? [] };
    if (i++ === 0) peds.prefill(obs);
    peds.clearEvents();
    peds.step(DT, obs);
    traffic?.applyImpacts();
    signals.clock.t += DT;
  };
  for (let k = 0; k < 180; k++) frame();
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

/** Le joueur sur le Champ de Mars, face à la mairie. */
const NEAR_HALL = { x: HALL.parvis.x + 6, y: HALL.parvis.y - 28 };

/** Des corbeilles « de test » : des points du graphe piéton à 40 – 70 m devant le joueur (le jeu prend celles du mobilier des tuiles). */
function bins(s: Setup): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < 16; k++) {
    const a = s.player.yaw + (k / 16 - 0.5) * 1.4, r = 40 + (k % 4) * 10;
    const hit = s.nav.graph.nearest(s.player.x + Math.sin(a) * r, s.player.y + Math.cos(a) * r, 12);
    if (hit) out.push({ x: hit.x, y: hit.y });
  }
  return out;
}

describe("fêtes et feux (phase 4, lot 8)", () => {
  it("mariage : invités sur le parvis, mariés sous les applaudissements, cortège qui part en klaxonnant ; rien ne reste", () => {
    for (let seed = 1; seed <= 4; seed++) {
      const s = setup(seed, NEAR_HALL);
      const ev = new MariageEvent(s.peds, s.traffic!, s.nav.graph.road, s.nav.graph, s.fx, s.ctx, new EventRng(seed));
      if (!ev.ok) continue;
      expect(ev.cars.length).toBeGreaterThanOrEqual(3);
      expect(s.traffic!.cars.find((c) => c.sim.id === ev.cars[0])!.paint).toBe("#f4f1ea");
      expect(ev.guests.length).toBeGreaterThanOrEqual(3);
      run(s, ev, MARIAGE.gather + 2, () => ev.phase === "exit");
      expect(ev.phase).toBe("exit");
      expect(ev.couple.every((c) => c >= 0)).toBe(true);
      expect(s.log.applause).toBe(1);
      expect(s.log.bells).toBe(1);
      expect(s.log.says).toContain("Vive les mariés !");
      let clap = false;
      run(s, ev, 4, () => (clap ||= ev.guests.some((g) => s.peds.state.pose![g] === LIFE_POSE.clap)) && false);
      expect(clap).toBe(true);
      run(s, ev, 60, () => ev.phase === "convoy");
      expect(ev.phase).toBe("convoy");
      const before = s.log.honks;
      run(s, ev, 20);
      expect(s.log.honks - before).toBeGreaterThan(10);
      run(s, ev, MARIAGE.convoyFor + 10);
      expect(ev.done).toBe(true);
      expect(ev.outcome).toBe("cortege");
      expect(borrowed(s.peds)).toBe(0);
      expect(s.traffic!.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
      return;
    }
    throw new Error("aucun mariage posé");
  }, 300000);

  it("mariage : le joueur prend la voiture des mariés avant le départ, « Notre voiture ! »", () => {
    for (let seed = 1; seed <= 4; seed++) {
      const s = setup(seed, NEAR_HALL);
      const ev = new MariageEvent(s.peds, s.traffic!, s.nav.graph.road, s.nav.graph, s.fx, s.ctx, new EventRng(seed));
      if (!ev.ok) continue;
      run(s, ev, 2);
      const c = s.traffic!.eventCar(ev.cars[0]!)!;
      expect(s.traffic!.extract(c.state.x, c.state.y, 1)?.driver).toBe(-1);
      run(s, ev, 1);
      expect(s.log.says).toContain("Notre voiture !");
      ev.abort();
      expect(ev.outcome).toBe("vole");
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucun mariage posé");
  }, 120000);

  it("feu de poubelle : fumée, flammes, curieux ; les pompiers l'éteignent ; trop près, ça brûle", () => {
    let doused = 0, tried = 0;
    for (let seed = 1; seed <= 6 && tried < 3; seed++) {
      const s = setup(seed, null);
      const rng = new EventRng(seed), bin = findBin(bins(s), s.ctx, rng);
      if (!bin) continue;
      tried++;
      const ev = new FeuEvent(s.peds, s.traffic, s.nav.graph.road, s.nav.graph, s.fx, bin, rng);
      run(s, ev, FEU.smoke + 1);
      const items: GroundItem[] = [];
      ev.items(items);
      expect(items[0]?.kind).toBe("fire");
      expect(items[0]!.color).toBeGreaterThan(0.6);
      // Le joueur s'approche des flammes : il se brûle.
      const px = s.player.x, py = s.player.y;
      s.player.x = bin.x + 1;
      s.player.y = bin.y;
      run(s, ev, 1.2);
      expect(s.log.hurt).toBeGreaterThan(0);
      s.player.x = px;
      s.player.y = py;
      run(s, ev, FEU.maxLife);
      expect(ev.done).toBe(true);
      if (ev.outcome === "eteint") doused++;
      expect(["eteint", "termine"]).toContain(ev.outcome);
      expect(borrowed(s.peds)).toBe(0);
      expect(s.traffic!.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
      console.log(`feu, graine ${seed} : ${ev.outcome}, équipe ${ev.crew?.phase}, pompiers ${ev.crew?.firemen.length}`);
    }
    expect(tried).toBeGreaterThanOrEqual(2);
    expect(doused).toBeGreaterThanOrEqual(1);
  }, 600000);

  it("feu de poubelle sans circulation (pas de pompiers) : il s'éteint seul", () => {
    const s = setup(2, null, false);
    const rng = new EventRng(2), bin = findBin(bins(s), s.ctx, rng)!;
    const ev = new FeuEvent(s.peds, null, null, s.nav.graph, s.fx, bin, rng);
    run(s, ev, FEU.maxLife);
    expect(ev.done).toBe(true);
    expect(ev.outcome).toBe("termine");
    expect(borrowed(s.peds)).toBe(0);
  }, 120000);
});
