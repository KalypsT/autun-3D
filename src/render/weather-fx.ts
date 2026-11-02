import * as THREE from "three";

/**
 * Sol mouillé, flaques et neige au sol (D196) : quelques lignes ajoutées aux nuanceurs des matières de sol, de relief, de toits et de
 * bâti, qui lisent des uniformes **partagés** (un seul objet pour toutes les matières : changer la météo ne recompile rien et ne touche
 * aucune matière). Aucune texture : les flaques et les plaques de neige viennent d'un bruit calculé en coordonnées du monde.
 *
 * Analogie : un vernis passé sur tout le décor, dont on règle l'épaisseur d'un seul bouton.
 */

/** Uniformes partagés par toutes les matières patinées. */
export const weatherUniforms = {
  /** Sol mouillé, 0 à 1. */
  uWet: { value: 0 },
  /** Neige (ou givre) au sol, 0 à 1. */
  uSnow: { value: 0 },
  /** Couleur que reflètent les flaques (le bas du ciel), déjà assombrie la nuit. */
  uSkyTint: { value: new THREE.Color("#c8d4dc") },
};

/** Ce que la matière porte : `ground` sol et relief (horizontal), `roof` toits en pente, `wall` bâti (seulement ses faces tournées vers le ciel), `crown` feuillage (neige seulement). */
export type WeatherSurface = "ground" | "roof" | "wall" | "crown";

/** À partir de quelle pente une face reçoit la pluie et la neige (composante verticale de la normale) : début et plein effet. */
const UP: Record<WeatherSurface, [number, number]> = { ground: [0.55, 0.85], roof: [0.3, 0.55], wall: [0.7, 0.92], crown: [0.15, 0.6] };

const VERTEX_HEAD = /* glsl */ `
varying vec3 vWxPos;
varying vec3 vWxN;`;

const VERTEX_BODY = /* glsl */ `
{
  vec4 wxP = vec4(transformed, 1.0);
  vec3 wxN = objectNormal;
  #ifdef USE_INSTANCING
    wxP = instanceMatrix * wxP;
    wxN = mat3(instanceMatrix) * wxN;
  #endif
  wxP = modelMatrix * wxP;
  vWxPos = wxP.xyz;
  vWxN = normalize(mat3(modelMatrix) * wxN);
}`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vWxPos;
varying vec3 vWxN;
uniform float uWet;
uniform float uSnow;
uniform vec3 uSkyTint;
float wxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wxHash(i), wxHash(i + vec2(1.0, 0.0)), f.x), mix(wxHash(i + vec2(0.0, 1.0)), wxHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float wxPuddle = 0.0;
float wxCover = 0.0;
float wxUp = 0.0;`;

/** Après la couleur de base : assombrir ce qui est mouillé, creuser les flaques, blanchir la neige. */
const fragmentColor = (s: WeatherSurface): string => /* glsl */ `
wxUp = smoothstep(${UP[s][0].toFixed(2)}, ${UP[s][1].toFixed(2)}, vWxN.y);
if (wxUp > 0.0 && (uWet > 0.001 || uSnow > 0.001)) {
  vec2 wxQ = vWxPos.xz;
  ${s === "crown" ? "" : /* glsl */ `
  // Sol mouillé : plus sombre ; flaques là où le bruit est haut, qui s'étendent avec la pluie.
  float wxN1 = wxNoise(wxQ * 0.32) * 0.65 + wxNoise(wxQ * 0.9 + 5.3) * 0.35;
  ${s === "ground" ? "wxPuddle = uWet * wxUp * smoothstep(0.75 - 0.04 * uWet, 0.78 - 0.04 * uWet, wxN1);" : ""}
  diffuseColor.rgb *= 1.0 - uWet * wxUp * 0.32;
  diffuseColor.rgb *= 1.0 - wxPuddle * 0.5;`}
  // Neige : couvre d'abord par plaques (bruit), puis tout ; un peu moins sur le feuillage.
  float wxN2 = wxNoise(wxQ * 0.35 + 11.7) * 0.6 + wxNoise(wxQ * 1.3) * 0.4;
  float wxAmount = uSnow * wxUp${s === "crown" ? " * 0.8" : ""};
  wxCover = smoothstep(1.0 - wxAmount * 1.25, 1.12 - wxAmount * 1.25, wxN2) * min(wxAmount * 3.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.99), wxCover);
}`;

/** Avec la lumière émise : le reflet du ciel dans les flaques et un léger lustre sur le sol mouillé, à jour frisant. */
const FRAGMENT_SHEEN = /* glsl */ `
if (wxUp > 0.0 && uWet > 0.001) {
  float wxFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 4.0);
  totalEmissiveRadiance += uSkyTint * (wxPuddle * (0.03 + 0.5 * wxFres) + uWet * wxUp * 0.1 * wxFres) * (1.0 - wxCover);
}`;

/**
 * Ajoute la météo au nuanceur d'une matière (en gardant son propre `onBeforeCompile`) et donne une clé de programme distincte par sorte
 * de surface, pour que deux matières patinées différemment ne partagent pas un programme. À appeler une fois par matière.
 */
export function weatherize<M extends THREE.Material>(mat: M, surface: WeatherSurface): M {
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms["uWet"] = weatherUniforms.uWet;
    shader.uniforms["uSnow"] = weatherUniforms.uSnow;
    shader.uniforms["uSkyTint"] = weatherUniforms.uSkyTint;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${VERTEX_HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${FRAGMENT_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${fragmentColor(surface)}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>${surface === "crown" ? "" : FRAGMENT_SHEEN}`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|wx-${surface}`;
  return mat;
}

/** Règle la météo affichée : sol mouillé, neige au sol, couleur du ciel reflété. */
export function setGroundWeather(wet: number, snow: number, sky: THREE.Color): void {
  weatherUniforms.uWet.value = wet;
  weatherUniforms.uSnow.value = snow;
  weatherUniforms.uSkyTint.value.copy(sky);
}
