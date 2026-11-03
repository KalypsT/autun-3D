/** Toits praticables, lot 4 (D216) : vue et tirs en 3D entre la rue et les toits. */
import { describe, expect, it } from "vitest";
import { Colliders } from "./collision";
import { Gun, type ShootWorld } from "./gun";
import { Officers, type Suspect } from "./officers";
import { BODY_MID, POLICE_EYE, policeSees } from "./police";
import { withRoofs, type RoofPlane } from "./roofs";
import { flatTerrain } from "./testing";
import { Inventory, WEAPONS } from "./weapons";

const DT = 1 / 60;
const ground = (): number => 0;

function plane(x0: number, y0: number, x1: number, y1: number, a: number, b: number, c: number): RoofPlane {
  return { a, b, c, ring: [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0], holes: [], x0, y0, x1, y1 };
}

/** Toit-terrasse de 10 × 10 m à 4 m (x de −5 à 5, y de 0 à 10). */
function flatHouse(): Colliders {
  const c = new Colliders();
  c.addRing([-5, 0, 5, 0, 5, 10, -5, 10], [4, 4, 4, 4]);
  c.roofs.add([plane(-5, 0, 5, 10, 0, 0, 4)]);
  return c;
}

/** Maison à deux pans (y de 0 à 20, faîtage en y = 10) : égout à 6 m, pente de 35°, faîtage à 13 m. */
function gableHouse(): Colliders {
  const c = new Colliders();
  const k = Math.tan((35 * Math.PI) / 180), ridge = 6 + 10 * k;
  c.addRing([-8, 0, 8, 0, 8, 10, 8, 20, -8, 20, -8, 10], [6, 6, ridge, 6, 6, ridge]);
  c.roofs.add([plane(-8, 0, 8, 10, 0, k, 6), plane(-8, 10, 8, 20, 0, -k, 6 + 20 * k)]);
  return c;
}

/** Ligne de vue d'un gendarme debout dans la rue en (x, y) vers les pieds du joueur en (px, py, pz). */
const sees = (c: Colliders, x: number, y: number, px: number, py: number, pz: number): boolean => c.sight(x, y, POLICE_EYE, px, py, pz + BODY_MID);

describe("ligne de vue entre la rue et un toit (D216)", () => {
  it("toit plat : on voit (et on est vu) au bord, pas au milieu, caché par le bord du toit", () => {
    const c = flatHouse();
    expect(sees(c, 0, -10, 0, 1, 4)).toBe(true);
    expect(sees(c, 0, -10, 0, 8, 4)).toBe(false);
    // De plus loin, le regard est plus rasant : on voit plus loin sur le toit (le milieu se voit à 40 m).
    expect(sees(c, 0, -40, 0, 8, 4)).toBe(true);
  });

  it("toit à deux pans : on voit le pan tourné vers soi, pas celui de derrière le faîtage", () => {
    const c = gableHouse();
    const k = Math.tan((35 * Math.PI) / 180);
    expect(sees(c, 0, -10, 0, 3, 6 + 3 * k)).toBe(true);
    expect(sees(c, 0, -10, 0, 13, 6 + 7 * k)).toBe(false);
  });

  it("au sol de part et d'autre d'une maison, les murs cachent toujours", () => {
    const c = flatHouse();
    expect(sees(c, 0, -10, 0, 20, 0)).toBe(false);
  });

  it("policeSees : avec les altitudes, en 3D ; sans, les murs restent infinis (comme avant)", () => {
    const c = flatHouse();
    const units = [{ x: 0, y: -10, heading: 0, chasing: true }];
    expect(policeSees(units, 0, 1, c, 4, ground)).toBe(true);
    expect(policeSees(units, 0, 8, c, 4, ground)).toBe(false);
    expect(policeSees(units, 0, 1, c)).toBe(false);
  });
});

describe("gendarmes armés et toits (D216)", () => {
  /** Coups de feu tirés en `seconds` par un gendarme armé posté dans la rue en (0, −10), vers le joueur immobile sur le toit en (x, y). */
  const shotsAt = (x: number, y: number, seconds: number): number => {
    const c = flatHouse();
    const o = new Officers(c, ground);
    o.spawn(0, -10, 0, 1, 42);
    const p: Suspect = { x, y, vx: 0, vy: 0, vehicle: null, z: 4 };
    let shots = 0;
    for (let t = 0; t < seconds; t += DT) {
      o.step(DT, p, () => ({ x: -30, y: -30 }), true);
      shots += o.shots.length;
      o.clearShots();
    }
    return shots;
  };

  it("tirent sur le joueur au bord du toit, pas sur celui qui se tient au milieu", () => {
    expect(shotsAt(0, 1, 6)).toBeGreaterThan(0);
    expect(shotsAt(0, 8, 6)).toBe(0);
  });
});

describe("tirs du joueur depuis un toit (D216)", () => {
  /** Monde de tir : le toit-terrasse, une cible debout dans la rue en (tx, ty). */
  const shootWorld = (c: Colliders, tx: number, ty: number): ShootWorld & { hits: number } => {
    const surface = withRoofs(flatTerrain(), c.roofs);
    const w = {
      hits: 0,
      pick(_x: number, _y: number, _heading: number, _range: number, _half: number, _max: number, out: number[]) {
        out.length = 0;
        out.push(0);
        return 1;
      },
      position: (_slot: number, out: { x: number; y: number }) => Object.assign(out, { x: tx, y: ty }),
      span: (_slot: number, out: { z: number; h: number }) => Object.assign(out, { z: 0, h: 1.75 }),
      hurt() {
        w.hits++;
        return 1;
      },
      rayPed(x: number, y: number, dx: number, dy: number, maxDist: number, out: { slot: number; dist: number }) {
        const rx = tx - x, ry = ty - y, along = rx * dx + ry * dy, side2 = rx * rx + ry * ry - along * along;
        out.slot = -1;
        out.dist = maxDist;
        if (along < 0 || side2 > 0.16) return false;
        const d = along - Math.sqrt(0.16 - side2);
        if (d < 0 || d > maxDist) return false;
        out.slot = 0;
        out.dist = d;
        return true;
      },
      wall: (ax: number, ay: number, bx: number, by: number, az?: number, bz?: number) => c.raycast(ax, ay, bx, by, true, az, bz),
      ground: (x: number, y: number, z: number) => surface.heightAt(x, y, z),
    };
    return w;
  };

  /** Le joueur sur le toit en (x, y), tourné vers le sud, tire à la hanche une balle de pistolet (visée assistée vers la cible). */
  const fire = (x: number, y: number, tx: number, ty: number, zFeet: number | null): number => {
    const w = shootWorld(flatHouse(), tx, ty);
    const inv = new Inventory();
    inv.grant("pistol", 12);
    inv.select("pistol");
    const g = new Gun(3);
    g.step(DT, true, false, WEAPONS.pistol, inv, x, y, Math.PI, w, zFeet === null ? null : { z: zFeet, aim: null });
    return w.hits;
  };

  it("du bord du toit, on touche quelqu'un dans la rue ; les murs du bâtiment sous ses pieds n'arrêtent plus la balle", () => {
    expect(fire(0, 1.5, 0, -10, 4)).toBe(1);
    // Avant D216 (tir sans hauteurs), le mur du bâtiment sous les pieds l'arrêtait.
    expect(fire(0, 1.5, 0, -10, null)).toBe(0);
  });

  it("du milieu du toit, une cible au pied du bâtiment est cachée par le bord du toit", () => {
    expect(fire(0, 8, 0, -3, 4)).toBe(0);
  });
});
