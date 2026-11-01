import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { flatTerrain } from "../core/testing";
import type { Furniture } from "../data/types";
import { FallingProps } from "./falling-props";
import { buildBreakables, splitBreakable } from "./props";
import { breakFurniture, type TileMeshes } from "./stylized";

const terrain = flatTerrain();
const item = (kind: string, id: number, x: number, y: number): Furniture => ({ kind, id, x, y, name: null, rot: 0 });
const ITEMS = [item("street_lamp", 1, 0, 0), item("traffic_signals", 2, 5, 0), item("waste_basket", 3, 9, 0), item("bench", 4, 12, 0), item("post_box", 5, 14, 0)];

/** Une tuile factice : ses trois maillages du mobilier cassable, comme `stylized` les construit. */
function fakeTile(): TileMeshes {
  const { soft } = splitBreakable(ITEMS);
  const b = buildBreakables(soft, terrain);
  const group = new THREE.Group();
  for (const [name, mb] of [["mobilier", b.solid], ["lanternes", b.glow], ["halos", b.halo]] as const) {
    const m = new THREE.Mesh(mb.build());
    m.name = name;
    group.add(m);
  }
  return { group, stats: { triangles: 0, windows: 0, doors: 0, shops: 0, balconies: 0, draws: 0 }, soft, broken: new Set<number>() };
}

const count = (t: TileMeshes, name: string): number => (t.group.getObjectByName(name) as THREE.Mesh).geometry.attributes["position"]!.count;

describe("mobilier cassable : dessin (D160)", () => {
  it("le banc reste dans le mobilier plein ; lampadaires, feux, poubelles et boîtes aux lettres vont dans le mobilier cassable", () => {
    const { plain, soft } = splitBreakable(ITEMS);
    expect(plain.map((f) => f.kind)).toEqual(["bench"]);
    expect(soft.map((f) => f.kind)).toEqual(["street_lamp", "traffic_signals", "waste_basket", "post_box"]);
  });

  it("lanternes et taches de lumière ne viennent que des lampadaires", () => {
    const lampOnly = buildBreakables([ITEMS[0]!], terrain);
    const none = buildBreakables([ITEMS[2]!, ITEMS[4]!], terrain);
    expect(lampOnly.glow.triangleCount).toBeGreaterThan(0);
    expect(lampOnly.halo.triangleCount).toBeGreaterThan(0);
    expect(none.glow.triangleCount).toBe(0);
    expect(none.halo.triangleCount).toBe(0);
  });

  it("arracher un lampadaire retire son fût, sa lanterne allumée et sa tache de lumière du maillage de la tuile, et lui seul", () => {
    const t = fakeTile();
    const [solid, glow, halo] = [count(t, "mobilier"), count(t, "lanternes"), count(t, "halos")];
    const f = breakFurniture(t, 1, terrain);
    expect(f?.kind).toBe("street_lamp");
    expect(count(t, "mobilier")).toBeLessThan(solid);
    expect(count(t, "lanternes")).toBe(0);
    expect(count(t, "halos")).toBe(0);
    expect(glow).toBeGreaterThan(0);
    expect(halo).toBeGreaterThan(0);
    // Le feu, la poubelle et la boîte aux lettres sont toujours là : le maillage plein n'est pas vide.
    expect(count(t, "mobilier")).toBeGreaterThan(0);
  });

  it("un mobilier déjà arraché, ou inconnu de la tuile, ne se casse pas deux fois", () => {
    const t = fakeTile();
    expect(breakFurniture(t, 3, terrain)).not.toBeNull();
    expect(breakFurniture(t, 3, terrain)).toBeNull();
    expect(breakFurniture(t, 4, terrain)).toBeNull();
    expect(breakFurniture(t, 999, terrain)).toBeNull();
  });
});

describe("mobilier arraché qui tombe (D160)", () => {
  it("bascule dans le sens de la marche, reste couché, puis disparaît ; au plus 24 objets à la fois", () => {
    const scene = new THREE.Scene();
    const fall = new FallingProps(scene, terrain);
    // Poussé vers le nord (+y données) : le sommet du poteau part vers le nord, c'est-à-dire −z en Three.
    fall.spawn(ITEMS[0]!, 0, 1);
    expect(fall.count).toBe(1);
    const mesh = scene.children[0] as THREE.Mesh;
    const top = new THREE.Vector3(0, 4, 0);
    expect(top.clone().applyQuaternion(mesh.quaternion).y).toBeCloseTo(4);
    for (let i = 0; i < 60; i++) fall.update(1 / 30);
    const lying = top.clone().applyQuaternion(mesh.quaternion);
    expect(lying.z).toBeLessThan(-3.5);
    expect(lying.y).toBeLessThan(0.6);
    expect(Math.abs(lying.x)).toBeLessThan(0.1);
    expect(fall.count).toBe(1);
    for (let i = 0; i < 30 * 25; i++) fall.update(1 / 30);
    expect(fall.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    for (let i = 0; i < 40; i++) fall.spawn(ITEMS[2]!, 1, 0);
    expect(fall.count).toBe(24);
  });
});
