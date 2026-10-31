import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadRealWorld } from "../core/testing";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";
import { buildStore, lidlCartShelter } from "./store";

const LIDL = "BATIMENT0000000348858792", PHARMACY = "BATIMENT0000002202684554", CART = "BATIMENT0000002101118190";

describe("magasins d'après photo (D143) : géométrie", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const names: string[] = [];
  const atlas = { get: (text: string) => { names.push(text); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
  const sinks = (): LandmarkSinks => ({ solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas });
  const tris = (mb: MeshBuilder): number => mb.positions.length / 9;
  const wall = new THREE.Color("#ece6d8");
  const bOf = (id: string) => world.tile.buildings.find((b) => b.id === id)!;
  const finite = (s: LandmarkSinks): boolean => s.solid.positions.every(Number.isFinite) && s.glow.positions.every(Number.isFinite);

  it("Lidl : sommets finis, vitrage allumé la nuit, inscription LIDL, coût borné", () => {
    const s = sinks();
    buildStore(s, bOf(LIDL), kinds.buildings[LIDL]!, world.terrain, wall);
    expect(finite(s)).toBe(true);
    expect(tris(s.glow)).toBeGreaterThan(20);
    expect(names).toContain("LIDL");
    expect(tris(s.solid)).toBeGreaterThan(300);
    expect(tris(s.solid)).toBeLessThan(2000);
    // Tout reste près du bâtiment : au plus 5 m au-delà du contour et 12 m de haut.
    const b = bOf(LIDL);
    const xs = b.ring.filter((_, i) => i % 2 === 0), ys = b.ring.filter((_, i) => i % 2 === 1);
    const p = s.solid.positions;
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]!).toBeGreaterThan(Math.min(...xs) - 5);
      expect(p[i]!).toBeLessThan(Math.max(...xs) + 5);
      expect(-p[i + 2]!).toBeGreaterThan(Math.min(...ys) - 5);
      expect(-p[i + 2]!).toBeLessThan(Math.max(...ys) + 5);
      expect(p[i + 1]! - b.ground).toBeLessThan(12);
    }
  });

  it("pharmacie : sommets finis, vitrage allumé, nom et croix, coût borné", () => {
    names.length = 0;
    const s = sinks();
    buildStore(s, bOf(PHARMACY), kinds.buildings[PHARMACY]!, world.terrain, wall);
    expect(finite(s)).toBe(true);
    expect(tris(s.glow)).toBeGreaterThan(10);
    expect(names).toContain("Pharmacie de Saint-Pan");
    expect(tris(s.solid)).toBeGreaterThan(200);
    expect(tris(s.solid)).toBeLessThan(1500);
  });

  it("abri à chariots du Lidl : sommets finis, coût borné, panneau Lidl au fond", () => {
    names.length = 0;
    const s = sinks();
    lidlCartShelter(s, bOf(CART), kinds.buildings[CART]!, world.terrain);
    expect(finite(s)).toBe(true);
    expect(names).toContain("LIDL");
    expect(tris(s.solid)).toBeGreaterThan(100);
    expect(tris(s.solid)).toBeLessThan(700);
  });

  it("zone commerciale de Bellevue (D144) : sommets finis, vitrages allumés, inscriptions, coût borné", () => {
    const BRICO = "BATIMENT0000000348847158", INTER = "BATIMENT0000000348847156", BUT = "BATIMENT0000000348852219", JARD = "BATIMENT0000000348847180";
    const want: [string, string[], number, number][] = [
      [BRICO, ["BRICO", "MARCHÉ", "MAISON - JARDIN"], 250, 2500],
      [INTER, ["Intermarché", "SUPER"], 200, 2500],
      [BUT, ["BUT", "Cosy"], 80, 1800],
      [JARD, ["Jardinerie", "D'AUTUN"], 80, 1800],
    ];
    let total = 0;
    for (const [id, labels, lo, hi] of want) {
      names.length = 0;
      const s = sinks();
      buildStore(s, bOf(id), kinds.buildings[id]!, world.terrain, wall);
      expect(finite(s)).toBe(true);
      expect(tris(s.glow)).toBeGreaterThan(8);
      for (const l of labels) expect(names).toContain(l);
      expect(tris(s.solid)).toBeGreaterThan(lo);
      expect(tris(s.solid)).toBeLessThan(hi);
      total += tris(s.solid) + tris(s.glow);
    }
    // Les quatre ensemble (sans les six abris solaires, environ 360 triangles) restent sous 3 000 triangles.
    expect(total).toBeLessThan(3000);
  });

  it("Jardinerie et But : rien ne dépasse de plus de 6 m le contour ni de 14 m en hauteur", () => {
    for (const id of ["BATIMENT0000000348847180", "BATIMENT0000000348852219"]) {
      const s = sinks();
      const b = bOf(id);
      // Sans les abris solaires, que la tuile range avec le magasin le plus proche.
      const k = kinds.buildings[id]!;
      buildStore(s, b, { ...k, store: { ...k.store!, carports: [] } }, world.terrain, wall);
      const xs = b.ring.filter((_, i) => i % 2 === 0), ys = b.ring.filter((_, i) => i % 2 === 1);
      const p = s.solid.positions;
      for (let i = 0; i < p.length; i += 3) {
        expect(p[i]!).toBeGreaterThan(Math.min(...xs) - 6);
        expect(p[i]!).toBeLessThan(Math.max(...xs) + 6);
        expect(-p[i + 2]!).toBeGreaterThan(Math.min(...ys) - 6);
        expect(-p[i + 2]!).toBeLessThan(Math.max(...ys) + 6);
        expect(p[i + 1]! - b.ground).toBeLessThan(14);
      }
    }
  });

  it("galeries de Bellevue, GiFi, Action (D145) : sommets finis, enseignes, vitrages allumés, coût borné", () => {
    const S1 = "BATIMENT0000002222388078", S2A = "BATIMENT0000002222388083", S2B = "BATIMENT0000002479786224", WING = "BATIMENT0000EXTRA0145";
    const GIFI = "BATIMENT0000000357310923", ACT = "BATIMENT0000000348857700";
    const want: [string, string[], number, number][] = [
      [S1, ["INTERSPORT", "GÉMO", "SCHMIDT", "OPTICAL CENTER", "Comme j'aime"], 500, 4500],
      [S2A, ["STOKOMANI", "MAISON de la LITERIE"], 250, 2500],
      [S2B, ["MAXI ZOO"], 100, 1500],
      [WING, ["CENTRAKOR"], 100, 1200],
      [GIFI, ["GiFi"], 100, 800],
      [ACT, ["ACTION"], 100, 800],
    ];
    let total = 0;
    for (const [id, labels, lo, hi] of want) {
      names.length = 0;
      const s = sinks();
      buildStore(s, bOf(id), kinds.buildings[id]!, world.terrain, wall);
      expect(finite(s)).toBe(true);
      expect(tris(s.glow)).toBeGreaterThan(8);
      for (const l of labels) expect(names).toContain(l);
      expect(tris(s.solid)).toBeGreaterThan(lo);
      expect(tris(s.solid)).toBeLessThan(hi);
      total += tris(s.solid) + tris(s.glow);
    }
    // Toute la zone (deux galeries, aile, GiFi, Action, deux aires de jeux) reste sous 9 000 triangles.
    expect(total).toBeLessThan(9000);
  });

  it("galeries : rien ne dépasse de plus de 5 m le contour (sauf les aires de jeux), ni de 10 m en hauteur ; l'auvent est plus haut que le toit", () => {
    for (const id of ["BATIMENT0000002222388078", "BATIMENT0000002479786224", "BATIMENT0000EXTRA0145"]) {
      const s = sinks();
      const b = bOf(id), k = kinds.buildings[id]!;
      buildStore(s, b, { ...k, store: { ...k.store!, play: [] } }, world.terrain, wall);
      const xs = b.ring.filter((_, i) => i % 2 === 0), ys = b.ring.filter((_, i) => i % 2 === 1);
      const p = s.solid.positions;
      let top = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        expect(p[i]!).toBeGreaterThan(Math.min(...xs) - 5);
        expect(p[i]!).toBeLessThan(Math.max(...xs) + 5);
        expect(-p[i + 2]!).toBeGreaterThan(Math.min(...ys) - 5);
        expect(-p[i + 2]!).toBeLessThan(Math.max(...ys) + 5);
        top = Math.max(top, p[i + 1]! - b.ground);
      }
      expect(top).toBeGreaterThan(8);
      expect(top).toBeLessThan(10);
    }
  });

  it("Aubade, Comptoir des Fers, rotonde et Norauto (D146) : sommets finis, enseignes, vitrages allumés, coût borné", () => {
    const want: [string, string[], number, number][] = [
      ["BATIMENT0000EXTRA0146M", ["COMPTOIR DES FERS"], 10, 400],
      ["BATIMENT0000EXTRA0146F", ["Aubade"], 50, 600],
      ["BATIMENT0000EXTRA0146H", [], 20, 400],
      ["BATIMENT0000000348852221", ["ENTRÉE"], 20, 300],
      ["BATIMENT0000000348852206", ["Atelier", "Norauto"], 60, 1200],
    ];
    let total = 0;
    for (const [id, labels, lo, hi] of want) {
      names.length = 0;
      const s = sinks();
      buildStore(s, bOf(id), kinds.buildings[id]!, world.terrain, wall);
      expect(finite(s)).toBe(true);
      for (const l of labels) expect(names).toContain(l);
      expect(tris(s.solid)).toBeGreaterThan(lo);
      expect(tris(s.solid)).toBeLessThan(hi);
      total += tris(s.solid) + tris(s.glow);
    }
    expect(total).toBeLessThan(2500);
    const s = sinks();
    buildStore(s, bOf("BATIMENT0000000348852206"), kinds.buildings["BATIMENT0000000348852206"]!, world.terrain, wall);
    expect(tris(s.glow)).toBeGreaterThan(8);
  });
});
