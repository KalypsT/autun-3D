import { describe, expect, it } from "vitest";
import { clockText, newNoteId, noteLine, notesExport, notesText, parseNotes, type PlaceNote } from "./notes";

const note = (over: Partial<PlaceNote> = {}): PlaceNote => ({ id: "n1", time: 1, x: -12.4, y: 87.6, z: 3, heading: Math.PI / 2, hour: 16.5, day: 200, text: "Le pont n'existe pas ici", hasShot: true, ...over });

describe("notes de lieu", () => {
  it("l'heure du jeu s'écrit HH:MM", () => {
    expect(clockText(16.5)).toBe("16:30");
    expect(clockText(0.05)).toBe("00:03");
    expect(clockText(23.999)).toBe("23:59");
  });

  it("ligne et rapport texte", () => {
    expect(noteLine(note(), 0)).toBe("1. x -12, y 88, face au E, 16:30 : Le pont n'existe pas ici");
    expect(noteLine(note({ text: "  " }), 2)).toContain("(sans texte)");
    expect(notesText([note(), note({ id: "n2" })], "abc123").split("\n")).toHaveLength(3);
  });

  it("identifiants uniques même pour deux notes dans la même milliseconde", () => {
    const a = note({ id: newNoteId(5, []) });
    const b = note({ id: newNoteId(5, [a]) });
    expect(a.id).not.toBe(b.id);
  });

  it("l'export JSON joint les captures des notes qui en ont", () => {
    const e = notesExport([note(), note({ id: "n2", hasShot: false })], "abc123", new Map([["n1", "data:image/jpeg;base64,AAAA"]]), new Date("2026-10-27T10:00:00Z"));
    expect(e.format).toBe("autun3d-notes");
    expect(e.exportedAt).toBe("2026-10-27T10:00:00.000Z");
    expect(e.notes[0]!.screenshot).toBe("data:image/jpeg;base64,AAAA");
    expect("screenshot" in e.notes[1]!).toBe(false);
  });

  it("relecture : les entrées incomplètes sont écartées", () => {
    expect(parseNotes([note(), { id: "x" }, null, { ...note({ id: "y" }), x: "1" }])).toEqual([note()]);
    expect(parseNotes("n'importe quoi")).toEqual([]);
  });
});
