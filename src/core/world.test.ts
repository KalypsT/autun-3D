import { describe, expect, it } from "vitest";
import { pointInRing } from "./collision";
import { createPlayer, stepPlayer } from "./player";
import { loadRealWorld } from "./testing";
import { buildColliders } from "./world";

const { terrain, tile } = loadRealWorld();
const buildings = tile.buildings;
const colliders = buildColliders(tile);

// Les marches aléatoires restent à moins de 200 m de l'origine : inutile de tester contre les bâtiments de tout le monde.
const boxes = buildings.map((b) => {
  const xs = b.ring.filter((_, i) => i % 2 === 0), ys = b.ring.filter((_, i) => i % 2 === 1);
  return { b, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}).filter(({ x0, x1, y0, y1 }) => x1 > -250 && x0 < 250 && y1 > -250 && y0 < 250);

function insideBuilding(x: number, y: number): boolean {
  return boxes.some(({ b, x0, x1, y0, y1 }) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && pointInRing(x, y, b.ring) && !b.holes.some((h) => pointInRing(x, y, h)));
}

/** Générateur pseudo-aléatoire déterministe. */
function rand(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe("obstacles du monde", () => {
  it("contiennent les bâtiments, murs, mobilier et arbres", () => {
    expect(colliders.segments.length).toBeGreaterThan(3000);
    expect(colliders.circles.length).toBeGreaterThan(200);
  });

  it("empêchent d'entrer dans un bâtiment, même en courant droit dessus", () => {
    const r = rand(7);
    let walks = 0;
    for (let n = 0; n < 400 && walks < 120; n++) {
      const x = (r() - 0.5) * 300, y = (r() - 0.5) * 280;
      if (insideBuilding(x, y) || colliders.resolve(x, y, 0.35).hit) continue;
      walks++;
      const p = createPlayer(x, y, terrain);
      const yaw = r() * Math.PI * 2;
      for (let i = 0; i < 480; i++) {
        stepPlayer(p, { forward: 1, right: 0, run: true }, yaw + Math.sin(i / 90), 1 / 60, terrain, colliders);
        expect(insideBuilding(p.x, p.y), `entré dans un bâtiment en (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).toBe(false);
      }
    }
    expect(walks).toBeGreaterThan(60);
  }, 30_000);

  it("laisse libre le point de départ sur la place", () => {
    const hit = colliders.resolve(-10, -40, 0.35);
    expect(hit.hit).toBe(false);
    expect(insideBuilding(-10, -40)).toBe(false);
  });
});
