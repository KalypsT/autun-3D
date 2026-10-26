import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Terrain } from "../data/terrain";
import type { Building, Props, TerrainMeta, Tree } from "../data/types";
import { pointInRing } from "./collision";
import { createPlayer, stepPlayer } from "./player";
import { buildColliders } from "./world";

const read = (name: string): Buffer => readFileSync(`public/data/${name}`);
const json = <T>(name: string): T => JSON.parse(read(name).toString("utf8")) as T;
const bin = read("terrain.bin");
const terrain = Terrain.decode(json<TerrainMeta>("terrain.json"), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
const buildings = json<Building[]>("buildings.json");
const colliders = buildColliders({ buildings, props: json<Props>("props.json"), trees: json<Tree[]>("trees.json") });

function insideBuilding(x: number, y: number): boolean {
  return buildings.some((b) => pointInRing(x, y, b.ring) && !b.holes.some((h) => pointInRing(x, y, h)));
}

/** Générateur pseudo-aléatoire déterministe. */
function rand(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe("obstacles du monde", () => {
  it("contiennent les bâtiments, murs, mobilier et arbres", () => {
    expect(colliders.segments.length).toBeGreaterThan(3000);
    expect(colliders.circles.length).toBeGreaterThan(200);
  });

  it("empêchent d'entrer dans un bâtiment, même en courant droit dessus", () => {
    const r = rand(7);
    let walks = 0;
    for (let n = 0; n < 400 && walks < 120; n++) {
      const x = (r() - 0.5) * 300, y = (r() - 0.5) * 280;
      if (insideBuilding(x, y) || colliders.resolve(x, y, 0.35).hit) continue;
      walks++;
      const p = createPlayer(x, y, terrain);
      const yaw = r() * Math.PI * 2;
      for (let i = 0; i < 480; i++) {
        stepPlayer(p, { forward: 1, right: 0, run: true }, yaw + Math.sin(i / 90), 1 / 60, terrain, colliders);
        expect(insideBuilding(p.x, p.y), `entré dans un bâtiment en (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).toBe(false);
      }
    }
    expect(walks).toBeGreaterThan(60);
  });

  it("laisse libre le point de départ sur la place", () => {
    const hit = colliders.resolve(-10, -40, 0.35);
    expect(hit.hit).toBe(false);
    expect(insideBuilding(-10, -40)).toBe(false);
  });
});
