import { describe, expect, it } from "vitest";
import { EVENT_KINDS, EventBook, parseEventBook } from "./book";

describe("carnet des faits divers (phase 4)", () => {
  it("compte les faits divers vus par sorte, les garde à l'enregistrement et les relit avec méfiance", () => {
    const b = new EventBook();
    b.record({ kind: "vol", outcome: "rendu", goodDeed: true, caught: true });
    b.record({ kind: "vol", outcome: "enfui", goodDeed: false, caught: false });
    b.record({ kind: "mariage", outcome: "cortege", goodDeed: false, caught: false });
    expect(b.seen).toEqual({ vol: 2, mariage: 1 });
    const again = new EventBook(parseEventBook(JSON.parse(JSON.stringify(b.toSave()))));
    expect(again.seen).toEqual({ vol: 2, mariage: 1 });
    // Valeurs absurdes, sortes inconnues : écartées ou bornées.
    const odd = parseEventBook({ counts: {}, tiers: {}, lines: [], seen: { vol: -4, feu: 2.6, inconnu: 9 } })!;
    expect(odd.seen).toEqual({ vol: 0, feu: 3 });
    // Une sauvegarde d'avant le lot 10 (sans `seen`) se relit.
    expect(new EventBook(parseEventBook({ counts: { voleurs: 1 }, tiers: {}, lines: [] })).seen).toEqual({});
    expect(EVENT_KINDS).toHaveLength(13);
  });

  it("un braqueur arrêté compte comme un voleur rattrapé, un fugitif arrêté comme un fugitif", () => {
    const b = new EventBook();
    b.record({ kind: "braquage", outcome: "rattrape", goodDeed: true, caught: true });
    b.record({ kind: "poursuite", outcome: "rattrape", goodDeed: true, caught: true });
    expect(b.counts.voleurs).toBe(1);
    expect(b.counts.fugitifs).toBe(1);
    expect(b.counts.bonnes).toBe(2);
  });
});
