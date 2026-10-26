import * as THREE from "three";
import type { RoofMaterial } from "../data/types";

/** Un parti pris graphique : palette, lumière, matières sans texture. `?style=a|b|c` ; sans paramètre, le rendu texturé. */
export interface Style {
  id: string;
  label: string;
  sky: { horizon: string; zenith: string };
  fog: [string, number, number];
  sun: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  exposure: number;
  toon: boolean;
  /** Retouche des couleurs de mur et de toit venues des données : saturation (×), clarté (gain, décalage). */
  sat: number;
  light: [number, number];
  roofs: Record<RoofMaterial, string>;
  /** asphalte, pavés, gravier, herbe, trottoir, dallage */
  ground: [string, string, string, string, string, string];
  tree: { sat: number; light: [number, number] };
}

export const STYLES: Record<string, Style> = {
  a: {
    id: "a", label: "Maquette claire",
    sky: { horizon: "#f3e8dd", zenith: "#a6c8ea" }, fog: ["#f3e8dd", 240, 950],
    sun: { color: "#fff1de", intensity: 2.3 }, hemi: { sky: "#e3edf7", ground: "#f2e5d6", intensity: 2.2 },
    exposure: 1.05, toon: false, sat: 0.55, light: [0.45, 0.5],
    roofs: { tuile_plate: "#e3a58c", tuile_mecanique: "#dc9a82", ardoise: "#9aa8bd", zinc: "#bcc6ce", terrasse: "#cfcac0" },
    ground: ["#c4c7cf", "#d6c8b5", "#e8dcc2", "#c8e2ac", "#efeae0", "#e2dbcf"],
    tree: { sat: 0.55, light: [0.55, 0.42] },
  },
  b: {
    id: "b", label: "Low-poly chaleureux",
    sky: { horizon: "#f2dcbb", zenith: "#5f93cf" }, fog: ["#f2dcbb", 220, 900],
    sun: { color: "#ffd9a2", intensity: 3.3 }, hemi: { sky: "#a9c4e2", ground: "#8c7a62", intensity: 1.45 },
    exposure: 1.1, toon: false, sat: 0.9, light: [1.0, 0.0],
    roofs: { tuile_plate: "#c6573b", tuile_mecanique: "#bd5035", ardoise: "#4f5c70", zinc: "#8f9ba4", terrasse: "#8e8b83" },
    ground: ["#6e727b", "#a39585", "#c8b795", "#82b05e", "#d0c7b7", "#b5ad9f"],
    tree: { sat: 1.0, light: [1.0, 0.0] },
  },
  c: {
    id: "c", label: "Illustration contrastée",
    sky: { horizon: "#ffc890", zenith: "#3d6bb3" }, fog: ["#ffc890", 200, 850],
    sun: { color: "#ffcb86", intensity: 3.5 }, hemi: { sky: "#8fb1e0", ground: "#76665a", intensity: 1.3 },
    exposure: 1.1, toon: true, sat: 1.3, light: [1.0, 0.02],
    roofs: { tuile_plate: "#e2492f", tuile_mecanique: "#d9432b", ardoise: "#3b4876", zinc: "#7ea2b3", terrasse: "#a69f90" },
    ground: ["#4a506a", "#9c8672", "#d6b880", "#69b659", "#eae1ce", "#a69b89"],
    tree: { sat: 1.25, light: [1.0, 0.03] },
  },
};

let gradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const hsl = { h: 0, s: 0, l: 0 };
const tmp = new THREE.Color();

function remap(c: THREE.Color, sat: number, light: [number, number]): void {
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * sat), Math.min(0.95, hsl.l * light[0] + light[1]));
}

/** Matières et retouches d'un style, appliquées aux maillages d'une tuile. */
export class Styler {
  private readonly cache = new Map<string, THREE.Material>();

  constructor(readonly style: Style) {}

  private material(key: string, color: string | null, vertexColors: boolean): THREE.Material {
    let m = this.cache.get(key);
    if (!m) {
      const p = { vertexColors, ...(color ? { color } : {}), ...(key.startsWith("roof") ? { side: THREE.DoubleSide } : {}) };
      m = this.style.toon ? new THREE.MeshToonMaterial({ ...p, gradientMap: toonGradient() }) : new THREE.MeshLambertMaterial(p);
      this.cache.set(key, m);
    }
    return m;
  }

  apply(root: THREE.Object3D): void {
    const st = this.style;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.name.startsWith("sprites-") || m.name.startsWith("enseignes-")) {
        m.visible = false;
        return;
      }
      if (m.name === "grilles") return;
      const inst = o as THREE.InstancedMesh;
      if (inst.isInstancedMesh && inst.instanceColor) {
        for (let i = 0; i < inst.count; i++) {
          inst.getColorAt(i, tmp);
          remap(tmp, st.tree.sat, st.tree.light);
          inst.setColorAt(i, tmp);
        }
        inst.instanceColor.needsUpdate = true;
        m.material = this.material("crown", null, false);
        return;
      }
      if (inst.isInstancedMesh) {
        m.material = this.material("trunk", "#6b5440", false);
        return;
      }
      const col = m.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
      if (!col || m.geometry.userData["styled"]) return;
      m.geometry.userData["styled"] = true;
      const roof = m.name.startsWith("toit-") ? (m.name.slice(5) as RoofMaterial) : null;
      for (let i = 0; i < col.count; i++) {
        tmp.setRGB(col.getX(i), col.getY(i), col.getZ(i));
        if (roof) tmp.setRGB(1 + (tmp.r - 1) * 0.5, 1 + (tmp.g - 1) * 0.5, 1 + (tmp.b - 1) * 0.5);
        else remap(tmp, st.sat, st.light);
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      col.needsUpdate = true;
      m.material = roof ? this.material(`roof-${roof}`, st.roofs[roof], true) : this.material("flat", null, true);
    });
  }
}
