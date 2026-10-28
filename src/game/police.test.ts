import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadRealNav, loadRealWorld } from "../core/testing";
import { Signals } from "../core/signals";
import { buildColliders } from "../core/world";
import { Wanted } from "../core/wanted";
import { NavManager } from "./nav-manager";
import { ARREST_SPAWN, PoliceController, type PolicePlayer } from "./police";
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

const foot = (x: number, y: number): PolicePlayer => ({ x, y, vx: 0, vy: 0, heading: 0, speed: 0, driving: false, vehicle: null, pedHits: 0, pedHitSpeed: 0, witnesses: () => 0 });

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

  it("violence (J5-4) : sans témoin personne n'appelle ; avec un passant à portée l'agression fait une étoile et le meurtre deux après 6 s ; un passant tué par le véhicule du joueur est un meurtre", () => {
    const { traffic, police, wanted } = setup(0);
    // Personne autour : rien.
    police.crime("murder", 0, 0, false);
    run(traffic, police, 8, foot(0, 0));
    expect(wanted.stars).toBe(0);
    // Un témoin : l'agression compte après le délai (une étoile), le meurtre ensuite (deux).
    police.crime("assault", 0, 0, true);
    expect(wanted.stars).toBe(0);
    run(traffic, police, 7, foot(0, 0));
    expect(wanted.stars).toBe(1);
    police.crime("murder", 0, 0, true);
    run(traffic, police, 7, foot(0, 0));
    expect(wanted.stars).toBe(2);
    // Un passant tué au volant : la police absente, un témoin à moins de 40 m appelle ; sans témoin, rien.
    const w2 = setup(0);
    const killed = (witnesses: number): PolicePlayer => ({ ...foot(0, 0), driving: true, pedHits: 1, pedHitSpeed: 14, pedKills: 1, witnesses: () => witnesses });
    w2.police.update(DT, killed(0));
    expect(w2.wanted.pendingCalls).toBe(0);
    w2.police.update(DT, killed(3));
    expect(w2.wanted.pendingCalls).toBeGreaterThan(0);
    for (let i = 0; i < 7 * 60; i++) w2.police.update(DT, { ...foot(0, 0), driving: true });
    expect(w2.wanted.stars).toBeGreaterThanOrEqual(2);
    traffic.dispose();
    w2.traffic.dispose();
  }, 120000);

  it("police armée (J5-5) : à quatre étoiles et à pied, les gendarmes descendent, tirent et finissent par tuer un joueur immobile sans l'arrêter ; à trois étoiles, aucun tir", () => {
    const run4 = (stars: number): { damage: number; killedAt: number; arrested: boolean; shots: number } => {
      const { traffic, police, wanted } = setup(10);
      const here = foot(-10, -40);
      wanted.set(stars, here.x, here.y);
      let damage = 0, killedAt = -1, arrested = false, shots = 0;
      for (let k = 0; k < 60 * 240 && killedAt < 0; k++) {
        traffic.step(DT, { kind: "foot", x: here.x, y: here.y, vx: 0, vy: 0 });
        traffic.update(DT, { x: here.x, y: here.y, yaw: 0, speed: 0, hour: 15, vehicle: null });
        police.update(DT, here);
        damage += police.takeDamage();
        shots += police.shots.length;
        police.clearShots();
        if (police.takeArrest()) arrested = true;
        if (damage >= 100) killedAt = k / 60;
      }
      traffic.dispose();
      return { damage, killedAt, arrested, shots };
    };
    const armed = run4(4);
    expect(armed.shots).toBeGreaterThan(5);
    expect(armed.killedAt).toBeGreaterThan(0);
    expect(armed.arrested).toBe(false);
    // À trois étoiles : jamais un tir (la police arrête, D75).
    const calm = run4(3);
    expect(calm.shots).toBe(0);
    expect(calm.damage).toBe(0);
  }, 300000);

  it("un gendarme tué : `kill_cop` (quatre étoiles), son pistolet tombe là où il est mort", () => {
    const { traffic, police, wanted } = setup(0);
    const o = police.officers.spawn(3, 4, 0, 1, 9)!;
    police.officers.hurt(o.slot, 500, 0, 1, 1);
    police.update(DT, foot(0, 0));
    expect(wanted.stars).toBe(4);
    const drops: { x: number; y: number }[] = [];
    police.takeDrops(drops);
    expect(drops).toHaveLength(1);
    expect(Math.hypot(drops[0]!.x - o.x, drops[0]!.y - o.y)).toBeLessThan(1);
    police.takeDrops(drops);
    expect(drops).toHaveLength(1);
    // Le suivant, à plus de 3 s : cinq étoiles.
    for (let k = 0; k < 4 * 60; k++) police.update(DT, foot(0, 0));
    const o2 = police.officers.spawn(5, 4, 0, 1, 11)!;
    police.officers.hurt(o2.slot, 500, 0, 1, 1);
    police.update(DT, foot(0, 0));
    expect(wanted.stars).toBe(5);
    traffic.dispose();
  }, 120000);

  it("arrestation (J4-5) : à pied, immobile, une étoile : la voiture arrive, l'équipage descend, le joueur est arrêté ; la reprise est sur un trottoir de la zone", () => {
    const { traffic, police, wanted } = setup(10);
    const here = foot(-10, -40);
    wanted.set(1, here.x, here.y);
    let arrested = -1, deployed = 0;
    for (let k = 0; k < 60 * 150 && arrested < 0; k++) {
      traffic.step(DT, { kind: "foot", x: here.x, y: here.y, vx: 0, vy: 0 });
      traffic.update(DT, { x: here.x, y: here.y, yaw: 0, speed: 0, hour: 15, vehicle: null });
      police.update(DT, here);
      deployed = Math.max(deployed, police.officers.list.length);
      if (police.takeArrest()) arrested = k / 60;
    }
    expect(deployed).toBe(1);
    expect(arrested).toBeGreaterThan(0);
    // Après la peine : plus d'étoile, plus de gendarme dehors, les voitures repartent.
    police.reset();
    expect(wanted.stars).toBe(0);
    expect(police.officers.list).toHaveLength(0);
    const nav = new NavManager();
    for (const c of cells) nav.graph.add(c);
    const hit = nav.graph.nearest(ARREST_SPAWN.x, ARREST_SPAWN.y, 1);
    expect(hit).not.toBeNull();
    const t = world.terrain;
    expect(ARREST_SPAWN.x).toBeLessThan(t.xMax - 30);
    expect(ARREST_SPAWN.y).toBeGreaterThan(t.yMin + 30);
    expect(ARREST_SPAWN.y).toBeLessThan(t.yMax - 30);
    expect(colliders.resolve(ARREST_SPAWN.x, ARREST_SPAWN.y, 0.35).hit).toBe(false);
    traffic.dispose();
  }, 120000);
});
