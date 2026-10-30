import type { HeightField, TileData } from "../data/types";
import { Colliders, type Top } from "./collision";
import { isOpen, landmarkCircles, landmarkRings } from "./landmarks";
import { parapetLines } from "./bridges";

/** Rayon de collision (m) du mobilier selon sa nature ; absent = traversable (les parkings à vélos : ce sont les vélos garés qui gênent). */
const FURNITURE_RADIUS: Record<string, number> = {
  bench: 0.55, waste_basket: 0.25, post_box: 0.3, atm: 0.4, public_bookcase: 0.4,
  bollard: 0.15, memorial: 1.2, fountain: 1.0, street_lamp: 0.2, toilets: 1.0, drinking_water: 0.25,
};

/** Hauteur maximale (m) d'une grille, d'un mur ou d'une portail qu'on escalade ; une haie au-delà de HEDGE_CLIMB se traverse mal : on ne l'escalade pas. */
export const CLIMB_MAX = 2.5;
const HEDGE_CLIMB = 1.5;
const CLIMBABLE = new Set(["fence", "gate", "wall", "retaining_wall", "hedge"]);
/** Parapet d'un pont : on l'enjambe (et l'on tombe dans la rivière). */
const PARAPET: Top = { height: 1.1, climb: true };

/** Hauteur et escalade d'un mur, d'une clôture ou d'une haie. */
export function wallTop(kind: string, height: number): Top {
  const climb = CLIMBABLE.has(kind) && height <= (kind === "hedge" ? HEDGE_CLIMB : CLIMB_MAX);
  return { height, climb };
}

/** Identifiants des clôtures de parcelle écrites par tools/data/build_public_space.py : −(PARCEL_FENCE_ID + n). */
export const PARCEL_FENCE_ID = 900_000_000;

export type ColliderSources = Pick<TileData, "buildings" | "walls" | "furniture" | "trees" | "kinds" | "structures">;

/** Ajoute les obstacles d'une tuile ; `tag` permet de les retirer quand la tuile est déchargée. */
export function addTileColliders(c: Colliders, tile: ColliderSources, tag: string | null = null, terrain: HeightField | null = null): void {
  c.currentTag = tag;
  for (const b of tile.buildings) {
    if (isOpen(tile.kinds, b.id)) continue;
    c.addRing(b.ring);
    for (const h of b.holes) c.addRing(h);
  }
  // Clôtures de parcelle (D94) : elles arrêtent les déplacements, pas la vue ni les tirs (on voit et on tire par-dessus).
  // Chacun garde sa hauteur : on saute par-dessus les plus bas, on escalade les grilles (voir `player.ts`).
  for (const w of tile.walls) c.addPolyline(w.pts, w.id <= -PARCEL_FENCE_ID, wallTop(w.kind, w.height));
  for (const f of tile.furniture) {
    const r = FURNITURE_RADIUS[f.kind];
    if (r !== undefined) c.addCircle(f.x, f.y, r);
  }
  for (const [x, y] of tile.trees) c.addCircle(x, y, 0.3);
  for (const [x, y, r] of landmarkCircles(tile.kinds, tile.buildings)) c.addCircle(x, y, r);
  for (const ring of landmarkRings(tile.kinds, (x, y) => terrain?.heightAt(x, y) ?? 0)) c.addRing(ring);
  // Parapets des ponts (D93) : interrompus là où le pont enjambe une voie, que le parapet barrerait en 2D.
  for (const d of tile.structures?.decks ?? []) for (const line of parapetLines(d)) c.addPolyline(line, false, PARAPET);
  c.currentTag = null;
}

export function buildColliders(sources: ColliderSources): Colliders {
  const c = new Colliders();
  addTileColliders(c, sources);
  return c;
}
