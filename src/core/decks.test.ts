import { describe, expect, it } from "vitest";
import type { Deck } from "../data/types";
import { DeckAxis, deckGaps, deckPiers, parapetLines, pierRings, spanDeck } from "./bridges";
import { Colliders } from "./collision";
import { Decks, STEP_UP } from "./decks";
import { createPlayer, stepPlayer } from "./player";
import { loadRealWorld } from "./testing";
import { buildColliders } from "./world";

/** Pont rectiligne de 40 m vers l'est, 8 m de large, tablier à 5 m (culées comprises), au-dessus d'un sol à 0. */
const deck: Deck = { id: 1, k: "road", w: 8, p: [0, 0, 5, 20, 0, 5, 40, 0, 5], st: "beam", sp: [20], pc: [[0.4, 39.6]] };

describe("tabliers de pont", () => {
  const decks = new Decks();
  decks.add("t", [deck]);

  it("la surface la plus haute sans indication d'altitude, le relief hors de l'emprise", () => {
    expect(decks.surface(10, 2, 0)).toBe(5);
    expect(decks.surface(10, 4.5, 0)).toBe(0);
    expect(decks.surface(-1, 0, 0)).toBe(0);
  });

  it("deux niveaux : on reste sous le pont qu'on longe, on monte sur celui qu'on aborde", () => {
    expect(decks.surface(10, 0, 0, 0)).toBe(0);
    expect(decks.surface(10, 0, 0, 5 - STEP_UP + 0.1)).toBe(5);
    expect(decks.surface(10, 0, 0, 5)).toBe(5);
  });

  it("un tablier porté par deux tuiles reste tant qu'une des deux est chargée", () => {
    const d = new Decks();
    d.add("a", [deck]);
    d.add("b", [deck]);
    d.remove("a");
    expect(d.surface(10, 0, 0)).toBe(5);
    d.remove("b");
    expect(d.empty).toBe(true);
    expect(d.surface(10, 0, 0)).toBe(0);
  });

  it("parapets des deux côtés, coupés là où le pont enjambe une voie", () => {
    const lines = parapetLines({ ...deck, pc: [[0.4, 14], [26, 39.6]] });
    expect(lines.length).toBe(4);
    for (const l of lines) for (let i = 1; i < l.length; i += 2) expect(Math.abs(Math.abs(l[i]!) - 4)).toBeLessThan(1e-9);
    expect(new DeckAxis(deck).length).toBeCloseTo(40);
  });
});

describe("sol des rues sous les ponts", () => {
  // Le même pont, qui enjambe une voie entre 14 et 26 m.
  const over: Deck = { ...deck, id: 2, pc: [[0.4, 14], [26, 39.6]] };
  const decks = new Decks();
  decks.add("t", [over]);

  it("tronçons au-dessus d'une voie : le complément des parapets", () => {
    expect(deckGaps(over, 40)).toEqual([[14, 26]]);
    expect(deckGaps(deck, 40)).toEqual([]);
    expect(deckGaps({ ...deck, pc: [] }, 40)).toEqual([[0.4, 39.6]]);
  });

  it("sur le tablier, le tablier ; dessous une voie, rien ; à côté, le relief", () => {
    expect(decks.pave(5, 1, 0)).toBe(5);
    expect(decks.pave(20, 1, 0)).toBeNaN();
    expect(decks.pave(20, 6, 0)).toBe(0);
    // Le jeu, lui, garde la surface la plus haute (on marche sur le pont).
    expect(decks.surface(20, 1, 0)).toBe(5);
  });

  it("une pile au milieu de la voie du bas est poussée au bord", () => {
    const piers = deckPiers({ ...over, sp: [10, 19, 30] }, 40, 0.6);
    expect(piers.length).toBe(3);
    expect(piers[0]).toBe(10);
    expect(piers[1]).toBeCloseTo(13.1);
    expect(piers[2]).toBe(30);
    // Plus de place avant le tronçon (pile à 10 m trop proche) : après.
    const crowded = deckPiers({ ...over, sp: [11, 20] }, 40, 0.6);
    expect(crowded[1]).toBeCloseTo(26.9);
  });
});

describe("piles et tabliers trop courts (D220)", () => {
  it("une pile arrête qui passe dessous, pas qui roule ou marche sur le tablier, ni qui ne donne pas son altitude", () => {
    const c = new Colliders();
    const piers = pierRings(deck, () => 0);
    expect(piers.length).toBe(1);
    c.addRing(piers[0]!.ring, [piers[0]!.top, piers[0]!.top, piers[0]!.top, piers[0]!.top], true);
    expect(c.resolve(20.8, 0, 0.3, 0, 0).hit).toBe(true);
    expect(c.resolve(20.8, 0, 0.3, 0, 5).hit).toBe(false);
    expect(c.resolve(20.8, 0, 0.3).hit).toBe(false);
    // Tirs : arrêtés sous le pont, pas au-dessus.
    expect(c.sight(15, 0, 1, 25, 0, 1)).toBe(false);
    expect(c.sight(15, 0, 6, 25, 0, 6)).toBe(true);
    // Pas de pile sous un tablier trop bas pour s'y tenir debout.
    expect(pierRings(deck, () => 3).length).toBe(0);
  });

  it("un tablier sans parapet plus court que la voie qu'il enjambe est prolongé à plat aux deux bouts", () => {
    const short: Deck = { id: 3, k: "rail", w: 5, p: [0, 0, 5, 6, 0, 6], st: "beam", sp: [], pc: [] };
    const long = new DeckAxis(spanDeck(short));
    expect(long.length).toBeCloseTo(13);
    expect(long.at(0).x).toBeCloseTo(-3.5);
    expect(long.at(0).z).toBe(5);
    expect(long.at(long.length).z).toBe(6);
    expect(spanDeck(deck)).toBe(deck);
  });
});

describe("ponts réels (public/data/structures)", () => {
  const { terrain, tile } = loadRealWorld();
  const decks = tile.structures!.decks;
  const andoche = decks.find((d) => d.n === "Pont Saint-Andoche")!;

  it("chaque tablier a une altitude définie, et le pont Saint-Andoche ne plonge plus", () => {
    for (const d of decks) expect(d.p.every(Number.isFinite)).toBe(true);
    const axis = new DeckAxis(andoche);
    let worst = 0;
    for (let s = 2; s < axis.length - 2; s += 2) {
      const a = axis.at(s);
      // Le relief nu creuse jusqu'à 4 m ; la surface reste à moins de 0,3 m du profil du tablier.
      worst = Math.max(worst, Math.abs(terrain.heightAt(a.x, a.y) - a.z));
    }
    expect(worst).toBeLessThan(0.3);
    const mid = axis.at(axis.length / 2);
    expect(mid.z - terrain.groundAt(mid.x, mid.y)).toBeGreaterThan(1);
  });

  it("on traverse le pont Saint-Andoche à pied sans à-coup ni chute", () => {
    const colliders = buildColliders(tile);
    const axis = new DeckAxis(andoche);
    const start = axis.at(1), end = axis.at(axis.length - 1);
    const p = createPlayer(start.x, start.y, terrain);
    const heading = Math.atan2(end.x - start.x, end.y - start.y);
    let maxJump = 0;
    for (let i = 0; i < 60 * 40 && Math.hypot(p.x - end.x, p.y - end.y) > 2; i++) {
      const z = p.z;
      stepPlayer(p, { forward: 1, right: 0, run: false }, heading, 1 / 60, terrain, colliders);
      maxJump = Math.max(maxJump, Math.abs(p.z - z));
    }
    expect(Math.hypot(p.x - end.x, p.y - end.y)).toBeLessThan(3);
    expect(maxJump).toBeLessThan(0.1);
  });
});
