/** Obstacles ronds avec une hauteur (D303) : mobilier, arbres, poteaux, voitures garées ; on les survole au lieu de buter en plein ciel. */
import { describe, expect, it } from "vitest";
import { Colliders, WALL_STEP } from "./collision";
import { withRoofs } from "./roofs";
import { loadRealWorld } from "./testing";
import { CAR, createVehicle, stepVehicle } from "./vehicle";
import { addTileColliders, FURNITURE_TOP } from "./world";

const DT = 1 / 60;

describe("obstacles ronds à hauteur (D303)", () => {
  it("on passe au-dessus quand les pieds sont à moins de WALL_STEP sous le haut ; sans altitude, cylindre infini", () => {
    const c = new Colliders();
    c.addCircle(0, 0, 0.3, undefined, 4.5);
    expect(c.resolve(0.2, 0, 0.5).hit).toBe(true);
    expect(c.resolve(0.2, 0, 0.5, 0, 0).hit).toBe(true);
    expect(c.resolve(0.2, 0, 0.5, 0, 4.5 - WALL_STEP - 0.01).hit).toBe(true);
    expect(c.resolve(0.2, 0, 0.5, 0, 4.5 - WALL_STEP + 0.01).hit).toBe(false);
    // Rayon (tir, vue) : par-dessus, il passe ; dessous ou sans altitude, il s'arrête.
    expect(c.raycast(-5, 0, 5, 0, true)).not.toBeNull();
    expect(c.raycast(-5, 0, 5, 0, true, 1.3, 1.3)).not.toBeNull();
    expect(c.raycast(-5, 0, 5, 0, true, 6, 5)).toBeNull();
    // Sans haut : infini, comme avant.
    const d = new Colliders();
    d.addCircle(0, 0, 0.3);
    expect(d.resolve(0.2, 0, 0.5, 0, 100).hit).toBe(true);
  });

  describe("dans la vraie ville", () => {
    const world = loadRealWorld();
    const c = new Colliders();
    addTileColliders(c, world.tile, null, world.terrain);
    const surface = withRoofs(world.terrain, c.roofs);

    it("tout le mobilier, les arbres et les poteaux des monuments ont un haut, au-dessus du sol et à hauteur raisonnable", () => {
      let n = 0;
      for (const k of c.circles) {
        expect(k.top, JSON.stringify(k)).toBeDefined();
        const g = world.terrain.heightAt(k.x, k.y);
        expect(k.top! - g, JSON.stringify(k)).toBeGreaterThan(0.3);
        expect(k.top! - g, JSON.stringify(k)).toBeLessThan(60);
        n++;
      }
      expect(n).toBeGreaterThan(5000);
    });

    it("une voiture lancée au-dessus d'un lampadaire passe ; plus bas, elle le heurte", () => {
      const lamp = world.tile.furniture.find((f) => f.kind === "street_lamp" && c.circles.some((k) => k.x === f.x && k.y === f.y))!;
      const g = world.terrain.heightAt(lamp.x, lamp.y);
      // Lancée vers le nord, 8 m avant le lampadaire, à une altitude donnée ; renvoie la plus faible vitesse vers le nord sur le passage.
      const run = (z: number): number => {
        const s = createVehicle(lamp.x, lamp.y - 8, 0, surface);
        s.z = z;
        s.air = 1;
        s.vy = 20;
        s.speed = 20;
        let least = Infinity;
        for (let i = 0; i < 30; i++) {
          stepVehicle(s, CAR, { throttle: 0, brake: 0, steer: 0 }, DT, surface, c, null, true);
          least = Math.min(least, s.vy);
        }
        return least;
      };
      expect(run(g + FURNITURE_TOP.street_lamp! + 1)).toBeGreaterThan(15);
      expect(run(g + 2)).toBeLessThan(15);
    });
  });
});
