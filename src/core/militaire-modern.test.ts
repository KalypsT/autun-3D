import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reshapeBuilding } from "./landmarks";
import { loadRealWorld } from "./testing";
import type { LodBuilding } from "../data/types";

/** D262 : Lycée militaire, lot 5 de docs/plans/lycee-militaire.md : bâtiments modernes de l'enceinte, toits mesurés au LiDAR. */
describe("Lycée militaire : bâtiments modernes (D262)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!.buildings;
  const manual = (JSON.parse(readFileSync("tools/data/manual.json", "utf8")) as { monuments: Record<string, { model: string; photo?: string }> }).monuments;
  const mine = Object.entries(manual).filter(([, m]) => m.photo?.startsWith("Lycée militaire (D262)")).map(([id, m]) => [id, m.model] as const);

  it("treize toits plans et six toits à deux pans mesurés", () => {
    expect(mine.filter(([, m]) => m === "roofplane")).toHaveLength(13);
    expect(mine.filter(([, m]) => m === "college")).toHaveLength(6);
  });

  it("chaque toit plan est posé (plan, couleur) ; les toits plats sont plus bas que l'ancien faîtage générique", () => {
    for (const [id, model] of mine) {
      if (model !== "roofplane") continue;
      const k = kinds[id]!, b = world.tile.buildings.find((q) => q.id === id)!;
      expect(k.roof).toHaveLength(4);
      expect(k.zinc).toMatch(/^#[0-9a-f]{6}$/);
      const r = reshapeBuilding(b, k.k, k.roof);
      expect(r.top.every(Number.isFinite)).toBe(true);
      // Un appentis mesuré peut dépasser l'ancien gabarit plat ; un toit plat, jamais.
      if (Math.hypot(k.roof![0], k.roof![1]) < 0.02) expect(Math.max(...r.top)).toBeLessThan(Math.max(b.ridge, ...b.top) + 0.8);
    }
    // Les deux bâtiments à patios ont leur toit végétalisé, à moins de 2 % de pente.
    for (const id of ["BATIMENT0000000348844655", "BATIMENT0000000348844704"]) {
      expect(kinds[id]!.zinc).toBe("#7c9a5c");
      expect(Math.hypot(kinds[id]!.roof![0], kinds[id]!.roof![1])).toBeLessThan(0.02);
    }
  });

  it("toits à deux pans : faîtage au-dessus des égouts ou toit plat, égouts égaux à 3 m près", () => {
    for (const [id, model] of mine) {
      if (model !== "college") continue;
      for (const w of kinds[id]!.college!.wings) {
        expect(w.r).toBeGreaterThan(Math.max(w.el, w.er) - 0.1);
        expect(Math.abs(w.el - w.er)).toBeLessThan(3);
      }
    }
  });

  it("plus aucune vitrine de commerce dans l'enceinte ; silhouettes lointaines des toits plans plates", () => {
    // Les bâtiments du modèle `college` ont leur propre façade : seules les fiches des toits plans sont dessinées.
    for (const [id, model] of mine) {
      if (model !== "roofplane") continue;
      const fi = world.tile.fiches.find((f) => f.id === id);
      if (fi) expect(fi.ground.kind).not.toBe("shop");
    }
    const lod = JSON.parse(readFileSync("public/data/lod/28_35.json", "utf8")) as (LodBuilding & { k: number })[];
    const flat = lod.filter((e) => e.e === e.g);
    expect(flat.length).toBeGreaterThan(5);
  });
});
