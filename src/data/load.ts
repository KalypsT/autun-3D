import { Terrain, TiledTerrain } from "./terrain";
import type { LodBuilding, TileData, TileKinds, WorldBase, WorldManifest } from "./types";

const base = `${import.meta.env.BASE_URL}data/`;

export async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(base + name);
  if (!res.ok) throw new Error(`${name} : ${res.status}`);
  return (await res.json()) as T;
}

async function binary(name: string): Promise<ArrayBuffer> {
  const res = await fetch(base + name);
  if (!res.ok) throw new Error(`${name} : ${res.status}`);
  return res.arrayBuffer();
}

/** Adresse d'un fichier de public/data. */
export const dataUrl = (name: string): string => base + name;

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
  const manifest = await loadJson<WorldManifest>("world.json");
  const coarse = Terrain.decode(manifest.coarse, await binary("terrain/coarse.bin"));
  return { manifest, terrain: new TiledTerrain(manifest, coarse, (id) => binary(`terrain/${id}.bin`)) };
}

let kindsIndex: Promise<Set<string>> | null = null;

/** Tuiles qui ont un fichier de types (kinds/index.json) ; un index absent vaut « aucune ». */
function kindTiles(): Promise<Set<string>> {
  kindsIndex ??= loadJson<{ tiles: string[] }>("kinds/index.json").then((i) => new Set(i.tiles), () => new Set<string>());
  return kindsIndex;
}

/** Tuile détaillée, avec ses types de bâtiments et ses sites quand elle en a. */
export async function loadTile(id: string): Promise<TileData> {
  const has = (await kindTiles()).has(id);
  const [tile, kinds] = await Promise.all([loadJson<TileData>(`tiles/${id}.json`), has ? loadJson<TileKinds>(`kinds/${id}.json`) : null]);
  if (kinds) tile.kinds = kinds;
  return tile;
}

/** Silhouettes des bâtiments d'une tuile (lod/<id>.json). */
export function loadLod(id: string): Promise<LodBuilding[]> {
  return loadJson<LodBuilding[]>(`lod/${id}.json`);
}

/** Poids de mélange des sols d'une tuile (1 m par pixel) ou d'une super-tuile (4 m par pixel) : deux images A et B. */
export function loadGround(id: string): Promise<[HTMLImageElement, HTMLImageElement]> {
  return Promise.all([loadImage(`ground/${id}_a.png`), loadImage(`ground/${id}_b.png`)]);
}
