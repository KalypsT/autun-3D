import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PURSUIT, PursuitEvent } from "../core/events/pursuit";
import { EventRng, type EventContext, type EventEffects, type EventPlayer } from "../core/events/types";
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
  earned: number;
}

function setup(seed: number): { traffic: Traffic; peds: PedSim; player: EventPlayer; ctx: EventContext; frame: () => void; log: Log; fx: EventEffects } {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed);
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed });
  peds.signals = signals;
  traffic.setPeds(peds);
  const list = starts(6), lp = { x: 0, y: 0, heading: 0 };
  lanePoint(nav.graph.road, list[seed % list.length]!, 10, lp);
  const player: EventPlayer = { x: lp.x, y: lp.y, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: lp.heading };
  const log: Log = { says: [], earned: 0 };
  const fx: EventEffects = { say: (_s, t) => log.says.push(t), cry: () => {}, earn: (n) => (log.earned += n), feat: () => {}, crime: () => {} };
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
    traffic.update(DT, { x: player.x, y: player.y, yaw: player.yaw, speed: player.speed, hour: 22, vehicle: null });
    const obs: Observer = { x: player.x, y: player.y, vx: player.vx, vy: player.vy, yaw: player.yaw, onFoot: true, vehicle: null, hour: 15, vehicles: traffic.bodies(), honks: traffic.takeHonks() };
    if (i++ === 0) peds.prefill(obs);
    peds.clearEvents();
    peds.step(DT, obs);
    traffic.applyImpacts();
    signals.clock.t += DT;
  };
  for (let k = 0; k < 120; k++) frame();
  return { traffic, peds, player, ctx, frame, log, fx };
}

function start(seed: number): (ReturnType<typeof setup> & { ev: PursuitEvent }) | null {
  const s = setup(seed);
  const ev = new PursuitEvent(s.peds, s.traffic, s.fx, s.ctx, new EventRng(seed));
  return ev.ok ? { ...s, ev } : null;
}

function run(s: NonNullable<ReturnType<typeof start>>, seconds: number, bot?: () => void, until?: () => boolean): void {
  for (let i = 0; i < seconds * 60 && !s.ev.done; i++) {
    bot?.();
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

describe("poursuite entre la police et un autre conducteur (phase 4, E5)", () => {
  it("le fugitif passe près du joueur, la police le suit toutes sirènes ; ça finit toujours, sans rien laisser derrière", () => {
    let tried = 0, passed = 0;
    const outcomes: string[] = [];
    for (let seed = 1; seed <= 5; seed++) {
      const s = start(seed);
      if (!s) continue;
      tried++;
      const f = s.traffic.eventCar(s.ev.fugitiveCar)!;
      // Né hors de vue.
      expect(s.ctx.visible(f.state.x, f.state.y)).toBe(false);
      expect(s.ev.police.length).toBeGreaterThanOrEqual(1);
      expect(s.traffic.cars.filter((c) => c.police && c.event && c.siren).length).toBe(s.ev.police.length);
      let closest = Infinity, policeClose = Infinity;
      run(s, PURSUIT.maxLife + 5, undefined, () => {
        const c = s.traffic.eventCar(s.ev.fugitiveCar);
        if (!c || s.ev.phase !== "drive") return false;
        closest = Math.min(closest, Math.hypot(c.state.x - s.player.x, c.state.y - s.player.y));
        for (const id of s.ev.police) {
          const pc = s.traffic.eventCar(id);
          if (pc) policeClose = Math.min(policeClose, Math.hypot(pc.state.x - c.state.x, pc.state.y - c.state.y));
        }
        return false;
      });
      if (closest < 70) passed++;
      expect(policeClose).toBeLessThan(60);
      expect(s.ev.done).toBe(true);
      outcomes.push(s.ev.outcome!);
      expect(borrowed(s.peds)).toBe(0);
      expect(s.traffic.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
    }
    expect(tried).toBeGreaterThanOrEqual(4);
    expect(passed).toBeGreaterThanOrEqual(Math.ceil(tried / 2));
    for (const o of outcomes) expect(["arrete", "enfui", "rattrape", "perdu"]).toContain(o);
  }, 600000);

  it("coincé par la police, il se rend les mains en l'air ; un gendarme l'emmène", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const s = start(seed);
      if (!s) continue;
      // On attend qu'une gendarmerie soit tout près, puis la voiture du fugitif cale (elle ne repart plus).
      run(s, 120, undefined, () => {
        const c = s.traffic.eventCar(s.ev.fugitiveCar);
        if (!c) return true;
        return s.ev.police.some((id) => {
          const pc = s.traffic.eventCar(id);
          return !!pc && Math.hypot(pc.state.x - c.state.x, pc.state.y - c.state.y) < 9;
        });
      });
      if (s.ev.done || !s.traffic.eventCar(s.ev.fugitiveCar)) continue;
      s.traffic.hold(s.ev.fugitiveCar, 1e6);
      run(s, 15, undefined, () => s.ev.phase !== "drive");
      if (s.ev.phase !== "foot") continue;
      run(s, 60);
      expect(s.log.says.some((t) => t === "C'est bon, c'est bon !" || t === "Halte ! Gendarmerie !")).toBe(true);
      expect(s.ev.done).toBe(true);
      expect(["arrete", "enfui"]).toContain(s.ev.outcome);
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucune poursuite ne s'est laissé coincer");
  }, 600000);

  it("sa voiture hors d'usage, il fuit à pied ; plaqué par le joueur, il est arrêté grâce à lui : prime de la gendarmerie", () => {
    let rewarded = 0, tried = 0;
    for (let seed = 1; seed <= 6 && tried < 3; seed++) {
      const s = start(seed);
      if (!s) continue;
      run(s, 8);
      const c = s.traffic.eventCar(s.ev.fugitiveCar);
      if (!c || s.ev.done) continue;
      // Sa voiture rend l'âme (comme percutée) ; le joueur arrive à côté.
      s.traffic.dent(c.id, 80, c.state.x + 3, c.state.y);
      run(s, 10, undefined, () => s.ev.phase === "foot");
      if (s.ev.phase !== "foot") continue;
      tried++;
      const q = { x: 0, y: 0 };
      s.peds.position(s.ev.runner, q);
      s.player.x = q.x + 6;
      s.player.y = q.y;
      run(s, 60, () => {
        if (s.ev.runner < 0 || s.ev.phase !== "foot") return;
        s.peds.position(s.ev.runner, q);
        const dx = q.x - s.player.x, dy = q.y - s.player.y, d = Math.hypot(dx, dy) || 1, v = d < 0.2 ? 0 : 7;
        s.player.vx = (dx / d) * v;
        s.player.vy = (dy / d) * v;
        s.player.speed = v;
        s.player.x += (dx / d) * Math.min(d, v * DT);
        s.player.y += (dy / d) * Math.min(d, v * DT);
      });
      if (s.ev.outcome === "rattrape") {
        rewarded++;
        expect(s.log.earned).toBe(PURSUIT.reward);
        expect(s.ev.caught).toBe(true);
      }
      expect(borrowed(s.peds)).toBe(0);
    }
    expect(tried).toBeGreaterThanOrEqual(2);
    expect(rewarded).toBeGreaterThanOrEqual(1);
  }, 600000);
});
