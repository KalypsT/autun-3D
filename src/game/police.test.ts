import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadRealNav, loadRealWorld } from "../core/testing";
import { Signals } from "../core/signals";
import { buildColliders } from "../core/world";
import { Wanted } from "../core/wanted";
import { NavManager } from "./nav-manager";
import { PoliceController, type PolicePlayer } from "./police";
import { Traffic } from "./traffic";

const world = loadRealWorld();
const { cells } = loadRealNav();
const colliders = buildColliders(world.tile);
const DT = 1 / 60;

function setup(capacity: number): { traffic: Traffic; police: PoliceController; wanted: Wanted } {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, capacity, signals, 11);
  const wanted = new Wanted();
  const police = new PoliceController(wanted, colliders, () => nav.graph.road, () => signals, () => traffic);
  return { traffic, police, wanted };
}

const foot = (x: number, y: number): PolicePlayer => ({ x, y, vx: 0, vy: 0, heading: 0, speed: 0, driving: false, pedHits: 0, pedHitSpeed: 0, witnesses: () => 0 });

function run(traffic: Traffic, police: PoliceController, seconds: number, p: PolicePlayer, each?: () => void): void {
  for (let k = 0; k < seconds * 60; k++) {
    traffic.step(DT, { kind: "foot", x: p.x, y: p.y, vx: 0, vy: 0 });
    traffic.update(DT, { x: p.x, y: p.y, yaw: 0, speed: 0, hour: 15, vehicle: null });
    police.update(DT, p);
    each?.();
  }
}

describe("police dans le jeu (J4-4)", () => {
  it("deux étoiles : deux voitures en poursuite, qui finissent par voir le joueur ; piste perdue au loin : fouille, puis plus d'étoile et plus de poursuite", () => {
    const { traffic, police, wanted } = setup(10);
    const here = foot(-10, -40);
    wanted.set(2, here.x, here.y);
    let seen = false, maxChasing = 0;
    run(traffic, police, 60, here, () => {
      seen ||= wanted.seen;
      maxChasing = Math.max(maxChasing, traffic.chasing);
    });
    expect(maxChasing).toBe(2);
    expect(seen).toBe(true);
    expect(police.minimap.units.length).toBeGreaterThanOrEqual(2);
    // Le joueur s'enfuit à 8 m/s vers l'est (il traverse les murs : seule compte la vue de la police), puis se cache à 500 m.
    const p = foot(-10, -40);
    let searched = false;
    for (let k = 0; k < 60 * 240; k++) {
      if (p.x < 500) p.x += 8 * DT;
      traffic.step(DT, { kind: "foot", x: p.x, y: p.y, vx: 0, vy: 0 });
      traffic.update(DT, { x: p.x, y: p.y, yaw: Math.PI, speed: 0, hour: 15, vehicle: null });
      police.update(DT, p);
      if (police.minimap.search) searched = true;
      if (wanted.stars === 0) break;
    }
    expect(searched).toBe(true);
    expect(wanted.stars).toBe(0);
    run(traffic, police, 2, p);
    expect(traffic.pursuers).toBe(0);
    expect(traffic.chasing).toBe(0);
    traffic.dispose();
  }, 120000);

  it("une infraction sous les yeux de la police compte tout de suite ; loin d'elle, seul l'appel d'un témoin compte (après 6 s)", () => {
    const { traffic, police, wanted } = setup(0);
    // Pas de police du tout : le vol d'un véhicule garé passe inaperçu, le vol avec conducteur est signalé.
    police.crime("theft", 0, 0, false);
    expect(wanted.stars).toBe(0);
    police.crime("carjack", 0, 0, true);
    expect(wanted.stars).toBe(0);
    expect(wanted.pendingCalls).toBe(1);
    run(traffic, police, 7, foot(0, 0));
    expect(wanted.stars).toBe(1);
    // Une voiture en poursuite arrive : un vol sous ses yeux ne change rien à une étoile, renverser un passant en ajoute une.
    run(traffic, police, 60, foot(-10, -40));
    expect(wanted.seen).toBe(true);
    const p = { ...foot(-10, -40), driving: true, pedHits: 1, pedHitSpeed: 8 };
    police.update(DT, p);
    expect(wanted.stars).toBe(2);
    traffic.dispose();
  }, 120000);
});
