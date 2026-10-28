import { describe, expect, it } from "vitest";
import { gendarmeRecipe, isValidRecipe } from "./character";
import { OFFICER, Officers, shotHitChance, type Officer, type Suspect } from "./officers";
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

  it("un pas de temps négatif ne fait pas monter l'arrestation (sans gendarme non plus)", () => {
    const o = new Officers(null);
    o.step(-3, onFoot(0, 0), noCar);
    expect(o.progress).toBe(0);
    expect(o.arrested).toBe(false);
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

  it("armés (J5-5) : ils s'arrêtent à 10 m sans jamais arrêter le joueur, tirent toutes les 1,2 s environ après un délai de réaction, et leurs balles retirent des points de vie", () => {
    const o = new Officers(null);
    o.spawn(0, 25, 0, 1, 42);
    let first = -1, shots = 0, nearest = 99;
    for (let t = 0; t < 20; t += DT) {
      o.step(DT, onFoot(0, 0), noCar, true);
      for (const sh of o.shots) {
        shots++;
        if (first < 0) first = t;
        expect(Number.isFinite(sh.x1 + sh.y1)).toBe(true);
      }
      o.clearShots();
      nearest = Math.min(nearest, Math.hypot(o.list[0]!.x, o.list[0]!.y));
    }
    expect(o.arrested).toBe(false);
    expect(nearest).toBeGreaterThan(OFFICER.holdDistance - 0.6);
    expect(nearest).toBeLessThan(OFFICER.holdDistance + 1.5);
    expect(first).toBeGreaterThan(OFFICER.reaction - 3 * DT);
    expect(shots).toBeGreaterThan(10);
    expect(shots).toBeLessThan(20);
    expect(o.takeDamage()).toBeGreaterThan(0);
    expect(o.takeDamage()).toBe(0);
    // Pose : visée quand il tient le joueur en joue.
    expect(Officers.pose(o.list[0]!)).toBe(3);
  });

  it("deux gendarmes armés tuent un joueur immobile en 5 à 30 s (moyenne autour de 10 s) ; un joueur qui court survit bien plus longtemps", () => {
    const timeToKill = (seed: number, speed: number): number => {
      const o = new Officers(null);
      o.spawn(0, 14, 0, 1, seed);
      o.spawn(3, 16, 0, 1, seed + 1000);
      let hp = 100, t = 0;
      for (; t < 120 && hp > 0; t += DT) {
        o.step(DT, onFoot(0, 0, 0, speed), noCar, true);
        hp -= o.takeDamage();
        o.clearShots();
      }
      return t;
    };
    const still: number[] = [];
    for (let seed = 1; seed <= 12; seed++) still.push(timeToKill(seed * 7, 0));
    const mean = still.reduce((a, b) => a + b, 0) / still.length;
    expect(Math.min(...still)).toBeGreaterThan(4);
    expect(Math.max(...still)).toBeLessThan(30);
    expect(mean).toBeGreaterThan(7);
    expect(mean).toBeLessThan(15);
    const run: number[] = [];
    for (let seed = 1; seed <= 6; seed++) run.push(timeToKill(seed * 7, 5));
    expect(run.reduce((a, b) => a + b, 0) / run.length).toBeGreaterThan(mean * 1.6);
  });

  it("la chance de toucher baisse avec la distance et la vitesse, et en tirant en courant", () => {
    expect(shotHitChance(5, 0, false)).toBeGreaterThan(shotHitChance(20, 0, false));
    expect(shotHitChance(20, 0, false)).toBeGreaterThan(shotHitChance(35, 0, false));
    expect(shotHitChance(15, 5, false)).toBeLessThan(shotHitChance(15, 0, false) * 0.6);
    expect(shotHitChance(15, 0, true)).toBeLessThan(shotHitChance(15, 0, false));
    for (const d of [0, 10, 35, 200]) for (const v of [0, 5, 30]) {
      const c = shotHitChance(d, v, true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0.8);
    }
  });

  it("à trois étoiles (non armés) rien ne change : pas de tir, arrestation", () => {
    const o = new Officers(null);
    o.spawn(15, 0, 0, 1, 42);
    let t = 0;
    while (!o.arrested && t < 20) {
      o.step(DT, onFoot(0, 0), noCar, false);
      t += DT;
    }
    expect(o.arrested).toBe(true);
    expect(o.shots).toHaveLength(0);
    expect(o.takeDamage()).toBe(0);
  });

  it("le joueur abat un gendarme : trois coups de couteau, il tombe et reste à terre 40 s, l'événement et sa position partent, la voiture n'est pas bloquée", () => {
    const o = new Officers(null);
    const a = o.spawn(5, 5, 0, 1, 7)!;
    expect(o.hurt(a.slot, 40, 0, 1, 1.6)).toBe(1);
    // Il trébuche : un coup pendant ce temps ne compte pas.
    expect(o.hurt(a.slot, 40, 0, 1, 1.6)).toBe(0);
    for (let t = 0; t < 1.2; t += DT) o.step(DT, onFoot(0, 0), noCar, false);
    expect(o.hurt(a.slot, 40, 0, 1, 1.6)).toBe(1);
    for (let t = 0; t < 1.2; t += DT) o.step(DT, onFoot(0, 0), noCar, false);
    expect(o.hurt(a.slot, 40, 0, 1, 1.6)).toBe(2);
    expect(a.mode).toBe("dead");
    const dead: { x: number; y: number }[] = [];
    expect(o.takeDeaths(dead)).toBe(1);
    expect(dead).toHaveLength(1);
    expect(o.takeDeaths([])).toBe(0);
    expect(o.hurt(a.slot, 40, 0, 1, 1.6)).toBe(0);
    // Mort : il ne compte plus ni pour la voiture ni pour la limite de six, mais garde sa place dans la foule.
    expect(o.countOf(1)).toBe(0);
    expect(o.alive()).toBe(0);
    expect(Officers.pose(a)).toBe(2);
    for (let t = 0; t < OFFICER.corpseLife - 1; t += 0.5) o.step(0.5, onFoot(0, 0), noCar, false);
    expect(o.list).toHaveLength(1);
    for (let t = 0; t < 3; t += 0.5) o.step(0.5, onFoot(0, 0), noCar, false);
    expect(o.list).toHaveLength(0);
  });

  it("six cadavres n'empêchent pas d'en envoyer d'autres : le plus ancien cède son emplacement ; jamais plus de six vivants ni d'emplacement au-delà de six", () => {
    const o = new Officers(null);
    for (let k = 0; k < 6; k++) {
      const c = o.spawn(k * 3, 10, 0, 1, k + 1)!;
      o.hurt(c.slot, 500, 0, 1, 1);
      o.step(DT, onFoot(0, 0), noCar, false);
    }
    expect(o.alive()).toBe(0);
    expect(o.list).toHaveLength(6);
    for (let k = 0; k < 6; k++) {
      const c = o.spawn(k * 3, 30, 0, 2, 100 + k);
      expect(c).not.toBeNull();
      expect(c!.slot).toBeLessThan(OFFICER.max);
    }
    expect(o.alive()).toBe(6);
    expect(o.spawn(0, 40, 0, 2, 999)).toBeNull();
    expect(new Set(o.list.map((q) => q.slot)).size).toBe(o.list.length);
  });

  it("une voiture lancée à plus de 50 km/h tue un gendarme ; à 30 km/h elle le blesse seulement", () => {
    const hitAt = (speed: number): Officer => {
      const o = new Officers(null);
      const a = o.spawn(0, 6, Math.PI, 1, 3)!;
      const car = createVehicle(0, 0, 0, flatTerrain());
      car.vx = 0;
      car.vy = speed;
      car.speed = speed;
      for (let k = 0; k < 90; k++) {
        car.y += speed * DT;
        o.step(DT, { x: car.x, y: car.y, vx: 0, vy: speed, vehicle: { state: car, spec: CAR } }, noCar, false);
      }
      return a;
    };
    expect(hitAt(8.3).mode).not.toBe("dead");
    expect(hitAt(15).mode).toBe("dead");
  });
});
