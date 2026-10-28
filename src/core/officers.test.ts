import { describe, expect, it } from "vitest";
import { gendarmeRecipe, isValidRecipe } from "./character";
import { OFFICER, Officers, type Suspect } from "./officers";
import { flatTerrain } from "./testing";
import { createVehicle } from "./vehicle";
import { vehicleDef } from "./vehicle-catalog";

const DT = 1 / 60;
const CAR = vehicleDef("citadine")!.spec;
const onFoot = (x: number, y: number, vx = 0, vy = 0): Suspect => ({ x, y, vx, vy, vehicle: null });
const noCar = (): { x: number; y: number } | null => ({ x: -30, y: 0 });

describe("gendarmes à pied (J4-5)", () => {
  it("rattrapent et arrêtent un joueur immobile à pied en quelques secondes", () => {
    const o = new Officers(null);
    o.spawn(15, 0, 0, 1, 42);
    let t = 0;
    while (!o.arrested && t < 20) {
      o.step(DT, onFoot(0, 0), noCar);
      t += DT;
    }
    expect(o.arrested).toBe(true);
    // 15 m à 4,7 m/s, puis 1,5 s au contact.
    expect(t).toBeGreaterThan(OFFICER.footTime + 2);
    expect(t).toBeLessThan(8);
  });

  it("ne rattrapent pas un joueur qui court (5 m/s contre 4,7)", () => {
    const o = new Officers(null);
    o.spawn(-3, 0, 0, 1, 42);
    let x = 0;
    for (let i = 0; i < 60 * 20; i++) {
      x += 5 * DT;
      o.step(DT, onFoot(x, 0, 5, 0), noCar);
    }
    expect(o.arrested).toBe(false);
    expect(o.progress).toBeLessThan(0.5);
  });

  it("arrêtent un joueur au volant à l'arrêt, pas une voiture qui roule", () => {
    const flat = flatTerrain();
    for (const moving of [false, true]) {
      const o = new Officers(null);
      o.spawn(8, 0, 0, 1, 7);
      const s = createVehicle(0, 0, 0, flat);
      if (moving) s.vy = 5;
      let t = 0;
      while (!o.arrested && t < 12) {
        if (moving) s.y += 5 * DT;
        o.step(DT, { x: s.x, y: s.y, vx: s.vx, vy: s.vy, vehicle: { state: s, spec: CAR } }, noCar);
        t += DT;
      }
      expect(o.arrested).toBe(!moving);
    }
  });

  it("une voiture lancée renverse le gendarme (une infraction), qui se relève et reprend sa course", () => {
    const flat = flatTerrain();
    const o = new Officers(null);
    const g = o.spawn(0, 6, Math.PI, 1, 3)!;
    const s = createVehicle(0, 0, 0, flat);
    s.vy = 9;
    s.speed = 9;
    let downAt = -1;
    for (let i = 0; i < 60 * 6; i++) {
      s.y += s.vy * DT;
      o.step(DT, { x: s.x, y: s.y, vx: s.vx, vy: s.vy, vehicle: { state: s, spec: CAR } }, noCar);
      if (downAt < 0 && g.mode === "down") downAt = i;
      if (i === 30) {
        s.vy = 0;
        s.speed = 0;
      }
    }
    expect(downAt).toBeGreaterThanOrEqual(0);
    expect(o.takeHits()).toBe(1);
    expect(o.takeHits()).toBe(0);
    expect(g.mode).toBe("run");
    expect(Officers.pose(g)).toBe(0);
  });

  it("rappelés, ils retournent à leur voiture et disparaissent en l'atteignant ; au plus six dehors", () => {
    const o = new Officers(null);
    for (let k = 0; k < 8; k++) o.spawn(k, 0, 0, k < 2 ? 1 : 2, k);
    expect(o.list).toHaveLength(OFFICER.max);
    expect(new Set(o.list.map((g) => g.slot)).size).toBe(OFFICER.max);
    o.recall(1);
    for (let i = 0; i < 60 * 15; i++) o.step(DT, onFoot(100, 100), (id) => (id === 1 ? { x: -20, y: 0 } : null));
    expect(o.countOf(1)).toBe(0);
    expect(o.countOf(2)).toBe(4);
  });

  it("portent l'uniforme : recette valide, veste et pantalon bleu marine, casquette, sans sac", () => {
    for (let seed = 1; seed < 40; seed++) {
      const r = gendarmeRecipe(seed);
      expect(isValidRecipe(r)).toBe(true);
      expect([r.top, r.bottom, r.hat, r.bag, r.scarf]).toEqual(["jacket", "trousers", "cap", "none", false]);
    }
  });
});
