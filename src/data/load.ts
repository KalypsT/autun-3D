import { Terrain, TiledTerrain } from "./terrain";
import { spanDeck } from "../core/bridges";
import { Waters, type WaterFile } from "../core/waters";
import type { HullData } from "../core/hulls";
import type { LodBuilding, TileData, TileKinds, TileSigns, TileStructures, WorldBase, WorldManifest } from "./types";
import { immutableUrl } from "./data-version";

/** Données publiées sous public/immuable/<version>/data (D305). */
const base = immutableUrl(import.meta.env.BASE_URL, "data/");

/** Nouveaux essais après une erreur passagère (réseau coupé, serveur 5xx), avec ce délai croissant (ms). */
const RETRIES = 2;
const RETRY_MS = 400;

/**
 * Lecture d'un fichier du site par `fetch`, avec deux nouveaux essais après une erreur passagère. Toutes les données passent par ici,
 * images comprises (D306) : une seule façon de les demander, la même que celle des fichiers JSON, et le code HTTP dans le message
 * d'erreur (une balise `<img>` qui échoue ne dit pas pourquoi).
 */
export async function fetchFile(url: string, name: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let problem: string;
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      problem = String(res.status);
      if (res.status < 500 && res.status !== 429) throw new Error(`${name} : ${problem}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith(`${name} : `)) throw e;
      problem = `réseau (${e instanceof Error ? e.message : String(e)})`;
    }
    if (attempt >= RETRIES) throw new Error(`${name} : ${problem}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS * (attempt + 1)));
  }
}

export async function loadJson<T>(name: string): Promise<T> {
  return (await (await fetchFile(base + name, name)).json()) as T;
}

async function binary(name: string): Promise<ArrayBuffer> {
  return (await fetchFile(base + name, name)).arrayBuffer();
}

/** Adresse d'un fichier de public/immuable/<version>/data. */
export const dataUrl = (name: string): string => base + name;

/**
 * Image lue par `fetch` (voir `fetchFile`), puis décodée depuis une adresse `blob:` (permise par la politique de l'hôte des jeux,
 * `img-src 'self' data: blob:`). `name` sert aux messages d'erreur.
 */
export async function fetchImage(url: string, name: string): Promise<HTMLImageElement> {
  const blob = await (await fetchFile(url, name)).blob();
  const src = URL.createObjectURL(blob);
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    throw new Error(`${name} : image illisible (${blob.type || "type inconnu"}, ${blob.size} octets)`);
  } finally {
    URL.revokeObjectURL(src);
  }
  return img;
}

/** Images de sols : une image par fichier, décodée à part. */
export function loadImage(name: string): Promise<HTMLImageElement> {
  return fetchImage(base + name, name);
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
  const [hasKinds, hasStructures, hasSigns, hasHulls] = await Promise.all([tilesWith("kinds"), tilesWith("structures"), tilesWith("signs"), tilesWith("hulls")]).then(([k, s, g, h]) => [k.has(id), s.has(id), g.has(id), h.has(id)]);
  const [tile, kinds, structures, signs, hulls] = await Promise.all([
    loadJson<TileData>(`tiles/${id}.json`),
    hasKinds ? loadJson<TileKinds>(`kinds/${id}.json`) : null,
    hasStructures ? loadJson<TileStructures>(`structures/${id}.json`) : null,
    hasSigns ? loadJson<TileSigns>(`signs/${id}.json`) : null,
    hasHulls ? loadJson<{ hulls: HullData[] }>(`hulls/${id}.json`) : null,
  ]);
  if (signs) tile.furniture.push(...signs.items);
  if (hulls) tile.hulls = hulls.hulls;
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
