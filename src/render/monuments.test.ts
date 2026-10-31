import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadRealWorld } from "../core/testing";
import type { LodBuilding, Site, Tree } from "../data/types";
import { landmarkCircles, treesOutsideMonuments } from "../core/landmarks";
import { MeshBuilder } from "./geometry";
import { idKey } from "./style";
import { buildCathedral, buildCollege, buildFarTower, buildFountain, buildSaintLazare, buildTownHall } from "./monuments";
import { buildChapel, buildGate } from "./gates";
import { buildHouse } from "./house";
import { buildJanus } from "./janus";
import { buildRoundabout, buildRoundaboutGround } from "./roundabout";

describe("monuments (D95) : géométrie", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const tris = (mb: MeshBuilder): number => mb.positions.length / 9;

  it("portes et cathédrale : sommets finis, coût en triangles borné", () => {
    for (const s of kinds.sites) {
      if (s.t !== "gate") continue;
      const mb = new MeshBuilder();
      const glow = new MeshBuilder();
      buildGate(mb, glow, s, world.terrain);
      expect(mb.positions.every(Number.isFinite)).toBe(true);
      // D137 : moins de 4 000 triangles par porte (Arroux : 2 372), autant au plus pour l'éclairage de nuit, seulement si le modèle l'a.
      expect(tris(mb)).toBeLessThan(4000);
      expect(tris(glow)).toBe(s.gm?.light ? tris(mb) : 0);
    }
    // Église Saint-André (D138) : moins de 2 000 triangles.
    const chap = Object.values(kinds.buildings).find((b) => b.chap)!.chap!;
    const cb = new MeshBuilder();
    buildChapel(cb, null, chap, world.terrain);
    expect(cb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(cb)).toBeLessThan(2000);
    // Temple de Janus (D139) : moins de 6 000 triangles, à peine moins pour l'éclairage de nuit (les niches restent sombres).
    const temple = kinds.sites.find((q) => q.t === "janus")!;
    if (temple.t !== "janus") throw new Error("temple de Janus absent");
    const jb = new MeshBuilder(), jg = new MeshBuilder();
    buildJanus(jb, jg, temple, world.terrain);
    expect(jb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(jb)).toBeLessThan(6000);
    expect(tris(jg)).toBeGreaterThan(tris(jb) * 0.9);
    expect(tris(jg)).toBeLessThanOrEqual(tris(jb));
    // Maison du 7 allée de l'Acaron (D140) : moins de 4 000 triangles ; quelques vitres et les appliques allumées la nuit.
    const house = Object.values(kinds.buildings).find((b) => b.house)!.house!;
    const hb = new MeshBuilder(), hg = new MeshBuilder();
    buildHouse(hb, hg, house, world.terrain);
    expect(hb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(hb)).toBeLessThan(4000);
    expect(tris(hg)).toBeGreaterThan(4);
    expect(tris(hg)).toBeLessThan(200);
    // Îlot du rond-point de la Croix Verte (D142) : bordure, massif et cèdre, moins de 3 000 triangles ; sols à part.
    const island = kinds.sites.find((q) => q.t === "roundabout")!;
    if (island.t !== "roundabout") throw new Error("rond-point absent");
    const rb = new MeshBuilder(), rg = new MeshBuilder();
    buildRoundabout(rb, island, world.terrain);
    buildRoundaboutGround(rg, island, world.terrain);
    expect(rb.positions.every(Number.isFinite)).toBe(true);
    expect(rg.positions.every(Number.isFinite)).toBe(true);
    expect(tris(rb)).toBeLessThan(3000);
    const k = Object.values(kinds.buildings).find((b) => b.mon)!;
    const mb = new MeshBuilder();
    buildCathedral(mb, k.mon!, world.terrain, new THREE.Color("#405060"));
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(mb)).toBeLessThan(2000);
    const far = new MeshBuilder();
    buildFarTower(far, k.tower!, world.terrain);
    expect(tris(far)).toBeLessThan(100);
  });

  it("hôtel de ville (D123) : mesures plausibles, sommets finis, coût borné", () => {
    const m = Object.values(kinds.buildings).find((b) => b.hall)!.hall!;
    // Hauteurs au-dessus de la place : corniche ≈ 17 m, faîtage ≈ 22,5 m, pavillons d'angle ≈ 25 m, pavillon central ≈ 28 m, ailes plus basses.
    expect(m.eave - m.g).toBeGreaterThan(15);
    expect(m.eave - m.g).toBeLessThan(19);
    expect(m.ridge).toBeGreaterThan(m.eave + 3);
    expect(m.pav).toHaveLength(3);
    const [left, centre, right] = m.pav.map((p) => p[6]);
    expect(centre!).toBeGreaterThan(left! + 2);
    expect(centre!).toBeGreaterThan(right! + 2);
    expect(Math.min(left!, right!)).toBeGreaterThan(m.ridge);
    expect(m.wingEave).toBeLessThan(m.eave);
    expect(m.wingRidge).toBeLessThan(m.ridge);
    // Chaque plateau tient dans la base de son pavillon.
    for (const [s0, s1, ps0, ps1, pt0, pt1] of m.pav) {
      expect(ps0).toBeGreaterThanOrEqual(s0);
      expect(ps1).toBeLessThanOrEqual(s1);
      expect(pt0).toBeGreaterThan(0);
      expect(pt1).toBeLessThan(m.d);
    }
    // Portique et perron (D125) : palier au niveau du haut du soubassement, volée devant le portique, aussi large que l'avant-corps central ;
    // les marches (droite du palier au pied) restent au-dessus du relief, qui est la surface où l'on marche.
    const [tf, zTop] = m.portico!;
    const [ps0, ps1, tl, tfoot, zl] = m.perron!;
    expect(Math.abs(zl - (m.g + m.levels[0]))).toBeLessThan(0.6);
    expect(zTop - m.g).toBeGreaterThan(m.levels[1]);
    expect(tl).toBeLessThan(tf);
    expect(tfoot).toBeLessThan(tl - 5);
    expect(ps1 - ps0).toBeGreaterThan(0.8 * (m.pav[1]![1] - m.pav[1]![0]));
    const f = { c: Math.cos(m.a), s: Math.sin(m.a) };
    const xy = (s: number, t: number): [number, number] => [m.o[0] + f.c * s - f.s * t, m.o[1] + f.s * s + f.c * t];
    const zFoot = world.terrain.heightAt(...xy((ps0 + ps1) / 2, tfoot));
    for (let t = tfoot + 0.5; t < tl; t += 0.5) {
      for (const s of [ps0 + 0.5, (ps0 + ps1) / 2, ps1 - 0.5]) {
        const line = zFoot + ((t - tfoot) / (tl - tfoot)) * (zl - zFoot);
        expect(world.terrain.heightAt(...xy(s, t))).toBeLessThan(line + 0.2);
      }
    }
    // Toits (D126) : quatre lucarnes aux travées 2, 3, 7, 8, qui dépassent le pan avant ; lucarne-fronton au-dessus de la corniche, sous le
    // plateau central ; paratonnerre mesuré au-dessus du plateau central ; cheminée sur le corps principal, au-dessus de son toit.
    const p = m.l / m.bays;
    expect(m.dormers!.map(([s]) => Math.round(s / p - 0.5))).toEqual([2, 3, 7, 8]);
    for (const [, top] of m.dormers!) expect(top).toBeGreaterThan(m.eave + 2);
    expect(m.fronton!).toBeGreaterThan(m.eave + 4);
    expect(m.fronton!).toBeLessThan(m.pav[1]![6]);
    expect(m.tips![1]!).toBeGreaterThan(m.pav[1]![6] + 1);
    for (const [cs, ct, , top] of m.chim!) {
      expect(cs).toBeGreaterThan(0);
      expect(cs).toBeLessThan(m.l);
      expect(ct).toBeLessThan(m.d);
      expect(top).toBeGreaterThan(m.eave + ((m.ridge - m.eave) * Math.min(ct, m.d - ct)) / (m.d / 2));
    }
    const mb = new MeshBuilder(), glow = new MeshBuilder();
    buildTownHall(mb, glow, m, world.terrain, new THREE.Color("#2f4a63"));
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(mb)).toBeGreaterThan(500);
    expect(tris(mb)).toBeLessThan(8000);
    expect(tris(glow)).toBeGreaterThan(0);
  });

  it("cathédrale (D127) : volumes mesurés plausibles, sommets finis, coût borné, silhouette lointaine", () => {
    const [id, k] = Object.entries(kinds.buildings).find(([, b]) => b.cath)!;
    const m = k.cath!;
    const above = (z: number): number => z - m.g;
    // Au-dessus du sol du bâtiment : nef ≈ 19 / 30 m, transept plus bas que la nef, tour de croisée ≈ 40 m, flèche ≈ 86 m.
    expect(above(m.nave[4])).toBeGreaterThan(16);
    expect(above(m.nave[5])).toBeGreaterThan(27);
    expect(above(m.nave[5])).toBeLessThan(33);
    expect(m.transept[5]).toBeLessThan(m.nave[5]);
    expect(above(m.tower[2])).toBeGreaterThan(35);
    expect(above(m.tower[3])).toBeGreaterThan(80);
    // Porche au nord-ouest, croisée puis chœur vers le chevet ; bas-côtés plus bas que l'égout de la nef ; sept travées.
    expect(m.porch[0]).toBeLessThan(m.nave[0]);
    expect(m.nave[1]).toBeLessThan(m.tower[0]);
    expect(m.tower[0]).toBeLessThan(m.choir[0]);
    for (const a of m.aisles) expect(a[1]).toBeLessThan(m.nave[4]);
    expect(m.chapels).toHaveLength(7);
    expect(k.tower![3]).toBeCloseTo(m.tower[2], 1);
    // Tourelle du chevet (D128) : au coin du bloc et du chœur, plus haute que l'égout du bloc, plus basse que le transept.
    expect(m.turret[0]).toBeGreaterThan(m.transept[1] - 1);
    expect(m.turret[3]).toBeGreaterThan(m.block[1] + 5);
    expect(m.turret[3]).toBeLessThan(m.transept[5]);
    // Flèche (D129) : pied presque aussi large que la tour, clochetons au-dessus de la tour.
    expect(m.tower[4]).toBeGreaterThan(m.tower[1] * 0.3);
    expect(m.tower[4]).toBeLessThan(m.tower[1] * 0.55);
    expect(m.spire[0]).toBeGreaterThan(m.tower[2] + 3);
    const mb = new MeshBuilder(), lights = new MeshBuilder();
    buildSaintLazare(mb, lights, m, world.terrain);
    // Éclairage de nuit (D132) : murs et flèches doublés dans le maillage des vitres allumées.
    expect(tris(lights)).toBeGreaterThan(200);
    expect(tris(lights)).toBeLessThan(4000);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(mb)).toBeGreaterThan(500);
    expect(tris(mb)).toBeLessThan(8000);
    const lod = JSON.parse(readFileSync("public/data/lod/26_32.json", "utf8")) as LodBuilding[];
    const parts = lod.filter((e) => e.k === Math.round(idKey(id) * 4294967296));
    expect(parts).toHaveLength(12);
  });

  it("fontaine Saint-Lazare (D131) : mesures plausibles, mobilier remplacé, bassin dégagé et infranchissable, coût borné", () => {
    const k = JSON.parse(readFileSync("public/data/kinds/26_33.json", "utf8")) as { buildings: Record<string, never>; sites: Site[] };
    const f = k.sites.find((s): s is Extract<Site, { t: "fountain" }> => s.t === "fountain")!;
    expect(f.n).toBe("Fontaine Saint-Lazare");
    expect(f.id).toBe(2380355768);
    expect(f.top - f.g).toBeGreaterThan(6);
    expect(f.top - f.g).toBeLessThan(11);
    expect(f.rb).toBeGreaterThan(2);
    expect(f.rb).toBeLessThan(4);
    const trees: Tree[] = [[f.x + 0.5, f.y, 0, 0, 0, 0], [f.x + 20, f.y, 0, 0, 0, 0]];
    expect(treesOutsideMonuments(k, trees)).toHaveLength(1);
    expect(landmarkCircles(k, [])).toContainEqual([f.x, f.y, f.rb + 0.2]);
    const mb = new MeshBuilder();
    buildFountain(mb, f, world.terrain);
    expect(mb.positions.every(Number.isFinite)).toBe(true);
    expect(tris(mb)).toBeLessThan(3000);
  });

  it("hôtel de ville (D126) : silhouette lointaine en corps principal, pavillons et ailes", () => {
    const lod = JSON.parse(readFileSync("public/data/lod/26_35.json", "utf8")) as LodBuilding[];
    const id = Object.entries(kinds.buildings).find(([, b]) => b.hall)![0];
    const parts = lod.filter((e) => e.k === Math.round(idKey(id) * 4294967296));
    expect(parts).toHaveLength(5);
    expect(Math.max(...parts.map((e) => e.g))).toBeGreaterThan(Math.max(...parts.map((e) => e.e)) + 8);
  });
});

describe("Lycée Bonaparte : modèle `college` (D148)", () => {
  const world = loadRealWorld();
  const kinds = world.tile.kinds!;
  const tris = (mb: MeshBuilder): number => mb.positions.length / 9;
  const bOf = (id: string) => world.tile.buildings.find((b) => b.id === id)!;

  it("géométrie finie, toit au faîtage mesuré, coût en triangles borné", () => {
    let total = 0;
    for (const [id, ridge] of [["BATIMENT0000000348853321", 21.06], ["BATIMENT0000000348853307", 10.91]] as const) {
      const mb = new MeshBuilder(), glow = new MeshBuilder();
      buildCollege(mb, glow, kinds.buildings[id]!.college!, bOf(id).ring, world.terrain);
      expect(mb.positions.every(Number.isFinite)).toBe(true);
      // Dans le repère de rendu, z monte sur l'axe y : le point le plus haut est le faîtage.
      let top = -Infinity;
      for (let i = 1; i < mb.positions.length; i += 3) top = Math.max(top, mb.positions[i]!);
      expect(top).toBeGreaterThan(ridge - 0.2);
      expect(top).toBeLessThan(ridge + 0.2);
      expect(tris(glow)).toBeGreaterThan(0);
      total += tris(mb);
    }
    // Moins de 6 000 triangles pour tout le collège (murs, fenêtres, corniches, huit toits) : 2 536 mesurés.
    expect(total).toBeLessThan(6000);
  });
});
