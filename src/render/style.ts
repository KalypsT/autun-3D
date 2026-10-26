import * as THREE from "three";
import type { Era, RoofMaterial } from "../data/types";

/** Direction artistique « conte peint » : géométrie simple, aplats de couleur, lumière chaude, sans texture de façade. */
export interface Style {
  id: string;
  sky: { horizon: string; zenith: string };
  fog: [string, number, number];
  sun: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  exposure: number;
}

export const CONTE: Style = {
  id: "conte",
  sky: { horizon: "#f4dfc2", zenith: "#5f95d0" },
  fog: ["#f1dcc0", 230, 900],
  sun: { color: "#ffdba3", intensity: 3.2 },
  hemi: { sky: "#b4cdea", ground: "#8f7d68", intensity: 1.55 },
  exposure: 1.1,
};

/** asphalte, pavés, gravier, herbe, trottoir, dallage */
export const GROUND_PALETTE: [string, string, string, string, string, string] = ["#6e727b", "#a39585", "#c8b795", "#82b05e", "#d0c7b7", "#b5ad9f"];

const WALLS: Record<"old" | "xix" | "modern", string[]> = {
  old: ["#ecd9b0", "#e3c996", "#d9c4a0", "#efdcc0"],
  xix: ["#f1e2c4", "#ebd0a4", "#f0cfb0", "#e8d9bd", "#d9b99a", "#f3e9d3"],
  modern: ["#e9e2d4", "#d8d4c8", "#e6d6c0", "#cfd3cb"],
};

export const ROOFS: Record<RoofMaterial, string> = {
  tuile_plate: "#c9573c", tuile_mecanique: "#c0503a", ardoise: "#586783", zinc: "#8ea4b0", terrasse: "#aaa59b",
};
export const SHUTTERS = ["#6f9a82", "#5f84ab", "#a9503f", "#f3ebd6", "#7d5a3c", "#8aa56a"];
export const DOORS = ["#7d3f35", "#35506e", "#3f6b57", "#6e5238", "#b8892f"];
export const SHOPS = ["#a9503f", "#35506e", "#3f6b57", "#7d5a3c", "#b8892f", "#6f5a86"];
export const TRIM = "#f6efe0";
export const GLASS: [string, string] = ["#35506e", "#8fb4cc"];
export const TREES = ["#6fa35a", "#82b45f", "#5c9355", "#98bd62", "#7aa857"];

/** Clé stable [0, 1) tirée d'un identifiant (CRC-32), la même pour la silhouette (calculée à l'avance) et le détail. */
export function idKey(id: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < id.length; i++) {
    crc ^= id.charCodeAt(i);
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ((crc ^ 0xffffffff) >>> 0) / 4294967296;
}

export function pick<T>(list: readonly T[], key: number, salt = 0): T {
  return list[Math.floor(((key * 7919 + salt * 0.6180339) % 1) * list.length) % list.length]!;
}

/** Couleur de mur : une teinte de la palette de l'époque, très légèrement nuancée. */
export function wallColor(era: Era, key: number): THREE.Color {
  const group = era === "medieval" || era === "classical" ? "old" : era === "xix" ? "xix" : "modern";
  const c = new THREE.Color(pick(WALLS[group], key, 1));
  return c.multiplyScalar(0.96 + ((key * 131) % 1) * 0.08);
}

export function roofColor(material: RoofMaterial, key: number): THREE.Color {
  return new THREE.Color(ROOFS[material]).multiplyScalar(0.9 + ((key * 197) % 1) * 0.2);
}
