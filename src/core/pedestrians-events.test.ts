import { describe, expect, it } from "vitest";
import { LIFE_POSE } from "./character-rig";
import { NavGraph } from "./nav-graph";
import { ORDER, PED_STATE, PedSim, type Observer } from "./pedestrians";
import { loadRealNav, loadRealWorld } from "./testing";
import { buildColliders } from "./world";

/** Phase 4 (événements) : passants réquisitionnés, ordres, fuite volontaire. */

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

function crowd(seed: number, obs: Observer): PedSim {
  const sim = new PedSim(graph(), terrain, colliders, { capacity: 100, seed });
  sim.prefill(obs);
  for (let i = 0; i < 60; i++) sim.step(STEP, obs);
  return sim;
}

/** Le passant debout le plus proche de (x, y), seul (ni groupe ni chien). */
function nearest(sim: PedSim, x: number, y: number, min = 0): number {
  const p = { x: 0, y: 0 };
  let slot = -1, best = 1e9;
  for (let i = 0; i < sim.capacity; i++) {
    if (sim.modeOf(i) !== PED_STATE.walk || sim.attached(i)) continue;
    sim.position(i, p);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d >= min && d < best) {
      best = d;
      slot = i;
    }
  }
  return slot;
}

const at = (sim: PedSim, i: number): { x: number; y: number } => {
  const p = { x: 0, y: 0 };
  sim.position(i, p);
  return p;
};

describe("passants réquisitionnés (phase 4)", () => {
  it("un passant réquisitionné ne disparaît pas quand le joueur s'éloigne ; rendu, il disparaît comme les autres", () => {
    const obs = obsAt(0, -20);
    const sim = crowd(7, obs);
    const slot = nearest(sim, 0, -20);
    expect(sim.borrow(slot)).toBe(true);
    expect(sim.borrow(slot)).toBe(false);
    const id = sim.idOf(slot);
    const far = obsAt(260, 60);
    for (let i = 0; i < 60 * 3; i++) sim.step(STEP, far);
    expect(sim.state.alive![slot]).toBe(1);
    expect(sim.idOf(slot)).toBe(id);
    sim.release(slot);
    for (let i = 0; i < 60 * 3; i++) sim.step(STEP, far);
    expect(sim.state.alive![slot] === 0 || sim.idOf(slot) !== id).toBe(true);
  });

  it("on ne réquisitionne ni un emplacement vide, ni un passant à terre, ni un emplacement réservé", () => {
    const obs = obsAt(0, -20);
    const sim = new PedSim(graph(), terrain, colliders, { capacity: 60, seed: 3, reserved: 6 });
    sim.prefill(obs);
    for (let i = 0; i < 30; i++) sim.step(STEP, obs);
    const slot = nearest(sim, 0, -20);
    sim.applyImpulse(slot, 6, 0);
    expect(sim.borrow(slot)).toBe(false);
    expect(sim.borrow(sim.reservedStart)).toBe(false);
    let empty = -1;
    for (let i = 0; i < sim.reservedStart; i++) if (!sim.state.alive![i]) empty = i;
    if (empty >= 0) expect(sim.borrow(empty)).toBe(false);
  });

  it("`seek` mène droit à un point, `hold` le fait se tourner vers un point dans une pose ; rendu, il rejoint sa file sans saut", () => {
    const obs = obsAt(0, -20);
    const sim = crowd(11, obs);
    const slot = nearest(sim, 0, -20);
    sim.borrow(slot);
    const p0 = at(sim, slot);
    // Un point à 8 m, sur une file piétonne (pas dans un mur).
    const hit = graph().nearest(p0.x + 6, p0.y + 5, 15, 0xffff)!;
    let reached = -1;
    for (let i = 0; i < 60 * 12; i++) {
      sim.command(slot, ORDER.seek, hit.x, hit.y, 2.5);
      sim.step(STEP, obs);
      const p = at(sim, slot);
      if (reached < 0 && Math.hypot(p.x - hit.x, p.y - hit.y) < 0.6) reached = i * STEP;
    }
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(10);
    const p1 = at(sim, slot);
    sim.command(slot, ORDER.hold, p1.x + 5, p1.y, 0, LIFE_POSE.point);
    for (let i = 0; i < 60; i++) sim.step(STEP, obs);
    expect(sim.state.pose![slot]).toBe(LIFE_POSE.point);
    // Tourné vers l'est (cap π/2), et resté sur place.
    expect(Math.abs(Math.atan2(Math.sin(sim.headingOf(slot) - Math.PI / 2), Math.cos(sim.headingOf(slot) - Math.PI / 2)))).toBeLessThan(0.15);
    expect(Math.hypot(at(sim, slot).x - p1.x, at(sim, slot).y - p1.y)).toBeLessThan(0.3);
    // Rendu : il marche de nouveau sur sa file, sans sauter d'une image à l'autre.
    sim.release(slot);
    let prev = at(sim, slot), worst = 0;
    for (let i = 0; i < 60 * 3; i++) {
      sim.step(STEP, obs);
      if (!sim.state.alive![slot]) break;
      const p = at(sim, slot);
      worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = p;
    }
    expect(sim.isBorrowed(slot)).toBe(false);
    expect(sim.state.pose![slot]).not.toBe(LIFE_POSE.point);
    expect(worst).toBeLessThan(0.1);
  });

  it("fuite volontaire : un fuyard à 5,8 m/s creuse l'écart avec un poursuivant à 4,5 m/s qui va droit sur lui, sans attendre aux passages", () => {
    let gained = 0, total = 0, waits = 0;
    for (let trial = 0; trial < 8; trial++) {
      const obs = obsAt(0, -20);
      const sim = crowd(40 + trial, obs);
      const slot = nearest(sim, 0, -20, 5);
      if (slot < 0 || !sim.borrow(slot)) continue;
      const p0 = at(sim, slot);
      // Le poursuivant part à 8 m, du côté du joueur.
      const d0x = obs.x - p0.x, d0y = obs.y - p0.y, d0 = Math.hypot(d0x, d0y) || 1;
      const ch = { x: p0.x + (d0x / d0) * 8, y: p0.y + (d0y / d0) * 8 };
      for (let i = 0; i < 60 * 12; i++) {
        sim.command(slot, ORDER.flee, ch.x, ch.y, 5.8);
        // L'observateur suit le poursuivant (sinon la foule disparaît autour du fuyard).
        sim.step(STEP, { ...obs, x: ch.x, y: ch.y });
        if (sim.modeOf(slot) === PED_STATE.wait) waits++;
        const p = at(sim, slot), dx = p.x - ch.x, dy = p.y - ch.y, d = Math.hypot(dx, dy) || 1;
        ch.x += (dx / d) * 4.5 * STEP;
        ch.y += (dy / d) * 4.5 * STEP;
      }
      if (sim.modeOf(slot) < 0) continue;
      const p = at(sim, slot);
      total++;
      // Écart initial 8 m ; 12 s à 1,3 m/s de mieux donneraient 23 m en ligne droite : les virages en mangent une partie.
      if (Math.hypot(p.x - ch.x, p.y - ch.y) > 14) gained++;
    }
    expect(total).toBeGreaterThanOrEqual(6);
    expect(gained).toBeGreaterThanOrEqual(Math.ceil(total * 0.75));
    expect(waits).toBe(0);
  });

  it("un fuyard plaqué tombe, se relève sans saut et reprend sa fuite (l'ordre tient)", () => {
    const obs = obsAt(0, -20);
    const sim = crowd(5, obs);
    const slot = nearest(sim, 0, -20);
    sim.borrow(slot);
    const p0 = at(sim, slot);
    for (let i = 0; i < 60; i++) {
      sim.command(slot, ORDER.flee, p0.x, p0.y - 6, 5.8);
      sim.step(STEP, obs);
    }
    sim.applyImpulse(slot, 0, 4.2);
    expect(sim.modeOf(slot)).toBe(PED_STATE.down);
    let prev = at(sim, slot), worst = 0, ran = false;
    for (let i = 0; i < 60 * 8; i++) {
      sim.command(slot, ORDER.flee, p0.x, p0.y - 6, 5.8);
      sim.step(STEP, obs);
      const p = at(sim, slot);
      if (sim.modeOf(slot) === PED_STATE.walk || sim.modeOf(slot) === PED_STATE.cross) {
        worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y));
        if (sim.speedOf(slot) > 4) ran = true;
      }
      prev = p;
    }
    expect(sim.isBorrowed(slot)).toBe(true);
    expect(ran).toBe(true);
    expect(worst).toBeLessThan(0.15);
  });

  it("l'alarme fait fuir loin de la scène sur plusieurs carrefours (fuite volontaire), pas seulement retourner la file", () => {
    let closer = 0, total = 0, sum = 0;
    for (let trial = 0; trial < 12; trial++) {
      const obs = obsAt(0, -20);
      const s2 = crowd(100 + trial, obs);
      const slot = nearest(s2, 0, -20);
      const before = at(s2, slot);
      const sx = before.x, sy = before.y - 5;
      s2.alarm(sx, sy, 20, 10);
      for (let i = 0; i < 60 * 8; i++) s2.step(STEP, obs);
      if (!s2.state.alive![slot] || s2.modeOf(slot) >= PED_STATE.stumble) continue;
      const p = at(s2, slot);
      total++;
      const d = Math.hypot(p.x - sx, p.y - sy);
      sum += d;
      if (d < Math.hypot(before.x - sx, before.y - sy)) closer++;
    }
    expect(total).toBeGreaterThan(6);
    expect(closer).toBeLessThanOrEqual(1);
    // 8 s de course à 3,8 m/s : en moyenne loin de la scène.
    expect(sum / total).toBeGreaterThan(14);
  });

  it("`setRecipe` change la recette et prévient le rendu ; l'ordre est sans effet sur un passant non réquisitionné", () => {
    const obs = obsAt(0, -20);
    const sim = crowd(9, obs);
    const slot = nearest(sim, 0, -20);
    const seen: number[] = [];
    sim.onSpawn = (i) => seen.push(i);
    sim.setRecipe(slot, { ...sim.recipe(slot), bag: "handbag" });
    expect(sim.recipe(slot).bag).toBe("handbag");
    expect(seen).toContain(slot);
    const p = at(sim, slot);
    sim.command(slot, ORDER.seek, p.x + 30, p.y, 3);
    sim.step(STEP, obs);
    expect(sim.isBorrowed(slot)).toBe(false);
  });
});
