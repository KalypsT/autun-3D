/** Toits praticables, lot 2 (D215) : le véhicule du joueur survole les maisons, se pose sur les toits ; le joueur y marche. */
import { describe, expect, it } from "vitest";
import { Terrain } from "../data/terrain";
import type { HeightField, TerrainMeta } from "../data/types";
import { HEAD_HEIGHT, solveCamera } from "./camera-rig";
import { Colliders } from "./collision";
import { createPlayer, stepPlayer, type PlayerState } from "./player";
import { withRoofs, type RoofPlane } from "./roofs";
import { onDeck } from "./shore";
import { flatTerrain } from "./testing";
import { airborne, CAR, createVehicle, stepVehicle, type VehicleState } from "./vehicle";

const DT = 1 / 60;

/** Terrain dont l'altitude ne dépend que de y (profil nord-sud). */
function profileTerrain(z: (y: number) => number): Terrain {
  const meta = { cols: 200, rows: 200, res: 1, x0: -100, y0: -100, y1: 100, base: 0, unit: 0.01, zmin: -50, zmax: 50 } as TerrainMeta;
  const raw = new Float32Array(200 * 200);
  for (let r = 0; r < 200; r++) for (let c = 0; c < 200; c++) raw[r * 200 + c] = z(100 - r);
  return new Terrain(meta, raw);
}

function plane(x0: number, y0: number, x1: number, y1: number, a: number, b: number, c: number): RoofPlane {
  return { a, b, c, ring: [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0], holes: [], x0, y0, x1, y1 };
}

/** Bâtiment rectangulaire à toit plat à l'altitude `z` (murs à cette hauteur), ajouté aux obstacles et aux toits. */
function flatHouse(c: Colliders, x0: number, y0: number, x1: number, y1: number, z: number): void {
  c.addRing([x0, y0, x1, y0, x1, y1, x0, y1], [z, z, z, z]);
  c.roofs.add([plane(x0, y0, x1, y1, 0, 0, z)]);
}

/**
 * Maison à deux pans, faîtage selon x en y = (y0 + y1) / 2 : égout à `eave`, pente `deg`. Contour avec les nœuds de pignon, haut du mur
 * à chaque sommet.
 */
function gableHouse(c: Colliders, x0: number, y0: number, x1: number, y1: number, eave: number, deg: number): void {
  const k = Math.tan((deg * Math.PI) / 180), ym = (y0 + y1) / 2, ridge = eave + k * (ym - y0);
  c.addRing([x0, y0, x1, y0, x1, ym, x1, y1, x0, y1, x0, ym], [eave, eave, ridge, eave, eave, ridge]);
  c.roofs.add([plane(x0, y0, x1, ym, 0, k, eave - k * y0), plane(x0, ym, x1, y1, 0, -k, eave + k * y1)]);
}

/** Tremplin : 10 m de montée à 30 % (y de 0 à 10), puis le sol retombe à zéro. */
const ramp = profileTerrain((y) => (y > 0 && y < 10 ? 0.3 * y : 0));

/** Lance une voiture à `kmh` vers le nord depuis y = −40 et la suit pendant `frames` pas ; renvoie son état à chaque pas. */
function launch(terrain: HeightField, c: Colliders, kmh: number, frames: number, fly = true): VehicleState[] {
  const s = createVehicle(0, -40, 0, terrain);
  s.vy = kmh / 3.6;
  const out: VehicleState[] = [];
  for (let i = 0; i < frames; i++) {
    stepVehicle(s, CAR, { throttle: 0.5, brake: 0, steer: 0 }, DT, terrain, c, null, fly);
    out.push({ ...s });
  }
  return out;
}

describe("voiture du joueur et toits (D215)", () => {
  it("le cas constaté : après le tremplin, elle passe au-dessus d'une maison basse au lieu de rebondir en plein ciel", () => {
    // Maison de 10 × 8 m, 3 m de haut, juste derrière le tremplin (la voiture vole à 5 m et plus au-dessus du sol).
    const c = new Colliders();
    flatHouse(c, -5, 22, 5, 30, 3);
    const run = launch(withRoofs(ramp, c.roofs), c, 90, 200);
    // Jamais de recul, pas de choc contre le mur, et elle finit loin derrière la maison.
    expect(Math.min(...run.map((s) => s.vy))).toBeGreaterThan(15);
    expect(run.at(-1)!.y).toBeGreaterThan(35);
  });

  it("un immeuble plus haut que le vol l'arrête toujours", () => {
    const c = new Colliders();
    flatHouse(c, -5, 22, 5, 30, 15);
    const run = launch(withRoofs(ramp, c.roofs), c, 90, 200);
    expect(Math.min(...run.map((s) => s.vy))).toBeLessThan(0);
    expect(run.at(-1)!.y).toBeLessThan(22);
  });

  it("la circulation (sans vol) trouve toujours les murs infinis", () => {
    const c = new Colliders();
    flatHouse(c, -5, 22, 5, 30, 3);
    const s = createVehicle(0, 10, 0, flatTerrain());
    s.vy = 15;
    for (let i = 0; i < 120; i++) stepVehicle(s, CAR, { throttle: 0.5, brake: 0, steer: 0 }, DT, withRoofs(flatTerrain(), c.roofs), c, null, false);
    expect(s.y).toBeLessThan(22);
  });

  it("se pose sur un toit plat, y roule, puis tombe de son bord (sans se téléporter dans la rue)", () => {
    // Toit-terrasse de 60 m de long à 4 m, juste derrière le tremplin : la voiture s'y pose.
    const c = new Colliders();
    flatHouse(c, -10, 18, 10, 78, 4);
    const run = launch(withRoofs(ramp, c.roofs), c, 72, 420);
    const onRoof = run.filter((s) => s.y > 20 && s.y < 76 && !airborne(s));
    expect(onRoof.length).toBeGreaterThan(20);
    for (const s of onRoof) expect(s.z).toBeCloseTo(4, 1);
    // Au bord (y = 78), elle vole avant de retrouver la rue : des pas en l'air, une altitude qui descend progressivement.
    const after = run.filter((s) => s.y > 78);
    expect(after.length).toBeGreaterThan(0);
    const falling = after.filter((s) => airborne(s));
    expect(falling.length).toBeGreaterThan(10);
    expect(run.at(-1)!.z).toBeCloseTo(0, 1);
  });

  it("sur un pan à 35°, elle glisse vers le bas et tombe du toit ; sur un pan à 20°, elle tient", () => {
    for (const [deg, slides] of [[35, true], [20, false]] as const) {
      const c = new Colliders();
      gableHouse(c, -10, 0, 10, 20, 6, deg);
      const t = withRoofs(flatTerrain(), c.roofs);
      // Posée en travers du pan sud, à l'arrêt, nez vers l'est.
      const s = createVehicle(0, 6, Math.PI / 2, t);
      expect(s.z).toBeGreaterThan(6);
      let left = false;
      for (let i = 0; i < 600 && !left; i++) {
        stepVehicle(s, CAR, { throttle: 0, brake: 0, steer: 0 }, DT, t, c, null, true);
        if (s.y < 0) left = true;
      }
      expect(left, `${deg}°`).toBe(slides);
      if (!slides) expect(Math.abs(s.y - 6)).toBeLessThan(0.5);
    }
  });
});

describe("joueur sur les toits (D215)", () => {
  /** Fait marcher le joueur `seconds` secondes vers le nord (avant = nord quand la caméra regarde au nord). */
  const walk = (p: PlayerState, t: HeightField, c: Colliders, seconds: number, run = false): void => {
    for (let i = 0; i < seconds * 60; i++) stepPlayer(p, { forward: 1, right: 0, run }, 0, DT, t, c);
  };

  it("de la rue, le mur d'une maison reste un mur ; posé sur le toit, il y marche et tombe de son bord", () => {
    const c = new Colliders();
    flatHouse(c, -5, 0, 5, 10, 4);
    const t = withRoofs(flatTerrain(), c.roofs);
    const street = createPlayer(0, -3, flatTerrain());
    walk(street, t, c, 3);
    expect(street.y).toBeLessThan(0);
    expect(street.z).toBe(0);

    const p = createPlayer(0, 2, t);
    expect(p.z).toBe(4);
    let peak = 0, landed = 0;
    for (let i = 0; i < 4 * 60; i++) {
      stepPlayer(p, { forward: 1, right: 0, run: true }, 0, DT, t, c);
      if (p.y < 9.5) expect(p.z).toBe(4);
      peak = Math.max(peak, p.y);
      landed = Math.max(landed, p.landed);
    }
    expect(p.y).toBeGreaterThan(10.5);
    expect(p.z).toBe(0);
    // Chute de 4 m, comptée pour les dégâts.
    expect(landed).toBeGreaterThan(3.5);
    expect(peak).toBeGreaterThan(10);
  });

  it("passe d'un toit au toit voisin de même hauteur, bute contre un voisin plus haut", () => {
    for (const [z2, passes] of [[4, true], [6, false]] as const) {
      const c = new Colliders();
      flatHouse(c, -5, 0, 5, 10, 4);
      flatHouse(c, -5, 10, 5, 20, z2);
      const t = withRoofs(flatTerrain(), c.roofs);
      const p = createPlayer(0, 5, t);
      walk(p, t, c, 4);
      expect(p.y > 10, `voisin à ${z2} m`).toBe(passes);
      expect(p.z).toBe(passes ? z2 : 4);
    }
  });

  it("sur un pan à 35°, le joueur tient debout (seul le véhicule glisse)", () => {
    const c = new Colliders();
    gableHouse(c, -10, 0, 10, 20, 6, 35);
    const t = withRoofs(flatTerrain(), c.roofs);
    const p = createPlayer(0, 6, t);
    for (let i = 0; i < 120; i++) stepPlayer(p, { forward: 0, right: 0, run: false }, 0, DT, t, c);
    expect(p.y).toBeCloseTo(6, 3);
    expect(p.air).toBe(false);
  });
});

describe("surface avec les toits : ponts, caméra", () => {
  it("un toit n'est pas un tablier : on tombe de son bord", () => {
    const c = new Colliders();
    flatHouse(c, -5, 0, 5, 10, 4);
    const t = withRoofs(flatTerrain(), c.roofs);
    expect(onDeck(t, 0, 5, 4)).toBe(false);
  });

  it("sur un toit, la caméra recule derrière le joueur au lieu de buter sur les murs du bâtiment sous ses pieds", () => {
    const c = new Colliders();
    flatHouse(c, -10, 0, 10, 20, 6);
    const t = withRoofs(flatTerrain(), c.roofs);
    // Joueur au milieu du toit, regard au nord : la caméra est au sud, au-delà du mur sud (y = 0).
    const rig = solveCamera({ x: 0, y: 3, z: 6, yaw: 0, pitch: 0.3, distance: 6 }, c, t);
    expect(rig.distance).toBeGreaterThan(5.5);
    expect(rig.z).toBeGreaterThan(6 + HEAD_HEIGHT);
    // Dans la rue, au pied du même mur, la caméra bute toujours dessus.
    const low = solveCamera({ x: 0, y: 23, z: 0, yaw: 0, pitch: 0.1, distance: 6 }, c, t);
    expect(low.distance).toBeLessThan(3.5);
  });

  it("raycast avec altitudes : un rayon passe au-dessus d'un mur de bâtiment, pas à travers ; sans altitudes, le mur est infini", () => {
    const c = new Colliders();
    flatHouse(c, -5, 0, 5, 10, 4);
    expect(c.raycast(0, -5, 0, 5)).not.toBeNull();
    expect(c.raycast(0, -5, 0, 5, false, 5, 5)).toBeNull();
    expect(c.raycast(0, -5, 0, 5, false, 1, 1)).not.toBeNull();
    // Rayon qui monte : sous le mur à son entrée (y = 0, z = 3), il s'arrête.
    expect(c.raycast(0, -5, 0, 5, false, 0.5, 5.5)).not.toBeNull();
  });
});
