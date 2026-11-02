import type * as THREE from "three";
import { SCHEDULES } from "../core/opening";

/**
 * Lumières de la ville à l'écran (D200) : fenêtres allumées une à une, lampadaires qui s'allument chacun à son tour, vitrines éclairées
 * le soir quand le commerce est ouvert, rideaux de fer baissés quand il est fermé. Chaque sommet porte une étiquette (`aTag`, posée à
 * la construction des tuiles) ; quelques uniformes partagés disent ce qui est allumé : aucune tuile à reconstruire, aucune recompilation.
 *
 * Étiquettes : 0 toujours allumé avec la nuit (lanternes, globes) ; ]0, 1[ fenêtre (son seuil) ; [1, 2[ lampadaire (1 + son seuil) ;
 * 2 + i commerce de l'horaire type i (`SCHEDULES`).
 */
export const lightUniforms = {
  /** Part des fenêtres allumées (0 à 1). */
  uWin: { value: 0 },
  /** Niveau d'allumage des lampadaires (0 à 1). */
  uLamp: { value: 0 },
  /** Ouverture de chaque horaire type (1 ouvert, 0 fermé). */
  uShop: { value: new Array<number>(SCHEDULES.length).fill(0) },
};

export const TAG = { always: 0, lamp: 1, shop: 2 } as const;

const VERTEX = { head: "attribute float aTag;\nvarying float vTag;", body: "vTag = aTag;" };
const FRAGMENT_HEAD = `varying float vTag;
uniform float uWin;
uniform float uLamp;
uniform float uShop[${SCHEDULES.length}];
float shopOpen(float t) {
  int k = int(t - 2.0 + 0.5);
  float o = 0.0;
  for (int i = 0; i < ${SCHEDULES.length}; i++) if (i == k) o = uShop[i];
  return o;
}`;

/** Le verre allumé (et les halos) : chaque élément ne s'allume que si son étiquette le permet. */
const GLOW_FRAGMENT = `{
  float on = 1.0;
  if (vTag > 0.0005 && vTag < 1.0) on = clamp((uWin - vTag) * 25.0, 0.0, 1.0);
  else if (vTag >= 1.0 && vTag < 2.0) on = clamp((uLamp - (vTag - 1.0)) * 12.0, 0.0, 1.0);
  else if (vTag >= 2.0) on = shopOpen(vTag);
  if (on < 0.01) discard;
  diffuseColor.a *= on;
}`;

/** Rideau de fer : visible seulement quand le commerce est fermé. */
const SHUTTER_FRAGMENT = "if (vTag >= 2.0 && shopOpen(vTag) > 0.5) discard;";

/** Branche une matière sur les lumières de la ville : `glow` (verre allumé, halos) ou `shutter` (rideaux de fer). Une fois par matière. */
export function cityLights<M extends THREE.Material>(mat: M, mode: "glow" | "shutter"): M {
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms["uWin"] = lightUniforms.uWin;
    shader.uniforms["uLamp"] = lightUniforms.uLamp;
    shader.uniforms["uShop"] = lightUniforms.uShop;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX.head}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX.body}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${mode === "glow" ? GLOW_FRAGMENT : SHUTTER_FRAGMENT}`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|lights-${mode}`;
  return mat;
}

/** Règle les lumières : part des fenêtres, lampadaires, ouverture des commerces. */
export function setCityLights(win: number, lamp: number, shops: readonly number[]): void {
  lightUniforms.uWin.value = win;
  lightUniforms.uLamp.value = lamp;
  for (let i = 0; i < lightUniforms.uShop.value.length; i++) lightUniforms.uShop.value[i] = shops[i] ?? 0;
}
