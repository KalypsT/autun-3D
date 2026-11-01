import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HeightField, TileData, TileKinds, VallonModel } from "../data/types";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { buildVallon, vallonFrame } from "./vallon";
import { buildVallonFacades, buriedParts, faceGeom, SIDES } from "./vallon-facade";

/** D173 : façades du collège du Vallon (lot 2 de docs/plans/college-vallon.md). */
const kinds = JSON.parse(readFileSync("public/data/kinds/28_39.json", "utf8")) as TileKinds;
const tile = JSON.parse(readFileSync("public/data/tiles/28_39.json", "utf8")) as TileData;
const main = kinds.buildings["BATIMENT0000000348848973"]!.vallon as VallonModel;
const preau = kinds.buildings["BATIMENT0000000348848974"]!.vallon as VallonModel;
const g0 = tile.buildings.find((b) => b.id === "BATIMENT0000000348848973")!.ground;
const flat: HeightField = { heightAt: () => g0, xMin: -1e9, xMax: 1e9, yMin: -1e9, yMax: 1e9 };
const sinks = (): LandmarkSinks => ({ solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas: {} as SignAtlas });
const cap = (n: [number, number]): number => ((Math.atan2(n[0], n[1]) * 180) / Math.PI + 360) % 360;
const wing = (n: string) => main.wings!.find((w) => w.n === n)!;

describe("Collège du Vallon (D173) : repères de face", () => {
  it("la normale de chaque face regarde vers l'extérieur : s à 162°, e à 72°, n à 342°, w à 252° (repère tourné de 17,5°)", () => {
    const f = vallonFrame(main), r = wing("barre").r;
    const caps = Object.fromEntries(SIDES.map((s) => [s, cap(faceGeom(f, r, s).frame.n)]));
    expect(caps.s).toBeCloseTo(162.5, 1);
    expect(caps.e).toBeCloseTo(72.5, 1);
    expect(caps.n).toBeCloseTo(342.5, 1);
    expect(caps.w).toBeCloseTo(252.5, 1);
  });

  it("longueur des faces : barre 36,75 m le long de u et 22,75 m le long de v", () => {
    const f = vallonFrame(main), r = wing("barre").r;
    expect(faceGeom(f, r, "s").len).toBeCloseTo(36.75, 6);
    expect(faceGeom(f, r, "e").len).toBeCloseTo(22.75, 6);
  });

  it("le point (s, t) d'une face retombe sur le mur : t = 0 le long de la face, t > 0 à l'extérieur", () => {
    const f = vallonFrame(main), r = wing("aile-ouest").r;
    const { frame, len } = faceGeom(f, r, "w");
    const [u, v] = f.uv(frame.pt(len / 2, 0));
    expect(u).toBeCloseTo(r[0], 9);
    expect(v).toBeCloseTo((r[2] + r[3]) / 2, 9);
    expect(f.uv(frame.pt(len / 2, 1))[0]).toBeLessThan(r[0]);
  });
});

describe("Collège du Vallon (D173) : parties masquées par les voisins", () => {
  it("la face nord de l'aile ouest est entièrement collée au bloc nord (même niveau, donc masquée jusqu'au toit)", () => {
    const parts = buriedParts(main, "aile-ouest", "n");
    expect(parts.length).toBeGreaterThan(0);
    const covered = parts.reduce((a, [s0, s1]) => a + (s1 - s0), 0);
    expect(covered).toBeGreaterThan(15);
  });

  it("la face est de l'aile ouest est masquée par le préau jusqu'à son sommet, pas au-delà (le mur-rideau garde son niveau haut)", () => {
    const parts = buriedParts(main, "aile-ouest", "e");
    expect(parts.length).toBeGreaterThan(0);
    for (const [, , top] of parts) {
      expect(top).toBeLessThan(wing("aile-ouest").z - 3);
      expect(top).toBeGreaterThan(preau.preau!.crown);
    }
  });

  it("la face ouest de la barre n'a aucun voisin : rien n'y est masqué", () => {
    expect(buriedParts(main, "barre", "w")).toEqual([]);
  });
});

describe("Collège du Vallon (D173) : maillage des façades", () => {
  it("ailes avec façades : maillage fini, plus de triangles qu'avec les murs unis, moins de 12 000 en tout", () => {
    const plain = sinks(), full = sinks();
    buildVallon(plain, main, flat);
    buildVallon(full, main, flat);
    buildVallonFacades(full, main, flat);
    const n = (s: LandmarkSinks): number => s.solid.positions.length / 9;
    expect(n(full)).toBeGreaterThan(n(plain) + 500);
    expect(n(full)).toBeLessThan(12000);
    expect(full.solid.positions.every(Number.isFinite)).toBe(true);
    expect(full.glow.positions.length).toBeGreaterThan(0);
  });

  it("aucune face de façade ne dépasse l'acrotère de l'aile la plus haute", () => {
    const s = sinks();
    buildVallonFacades(s, main, flat);
    const top = Math.max(...s.solid.positions.filter((_, i) => i % 3 === 1));
    expect(top).toBeLessThanOrEqual(wing("barre").z + 0.5 + 1e-6);
  });

  it("préau ouvert : poteaux et poutres au lieu des murs des côtés sud et est, ses quatre voûtes gardées", () => {
    expect(preau.preau!.open).toEqual(["s", "e"]);
    const open = sinks(), closed = sinks();
    buildVallon(open, preau, flat);
    buildVallon(closed, { ...preau, preau: { ...preau.preau!, open: [] } }, flat);
    expect(open.solid.positions.length).not.toBe(closed.solid.positions.length);
    expect(open.solid.positions.every(Number.isFinite)).toBe(true);
  });
});
