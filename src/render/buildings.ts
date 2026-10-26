import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import type { Building, FacadeFiche, RoofMaterial, WorldData } from "../data/types";
import { buildAtlas, type Atlas } from "./atlas";
import { emitPlacement, planFacades, type FacadePlan } from "./facades";
import { hash01, MeshBuilder, toThree, UvMeshBuilder, type Vec3 } from "./geometry";
import {
  ashlarTexture, flatRoofTexture, mechanicalTileTexture, plainTileTexture, plasterTexture, slateTexture, zincTexture, type SurfaceTexture,
} from "./surfaces";

const CHIMNEY = new THREE.Color("#a07a62");
const SKIRT = 0.4;

export interface CityStats {
  triangles: number;
  windows: number;
  doors: number;
  shops: number;
  balconies: number;
  atlas: { pages: number; size: number; ppm: number; fill: number; sprites: number };
  signAtlas: { pages: number; size: number; ppm: number; fill: number; sprites: number };
}

export interface City {
  group: THREE.Group;
  stats: CityStats;
}

function surfaceMaterial(tex: SurfaceTexture, roughness: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const useNormals = !new URLSearchParams(location.search).has("nonormal");
  return new THREE.MeshStandardMaterial({ map: tex.map, ...(useNormals ? { normalMap: tex.normalMap } : {}), vertexColors: true, roughness, metalness: 0, ...extra });
}

function spriteMaterial(page: Atlas["pages"][number]): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: page.map, normalMap: page.normalMap, alphaTest: 0.5, roughness: 0.7, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

/** Teinte de toit : l'orthophoto donne la clarté, la matière donne la couleur. */
function roofTint(b: Building, material: RoofMaterial): THREE.Color {
  const hex = b.roofColor ?? "#808080";
  const lum = (0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16)) / 130;
  const k = Math.min(1.15, Math.max(0.8, lum)) * (0.9 + hash01(b.id, 3) * 0.2);
  const c = new THREE.Color(1, 1, 1).multiplyScalar(material === "terrasse" || material === "zinc" ? 1 : k);
  return c;
}

function planeUV(a: number, bb: number, x: number, y: number, size: number): [number, number] {
  const g = Math.hypot(a, bb);
  if (g < 1e-3) return [x / size, y / size];
  const hx = -bb / g, hy = a / g;
  return [(x * hx + y * hy) / size, (((x * a + y * bb) / g) * Math.sqrt(1 + g * g)) / size];
}

function wallRing(
  mb: UvMeshBuilder, ring: number[], tops: number[], terrain: Terrain, color: THREE.Color, size: number,
): void {
  const n = ring.length / 2;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = ring[2 * i]!, y1 = ring[2 * i + 1]!, x2 = ring[2 * j]!, y2 = ring[2 * j + 1]!;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const zb1 = terrain.heightAt(x1, y1) - SKIRT, zb2 = terrain.heightAt(x2, y2) - SKIRT;
    const zt1 = Math.max(tops[i]!, zb1), zt2 = Math.max(tops[j]!, zb2);
    if (zt1 <= zb1 + 0.05 && zt2 <= zb2 + 0.05) continue;
    const nrm = toThree(dy / len, -dx / len, 0);
    mb.quad(
      toThree(x1, y1, zb1), toThree(x2, y2, zb2), toThree(x2, y2, zt2), toThree(x1, y1, zt1), nrm,
      [s / size, zb1 / size], [(s + len) / size, zb2 / size], [(s + len) / size, zt2 / size], [s / size, zt1 / size], color,
    );
    s += len;
  }
}

function chimney(mb: MeshBuilder, cx: number, cy: number, sx: number, sy: number, z0: number, z1: number): void {
  const hx = Math.max(sx, 0.5) / 2, hy = Math.max(sy, 0.5) / 2;
  const p = (x: number, y: number, z: number): Vec3 => toThree(cx + x, cy + y, z);
  const c = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as const;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i]!, [bx, by] = c[(i + 1) % 4]!;
    const len = Math.hypot(bx - ax, by - ay);
    mb.quad(p(ax, ay, z0 - 0.2), p(bx, by, z0 - 0.2), p(bx, by, z1), p(ax, ay, z1), toThree((by - ay) / len, -(bx - ax) / len, 0), CHIMNEY);
  }
  mb.quad(p(-hx, -hy, z1), p(hx, -hy, z1), p(hx, hy, z1), p(-hx, hy, z1), [0, 1, 0], new THREE.Color("#5c4e44"));
}

export function buildCity(world: WorldData): City {
  const { terrain, buildings, fiches } = world;

  // 1. Planification des façades, puis atlas des sprites.
  const plan: FacadePlan = planFacades(buildings, fiches, terrain);
  const atlas = buildAtlas(plan.requests, 2048, 80, 2.2, 2);
  const signAtlas = buildAtlas(plan.signRequests, 1024, 64, 1.2);

  // 2. Matières.
  const plaster = plasterTexture(), ashlar = ashlarTexture();
  const roofTex: Record<RoofMaterial, SurfaceTexture> = {
    tuile_plate: plainTileTexture(), tuile_mecanique: mechanicalTileTexture(), ardoise: slateTexture(), zinc: zincTexture(), terrasse: flatRoofTexture(),
  };
  const wallBuilders = { plaster: new UvMeshBuilder(), ashlar: new UvMeshBuilder() };
  const roofBuilders: Record<RoofMaterial, UvMeshBuilder> = {
    tuile_plate: new UvMeshBuilder(), tuile_mecanique: new UvMeshBuilder(), ardoise: new UvMeshBuilder(), zinc: new UvMeshBuilder(), terrasse: new UvMeshBuilder(),
  };
  const misc = plan.misc;

  for (const b of buildings) {
    const f: FacadeFiche | undefined = fiches.get(b.id);
    const kind = f?.materials.wall.kind === "ashlar" ? "ashlar" : "plaster";
    const wb = wallBuilders[kind];
    const size = kind === "ashlar" ? ashlar.size : plaster.size;
    const wc = new THREE.Color(f?.materials.wall.color ?? "#d4c4a4");
    wc.multiplyScalar(0.94 + hash01(b.id, 7) * 0.1);
    wallRing(wb, b.ring, b.top, terrain, wc, size);
    b.holes.forEach((hole, i) => wallRing(wb, hole, b.holeTop[i]!, terrain, wc, size));

    const rm: RoofMaterial = f?.materials.roof ?? "tuile_plate";
    const rb = roofBuilders[rm];
    const rsize = roofTex[rm].size;
    const tint = roofTint(b, rm);
    for (const face of b.faces) {
      const [a, bb, c] = face.p;
      const open = (coords: number[]): THREE.Vector2[] => {
        const pts: THREE.Vector2[] = [];
        for (let i = 0; i < coords.length; i += 2) pts.push(new THREE.Vector2(coords[i]!, coords[i + 1]!));
        if (pts.length > 1 && pts[0]!.distanceTo(pts[pts.length - 1]!) < 1e-6) pts.pop();
        return pts;
      };
      const contour = open(face.r);
      if (contour.length < 3) continue;
      const holes = face.h.map(open);
      const extra: THREE.Vector2[] = [];
      for (let i = 0; face.e && i < face.e.length; i += 2) extra.push(new THREE.Vector2(face.e[i]!, face.e[i + 1]!));
      const verts = [...contour, ...holes.flat(), ...extra];
      const tris: number[][] = [];
      if (face.t) for (let k = 0; k + 2 < face.t.length; k += 3) tris.push([face.t[k]!, face.t[k + 1]!, face.t[k + 2]!]);
      else tris.push(...THREE.ShapeUtils.triangulateShape(contour, holes));
      const nl = Math.hypot(a, bb, 1);
      const n: Vec3 = [-a / nl, 1 / nl, bb / nl];
      const P = (v: THREE.Vector2, idx: number): Vec3 => toThree(v.x, v.y, face.z?.[idx] ?? a * v.x + bb * v.y + c);
      for (const [i, j, k] of tris) {
        const va = verts[i!]!, vb = verts[j!]!, vc = verts[k!]!;
        rb.tri(P(va, i!), P(vb, j!), P(vc, k!), n, planeUV(a, bb, va.x, va.y, rsize), planeUV(a, bb, vb.x, vb.y, rsize), planeUV(a, bb, vc.x, vc.y, rsize), tint);
      }
    }
    for (const s of b.steps) {
      const [x1, y1, l1, h1, x2, y2, l2, h2] = s as [number, number, number, number, number, number, number, number];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1e-3) continue;
      // Seuls les vrais murs de raccord (lucarnes, lanternes : 1,5 à 4 m) sont gardés ; les petits décrochements
      // viennent surtout de plans voisins mal raccordés et dessinent des plaques parasites.
      const dz = Math.max(h1 - l1, h2 - l2);
      if (dz > 4 || dz < 1.5) continue;
      const target = wb;
      const sz = size;
      const nrm = toThree((y2 - y1) / len, -(x2 - x1) / len, 0);
      const q: [Vec3, Vec3, Vec3, Vec3] = [toThree(x1, y1, l1), toThree(x2, y2, l2), toThree(x2, y2, h2), toThree(x1, y1, h1)];
      const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0, l1 / sz], [len / sz, l2 / sz], [len / sz, h2 / sz], [0, h1 / sz]];
      const col = wc;
      target.quad(...q, nrm, ...uv, col);
      target.quad(q[0], q[3], q[2], q[1], [-nrm[0], 0, -nrm[2]], uv[0], uv[3], uv[2], uv[1], col);
    }
    for (const [cx, cy, sx, sy, z0, z1] of b.chim as [number, number, number, number, number, number][]) chimney(misc, cx, cy, sx, sy, z0, z1);
  }

  // 3. Quads des sprites.
  const sprites = atlas.pages.map(() => new UvMeshBuilder()), signs = signAtlas.pages.map(() => new UvMeshBuilder());
  for (const p of plan.placements) {
    const r = (p.atlas === "facade" ? atlas : signAtlas).rects.get(p.key);
    if (r) emitPlacement((p.atlas === "facade" ? sprites : signs)[r.page]!, p, r);
  }

  // 4. Maillages.
  const group = new THREE.Group();
  const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): void => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
  };
  add("plaster", wallBuilders.plaster.build(), surfaceMaterial(plaster, 0.95));
  add("ashlar", wallBuilders.ashlar.build(), surfaceMaterial(ashlar, 0.9));
  const roughness: Record<RoofMaterial, number> = { tuile_plate: 0.85, tuile_mecanique: 0.8, ardoise: 0.65, zinc: 0.5, terrasse: 0.95 };
  for (const rm of Object.keys(roofBuilders) as RoofMaterial[]) {
    const dbg = new URLSearchParams(location.search).get("dbg") === "normals";
    add(`toit-${rm}`, roofBuilders[rm].build(), dbg
      ? new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
      : surfaceMaterial(roofTex[rm], roughness[rm], { side: THREE.DoubleSide, shadowSide: THREE.BackSide }));
  }
  add("misc", misc.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
  sprites.forEach((mb, i) => add(`sprites-${i}`, mb.build(), spriteMaterial(atlas.pages[i]!), false));
  signs.forEach((mb, i) => add(`enseignes-${i}`, mb.build(), spriteMaterial(signAtlas.pages[i]!), false));

  const triangles =
    wallBuilders.plaster.triangleCount + wallBuilders.ashlar.triangleCount + misc.triangleCount +
    [...sprites, ...signs].reduce((n, b) => n + b.triangleCount, 0) +
    Object.values(roofBuilders).reduce((s, r) => s + r.triangleCount, 0);
  return {
    group,
    stats: {
      triangles, ...plan.stats,
      atlas: { pages: atlas.pages.length, size: atlas.size, ppm: Math.round(atlas.ppm), fill: Math.round(atlas.fill * 100) / 100, sprites: atlas.rects.size },
      signAtlas: { pages: signAtlas.pages.length, size: signAtlas.size, ppm: Math.round(signAtlas.ppm), fill: Math.round(signAtlas.fill * 100) / 100, sprites: signAtlas.rects.size },
    },
  };
}
