import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { planFacades, planFacadesSteps } from "./facades";
import { finish, MeshBuilder } from "./geometry";
import { buildGroundSteps } from "./ground";

const white = new THREE.Color(1, 1, 1);

function grid(n: number, z: number): MeshBuilder {
  const mb = new MeshBuilder();
  for (let i = 0; i < n; i++) mb.quad([i, z, 0], [i + 1, z, 0], [i + 1, z, 1], [i, z, 1], [0, 1, 0], white);
  return mb;
}

describe("construction par tranches", () => {
  it("l'assemblage par blocs met bout à bout les maillages, dans l'ordre", () => {
    const a = grid(30_000, 0), b = grid(5, 2);
    const steps = a.buildSteps([b]);
    let pauses = 0;
    let r = steps.next();
    while (!r.done) {
      pauses++;
      r = steps.next();
    }
    const g = r.value;
    const pos = g.getAttribute("position");
    expect(pos.count).toBe((a.positions.length + b.positions.length) / 3);
    expect(pos.getY(pos.count - 1)).toBe(2);
    expect(pos.getY(0)).toBe(0);
    // 30 000 quads = 540 000 flottants par attribut : plusieurs pauses par attribut.
    expect(pauses).toBeGreaterThan(10);
    expect(g.boundingSphere).not.toBeNull();
  });

  it("le plan des façades et les sols rendent la main régulièrement, avec le même résultat", () => {
    const { terrain, tile } = loadRealWorld();
    const buildings = tile.buildings.slice(0, 60);
    const fiches = new Map(tile.fiches.map((f) => [f.id, f]));
    const steps = planFacadesSteps(buildings, fiches, terrain);
    let pauses = 0;
    let r = steps.next();
    while (!r.done) {
      pauses++;
      r = steps.next();
    }
    expect(pauses).toBe(60);
    expect(r.value.placements.length).toBe(planFacades(buildings, fiches, terrain).placements.length);
    const ground = finish(buildGroundSteps({ walk: [[[0, 0, 10, 0, 10, 10, 0, 10]]] }, [-100, -100, 100, 100], terrain));
    expect(ground.triangleCount).toBeGreaterThan(2);
  });
});
