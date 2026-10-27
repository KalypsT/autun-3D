import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { flatTerrain } from "./testing";
import { createVehicle, GRAVITY, stepVehicle, type VehicleSpec, type VehicleState } from "./vehicle";
import { CATALOG, vehicleDef } from "./vehicle-catalog";
import { SPEED_CAP, limited } from "./vehicle-specs";

const DT = 1 / 60;
const flat = flatTerrain();
const none = new Colliders();
const kmh = (s: VehicleState): number => s.speed * 3.6;
const cars = CATALOG.filter((d) => d.family === "car");

/** Accélérateur à fond sur le plat (on remet le véhicule au début quand il approche du bord du terrain d'essai) : temps pour 100 km/h et vitesse atteinte au bout de 100 s. */
function fullThrottle(spec: VehicleSpec): { t100: number; top: number; state: VehicleState } {
  const s = createVehicle(0, -90, 0, flat);
  let t100 = 0;
  for (let i = 0; i < 100 * 60; i++) {
    stepVehicle(s, spec, { throttle: 1, brake: 0, steer: 0 }, DT, flat, none);
    if (!t100 && kmh(s) >= 100) t100 = (i + 1) * DT;
    if (s.y > 80) s.y = -90;
  }
  return { t100, top: kmh(s), state: s };
}

/** Freinage à fond depuis `from` km/h : distance (m) et roues bloquées ou non. */
function braking(spec: VehicleSpec, from: number): { distance: number; locked: boolean; state: VehicleState } {
  const s = createVehicle(0, -90, 0, flat);
  s.vy = s.speed = from / 3.6;
  let distance = 0, locked = false;
  for (let i = 0; i < 20 * 60 && s.speed > 0.05; i++) {
    stepVehicle(s, spec, { throttle: 0, brake: 1, steer: 0 }, DT, flat, none);
    distance += s.speed * DT;
    locked ||= s.lockedFront || s.lockedRear;
    if (s.y > 80) s.y = -90;
  }
  return { distance, locked, state: s };
}

describe("voitures du catalogue : performances", () => {
  /** [0 à 100 km/h (s) mini, maxi] : d'après ce que fait une voiture de cette classe. */
  const T100: Record<string, [number, number]> = {
    citadine: [10, 13], compacte: [8.5, 11.5], berline: [8, 11], break: [8.5, 11], "petit-suv": [9.5, 12.5], camionnette: [14, 19], "vieille-voiture": [11, 15], sportive: [4, 6],
  };

  it.each(cars.map((d) => d.id))("%s : 0 à 100 km/h dans la fourchette de sa classe, vitesse maximale sous sa fiche et sous le plafond", (id) => {
    const spec = vehicleDef(id)!.spec;
    const r = fullThrottle(spec);
    const [lo, hi] = T100[id]!;
    expect(r.t100).toBeGreaterThan(lo);
    expect(r.t100).toBeLessThan(hi);
    expect(r.top).toBeGreaterThan(0.9 * spec.topSpeed * 3.6);
    expect(r.top).toBeLessThanOrEqual(spec.topSpeed * 3.6 + 0.5);
    expect(r.top).toBeLessThanOrEqual(SPEED_CAP.car * 3.6 + 0.5);
  });

  it("la sportive est bridée à 200 km/h : elle s'en approche sans la dépasser, et reste la plus rapide à accélérer", () => {
    const sport = vehicleDef("sportive")!.spec;
    expect(sport.topSpeed * 3.6).toBeCloseTo(200, 5);
    const r = fullThrottle(sport);
    expect(r.top).toBeGreaterThan(193);
    for (const d of cars) if (d.id !== "sportive") expect(fullThrottle(d.spec).t100).toBeGreaterThan(r.t100 + 3);
  });

  it("le plafond ne touche que ce qui le dépasse", () => {
    const slow = vehicleDef("camionnette")!.spec;
    expect(limited(slow, SPEED_CAP.car)).toBe(slow);
    const fast = { ...slow, topSpeed: 250 / 3.6, driveFadeFrom: 240 / 3.6 };
    const cut = limited(fast, SPEED_CAP.car);
    expect(cut.topSpeed).toBe(SPEED_CAP.car);
    expect(cut.driveFadeFrom).toBeLessThan(cut.topSpeed);
    expect(cut.power).toBe(fast.power);
  });

  it("freinage à 100 km/h : 35 à 60 m avec ABS, sans jamais bloquer ; la camionnette plus longue que la sportive", () => {
    for (const d of cars) {
      if (d.id === "vieille-voiture") continue;
      const r = braking(d.spec, 100);
      expect([d.id, r.locked]).toEqual([d.id, false]);
      expect(r.distance).toBeGreaterThan(35);
      expect(r.distance).toBeLessThan(60);
    }
    expect(braking(vehicleDef("camionnette")!.spec, 100).distance).toBeGreaterThan(braking(vehicleDef("sportive")!.spec, 100).distance + 8);
  });

  it("la vieille voiture n'a pas d'ABS : roues avant bloquées au freinage à fond, arrêt bien plus long que la citadine", () => {
    const old = vehicleDef("vieille-voiture")!.spec;
    expect(old.abs).toBe(false);
    const r = braking(old, 100);
    expect(r.locked).toBe(true);
    expect(r.distance).toBeGreaterThan(braking(vehicleDef("citadine")!.spec, 100).distance + 10);
  });
});

describe("voitures du catalogue : tenue de route à la vitesse maximale", () => {
  it.each(cars.map((d) => d.id))("%s : plein braquage puis relâché à la vitesse maximale, sans tête-à-queue, accélération latérale bornée", (id) => {
    const spec = vehicleDef(id)!.spec;
    const s = fullThrottle(spec).state;
    s.x = 0; s.y = -90; s.heading = 0;
    s.vx = 0; s.vy = s.speed;
    let maxLat = 0;
    const lateral = (): void => { maxLat = Math.max(maxLat, Math.abs(s.speed * s.yawRate) / GRAVITY); };
    // Plein braquage 1 s, à fond sur l'accélérateur.
    for (let i = 0; i < 60; i++) { stepVehicle(s, spec, { throttle: 1, brake: 0, steer: 1 }, DT, flat, none); lateral(); }
    const turned = Math.abs(s.heading);
    // Relâché : la voiture se remet droite (le cap ne varie plus).
    for (let i = 0; i < 4 * 60; i++) { stepVehicle(s, spec, { throttle: 1, brake: 0, steer: 0 }, DT, flat, none); lateral(); }
    expect(Number.isFinite(s.x + s.y + s.heading)).toBe(true);
    expect(Math.abs(s.yawRate)).toBeLessThan(0.03);
    expect(Math.abs(s.vx * Math.cos(s.heading) - s.vy * Math.sin(s.heading))).toBeLessThan(1.5);
    // Pas plus que l'adhérence permise (avec la marge de braquage de la fiche) et un cap qui a peu changé (< 40°).
    expect(maxLat).toBeLessThan(spec.steerGrip * spec.grip * 1.2);
    expect(turned).toBeLessThan(0.7);
  });

  it("la direction à haute vitesse reste utilisable : le braquage permis à la vitesse maximale n'est jamais nul", () => {
    for (const d of cars) {
      const s = d.spec;
      const L = s.front + s.rear;
      const limit = (s.steerGrip * s.grip * GRAVITY * L) / (s.topSpeed * s.topSpeed);
      expect(limit).toBeGreaterThan(0.004);
    }
  });
});
