import * as THREE from "three";
import type { WorldManifest } from "../data/types";
import { WAVE_LOOP, WAVES_GLSL } from "../core/waves";
import { T } from "./style";
import { toonGradient } from "./stylized";

/** Côté du plan d'eau d'avant (m) : au-delà du brouillard dans toutes les directions. */
const SEA_SIZE = 30000;
/** Écume d'avant (mer plate, « Mer animée » coupée) : bande de FOAM_NEAR à FOAM_FAR mètres au large du trait de côte. */
const FOAM_NEAR = 3;
const FOAM_FAR = 10;

/**
 * Profil du rivage (D105, `coast_lib.shore_cap`) : sur le trait de côte, le sol est à 1,6 m au-dessus de l'eau, puis le fond descend de
 * 22 cm par mètre vers le large. L'eau commence donc à ≈ 7,3 m du trait de côte : l'écume vivante est posée de LIVE_NEAR à LIVE_FAR mètres
 * (la partie sous le sable ne se voit pas).
 */
const SHORE_ABOVE = 1.6;
const SEABED_SLOPE = 0.22;
const LIVE_NEAR = 5;
const LIVE_FAR = 18;
/** Pas du ruban d'écume vivante le long de la côte (m) : assez fin pour suivre les vagues (7 à 22 m de long). */
const LIVE_STEP = 2;

/** Pas du centre de la grille de la mer (m) : elle suit la caméra par sauts, pour que ses sommets ne glissent pas sur les vagues. */
const GRID_SNAP = 4;

/**
 * La mer qui entoure le monde (D105), vivante (D316) : vagues, écume qui va et vient au rivage, reflets du ciel, paillettes du soleil ou de
 * la lune, crêtes blanches par vent fort. Deux appels de dessin, comme avant. « Mer animée » coupée : la mer plate d'avant.
 */
export class Sea {
  readonly group = new THREE.Group();
  /** Uniformes partagés par la mer et l'écume (un seul objet : rien n'est recompilé quand ils changent). */
  readonly uniforms = {
    uSeaTime: { value: 0 },
    uSeaAmp: { value: 0.15 },
    uSkyHorizon: { value: new THREE.Color("#bfd2e4") },
    uSkyZenith: { value: new THREE.Color("#4a84c4") },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uGlint: { value: new THREE.Color(0, 0, 0) },
    uCrest: { value: 0 },
  };
  private readonly live = new THREE.Group();
  private readonly flat = new THREE.Group();
  private animatedValue = true;

  constructor(manifest: WorldManifest & { sea: NonNullable<WorldManifest["sea"]> }, toon: boolean, sky?: { horizon: THREE.Color; zenith: THREE.Color }) {
    this.group.name = "mer";
    // Le ciel qui se reflète : les mêmes couleurs que le dôme (mêmes objets).
    if (sky) {
      this.uniforms.uSkyHorizon.value = sky.horizon;
      this.uniforms.uSkyZenith.value = sky.zenith;
    }
    const { sea } = manifest;
    const water = new THREE.Color(T.water);
    const gradient = toon ? toonGradient() : null;
    const lit = (p: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial | THREE.MeshLambertMaterial =>
      gradient ? new THREE.MeshToonMaterial({ ...p, gradientMap: gradient }) : new THREE.MeshLambertMaterial(p);

    // Mer vivante : une grille polaire qui suit la caméra, jusqu'à 15 km.
    const grid = new THREE.Mesh(seaGrid(), this.liveWater(lit({ color: water, side: THREE.DoubleSide })));
    grid.name = "mer";
    grid.position.y = sea.z;
    grid.frustumCulled = false;
    grid.receiveShadow = true;
    this.live.add(grid);
    const ribbon = liveFoamGeometry(sea.coast, sea.z + 0.04);
    if (ribbon) {
      const f = new THREE.Mesh(ribbon, this.liveFoam(lit({ color: "#f4f8f6", transparent: true, depthWrite: false })));
      f.name = "écume";
      f.receiveShadow = true;
      f.renderOrder = 1;
      // Seul le morceau de côte proche de la caméra est dessiné (± 800 m le long de la côte) : l'écume plus loin ne se voit pas.
      f.frustumCulled = false;
      const near = new FoamWindow(ribbon);
      f.onBeforeRender = (_r, _s, camera) => near.update(camera.position.x, -camera.position.z);
      this.live.add(f);
    }

    // Mer d'avant : un plan et un ruban plat.
    const [x0, y0, x1, y1] = manifest.zone;
    const plane = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE);
    plane.rotateX(-Math.PI / 2);
    plane.translate((x0 + x1) / 2, sea.z, -(y0 + y1) / 2);
    const mesh = new THREE.Mesh(plane, lit({ color: water, side: THREE.DoubleSide }));
    mesh.name = "mer";
    mesh.receiveShadow = true;
    this.flat.add(mesh);
    const foam = foamGeometry(sea.coast, sea.z + 0.03);
    if (foam) {
      const f = new THREE.Mesh(foam, lit({ color: water.clone().lerp(new THREE.Color("#ffffff"), 0.55) }));
      f.name = "écume";
      f.receiveShadow = true;
      this.flat.add(f);
    }
    this.group.add(this.live, this.flat);
    this.animated = true;
  }

  get animated(): boolean {
    return this.animatedValue;
  }

  /** Réglage « Mer animée » : la mer vivante, ou la mer plate d'avant. */
  set animated(on: boolean) {
    this.animatedValue = on;
    this.live.visible = on;
    this.flat.visible = !on;
  }

  /**
   * À chaque image : temps (s, réel), amplitude des vagues (m), crêtes blanches (0 à 1), direction de la lumière (soleil ou lune, repère
   * three), couleur des paillettes (déjà pondérée : nulle par ciel couvert).
   */
  update(time: number, amp: number, crest: number, lightDir: THREE.Vector3, glint: THREE.Color): void {
    const u = this.uniforms;
    u.uSeaTime.value = time % WAVE_LOOP;
    u.uSeaAmp.value = amp;
    u.uCrest.value = crest;
    u.uSunDir.value.copy(lightDir);
    u.uGlint.value.copy(glint);
  }

  private liveWater<M extends THREE.Material>(m: M): M {
    m.customProgramCacheKey = () => "mer-vivante";
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nuniform float uSeaTime;\nuniform float uSeaAmp;\nvarying vec3 vSeaWorld;\n${WAVES_GLSL}`)
        .replace("#include <begin_vertex>", SEA_VERTEX);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${SEA_FRAGMENT_HEAD}\n${WAVES_GLSL}`)
        .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>\n${SEA_NORMAL}`)
        .replace("#include <opaque_fragment>", `${SEA_COLOR}\n#include <opaque_fragment>`);
    };
    return m;
  }

  private liveFoam<M extends THREE.Material>(m: M): M {
    m.customProgramCacheKey = () => "ecume-vivante";
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nuniform float uSeaTime;\nuniform float uSeaAmp;\nattribute vec2 aFoam;\nvarying vec2 vFoam;\n${WAVES_GLSL}`)
        .replace("#include <begin_vertex>", FOAM_VERTEX);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nuniform float uSeaTime;\nuniform float uSeaAmp;\nvarying vec2 vFoam;`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${FOAM_PATTERN}`);
    };
    return m;
  }
}

/** Colonnes de l'écume vivante dessinées de part et d'autre de la plus proche de la caméra (2 m chacune). */
const FOAM_WINDOW = 400;

/**
 * Fenêtre de l'écume vivante : la plage d'indices du ruban autour de la colonne la plus proche de la caméra (cherchée de nouveau quand la
 * caméra a bougé de plus de 20 m). Près du début de l'anneau, où la fenêtre passerait d'un bout à l'autre, tout le ruban est dessiné.
 */
export class FoamWindow {
  private readonly cols: Float32Array;
  private readonly perColumn: number;
  private lastX = Infinity;
  private lastY = Infinity;

  constructor(private readonly geometry: THREE.BufferGeometry) {
    this.cols = geometry.userData["columns"] as Float32Array;
    this.perColumn = geometry.userData["indicesPerColumn"] as number;
  }

  update(x: number, y: number): void {
    if (Math.hypot(x - this.lastX, y - this.lastY) < 20) return;
    this.lastX = x;
    this.lastY = y;
    const n = this.cols.length / 2;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (this.cols[2 * i]! - x) ** 2 + (this.cols[2 * i + 1]! - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best - FOAM_WINDOW < 0 || best + FOAM_WINDOW >= n) this.geometry.setDrawRange(0, Infinity);
    else this.geometry.setDrawRange((best - FOAM_WINDOW) * this.perColumn, 2 * FOAM_WINDOW * this.perColumn);
  }
}

/** Les sommets de la grille, recentrés sur la caméra (par pas de GRID_SNAP), soulevés par les vagues jusqu'à 260 m (au-delà, trop fins). */
const SEA_VERTEX = /* glsl */ `
#include <begin_vertex>
transformed.xz += floor(cameraPosition.xz / ${GRID_SNAP.toFixed(1)}) * ${GRID_SNAP.toFixed(1)};
float seaFade = 1.0 - smoothstep(80.0, 260.0, length(transformed.xz - cameraPosition.xz));
transformed.y += waveHeight(vec2(transformed.x, -transformed.z), uSeaTime) * uSeaAmp * seaFade;
vSeaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

const SEA_FRAGMENT_HEAD = /* glsl */ `
uniform float uSeaTime; uniform float uSeaAmp; uniform vec3 uSkyHorizon; uniform vec3 uSkyZenith; uniform vec3 uSunDir; uniform vec3 uGlint;
uniform float uCrest;
varying vec3 vSeaWorld;
float seaHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`;

/**
 * Normale de l'eau, pixel par pixel, tirée de la pente des vagues (exagérée : l'ombrage en paliers en fait des bandes nettes) ; elle
 * s'efface au loin, où les vagues deviendraient un bruit.
 */
const SEA_NORMAL = /* glsl */ `
vec2 seaP = vec2(vSeaWorld.x, -vSeaWorld.z);
float seaDist = length(vSeaWorld.xz - cameraPosition.xz);
float seaNear = 1.0 - smoothstep(150.0, 700.0, seaDist);
vec2 seaSl = waveSlope(seaP, uSeaTime) * uSeaAmp * seaNear * 1.8;
vec3 seaN = normalize(vec3(-seaSl.x, 1.0, seaSl.y));
normal = normalize((viewMatrix * vec4(seaN, 0.0)).xyz);`;

/**
 * Couleur : reflet du ciel (plus fort à jour frisant), paillettes du soleil ou de la lune (des taches nettes, pas un dégradé), crêtes
 * blanches par vent fort.
 */
const SEA_COLOR = /* glsl */ `
{
  vec3 V = normalize(cameraPosition - vSeaWorld);
  float fres = pow(1.0 - max(dot(seaN, V), 0.0), 4.0);
  vec3 R = reflect(-V, seaN);
  vec3 skyR = mix(uSkyHorizon, uSkyZenith, clamp(R.y * 2.5, 0.0, 1.0));
  outgoingLight = mix(outgoingLight, skyR, 0.12 + 0.6 * fres);
  float g = pow(max(dot(R, uSunDir), 0.0), 60.0);
  float spark = step(0.45, g) * step(0.45, seaHash(floor(seaP * 1.3 + vec2(uSeaTime * 0.9, 0.0))));
  outgoingLight += uGlint * spark * seaNear;
  float hn = waveHeight(seaP, uSeaTime) + 0.1 * sin(seaP.x * 1.9 + seaP.y * 1.4);
  float crest = smoothstep(0.66, 0.7, hn) * uCrest * seaNear;
  outgoingLight = mix(outgoingLight, outgoingLight * 0.25 + vec3(0.75), crest);
}`;

/** L'écume suit les vagues comme l'eau (sans recentrage : le ruban est à sa place). */
const FOAM_VERTEX = /* glsl */ `
#include <begin_vertex>
vec4 foamW = modelMatrix * vec4(transformed, 1.0);
float foamFade = 1.0 - smoothstep(80.0, 260.0, length(foamW.xz - cameraPosition.xz));
transformed.y += waveHeight(vec2(foamW.x, -foamW.z), uSeaTime) * uSeaAmp * foamFade;
vFoam = aFoam;`;

/**
 * Motif de l'écume (aplats nets) : `vFoam.x` mètres le long de la côte, `vFoam.y` profondeur du fond sous l'eau calme (m). Une nappe qui
 * monte et redescend sur le sable (bord dentelé, en retard d'un endroit à l'autre), et une ligne de vague qui arrive du large et s'y
 * fond, une fois par cycle de 7,5 s.
 */
const FOAM_PATTERN = /* glsl */ `
{
  float along = vFoam.x, depth = vFoam.y;
  float cyc = uSeaTime / 7.5 + along * 0.011 + 0.6 * sin(along * 0.017);
  float ph = fract(cyc);
  float swash = 0.5 + 0.5 * sin(6.2831853 * cyc);
  float edge = 0.12 + (0.3 + 0.8 * uSeaAmp) * swash + 0.05 * sin(along * 0.9) + 0.03 * sin(along * 2.3 + 1.0);
  float body = 1.0 - smoothstep(edge - 0.02, edge + 0.02, depth);
  float lineD = mix(1.6 + 2.0 * uSeaAmp, edge, ph);
  float line = (1.0 - smoothstep(0.03, 0.07, abs(depth - lineD))) * smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.8, 1.0, ph));
  float a = max(body * 0.92, line * 0.8);
  if (a < 0.02) discard;
  diffuseColor.a *= a;
}`;

/** Grille polaire centrée sur l'origine : anneaux serrés près du centre (1,2 m), qui s'écartent de 6 % au-delà de 20 m, jusqu'à 15 km. */
export function seaGrid(segments = 96, maxR = 15000): THREE.BufferGeometry {
  const radii = [0];
  while (radii[radii.length - 1]! < maxR) {
    const r = radii[radii.length - 1]!;
    radii.push(r + Math.max(1.2, r * 0.06));
  }
  const pos: number[] = [];
  for (const r of radii) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < radii.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * segments + s, b = i * segments + ((s + 1) % segments), c = a + segments, d = b + segments;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(index);
  return g;
}

/**
 * Côté de la mer le long de l'anneau de côte : +1 si elle est à droite du sens de parcours (anneau dans le sens trigonométrique), −1 si elle
 * est à gauche. L'anneau publié (D105) tourne dans le sens des aiguilles d'une montre : la mer est à gauche. Jusqu'à D316, l'écume
 * supposait l'inverse et passait sous la plage (on ne la voyait jamais).
 */
export function seaSide(coast: readonly number[]): 1 | -1 {
  const n = coast.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += coast[2 * i]! * coast[2 * j + 1]! - coast[2 * j]! * coast[2 * i + 1]!;
  }
  return a >= 0 ? 1 : -1;
}

/** Normale vers la mer au point `i` d'un anneau, tirée des points voisins (unitaire, repère du jeu). */
function seaward(pts: readonly number[], i: number, reach: number, side: number): [number, number] {
  const n = pts.length / 2;
  const a = (i - reach + n * 4) % n, b = (i + reach) % n;
  const tx = pts[2 * b]! - pts[2 * a]!, ty = pts[2 * b + 1]! - pts[2 * a + 1]!;
  const L = Math.hypot(tx, ty) || 1;
  return [(side * ty) / L, (-side * tx) / L];
}

/** Ruban d'écume d'avant (mer plate), du bon côté de la côte. */
export function foamGeometry(coast: readonly number[], z: number): THREE.BufferGeometry | null {
  const n = coast.length / 2;
  if (n < 3) return null;
  const side = seaSide(coast);
  const pos = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const [nx, ny] = seaward(coast, i, 1, side);
    const x = coast[2 * i]!, y = coast[2 * i + 1]!;
    pos.set([x + nx * FOAM_NEAR, z, -(y + ny * FOAM_NEAR), x + nx * FOAM_FAR, z, -(y + ny * FOAM_FAR)], i * 6);
  }
  return ribbon(pos, n, 2, side);
}

/** Anneau rééchantillonné tous les `step` mètres. */
export function resampleRing(coast: readonly number[], step: number): number[] {
  const n = coast.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = coast[2 * i]!, y0 = coast[2 * i + 1]!, x1 = coast[2 * j]!, y1 = coast[2 * j + 1]!;
    const k = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let s = 0; s < k; s++) out.push(x0 + ((x1 - x0) * s) / k, y0 + ((y1 - y0) * s) / k);
  }
  return out;
}

/**
 * Ruban d'écume vivante : la côte rééchantillonnée tous les 2 m, quatre rangées de LIVE_NEAR à LIVE_FAR mètres au large ; chaque sommet
 * porte sa distance le long de la côte et la profondeur du fond sous l'eau calme (profil du rivage).
 */
export function liveFoamGeometry(coast: readonly number[], z: number): THREE.BufferGeometry | null {
  if (coast.length < 6) return null;
  const side = seaSide(coast);
  const pts = resampleRing(coast, LIVE_STEP);
  const n = pts.length / 2;
  const rows = [LIVE_NEAR, 8, 11, LIVE_FAR];
  const pos = new Float32Array(n * rows.length * 3);
  const foam = new Float32Array(n * rows.length * 2);
  let along = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) along += Math.hypot(pts[2 * i]! - pts[2 * i - 2]!, pts[2 * i + 1]! - pts[2 * i - 1]!);
    // Normale lissée sur ± 20 m : pas de plis du ruban aux angles de la côte.
    const [nx, ny] = seaward(pts, i, 10, side);
    const x = pts[2 * i]!, y = pts[2 * i + 1]!;
    rows.forEach((d, r) => {
      const v = i * rows.length + r;
      pos.set([x + nx * d, z, -(y + ny * d)], v * 3);
      foam.set([along, SEABED_SLOPE * d - SHORE_ABOVE], v * 2);
    });
  }
  const g = ribbon(pos, n, rows.length, side);
  g.setAttribute("aFoam", new THREE.BufferAttribute(foam, 2));
  g.userData["columns"] = new Float32Array(pts);
  g.userData["indicesPerColumn"] = (rows.length - 1) * 6;
  return g;
}

/**
 * Triangles d'un ruban fermé de `n` colonnes de `rows` sommets (de la côte vers le large) ; normales vers le haut. Les triangles sont
 * tournés vers le ciel quel que soit le côté de la mer (`side`) : sinon, vus d'en haut, ils sont éliminés comme des faces arrière.
 */
function ribbon(pos: Float32Array, n: number, rows: number, side: 1 | -1): THREE.BufferGeometry {
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (let r = 0; r < rows - 1; r++) {
      const a = i * rows + r, b = a + 1, c = j * rows + r, d = c + 1;
      if (side > 0) index.push(a, b, c, c, b, d);
      else index.push(a, c, b, c, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  return g;
}

/** La mer du monde, ou null si le monde n'en a pas. */
export function createSea(manifest: WorldManifest, toon: boolean, sky?: { horizon: THREE.Color; zenith: THREE.Color }): Sea | null {
  return manifest.sea ? new Sea(manifest as WorldManifest & { sea: NonNullable<WorldManifest["sea"]> }, toon, sky) : null;
}
