import { Terrain, TiledTerrain } from "./terrain";
import type { LodBuilding, TileData, WorldBase, WorldManifest } from "./types";

const base = `${import.meta.env.BASE_URL}data/`;

async function json<T>(name: string): Promise<T> {
  const res = await fetch(base + name);
  if (!res.ok) throw new Error(`${name} : ${res.status}`);
  return (await res.json()) as T;
}

async function binary(name: string): Promise<ArrayBuffer> {
  const res = await fetch(base + name);
  if (!res.ok) throw new Error(`${name} : ${res.status}`);
  return res.arrayBuffer();
}

/** Images de sols : une image par fichier, décodée à part. */
export function loadImage(name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${name} : image illisible`));
    img.src = base + name;
  });
}

/** Ce qui est chargé au démarrage : le plan du monde et le relief à gros pas. Tout le reste se charge par tuile. */
export async function loadWorldBase(): Promise<WorldBase> {
  const manifest = await json<WorldManifest>("world.json");
  const coarse = Terrain.decode(manifest.coarse, await binary("terrain/coarse.bin"));
  return { manifest, terrain: new TiledTerrain(manifest, coarse, (id) => binary(`terrain/${id}.bin`)) };
}

export function loadTile(id: string): Promise<TileData> {
  return json<TileData>(`tiles/${id}.json`);
}

/** Silhouettes des bâtiments d'une tuile (lod/<id>.json). */
export function loadLod(id: string): Promise<LodBuilding[]> {
  return json<LodBuilding[]>(`lod/${id}.json`);
}

/** Poids de mélange des sols d'une tuile (1 m par pixel) ou d'une super-tuile (4 m par pixel) : deux images A et B. */
export function loadGround(id: string): Promise<[HTMLImageElement, HTMLImageElement]> {
  return Promise.all([loadImage(`ground/${id}_a.png`), loadImage(`ground/${id}_b.png`)]);
}
