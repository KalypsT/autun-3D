import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { loadRealWorld } from "./testing";
import { passagePoint } from "./landmarks";
import { insidePassage, PASSAGE_GATE, passageGateLines, passageGateOpen, syncPassageGate } from "./passage-gate";
import type { PassageSite } from "../data/types";

/** D190 : les grilles du passage Balthus, ouvertes de 7 h à 20 h. */
describe("grilles du passage Balthus (D190)", () => {
  it("ouvertes de 7 h à 20 h, fermées la nuit", () => {
    expect(passageGateOpen(6.99)).toBe(false);
    expect(passageGateOpen(7)).toBe(true);
    expect(passageGateOpen(12)).toBe(true);
    expect(passageGateOpen(19.99)).toBe(true);
    expect(passageGateOpen(20)).toBe(false);
    expect(passageGateOpen(23.5)).toBe(false);
    expect(passageGateOpen(31)).toBe(true);
  });

  it("l'axe et les niveaux sont ceux du site mesuré", () => {
    const site = loadRealWorld().tile.kinds!.sites.find((s): s is PassageSite => s.t === "passage")!;
    expect(PASSAGE_GATE.c).toEqual(site.c);
    expect(PASSAGE_GATE.a).toBeCloseTo(site.a, 4);
    expect(PASSAGE_GATE.L).toBeCloseTo(site.L, 1);
    expect(PASSAGE_GATE.hw).toBe(site.hw);
    expect(PASSAGE_GATE.floors[1]).toBeCloseTo(site.zc, 1);
    expect(PASSAGE_GATE.floors[0]).toBeCloseTo(site.zf + 0.08, 1);
    const [x, y] = passagePoint(site, 30, 0);
    expect(insidePassage(x, y)).toBe(true);
    const [ox, oy] = passagePoint(site, -5, 0);
    expect(insidePassage(ox, oy)).toBe(false);
  });

  it("fermées, elles barrent le couloir aux deux entrées ; ouvertes, on passe", () => {
    const site = loadRealWorld().tile.kinds!.sites.find((s): s is PassageSite => s.t === "passage")!;
    const c = new Colliders(), state: { closed: boolean | null } = { closed: null };
    expect(syncPassageGate(c, 23, state)).toBe(true);
    for (const d of PASSAGE_GATE.planes) {
      for (const t of [-2, 0, 2]) expect(c.resolve(...passagePoint(site, d, t), 0.3).hit, `à ${d} m, t = ${t}`).toBe(true);
    }
    expect(c.resolve(...passagePoint(site, 30, 0), 0.3).hit).toBe(false);
    expect(syncPassageGate(c, 23.5, state)).toBe(false);
    expect(syncPassageGate(c, 8, state)).toBe(true);
    for (const d of PASSAGE_GATE.planes) expect(c.resolve(...passagePoint(site, d, 0), 0.3).hit).toBe(false);
    expect(passageGateLines()).toHaveLength(2);
  });

  it("une grille ne se ferme pas sur qui est resté dans le couloir", () => {
    const c = new Colliders(), state: { closed: boolean | null } = { closed: null };
    syncPassageGate(c, 12, state);
    expect(state.closed).toBe(false);
    expect(syncPassageGate(c, 21, state, true)).toBe(false);
    expect(state.closed).toBe(false);
    expect(syncPassageGate(c, 21, state, false)).toBe(true);
    expect(state.closed).toBe(true);
  });
});
