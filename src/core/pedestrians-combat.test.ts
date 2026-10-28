import { describe, expect, it } from "vitest";
import { Melee } from "./melee";
import { NavGraph } from "./nav-graph";
import { CORPSE_HIDDEN_LIFE, CORPSE_MAX_LIFE, MAX_CORPSES, PED_HP, PED_STATE, PedSim, SINK_TIME, VEHICLE_DAMAGE, WOUNDED_HP, type Observer, type PedEvent, type TrafficBody } from "./pedestrians";
import { loadRealNav, loadRealWorld } from "./testing";
import { WEAPONS } from "./weapons";
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
const obsAt = (x: number, y: number): Observer => ({ x, y, vx: 0, vy: 0, yaw: 0, onFoot: true, vehicle: null, hour: 13 });

/** Une foule remplie, puis le passant le plus proche de (0, −20) et sa position. */
function setup(): { sim: PedSim; slot: number; pos: { x: number; y: number }; obs: Observer } {
  const sim = new PedSim(graph(), terrain, colliders, { capacity: 100, seed: 7 });
  const obs = obsAt(0, -20);
  sim.prefill(obs);
  for (let i = 0; i < 60; i++) sim.step(STEP, obs);
  let slot = -1, best = 1e9;
  const p = { x: 0, y: 0 };
  for (let i = 0; i < sim.capacity; i++) {
    if (!sim.state.alive![i]) continue;
    sim.position(i, p);
    const d = Math.hypot(p.x - obs.x, p.y - obs.y);
    if (d < best) { best = d; slot = i; }
  }
  const pos = { x: 0, y: 0 };
  sim.position(slot, pos);
  return { sim, slot, pos, obs };
}

describe("passants : coups, blessure, fuite (J5-1)", () => {
  it("`pick` trie du plus proche au plus loin, respecte le cône et la portée, ignore les passants à terre", () => {
    const { sim, slot, pos } = setup();
    const out: number[] = [];
    // De 1 m au sud du passant, cap plein nord : il est devant, tout près.
    expect(sim.pick(pos.x, pos.y - 1, 0, 1.2, 0.8, 5, out)).toBeGreaterThanOrEqual(1);
    expect(out[0]).toBe(slot);
    // Cap opposé : il est derrière.
    sim.pick(pos.x, pos.y - 1, Math.PI, 1.2, 0.5, 5, out);
    expect(out.includes(slot)).toBe(false);
    // Hors de portée.
    sim.pick(pos.x, pos.y - 6, 0, 1.2, 0.8, 5, out);
    expect(out.includes(slot)).toBe(false);
    // Tri : les distances croissent.
    const many = sim.pick(pos.x, pos.y, 0, 60, Math.PI, 8, out);
    const p = { x: 0, y: 0 };
    let last = -1;
    for (let k = 0; k < many; k++) {
      sim.position(out[k]!, p);
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    expect(many).toBeLessThanOrEqual(8);
    // Un passant à terre n'est plus une cible.
    sim.applyImpulse(slot, 6, 0);
    sim.pick(pos.x, pos.y, 0, 5, Math.PI, 5, out);
    expect(out.includes(slot)).toBe(false);
  });

  it("un coup retire des points de vie, fait trébucher ou tomber, déclenche l'événement et la fuite loin du coup", () => {
    const { sim, slot, pos, obs } = setup();
    expect(sim.health(slot)).toBe(PED_HP);
    sim.clearEvents();
    // Coup de poing venu du sud (vers le nord) : le passant est poussé vers le nord et doit fuir vers le nord.
    expect(sim.damage(slot, 12, 0, 1, 1.4)).toBe(1);
    expect(sim.health(slot)).toBe(88);
    const ev = sim.events.find((e: PedEvent) => e.kind === "hurt" && e.slot === slot);
    expect(ev).toBeDefined();
    // Pendant qu'il trébuche, un second coup ne compte pas.
    expect(sim.damage(slot, 12, 0, 1, 1.4)).toBe(0);
    expect(sim.health(slot)).toBe(88);
    for (let i = 0; i < 60 * 3; i++) sim.step(STEP, obs);
    expect(sim.fleeing(slot)).toBe(true);
    const after = { x: 0, y: 0 };
    sim.position(slot, after);
    // Il s'éloigne du point d'où est venu le coup (le sud), quelle que soit sa file d'origine.
    for (let i = 0; i < 60 * 4; i++) sim.step(STEP, obs);
    const later = { x: 0, y: 0 };
    sim.position(slot, later);
    expect(Math.hypot(later.x - after.x, later.y - after.y)).toBeGreaterThan(5);
    expect(later.y - pos.y).toBeGreaterThan(-2);
  });

  it("blessé sous 40 points il fuit plus longtemps ; à 0 il meurt : il reste à terre pour de bon et son événement part", () => {
    const { sim, slot, obs } = setup();
    expect(sim.damage(slot, 100 - WOUNDED_HP + 1, 1, 0, 1.4)).toBe(1);
    expect(sim.health(slot)).toBe(WOUNDED_HP - 1);
    for (let i = 0; i < 60 * 10; i++) sim.step(STEP, obs);
    // 8 s pour un passant touché, 20 s pour un blessé : il court encore après 10 s.
    expect(sim.fleeing(slot)).toBe(true);
    sim.clearEvents();
    expect(sim.damage(slot, 500, 1, 0, 1.4)).toBe(2);
    expect(sim.health(slot)).toBe(0);
    expect(sim.events.some((e: PedEvent) => e.kind === "killed" && e.slot === slot)).toBe(true);
    expect(sim.stats.deaths).toBe(1);
    // Il ne se relève jamais, tant qu'il est là : 20 s plus tard, toujours à terre, dans la pose de chute tenue.
    for (let i = 0; i < 60 * 20; i++) sim.step(STEP, obs);
    expect(sim.state.alive![slot]).toBe(1);
    expect(sim.state.pose![slot]).toBe(2);
    expect(sim.state.poseT![slot]!).toBeLessThan(2.7);
    expect(sim.stats.corpses).toBe(1);
    // Un mort ne reçoit plus de coups, n'est plus une cible, ne témoigne de rien.
    expect(sim.damage(slot, 10, 1, 0, 1)).toBe(0);
    const p = { x: 0, y: 0 };
    sim.position(slot, p);
    const out: number[] = [];
    sim.pick(p.x, p.y, 0, 5, Math.PI, 5, out);
    expect(out.includes(slot)).toBe(false);
    out.length = 0;
    sim.queryCircle(p.x, p.y, 3, out);
    expect(out.includes(slot)).toBe(false);
  });

  it("les cadavres ne comptent pas parmi les passants et la foule se remplit autour d'eux", () => {
    const sim = new PedSim(graph(), terrain, colliders, { capacity: 100, seed: 7 });
    const obs = obsAt(0, -20);
    sim.prefill(obs);
    for (let i = 0; i < 120; i++) sim.step(STEP, obs);
    const before = sim.stats.alive;
    let killed = 0;
    for (let i = 0; i < sim.capacity && killed < 5; i++) {
      if (sim.state.alive![i] && sim.damage(i, 500, 1, 0, 1.4) === 2) killed++;
    }
    expect(killed).toBe(5);
    for (let i = 0; i < 60 * 30; i++) sim.step(STEP, obs);
    expect(sim.stats.corpses).toBe(5);
    expect(sim.stats.alive).toBeGreaterThanOrEqual(before - 8);
    expect(sim.stats.alive + sim.stats.corpses).toBeLessThanOrEqual(100);
  });

  it("au plus 8 cadavres : le plus ancien s'enfonce dans le sol puis disparaît", () => {
    const sim = new PedSim(graph(), terrain, colliders, { capacity: 100, seed: 7 });
    const obs = obsAt(0, -20);
    sim.prefill(obs);
    for (let i = 0; i < 60; i++) sim.step(STEP, obs);
    const dead: number[] = [];
    for (let i = 0; i < sim.capacity && dead.length < MAX_CORPSES + 3; i++) {
      if (sim.state.alive![i] && sim.damage(i, 500, 1, 0, 1.4) === 2) {
        dead.push(i);
        for (let k = 0; k < 60; k++) sim.step(STEP, obs);
      }
    }
    expect(dead.length).toBe(MAX_CORPSES + 3);
    // Les trois premiers (les plus anciens) ont fini de s'enfoncer, ou sont en train de le faire.
    for (let k = 0; k < Math.ceil(SINK_TIME * 60) + 60; k++) sim.step(STEP, obs);
    expect(sim.stats.corpses).toBeLessThanOrEqual(MAX_CORPSES);
    expect(sim.stats.corpses).toBeGreaterThanOrEqual(MAX_CORPSES - 1);
  });

  it("hors de vue, un cadavre s'enfonce sous le terrain au bout d'une minute, puis disparaît", () => {
    const sim = new PedSim(graph(), terrain, colliders, { capacity: 20, seed: 3 });
    sim.prefill(obsAt(0, -20));
    for (let i = 0; i < 60; i++) sim.step(STEP, obsAt(0, -20));
    const i = [...Array(20).keys()].find((k) => sim.state.alive![k])!;
    const p = { x: 0, y: 0 };
    sim.position(i, p);
    // Le joueur est à 40 m, le dos tourné au cadavre : il est hors de vue.
    const away: Observer = { ...obsAt(p.x, p.y - 40), yaw: Math.PI };
    sim.damage(i, 500, 0, 1, 1.4);
    let sunkAt = -1, goneAt = -1;
    for (let k = 0; k < 60 * (CORPSE_HIDDEN_LIFE + SINK_TIME + 5) && goneAt < 0; k++) {
      sim.step(STEP, away);
      const t = k / 60;
      // Le cadavre parti, l'emplacement est vite repris par un nouveau passant : on suit le compte de cadavres.
      if (sim.stats.corpses === 0 && t > 1) goneAt = t;
      else if (sunkAt < 0 && sim.state.y[i]! < terrain.heightAt(sim.state.x[i]!, -sim.state.z[i]!) - 0.05) sunkAt = t;
    }
    expect(sunkAt).toBeGreaterThan(CORPSE_HIDDEN_LIFE);
    expect(goneAt).toBeGreaterThan(CORPSE_HIDDEN_LIFE + SINK_TIME - 0.5);
    expect(sim.stats.corpses).toBe(0);
  });

  it("un cadavre en vue reste 150 s avant de s'enfoncer", () => {
    const sim = new PedSim(graph(), terrain, colliders, { capacity: 20, seed: 3 });
    sim.prefill(obsAt(0, -20));
    for (let i = 0; i < 60; i++) sim.step(STEP, obsAt(0, -20));
    const i = [...Array(20).keys()].find((k) => sim.state.alive![k])!;
    const p = { x: 0, y: 0 };
    sim.position(i, p);
    // Le joueur reste à 3 m, tourné vers lui.
    const here: Observer = { ...obsAt(p.x, p.y - 3), yaw: 0 };
    sim.damage(i, 500, 0, 1, 1.4);
    let sunkAt = -1;
    for (let k = 0; k < 60 * (CORPSE_MAX_LIFE + 2); k++) {
      sim.step(STEP, here);
      if (sunkAt < 0 && sim.state.y[i]! < terrain.heightAt(sim.state.x[i]!, -sim.state.z[i]!) - 0.05) sunkAt = k / 60;
    }
    expect(sunkAt).toBeGreaterThan(CORPSE_MAX_LIFE);
  });

  it("un véhicule tue au-delà de 50 km/h environ, blesse en dessous, et un trébuchement ne fait aucun dégât", () => {
    const hitAt = (speed: number): { hp: number; dead: boolean } => {
      const sim = new PedSim(graph(), terrain, colliders, { capacity: 100, seed: 7 });
      const obs = obsAt(0, -20);
      sim.prefill(obs);
      for (let i = 0; i < 60; i++) sim.step(STEP, obs);
      let slot = -1, best = 1e9;
      const p = { x: 0, y: 0 };
      for (let i = 0; i < sim.capacity; i++) {
        if (!sim.state.alive![i]) continue;
        sim.position(i, p);
        const d = Math.hypot(p.x - obs.x, p.y - obs.y);
        if (d < best) { best = d; slot = i; }
      }
      sim.position(slot, p);
      // Une voiture lancée vers le nord à `speed`, qui passe sur le passant au pas suivant.
      const car: TrafficBody = { x: p.x, y: p.y - 1.2, vx: 0, vy: speed, heading: 0, hull: [[0, 1.0]], slow: 0, speed: 0, hits: 0 };
      sim.step(STEP, { ...obs, vehicles: [car] });
      return { hp: sim.health(slot), dead: sim.stats.deaths > 0 };
    };
    expect(hitAt(2.5).hp).toBe(PED_HP);
    const slow = hitAt(8.3);
    expect(slow.hp).toBeCloseTo(PED_HP - (8.3 - 3.5) * VEHICLE_DAMAGE, 0);
    expect(slow.dead).toBe(false);
    expect(hitAt(12).dead).toBe(false);
    expect(hitAt(15).dead).toBe(true);
    expect(PED_STATE.dead).toBeGreaterThan(PED_STATE.down);
  });

  it("ne frappe pas les emplacements réservés, les absents ni les montants négatifs", () => {
    const sim = new PedSim(graph(), terrain, colliders, { capacity: 20, seed: 7, reserved: 4 });
    expect(sim.damage(19, 10, 1, 0, 1)).toBe(0);
    expect(sim.damage(0, 10, 1, 0, 1)).toBe(0);
    const { sim: s2, slot } = setup();
    expect(s2.damage(slot, -5, 1, 0, 1)).toBe(0);
    expect(s2.health(slot)).toBe(PED_HP);
  });

  it("le joueur au corps à corps : des poings à bout portant finissent par assommer un passant, qui s'éloigne ensuite", () => {
    const { sim, slot, pos } = setup();
    const melee = new Melee();
    // Le joueur arrive de 1 m au sud du passant, tourné vers lui ; le passant ne bouge presque pas pendant ce temps (il est sur sa file).
    const me = { x: pos.x, y: pos.y - 1, heading: 0 };
    let ko = false, hits = 0;
    const arena = {
      pick: (...a: Parameters<PedSim["pick"]>) => sim.pick(...a),
      position: (s: number, o: { x: number; y: number }) => sim.position(s, o),
      hurt: (s: number, d: number, ux: number, uy: number, i: number) => {
        const r = sim.damage(s, d, ux, uy, i);
        hits++;
        if (r === 2) ko = true;
        return r;
      },
    };
    for (let i = 0; i < 60 * 40 && !ko; i++) {
      const o = obsAt(me.x, me.y);
      sim.step(STEP, o);
      // Il faut rester collé au passant : on le suit (il s'est enfui d'un coup, on le rattrape).
      sim.position(slot, pos);
      const d = Math.hypot(pos.x - me.x, pos.y - me.y);
      if (d > 1) {
        me.x = pos.x - (pos.x - me.x) / d * 0.9;
        me.y = pos.y - (pos.y - me.y) / d * 0.9;
      }
      me.heading = Math.atan2(pos.x - me.x, pos.y - me.y);
      melee.step(STEP, true, WEAPONS.fists, me.x, me.y, me.heading, arena);
    }
    expect(hits).toBeGreaterThanOrEqual(3);
    expect(ko).toBe(true);
  });
});
