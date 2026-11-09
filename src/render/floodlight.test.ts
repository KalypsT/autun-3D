import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { aimAt, Floodlight, irradiance, veil } from "./floodlight";
import { MeshBuilder, type Vec3 } from "./geometry";

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
