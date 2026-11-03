import { describe, expect, it } from "vitest";
import { Decks } from "../core/decks";
import type { Deck, HeightField } from "../data/types";
import { finish } from "./geometry";
import { buildGroundSteps } from "./ground";

/** Pont de 40 m vers l'est, 8 m de large, tablier à 5 m, qui enjambe une voie entre 14 et 26 m ; relief plat à 0. */
const deck: Deck = { id: 1, k: "road", w: 8, p: [0, 0, 5, 20, 0, 5, 40, 0, 5], st: "beam", sp: [20], pc: [[0.4, 14], [26, 39.6]] };

function field(): HeightField {
  const decks = new Decks();
  decks.add("t", [deck]);
  const ground: HeightField = { heightAt: () => 0, xMin: -100, xMax: 100, yMin: -100, yMax: 100 };
  return {
    heightAt: (x, y, zHint) => decks.surface(x, y, 0, zHint),
    paveAt: (x, y) => decks.pave(x, y, 0),
    ground,
    xMin: -100, xMax: 100, yMin: -100, yMax: 100,
  };
}

/** Sommets (x, y du plan, altitude) d'un sol construit. */
function vertices(layers: Record<string, number[][][]>): [number, number, number][] {
  const mb = finish(buildGroundSteps(layers, [-100, -100, 100, 100], field()));
  const out: [number, number, number][] = [];
  for (let i = 0; i < mb.positions.length; i += 3) out.push([mb.positions[i]!, -mb.positions[i + 2]!, mb.positions[i + 1]!]);
  return out;
}

describe("sol des rues sous un pont (D93)", () => {
  // Route du haut, plus large que le tablier (1 m de chaque côté), et route du bas qui passe dessous.
  const upper = [[[-5, -5, 45, -5, 45, 5, -5, 5]]];
  const lower = [[[16, -20, 24, -20, 24, 20, 16, 20]]];
  const pts = vertices({ road_asphalt: [...upper, ...lower], walk: [[[17, -20, 18, -20, 18, 20, 17, 20]]] });

  it("chaque sommet est au niveau du relief ou du tablier, jamais entre les deux (pas de rampe ni de mur)", () => {
    expect(pts.length).toBeGreaterThan(0);
    for (const [, , z] of pts) expect(z < 0.6 || z > 4.9).toBe(true);
  });

  it("rien n'est posé au niveau du tablier au-dessus de la route du bas ; elle reste au relief de part et d'autre", () => {
    for (const [x, y, z] of pts) if (x > 14.5 && x < 25.5 && Math.abs(y) < 3.5) expect(z).toBeLessThan(0.6);
    expect(pts.some(([x, y, z]) => x > 16 && x < 24 && y > 5 && z < 0.6)).toBe(true);
    expect(pts.some(([x, y, z]) => x > 16 && x < 24 && y < -5 && z < 0.6)).toBe(true);
  });

  it("la route du haut suit le tablier hors du tronçon qui enjambe la voie", () => {
    expect(pts.some(([x, y, z]) => x > 2 && x < 12 && Math.abs(y) < 3 && z > 4.9)).toBe(true);
    expect(pts.some(([x, y, z]) => x > 28 && x < 38 && Math.abs(y) < 3 && z > 4.9)).toBe(true);
  });
});
