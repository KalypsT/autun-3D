import { describe, expect, it } from "vitest";
import { loadRealWorld } from "./testing";
import { Decks } from "./decks";
import { at, cathedralWalls, frameOf, porchDecks, porchLayout } from "./landmarks";

/** Le segment p-q coupe-t-il l'une des lignes ? */
function crosses(lines: number[][], p: [number, number], q: [number, number]): boolean {
  const side = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  for (const l of lines) {
    for (let i = 0; i + 3 < l.length; i += 2) {
      const [ax, ay, bx, by] = [l[i]!, l[i + 1]!, l[i + 2]!, l[i + 3]!];
      if (side(ax, ay, bx, by, ...p) !== side(ax, ay, bx, by, ...q) && side(...p, ...q, ax, ay) !== side(...p, ...q, bx, by)) return true;
    }
  }
  return false;
}

describe("porche de la cathédrale (D132)", () => {
  const world = loadRealWorld();
  const [id, kind] = Object.entries(world.tile.kinds!.buildings).find(([, k]) => k.cath)!;
  const m = kind.cath!;
  const b = world.tile.buildings.find((x) => x.id === id)!;
  const L = porchLayout(m);
  const f = frameOf(m.c[0], m.c[1], m.a, 1, 1);

  it("niveaux mesurés : parvis, palier, seuil", () => {
    expect(L.zP).toBeGreaterThan(L.zA);
    expect(L.zD - L.zA).toBeGreaterThan(2);
    expect(L.zD - L.zA).toBeLessThan(5);
  });

  it("on monte du parvis au seuil des portes par la volée", () => {
    const decks = new Decks();
    decks.add("t", porchDecks(m));
    const z = (s: number): number => decks.surface(...at(f, s, L.pc), -100);
    expect(z(L.p0 + 0.5)).toBeCloseTo(L.zP, 1);
    expect(z(L.n0 - 0.5)).toBeCloseTo(L.zD, 1);
    // Rampe régulière : pas de marche de plus de 20 cm entre deux points à 50 cm.
    for (let s = L.p0; s < L.n0; s += 0.5) expect(Math.abs(z(s + 0.5) - z(s))).toBeLessThan(0.2);
  });

  it("on entre dans le porche jusqu'aux portes, pas plus loin", () => {
    const { lines, grilles } = cathedralWalls(b, m);
    const all = [...lines, ...grilles];
    const parvis = at(f, L.sE - 1, L.pc);
    expect(crosses(all, parvis, at(f, L.n0 - 0.6, L.pc))).toBe(false);
    // Les portes sont fermées, la nef reste un obstacle ; les grilles barrent les côtés de la volée ; les tours sont pleines.
    expect(crosses(all, parvis, at(f, L.n0 + 3, L.pc))).toBe(true);
    expect(crosses(all, at(f, L.sR0 + 1, L.pc), at(f, L.sR0 + 1, L.iA + 0.5))).toBe(false);
    expect(crosses(all, at(f, L.sR0 + 1, L.iA + 0.5), at(f, L.p0 + L.TH + 0.07, L.iA + 0.5))).toBe(true);
    expect(crosses(all, parvis, at(f, L.p0 + 1, L.tE0 + 1))).toBe(true);
  });
});
