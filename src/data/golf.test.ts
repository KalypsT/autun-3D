import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GolfSite, TileData } from "./types";

// Golf municipal d'Autun (D288, tools/data/build_golf.py) : sols du parcours relevés sur l'orthophotographie de l'IGN.
const tiles = readdirSync("public/data/tiles").map((n) => JSON.parse(readFileSync(`public/data/tiles/${n}`, "utf8")) as TileData);
const tile = {
  furniture: tiles.flatMap((t) => t.furniture),
  ground: Object.fromEntries(["golf_green", "golf_tee", "golf_bunker", "golf_fairway", "golf_fairway2"].map((k) => [k, tiles.flatMap((t) => t.ground[k] ?? [])])),
};

describe("golf municipal (D288)", () => {
  it("le parcours a ses greens, ses départs, ses bunkers et ses fairways tondus en bandes", () => {
    const g = tile.ground;
    // Les polygones d'une couche peuvent être coupés aux bords des tuiles : on compte les drapeaux pour les greens.
    expect(tile.furniture.filter((f) => f.kind === "golf_flag")).toHaveLength(14);
    for (const k of ["golf_green", "golf_tee", "golf_bunker", "golf_fairway", "golf_fairway2"]) expect(g[k]?.length ?? 0).toBeGreaterThan(5);
  });

  it("chaque drapeau est planté sur un green", () => {
    const greens = tile.ground["golf_green"] ?? [];
    const inside = (x: number, y: number, ring: readonly number[]): boolean => {
      let ok = false;
      for (let i = 0, j = ring.length / 2 - 1; i < ring.length / 2; j = i++) {
        const xi = ring[2 * i]!, yi = ring[2 * i + 1]!, xj = ring[2 * j]!, yj = ring[2 * j + 1]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok;
      }
      return ok;
    };
    for (const f of tile.furniture.filter((q) => q.kind === "golf_flag")) expect(greens.some((p) => inside(f.x, f.y, p[0]!))).toBe(true);
  });

  it("le club-house a sa tente, sa terrasse, ses tables, ses toits de tuiles brunes ; l'entrée son muret, son panneau et ses drapeaux (D289)", () => {
    const kinds = JSON.parse(readFileSync("public/data/kinds/34_34.json", "utf8")) as { buildings: Record<string, { k: string }>; sites: { t: string }[] };
    const site = kinds.sites.find((q) => q.t === "golf") as GolfSite | undefined;
    expect(site).toBeDefined();
    expect(site!.tables.length).toBe(8);
    expect(site!.flags.length).toBe(2);
    expect(site!.tent.r.length).toBe(8);
    expect(kinds.buildings["BATIMENT0000002479786299"]?.k).toBe("hidden");
    const fiches = tiles.flatMap((t) => t.fiches);
    for (const id of ["BATIMENT0000000348844174", "BATIMENT0000000348844175"]) expect(fiches.find((f) => f.id === id)?.materials.roof).toBe("tuile_brune");
    expect(tiles.flatMap((t) => t.ground["golf_terrace"] ?? []).length).toBeGreaterThan(0);
    const walls = tiles.flatMap((t) => t.walls).filter((w) => w.id <= -950_000_000 && w.id > -950_000_100);
    expect(walls.map((w) => w.kind).sort()).toEqual(["fence", "fence", "hedge", "hedge", "wall"]);
    // Practice (D290) : une vingtaine de postes, un abri sur les derniers mètres, trois cibles ; filets de 5 m, trop hauts pour être escaladés.
    const p = site!.practice!;
    expect(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) / p.step).toBeGreaterThan(18);
    expect(p.targets.length).toBe(3);
    expect(walls.filter((w) => w.kind === "fence").every((w) => w.height === 5 && w.look === "mesh")).toBe(true);
  });
});
