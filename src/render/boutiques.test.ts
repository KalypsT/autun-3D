import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { MeshBuilder } from "./geometry";

/** D158 : boutiques de la rue aux Cordiers d'après photos (`fronts` de manual.json, devanture du gabarit D141). */
describe("boutiques de la rue aux Cordiers (D158)", () => {
  const tile = JSON.parse(readFileSync("public/data/tiles/26_34.json", "utf8")) as TileData;
  const fiche = (id: string): FacadeFiche => tile.fiches.find((f) => f.id === `BATIMENT0000000${id}`)!;
  const shops: [string, string, string][] = [["348853544", "La Promesse de l'Aube", "#b3242b"], ["348853291", "Territoire d'Homme", "#f1f0ec"], ["348853330", "Carrefour City", "#d8cba9"]];

  it("chaque boutique est vue sur photo, seule dans sa fiche, et sa devanture tient dans le mur d'entrée", () => {
    for (const [id, name] of shops) {
      const f = fiche(id);
      expect(f.status, name).toBe("observed");
      expect(f.ground.kind).toBe("shop");
      expect(f.ground.shops).toHaveLength(1);
      expect(f.ground.shops![0]!.name).toBe(name);
      const d = f.ground.devanture!;
      const wall = f.walls[f.ground.front!]!;
      expect(wall.role).toBe("street");
      const width = d.bays.reduce((a, q) => a + q[1], 0);
      expect(d.s0).toBeGreaterThanOrEqual(0);
      expect(d.s0 + width).toBeLessThanOrEqual(wall.length + 0.01);
      expect(d.sill).toBeLessThan(d.top);
      expect(d.frieze[1]).toBeLessThan(d.cornice);
      expect(d.cornice).toBeLessThan(d.h);
      expect(d.h).toBeLessThanOrEqual(f.storeys.ground + 0.7);
      expect(d.sign.s[0]).toBeGreaterThanOrEqual(d.s0);
      expect(d.sign.s[1]).toBeLessThanOrEqual(d.s0 + width);
    }
  });

  it("Diagonal Coiffure n'est plus dans la fiche de Carrefour City (elle est dans le bâtiment voisin)", () => {
    expect(JSON.stringify(fiche("348853330").ground.shops)).not.toContain("Diagonal");
    expect(fiche("348853303").ground.shops!.some((s) => s.name === "Diagonal Coiffure")).toBe(true);
  });

  it("Carrefour City : cadres noirs et lettres sans panneau ; les deux autres : panneau d'enseigne", () => {
    expect(fiche("348853330").ground.devanture!.frame).toBe("#1e2428");
    expect(fiche("348853330").ground.devanture!.sign.bg).toBe("");
    expect(fiche("348853544").ground.devanture!.sign.bg).not.toBe("");
    expect(fiche("348853291").ground.devanture!.sign.bg).not.toBe("");
  });

  it("géométrie : sommets finis, coût borné, vitrines allumées la nuit ; le cadre noir se voit (couleur de la devanture sinon)", () => {
    for (const [id, , color] of shops) {
      const d = fiche(id).ground.devanture!;
      const mb = new MeshBuilder(), glow = new MeshBuilder();
      buildDevanture(mb, glow, null, { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 }, d, color);
      expect(mb.positions.every(Number.isFinite)).toBe(true);
      expect(mb.positions.length / 9).toBeLessThan(1500);
      expect(glow.positions.length / 9).toBeGreaterThanOrEqual(6);
    }
    const dark = new MeshBuilder(), plain = new MeshBuilder();
    const d = fiche("348853330").ground.devanture!;
    buildDevanture(dark, null, null, { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 }, d, "#d8cba9");
    buildDevanture(plain, null, null, { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 }, { ...d, frame: undefined } as never, "#d8cba9");
    expect(Array.from(dark.colors).join()).not.toBe(Array.from(plain.colors).join());
  });
});
