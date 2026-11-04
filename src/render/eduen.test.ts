import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { at, drawsGenericRoof, EDUEN_CANOPY_H, eduenCanopy, eduenFrame, eduenHallOutline, eduenLines, eduenMasts, eduenRings, isOpen, walkableRoof } from "../core/landmarks";
import { pointInRing } from "../core/collision";
import { buildColliders } from "../core/world";
import { buildEduen } from "./eduen";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import { replacesFacade, type LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";

const ID = "BATIMENT0000000348847362";
const HIDDEN = ["BATIMENT0000000348847361", "BATIMENT0000000348847363", "BATIMENT0000000348847364", "BATIMENT0000000348847365"];

const area = (r: readonly number[]): number => {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += r[i]! * r[j + 1]! - r[j]! * r[i + 1]!;
  }
  return a / 2;
};

describe("parc des expositions l'Eduen (D231)", () => {
  const world = loadRealWorld();
  const kind = world.tile.kinds!.buildings[ID]!;
  const m = kind.edu!;
  const b = world.tile.buildings.find((q) => q.id === ID)!;

  it("volumes mesurés plausibles (photos et relevé)", () => {
    expect(m).toBeDefined();
    // Grande salle d'environ 55 × 39 m, acrotère vers 11 m, toit plat ; deux rangées de lanterneaux au milieu.
    expect(m.l).toBeGreaterThan(53);
    expect(m.l).toBeLessThan(58);
    expect(m.d).toBeGreaterThan(37);
    expect(m.d).toBeLessThan(41);
    expect(m.top - m.g).toBeGreaterThan(10);
    expect(m.top - m.g).toBeLessThan(12);
    expect(m.sky.length).toBeGreaterThan(8);
    for (const [s, t] of m.sky) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(m.l);
      expect(Math.abs(t - m.d / 2)).toBeLessThan(6);
    }
    // Trois blocs et un raccord côté route, trois blocs et l'auvent de l'entrée côté parking, tous plus bas que le hall courbe.
    const sw = m.blocks.filter((q) => q[3] <= 0), ne = m.blocks.filter((q) => q[2] >= m.d);
    expect(sw.length).toBe(4);
    expect(ne.length).toBe(4);
    expect(ne.filter((q) => q[4] - m.g < EDUEN_CANOPY_H).length).toBe(1);
    for (const q of m.blocks) {
      expect(q[4] - m.g).toBeGreaterThan(1.8);
      expect(q[4]).toBeLessThan(m.rot.roof);
      expect(Math.abs(q[3] - q[2])).toBeGreaterThan(3);
      expect(Math.abs(q[3] - q[2])).toBeLessThan(9);
    }
    // Hall courbe : toit vers 7,7 m, plus bas que la salle ; arc d'environ 54 m de rayon dont le centre est au-delà du parking ; annexe plus basse.
    expect(m.rot.roof - m.g).toBeGreaterThan(6.8);
    expect(m.rot.roof).toBeLessThan(m.top - 2);
    expect(m.rot.r).toBeGreaterThan(48);
    expect(m.rot.r).toBeLessThan(60);
    expect(m.rot.c[1]).toBeGreaterThan(m.d);
    expect(m.rot.ann[2]).toBeLessThan(m.rot.roof);
    expect(drawsGenericRoof(kind)).toBe(false);
    expect(walkableRoof(kind)).toBe(false);
    expect(replacesFacade(kind)).toBe(true);
    // Les bâtiments BD TOPO du hall courbe, de l'annexe et d'un bloc sont masqués.
    for (const id of HIDDEN) expect(isOpen(world.tile.kinds, id)).toBe(true);
  });

  it("obstacles : la salle, ses blocs et le hall courbe, à la place de l'emprise BD TOPO", () => {
    const rings = eduenRings(m);
    const hall = eduenHallOutline(m).length;
    expect(hall).toBeGreaterThan(8);
    // Sans les petits carrés des mâts (trois à drapeaux, un d'éclairage).
    const total = rings.slice(0, -4).reduce((a, r) => a + Math.abs(area(r)), 0);
    // L'emprise BD TOPO couvre la salle, les blocs et le hall jusqu'au mur ; les blocs BD TOPO masqués en plus.
    const bd = [ID, ...HIDDEN].map((id) => world.tile.buildings.find((q) => q.id === id)!).reduce((a, q) => a + Math.abs(area(q.ring)), 0);
    expect(Math.abs(total / bd - 1)).toBeLessThan(0.2);
    const f = eduenFrame(m);
    const mid = at(f, m.l / 2, m.d / 2);
    expect(pointInRing(mid[0], mid[1], b.ring)).toBe(true);
    // Le grand côté sur la route regarde le sud-ouest : la normale sortante (−t) pointe vers le sud-ouest.
    const [x0, y0] = at(f, 10, 0), [x1, y1] = at(f, 10, -1);
    expect(x1 - x0).toBeLessThan(-0.3);
    expect(y1 - y0).toBeLessThan(-0.3);
    const c = buildColliders({ ...world.tile, buildings: [b] });
    // On n'entre ni dans la salle depuis la route, ni dans le hall courbe depuis l'avenue ; on passe sous l'auvent de l'entrée.
    const out = at(f, 20, -12), inHall = at(f, 20, 10);
    expect(c.raycast(out[0], out[1], inHall[0], inHall[1])).not.toBeNull();
    const [cs, ct] = m.rot.c, ang = -0.4;
    const far = [cs + (m.rot.r + 6) * Math.cos(ang), ct + (m.rot.r + 6) * Math.sin(ang)] as const;
    const near = [cs + (m.rot.r - m.rot.ov - 4) * Math.cos(ang), ct + (m.rot.r - m.rot.ov - 4) * Math.sin(ang)] as const;
    const a = at(f, ...far), z = at(f, ...near);
    expect(c.raycast(a[0], a[1], z[0], z[1])).not.toBeNull();
    // Les mâts arrêtent les déplacements.
    const [ms, mt] = eduenMasts(m)[1]!, m0 = at(f, ms - 1, mt), m1 = at(f, ms + 1, mt);
    expect(c.raycast(m0[0], m0[1], m1[0], m1[1])).not.toBeNull();
    const ent = m.blocks.find((q) => q[4] - m.g < EDUEN_CANOPY_H)!;
    const e0 = at(f, ent[0] + 0.8, (ent[2] + ent[3]) / 2), e1 = at(f, ent[1] - 0.8, (ent[2] + ent[3]) / 2);
    expect(c.raycast(e0[0], e0[1], e1[0], e1[1])).toBeNull();
  });

  it("géométrie : sommets finis, près de l'emprise, coût borné, sous l'acrotère ; logo, entrée et affiches (D232)", () => {
    const texts: string[] = [];
    const atlas = { get: (t: string) => { texts.push(t); return { u0: 0, v0: 0, u1: 1, v1: 1 }; } } as unknown as SignAtlas;
    const sinks: LandmarkSinks = { solid: new MeshBuilder(), glow: new MeshBuilder(), names: new UvMeshBuilder(), atlas };
    buildEduen(sinks, m, world.terrain);
    const p = sinks.solid.positions;
    expect(p.every(Number.isFinite)).toBe(true);
    const tris = p.length / 9;
    expect(tris).toBeGreaterThan(3000);
    expect(tris).toBeLessThan(20000);
    expect(sinks.glow.positions.length).toBeGreaterThan(0);
    // Un seul logo (le grand côté de la route), l'auvent « ENTRÉE », trois affiches.
    expect(texts.filter((t) => t === "l'éduen").length).toBe(1);
    expect(texts).toContain("parc des");
    expect(texts).toContain("ENTRÉE");
    expect(texts.length).toBe(4 + 1 + 3);
    // three : (x, z, −y) ; tout tient dans la salle, ses blocs, l'auvent du hall, les mâts et les abords (à 2 m près), et sous la tête du
    // mât d'éclairage (15 m, D233), le sol de l'îlot compris.
    const f = eduenFrame(m);
    // Les mâts sont dans les obstacles (`eduenRings`).
    const pts = [...eduenRings(m).flat(), ...eduenCanopy(m).flatMap(([s, t]) => at(f, s, t)), ...eduenLines(m).flatMap((l) => l.pts)];
    const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]!).toBeGreaterThan(Math.min(...xs) - 2);
      expect(p[i]!).toBeLessThan(Math.max(...xs) + 2);
      expect(-p[i + 2]!).toBeGreaterThan(Math.min(...ys) - 2);
      expect(-p[i + 2]!).toBeLessThan(Math.max(...ys) + 2);
      expect(p[i + 1]!).toBeLessThan(m.g + 18);
    }
  });
});
