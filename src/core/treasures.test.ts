import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { waterDepth } from "./shore";
import { loadRealWorld } from "./testing";
import { accessGraph, levelOf, pickTreasures, roofAt, roofNodes, TREASURE_SPACING, type TreasureSite } from "./treasure-placer";

const FILE = "src/data/treasures.json";

/**
 * Objets cachés sur les toits (D321). `npm run treasures` (UPDATE_TREASURES=1) refait le placement et écrit `src/data/treasures.json` ;
 * sans cette variable, le test vérifie que chaque objet est toujours sur son toit et accessible au niveau annoncé (un changement des
 * données de la ville qui le casserait échoue ici).
 */
describe("objets cachés sur les toits (D321)", () => {
  const { terrain, tile } = loadRealWorld();
  const nodes = roofNodes(tile.buildings, tile.kinds);
  const access = accessGraph(nodes, terrain, (x, y) => waterDepth(terrain, x, y) > 0.3);

  it("placement : 30 objets, 10 par niveau, 12 dans le centre, espacés, chacun sur son toit et accessible", () => {
    if (process.env["UPDATE_TREASURES"]) writeFileSync(FILE, `${JSON.stringify(pickTreasures(nodes, access), null, 1)}\n`);
    const sites = JSON.parse(readFileSync(FILE, "utf8")) as TreasureSite[];
    expect(sites.length).toBe(30);
    expect([1, 2, 3].map((l) => sites.filter((s) => s.level === l).length)).toEqual([10, 10, 10]);
    expect(sites.filter((s) => s.group === "Centre").length).toBe(12);
    expect(new Set(sites.map((s) => s.id)).size).toBe(30);
    const byId = new Map(nodes.map((n, i) => [n.id, i]));
    const bad: string[] = [];
    for (const s of sites) {
      const i = byId.get(s.building);
      if (i === undefined) { bad.push(`${s.id} : bâtiment ${s.building} disparu`); continue; }
      const z = roofAt(nodes[i]!, s.x, s.y);
      if (z === null || Math.abs(z - s.z) > 0.3) bad.push(`${s.id} : toit à ${z} au lieu de ${s.z}`);
      if (levelOf(access[i]!) !== s.level) bad.push(`${s.id} : niveau ${levelOf(access[i]!)} au lieu de ${s.level}`);
      for (const o of sites) if (o !== s && Math.hypot(o.x - s.x, o.y - s.y) < TREASURE_SPACING) bad.push(`${s.id} trop près de ${o.id}`);
    }
    expect(bad).toEqual([]);
  });
});
