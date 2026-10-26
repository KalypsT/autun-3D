import { describe, expect, it } from "vitest";
import { Terrain } from "../data/terrain";
import type { TerrainMeta } from "../data/types";
import { Colliders } from "./collision";
import { flatTerrain } from "./testing";
import { BIKE, createVehicle, SCOOTER, stepVehicle, steerLimit, type DriveInput, type VehicleSpec, type VehicleState } from "./vehicle";

const DT = 1 / 60;
const flat = flatTerrain();
const none = new Colliders();

function drive(s: VehicleState, input: DriveInput, seconds: number, terrain: Terrain = flat, colliders: Colliders = none, spec: VehicleSpec = BIKE): void {
  for (let i = 0; i < seconds * 60; i++) stepVehicle(s, spec, input, DT, terrain, colliders);
}

/** Temps (s) pour passer de la vitesse actuelle à l'arrêt, frein à fond. */
function brakingTime(s: VehicleState, spec: VehicleSpec): number {
  let t = 0;
  while (s.speed > 0.01 && t < 20) {
    stepVehicle(s, spec, { throttle: 0, brake: 1, steer: 0 }, DT, flat, none);
    t += DT;
  }
  return t;
}

/** Pente constante vers le nord (montée de `grade` par mètre). */
function slopeTerrain(grade: number): Terrain {
  const meta = { cols: 200, rows: 200, res: 1, x0: -100, y0: -100, y1: 100, base: 0, unit: 0.01, zmin: 0, zmax: 200 * grade } as TerrainMeta;
  const raw = new Float32Array(200 * 200);
  for (let r = 0; r < 200; r++) for (let c = 0; c < 200; c++) raw[r * 200 + c] = (199 - r) * grade;
  return new Terrain(meta, raw);
}

const kmh = (v: number): number => v * 3.6;

describe("vélo", () => {
  it("sur le plat, plafonne vers 27 km/h en ligne droite", () => {
    const b = createVehicle(0, -90, 0, flat);
    drive(b, { throttle: 1, brake: 0, steer: 0 }, 20);
    expect(kmh(b.speed)).toBeGreaterThan(24);
    expect(kmh(b.speed)).toBeLessThan(27.5);
    expect(Math.abs(b.x)).toBeLessThan(1e-6);
    expect(b.heading).toBeCloseTo(0, 6);
  });

  it("met quelques secondes à atteindre 20 km/h", () => {
    const b = createVehicle(0, -90, 0, flat);
    let t = 0;
    while (kmh(b.speed) < 20 && t < 30) {
      stepVehicle(b, BIKE, { throttle: 1, brake: 0, steer: 0 }, DT, flat, none);
      t += DT;
    }
    expect(t).toBeGreaterThan(3);
    expect(t).toBeLessThan(10);
  });

  it("freine sans repartir en arrière, puis recule doucement", () => {
    const b = createVehicle(0, -90, 0, flat);
    drive(b, { throttle: 1, brake: 0, steer: 0 }, 10);
    let t = 0;
    while (b.speed > 0.01 && t < 10) {
      stepVehicle(b, BIKE, { throttle: 0, brake: 1, steer: 0 }, DT, flat, none);
      t += DT;
    }
    // Environ 6,7 m/s² : un bon freinage de vélo.
    expect(t).toBeLessThan(1.6);
    expect(b.speed).toBeGreaterThan(-0.3);
    drive(b, { throttle: 0, brake: 1, steer: 0 }, 5);
    expect(b.speed).toBeLessThan(-0.5);
    expect(b.speed).toBeGreaterThan(-BIKE.reverseSpeed - 0.05);
  });

  it("roue libre : ralentit lentement sur le plat", () => {
    const b = createVehicle(0, -90, 0, flat);
    drive(b, { throttle: 1, brake: 0, steer: 0 }, 15);
    const v0 = b.speed;
    drive(b, { throttle: 0, brake: 0, steer: 0 }, 3);
    expect(b.speed).toBeLessThan(v0);
    expect(b.speed).toBeGreaterThan(v0 * 0.8);
  });

  it("tourne à droite quand on braque à droite, et penche dans le virage", () => {
    const b = createVehicle(0, 0, 0, flat);
    drive(b, { throttle: 0.6, brake: 0, steer: 0 }, 3);
    drive(b, { throttle: 0.6, brake: 0, steer: 1 }, 1);
    expect(b.heading).toBeGreaterThan(0.3);
    expect(b.x).toBeGreaterThan(0);
    expect(b.lean).toBeGreaterThan(0.1);
  });

  it("le braquage se réduit avec la vitesse", () => {
    expect(steerLimit(BIKE, 0)).toBeCloseTo(BIKE.maxSteer);
    expect(steerLimit(BIKE, 7)).toBeLessThan(BIKE.maxSteer / 3);
  });

  it("en virage serré à pleine vitesse, la trajectoire reste stable", () => {
    const b = createVehicle(0, 0, 0, flat);
    drive(b, { throttle: 1, brake: 0, steer: 0 }, 6);
    drive(b, { throttle: 1, brake: 0, steer: -1 }, 8);
    expect(Number.isFinite(b.x)).toBe(true);
    expect(Math.abs(b.yawRate)).toBeLessThan(3);
    // Accélération latérale sous l'adhérence (0,85 g).
    expect(Math.abs(b.speed * b.yawRate)).toBeLessThan(0.9 * 9.81);
  });

  it("monte une côte de 8 % au pas, la descend en prenant de la vitesse", () => {
    const up = slopeTerrain(0.08);
    const b = createVehicle(0, -80, 0, up);
    drive(b, { throttle: 1, brake: 0, steer: 0 }, 15, up);
    expect(kmh(b.speed)).toBeGreaterThan(7);
    expect(kmh(b.speed)).toBeLessThan(14);
    expect(b.pitch).toBeCloseTo(Math.atan(0.08), 2);
    const down = createVehicle(0, 80, Math.PI, up);
    drive(down, { throttle: 0, brake: 0, steer: 0 }, 12, up);
    expect(kmh(down.speed)).toBeGreaterThan(25);
  });

  it("à l'arrêt sur une pente douce, sans pédaler ni freiner, reste immobile grâce au roulement", () => {
    const gentle = slopeTerrain(0.004);
    const b = createVehicle(0, 0, 0, gentle);
    drive(b, { throttle: 0, brake: 0, steer: 0 }, 3, gentle);
    expect(Math.abs(b.speed)).toBeLessThan(0.01);
  });

  it("un mur de face arrête le vélo sans le traverser, avec un petit rebond", () => {
    const c = new Colliders();
    c.addSegment(-20, 10, 20, 10);
    const b = createVehicle(0, -30, 0, flat);
    drive(b, { throttle: 1, brake: 0, steer: 0 }, 12, flat, c);
    expect(b.y + BIKE.hull[0]![0] + BIKE.hull[0]![1]).toBeLessThanOrEqual(10.01);
    expect(b.impact).toBeGreaterThan(3);
  });

  it("un choc de biais fait pivoter le vélo le long du mur", () => {
    const c = new Colliders();
    c.addSegment(-20, 10, 40, 10);
    const b = createVehicle(0, 0, 0.6, flat);
    b.vx = Math.sin(0.6) * 6;
    b.vy = Math.cos(0.6) * 6;
    drive(b, { throttle: 0, brake: 0, steer: 0 }, 4, flat, c);
    expect(b.y).toBeLessThan(10);
    expect(b.heading).not.toBeCloseTo(0.6, 1);
  });
});

describe("trottinette électrique", () => {
  const full = { throttle: 1, brake: 0, steer: 0 };

  it("bridée à 25 km/h sur le plat", () => {
    const t = createVehicle(0, -90, 0, flat);
    drive(t, full, 20, flat, none, SCOOTER);
    expect(kmh(t.speed)).toBeGreaterThan(23);
    expect(kmh(t.speed)).toBeLessThanOrEqual(25.01);
  });

  it("le moteur monte une côte de 8 % plus vite qu'un cycliste", () => {
    const up = slopeTerrain(0.08);
    const t = createVehicle(0, -80, 0, up), b = createVehicle(0, -80, 0, up);
    drive(t, full, 12, up, none, SCOOTER);
    drive(b, full, 12, up);
    expect(kmh(t.speed)).toBeGreaterThan(17);
    expect(t.speed).toBeGreaterThan(b.speed);
  });

  it("freine moins fort qu'un vélo", () => {
    const t = createVehicle(0, -90, 0, flat), b = createVehicle(0, -90, 0, flat);
    t.vy = b.vy = 6;
    t.speed = b.speed = 6;
    expect(brakingTime(t, SCOOTER)).toBeGreaterThan(brakingTime(b, BIKE));
  });

  it("perd plus vite sa vitesse en roue libre (petites roues)", () => {
    const t = createVehicle(0, -90, 0, flat), b = createVehicle(0, -90, 0, flat);
    t.vy = b.vy = 6;
    drive(t, { throttle: 0, brake: 0, steer: 0 }, 4, flat, none, SCOOTER);
    drive(b, { throttle: 0, brake: 0, steer: 0 }, 4);
    expect(t.speed).toBeLessThan(b.speed);
  });
});
