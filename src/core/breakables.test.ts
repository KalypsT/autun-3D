import { describe, expect, it } from "vitest";
import { BREAKABLE, BREAK_MIN_MASS, breaks, isBreakable, speedKept } from "./breakables";
import { Colliders } from "./collision";
import { VehicleDamage } from "./damage";
import { flatTerrain } from "./testing";
import { addTileColliders } from "./world";
import { BIKE, CAR, createVehicle, SCOOTER, stepVehicle, type VehicleSpec } from "./vehicle";
import { OLD_CAR, SPORT_MOTO, VAN } from "./vehicle-specs";

const kmh = (v: number): number => v / 3.6;
const DT = 1 / 60;
const flat = flatTerrain();

/** Une voiture lancée vers le nord à `speed` m/s contre un obstacle à 14 m devant elle ; renvoie l'état après `seconds` secondes. */
function crash(spec: VehicleSpec, speed: number, kind: string | null, seconds = 3, breaker = true) {
  const c = new Colliders();
  if (kind) c.addCircle(0, 14, BREAKABLE[kind]?.radius ?? 0.2, { id: 7, kind });
  else c.addCircle(0, 14, 0.2);
  const s = createVehicle(0, 0, 0, flat);
  s.vx = 0;
  s.vy = speed;
  s.speed = speed;
  let impact = 0;
  for (let i = 0; i < seconds * 60; i++) {
    stepVehicle(s, spec, { throttle: 0, brake: 0, steer: 0 }, DT, flat, c, null, false, breaker);
    impact = Math.max(impact, s.impact);
    s.impact = 0;
  }
  return { s, c, impact };
}

describe("mobilier cassable (D160)", () => {
  it("lampadaires, feux, poubelles, boîtes aux lettres, potelets et bornes à eau sont cassables ; bancs et fontaines non", () => {
    for (const k of ["street_lamp", "traffic_signals", "waste_basket", "post_box", "bollard", "drinking_water"]) expect(isBreakable(k)).toBe(true);
    for (const k of ["bench", "fountain", "memorial", "toilets"]) expect(isBreakable(k)).toBe(false);
  });

  it("seuils : un véhicule léger ne casse rien, un lourd casse au-dessus du seuil seulement", () => {
    const lamp = BREAKABLE["street_lamp"]!;
    expect(breaks(lamp, CAR.mass, kmh(40))).toBe(true);
    expect(breaks(lamp, CAR.mass, kmh(15))).toBe(false);
    expect(breaks(lamp, BIKE.mass, kmh(60))).toBe(false);
    expect(breaks(lamp, SPORT_MOTO.mass, kmh(100))).toBe(false);
    expect(breaks(lamp, BREAK_MIN_MASS, lamp.threshold)).toBe(true);
    expect(speedKept(lamp, CAR.mass)).toBeGreaterThan(0.8);
    expect(speedKept(lamp, VAN.mass)).toBeGreaterThan(speedKept(lamp, CAR.mass));
  });

  it("une voiture à 50 km/h arrache un lampadaire et continue, au lieu de s'arrêter net comme contre un mur", () => {
    const wall = crash(OLD_CAR, kmh(50), null);
    const lamp = crash(OLD_CAR, kmh(50), "street_lamp");
    expect(wall.s.y).toBeLessThan(14);
    expect(lamp.s.y).toBeGreaterThan(14 + 5);
    expect(lamp.s.speed).toBeGreaterThan(5);
    const events = lamp.c.takeBroken();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 7, kind: "street_lamp", x: 0, y: 14 });
    expect(events[0]!.dy).toBeGreaterThan(0.99);
    expect(lamp.c.takeBroken()).toHaveLength(0);
  });

  it("le lampadaire arraché ne gêne plus, et la voiture abîmée environ moitié moins que contre un mur", () => {
    const lamp = crash(OLD_CAR, kmh(60), "street_lamp");
    const wall = crash(OLD_CAR, kmh(60), null);
    const toughness = 1;
    const dl = new VehicleDamage({ toughness, burns: true }), dw = new VehicleDamage({ toughness, burns: true });
    const pl = dl.hit(lamp.impact, 0), pw = dw.hit(wall.impact, 0);
    expect(pl).toBeGreaterThan(0);
    expect(pl).toBeLessThan(pw * 0.65);
    expect(lamp.c.resolve(0, 14, 0.9).hit).toBe(false);
  });

  it("sous le seuil, le poteau tient et se comporte comme un obstacle plein", () => {
    const slow = crash(OLD_CAR, kmh(12), "street_lamp");
    expect(slow.c.takeBroken()).toHaveLength(0);
    expect(slow.s.y).toBeLessThan(14);
  });

  it("la circulation et la police (qui ne sont pas « briseurs ») gardent le mobilier plein : le poteau les arrête comme avant", () => {
    const r = crash(OLD_CAR, kmh(50), "street_lamp", 3, false);
    expect(r.c.takeBroken()).toHaveLength(0);
    expect(r.s.y).toBeLessThan(14);
  });

  it("un vélo, une trottinette ou une moto à pleine vitesse ne cassent rien", () => {
    for (const spec of [BIKE, SCOOTER, SPORT_MOTO]) {
      const r = crash(spec, 12, "street_lamp");
      expect(r.c.takeBroken()).toHaveLength(0);
    }
  });

  it("une tuile déchargée puis rechargée remet le mobilier en place (étiquette)", () => {
    const c = new Colliders();
    c.currentTag = "tuile";
    c.addCircle(0, 14, 0.2, { id: 3, kind: "street_lamp" });
    c.currentTag = null;
    c.breakCircle(0, 0, 1, 10);
    expect(c.resolve(0, 14, 0.5).hit).toBe(false);
    c.removeTag("tuile");
    c.currentTag = "tuile";
    c.addCircle(0, 14, 0.2, { id: 3, kind: "street_lamp" });
    c.currentTag = null;
    expect(c.resolve(0, 14, 0.5).hit).toBe(true);
    expect(c.live.circles).toBe(1);
  });
});

describe("mobilier cassable dans les obstacles d'une tuile (D160)", () => {
  it("lampadaires, poubelles et potelets sont des obstacles cassables ; le banc est plein ; les feux n'en sont pas pour la circulation et les passants", () => {
    const c = new Colliders();
    const furniture = [
      { kind: "street_lamp", x: 0, y: 0, name: null, id: 1 }, { kind: "waste_basket", x: 5, y: 0, name: null, id: 2 },
      { kind: "bollard", x: 10, y: 0, name: null, id: 3 }, { kind: "bench", x: 15, y: 0, name: null, id: 4 }, { kind: "traffic_signals", x: 20, y: 0, name: null, id: 5 },
    ];
    addTileColliders(c, { buildings: [], walls: [], furniture, trees: [] });
    expect(c.live.circles).toBe(4);
    const soft = (x: number): boolean | undefined => c.circles.find((k) => k.x === x)?.brk !== undefined;
    expect([0, 5, 10].map(soft)).toEqual([true, true, true]);
    expect(soft(15)).toBe(false);
    expect(c.circles.some((k) => k.x === 20)).toBe(false);
  });
});
