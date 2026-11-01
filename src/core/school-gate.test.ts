import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { PLAYER_RADIUS } from "./player";
import { GATE_LAYOUT, GATE_TAG, SCHOOL_GATE, gateCircles, gateFrame, gateLine, gateOpen, syncGate } from "./school-gate";
import { addTileColliders } from "./world";
import type { TileData, TileKinds, TileStructures } from "../data/types";

/** D174 : grille du collège du Vallon (lot 3 de docs/plans/college-vallon.md) : fermée en dehors des heures de classe. */
const MAIN = "BATIMENT0000000348848973";
const kinds = JSON.parse(readFileSync("public/data/kinds/28_39.json", "utf8")) as TileKinds;
const tile = JSON.parse(readFileSync("public/data/tiles/28_39.json", "utf8")) as TileData;
const structures = JSON.parse(readFileSync("public/data/structures/28_39.json", "utf8")) as TileStructures;
const deck = structures.decks.find((d) => d.w >= 5.5 && Math.hypot(d.p[0]! - 546.4, d.p[1]! - 1083.6) < 3)!;

const world = (): Colliders => {
  const c = new Colliders();
  addTileColliders(c, { buildings: tile.buildings, walls: tile.walls, furniture: tile.furniture, trees: tile.trees, kinds, structures });
  return c;
};
/** Chemin du milieu du pont jusqu'à l'esplanade, par la grille. */
const path = (): [number, number][] => {
  const f = gateFrame(), out: [number, number][] = [];
  const mid = f.pt(2.6, 0);
  for (let t = 8; t >= -4; t -= 0.25) out.push([mid[0] + SCHOOL_GATE.n[0] * t, mid[1] + SCHOOL_GATE.n[1] * t]);
  return out;
};
const blockedAt = (c: Colliders, p: [number, number]): boolean => {
  const r = c.resolve(p[0], p[1], PLAYER_RADIUS);
  return Math.hypot(r.x - p[0], r.y - p[1]) > 0.02;
};

describe("Grille du collège (D174) : horaires", () => {
  it("ouverte de 7 h 30 à 18 h, fermée la nuit et le matin tôt, quel que soit le tour de l'horloge", () => {
    expect(gateOpen(7.49)).toBe(false);
    expect(gateOpen(7.5)).toBe(true);
    expect(gateOpen(12)).toBe(true);
    expect(gateOpen(17.99)).toBe(true);
    expect(gateOpen(18)).toBe(false);
    expect(gateOpen(0)).toBe(false);
    expect(gateOpen(24 + 9)).toBe(true);
    expect(gateOpen(-6)).toBe(false);
  });
});

describe("Grille du collège (D174) : disposition", () => {
  it("les éléments se suivent sans trou ni recouvrement et remplissent la longueur de la grille", () => {
    const L = GATE_LAYOUT, parts = [L.endPost, L.leaf, L.midPost, L.wicket, L.pillar];
    expect(parts[0]![0]).toBe(0);
    for (let i = 0; i + 1 < parts.length; i++) expect(parts[i]![1]).toBeCloseTo(parts[i + 1]![0], 9);
    expect(parts[parts.length - 1]![1]).toBeCloseTo(SCHOOL_GATE.len, 9);
    expect(L.leaf[1] - L.leaf[0]).toBeGreaterThan(4.2);
    expect(L.wicket[1] - L.wicket[0]).toBeGreaterThan(1);
  });

  it("le modèle de kinds porte la même grille que la constante du jeu", () => {
    expect(kinds.buildings[MAIN]!.vallon!.gate).toEqual(SCHOOL_GATE);
  });

  it("la grille est à 1,5 m de l'axe du pont prolongé et perpendiculaire à lui à 8° près ; le pont fait au moins 5,5 m", () => {
    expect(deck).toBeDefined();
    // Le tracé du pont part de son extrémité nord-est (côté collège) : l'axe sortant du pont vers la grille va du deuxième point au premier.
    const p = deck.p;
    const end: [number, number] = [p[0]!, p[1]!], prev: [number, number] = [p[3]!, p[4]!];
    const d: [number, number] = [end[0] - prev[0], end[1] - prev[1]], dl = Math.hypot(...d);
    const f = gateFrame(), c = f.pt(SCHOOL_GATE.len / 2, 0);
    const along = ((c[0] - end[0]) * d[0] + (c[1] - end[1]) * d[1]) / dl;
    const across = Math.abs(((c[0] - end[0]) * -d[1] + (c[1] - end[1]) * d[0]) / dl);
    expect(across).toBeLessThan(1.5);
    expect(along).toBeGreaterThan(0);
    expect(along).toBeLessThan(3);
    const cos = Math.abs((f.u[0] * d[0] + f.u[1] * d[1]) / dl);
    expect(cos).toBeLessThan(Math.sin((8 * Math.PI) / 180));
    expect(deck.w).toBeGreaterThanOrEqual(5.5);
  });
});

describe("Grille du collège (D174) : obstacles", () => {
  it("le mur d'enceinte est coupé à la grille : plus aucun tracé ne passe entre ses extrémités, et l'enceinte garde sa hauteur de 1,8 m", () => {
    const pieces = tile.walls.filter((w) => w.id === 249352113 || w.id === 1249352113);
    expect(pieces).toHaveLength(2);
    for (const w of pieces) expect(w.height).toBe(1.8);
    const f = gateFrame();
    for (const w of pieces) {
      for (let i = 0; i + 3 < w.pts.length; i += 2) {
        for (let s = 0.7; s < SCHOOL_GATE.len - 0.7; s += 0.1) {
          const [gx, gy] = f.pt(s, 0);
          const ax = w.pts[i]!, ay = w.pts[i + 1]!, bx = w.pts[i + 2]!, by = w.pts[i + 3]!;
          const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / (dx * dx + dy * dy)));
          expect(Math.hypot(gx - ax - t * dx, gy - ay - t * dy)).toBeGreaterThan(0.3);
        }
      }
    }
  });

  it("ouverte, on passe du milieu du pont à l'esplanade sans rien toucher ; fermée, on est arrêté à la grille", () => {
    const c = world(), st = { closed: null as boolean | null };
    syncGate(c, 12, st);
    expect(path().filter((p) => blockedAt(c, p))).toEqual([]);
    syncGate(c, 22, st);
    expect(path().filter((p) => blockedAt(c, p)).length).toBeGreaterThan(0);
    // Le milieu du portail est bien sur le chemin.
    const stop = path().find((p) => blockedAt(c, p))!;
    const [s] = [((stop[0] - SCHOOL_GATE.o[0]) * gateFrame().u[0] + (stop[1] - SCHOOL_GATE.o[1]) * gateFrame().u[1])];
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(SCHOOL_GATE.len);
  });

  it("l'obstacle se pose et se retire d'un coup, sans doublon, et ne bouge que si l'état change", () => {
    const c = new Colliders(), st = { closed: null as boolean | null };
    expect(syncGate(c, 3, st)).toBe(true);
    expect(c.segments.length - 0).toBeGreaterThan(0);
    expect(syncGate(c, 4, st)).toBe(false);
    const closedCount = c.segments.length;
    expect(syncGate(c, 9, st)).toBe(true);
    expect(syncGate(c, 23, st)).toBe(true);
    expect(c.segments.length).toBe(closedCount);
    expect(GATE_TAG).toBe("school-gate");
    expect(gateLine()).toHaveLength(4);
  });

  it("poteaux, pilier et lampadaires sont hors du passage libre de 3 m du milieu du portail", () => {
    const f = gateFrame(), mid = (GATE_LAYOUT.leaf[0] + GATE_LAYOUT.leaf[1]) / 2;
    for (const [x, y, r] of gateCircles()) {
      const dx = x - f.pt(mid, 0)[0], dy = y - f.pt(mid, 0)[1];
      const s = dx * f.u[0] + dy * f.u[1];
      expect(Math.abs(s) - r, `cercle (${x}, ${y})`).toBeGreaterThan(1.5);
    }
  });

  it("le mobilier de l'entrée est dans l'obstacle des monuments de la tuile (poteaux, pilier, lampadaires)", () => {
    const c = world();
    let n = 0;
    for (const [x, y, r] of gateCircles()) if (c.circles.some((q) => Math.hypot(q.x - x, q.y - y) < 0.01 && Math.abs(q.r - r) < 0.01)) n++;
    expect(n).toBe(gateCircles().length);
  });
});
