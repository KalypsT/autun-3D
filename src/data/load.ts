import { Terrain } from "./terrain";
import type { Building, FacadeFiche, GroundMeta, Props, Street, TerrainMeta, Tree, WorldData } from "./types";

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

export async function loadWorld(): Promise<WorldData> {
  const [terrainMeta, terrainBin, buildings, fichesList, streets, props, trees, groundMeta, groundImage] = await Promise.all([
    json<TerrainMeta>("terrain.json"),
    fetch(base + "terrain.bin").then((r) => r.arrayBuffer()),
    json<Building[]>("buildings.json"),
    json<FacadeFiche[]>("facades.json"),
    json<Street[]>("streets.json"),
    json<Props>("props.json"),
    json<Tree[]>("trees.json"),
    json<GroundMeta>("ground.json"),
    image("ground.png"),
  ]);
  return { terrain: Terrain.decode(terrainMeta, terrainBin), buildings, fiches: new Map(fichesList.map((f) => [f.id, f])), streets, props, trees, groundMeta, groundImage };
}
