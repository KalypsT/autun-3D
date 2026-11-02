import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Devanture, FacadeFiche, TileData } from "../data/types";
import { buildDevanture } from "./devanture";
import { bareSpans } from "./facades";
import { MeshBuilder, UvMeshBuilder } from "./geometry";

/** D186 : images collées sur les murs (la fresque d'Autun, les colombages du Lutrin). */
const tile = (t: string): TileData => JSON.parse(readFileSync(`public/data/tiles/${t}.json`, "utf8")) as TileData;
const fiche = (t: TileData, id: string): FacadeFiche => t.fiches.find((f) => f.id === `BATIMENT0000000${id}`)!;
const frame = { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: -1 };
const withDecals = (): Devanture[] => {
  const out: Devanture[] = [];
  for (const [t, id] of [["26_33", "348853042"], ["26_35", "348854035"]] as const) {
    const f = fiche(tile(t), id);
    out.push(f.ground.devanture!, f.ground.corner!.devanture);
  }
  return out.filter((d) => d.modern?.decals?.length);
};

describe("images collées sur les murs (D186)", () => {
  it("chaque image référencée existe dans public/decals (PNG) et reste dans son mur", () => {
    const devs = withDecals();
    expect(devs).toHaveLength(3); // long pan et pignon du Lutrin, mur est de Chez Daddy
    for (const d of devs) {
      for (const dc of d.modern!.decals!) {
        const path = `public/decals/${dc.src}`;
        expect(existsSync(path), dc.src).toBe(true);
        expect(readFileSync(path).subarray(1, 4).toString(), dc.src).toBe("PNG");
        expect(dc.s[1]).toBeGreaterThan(dc.s[0]);
        expect(dc.z[1]).toBeGreaterThan(dc.z[0]);
      }
    }
  });

  it("le mur couvert n'a plus de fenêtres de la fiche sur le tronçon de l'image", () => {
    const lutrin = fiche(tile("26_33"), "348853042"), daddy = fiche(tile("26_35"), "348854035");
    expect(bareSpans(lutrin, 5)).toEqual([[0, 10]]);
    expect(bareSpans(lutrin, 4)).toEqual([[0, 11.29]]);
    expect(bareSpans(daddy, 3)).toEqual([[0, 11.49]]);
    expect(bareSpans(daddy, 2)).toEqual([]);
  });

  it("la devanture envoie un quadrilatère par image au maillage de son fichier, derrière les plaques", () => {
    for (const d of withDecals()) {
      const sinks = new Map<string, UvMeshBuilder>();
      const mb = new MeshBuilder();
      buildDevanture(mb, null, null, frame, d, "#ffffff", (src) => {
        let b = sinks.get(src);
        if (!b) sinks.set(src, (b = new UvMeshBuilder()));
        return b;
      });
      const n = d.modern!.decals!.length;
      expect([...sinks.values()].reduce((a, b) => a + b.triangleCount, 0)).toBe(2 * n);
      for (const b of sinks.values()) {
        expect(b.positions.every(Number.isFinite)).toBe(true);
        expect(b.uvs.every((u) => u >= 0 && u <= 1)).toBe(true);
      }
    }
  });

  it("sans récepteur d'images, la devanture se dessine quand même, et une image remplace la corniche", () => {
    const d = withDecals()[0]!;
    const mb = new MeshBuilder();
    buildDevanture(mb, null, null, frame, d, "#ffffff");
    expect(mb.positions.length).toBeGreaterThan(0);
    const rest = { ...d.modern! };
    delete rest.decals;
    const plain: Devanture = { ...d, modern: rest };
    const mb2 = new MeshBuilder();
    buildDevanture(mb2, null, null, frame, plain, "#ffffff");
    expect(mb2.positions.length).toBeGreaterThan(mb.positions.length); // soubassement et corniche en plus
  });
});
