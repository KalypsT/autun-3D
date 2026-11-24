import { describe, expect, it } from "vitest";
import { Notebook, parseNotebook, type CollectionDef } from "./collections";

const defs: CollectionDef[] = [
  { id: "monuments", label: "Monuments", bonus: 5000, entries: [
    { id: "a", name: "A", x: 0, y: 0, radius: 20, reward: 600 },
    { id: "b", name: "B", x: 100, y: 0, radius: 30, reward: 300 },
  ] },
  { id: "tresors", label: "Objets cachés", bonus: 5000, entries: [{ id: "t1", name: "T1", x: 50, y: 50, z: 12, radius: 1.2, reward: 150 }] },
];

describe("carnet de collections (D319)", () => {
  it("une entrée se découvre une fois, en entrant dans sa zone ; la dernière rapporte le bonus", () => {
    const n = new Notebook(defs);
    expect(n.check(25, 0, 0, 3)).toBeNull();
    const a = n.check(10, 5, 0, 3)!;
    expect(a.entry.id).toBe("a");
    expect(a.reward).toBe(600);
    expect(a.bonus).toBe(0);
    expect(n.check(10, 5, 0, 4)).toBeNull();
    expect(n.when("monuments", "a")).toBe(3);
    const b = n.check(120, 10, 0, 5)!;
    expect(b.bonus).toBe(5000);
    expect(n.count("monuments")).toBe(2);
  });

  it("un objet en hauteur ne se prend que depuis son toit", () => {
    const n = new Notebook(defs);
    expect(n.check(50, 50, 0, 1)).toBeNull();
    expect(n.check(50.5, 50, 11, 1)?.entry.id).toBe("t1");
  });

  it("sauvegarde : aller-retour ; entrées inconnues et valeurs absurdes écartées", () => {
    const n = new Notebook(defs);
    n.check(0, 0, 0, 7);
    const saved = parseNotebook(JSON.parse(JSON.stringify({ ...n.toSave(), "monuments:zz": 2, "tresors:t1": "x" })))!;
    const back = new Notebook(defs, saved);
    expect(back.has("monuments", "a")).toBe(true);
    expect(back.has("tresors", "t1")).toBe(false);
    expect(Object.keys(back.toSave())).toEqual(["monuments:a"]);
    expect(parseNotebook([1])).toBeNull();
    expect(parseNotebook("x")).toBeNull();
  });
});
