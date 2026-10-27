import { readdirSync, readFileSync } from "node:fs";
import { decodeNavCell, type NavCell, type NavIndex } from "../data/nav";
import { Terrain, TiledTerrain } from "../data/terrain";
import type { TileData, WorldManifest } from "../data/types";

/** Terrain plat de 200 × 200 m centré sur l'origine, pour les tests. */
export function flatTerrain(z = 0): Terrain {
  const meta = { cols: 200, rows: 200, res: 1, x0: -100, y0: -100, y1: 100, base: z, unit: 0.01, zmin: z, zmax: z };
  return Terrain.decode(meta, new Uint16Array(200 * 200).buffer);
}

/** Données réelles de public/data pour les tests : relief fin de toutes les tuiles et toutes les tuiles réunies (Node uniquement). */
export function loadRealWorld(): { terrain: TiledTerrain; tile: TileData; manifest: WorldManifest } {
  const read = (name: string): Buffer => readFileSync(`public/data/${name}`);
  const buffer = (name: string): ArrayBuffer => {
    const b = read(name);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const manifest = JSON.parse(read("world.json").toString("utf8")) as WorldManifest;
  const terrain = new TiledTerrain(manifest, Terrain.decode(manifest.coarse, buffer("terrain/coarse.bin")), () => Promise.reject(new Error("tests : tout est déjà chargé")));
  for (const t of manifest.tiles) terrain.setBlock(t.id, TiledTerrain.decodeBlock(buffer(`terrain/${t.id}.bin`)));
  const tile: TileData = { bounds: [0, 0, 0, 0], ground: {}, buildings: [], fiches: [], trees: [], walls: [], furniture: [] };
  for (const name of readdirSync("public/data/tiles")) {
    const t = JSON.parse(read(`tiles/${name}`).toString("utf8")) as TileData;
    for (const k of ["buildings", "fiches", "trees", "walls", "furniture"] as const) (tile[k] as unknown[]).push(...(t[k] as unknown[]));
  }
  return { terrain, tile, manifest };
}

/** Données de navigation réelles (public/data/nav) : l'index et toutes les super-tuiles décodées (Node uniquement). */
export function loadRealNav(): { index: NavIndex; cells: NavCell[] } {
  const index = JSON.parse(readFileSync("public/data/nav/index.json", "utf8")) as NavIndex;
  const cells = index.cells.map((c) => decodeNavCell(JSON.parse(readFileSync(`public/data/nav/${c.id}.json`, "utf8"))));
  return { index, cells };
}
