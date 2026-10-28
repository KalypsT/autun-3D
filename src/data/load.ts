import { Terrain, TiledTerrain } from "./terrain";
import type { LodBuilding, TileData, TileKinds, TileStructures, WorldBase, WorldManifest } from "./types";

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

const indexes = new Map<string, Promise<Set<string>>>();

/** Tuiles qui ont un fichier dans le dossier `dir` (dir/index.json) ; un index absent vaut « aucune ». */
function tilesWith(dir: string): Promise<Set<string>> {
  let p = indexes.get(dir);
  if (!p) {
    p = loadJson<{ tiles: string[] }>(`${dir}/index.json`).then((i) => new Set(i.tiles), () => new Set<string>());
    indexes.set(dir, p);
  }
  return p;
}

/** Tuile détaillée, avec ses types de bâtiments et sites (kinds/) et ses ponts, eau et voies ferrées (structures/) quand elle en a. */
export async function loadTile(id: string): Promise<TileData> {
  const [hasKinds, hasStructures] = await Promise.all([tilesWith("kinds"), tilesWith("structures")]).then(([k, s]) => [k.has(id), s.has(id)]);
  const [tile, kinds, structures] = await Promise.all([
    loadJson<TileData>(`tiles/${id}.json`),
    hasKinds ? loadJson<TileKinds>(`kinds/${id}.json`) : null,
    hasStructures ? loadJson<TileStructures>(`structures/${id}.json`) : null,
  ]);
  if (kinds) tile.kinds = kinds;
  if (structures) tile.structures = structures;
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
