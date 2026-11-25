import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MALAISE, MalaiseEvent, findMalaise, type MalaiseEffects } from "../core/events/malaise";
import { EventRng, type EventContext, type EventPlayer } from "../core/events/types";
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
  earned: number;
  kneel: boolean[];
}

function setup(seed: number, withTraffic = true) {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = withTraffic ? new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed) : null;
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed, life: true });
  peds.signals = signals;
  traffic?.setPeds(peds);
  const list = starts(6), lp = { x: 0, y: 0, heading: 0 };
  lanePoint(nav.graph.road, list[seed % list.length]!, 10, lp);
  const player: EventPlayer = { x: lp.x, y: lp.y, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: lp.heading };
  const log: Log = { says: [], earned: 0, kneel: [] };
  const fx: MalaiseEffects = {
    say: (_s, t) => log.says.push(t), cry: () => {}, earn: (n) => (log.earned += n), feat: () => {}, crime: () => {}, kneel: (on) => log.kneel.push(on),
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
  for (let k = 0; k < 120; k++) frame();
  return { traffic, peds, nav, player, ctx, frame, log, fx };
}

function start(seed: number, withTraffic = true) {
  const s = setup(seed, withTraffic);
  const rng = new EventRng(seed);
  for (let k = 0; k < 4; k++) {
    const v = findMalaise(s.peds, s.ctx, rng);
    if (v >= 0) return { ...s, ev: new MalaiseEvent(s.peds, s.traffic, withTraffic ? s.nav.graph.road : null, s.nav.graph, s.fx, v, rng) };
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

describe("malaise d'un passant et pompiers (phase 4, E6)", () => {
  it("un passant à l'écran porte la main à sa poitrine, s'effondre ; des passants s'arrêtent, l'un se penche, l'autre appelle", () => {
    let found = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      found++;
      const v = s.ev.victim, q = { x: 0, y: 0 };
      s.peds.position(v, q);
      const d = Math.hypot(q.x - s.player.x, q.y - s.player.y);
      expect(d).toBeGreaterThanOrEqual(MALAISE.near);
      expect(d).toBeLessThanOrEqual(MALAISE.far);
      run(s, 0.2);
      expect(s.peds.state.pose![v]).toBe(LIFE_POSE.chest);
      run(s, MALAISE.chestFor + 0.5);
      expect(s.ev.phase).toBe("down");
      expect(s.peds.state.pose![v]).toBe(LIFE_POSE.collapse);
      run(s, 12);
      if (s.ev.helpers.length) {
        expect(s.ev.helpers.some((h) => s.peds.state.pose![h] === LIFE_POSE.kneel || s.peds.state.pose![h] === LIFE_POSE.phone)).toBe(true);
        expect(s.log.says.length).toBeGreaterThan(0);
      }
      s.ev.abort();
      expect(borrowed(s.peds)).toBe(0);
    }
    expect(found).toBeGreaterThanOrEqual(4);
  }, 120000);

  it("les pompiers arrivent sirène, se garent, le soignent, puis le relèvent ou l'emmènent ; rien ne reste réquisitionné", () => {
    let done = 0, tried = 0;
    const outcomes: string[] = [];
    for (let seed = 1; seed <= 6 && tried < 3; seed++) {
      const s = start(seed);
      if (!s) continue;
      tried++;
      let arrivedAt = -1, sawSiren = false, t = 0;
      run(s, MALAISE.maxLife, () => {
        t += DT;
        if (s.ev.van >= 0 && s.traffic!.cars.some((c) => c.def.id === "pompiers" && c.siren)) sawSiren = true;
        if (arrivedAt < 0 && s.ev.firemen.length) arrivedAt = t;
        return false;
      });
      expect(s.ev.done).toBe(true);
      outcomes.push(s.ev.outcome!);
      console.log(`pompiers, graine ${seed} : arrivés à ${arrivedAt.toFixed(0)} s, ${s.ev.outcome}, fin à ${t.toFixed(0)} s`);
      if (arrivedAt > 0) {
        done++;
        expect(sawSiren).toBe(true);
        // Les pompiers arrivent environ une minute et demie après la chute.
        expect(arrivedAt).toBeGreaterThan(MALAISE.callAfter[0]);
        expect(arrivedAt).toBeLessThan(200);
        expect(["soigne", "evacue", "termine"]).toContain(s.ev.outcome);
        expect(s.log.says).toContain("Pompiers ! Écartez-vous.");
      }
      expect(borrowed(s.peds)).toBe(0);
      expect(s.traffic!.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
    }
    expect(tried).toBeGreaterThanOrEqual(2);
    expect(done).toBeGreaterThanOrEqual(1);
  }, 600000);

  it("le joueur l'aide (un genou à terre 4 s) : il se relève, « Merci… ça va mieux. », 80 €, une bonne action ; le fourgon fait demi-tour", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      run(s, MALAISE.chestFor + 1);
      const q = { x: 0, y: 0 };
      s.peds.position(s.ev.victim, q);
      s.player.x = q.x + 1;
      s.player.y = q.y;
      const a = s.ev.action(s.player);
      expect(a?.verb).toBe("Aider");
      a!.run();
      expect(s.log.kneel).toEqual([true]);
      // Personne d'autre ne propose d'aider pendant ce temps.
      expect(s.ev.action(s.player)).toBeNull();
      run(s, MALAISE.helpFor + 0.2);
      expect(s.ev.helped).toBe(true);
      expect(s.log.kneel).toEqual([true, false]);
      expect(s.log.earned).toBe(MALAISE.reward);
      expect(s.ev.goodDeed).toBe(true);
      run(s, 15);
      expect(s.log.says).toContain("Merci… ça va mieux.");
      expect(s.ev.done).toBe(true);
      expect(s.ev.outcome).toBe("secouru");
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucun malaise");
  }, 120000);

  it("le joueur s'éloigne pendant qu'il l'aide : l'aide s'arrête, pas de prime", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      run(s, MALAISE.chestFor + 1);
      const q = { x: 0, y: 0 };
      s.peds.position(s.ev.victim, q);
      s.player.x = q.x + 1;
      s.player.y = q.y;
      s.ev.action(s.player)!.run();
      run(s, 1);
      s.player.x += 5;
      run(s, 5);
      expect(s.ev.helped).toBe(false);
      expect(s.log.kneel).toEqual([true, false]);
      expect(s.log.earned).toBe(0);
      s.ev.abort();
      return;
    }
    throw new Error("aucun malaise");
  }, 120000);

  it("sans circulation (pas de pompiers), il finit par se relever seul", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed, false);
      if (!s) continue;
      run(s, MALAISE.chestFor + MALAISE.aloneFor - 5);
      // Toujours à terre juste avant.
      expect(s.ev.done).toBe(false);
      run(s, 25);
      expect(s.ev.done).toBe(true);
      expect(s.ev.outcome).toBe("termine");
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucun malaise");
  }, 120000);
});
