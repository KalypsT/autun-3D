import { describe, expect, it } from "vitest";
import { loadRealWorld } from "./testing";
import { Decks } from "./decks";
import { buildColliders } from "./world";
import { HALL_PROJ, PERRON, REAR, hallDecks, hallPits, hallObstacles, hallXY, perronLayout, rearLayout, rearPoint } from "./townhall";

/** Le segment p-q coupe-t-il l'un des contours fermés ? */
function crosses(rings: number[][], p: [number, number], q: [number, number]): boolean {
  const side = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  for (const r of rings) {
    const l = [...r, r[0]!, r[1]!];
    for (let i = 0; i + 3 < l.length; i += 2) {
      const [ax, ay, bx, by] = [l[i]!, l[i + 1]!, l[i + 2]!, l[i + 3]!];
      if (side(ax, ay, bx, by, ...p) !== side(ax, ay, bx, by, ...q) && side(...p, ...q, ax, ay) !== side(...p, ...q, bx, by)) return true;
    }
  }
  return false;
}

describe("hôtel de ville : perron et entrée arrière (D293, D294)", () => {
  const world = loadRealWorld();
  const m = Object.values(world.tile.kinds!.buildings).find((k) => k.hall)!.hall!;
  const L = perronLayout(m)!;
  const sm = (L.s0 + L.s1) / 2;
  const ground = (s: number, t: number): number => world.terrain.heightAt(...hallXY(m, s, t));

  it("perron : marches régulières du pied mesuré au palier, cinq marches du bas évasées vers le bas, piédestaux hors de la volée", () => {
    expect(Math.abs(ground(sm, L.tfoot) - L.zFoot)).toBeLessThan(0.2);
    expect(L.rise).toBeGreaterThan(0.14);
    expect(L.rise).toBeLessThan(0.18);
    expect(L.steps.at(-1)!.z).toBeCloseTo(L.zl, 5);
    const flared = L.steps.filter((st) => st.e > 0);
    expect(flared).toHaveLength(PERRON.flare);
    for (let i = 1; i < flared.length; i++) expect(flared[i]!.e).toBeLessThan(flared[i - 1]!.e);
    // Les marches évasées dépassent les piédestaux et passent derrière eux.
    for (const [s0, s1, t0, t1] of L.pedestals) {
      expect(s1 <= L.s0 + 1e-9 || s0 >= L.s1 - 1e-9).toBe(true);
      expect(t0).toBeCloseTo(L.tWe, 5);
      expect(L.tBack).toBeGreaterThan(t1);
      expect(Math.min(...flared.map((st) => st.e))).toBeGreaterThan(PERRON.ped[0]);
    }
    // Le relief reste sous chaque marche (dessinée 5 cm au-dessus) : il ne la perce pas.
    for (const st of L.steps) {
      for (const s of [L.s0 + 0.3, sm, L.s1 - 0.3]) for (const t of [st.t + 0.05, st.t + L.run - 0.05]) expect(ground(s, t)).toBeLessThan(st.z + 0.05);
    }
  });

  it("on monte le perron jusqu'au palier par les tabliers, en pente régulière", () => {
    const decks = new Decks();
    decks.add("t", hallDecks(m));
    const z = (s: number, t: number): number => decks.surface(...hallXY(m, s, t), -100);
    for (const s of [sm, L.s0 + 0.5, L.s1 - 0.5]) {
      for (let t = L.tfoot; t < L.tl; t += 0.5) {
        // Pente de la volée (≈ 46 %), sans ressaut : au plus 5 cm de plus que la pente sur 50 cm.
        expect(Math.abs(z(s, t + 0.5) - z(s, t))).toBeLessThan((0.5 * L.rise) / L.run + 0.05);
        // Les pieds restent à moins d'une demi-marche du dessus de la marche dessinée.
        const st = L.steps.find((q) => t >= q.t && t < q.t + L.run)!;
        expect(Math.abs(z(s, t) - (st.z + 0.05))).toBeLessThan(L.rise);
      }
    }
    expect(z(sm, -HALL_PROJ - 0.2)).toBeCloseTo(L.zl + 0.05, 1);
    // Les marches évasées se montent aussi sur les côtés, entre les piédestaux et la volée.
    expect(z(L.s0 - 1.1, L.tfoot + 0.3)).toBeGreaterThan(L.zFoot);
  });

  it("murs d'échiffre et piédestaux arrêtent le joueur ; la volée et les marches évasées restent libres", () => {
    const rings = hallObstacles(m).map((o) => o.ring);
    expect(crosses(rings, hallXY(m, sm, L.tfoot - 1), hallXY(m, sm, -HALL_PROJ - 0.2))).toBe(false);
    expect(crosses(rings, hallXY(m, L.s0 - 2.5, L.tfoot + 0.3), hallXY(m, L.s1 + 2.5, L.tfoot + 0.3))).toBe(false);
    // De la place, on n'entre pas sur la volée par-dessus le mur d'échiffre, ni à travers un piédestal.
    expect(crosses(rings, hallXY(m, L.s0 - 2, -3), hallXY(m, sm, -3))).toBe(true);
    expect(crosses(rings, hallXY(m, L.s0 - 0.5, L.tfoot - 1), hallXY(m, L.s0 - 0.5, L.tWe + 0.5))).toBe(true);
    // Les obstacles sont bien posés dans le monde : depuis la place, le mur d'échiffre arrête le joueur.
    const c = buildColliders(world.tile);
    const [x, y] = hallXY(m, L.s0 - 0.8, -3);
    expect(c.resolve(x, y, 0.3, 0).hit).toBe(false);
    const [ix, iy] = hallXY(m, L.s0 - 0.2, -3);
    const out = c.resolve(ix, iy, 0.3, 0);
    expect(out.hit).toBe(true);
    expect(Math.hypot(out.x - ix, out.y - iy)).toBeGreaterThan(0.05);
  });

  it("creux d'affichage : le talus du relevé sous le perron et à côté des murs d'échiffre est plafonné au niveau de la place", () => {
    const [pit] = hallPits(m);
    expect(pit).toBeDefined();
    // À côté du mur d'échiffre, au pied et sous le palier : plafonné ; ailleurs sur la place, rien.
    for (const [s, t] of [[L.s0 - 1, -3], [sm, L.tfoot + 1], [sm, L.tl + 0.5], [L.s1 + 2, L.tfoot]] as const) expect(pit!.cap(...hallXY(m, s, t))).toBeCloseTo(m.g + 0.3, 5);
    expect(pit!.cap(...hallXY(m, sm, L.tfoot - 3))).toBe(Infinity);
    expect(pit!.cap(...hallXY(m, 2, -3))).toBe(Infinity);
    // Le dessous des marches et des murs (dessinés jusqu'à 30 cm sous le pied) reste sous le plafond.
    expect(L.zFoot - 0.3).toBeLessThan(m.g + 0.3);
  });

  it("entrée arrière : porte au milieu de la façade, au niveau de la cour, volées jusqu'à la rue Jeannin", () => {
    const r = rearLayout(m);
    expect(r.len).toBeGreaterThan(40);
    // Mur arrière tourné vers +t (la rue), à l'opposé de la façade.
    expect(r.out[1]).toBeGreaterThan(0.99);
    // La rue est 2 m plus bas que la place, la cour à son niveau (relief).
    const street = ground(...rearPoint(r, r.u + REAR.half + r.steps * REAR.run + 0.5, REAR.depth + 1));
    expect(Math.abs(street - r.zStreet)).toBeLessThan(0.35);
    const H = m.court;
    const court = ground((H[0]! + H[4]!) / 2, (H[1]! + H[5]!) / 2);
    expect(Math.abs(court - r.zDoor)).toBeLessThan(0.4);
    expect(r.rise).toBeGreaterThan(0.15);
    expect(r.rise).toBeLessThan(0.19);
    // L'escalier arrière est un obstacle : on le contourne par la rue.
    const rings = hallObstacles(m).map((o) => o.ring);
    expect(crosses(rings, hallXY(m, ...rearPoint(r, r.u, REAR.depth + 2)), hallXY(m, ...rearPoint(r, r.u, REAR.depth - 0.5)))).toBe(true);
  });
});
