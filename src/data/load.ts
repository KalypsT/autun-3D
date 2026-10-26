import { Terrain } from "./terrain";
import type { GroundMeta, LodBuilding, Street, TerrainMeta, TileData, WorldBase, WorldManifest } from "./types";

const base = `${import.meta.env.BASE_URL}data/`;

async function json<T>(name: string): Promise<T> {
  const res = await fetch(base + name);
  if (!res.ok) throw new Error(`${name} : ${res.status}`);
  return (await res.json()) as T;
}

function image(name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${name} : image illisible`));
    img.src = base + name;
  });
}

/** Ce qui sert partout : relief, sols, rues, silhouettes lointaines. Les tuiles détaillées se chargent à la demande. */
export async function loadWorldBase(): Promise<WorldBase> {
  const [manifest, terrainMeta, terrainBin, streets, groundMeta, groundA, groundB, lod] = await Promise.all([
    json<WorldManifest>("world.json"),
    json<TerrainMeta>("terrain.json"),
    fetch(base + "terrain.bin").then((r) => r.arrayBuffer()),
    json<Street[]>("streets.json"),
    json<GroundMeta>("ground.json"),
    image("ground_a.png"),
    image("ground_b.png"),
    json<Record<string, LodBuilding[]>>("lod.json"),
  ]);
  return { manifest, terrain: Terrain.decode(terrainMeta, terrainBin), streets, groundMeta, groundA, groundB, lod };
}

export async function loadTile(id: string): Promise<TileData> {
  return json<TileData>(`tiles/${id}.json`);
}
