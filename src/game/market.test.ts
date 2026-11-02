import { readdirSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Colliders } from "../core/collision";
import { Seats } from "../core/seats";
import { flatTerrain } from "../core/testing";
import type { TileData } from "../data/types";
import { MarketController } from "./market";
import type { Fleet, Vehicle } from "./vehicles";

const WED = 2, THU = 3;

function marks(): number[][][] {
  const out: number[][][] = [];
  for (const name of readdirSync("public/data/tiles")) {
    const t = JSON.parse(readFileSync(`public/data/tiles/${name}`, "utf8")) as TileData & { ground?: { marks?: number[][][] } };
    out.push(...(t.ground?.marks ?? []));
  }
  return out;
}

describe("marché du Champ de Mars (D201)", () => {
  it("étals, obstacles, marchands et voitures : rien hors marché, tout au plus fort, puis tout revient", () => {
    const scene = new THREE.Scene(), colliders = new Colliders(), seats = new Seats();
    const car = { id: "voiture-marche", def: { id: "citadine" }, variant: 1, ridden: false, home: { x: -10, y: -40, heading: 0 }, state: { x: -10, y: -40 }, damage: { health: 100 } } as unknown as Vehicle;
    const removed: string[] = [], added: string[] = [];
    const fleet = { vehicles: [car], remove: (v: Vehicle) => removed.push(v.id), add: (_m: string, id: string) => (added.push(id), car) } as unknown as Fleet;
    const m = new MarketController(scene, fleet, colliders, seats, flatTerrain());
    m.addTile({ id: "toutes", buildings: 0, furniture: [], stairs: [], marks: marks() });
    expect(m.stallCount).toBeGreaterThan(60);
    m.update(THU, 10);
    expect(m.shownCount).toBe(0);
    expect(removed).toEqual([]);
    m.update(WED, 10);
    expect(m.shownCount).toBeGreaterThan(48);
    expect(removed).toEqual(["voiture-marche"]);
    expect([...seats.all()].filter((s) => s.kind === "market").length).toBe(m.shownCount);
    expect(colliders.raycast(-60, -57, 20, -57, true)).not.toBeNull();
    const draws = scene.children.filter((c) => (c as THREE.Mesh).isMesh && c.visible).length;
    expect(draws).toBe(2);
    m.update(WED, 14);
    expect(m.shownCount).toBe(0);
    expect(added).toEqual(["voiture-marche"]);
    expect([...seats.all()].length).toBe(0);
    expect(scene.children.filter((c) => c.visible).length).toBe(0);
  });
});
