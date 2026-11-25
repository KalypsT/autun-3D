import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MONUMENT_SITES, MONUMENTS_BONUS, monumentCollection, parseFiches } from "./monuments";
import { NavGraph } from "./nav-graph";
import { loadRealNav } from "./testing";
import { Notebook } from "./collections";

const md = readFileSync("docs/fiches-monuments.md", "utf8");

describe("chasse aux monuments (D320)", () => {
  it("chaque site a sa fiche dans le document relu : texte de 600 caractères au plus, sources, rien pour le relecteur", () => {
    const fiches = parseFiches(md);
    expect(fiches.size).toBe(20);
    for (const s of MONUMENT_SITES) {
      const f = fiches.get(s.id);
      expect(f, s.id).toBeDefined();
      expect(f!.text.length, s.id).toBeGreaterThan(150);
      expect(f!.text.length, s.id).toBeLessThanOrEqual(600);
      expect(f!.sources.length, s.id).toBeGreaterThan(10);
      expect(f!.text + f!.sources + f!.didYouKnow, s.id).not.toMatch(/vérifier|compléter|\*\*/i);
    }
    expect(new Set(MONUMENT_SITES.map((s) => s.id)).size).toBe(MONUMENT_SITES.length);
  });

  it("découpe : « Le savais-tu ? » à compléter devient vide, l'italique et le gras disparaissent", () => {
    const f = parseFiches("### Essai [essai]\n\nUn *texte*\nsur deux lignes.\n\n**Le savais-tu ?** *(à compléter)*\n\n**Sources** : Wikipédia, « Essai ». **À vérifier** : tout.\n\n---\n")
      .get("essai")!;
    expect(f).toEqual({ name: "Essai", text: "Un texte sur deux lignes.", didYouKnow: "", sources: "Wikipédia, « Essai »" });
  });

  it("douze grands et huit petits ; 14 600 € pour tout trouver", () => {
    const col = monumentCollection(parseFiches(md));
    expect(col.entries.filter((e) => e.reward === 600).length).toBe(12);
    expect(col.entries.filter((e) => e.reward === 300).length).toBe(8);
    expect(col.entries.reduce((a, e) => a + e.reward, 0) + MONUMENTS_BONUS).toBe(14600);
    expect(col.entries.find((e) => e.id === "arroux")!.name).toBe("Porte d'Arroux");
  });

  it("chaque zone touche le réseau des piétons ou des voitures, et on la découvre en marchant dessus", () => {
    const nav = new NavGraph();
    for (const c of loadRealNav().cells) nav.add(c);
    const bad: string[] = [];
    for (const s of MONUMENT_SITES) {
      const hit = nav.nearest(s.x, s.y, s.radius * 0.9);
      if (!hit) bad.push(s.id);
    }
    expect(bad).toEqual([]);
    const book = new Notebook([monumentCollection(parseFiches(md))]);
    const d = book.check(-269, 1060, 0, 2)!;
    expect(d.entry.id).toBe("arroux");
    expect(d.entry.fiche?.text).toMatch(/Auguste/);
  });
});
