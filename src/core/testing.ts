import { readdirSync, readFileSync } from "node:fs";
import { Terrain } from "../data/terrain";
import type { TerrainMeta, TileData } from "../data/types";

/** Terrain plat de 200 × 200 m centré sur l'origine, pour les tests. */
export function flatTerrain(z = 0): Terrain {
  const meta = { cols: 200, rows: 200, res: 1, x0: -100, y0: -100, y1: 100, base: z, unit: 0.01, zmin: z, zmax: z };
  return Terrain.decode(meta, new Uint16Array(200 * 200).buffer);
}

/** Données réelles de public/data pour les tests : relief et toutes les tuiles réunies (Node uniquement). */
export function loadRealWorld(): { terrain: Terrain; tile: TileData } {
  const read = (name: string): Buffer => readFileSync(`public/data/${name}`);
  const bin = read("terrain.bin");
  const terrain = Terrain.decode(
    JSON.parse(read("terrain.json").toString("utf8")) as TerrainMeta,
    bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer,
  );
  const tile: TileData = { buildings: [], fiches: [], trees: [], walls: [], furniture: [] };
  for (const name of readdirSync("public/data/tiles")) {
    const t = JSON.parse(read(`tiles/${name}`).toString("utf8")) as TileData;
    for (const k of Object.keys(tile) as (keyof TileData)[]) (tile[k] as unknown[]).push(...(t[k] as unknown[]));
  }
  return { terrain, tile };
}
