import { describe, expect, it } from "vitest";
import { Colliders, pointInRing, WALL_STEP } from "./collision";
import { reshapeBuilding, walkableRoof } from "./landmarks";
import { ROOF_STEP, Roofs, roofPlanes, withRoofs, type RoofPlane } from "./roofs";
import { flatTerrain, loadRealWorld } from "./testing";
import { buildColliders } from "./world";

/** Pan rectangulaire (x0..x1, y0..y1) du plan z = a·x + b·y + c, avec des trous éventuels. */
function plane(x0: number, y0: number, x1: number, y1: number, a: number, b: number, c: number, holes: number[][] = []): RoofPlane {
  return { a, b, c, ring: [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0], holes, x0, y0, x1, y1 };
}

/** Maison de 10 × 8 m : égout à 6 m sur les longs pans (y = 0 et y = 8), faîtage à 8,8 m en y = 4 (35°). */
const slope = Math.tan((35 * Math.PI) / 180);
const south = plane(0, 0, 10, 4, 0, slope, 6);
const north = plane(0, 4, 10, 8, 0, -slope, 6 + 8 * slope);

describe("Roofs : pans de toit", () => {
  const roofs = new Roofs();
  roofs.add([south, north]);

  it("rend l'altitude du pan sous le point, celle du relief ailleurs", () => {
    expect(roofs.surface(5, 1, 0)).toBeCloseTo(6 + slope);
    expect(roofs.surface(5, 7, 0)).toBeCloseTo(6 + slope);
    expect(roofs.surface(5, 4, 0)).toBeCloseTo(6 + 4 * slope);
    expect(roofs.surface(-1, 4, 0.5)).toBe(0.5);
    expect(roofs.surface(20, 20, 0.5)).toBe(0.5);
  });

  it("au pied du mur, qui est bien plus bas que le toit, reste dans la rue : comme pour un pont, l'altitude de qui demande départage", () => {
    expect(roofs.surface(5, 1, 0, 0)).toBe(0);
    expect(roofs.surface(5, 1, 0, 6.5)).toBeCloseTo(6 + slope);
    // Un essieu un peu plus haut sur le pan compte encore (jusqu'à ROOF_STEP au-dessus).
    expect(roofs.surface(5, 3, 0, 6 + 3 * slope - ROOF_STEP + 0.01)).toBeCloseTo(6 + 3 * slope);
    expect(roofs.surface(5, 3, 0, 6 + 3 * slope - ROOF_STEP - 0.01)).toBe(0);
  });

  it("une cour intérieure n'a pas de toit : on y tombe", () => {
    const r = new Roofs();
    r.add([plane(0, 0, 20, 20, 0, 0, 9, [[5, 5, 15, 5, 15, 15, 5, 15, 5, 5]])]);
    expect(r.surface(2, 2, 0)).toBe(9);
    expect(r.surface(10, 10, 0)).toBe(0);
  });

  it("deux toits l'un au-dessus de l'autre (redan) : le plus haut que l'on peut atteindre", () => {
    const r = new Roofs();
    r.add([plane(0, 0, 10, 10, 0, 0, 6), plane(0, 0, 4, 4, 0, 0, 9)]);
    expect(r.surface(2, 2, 0)).toBe(9);
    expect(r.surface(2, 2, 0, 6)).toBe(6);
    expect(r.surface(2, 2, 0, 9)).toBe(9);
  });

  it("se décharge avec sa tuile et réutilise les emplacements libérés", () => {
    const r = new Roofs();
    r.add([south], "a");
    r.add([north], "b");
    expect(r.size).toBe(2);
    r.removeTag("a");
    expect(r.size).toBe(1);
    expect(r.surface(5, 1, 0)).toBe(0);
    expect(r.surface(5, 7, 0)).toBeCloseTo(6 + slope);
    for (let i = 0; i < 50; i++) {
      r.add([south], "a");
      r.removeTag("a");
    }
    expect(r.size).toBe(1);
  });

  it("withRoofs : le relief avec les toits par-dessus, le relief nu inchangé", () => {
    const flat = flatTerrain();
    const c = new Colliders();
    c.roofs.add([south, north]);
    const t = withRoofs(flat, c.roofs);
    expect(t.heightAt(5, 1)).toBeCloseTo(6 + slope);
    expect(t.heightAt(5, 1, 0)).toBe(0);
    expect(t.heightAt(-5, 1)).toBe(0);
    expect((t.ground ?? t).heightAt(5, 1)).toBe(0);
    expect([t.xMin, t.xMax, t.yMin, t.yMax]).toEqual([flat.xMin, flat.xMax, flat.yMin, flat.yMax]);
  });

  it("Colliders.removeTag retire aussi les toits de la tuile", () => {
    const c = new Colliders();
    c.roofs.add([south], "t");
    c.removeTag("t");
    expect(c.roofs.size).toBe(0);
  });
});

describe("murs de bâtiment à hauteur (D214)", () => {
  // Pignon : le haut du mur monte de 6 m (A) à 8,8 m (B).
  const c = new Colliders();
  c.addSegment(0, 0, 0, 8, false, null, [6, 8.8]);

  it("sans l'altitude des pieds, le mur reste infini (circulation, passants, gendarmes : comme avant)", () => {
    expect(c.resolve(0.2, 4, 0.5, 100).hit).toBe(true);
  });

  it("des pieds plus hauts que le mur (à WALL_STEP près) passent, plus bas ils butent ; le haut suit le rampant", () => {
    expect(c.resolve(0.2, 1, 0.5, 0, 9).hit).toBe(false);
    expect(c.resolve(0.2, 0, 0.5, 0, 6 - WALL_STEP + 0.01).hit).toBe(false);
    expect(c.resolve(0.2, 0, 0.5, 0, 6 - WALL_STEP - 0.01).hit).toBe(true);
    // Au milieu, le haut est à 7,4 m.
    expect(c.resolve(0.2, 4, 0.5, 0, 7.4 - WALL_STEP + 0.01).hit).toBe(false);
    expect(c.resolve(0.2, 4, 0.5, 0, 7.4 - WALL_STEP - 0.01).hit).toBe(true);
    expect(c.resolve(0.2, 4, 0.5, 0, 0).hit).toBe(true);
  });

  it("les obstacles sans hauteur de bâtiment ne changent pas avec l'altitude des pieds", () => {
    const d = new Colliders();
    d.addRing([0, 0, 4, 0, 4, 4, 0, 4]);
    d.addPolyline([10, 0, 10, 4], true, { height: 1, climb: true });
    expect(d.resolve(-0.2, 2, 0.5, 0, 50).hit).toBe(true);
    expect(d.resolve(9.8, 2, 0.5, 0, 50).hit).toBe(true);
    expect(d.resolve(9.8, 2, 0.5, 1.2, 50).hit).toBe(false);
  });
});

describe("toits de la vraie ville", () => {
  const { tile, terrain } = loadRealWorld();
  const colliders = buildColliders(tile);
  const kinds = tile.kinds?.buildings ?? {};
  const walkable = tile.buildings.filter((b) => walkableRoof(kinds[b.id]) && !kinds[b.id]?.house);
  /** Un toit praticable couvre-t-il le centre de gravité des sommets de ce contour ? */
  const roofPlanesOver = (ring: number[]): boolean => {
    const n = ring.length / 2;
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      x += ring[2 * i]! / n;
      y += ring[2 * i + 1]! / n;
    }
    return colliders.roofs.planeAt(x, y) !== null;
  };

  it("presque tous les bâtiments ont un toit praticable ; les monuments gardent des murs infinis", () => {
    expect(walkable.length / tile.buildings.length).toBeGreaterThan(0.99);
    for (const [id, k] of Object.entries(kinds)) {
      if (!(k.cath || k.hall || k.k === "church" || k.house)) continue;
      const b = tile.buildings.find((x) => x.id === id);
      if (!b) continue;
      // Pas de toit au-dessus de leur emprise, et un mur infini sur chaque côté de leur contour (un voisin mitoyen y ajoute le sien, à
      // sa hauteur : le plus haut l'emporte). Cathédrale et maison d'après photo : contour de leur modèle, pas celui-ci.
      if (!k.cath && !k.house) {
        const n = b.ring.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ax = b.ring[2 * i]!, ay = b.ring[2 * i + 1]!, bx = b.ring[2 * j]!, by = b.ring[2 * j + 1]!;
          const on = (s: (typeof colliders.segments)[number]): boolean =>
            (Math.hypot(s.ax - ax, s.ay - ay) < 1e-6 && Math.hypot(s.bx - bx, s.by - by) < 1e-6) || (Math.hypot(s.ax - bx, s.ay - by) < 1e-6 && Math.hypot(s.bx - ax, s.by - ay) < 1e-6);
          if (Math.hypot(bx - ax, by - ay) > 1e-3) expect(colliders.segments.some((s) => on(s) && s.topA === undefined), id).toBe(true);
        }
      }
      expect(roofPlanesOver(b.ring), id).toBe(false);
    }
  });

  it("le toit couvre l'emprise (hors cours intérieures), et c'est celui que dessine le rendu", () => {
    let samples = 0, covered = 0, same = 0;
    for (const b0 of walkable.filter((_, i) => i % 7 === 0)) {
      const k = kinds[b0.id];
      const b = reshapeBuilding(b0, k?.k, k?.roof);
      const planes = roofPlanes(b);
      // Points intérieurs : milieu de chaque sommet et du centre de gravité des sommets.
      const n = b.ring.length / 2;
      let gx = 0, gy = 0;
      for (let i = 0; i < n; i++) {
        gx += b.ring[2 * i]! / n;
        gy += b.ring[2 * i + 1]! / n;
      }
      for (let i = 0; i < n; i++) {
        const x = (b.ring[2 * i]! + gx) / 2, y = (b.ring[2 * i + 1]! + gy) / 2;
        if (!pointInRing(x, y, b.ring) || b.holes.some((h) => pointInRing(x, y, h))) continue;
        samples++;
        const p = colliders.roofs.planeAt(x, y);
        if (!p) continue;
        covered++;
        if (planes.includes(p) || planes.some((q) => q.a === p.a && q.b === p.b && q.c === p.c)) same++;
      }
    }
    expect(samples).toBeGreaterThan(3000);
    expect(covered / samples).toBeGreaterThan(0.99);
    expect(same / covered).toBeGreaterThan(0.98);
  });

  it("au bord d'un toit, le pan part du haut du mur : on passe du toit au mur sans marche (sauf l'acrotère d'un toit plat)", () => {
    let edges = 0, ok = 0;
    for (const b0 of walkable.filter((_, i) => i % 5 === 0)) {
      const k = kinds[b0.id];
      const b = reshapeBuilding(b0, k?.k, k?.roof);
      const n = b.ring.length / 2;
      let A = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        A += b.ring[2 * i]! * b.ring[2 * j + 1]! - b.ring[2 * j]! * b.ring[2 * i + 1]!;
      }
      const sg = A > 0 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = b.ring[2 * i]!, ay = b.ring[2 * i + 1]!, bx = b.ring[2 * j]!, by = b.ring[2 * j + 1]!;
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 1) continue;
        // 20 cm à l'intérieur du milieu de l'arête.
        const x = (ax + bx) / 2 - (sg * (by - ay) / L) * 0.2, y = (ay + by) / 2 + (sg * (bx - ax) / L) * 0.2;
        const p = colliders.roofs.planeAt(x, y);
        if (!p) continue;
        edges++;
        const z = p.a * x + p.b * y + p.c, top = (b.top[i]! + b.top[j]!) / 2;
        if (z >= top - WALL_STEP || (b.roofKind === "flat" && z >= top - 1)) ok++;
      }
    }
    expect(edges).toBeGreaterThan(5000);
    expect(ok / edges).toBeGreaterThan(0.98);
  });

  it("les murs des bâtiments praticables ont leur hauteur, au-dessus du sol", () => {
    const walls = colliders.segments.filter((s) => s.topA !== undefined);
    expect(walls.length).toBeGreaterThan(40000);
    let above = 0;
    for (const s of walls.filter((_, i) => i % 50 === 0)) if (s.topA! - terrain.heightAt(s.ax, s.ay) > 2) above++;
    expect(above / Math.ceil(walls.length / 50)).toBeGreaterThan(0.97);
  });

  it("chercher le toit sous un point est bon marché (le véhicule le fait plusieurs fois par sous-pas)", () => {
    const t0 = performance.now();
    let s = 0;
    for (let i = 0; i < 200_000; i++) s += colliders.roofs.surface(-200 + (i % 400), -200 + (Math.floor(i / 400) % 400), 0, 10);
    expect(s).toBeGreaterThan(0);
    // Mesuré : environ 0,2 µs par appel ; borne large pour les machines lentes.
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
