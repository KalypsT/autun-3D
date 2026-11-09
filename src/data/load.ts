import { Terrain, TiledTerrain } from "./terrain";
import { spanDeck } from "../core/bridges";
import { Waters, type WaterFile } from "../core/waters";
import type { LodBuilding, TileData, TileKinds, TileSigns, TileStructures, WorldBase, WorldManifest } from "./types";

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
  const [coarseBin, water] = await Promise.all([binary("terrain/coarse.bin"), loadJson<WaterFile>("water.json").catch(() => null)]);
  const coarse = Terrain.decode(manifest.coarse, coarseBin);
  const terrain = new TiledTerrain(manifest, coarse, (id) => binary(`terrain/${id}.bin`));
  // L'eau de la ville (D240) : sans le fichier, le jeu marche comme avant (pas d'eau, sauf la mer).
  terrain.waters = new Waters(water);
  return { manifest, terrain };
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

/** Repère lointain (clocher) d'une tuile : identifiant du bâtiment et tour (x, y, côté, haut de la tour, pointe). */
export interface FarLandmark {
  tile: string;
  id: string;
  t: [number, number, number, number, number];
}

/** Clochers de toutes les tuiles (kinds/index.json), dessinés de loin (D95) ; aucun si l'index manque. */
export function loadLandmarks(): Promise<FarLandmark[]> {
  return loadJson<{ landmarks?: FarLandmark[] }>("kinds/index.json").then((i) => i.landmarks ?? [], () => []);
}

/**
 * Tuile détaillée, avec ses types de bâtiments et sites (kinds/), ses ponts, eau et voies ferrées (structures/) et ses panneaux de
 * signalisation (signs/, D295, ajoutés au mobilier) quand elle en a.
 */
export async function loadTile(id: string): Promise<TileData> {
  const [hasKinds, hasStructures, hasSigns] = await Promise.all([tilesWith("kinds"), tilesWith("structures"), tilesWith("signs")]).then(([k, s, g]) => [k.has(id), s.has(id), g.has(id)]);
  const [tile, kinds, structures, signs] = await Promise.all([
    loadJson<TileData>(`tiles/${id}.json`),
    hasKinds ? loadJson<TileKinds>(`kinds/${id}.json`) : null,
    hasStructures ? loadJson<TileStructures>(`structures/${id}.json`) : null,
    hasSigns ? loadJson<TileSigns>(`signs/${id}.json`) : null,
  ]);
  if (signs) tile.furniture.push(...signs.items);
  if (kinds) tile.kinds = kinds;
  if (structures) tile.structures = { ...structures, decks: structures.decks.map(spanDeck) };
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
