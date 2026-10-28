import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Gun, type ShootWorld } from "../core/gun";
import { Melee, type Arena } from "../core/melee";
import { MAX_CORPSES, PedSim, type Observer } from "../core/pedestrians";
import { Signals } from "../core/signals";
import { loadRealNav, loadRealRoadWorld } from "../core/testing";
import { Inventory, WEAPONS } from "../core/weapons";
import { NavManager } from "./nav-manager";
import { Traffic } from "./traffic";

const { world, colliders } = loadRealRoadWorld();
const { cells } = loadRealNav();
const DT = 1 / 60;

interface Report {
  deaths: number;
  maxCorpses: number;
  maxTotal: number;
  /** Cadavres restants N secondes après la fin des meurtres. */
  corpsesAfter: number[];
  bad: number;
  shots: number;
}

/**
 * Endurance du combat (J5-2, piège 8) : 100 passants, 20 voitures, feux ; le joueur à pied, batte en main, court après le passant le plus proche et le frappe
 * pendant `kill` s, puis s'éloigne et ne touche plus à rien pendant `rest` s. Aucun cadavre ne doit dépasser `MAX_CORPSES`, les emplacements ne fuient pas
 * (vivants + cadavres ≤ capacité), tout reste fini, et les cadavres finissent par disparaître.
 */
function soak(seed: number, kill: number, rest: number, weapon: "bat" | "rifle" = "bat"): Report {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed);
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100, seed });
  peds.signals = signals;
  traffic.setPeds(peds);
  const arena: Arena = {
    pick: (x, y, h, r, a, m, out) => peds.pick(x, y, h, r, a, m, out),
    position: (s, o) => peds.position(s, o),
    hurt: (s, d, ux, uy, i) => peds.damage(s, d, ux, uy, i),
  };
  const melee = new Melee();
  const gun = new Gun(seed);
  const inv = new Inventory();
  inv.grant("rifle", 90);
  const shoot: ShootWorld = {
    ...arena,
    rayPed: (x, y, dx, dy, m, out) => peds.rayPed(x, y, dx, dy, m, out),
    wall: (ax, ay, bx, by) => colliders.raycast(ax, ay, bx, by),
  };
  let shots = 0;
  const me = { x: -10, y: -40, heading: 0 };
  const rep: Report = { deaths: 0, maxCorpses: 0, maxTotal: 0, corpsesAfter: [], bad: 0, shots: 0 };
  const out: number[] = [];
  const p = { x: 0, y: 0 };
  const total = (kill + rest) * 60;
  for (let i = 0; i < total; i++) {
    const t = i * DT;
    const killing = t < kill;
    let vx = 0, vy = 0;
    if (killing) {
      // Vers le passant le plus proche (à moins de 40 m), à 5 m/s (la course du joueur).
      if (peds.pick(me.x, me.y, 0, 40, Math.PI, 1, out) > 0) {
        peds.position(out[0]!, p);
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        me.heading = Math.atan2(p.x - me.x, p.y - me.y);
        if (d > 1.0) {
          vx = Math.sin(me.heading) * 5;
          vy = Math.cos(me.heading) * 5;
        }
      }
      if (weapon === "bat") melee.step(DT, true, WEAPONS.bat, me.x, me.y, me.heading, arena);
      else {
        // Le tireur regarde le passant le plus proche, tire sans arrêt, ramasse des balles toutes les minutes (une cache).
        if (i % 3600 === 0) inv.grant("rifle", 90);
        const r = gun.step(DT, true, false, WEAPONS.rifle, inv, me.x, me.y, me.heading, shoot);
        shots += r.fired;
        if (r.fired > 0) peds.alarm(me.x, me.y, 40, 8);
        if (inv.magOf("rifle") < 0 || inv.magOf("rifle") > WEAPONS.rifle.mag || inv.reserveOf("rifle") < 0 || inv.reserveOf("rifle") > WEAPONS.rifle.mag * 6) rep.bad++;
      }
    } else {
      melee.cancel();
    }
    me.x += vx * DT;
    me.y += vy * DT;
    traffic.step(DT, { kind: "foot", x: me.x, y: me.y, vx, vy });
    traffic.update(DT, { x: me.x, y: me.y, yaw: me.heading, speed: Math.hypot(vx, vy), hour: 15, vehicle: null });
    const obs: Observer = { x: me.x, y: me.y, vx, vy, yaw: me.heading, onFoot: true, vehicle: null, hour: 15, vehicles: traffic.bodies(), honks: traffic.takeHonks() };
    if (i === 0) peds.prefill(obs);
    peds.clearEvents();
    peds.step(DT, obs);
    traffic.applyImpacts();
    signals.clock.t += DT;
    const st = peds.stats;
    // Le plafond vaut pour les cadavres qui ne s'enfoncent pas encore.
    rep.maxCorpses = Math.max(rep.maxCorpses, st.corpses - st.sinking);
    rep.maxTotal = Math.max(rep.maxTotal, st.alive + st.corpses);
    if (!Number.isFinite(me.x) || !Number.isFinite(peds.checksum())) rep.bad++;
    if (st.alive + st.corpses > 100) rep.bad++;
    if (!killing && Math.round(t - kill) % 30 === 0 && i % 60 === 0) rep.corpsesAfter.push(st.corpses);
  }
  rep.deaths = peds.stats.deaths;
  rep.shots = shots;
  traffic.dispose();
  return rep;
}

describe("endurance du combat (J5-2)", () => {
  it("un joueur à la batte tue pendant plus de 3 minutes, puis s'arrête : jamais plus de 8 cadavres, pas de fuite d'emplacements, les cadavres disparaissent", () => {
    for (const seed of [3, 11]) {
      const r = soak(seed, 200, 200);
      expect(r.bad).toBe(0);
      expect(r.deaths).toBeGreaterThan(5);
      expect(r.maxCorpses).toBeLessThanOrEqual(MAX_CORPSES);
      expect(r.maxTotal).toBeLessThanOrEqual(100);
      // Plus de cadavre 200 s après la fin des meurtres (150 s en vue + 3 s d'enfoncement, une minute hors de vue).
      expect(r.corpsesAfter[r.corpsesAfter.length - 1]).toBe(0);
    }
  }, 600000);

  it("un tireur au fusil d'assaut tire pendant 3 minutes : munitions toujours cohérentes, cadavres plafonnés, aucun emplacement perdu, tout disparaît ensuite", () => {
    for (const seed of [3, 11]) {
      const r = soak(seed, 180, 200, "rifle");
      expect(r.bad).toBe(0);
      expect(r.shots).toBeGreaterThan(100);
      expect(r.deaths).toBeGreaterThan(5);
      expect(r.maxCorpses).toBeLessThanOrEqual(MAX_CORPSES);
      expect(r.maxTotal).toBeLessThanOrEqual(100);
      expect(r.corpsesAfter[r.corpsesAfter.length - 1]).toBe(0);
    }
  }, 600000);
});
