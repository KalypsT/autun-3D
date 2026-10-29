import { describe, expect, it } from "vitest";
import { recipeFromSeed } from "../core/character";
import { LAYER, LAYER_COUNT, PART_SPECS, variantCode } from "../core/character-kit";
import { shapeGeometry } from "./character-parts";
import { atlasUv, encodePages, paintPages, REGIONS, SHAPE_REGION, TEXTURE_SIZE } from "./character-texture";

describe("texture peinte des personnages (D101)", () => {
  it("place les régions sur la feuille sans chevauchement", () => {
    const list = Object.entries(REGIONS);
    for (const [name, [x, y, w, h]] of list) {
      expect(x >= 0 && y >= 0 && x + w <= TEXTURE_SIZE && y + h <= TEXTURE_SIZE, name).toBe(true);
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, [ax, ay, aw, ah]] = list[i]!, [b, [bx, by, bw, bh]] = list[j]!;
        expect(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay, `${a} / ${b}`).toBe(true);
      }
    }
  });

  it("donne à chaque forme des uv dans sa région (ou sur le texel blanc)", () => {
    const bad: string[] = [];
    for (const spec of PART_SPECS) {
      const g = shapeGeometry(spec.shape, 0);
      if (!g) continue;
      const region = SHAPE_REGION[spec.shape];
      const [x, y, w, h] = REGIONS[region ?? "white"]!;
      const [wx, wy] = atlasUv(null, -1, -1);
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        const inside = u >= x / TEXTURE_SIZE && u <= (x + w) / TEXTURE_SIZE && v >= y / TEXTURE_SIZE && v <= (y + h) / TEXTURE_SIZE;
        const white = u === wx && v === wy;
        if (!inside && !white) {
          bad.push(`${spec.id}: ${u.toFixed(3)}, ${v.toFixed(3)}`);
          break;
        }
      }
      // Une pièce texturée lit bien sa région (pas seulement le blanc) : le torse, les jambes, la tête.
      if (region && spec.layer !== LAYER.none && !Array.from({ length: uv.count }, (_, i) => uv.getX(i)).some((u) => u !== wx)) bad.push(`${spec.id}: tout en blanc`);
    }
    expect(bad).toEqual([]);
  });

  it("peint une page par variante, de façon déterministe, sans valeur hors bornes ; le texel blanc reste neutre", () => {
    const a = encodePages(paintPages()), b = encodePages(paintPages());
    expect(a.length).toBe(TEXTURE_SIZE * TEXTURE_SIZE * 4 * LAYER_COUNT);
    let same = true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) same = false;
    expect(same).toBe(true);
    const [x, y, w, h] = REGIONS.white!;
    for (let p = 0; p < LAYER_COUNT; p++) {
      const i = (p * TEXTURE_SIZE * TEXTURE_SIZE + (y + h / 2) * TEXTURE_SIZE + x + w / 2) * 4;
      expect([a[i], a[i + 1], a[i + 2], a[i + 3]]).toEqual([128, 128, 128, 255]);
    }
    // Les pages diffèrent là où les vêtements diffèrent : le torse de la chemise (page 1) n'est pas celui du t-shirt (page 0).
    const [tx, ty, tw, th] = REGIONS.torso!;
    const torso = (p: number): number[] => {
      const out: number[] = [];
      for (let j = ty; j < ty + th; j++) for (let i = tx; i < tx + tw; i++) out.push(a[(p * TEXTURE_SIZE * TEXTURE_SIZE + j * TEXTURE_SIZE + i) * 4]!);
      return out;
    };
    expect(torso(1)).not.toEqual(torso(0));
  }, 30000);

  it("code les variantes d'une recette en un nombre que le nuanceur sait relire", () => {
    for (let s = 1; s <= 300; s++) {
      const r = recipeFromSeed(s);
      const code = variantCode(r);
      expect(Number.isInteger(code) && code < 2 ** 24).toBe(true);
      const top = code % 16, bottom = Math.floor(code / 16) % 16, shoes = Math.floor(code / 256) % 16, face = Math.floor(code / 4096);
      expect(Math.max(top, bottom, shoes, face)).toBeLessThan(LAYER_COUNT);
      expect(face).toBe((r.sex === "f" ? 1 : 0) + (r.age === "senior" ? 2 : 0));
    }
  });
});
