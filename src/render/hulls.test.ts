import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HullData } from "../core/hulls";
import { loadRealWorld } from "../core/testing";
import { solidShapes } from "../core/world";
import type { TileData, TileKinds } from "../data/types";
import { buildHulls } from "./hull-build";

/**
 * Relevés de hauteur des bâtiments spéciaux (D302) : les fichiers `public/data/hulls/` doivent être ceux que donne le rendu actuel. Après un
 * changement de modèle, de gabarit ou de site, ou un nouveau bâtiment spécial : `npm run hulls`.
 */
const DIR = "public/data/hulls";
const UPDATE = process.env["UPDATE_HULLS"] === "1";

describe("relevés de hauteur des bâtiments spéciaux (D302)", () => {
  const world = loadRealWorld();
  const tiles = readdirSync("public/data/kinds").filter((n) => n !== "index.json").map((n) => n.replace(/\.json$/, "")).sort();
  const made = new Map<string, HullData[]>();
  for (const id of tiles) {
    const tile = JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData;
    tile.kinds = JSON.parse(readFileSync(`public/data/kinds/${id}.json`, "utf8")) as TileKinds;
    const hulls = buildHulls(tile, world.terrain);
    if (hulls.length) made.set(id, hulls);
  }
  if (UPDATE) {
    mkdirSync(DIR, { recursive: true });
    for (const name of existsSync(DIR) ? readdirSync(DIR) : []) if (name !== "index.json" && !made.has(name.replace(/\.json$/, ""))) rmSync(`${DIR}/${name}`);
    for (const [id, hulls] of made) writeFileSync(`${DIR}/${id}.json`, JSON.stringify({ v: 1, hulls }) + "\n");
    writeFileSync(`${DIR}/index.json`, JSON.stringify({ tiles: [...made.keys()] }) + "\n");
  }

  it("les fichiers enregistrés sont à jour (sinon : UPDATE_HULLS=1)", () => {
    const index = JSON.parse(readFileSync(`${DIR}/index.json`, "utf8")) as { tiles: string[] };
    expect(index.tiles.sort()).toEqual([...made.keys()].sort());
    for (const [id, hulls] of made) {
      const saved = JSON.parse(readFileSync(`${DIR}/${id}.json`, "utf8")) as { hulls: HullData[] };
      expect(saved.hulls, id).toEqual(hulls);
    }
  });

  it("garde : chaque bâtiment spécial et chaque site a son relevé (sinon ses murs restent des murs infinis)", () => {
    const keys = new Set([...made.values()].flat().map((h) => h.k));
    const missing: string[] = [];
    for (const id of tiles) {
      const tile = JSON.parse(readFileSync(`public/data/tiles/${id}.json`, "utf8")) as TileData;
      tile.kinds = JSON.parse(readFileSync(`public/data/kinds/${id}.json`, "utf8")) as TileKinds;
      // Les clés ne dépendent pas du relief (les collisions des tests sont parfois posées sans lui).
      const flat = solidShapes(tile, () => 0).map((s) => s.key);
      expect(flat).toEqual(solidShapes(tile, (x, y) => world.terrain.heightAt(x, y)).map((s) => s.key));
      for (const k of flat) if (!keys.has(k)) missing.push(`${id} ${k}`);
    }
    expect(missing).toEqual([]);
  });
});
