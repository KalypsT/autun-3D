import { describe, expect, it } from "vitest";
import { Terrain } from "../data/terrain";
import type { TerrainMeta } from "../data/types";
import { Colliders } from "./collision";
import { flatTerrain } from "./testing";
import { BIKE, CAR, collisionSteps, createVehicle, MOTO, SCOOTER, stepVehicle, steerLimit, type DriveInput, type VehicleSpec, type VehicleState } from "./vehicle";

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

describe("voiture", () => {
  const full = { throttle: 1, brake: 0, steer: 0 };
  const big = flatTerrain();

  /** Terrain plat de 2 × 2 km pour les essais à haute vitesse. */
  function wide(): Terrain {
    const meta = { cols: 400, rows: 400, res: 5, x0: -1000, y0: -1000, y1: 1000, base: 0, unit: 0.01, zmin: 0, zmax: 0 } as TerrainMeta;
    return new Terrain(meta, new Float32Array(400 * 400));
  }

  it("0 à 100 km/h en 10 à 14 s", () => {
    const t = wide();
    const c = createVehicle(0, -900, 0, t);
    let time = 0;
    while (kmh(c.speed) < 100 && time < 30) {
      stepVehicle(c, CAR, full, DT, t, none);
      time += DT;
    }
    expect(time).toBeGreaterThan(10);
    expect(time).toBeLessThan(14);
  });

  it("frein maintenu à 50 km/h : l'ABS empêche le blocage, arrêt en 10 à 15 m", () => {
    const c = createVehicle(0, -90, 0, big);
    c.vy = c.speed = 50 / 3.6;
    const y0 = c.y;
    let locked = false;
    while (c.speed > 0.01) {
      stepVehicle(c, CAR, { throttle: 0, brake: 1, steer: 0 }, DT, big, none);
      locked ||= c.lockedFront || c.lockedRear;
    }
    expect(locked).toBe(false);
    expect(c.y - y0).toBeGreaterThan(10);
    expect(c.y - y0).toBeLessThan(15);
  });

  it("un appui bref sur le frein ralentit sans bloquer les roues", () => {
    const c = createVehicle(0, -90, 0, big);
    c.vy = c.speed = 50 / 3.6;
    let locked = false;
    for (let i = 0; i < 15; i++) {
      stepVehicle(c, CAR, { throttle: 0, brake: 1, steer: 0 }, DT, big, none);
      locked ||= c.lockedFront || c.lockedRear;
    }
    expect(locked).toBe(false);
    expect(c.speed).toBeLessThan(50 / 3.6);
  });

  it("freiner en tournant : grâce à l'ABS, la voiture tourne encore, et plus serré qu'à vitesse constante", () => {
    const t = wide();
    const free = createVehicle(0, 0, 0, t), braked = createVehicle(0, 0, 0, t);
    free.vy = braked.vy = 70 / 3.6;
    drive(free, { throttle: 0.3, brake: 0, steer: 1 }, 2, t, none, CAR);
    drive(braked, { throttle: 0, brake: 1, steer: 1 }, 2, t, none, CAR);
    expect(braked.lockedFront).toBe(false);
    expect(braked.heading).toBeGreaterThan(0.5);
    // En ralentissant, le rayon se resserre : on tourne davantage par mètre parcouru.
    expect(braked.heading / Math.hypot(braked.x, braked.y)).toBeGreaterThan(free.heading / Math.hypot(free.x, free.y));
  });

  it("frein à main à 50 km/h en braquant : l'arrière bloque, la voiture pivote, puis se rattrape", () => {
    const t = wide();
    const c = createVehicle(0, 0, 0, t);
    c.vy = 50 / 3.6;
    for (let i = 0; i < 40; i++) stepVehicle(c, CAR, { throttle: 0, brake: 0, steer: 1, handbrake: 1 }, DT, t, none);
    expect(c.lockedRear).toBe(true);
    expect(c.heading).toBeGreaterThan(0.6);
    drive(c, { throttle: 0.4, brake: 0, steer: 0 }, 2.5, t, none, CAR);
    expect(Math.abs(c.yawRate)).toBeLessThan(0.15);
  });

  it("le frein moteur ralentit plus qu'une roue libre de vélo", () => {
    const c = createVehicle(0, -90, 0, big);
    c.vy = 14;
    drive(c, { throttle: 0, brake: 0, steer: 0 }, 2, big, none, CAR);
    expect(c.speed).toBeLessThan(13.5);
    expect(c.speed).toBeGreaterThan(11);
  });

  it("braquage à fond à 50 km/h : l'arrière glisse peu à peu, et la voiture se remet droite quand on relâche", () => {
    const t = wide();
    const c = createVehicle(0, 0, 0, t);
    c.vy = 50 / 3.6;
    const beta = (): number => Math.atan2(c.vx * Math.cos(c.heading) - c.vy * Math.sin(c.heading), Math.abs(c.speed));
    drive(c, { throttle: 0.3, brake: 0, steer: 1 }, 2.5, t, none, CAR);
    expect(c.heading).toBeGreaterThan(1);
    // Dérapage : l'arrière sort (dérive vers l'intérieur du virage), sans tête-à-queue.
    expect(beta()).toBeLessThan(-0.05);
    expect(beta()).toBeGreaterThan(-0.4);
    expect(Math.abs(c.speed * c.yawRate)).toBeLessThan(1.1 * 9.81);
    // La caisse penche vers l'extérieur (gauche) d'un virage à droite.
    expect(c.lean).toBeLessThan(0);
    drive(c, { throttle: 0.3, brake: 0, steer: 0 }, 1.5, t, none, CAR);
    expect(Math.abs(beta())).toBeLessThan(0.05);
    expect(Math.abs(c.yawRate)).toBeLessThan(0.1);
  });

  it("à fond au démarrage, la motricité est bornée par l'adhérence des roues avant", () => {
    const c = createVehicle(0, -90, 0, big);
    stepVehicle(c, CAR, full, DT, big, none);
    const accel = c.speed / DT;
    // Traction avant : au mieux la part de poids sur l'avant, qui s'allège en accélérant.
    expect(accel).toBeLessThanOrEqual((CAR.grip * 9.81 * CAR.rear) / (CAR.front + CAR.rear) + 0.01);
  });

  it("contre un mur à 30 km/h : arrêt net sans traverser", () => {
    const c0 = new Colliders();
    c0.addSegment(-20, 10, 20, 10);
    const c = createVehicle(0, -10, 0, big);
    c.vy = 30 / 3.6;
    drive(c, { throttle: 0, brake: 0, steer: 0 }, 3, big, c0, CAR);
    expect(c.y + 1.25 + 0.82).toBeLessThanOrEqual(10.01);
    expect(Math.abs(c.speed)).toBeLessThan(2.5);
  });

  it("les obstacles supplémentaires (escaliers) arrêtent la voiture", () => {
    const stairs = new Colliders();
    stairs.addSegment(-20, 10, 20, 10);
    const c = createVehicle(0, -10, 0, big);
    c.vy = 8;
    for (let i = 0; i < 180; i++) stepVehicle(c, CAR, { throttle: 0, brake: 0, steer: 0 }, DT, big, none, stairs);
    expect(c.y).toBeLessThan(10);
  });
});

describe("moto", () => {
  const full = { throttle: 1, brake: 0, steer: 0 };

  it("0 à 100 km/h en 4,5 à 7 s, plus vite que la voiture", () => {
    const meta = { cols: 400, rows: 400, res: 5, x0: -1000, y0: -1000, y1: 1000, base: 0, unit: 0.01, zmin: 0, zmax: 0 } as TerrainMeta;
    const t = new Terrain(meta, new Float32Array(400 * 400));
    const m = createVehicle(0, -900, 0, t);
    let time = 0;
    while (kmh(m.speed) < 100 && time < 30) {
      stepVehicle(m, MOTO, full, DT, t, none);
      time += DT;
    }
    expect(time).toBeGreaterThan(4.5);
    expect(time).toBeLessThan(7);
  });

  it("penche franchement dans un virage rapide, sans dépasser l'adhérence", () => {
    const m = createVehicle(0, -50, 0, flat);
    m.vy = m.speed = 14;
    drive(m, { throttle: 0.4, brake: 0, steer: 1 }, 2, flat, none, MOTO);
    expect(m.lean).toBeGreaterThan(0.3);
    expect(Math.abs(m.speed * m.yawRate)).toBeLessThan(1.02 * 9.81);
  });

  it("en virage serré à 60 km/h, ne glisse pas de l'arrière", () => {
    const meta = { cols: 400, rows: 400, res: 5, x0: -1000, y0: -1000, y1: 1000, base: 0, unit: 0.01, zmin: 0, zmax: 0 } as TerrainMeta;
    const t = new Terrain(meta, new Float32Array(400 * 400));
    const m = createVehicle(0, 0, 0, t);
    m.vy = 60 / 3.6;
    drive(m, { throttle: 0.4, brake: 0, steer: 1 }, 2, t, none, MOTO);
    const beta = Math.atan2(m.vx * Math.cos(m.heading) - m.vy * Math.sin(m.heading), m.speed);
    // Dérive normale d'un pneu qui tourne (quelques degrés), pas de glissade.
    expect(Math.abs(beta)).toBeLessThan(0.08);
  });

  it("freiner en tournant ne la fait pas pivoter (ABS)", () => {
    const m = createVehicle(0, -50, 0, flat);
    m.vy = 50 / 3.6;
    let maxYaw = 0;
    for (let i = 0; i < 60; i++) {
      stepVehicle(m, MOTO, { throttle: 0, brake: 1, steer: 1 }, DT, flat, none);
      maxYaw = Math.max(maxYaw, Math.abs(m.yawRate));
      expect(m.lockedRear).toBe(false);
    }
    expect(maxYaw).toBeLessThan(1.5);
  });

  it("freine de 50 km/h à l'arrêt en moins de 16 m, sans jamais bloquer l'avant", () => {
    const m = createVehicle(0, -90, 0, flat);
    m.vy = m.speed = 50 / 3.6;
    const y0 = m.y;
    let front = false;
    while (m.speed > 0.01) {
      stepVehicle(m, MOTO, { throttle: 0, brake: 1, steer: 0 }, DT, flat, none);
      front ||= m.lockedFront;
    }
    expect(front).toBe(false);
    expect(m.y - y0).toBeLessThan(16);
  });
});

describe("vitesse élevée et obstacles fins (D50)", () => {
  /** Part des essais où le véhicule, lancé à `kmh` contre un mur sans épaisseur (comme une clôture) sous l'angle donné, le traverse. */
  function crossings(spec: VehicleSpec, kmh: number, angle: number): number {
    const fast = { ...spec, topSpeed: 400 / 3.6, driveFadeFrom: 399 / 3.6 };
    const trials = 40;
    let crossed = 0;
    for (let k = 0; k < trials; k++) {
      const wall = new Colliders();
      wall.addSegment(-40, 0, 40, 0);
      // Le déphasage fait varier où tombe le mur par rapport aux pas du véhicule.
      const s = createVehicle(-60 * Math.sin(angle), -60 * Math.cos(angle) - (k / trials) * 2, angle, flat);
      s.vx = Math.sin(angle) * (kmh / 3.6);
      s.vy = Math.cos(angle) * (kmh / 3.6);
      for (let i = 0; i < 150; i++) stepVehicle(s, fast, { throttle: 0, brake: 0, steer: 0 }, DT, flat, wall);
      if (s.y > 1) crossed++;
    }
    return crossed / trials;
  }

  it("une moto lancée à 250 km/h, et même à 500, ne traverse pas un mur fin, de face ni de biais", () => {
    for (const kmh of [250, 500]) for (const angle of [0, 0.3, -0.6]) expect(crossings(MOTO, kmh, angle)).toBe(0);
  });

  it("une voiture à 240 km/h non plus", () => {
    for (const angle of [0, 0.4]) expect(crossings(CAR, 240, angle)).toBe(0);
  });

  it("assez de sous-pas pour avancer de moins que le plus petit rayon de la coque, sans excès à basse vitesse", () => {
    expect(collisionSteps(BIKE, 7, DT)).toBe(2);
    expect(collisionSteps(CAR, 48, DT)).toBe(2);
    expect(collisionSteps(MOTO, 250 / 3.6, DT)).toBeGreaterThanOrEqual(4);
    expect(250 / 3.6 * DT / collisionSteps(MOTO, 250 / 3.6, DT)).toBeLessThan(0.32);
    expect(collisionSteps(MOTO, 1e6, DT)).toBe(12);
  });
});
