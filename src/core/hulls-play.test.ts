/** Bâtiments spéciaux et sites (D302) : plus de mur invisible au-dessus ; on se pose sur leur relevé ; dans la rue, rien ne change. */
import { describe, expect, it } from "vitest";
import { Colliders, WALL_STEP } from "./collision";
import { hullCell, hullPlane, makeHull, type Hull } from "./hulls";
import { withRoofs } from "./roofs";
import { loadRealWorld } from "./testing";
import { airborne, CAR, createVehicle, stepVehicle } from "./vehicle";
import { addTileColliders, solidShapes } from "./world";

const DT = 1 / 60;

describe("bâtiments spéciaux : murs à hauteur et toit (D302)", () => {
  const world = loadRealWorld();
  const c = new Colliders();
  addTileColliders(c, world.tile, null, world.terrain);
  const surface = withRoofs(world.terrain, c.roofs);
  const shapes = solidShapes(world.tile, (x, y) => world.terrain.heightAt(x, y));
  const hullOf = (key: string): Hull => {
    const shape = shapes.find((s) => s.key === key)!;
    return makeHull(world.tile.hulls!.find((h) => h.k === key)!, shape.outer, shape.holes);
  };
  const center = (h: Hull): [number, number] => [(h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2];
  const ground = (x: number, y: number): number => world.terrain.ground?.heightAt(x, y) ?? world.terrain.heightAt(x, y);
  const CATHEDRAL = "BATIMENT0000000348852451";

  it("chaque bâtiment spécial et chaque site a son relevé, et ses murs ont un haut", () => {
    expect(shapes.length).toBeGreaterThan(40);
    const keys = new Set(world.tile.hulls!.map((h) => h.k));
    for (const s of shapes) expect(keys.has(s.key), s.key).toBe(true);
  });

  it("une voiture qui vole au-dessus du kiosque passe ; à hauteur de ses murs, elle bute ; dans la rue, le piéton ne l'escalade pas", () => {
    const h = hullOf(shapes.find((s) => s.key.startsWith("site:bandstand"))!.key);
    const [cx, cy] = center(h);
    // Un rayon de 12 m autour du centre traverse tout le kiosque.
    let hitsLow = 0, hitsHigh = 0;
    for (let x = cx - 12; x <= cx + 12; x += 0.25) {
      if (c.resolve(x, cy, 1, h.top + 0.5 - ground(x, cy), h.top + 0.5).hit) hitsHigh++;
      if (c.resolve(x, cy, 1, 0, ground(x, cy) + 0.5).hit) hitsLow++;
    }
    expect(hitsHigh).toBe(0);
    expect(hitsLow).toBeGreaterThan(0);
    // Au pied, le mur arrête le piéton et ne s'escalade pas (D155 : on n'y monte pas), même bas.
    let wall = 0, stopped = 0;
    for (let x = cx - 12; x <= cx + 12; x += 0.25) {
      const r = c.resolve(x, cy, 0.35, 0, ground(x, cy));
      if (r.hit) stopped++;
      if (r.wall !== undefined && r.wall >= 0) wall++;
    }
    expect(stopped).toBeGreaterThan(0);
    expect(wall).toBe(0);
  });

  it("la voiture du joueur qui tombe sur un toit peu pentu de bâtiment spécial s'y pose, pas dans la rue ni dans le bâtiment", () => {
    // Le premier bâtiment spécial (dans l'ordre des données) qui a un tel endroit à plus de 4 m du sol.
    for (const shape of shapes) {
      if (shape.key.startsWith("site:")) continue;
      if (dropOn(hullOf(shape.key))) return;
    }
    throw new Error("aucun toit peu pentu");
  });

  /** Lâche la voiture au-dessus d'un endroit peu pentu du relevé ; false s'il n'y en a pas. */
  function dropOn(h: Hull): boolean {
    // Une case loin du bord, sur un pan peu pentu (moins de 20 %) : ses voisines sur 3 cases à moins de 0,6 m par case.
    let spot: [number, number, number] | null = null;
    const R = Math.ceil(5 / h.s);
    for (let j = R; j < h.ny - R && !spot; j++) {
      for (let i = R; i < h.nx - R && !spot; i++) {
        const z = hullCell(h, i, j);
        if (Number.isNaN(z)) continue;
        let flat = true;
        for (let dj = -R; dj <= R && flat; dj++) {
          for (let di = -R; di <= R && flat; di++) {
            flat = Math.abs(hullCell(h, i + di, j + dj) - z) <= 0.2 * Math.max(Math.abs(di), Math.abs(dj)) * h.s + 0.05 && hullPlane(h, h.x0 + (i + di + 0.5) * h.s, h.y0 + (j + dj + 0.5) * h.s) !== null;
          }
        }
        if (flat) spot = [h.x0 + (i + 0.5) * h.s, h.y0 + (j + 0.5) * h.s, z];
      }
    }
    if (!spot || spot[2] - ground(spot[0], spot[1]) < 4) return false;
    const [x, y, z] = spot;
    const s = createVehicle(x, y, 0, surface);
    s.z = z + 6;
    s.air = 1;
    // Sans toucher aux commandes (freiner à l'arrêt ferait reculer).
    for (let i = 0; i < 180; i++) stepVehicle(s, CAR, { throttle: 0, brake: 0, steer: 0 }, DT, surface, c, null, true);
    expect(airborne(s)).toBe(false);
    expect(s.z).toBeCloseTo(z, 0);
    expect(Math.hypot(s.x - x, s.y - y)).toBeLessThan(1);
    return true;
  }

  it("au-dessus de la cathédrale : plus haut que la flèche, rien ; plus haut que les clochers, seule la flèche arrête", () => {
    const h = hullOf(CATHEDRAL);
    // Entre le haut des clochers et la pointe de la flèche (40 m sous elle) : seules la flèche et sa base arrêtent (moins de 6 % des cases).
    const spire = h.top - 40;
    let cells = 0, blocked = 0, above = 0;
    for (let j = 0; j < h.ny; j++) {
      for (let i = 0; i < h.nx; i++) {
        const z = hullCell(h, i, j);
        if (Number.isNaN(z)) continue;
        const x = h.x0 + (i + 0.5) * h.s, y = h.y0 + (j + 0.5) * h.s;
        // En vol, la voiture donne aussi sa hauteur au-dessus du sol (`clear`) : les grilles du porche, basses, sont survolées.
        // (Le mobilier, sans hauteur, compte encore : une poubelle au pied de la façade ; seuls les murs nous intéressent ici.)
        const r = c.resolve(x, y, 1, h.top + 1 - ground(x, y), h.top + 1);
        if (r.hit && !r.soft) above++;
        cells++;
        const q = c.resolve(x, y, 1, spire - ground(x, y), spire);
        if (q.hit && !q.soft) blocked++;
      }
    }
    expect(above).toBe(0);
    expect(cells).toBeGreaterThan(2000);
    expect(blocked).toBeGreaterThan(0);
    expect(blocked / cells).toBeLessThan(0.06);
  });

  it("dans la rue, les murs des monuments restent pleins pour tous : passants et circulation (sans altitude), piéton au pied", () => {
    for (const s of shapes) {
      const ring = s.rings[0] ?? s.lines[0]!;
      const n = ring.length / 2;
      // Milieu du premier côté assez long, un peu dehors.
      for (let k = 0; k + 1 < n; k++) {
        const ax = ring[2 * k]!, ay = ring[2 * k + 1]!, bx = ring[2 * k + 2]!, by = ring[2 * k + 3]!;
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 2) continue;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        expect(c.resolve(mx, my, 0.3).hit, s.key).toBe(true);
        expect(c.resolve(mx, my, 0.3, 0, ground(mx, my) + WALL_STEP + 0.05).hit, s.key).toBe(true);
        break;
      }
    }
  });
});
