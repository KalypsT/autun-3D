import type { Building, HeightField, RampartTower, TileData } from "../data/types";
import { BREAKABLE, CAR_ONLY } from "./breakables";
import { Colliders, WALL_STEP, type Top } from "./collision";
import { cathedralWalls, furnitureOutsideMonuments, houseRing, isOpen, playhouseRing, stationRing, stationWall, eduenLines, eduenRings, mcdoRings, bowlingRings, roadsideLines, ROADSIDE_HEDGE_H, TERRACE_RAIL_H, EDUEN_BARRIER_H, EDUEN_FENCE_H, EDUEN_HEDGE_H, landmarkCircles, landmarkShapes, militairePassage, reshapeBuilding, treesOutsideMonuments, walkableRoof, wallsOutsideMonuments } from "./landmarks";
import { roofPlanes } from "./roofs";
import { HULL_STEP_BELOW, hullSiteKey, hullSteps, hullWalls, makeHull, type HullData } from "./hulls";
import { parapetLines, pierRings } from "./bridges";
import { theatreWalls } from "./theatre";
import { hallObstacles } from "./townhall";
import { GENDARMERIE_FENCE_H, gendarmerieLines, gendarmerieRings } from "./gendarmerie";
import { NAUTIQUE_BARRIER_H, nautiqueLines, nautiqueRings } from "./nautique";
import { BOAT_TOP, boatOutline, SHELTER_POST, shelterPosts } from "./piers";
import { EQUIP_TOP, equipRing, skateSides } from "./leisure";
import { isProfiled, rampartOutline, towerOutline } from "./ramparts";

/** Rayon de collision (m) du mobilier selon sa nature ; absent = traversable (les parkings à vélos : ce sont les vélos garés qui gênent). */
const FURNITURE_RADIUS: Record<string, number> = {
  bench: 0.55, atm: 0.4, public_bookcase: 0.4,
  memorial: 1.2, fountain: 1.0, toilets: 1.0,
  // Panneau « voie sans issue » (D287) : son mât.
  dead_end: 0.08,
};

/** Hauteur maximale (m) d'une grille, d'un mur ou d'une portail qu'on escalade ; une haie au-delà de HEDGE_CLIMB se traverse mal : on ne l'escalade pas. */
export const CLIMB_MAX = 2.5;
const HEDGE_CLIMB = 1.5;
const CLIMBABLE = new Set(["fence", "gate", "wall", "retaining_wall", "hedge", "barrier"]);
/** Grilles du porche de la cathédrale (D132) : hautes et à pointes, on ne les escalade pas. */
const GRILLE: Top = { height: 1.2, climb: false };
/** Grille d'honneur du lycée (D149) : trois mètres de fer, ni franchie ni escaladée ; on voit et on tire à travers. */
const GRILLE_HONNEUR: Top = { height: 3.4, climb: false };
/** Barrière en X du Lycée militaire (D264) : 1,1 m, on l'enjambe. */
const CROSS_BARRIER: Top = { height: 1.1, climb: true };
/** Margelle du bassin du Lycée militaire (D261) : basse, mais on n'entre pas dans l'eau. */
const BASIN_RIM: Top = { height: 0.6, climb: false };
/** Tour des remparts (D254) : on ne l'escalade pas. */
const TOWER_TOP: Top = { height: 30, climb: false };
/** Parapet d'un pont : on l'enjambe (et l'on tombe dans la rivière). */
const PARAPET: Top = { height: 1.1, climb: true };

/** Hauteur et escalade d'un mur, d'une clôture ou d'une haie. */
export function wallTop(kind: string, height: number): Top {
  const climb = CLIMBABLE.has(kind) && height <= (kind === "hedge" ? HEDGE_CLIMB : CLIMB_MAX);
  return { height, climb };
}

/** Identifiants des clôtures de parcelle écrites par tools/data/build_public_space.py : −(PARCEL_FENCE_ID + n). */
export const PARCEL_FENCE_ID = 900_000_000;

export type ColliderSources = Pick<TileData, "buildings" | "walls" | "furniture" | "trees" | "kinds" | "structures"> & { towers?: readonly RampartTower[] | undefined; hulls?: readonly HullData[] | undefined };

/**
 * Bâtiment spécial ou site (D302) : ses murs (contours fermés, lignes ouvertes d'un porche ou d'un passage) et l'emprise où son relevé de
 * hauteurs (`src/core/hulls.ts`) fait toit. Sans relevé, ses murs restent infinis.
 */
export interface SolidShape {
  key: string;
  rings: number[][];
  lines: number[][];
  outer: number[][];
  holes: number[][];
  /** Murs qu'on n'escalade pas, même bas (sites : kiosque, monument aux morts, croix…). */
  noClimb: boolean;
}

/**
 * Bâtiments spéciaux et sites d'une tuile (D302) : tous ceux dont le toit n'est pas praticable par ses pans BD TOPO (`walkableRoof`), hors
 * bâtiments ouverts ou cachés. Les obstacles qui les accompagnent (clôtures, haies, barrières, grilles) sont posés par `addTileColliders`.
 */
export function solidShapes(tile: Pick<TileData, "buildings" | "kinds">, ground: (x: number, y: number) => number): SolidShape[] {
  const out: SolidShape[] = [];
  const bld = (b: Building, rings: number[][], lines: number[][], outer: number[][], holes: number[][] = b.holes): void => {
    out.push({ key: b.id, rings: [...rings, ...holes], lines, outer, holes, noClimb: false });
  };
  for (const b of tile.buildings) {
    if (isOpen(tile.kinds, b.id)) continue;
    const kind = tile.kinds?.buildings[b.id];
    // Cathédrale (D132) : on entre dans le porche, on monte jusqu'aux portes entre les grilles.
    if (kind?.cath?.entry) bld(b, [], cathedralWalls(b, kind.cath).lines, [b.ring]);
    // Parc des expositions l'Eduen (D231), gendarmerie (D238), base nautique (D245), McDonald's et bowling (D234) : leurs volumes mesurés.
    else if (kind?.edu || kind?.gend || kind?.naut || kind?.mcd || kind?.bowl) {
      const rings = kind.edu ? eduenRings(kind.edu) : kind.gend ? gendarmerieRings(kind.gend) : kind.naut ? nautiqueRings(kind.naut) : kind.mcd ? mcdoRings(kind.mcd) : bowlingRings(kind.bowl!);
      bld(b, rings, [], rings, []);
    } else {
      // Lycée militaire (D263) : on entre dans la cour d'honneur par le passage voûté de la galerie d'entrée.
      const pass = kind?.college?.mil ? militairePassage(b, kind.college) : null;
      if (pass) bld(b, [], [pass.outer, pass.cut, ...pass.sides], [b.ring], pass.holes);
      else if (kind?.house || !walkableRoof(kind)) {
        // Maison d'après photo (D140), théâtre municipal (D223), gare (D228) : leurs murs mesurés.
        const ring = kind?.house ? houseRing(kind.house) : kind?.play ? playhouseRing(kind.play) : kind?.sta ? stationRing(kind.sta) : b.ring;
        bld(b, [ring], [], [ring]);
      }
    }
  }
  // Sites (portes romaines, temple de Janus, Couhard, croix, kiosque, monument aux morts, tente du golf) : on n'y grimpe pas.
  for (const g of landmarkShapes(tile.kinds, ground)) out.push({ key: hullSiteKey(g.site.t, g.rings), rings: g.rings, lines: [], outer: g.rings, holes: [], noClimb: true });
  return out;
}

/** Murs d'un bâtiment spécial ou d'un site : à la hauteur de son relevé, qui devient aussi un toit (D302) ; sans relevé, infinis. */
function addSolid(c: Colliders, shape: SolidShape, data: HullData | undefined, tag: string | null): void {
  if (!data) {
    for (const r of shape.rings) c.addRing(r);
    for (const l of shape.lines) c.addPolyline(l);
    return;
  }
  const h = makeHull(data, shape.outer, shape.holes);
  const wall = (pts: readonly number[], closed: boolean): void => {
    for (const [ax, ay, bx, by, za, zb] of hullWalls(h, pts, closed)) c.addSegment(ax, ay, bx, by, false, null, [za, zb], false, { noClimb: shape.noClimb });
  };
  for (const r of shape.rings) wall(r, true);
  for (const l of shape.lines) wall(l, false);
  for (const [ax, ay, bx, by, z, low] of hullSteps(h)) c.addSegment(ax, ay, bx, by, false, null, [z, z], false, { noClimb: shape.noClimb, bottom: low - HULL_STEP_BELOW });
  c.roofs.add([h], tag);
}

/** Ajoute les obstacles d'une tuile ; `tag` permet de les retirer quand la tuile est déchargée. */
export function addTileColliders(c: Colliders, tile: ColliderSources, tag: string | null = null, terrain: HeightField | null = null): void {
  c.currentTag = tag;
  // Bâtiments spéciaux et sites (D302) : murs à la hauteur de leur relevé, qui leur sert de toit.
  const hulls = new Map((tile.hulls ?? []).map((d) => [d.k, d]));
  for (const shape of solidShapes(tile, (x, y) => terrain?.heightAt(x, y) ?? 0)) addSolid(c, shape, hulls.get(shape.key), tag);
  for (const b of tile.buildings) {
    if (isOpen(tile.kinds, b.id)) continue;
    const kind = tile.kinds?.buildings[b.id];
    // Cathédrale (D132) : les grilles du porche.
    if (kind?.cath?.entry) {
      for (const l of cathedralWalls(b, kind.cath).grilles) c.addPolyline(l, true, GRILLE);
      continue;
    }
    // Parc des expositions l'Eduen (D233) : clôture verte (on voit à travers), haie de l'îlot, bras de la barrière (on passe dessous, pas les voitures).
    if (kind?.edu) {
      for (const l of eduenLines(kind.edu)) {
        if (l.kind === "fence") c.addPolyline(l.pts, true, wallTop("fence", EDUEN_FENCE_H));
        else if (l.kind === "hedge") c.addPolyline(l.pts, false, wallTop("hedge", EDUEN_HEDGE_H));
        else c.addPolyline(l.pts, true, wallTop("fence", EDUEN_BARRIER_H));
      }
      continue;
    }
    // Gendarmerie (D238) : clôture et portail de la cour.
    if (kind?.gend) {
      for (const l of gendarmerieLines(kind.gend)) c.addPolyline(l, true, wallTop("fence", GENDARMERIE_FENCE_H));
      continue;
    }
    // Base nautique (D245) : barrière levante baissée.
    if (kind?.naut) {
      for (const l of nautiqueLines(kind.naut)) c.addPolyline(l, true, wallTop("fence", NAUTIQUE_BARRIER_H));
      continue;
    }
    // McDonald's et bowling (D236) : garde-corps des terrasses (on voit à travers, on les enjambe), haie de la D680.
    if (kind?.mcd || kind?.bowl) {
      for (const l of roadsideLines(kind)) {
        if (l.kind === "fence") c.addPolyline(l.pts, true, wallTop("fence", TERRACE_RAIL_H));
        else c.addPolyline(l.pts, false, wallTop("hedge", ROADSIDE_HEDGE_H));
      }
      continue;
    }
    if (kind?.college?.mil && militairePassage(b, kind.college)) continue;
    if (kind?.house || !walkableRoof(kind)) {
      // Mur blanc du parvis de la gare (D230).
      const sw = kind?.sta ? stationWall(kind.sta) : null;
      if (sw) c.addPolyline(sw);
      // Hôtel de ville (D293, D294) : murs d'échiffre et piédestaux du perron, escalier de l'entrée arrière.
      if (kind?.hall) for (const o of hallObstacles(kind.hall)) c.addPolyline([...o.ring, o.ring[0]!, o.ring[1]!], false, o.top);
      continue;
    }
    // Toit praticable (D214) : les pans dessinés (bâtiment remis à la forme de son gabarit, comme au rendu) et des murs à leur hauteur.
    addRoofedBuilding(c, reshapeBuilding(b, kind?.k, kind?.roof), tag);
  }
  // Clôtures de parcelle (D94) : elles arrêtent les déplacements, pas la vue ni les tirs (on voit et on tire par-dessus).
  // Chacun garde sa hauteur : on saute par-dessus les plus bas, on escalade les grilles (voir `player.ts`).
  // Remparts à profil (D250) : le contour des deux faces, bouts fermés (un mur de 2 m d'épaisseur ; le joueur s'arrête contre la pierre).
  for (const w of wallsOutsideMonuments(tile.kinds, tile.walls)) {
    if (isProfiled(w)) c.addPolyline(rampartOutline(w), false, wallTop(w.kind, w.height));
    else c.addPolyline(w.pts, w.id <= -PARCEL_FENCE_ID, wallTop(w.kind, w.height));
  }
  // Tours des remparts (D254) : leur pied, infranchissable.
  for (const t of tile.towers ?? []) c.addPolyline(towerOutline(t), false, TOWER_TOP);
  for (const k of Object.values(tile.kinds?.buildings ?? {})) {
    const g = k.college?.grille;
    if (g) c.addPolyline([...g.a, ...g.b], true, GRILLE_HONNEUR);
    // Grand portail du Lycée militaire (D260) : fermé, ni franchi ni escaladé, comme la grille d'honneur du lycée Bonaparte.
    const mg = k.college?.mil?.gates;
    if (mg) c.addPolyline([...mg.avenue.a, ...mg.avenue.b], true, GRILLE_HONNEUR);
    // Barrières en X de l'entrée Gaston Joliet (D264) : basses, on les enjambe ; une voiture s'y arrête.
    for (const [x, y, a, len] of mg?.joliet.xb ?? []) {
      const dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2;
      c.addPolyline([x - dx, y - dy, x + dx, y + dy], true, CROSS_BARRIER);
    }
    // Margelle du bassin des jardins (D261) : on ne l'enjambe pas (pas de baignade), on voit et on tire par-dessus.
    const basin = k.college?.mil?.garden?.basin;
    if (basin) {
      const ring: number[] = [];
      for (let i = 0; i <= 40; i++) ring.push(basin.c[0] + Math.cos((Math.PI * i) / 20) * (basin.r + 0.5), basin.c[1] + Math.sin((Math.PI * i) / 20) * (basin.r + 0.5));
      c.addPolyline(ring, true, BASIN_RIM);
    }
  }
  for (const f of furnitureOutsideMonuments(tile.kinds, tile.furniture)) {
    // Lampadaires, feux, poubelles, boîtes aux lettres, potelets et bornes à eau : un véhicule lourd et rapide les arrache (D160).
    const soft = BREAKABLE[f.kind];
    if (soft && CAR_ONLY.has(f.kind)) continue;
    if (soft) c.addCircle(f.x, f.y, soft.radius, { id: f.id, kind: f.kind });
    else {
      const r = FURNITURE_RADIUS[f.kind];
      if (r !== undefined) c.addCircle(f.x, f.y, r);
    }
  }
  for (const [x, y] of treesOutsideMonuments(tile.kinds, tile.trees)) c.addCircle(x, y, 0.3);
  for (const [x, y, r] of landmarkCircles(tile.kinds, tile.buildings)) c.addCircle(x, y, r);
  // Théâtre romain (D133) : podium, bords des massifs plus hauts que ce qui les jouxte, barrières de la scène.
  if (terrain) {
    const bare = terrain.ground ?? terrain;
    for (const s of tile.kinds?.sites ?? []) {
      if (s.t === "theatre") for (const w of theatreWalls(s, (x, y) => bare.heightAt(x, y))) c.addPolyline(w.pts, w.low, w.top);
    }
  }
  // Plan d'eau du Vallon (D246) : bateaux posés ou amarrés, obstacles bas qu'on enjambe ; poteaux des abris.
  for (const b of tile.structures?.boats ?? []) {
    const r = boatOutline(b);
    c.addPolyline([...r, r[0]!, r[1]!], true, { height: BOAT_TOP, climb: true });
  }
  for (const s of tile.structures?.shelters ?? []) for (const [x, y] of shelterPosts(s)) c.addCircle(x, y, SHELTER_POST * 1.4);
  // Équipements du plan d'eau du Vallon (D247) : flancs des modules du skatepark (murs à hauteur) ; structures de jeux pleines ; bancs, tables,
  // agrès, panneaux, barre de glisse, grillage et ganivelle bas, qu'on escalade et à travers lesquels on voit. Pierres du gué et rigole : rien.
  for (const d of tile.structures?.decks ?? []) {
    if (d.st !== "skate") continue;
    const { ring, tops } = skateSides(d);
    c.addRing(ring, tops);
  }
  // Pêcheurs du lac (D249) : biwys, supports à cannes et pêcheurs assis, obstacles bas comme les bancs.
  for (const e of [...(tile.structures?.equip ?? []), ...(tile.structures?.life ?? [])]) {
    if (e.k === "play_small" || e.k === "play_big") c.addRing(equipRing(e));
    else if (e.p && (e.k === "rail" || e.k === "fence" || e.k === "ganivelle")) c.addPolyline(e.p, true, { height: e.k === "rail" ? EQUIP_TOP.rail! : e.h ?? 1.1, climb: true });
    else if (EQUIP_TOP[e.k] !== undefined && e.x !== undefined) {
      const r = equipRing(e);
      c.addPolyline([...r, r[0]!, r[1]!], true, { height: EQUIP_TOP[e.k]!, climb: true });
    }
  }
  // Parapets des ponts (D93) : interrompus là où le pont enjambe une voie, que le parapet barrerait en 2D.
  for (const d of tile.structures?.decks ?? []) for (const line of parapetLines(d)) c.addPolyline(line, false, PARAPET);
  // Piles (D220) : on ne les traverse plus par-dessous ; d'en haut (pieds sur le tablier) ou sans altitude (passants, circulation),
  // elles ne comptent pas. Le relief nu écarte celles qu'on ne peut pas approcher debout.
  const bare = terrain ? terrain.ground ?? terrain : null;
  for (const d of tile.structures?.decks ?? []) {
    for (const p of pierRings(d, bare ? (x, y) => bare.heightAt(x, y) : undefined)) c.addRing(p.ring, [p.top, p.top, p.top, p.top], true);
  }
  c.currentTag = null;
}

/** Plus petit côté (m) d'une cheminée, comme au rendu. */
const CHIMNEY_MIN = 0.5;
/** Raccords entre pans (D170) qui font un mur : plus hauts que la marche qu'on franchit, et pas plus que ce que dessine le rendu. */
const STEP_MIN = WALL_STEP;
const STEP_MAX = 4;

/** Bâtiment à toit praticable : murs à hauteur (contour, cours), pans de toit, cheminées et édicules, raccords entre pans. */
function addRoofedBuilding(c: Colliders, b: Building, tag: string | null): void {
  c.addRing(b.ring, b.top);
  b.holes.forEach((h, i) => c.addRing(h, b.holeTop[i] ?? null));
  c.roofs.add(roofPlanes(b), tag);
  for (const [cx, cy, sx, sy, , z1] of b.chim as [number, number, number, number, number, number][]) {
    const hx = Math.max(sx, CHIMNEY_MIN) / 2, hy = Math.max(sy, CHIMNEY_MIN) / 2;
    c.addRing([cx - hx, cy - hy, cx + hx, cy - hy, cx + hx, cy + hy, cx - hx, cy + hy], [z1, z1, z1, z1]);
  }
  for (const [cx, cy, sx, sy, , z1, ang] of (b.rooftop ?? []) as [number, number, number, number, number, number, number][]) {
    const a = (ang * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    const pt = (s: number, t: number): [number, number] => [cx + ux * s - uy * t, cy + uy * s + ux * t];
    c.addRing([...pt(-sx / 2, -sy / 2), ...pt(sx / 2, -sy / 2), ...pt(sx / 2, sy / 2), ...pt(-sx / 2, sy / 2)], [z1, z1, z1, z1]);
  }
  for (const s of b.steps) {
    const [x1, y1, l1, h1, x2, y2, l2, h2] = s as [number, number, number, number, number, number, number, number];
    const dz = Math.max(h1 - l1, h2 - l2);
    if (dz >= STEP_MIN && dz <= STEP_MAX) c.addSegment(x1, y1, x2, y2, false, null, [h1, h2]);
  }
}

export function buildColliders(sources: ColliderSources): Colliders {
  const c = new Colliders();
  addTileColliders(c, sources);
  return c;
}
