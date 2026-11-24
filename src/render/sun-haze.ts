import * as THREE from "three";

/**
 * Brume teintée par le soleil (D315) : au lever et au coucher, le brouillard est plus chaud du côté du soleil et plus froid (violet)
 * du côté opposé, comme le ciel. Le brouillard de three.js n'a qu'une couleur ; on remplace ses morceaux de nuanceur (`fog_*`) pour
 * qu'il lise trois uniformes de plus, **partagés** par toutes les matières.
 *
 * Partage : three.js recopie les uniformes de sa bibliothèque (`ShaderLib`) pour chaque matière, sauf les valeurs qui ne sont pas des
 * objets three.js (un simple `{ x, y, z, w }` est passé tel quel). On ajoute donc à chaque entrée de `ShaderLib` qui a du brouillard des
 * uniformes dont la valeur est un objet simple, le même pour toutes : changer la brume ne recompile rien et ne touche aucune matière.
 * Le ciel (`sky.ts`) reçoit les mêmes objets, pour que l'horizon et le brouillard se raccordent.
 *
 * À appeler une fois, avant le premier rendu (les nuanceurs déjà compilés ne changeraient pas).
 */

/** Direction horizontale du soleil (x, z du repère three) et force (w, 0 : aucune teinte, la brume d'avant). */
export const sunHazeDir = { x: 1, y: 0, z: 0, w: 0 };
/** Couleur de la brume du côté du soleil, et du côté opposé (couleurs linéaires). */
export const sunHazeColor = { r: 1, g: 0.55, b: 0.3 };
export const sunHazeAnti = { r: 0.45, g: 0.38, b: 0.62 };

/** Uniformes à donner aux nuanceurs qui veulent la même teinte (ciel). */
export const sunHazeUniforms = {
  sunHazeDir: { value: sunHazeDir },
  sunHazeColor: { value: sunHazeColor },
  sunHazeAnti: { value: sunHazeAnti },
};

/** Teinte de la brume selon la direction horizontale `fd` (GLSL ; `fogColor` de départ dans `c`). */
export const SUN_HAZE_GLSL = /* glsl */ `
vec3 sunHazeTint(vec3 c, vec2 fd) {
  float lh = length(fd);
  if (sunHazeDir.w <= 0.0 || lh < 1e-4) return c;
  float sa = dot(fd / lh, sunHazeDir.xz);
  c = mix(c, sunHazeColor, sunHazeDir.w * 0.85 * pow(max(sa, 0.0), 1.5));
  return mix(c, sunHazeAnti, sunHazeDir.w * 0.85 * max(-sa, 0.0));
}`;

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogDir;
#endif
`;

// Direction de la caméra vers le point, dans le repère du monde : (vue) × matrice de vue, soit la rotation inverse.
const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogDir;
  uniform vec4 sunHazeDir;
  uniform vec3 sunHazeColor;
  uniform vec3 sunHazeAnti;
  ${SUN_HAZE_GLSL}
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, sunHazeTint( fogColor, vFogDir.xz ), fogFactor );
#endif
`;

let installed = false;

/** Remplace les morceaux de brouillard et ajoute les uniformes partagés à la bibliothèque de three.js (une fois). */
export function installSunHaze(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FRAGMENT;
  for (const shader of Object.values(THREE.ShaderLib)) {
    if (shader.uniforms["fogColor"]) Object.assign(shader.uniforms, sunHazeUniforms);
  }
}

const tmp = new THREE.Color();
/** Règle la brume : direction du soleil (repère three, horizontale), force (0 à 1) et couleurs (sRGB, comme la palette). */
export function setSunHaze(sunX: number, sunZ: number, k: number, toward: THREE.ColorRepresentation, away: THREE.ColorRepresentation): void {
  const l = Math.hypot(sunX, sunZ) || 1;
  Object.assign(sunHazeDir, { x: sunX / l, y: 0, z: sunZ / l, w: Math.max(0, Math.min(1, k)) });
  tmp.set(toward);
  Object.assign(sunHazeColor, { r: tmp.r, g: tmp.g, b: tmp.b });
  tmp.set(away);
  Object.assign(sunHazeAnti, { r: tmp.r, g: tmp.g, b: tmp.b });
}
