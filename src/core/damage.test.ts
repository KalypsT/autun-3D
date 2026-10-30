import { afterEach, describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { DAMAGE, END_MODE, impactPoints, tierOf, VehicleDamage, zoneOf, type DamageEvent } from "./damage";
import { CAR, createVehicle, stepVehicle } from "./vehicle";
import { contactVehicles } from "./vehicle-contact";
import { CATALOG, damageProfile, vehicleDef } from "./vehicle-catalog";
import { flatTerrain } from "./testing";

const car = () => new VehicleDamage({ toughness: 1, burns: true });
const kmh = (v: number): number => v / 3.6;
const kinds = (events: DamageEvent[]): string[] => events.map((e) => (e.kind === "tier" ? `tier:${e.tier}` : e.kind));

afterEach(() => {
  END_MODE.current = "explosion";
});

describe("dégâts : barème des chocs", () => {
  it("rien sous 12 km/h ; un mur de face à 50 km/h retire environ un tiers de la santé ; à 90 km/h, la voiture prend feu", () => {
    expect(impactPoints(kmh(11), 1)).toBe(0);
    expect(impactPoints(kmh(50), 1)).toBeGreaterThan(25);
    expect(impactPoints(kmh(50), 1)).toBeLessThan(45);
    expect(DAMAGE.max - impactPoints(kmh(90), 1)).toBeLessThanOrEqual(DAMAGE.fire);
  });

  it("plus le choc est fort, plus il abîme, et un modèle plus solide encaisse mieux", () => {
    let last = 0;
    for (let v = 4; v < 30; v += 2) {
      expect(impactPoints(v, 1)).toBeGreaterThan(last);
      last = impactPoints(v, 1);
    }
    expect(impactPoints(15, 1.4)).toBeLessThan(impactPoints(15, 1));
  });

  it("la zone touchée suit l'angle du choc", () => {
    expect(zoneOf(0)).toBe("front");
    expect(zoneOf(Math.PI)).toBe("rear");
    expect(zoneOf(-Math.PI)).toBe("rear");
    expect(zoneOf(Math.PI / 2)).toBe("right");
    expect(zoneOf(-Math.PI / 2)).toBe("left");
    expect(zoneOf(0.7)).toBe("front");
    expect(zoneOf(2 * Math.PI + 0.1)).toBe("front");
  });

  it("un choc de face écrase surtout l'avant, un peu les flancs, pas l'arrière ; une réception de saut abîme moitié moins, devant et derrière", () => {
    const d = car();
    d.hit(kmh(40), 0);
    expect(d.zones.front).toBeGreaterThan(d.zones.left);
    expect(d.zones.left).toBeCloseTo(d.zones.right);
    expect(d.zones.left).toBeGreaterThan(0);
    expect(d.zones.rear).toBe(0);
    const j = car();
    const p = j.hit(kmh(40), NaN);
    expect(p).toBeCloseTo(impactPoints(kmh(40), 1) * DAMAGE.landing);
    expect(j.zones.front).toBeCloseTo(j.zones.rear);
    expect(j.zones.left).toBe(0);
  });
});

describe("dégâts : paliers, feu et fin", () => {
  it("santé → palier", () => {
    expect(tierOf(100)).toBe("ok");
    expect(tierOf(50)).toBe("smoke");
    expect(tierOf(20)).toBe("heavy");
    expect(tierOf(5)).toBe("fire");
  });

  it("fumée blanche, fumée noire, feu, puis explosion au bout de cinq secondes ; la puissance baisse à chaque palier", () => {
    const d = car();
    expect(d.power).toBe(1);
    d.damage(45);
    expect(kinds(d.takeEvents())).toEqual(["tier:smoke"]);
    expect(d.power).toBeLessThan(1);
    d.damage(30);
    expect(kinds(d.takeEvents())).toEqual(["tier:heavy"]);
    const heavy = d.power;
    expect(heavy).toBeLessThan(DAMAGE.powerLeft.smoke);
    d.damage(20);
    expect(kinds(d.takeEvents())).toEqual(["tier:fire"]);
    expect(d.burning).toBe(0);
    expect(d.usable).toBe(true);
    for (let t = 0; t < DAMAGE.burn - 0.1; t += 0.1) d.update(0.1);
    expect(d.end).toBeNull();
    d.update(0.2);
    expect(kinds(d.takeEvents())).toEqual(["explode"]);
    expect(d.end).toBe("explosion");
    expect(d.tier).toBe("wrecked");
    expect(d.power).toBe(0);
    expect(d.usable).toBe(false);
    // Une épave ne prend plus rien.
    d.damage(50);
    expect(d.takeEvents()).toEqual([]);
  });

  it("un vélo ne brûle pas : il est cassé tout de suite, sans feu", () => {
    const bike = new VehicleDamage(damageProfile(vehicleDef("velo-ville")!));
    bike.damage(95);
    expect(kinds(bike.takeEvents())).toEqual(["breakdown"]);
    expect(bike.end).toBe("breakdown");
    expect(bike.burning).toBe(-1);
  });

  it("en mode sans violence, l'aiguillage fait tomber la voiture en panne au lieu de la faire exploser", () => {
    END_MODE.current = "breakdown";
    const d = car();
    d.damage(95);
    expect(kinds(d.takeEvents())).toEqual(["breakdown"]);
    expect(d.end).toBe("breakdown");
  });

  it("réparer remet à neuf ; un état enregistré se reprend, et un véhicule enregistré en feu se remet à brûler", () => {
    const d = car();
    d.hit(kmh(70), Math.PI);
    d.repair();
    expect(d.health).toBe(DAMAGE.max);
    expect(d.zones.rear).toBe(0);
    expect(d.tier).toBe("ok");
    d.restore(50, { front: 0.4 }, null);
    expect(d.tier).toBe("smoke");
    expect(d.zones.front).toBe(0.4);
    expect(d.takeEvents()).toEqual([]);
    d.restore(5, {}, null);
    expect(d.burning).toBe(0);
    d.restore(0, {}, "explosion");
    expect(d.usable).toBe(false);
  });

  it("chaque modèle du catalogue a un profil : les voitures et les motos brûlent, pas les vélos ni la trottinette ; la gendarmerie est plus solide", () => {
    for (const def of CATALOG) {
      const p = damageProfile(def);
      expect(p.toughness).toBeGreaterThan(0.3);
      expect(p.burns).toBe(def.family === "car" || def.family === "moto");
    }
    expect(damageProfile(vehicleDef("gendarmerie")!).toughness).toBeGreaterThan(damageProfile(vehicleDef("citadine")!).toughness);
  });
});

describe("dégâts : le moteur physique dit où le choc a porté", () => {
  const flat = flatTerrain();

  it("une voiture qui fonce dans un mur : choc devant ; en marche arrière : choc derrière", () => {
    const wall = new Colliders();
    wall.addSegment(-20, 10, 20, 10);
    for (const [heading, vy, zone] of [[0, kmh(40), "front"], [Math.PI, kmh(40), "rear"]] as const) {
      const s = createVehicle(0, 5, heading, flat);
      s.vy = vy;
      let impact = 0, angle = 0;
      for (let i = 0; i < 60 && impact === 0; i++) {
        stepVehicle(s, CAR, { throttle: 0, brake: 0, steer: 0 }, 1 / 60, flat, wall);
        if (s.impact > 0) [impact, angle] = [s.impact, s.impactAngle];
      }
      expect(impact).toBeGreaterThan(kmh(30));
      expect(zoneOf(angle)).toBe(zone);
    }
  });

  it("deux voitures : celle qui est percutée sur le flanc gauche le sait, celle qui percute le sent devant", () => {
    const a = { state: createVehicle(0, 0, 0, flat), spec: CAR };
    const b = { state: createVehicle(-1.9, 0, Math.PI / 2, flat), spec: CAR };
    b.state.vx = kmh(30);
    contactVehicles(a, b);
    expect(a.state.impact).toBeGreaterThan(0);
    expect(zoneOf(a.state.impactAngle)).toBe("left");
    expect(zoneOf(b.state.impactAngle)).toBe("front");
  });
});
