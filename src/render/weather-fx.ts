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
  /** Saison des arbres (D197) : vert tendre, couleurs d'automne, arbres nus, herbe jaunie (voir `core/seasons.ts`). */
  uLeaf: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** Saison du sol (D197) : feuilles mortes, herbe terne. */
  uSoil: { value: new THREE.Vector2(0, 0) },
};

/** Ce que la matière porte : `ground` sol et relief (horizontal), `roof` toits en pente, `wall` bâti (seulement ses faces tournées vers le ciel), `crown` feuillage des arbres (saison et neige). */
export type WeatherSurface = "ground" | "roof" | "wall" | "crown";

/** À partir de quelle pente une face reçoit la pluie et la neige (composante verticale de la normale) : début et plein effet. */
const UP: Record<WeatherSurface, [number, number]> = { ground: [0.55, 0.85], roof: [0.3, 0.55], wall: [0.7, 0.92], crown: [0.15, 0.6] };

const VERTEX_HEAD = /* glsl */ `
varying vec3 vWxPos;
varying vec3 vWxN;`;

/**
 * Feuillage (D197) : chaque arbre tire un nombre (`vWxTree`) de sa position (la profondeur de l'instance, commune aux deux boules d'un
 * même arbre) ; un sur huit est persistant. Les arbres nus rétrécissent (30 %) : à mettre avant le calcul de la position.
 */
const CROWN_VERTEX_HEAD = /* glsl */ `
uniform vec4 uLeaf;
varying float vWxTree;
varying float vWxBare;`;
const CROWN_VERTEX_BODY = /* glsl */ `
{
  #ifdef USE_INSTANCING
    vWxTree = fract(sin(instanceMatrix[3].z * 13.137 + 0.71) * 43758.5453);
  #else
    vWxTree = 0.3;
  #endif
  float wxLag = 0.3 * fract(vWxTree * 7.0);
  vWxBare = (1.0 - step(vWxTree, 0.12)) * smoothstep(wxLag, wxLag + 0.5, uLeaf.z);
  // Seules les couronnes instanciées (centrées sur leur origine) rétrécissent ; un feuillage taillé garde sa forme.
  #ifdef USE_INSTANCING
    transformed *= 1.0 - 0.3 * vWxBare;
  #endif
}`;

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
uniform vec4 uLeaf;
uniform vec2 uSoil;
vec3 wxLin(vec3 c) { return c * c; }
float wxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wxHash(i), wxHash(i + vec2(1.0, 0.0)), f.x), mix(wxHash(i + vec2(0.0, 1.0)), wxHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float wxPuddle = 0.0;
float wxCover = 0.0;
float wxUp = 0.0;`;

/** Feuillage selon la saison (D197) : orangés ramenés au vert l'été, vert tendre, couleurs d'automne propres à chaque arbre, puis brun et ajouré. */
const CROWN_SEASON = /* glsl */ `
if (vWxTree > 0.12) {
  vec3 wxC = diffuseColor.rgb;
  // Les arbres orangés de la palette sont verts tant que l'automne n'est pas venu.
  float wxOrange = step(wxC.g * 1.05, wxC.r);
  wxC = mix(wxC, wxLin(vec3(0.24, 0.52, 0.36)) * (0.8 + 0.4 * fract(vWxTree * 31.0)), wxOrange);
  wxC = mix(wxC, wxLin(vec3(0.62, 0.8, 0.36)) * (0.85 + 0.3 * fract(vWxTree * 17.0)), uLeaf.x * 0.7);
  float wxLag = 0.35 * fract(vWxTree * 5.0);
  float wxTurn = smoothstep(wxLag, wxLag + 0.5, uLeaf.y);
  float wxK = fract(vWxTree * 3.7);
  vec3 wxFall = wxK < 0.4 ? wxLin(vec3(0.9, 0.68, 0.2)) : wxK < 0.75 ? wxLin(vec3(0.88, 0.45, 0.16)) : wxLin(vec3(0.72, 0.24, 0.13));
  wxC = mix(wxC, wxFall, wxTurn);
  wxC = mix(wxC, wxLin(vec3(0.45, 0.36, 0.3)), vWxBare * 0.9);
  diffuseColor.rgb = wxC;
  // Ajouré : des trous dans la couronne d'un arbre qui perd ses feuilles.
  if (vWxBare > 0.01 && wxNoise(vWxPos.xz * 2.2 + vec2(vWxPos.y * 1.7)) < vWxBare * 0.45) discard;
}`;

/** Sol selon la saison (D197) : herbe jaunie ou terne, feuilles mortes en taches. */
const GROUND_SEASON = /* glsl */ `
if (wxUp > 0.0 && uLeaf.w + uSoil.x + uSoil.y > 0.001) {
  float wxGrass = smoothstep(0.01, 0.05, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
  float wxL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(wxL * 1.45, wxL * 1.2, wxL * 0.35), wxGrass * uLeaf.w);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(wxL * 1.05, wxL, wxL * 0.85) * 0.92, wxGrass * uSoil.y * 0.65);
  float wxLit = uSoil.x * wxUp;
  float wxNL = wxNoise(vWxPos.xz * 1.7) * 0.6 + wxNoise(vWxPos.xz * 5.1 + 3.0) * 0.4;
  float wxLeaf = smoothstep(0.8 - 0.22 * wxLit, 0.82 - 0.22 * wxLit, wxNL) * step(0.001, wxLit);
  vec3 wxLc = mix(wxLin(vec3(0.85, 0.52, 0.16)), wxLin(vec3(0.6, 0.32, 0.14)), wxHash(floor(vWxPos.xz * 3.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, wxLc, wxLeaf * (0.45 + 0.55 * wxGrass));
}`;

/** Après la couleur de base : la saison (feuillage, herbe), puis la météo : assombrir ce qui est mouillé, creuser les flaques, blanchir la neige. */
const fragmentColor = (s: WeatherSurface): string => /* glsl */ `
wxUp = smoothstep(${UP[s][0].toFixed(2)}, ${UP[s][1].toFixed(2)}, vWxN.y);
${s === "crown" ? CROWN_SEASON : s === "ground" ? GROUND_SEASON : ""}
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
  totalEmissiveRadiance += uSkyTint * (wxPuddle * (0.03 + 0.28 * wxFres) + uWet * wxUp * 0.08 * wxFres) * (1.0 - wxCover);
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
    shader.uniforms["uLeaf"] = weatherUniforms.uLeaf;
    shader.uniforms["uSoil"] = weatherUniforms.uSoil;
    const crown = surface === "crown";
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${VERTEX_HEAD}${crown ? CROWN_VERTEX_HEAD : ""}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>${crown ? CROWN_VERTEX_BODY : ""}${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${FRAGMENT_HEAD}${crown ? "\nvarying float vWxTree;\nvarying float vWxBare;" : ""}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${fragmentColor(surface)}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>${surface === "crown" ? "" : FRAGMENT_SHEEN}`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|wx-${surface}`;
  return mat;
}

/**
 * Ombre du feuillage (D197) : la matière de profondeur des couronnes rétrécit et ajoure les arbres nus comme la matière visible, pour
 * qu'un arbre nu ne porte pas l'ombre d'un arbre feuillu. À donner en `customDepthMaterial` au maillage des couronnes.
 */
export function crownDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms["uLeaf"] = weatherUniforms.uLeaf;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${CROWN_VERTEX_HEAD}\nvarying vec3 vWxPos;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>${CROWN_VERTEX_BODY}
{
  vec4 wxP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wxP = instanceMatrix * wxP;
  #endif
  vWxPos = (modelMatrix * wxP).xyz;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${FRAGMENT_HEAD.replace("varying vec3 vWxN;", "")}\nvarying float vWxTree;\nvarying float vWxBare;`)
      .replace("#include <alphatest_fragment>", `#include <alphatest_fragment>
if (vWxTree > 0.12 && vWxBare > 0.01 && wxNoise(vWxPos.xz * 2.2 + vec2(vWxPos.y * 1.7)) < vWxBare * 0.45) discard;`);
  };
  mat.customProgramCacheKey = () => "wx-crown-depth";
  return mat;
}

/** Règle la saison affichée (arbres, herbe, feuilles mortes). */
export function setSeasonLook(l: { fresh: number; turn: number; bare: number; dry: number; dull: number; litter: number }): void {
  weatherUniforms.uLeaf.value.set(l.fresh, l.turn, l.bare, l.dry);
  weatherUniforms.uSoil.value.set(l.litter, l.dull);
}

/** Règle la météo affichée : sol mouillé, neige au sol, couleur du ciel reflété. */
export function setGroundWeather(wet: number, snow: number, sky: THREE.Color): void {
  weatherUniforms.uWet.value = wet;
  weatherUniforms.uSnow.value = snow;
  weatherUniforms.uSkyTint.value.copy(sky);
}
