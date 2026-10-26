import type { TileData } from "../data/types";
import { Colliders } from "./collision";

/** Rayon de collision (m) du mobilier selon sa nature ; absent = traversable. */
const FURNITURE_RADIUS: Record<string, number> = {
  bench: 0.55, waste_basket: 0.25, bicycle_parking: 0.5, post_box: 0.3, atm: 0.4, public_bookcase: 0.4,
  bollard: 0.15, memorial: 1.2, fountain: 1.0, street_lamp: 0.2, toilets: 1.0, drinking_water: 0.25,
};

export type ColliderSources = Pick<TileData, "buildings" | "walls" | "furniture" | "trees">;

/** Ajoute les obstacles d'une tuile ; `tag` permet de les retirer quand la tuile est déchargée. */
export function addTileColliders(c: Colliders, tile: ColliderSources, tag: string | null = null): void {
  c.currentTag = tag;
  for (const b of tile.buildings) {
    c.addRing(b.ring);
    for (const h of b.holes) c.addRing(h);
  }
  for (const w of tile.walls) c.addPolyline(w.pts);
  for (const f of tile.furniture) {
    const r = FURNITURE_RADIUS[f.kind];
    if (r !== undefined) c.addCircle(f.x, f.y, r);
  }
  for (const [x, y] of tile.trees) c.addCircle(x, y, 0.3);
  c.currentTag = null;
}

export function buildColliders(sources: ColliderSources): Colliders {
  const c = new Colliders();
  addTileColliders(c, sources);
  return c;
}
