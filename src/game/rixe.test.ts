import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RIXE, RixeEvent, findRixe, type RixeEffects } from "../core/events/rixe";
import { EventRng, type EventContext, type EventPlayer } from "../core/events/types";
import { lanePoint } from "../core/driver";
import { LIFE_POSE } from "../core/character-rig";
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
  earned: number;
  hurt: number;
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
  const log: Log = { says: [], earned: 0, hurt: 0 };
  const fx: RixeEffects = {
    say: (_s, t) => log.says.push(t), cry: () => {}, earn: (n) => (log.earned += n), feat: () => {}, crime: () => {}, hurtPlayer: (n) => (log.hurt += n),
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
    traffic?.update(DT, { x: player.x, y: player.y, yaw: player.yaw, speed: player.speed, hour: 21, vehicle: null });
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

/** Un « bar » à 40 m environ : la position d'un passant pris dans la foule (le jeu prend les bars et restaurants de la carte). */
function barNear(s: ReturnType<typeof setup>): { x: number; y: number }[] {
  const near: number[] = [], q = { x: 0, y: 0 };
  s.peds.queryCircle(s.player.x, s.player.y, 65, near);
  for (const i of near) {
    s.peds.position(i, q);
    const d = Math.hypot(q.x - s.player.x, q.y - s.player.y);
    if (d > 32 && d < 60) return [{ x: q.x, y: q.y }];
  }
  return [];
}

function start(seed: number, withTraffic = true) {
  const s = setup(seed, withTraffic);
  const rng = new EventRng(seed);
  const site = findRixe(s.peds, s.ctx, barNear(s), rng);
  return site ? { ...s, ev: new RixeEvent(s.peds, s.traffic, withTraffic ? s.nav.graph.road : null, s.nav.graph, s.fx, site, rng) } : null;
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

describe("rixe devant un bar (phase 4, E7)", () => {
  it("deux ou trois passants se rejoignent, se disputent, puis se battent aux poings ; personne n'en meurt", () => {
    let found = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const s = start(seed);
      if (!s) continue;
      found++;
      expect(s.ev.fighters.length).toBeGreaterThanOrEqual(2);
      run(s, RIXE.gather + 1, () => s.ev.phase === "dispute");
      expect(s.ev.phase).toBe("dispute");
      run(s, RIXE.dispute[1] + 1, () => s.ev.phase === "fight");
      expect(s.ev.phase).toBe("fight");
      expect(s.log.says.length).toBeGreaterThan(0);
      let fists = false, knocked = 0;
      const was = s.ev.fighters.map(() => false);
      run(s, 25, () => {
        s.ev.fighters.forEach((i, k) => {
          if (s.peds.state.pose![i] === LIFE_POSE.fists) fists = true;
          const down = s.peds.modeOf(i) >= PED_STATE.stumble;
          if (down && !was[k]) knocked++;
          was[k] = down;
        });
        return false;
      });
      expect(fists).toBe(true);
      expect(knocked).toBeGreaterThan(0);
      expect(s.ev.fighters.every((i) => s.peds.modeOf(i) !== PED_STATE.dead)).toBe(true);
      expect(s.ev.onlookers.length).toBeLessThanOrEqual(RIXE.onlookers);
      s.ev.abort();
      expect(borrowed(s.peds)).toBe(0);
    }
    expect(found).toBeGreaterThanOrEqual(3);
  }, 300000);

  it("la patrouille arrive, un gendarme descend : l'un s'enfuit, l'autre lève les mains et monte dans la voiture", () => {
    let arrested = 0, tried = 0;
    for (let seed = 1; seed <= 6 && tried < 3; seed++) {
      const s = start(seed);
      if (!s) continue;
      tried++;
      let t = 0, gendarmeAt = -1;
      run(s, RIXE.maxLife + 5, () => {
        t += DT;
        if (gendarmeAt < 0 && s.ev.gendarme >= 0) gendarmeAt = t;
        return false;
      });
      console.log(`rixe, graine ${seed} : gendarme à ${gendarmeAt.toFixed(0)} s, ${s.ev.outcome} à ${t.toFixed(0)} s`);
      expect(s.ev.done).toBe(true);
      if (s.ev.outcome === "arrete") {
        arrested++;
        expect(s.log.says).toContain("Gendarmerie ! On se calme !");
      }
      expect(["arrete", "disperse"]).toContain(s.ev.outcome);
      expect(borrowed(s.peds)).toBe(0);
      expect(s.traffic!.cars.filter((c) => c.event && !c.leave)).toHaveLength(0);
    }
    expect(tried).toBeGreaterThanOrEqual(2);
    expect(arrested).toBeGreaterThanOrEqual(1);
  }, 600000);

  it("le joueur les sépare : « C'est bon, c'est bon… », 50 €, une bonne action ; chacun repart de son côté", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      run(s, 30, () => s.ev.phase === "fight");
      if (s.ev.phase !== "fight") continue;
      run(s, 3);
      const q = { x: 0, y: 0 };
      s.peds.position(s.ev.fighters[0]!, q);
      s.player.x = q.x + 1.2;
      s.player.y = q.y;
      const a = s.ev.action(s.player);
      expect(a?.verb).toBe("Séparer");
      a!.run();
      expect(s.log.earned).toBe(RIXE.reward);
      expect(s.ev.goodDeed).toBe(true);
      run(s, 5);
      expect(s.ev.done).toBe(true);
      expect(s.ev.outcome).toBe("separe");
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucune rixe");
  }, 120000);

  it("le joueur frappe un bagarreur : celui-là s'en prend à lui ; le joueur s'éloigne, il le lâche", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed);
      if (!s) continue;
      run(s, 30, () => s.ev.phase === "fight");
      if (s.ev.phase !== "fight") continue;
      const f = s.ev.fighters[0]!, q = { x: 0, y: 0 };
      s.peds.position(f, q);
      s.player.x = q.x + 1.2;
      s.player.y = q.y;
      // Le coup de poing du joueur (comme `melee` dans le jeu) : une poussée qui le fait tomber.
      s.peds.applyImpulse(f, -4, 0);
      run(s, 0.2);
      expect(s.ev.angry).toBe(0);
      run(s, 8);
      expect(s.log.hurt).toBeGreaterThan(0);
      // Le joueur file à 30 m : il le lâche.
      s.player.x += 30;
      run(s, 5);
      expect(s.ev.done).toBe(true);
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucune rixe");
  }, 120000);

  it("sans circulation (pas de patrouille), ils finissent par se séparer d'eux-mêmes", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = start(seed, false);
      if (!s) continue;
      run(s, RIXE.gather + RIXE.dispute[1] + RIXE.fightMax + 10);
      expect(s.ev.done).toBe(true);
      expect(s.ev.outcome).toBe("disperse");
      expect(borrowed(s.peds)).toBe(0);
      return;
    }
    throw new Error("aucune rixe");
  }, 120000);
});
