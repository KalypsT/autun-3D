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
function fullThrottle(spec: VehicleSpec): { t100: number; t80: number; t20: number; top: number; state: VehicleState } {
  const s = createVehicle(0, -90, 0, flat);
  let t100 = 0, t80 = 0, t20 = 0;
  for (let i = 0; i < 100 * 60; i++) {
    stepVehicle(s, spec, { throttle: 1, brake: 0, steer: 0 }, DT, flat, none);
    if (!t100 && kmh(s) >= 100) t100 = (i + 1) * DT;
    if (!t80 && kmh(s) >= 80) t80 = (i + 1) * DT;
    if (!t20 && kmh(s) >= 20) t20 = (i + 1) * DT;
    if (s.y > 80) s.y = -90;
  }
  return { t100, t80, t20, top: kmh(s), state: s };
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
    citadine: [10, 13], compacte: [8.5, 11.5], berline: [8, 11], break: [8.5, 11], "petit-suv": [9.5, 12.5], camionnette: [14, 19], "vieille-voiture": [11, 15], sportive: [4, 6], gendarmerie: [7.9, 10],
    "jeep-militaire": [12, 18], "pizza-du-vallon": [16, 26], "rotisserie-champ-de-mars": [16, 26],
  };
  /** Poids lourd bridé à 90 km/h (D116) : 0 à 80 km/h (s), d'après un porteur chargé. */
  const T80: Record<string, [number, number]> = { "grumier-morvan": [20, 40] };
  /** Petit train (D118, 25 km/h au plus, sans passagers) : 0 à 20 km/h (s). */
  const T20: Record<string, [number, number]> = { "petit-train": [4, 12] };

  it.each(cars.map((d) => d.id))("%s : 0 à 100 km/h dans la fourchette de sa classe, vitesse maximale sous sa fiche et sous le plafond", (id) => {
    const spec = vehicleDef(id)!.spec;
    const r = fullThrottle(spec);
    const [lo, hi] = T100[id] ?? T80[id] ?? T20[id]!;
    const t = T100[id] ? r.t100 : T80[id] ? r.t80 : r.t20;
    expect(t).toBeGreaterThan(lo);
    expect(t).toBeLessThan(hi);
    expect(r.top).toBeGreaterThan(0.9 * spec.topSpeed * 3.6);
    expect(r.top).toBeLessThanOrEqual(spec.topSpeed * 3.6 + 0.5);
    expect(r.top).toBeLessThanOrEqual(SPEED_CAP.car * 3.6 + 0.5);
  });

  it("la sportive est bridée à 200 km/h : elle s'en approche sans la dépasser, et reste la plus rapide à accélérer", () => {
    const sport = vehicleDef("sportive")!.spec;
    expect(sport.topSpeed * 3.6).toBeCloseTo(200, 5);
    const r = fullThrottle(sport);
    expect(r.top).toBeGreaterThan(193);
    // Un véhicule qui n'atteint pas 100 km/h (grumier bridé à 90) est, à plus forte raison, moins rapide.
    for (const d of cars) if (d.id !== "sportive") expect(fullThrottle(d.spec).t100 || Infinity).toBeGreaterThan(r.t100 + 3);
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
      // Le petit train (25 km/h au plus) : freiné depuis sa vitesse maximale, à part.
      if (d.id === "vieille-voiture" || d.train) continue;
      const r = braking(d.spec, 100);
      expect([d.id, r.locked]).toEqual([d.id, false]);
      expect(r.distance).toBeGreaterThan(35);
      expect(r.distance).toBeLessThan(60);
    }
    expect(braking(vehicleDef("camionnette")!.spec, 100).distance).toBeGreaterThan(braking(vehicleDef("sportive")!.spec, 100).distance + 8);
  });

  it("le petit train (D118) : 25 km/h au plus ; monte une pente de 10 % à plus de 10 km/h ; arrêté en moins de 8 m depuis sa vitesse maximale, sans bloquer", () => {
    const loco = vehicleDef("petit-train")!.spec;
    expect(fullThrottle(loco).top).toBeLessThanOrEqual(25.5);
    // La montée vers la cathédrale : une pente de 10 % vers le nord.
    const slope = { heightAt: (_x: number, y: number) => 0.1 * y, xMin: -1000, xMax: 1000, yMin: -1000, yMax: 1000 };
    const s = createVehicle(0, -90, 0, slope);
    for (let i = 0; i < 40 * 60; i++) stepVehicle(s, loco, { throttle: 1, brake: 0, steer: 0 }, DT, slope, none);
    expect(kmh(s)).toBeGreaterThan(10);
    const r = braking(loco, 25);
    expect(r.locked).toBe(false);
    expect(r.distance).toBeLessThan(8);
  });

  it("la vieille voiture n'a pas d'ABS : roues avant bloquées au freinage à fond, arrêt bien plus long que la citadine", () => {
    const old = vehicleDef("vieille-voiture")!.spec;
    expect(old.abs).toBe(false);
    const r = braking(old, 100);
    expect(r.locked).toBe(true);
    expect(r.distance).toBeGreaterThan(braking(vehicleDef("citadine")!.spec, 100).distance + 10);
  });
});

describe("deux-roues du catalogue : performances", () => {
  /** Temps (s) pour atteindre `kmhTarget`, accélérateur à fond. */
  const timeTo = (spec: VehicleSpec, target: number): number => {
    const s = createVehicle(0, -90, 0, flat);
    for (let i = 0; i < 60 * 60; i++) {
      stepVehicle(s, spec, { throttle: 1, brake: 0, steer: 0 }, DT, flat, none);
      if (kmh(s) >= target) return (i + 1) * DT;
      if (s.y > 80) s.y = -90;
    }
    return Infinity;
  };
  const spec = (id: string): VehicleSpec => vehicleDef(id)!.spec;

  it("le VTT, aux gros pneus crantés, va un peu moins vite que le vélo de ville et freine mieux", () => {
    const mtb = fullThrottle(spec("vtt")), city = fullThrottle(spec("velo-ville"));
    expect(mtb.top).toBeGreaterThan(20);
    expect(mtb.top).toBeLessThan(city.top + 0.1);
    expect(mtb.top).toBeLessThanOrEqual(spec("vtt").topSpeed * 3.6 + 0.5);
    expect(braking(spec("vtt"), 25).distance).toBeLessThan(9);
  });

  it("le scooter 125 : 0 à 50 km/h en 3,5 à 5,5 s, 88 à 101 km/h au maximum, freinage de 50 km/h en moins de 22 m, sans bloquer", () => {
    expect(timeTo(spec("scooter-125"), 50)).toBeGreaterThan(3.5);
    expect(timeTo(spec("scooter-125"), 50)).toBeLessThan(5.5);
    const top = fullThrottle(spec("scooter-125")).top;
    expect(top).toBeGreaterThan(88);
    expect(top).toBeLessThan(101);
    const b = braking(spec("scooter-125"), 50);
    expect(b.distance).toBeLessThan(22);
    expect(b.locked).toBe(false);
  });

  it("la moto sportive : 0 à 100 km/h en 2,8 à 4,2 s, plus vite que la routière ; bridée à 210 km/h ; freine de 100 km/h en 35 à 50 m sans bloquer", () => {
    const sport = spec("moto-sportive");
    expect(sport.topSpeed * 3.6).toBeCloseTo(210, 5);
    expect(timeTo(sport, 100)).toBeGreaterThan(2.8);
    expect(timeTo(sport, 100)).toBeLessThan(4.2);
    expect(timeTo(sport, 100)).toBeLessThan(timeTo(spec("moto-routiere"), 100));
    const top = fullThrottle(sport).top;
    expect(top).toBeGreaterThan(195);
    expect(top).toBeLessThanOrEqual(210.5);
    const b = braking(sport, 100);
    expect(b.distance).toBeGreaterThan(35);
    expect(b.distance).toBeLessThan(50);
    expect(b.locked).toBe(false);
  });
});

describe("véhicules du catalogue : tenue de route à la vitesse maximale", () => {
  it.each(CATALOG.map((d) => d.id))("%s : plein braquage puis relâché à la vitesse maximale, sans tête-à-queue ni glisse, accélération latérale bornée", (id) => {
    const spec = vehicleDef(id)!.spec;
    const s = fullThrottle(spec).state;
    s.x = 0; s.y = -90; s.heading = 0;
    s.vx = 0; s.vy = s.speed;
    let maxLat = 0, maxBeta = 0;
    // Accélération latérale de la trajectoire (rotation de la vitesse, pas de la caisse, qui tourne un peu plus vite à l'entrée du virage) et dérive.
    const step = (steer: number): void => {
      const before = Math.atan2(s.vx, s.vy);
      stepVehicle(s, spec, { throttle: 1, brake: 0, steer }, DT, flat, none);
      // Terrain d'essai de 200 m : on ramène la voiture vers le centre sans toucher à sa vitesse.
      if (Math.abs(s.x) > 80) s.x -= Math.sign(s.x) * 160;
      if (Math.abs(s.y) > 80) s.y -= Math.sign(s.y) * 160;
      const dir = Math.atan2(s.vx, s.vy);
      maxLat = Math.max(maxLat, (Math.abs(Math.atan2(Math.sin(dir - before), Math.cos(dir - before))) / DT) * Math.hypot(s.vx, s.vy) / GRAVITY);
      maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(Math.sin(dir - s.heading), Math.cos(dir - s.heading))));
    };
    // Plein braquage 1 s, à fond sur l'accélérateur.
    for (let i = 0; i < 60; i++) step(1);
    const turned = Math.abs(s.heading);
    // Relâché : la voiture se remet droite (le cap ne varie plus).
    for (let i = 0; i < 4 * 60; i++) step(0);
    expect(Number.isFinite(s.x + s.y + s.heading)).toBe(true);
    // Un deux-roues à 210 km/h tourne encore de 0,03 rad/s (rayon de 1,7 km) quatre secondes après : il est droit pour le joueur.
    expect(Math.abs(s.yawRate)).toBeLessThan(0.05);
    expect(Math.abs(s.vx * Math.cos(s.heading) - s.vy * Math.sin(s.heading))).toBeLessThan(1.5);
    // Pas plus que l'adhérence permise (avec la marge de braquage de la fiche) et un cap qui a peu changé (< 40°).
    expect(maxLat).toBeLessThan(spec.steerGrip * spec.grip * 1.2);
    // Voiture : le volant à fond à pleine vitesse ne fait pas décrocher l'arrière (D97).
    expect(maxBeta).toBeLessThan(0.2);
    // À haute vitesse seulement : un vélo à fond braque, lui, beaucoup en une seconde.
    if (spec.topSpeed > 30) expect(turned).toBeLessThan(0.7);
  });

  it("la direction à haute vitesse reste utilisable : le braquage permis à la vitesse maximale n'est jamais nul", () => {
    for (const d of CATALOG.filter((x) => x.spec.topSpeed > 30)) {
      const s = d.spec;
      const L = s.front + s.rear;
      const limit = (s.steerGrip * s.grip * GRAVITY * L) / (s.topSpeed * s.topSpeed);
      expect(limit).toBeGreaterThan(0.003);
    }
  });
});
