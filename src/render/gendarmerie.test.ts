import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { at, isOpen, walkableRoof, wallsOutsideMonuments } from "../core/landmarks";
import { gendarmerieFrame, gendarmerieLines, gendarmerieRings } from "../core/gendarmerie";
import { pointInRing } from "../core/collision";
import { buildColliders } from "../core/world";
import { GENDARMERIE } from "../core/police";
import { ARREST_SPAWN } from "../game/police";
import { buildGendarmerie } from "./gendarmerie";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import { replacesFacade, type LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";

const MAIN = "BATIMENT0000000348847377";
const HIDDEN = ["BATIMENT0000000348847376", "BATIMENT0000000348847409", "BATIMENT0000000348847410", "BATIMENT0000000348847411", "BATIMENT0000000348847375"];

const sinks = (texts: string[] = []): LandmarkSinks => {
  const atlas = { get: (t: string) => { texts.push(t); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
  return { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas };
};

describe("Gendarmerie de l'avenue André Frenaud (D238)", () => {
  const world = loadRealWorld();
  const kind = world.tile.kinds!.buildings[MAIN]!;
  const m = kind.gend!;
  const f = gendarmerieFrame(m);
  const ground = (s: number, t: number): number => world.terrain.heightAt(...at(f, s, t));
  /** Coordonnées (s, t) d'un point du monde dans le repère du bâtiment. */
  const st = (x: number, y: number): [number, number] => [(x - f.x) * f.ux + (y - f.y) * f.uy, (x - f.x) * f.vx + (y - f.y) * f.vy];

  it("volumes mesurés plausibles, bâtiments BD TOPO voisins masqués", () => {
    expect(m.blocks).toHaveLength(9);
    const h = (n: string): number => {
      const b = m.blocks.find((q) => q.n === n)!;
      return b.z - ground((b.r[0] + b.r[1]) / 2, (b.r[2] + b.r[3]) / 2);
    };
    // Corps à deux niveaux (photos), accueil et aile est à un niveau, annexe basse, logements à deux niveaux.
    expect(h("corps")).toBeGreaterThan(5.5);
    expect(h("corps")).toBeLessThan(7);
    for (const n of ["accueil", "aile-est"]) {
      expect(h(n)).toBeGreaterThan(2.6);
      expect(h(n)).toBeLessThan(3.8);
    }
    for (const n of ["garages", "ateliers", "local"]) expect(h(n)).toBeLessThan(4.5);
    for (const n of ["logements-ouest", "logements-est"]) expect(h(n)).toBeGreaterThan(5);
    for (const b of m.blocks) {
      expect(b.r[1] - b.r[0]).toBeGreaterThan(1);
      expect(b.r[3] - b.r[2]).toBeGreaterThan(1);
    }
    for (const id of HIDDEN) expect(isOpen(world.tile.kinds, id)).toBe(true);
    expect(replacesFacade(kind)).toBe(true);
    expect(walkableRoof(kind)).toBe(false);
  });

  it("obstacles : on n'entre dans aucun volume ; la clôture remplace les clôtures de parcelle et arrête", () => {
    const colliders = buildColliders(world.tile);
    // Depuis 3 m devant chaque volume (côté sud, ou nord s'il est mitoyen au sud), on bute avant son milieu.
    for (const b of m.blocks) {
      const sm = (b.r[0] + b.r[1]) / 2, mid = at(f, sm, (b.r[2] + b.r[3]) / 2);
      const out = at(f, sm, b.n === "corps" ? b.r[2] - 3 : b.n === "local" ? b.r[3] + 3 : b.r[2] - 3);
      expect(colliders.raycast(out[0], out[1], mid[0], mid[1]), b.n).not.toBeNull();
    }
    // Les clôtures de parcelle de même tracé ne sont plus ni dessinées ni obstacles.
    const kept = new Set(wallsOutsideMonuments(world.tile.kinds, world.tile.walls).map((w) => w.id));
    for (const id of m.site!.walls) expect(kept.has(id)).toBe(false);
    // On bute sur la clôture le long de l'avenue (s ≈ −5 m) et sur le portail fermé.
    for (const t of [-15, 12]) {
      const [x0, y0] = at(f, -6.5, t), [x1, y1] = at(f, -3.5, t);
      const segs = gendarmerieLines(m);
      const crosses = segs.some((pl) => {
        for (let i = 0; i + 3 < pl.length; i += 2) {
          const ax = pl[i]!, ay = pl[i + 1]!, bx = pl[i + 2]!, by = pl[i + 3]!;
          const d1 = (bx - ax) * (y0 - ay) - (by - ay) * (x0 - ax), d2 = (bx - ax) * (y1 - ay) - (by - ay) * (x1 - ax);
          const d3 = (x1 - x0) * (ay - y0) - (y1 - y0) * (ax - x0), d4 = (x1 - x0) * (by - y0) - (y1 - y0) * (bx - x0);
          if (d1 * d2 < 0 && d3 * d4 < 0) return true;
        }
        return false;
      });
      expect(crosses).toBe(true);
    }
    // Le pied du pylône et le mât sont des obstacles.
    const rings = gendarmerieRings(m);
    const [mx, my] = at(f, m.site!.mast[0], m.site!.mast[1]);
    expect(rings.some((r) => pointInRing(mx, my, r))).toBe(true);
  });

  it("reprise après arrestation devant le portail, hors de la clôture ; renforts depuis la cour", () => {
    const colliders = buildColliders(world.tile);
    const [s, t] = st(ARREST_SPAWN.x, ARREST_SPAWN.y);
    // Côté avenue de la clôture (s < −5,1 m), sur le trottoir (s ≈ −11 m), à hauteur du portail (t 8,9 à 15,5 m).
    expect(s).toBeLessThan(-5.5);
    expect(s).toBeGreaterThan(-11.5);
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(16);
    expect(colliders.resolve(ARREST_SPAWN.x, ARREST_SPAWN.y, 0.35).hit).toBe(false);
    // Tourné vers l'avenue (−s) : cap mesuré depuis le nord, dans le sens des aiguilles d'une montre.
    const dir = [Math.sin(ARREST_SPAWN.heading), Math.cos(ARREST_SPAWN.heading)] as const;
    expect(dir[0] * f.ux + dir[1] * f.uy).toBeLessThan(-0.95);
    // Le point des renforts est dans la cour : hors de tout volume, entre le bâtiment principal et l'annexe.
    const [gs, gt] = st(GENDARMERIE.x, GENDARMERIE.y);
    expect(gs).toBeGreaterThan(0);
    expect(gs).toBeLessThan(35);
    expect(gt).toBeGreaterThan(5);
    expect(gt).toBeLessThan(34);
    expect(colliders.resolve(GENDARMERIE.x, GENDARMERIE.y, 0.35).hit).toBe(false);
    expect(Math.hypot(ARREST_SPAWN.x - GENDARMERIE.x, ARREST_SPAWN.y - GENDARMERIE.y)).toBeLessThan(30);
  });

  it("géométrie finie et bornée, inscriptions demandées à l'atlas", () => {
    const texts: string[] = [];
    const sk = sinks(texts);
    buildGendarmerie(sk, m, world.terrain);
    const p = sk.solid.positions;
    expect(p.length).toBeGreaterThan(0);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      expect(Number.isFinite(p[i]!) && Number.isFinite(p[i + 1]!) && Number.isFinite(p[i + 2]!)).toBe(true);
      x0 = Math.min(x0, p[i]!); x1 = Math.max(x1, p[i]!);
      y0 = Math.min(y0, -p[i + 2]!); y1 = Math.max(y1, -p[i + 2]!);
      z1 = Math.max(z1, p[i + 1]!);
    }
    // Tout tient dans un carré de 140 m autour de la cour ; rien au-dessus du sommet du pylône.
    expect(x1 - x0).toBeLessThan(140);
    expect(y1 - y0).toBeLessThan(140);
    expect(z1).toBeLessThan(ground(m.site!.mast[0], m.site!.mast[1]) + m.site!.mast[2] + 3);
    expect(texts).toContain("GENDARMERIE NATIONALE");
    expect(texts).toContain("ACCUEIL");
    // Coût : quelques dizaines de milliers de triangles au plus (la clôture compte pour beaucoup).
    expect(p.length / 9).toBeLessThan(40000);
  });
});
