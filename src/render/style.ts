import * as THREE from "three";
import type { Era, RoofMaterial } from "../data/types";

/** Direction artistique : palette, lumière, ciel, matières. `affiche` par défaut, `?style=nuit` pour la nuit. */
export interface Theme {
  id: string;
  label: string;
  sky: { horizon: string; mid: string; zenith: string; bands: number; disc: number; stars: number; clouds: number };
  fog: [string, number, number];
  sun: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  exposure: number;
  /** Colorimétrie : « aces » (cinéma) ou « neutral » (couleurs de la palette préservées). */
  tone: "aces" | "neutral";
  /** Ombrage par paliers (affiche, illustration). */
  toon: boolean;
  /** Grain de papier et vignette en surimpression : [grain, vignette], de 0 à 1. */
  overlay: [number, number];
  walls: Record<"old" | "xix" | "modern", string[]>;
  roofs: Record<RoofMaterial, string>;
  shutters: string[];
  doors: string[];
  shops: string[];
  trim: string;
  glass: [string, string];
  trees: string[];
  trunk: string;
  /** Eau, terrains de sport. */
  water: string;
  pitch: string;
  /** asphalte, pavés, gravier, herbe, trottoir, dallage */
  ground: [string, string, string, string, string, string];
  /** Rues piétonnes du centre (D156) : pavés de granit, pavés de béton, béton clair des zones de rencontre, caniveau ; parvis de l'Hexagone (D167) : brique rose, ardoise, fond clair et filets. */
  paving: [string, string, string, string, string, string, string];
}

export const THEMES: Record<string, Theme> = {
  affiche: {
    id: "affiche", label: "Affiche de voyage",
    sky: { horizon: "#f8dcae", mid: "#8fd0cf", zenith: "#2a86ad", bands: 7, disc: 1, stars: 0, clouds: 1 },
    fog: ["#f2cf9a", 180, 800],
    sun: { color: "#ffe2b0", intensity: 3.0 }, hemi: { sky: "#8fc3c4", ground: "#c0603a", intensity: 1.3 },
    exposure: 1.0, tone: "neutral", toon: true, overlay: [0.07, 0.22],
    walls: { old: ["#f3d9a0", "#efc982"], xix: ["#f5dfae", "#f1cf8a", "#f4c9a0"], modern: ["#e9dcc0", "#e2d2b0"] },
    roofs: { tuile_plate: "#d9472b", tuile_mecanique: "#cf4026", ardoise: "#2f4a63", zinc: "#6f98a3", terrasse: "#b9a98a" },
    shutters: ["#2f7f8f", "#d9472b", "#f1b24a", "#1f4a63"], doors: ["#1f4a63", "#d9472b", "#2f7f8f"], shops: ["#d9472b", "#1f4a63", "#2f7f8f", "#f1b24a"],
    trim: "#fff3d6", glass: ["#1f4a63", "#7fc1c9"], trees: ["#2f7f6a", "#3f9a6f", "#5aa874", "#2a6b5e", "#3f9a6f", "#5aa874", "#e0a030", "#d9642b"], trunk: "#6b4a3a", water: "#4fb0c6", pitch: "#57a06a",
    ground: ["#7d8a8e", "#c79a6b", "#e3bf86", "#5fa06e", "#efdcb4", "#d6b98a"],
    paving: ["#b4b3ad", "#9c9b99", "#dcd6c8", "#585e61", "#cf9483", "#74808a", "#e4dac8"],
  },
  nuit: {
    id: "nuit", label: "Autun la nuit",
    sky: { horizon: "#2a3a6b", mid: "#18285a", zenith: "#080d24", bands: 0, disc: 0, stars: 1, clouds: 0 },
    fog: ["#27356b", 90, 560],
    sun: { color: "#a9bfff", intensity: 2.0 }, hemi: { sky: "#4a62b0", ground: "#2a2a48", intensity: 2.4 },
    exposure: 1.25, tone: "aces", toon: false, overlay: [0, 0.3],
    walls: { old: ["#6e6a7c", "#7b6f78"], xix: ["#6a6f86", "#74707f", "#7d7582"], modern: ["#5f6678", "#666b7d"] },
    roofs: { tuile_plate: "#6b3f4d", tuile_mecanique: "#63394a", ardoise: "#2f3b5c", zinc: "#4f6580", terrasse: "#4c5068" },
    shutters: ["#2b4a5e", "#5a3550", "#3c5a50"], doors: ["#3a2f45", "#2b4a5e"], shops: ["#5a3550", "#2b4a5e", "#3c5a50"],
    trim: "#9aa0b8", glass: ["#10182e", "#2a3a5e"], trees: ["#1f4a4a", "#25564f", "#1c3f47"], trunk: "#2a2530", water: "#1d3a6e", pitch: "#2f4a48",
    ground: ["#4a5273", "#6a6480", "#7d7690", "#3f6a6a", "#7a80a0", "#666c8c"],
    paving: ["#6b7090", "#5d6280", "#868aa4", "#343a58", "#7c6178", "#4a5470", "#8e8aa2"],
  },
};

/** Thème en vigueur (rempli au démarrage par `useTheme`). */
export const T: Theme = { ...THEMES["affiche"]! };

export function useTheme(id: string): Theme | null {
  const theme = THEMES[id];
  if (!theme) return null;
  Object.assign(T, theme);
  return T;
}

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
  const c = new THREE.Color(pick(T.walls[group], key, 1));
  return c.multiplyScalar(0.96 + ((key * 131) % 1) * 0.08);
}

export function roofColor(material: RoofMaterial, key: number): THREE.Color {
  return new THREE.Color(T.roofs[material]).multiplyScalar(0.9 + ((key * 197) % 1) * 0.2);
}
