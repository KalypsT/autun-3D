import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { aimAt, Floodlight, irradiance, veil } from "./floodlight";
import { MeshBuilder, toThree, UvMeshBuilder, type Vec3 } from "./geometry";
import { loadRealWorld } from "../core/testing";
import { frameOf } from "../core/landmarks";
import { buildTownHall } from "./monuments";
import { buildPlayhouse } from "./playhouse";
import { floodlit } from "./floodlit";
import type { SignAtlas } from "./sign-atlas";

describe("éclairage par projecteurs (D297)", () => {
  // Mur vertical dans le plan z = 0, tourné vers +z ; projecteur à 1 m devant son pied, pointé vers le mur à 3 m de haut.
  const pr = aimAt([0, 0.1, 1], [0, 3, 0], { power: 2.4, range: 7 });
  const n: Vec3 = [0, 0, 1];

  it("le pied est plus éclairé que le haut, les côtés que le faisceau ne couvre pas restent sombres", () => {
    const low = irradiance([pr], [0, 1.5, 0], n), high = irradiance([pr], [0, 10, 0], n), side = irradiance([pr], [6, 1.5, 0], n);
    expect(low).toBeGreaterThan(2 * high);
    expect(high).toBeGreaterThan(0);
    expect(side).toBe(0);
    expect(veil(low)).toBeGreaterThan(0.7);
  });

  it("une face tournée ailleurs ne reçoit rien (dos du mur, dessus d'une corniche)", () => {
    expect(irradiance([pr], [0, 2, 0], [0, 0, -1])).toBe(0);
    expect(irradiance([pr], [0, 2, 0.2], [0, 1, 0])).toBe(0);
  });

  it("le voile n'est recopié que là où la lumière arrive, découpé plus fin près du projecteur", () => {
    const glow = new MeshBuilder();
    const fl = new Floodlight(glow, [pr]);
    const stone = new THREE.Color("#cdc6b5");
    fl.quad([-10, 0, 0], [10, 0, 0], [10, 12, 0], [-10, 12, 0], n, stone);
    expect(fl.triangles).toBe(glow.triangleCount);
    expect(glow.triangleCount).toBeGreaterThan(20);
    // Un pan de mur hors du faisceau (de 20 à 30 m du projecteur) n'est pas recopié.
    const before = glow.triangleCount;
    fl.quad([20, 0, 0], [30, 0, 0], [30, 12, 0], [20, 12, 0], n, stone);
    expect(glow.triangleCount).toBe(before);
    expect(glow.alphas!.length).toBe(glow.positions.length / 3);
  });
});

describe("hôtel de ville et théâtre municipal éclairés (D298)", () => {
  const world = loadRealWorld();
  const k = world.tile.kinds!;
  const gr = (x: number, z: number): number => world.terrain.heightAt(x, -z);
  const atlas = { get: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) } as unknown as SignAtlas;
  const front = (o: [number, number], a: number): Vec3 => {
    const f = frameOf(o[0], o[1], a, 1, 1);
    return toThree(-f.vx, -f.vy, 0);
  };

  it("projecteurs devant la façade seulement, voile borné (moins de 7 000 triangles chacun), fenêtres allumées dessinées après le voile", () => {
    const hall = Object.values(k.buildings).find((b) => b.hall)!.hall!;
    const play = Object.values(k.buildings).find((b) => b.play)!.play!;
    for (const [draw, fr] of [
      [(s: MeshBuilder, g: MeshBuilder) => buildTownHall(s, g, hall, world.terrain, new THREE.Color("#555"), null), front(hall.o, hall.a)],
      [(s: MeshBuilder, g: MeshBuilder) => buildPlayhouse({ solid: s, glow: g, names: new UvMeshBuilder(), atlas }, play, world.terrain), front(play.o, play.a)],
    ] as const) {
      const solid = new MeshBuilder(), glow = new MeshBuilder(true), halo = new MeshBuilder(true);
      const n = floodlit(solid, glow, halo, draw, { front: fr, ground: gr, step: 6, out: 1.0, power: 1.6, range: 8, grain: 0.9 });
      expect(n).toBeGreaterThan(500);
      expect(n).toBeLessThan(7000);
      expect(glow.triangleCount).toBeGreaterThanOrEqual(n);
      // Boîtiers (10 triangles chacun), au moins trois, et autant de taches au sol (16 triangles).
      expect(solid.triangleCount / 10).toBeGreaterThanOrEqual(3);
      expect(halo.triangleCount).toBe((solid.triangleCount / 10) * 16);
    }
  });
});
