import type { Building, Furniture, Props, Tree } from "../data/types";
import { Colliders } from "./collision";

/** Rayon de collision (m) du mobilier selon sa nature ; absent = traversable. */
const FURNITURE_RADIUS: Record<string, number> = {
  bench: 0.55, waste_basket: 0.25, bicycle_parking: 0.5, post_box: 0.3, atm: 0.4, public_bookcase: 0.4,
  bollard: 0.15, memorial: 1.2, fountain: 1.0, street_lamp: 0.2, toilets: 1.0, drinking_water: 0.25,
};

export interface ColliderSources {
  buildings: readonly Building[];
  props: Props;
  trees: readonly Tree[];
}

export function buildColliders({ buildings, props, trees }: ColliderSources): Colliders {
  const c = new Colliders();
  for (const b of buildings) {
    c.addRing(b.ring);
    for (const h of b.holes) c.addRing(h);
  }
  for (const w of props.walls) c.addPolyline(w.pts);
  for (const f of props.furniture as Furniture[]) {
    const r = FURNITURE_RADIUS[f.kind];
    if (r !== undefined) c.addCircle(f.x, f.y, r);
  }
  for (const [x, y, , , , ] of trees) c.addCircle(x, y, 0.3);
  return c;
}
