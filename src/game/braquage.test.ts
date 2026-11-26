import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BRAQUAGE, BraquageEvent, findShop, type BraquageEffects } from "../core/events/braquage";
import { EventRng, type EventContext, type EventPlayer } from "../core/events/types";
import { lanePoint } from "../core/driver";
import { GUN_POSE } from "../core/character-rig";
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
  shots: number;
  hits: number;
  hurt: number;
  drops: number;
  alarms: number;
  earned: number;
}

function setup(seed: number, withTraffic = true) {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = withTraffic ? new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed) : null;
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed, life: true });
  peds.signals = signals;
  traffic?.setPeds(peds);
  const lp = { x: 0, y: 0, heading: 0 };
  lanePoint(nav.graph.road, starts(6)[seed % 6]!, 10, lp);
  const player: EventPlayer = { x: lp.x, y: lp.y, vx: 0, vy: 0, speed: 0, onFoot: true, yaw: lp.heading, aiming: false };
  const log: Log = { says: [], shots: 0, hits: 0, hurt: 0, drops: 0, alarms: 0, earned: 0 };
  const fx: BraquageEffects = {
    say: (_s, t) => log.says.push(t), cry: () => {}, earn: (n) => (log.earned += n), feat: () => {}, crime: () => {},
    shoot: (_a, _b, _c, _d, hit, dmg) => {
      log.shots++;
      if (hit) {
        log.hits++;
        log.hurt += dmg;
      }
    },
    dropGun: () => log.drops++, alarm: () => log.alarms++,
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
    traffic?.step(DT, { kind: "foot", x: player.x, y: player.y, vx: player.vx, vy: player.vy });
    traffic?.update(DT, { x: player.x, y: player.y, yaw: player.yaw, speed: player.speed, hour: 20, vehicle: null });
    const obs: Observer = { x: player.x, y: player.y, vx: player.vx, vy: player.vy, yaw: player.yaw, onFoot: true, vehicle: null, hour: 15, vehicles: traffic?.bodies() ?? [], honks: traffic?.takeHonks() ?? [] };
    if (i++ === 0) peds.prefill(obs);
    peds.clearEvents();
    peds.step(DT, obs);
    traffic?.applyImpacts();
    signals.clock.t += DT;
  };
  for (let k = 0; k < 120; k++) frame();
  return { traffic, peds, nav, player, ctx, frame, log, fx };
}

/** Des commerces « de test » : des points du graphe piéton à 40 – 70 m devant le joueur (le jeu prend les commerces ouverts de la carte). */
function start(seed: number, withTraffic = true) {
  const s = setup(seed, withTraffic);
  const shops: { x: number; y: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const a = s.player.yaw + (k / 8 - 0.5), r = 45 + (k % 3) * 10, hit = s.nav.graph.nearest(s.player.x + Math.sin(a) * r, s.player.y + Math.cos(a) * r, 10);
    if (hit) shops.push({ x: hit.x, y: hit.y });
  }
  const rng = new EventRng(seed), shop = findShop(shops, s.nav.graph, s.ctx, rng);
  if (!shop) return null;
  const ev = new BraquageEvent(s.peds, s.traffic, withTraffic ? s.nav.graph.road : null, s.nav.graph, s.fx, shop, rng);
  return ev.ok ? { ...s, ev } : null;
}

type Run = NonNullable<ReturnType<typeof start>>;

function run(s: Run, seconds: number, bot?: () => void, until?: () => boolean): void {
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

/** Le joueur court vers le braqueur (à `v` m/s). */
function chase(s: Run, v: number): () => void {
  const q = { x: 0, y: 0 };
  return () => {
    if (s.ev.phase !== "flee" && s.ev.phase !== "aim") {
      s.player.vx = s.player.vy = s.player.speed = 0;
      return;
    }
    s.peds.position(s.ev.robber, q);
    const dx = q.x - s.player.x, dy = q.y - s.player.y, d = Math.hypot(dx, dy) || 1, sp = d < 0.2 ? 0 : v;
    s.player.vx = (dx / d) * sp;
    s.player.vy = (dy / d) * sp;
    s.player.speed = sp;
    s.player.yaw = Math.atan2(dx, dy);
    s.player.x += (dx / d) * Math.min(d, sp * DT);
    s.player.y += (dy / d) * Math.min(d, sp * DT);
  };
}

describe("braquage d'un commerce (phase 4, E13)", () => {
  it("un braqueur cagoulé sort en courant, pistolet à la main ; l'alarme sonne, le commerçant crie ; sans le joueur, il s'échappe", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      expect(s.peds.state.held![s.ev.robber]).toBe(1);
      expect(s.peds.recipe(s.ev.robber).hat).toBe("beanie");
      expect(s.log.alarms).toBe(1);
      expect(s.log.says).toContain("Au voleur ! Il a une arme !");
      expect(s.ev.lawfulTarget(s.ev.robber)).toBe(true);
      run(s, BRAQUAGE.maxLife + 5);
      expect(s.ev.done).toBe(true);
      expect(s.ev.outcome).toBe("enfui");
      expect(s.log.shots).toBe(0);
      expect(borrowed(s.peds)).toBe(0);
      expect(s.peds.state.held!.every((h) => h === 0)).toBe(true);
      return;
    }
    throw new Error("aucun braquage");
  }, 300000);

  it("menacé d'une arme, il s'arrête, vise et tire trois fois au plus, puis repart", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      run(s, 1);
      const q = { x: 0, y: 0 };
      s.peds.position(s.ev.robber, q);
      s.player.x = q.x + 12;
      s.player.y = q.y;
      s.player.aiming = true;
      run(s, 1, undefined, () => s.ev.phase === "aim");
      expect(s.ev.phase).toBe("aim");
      run(s, 0.5);
      expect(s.peds.state.pose![s.ev.robber]).toBe(GUN_POSE.aim);
      run(s, 5, undefined, () => s.ev.phase === "flee");
      expect(s.log.shots).toBeGreaterThanOrEqual(1);
      expect(s.log.shots).toBeLessThanOrEqual(BRAQUAGE.shots);
      expect(s.ev.phase).toBe("flee");
      expect(s.log.hurt).toBe(s.log.hits * BRAQUAGE.damage);
      s.ev.abort();
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucun braquage");
  }, 120000);

  it("plaqué par le joueur : il lâche son arme, lève les mains ; la patrouille l'emmène ; prime de 800 €", () => {
    let caught = 0, tried = 0;
    const shotAt: number[] = [];
    for (let seed = 1; seed <= 8 && tried < 4; seed++) {
      const s = start(seed);
      if (!s) continue;
      tried++;
      run(s, BRAQUAGE.maxLife, chase(s, 7.5));
      shotAt.push(s.log.shots);
      expect(s.ev.done).toBe(true);
      if (s.ev.outcome === "rattrape") {
        caught++;
        expect(s.ev.caught).toBe(true);
        expect(s.log.drops).toBe(1);
        expect(s.log.earned).toBe(BRAQUAGE.reward);
      }
      expect(borrowed(s.peds)).toBe(0);
      expect(s.traffic!.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
    }
    console.log(`braquages poursuivis : ${tried}, arrêtés ${caught}, tirs reçus ${shotAt.join(", ")}`);
    expect(tried).toBeGreaterThanOrEqual(3);
    expect(caught).toBeGreaterThanOrEqual(1);
  }, 600000);

  it("sans circulation, plaqué, il est emmené au bout de quelques secondes (prime aussi)", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed, false);
      if (!s) continue;
      run(s, 120, chase(s, 7.5));
      if (s.ev.outcome !== "rattrape") continue;
      expect(s.log.earned).toBe(BRAQUAGE.reward);
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("jamais rattrapé");
  }, 300000);
});
