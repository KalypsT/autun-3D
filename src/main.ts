import * as THREE from "three";
import { Colliders } from "./core/collision";
import { loadWorldBase } from "./data/load";
import type { GameContext } from "./game/context";
import { startBench } from "./game/bench";
import { gameSpawn, startGame } from "./game/game";
import { startViewer, viewerView } from "./game/viewer";
import { createSky, HORIZON } from "./render/sky";
import { Atmosphere } from "./render/atmosphere";
import { useTheme } from "./render/style";
import { buildTileSteps, StyleResources } from "./render/stylized";
import { TerrainView } from "./render/terrain";
import { DETAIL_DISTANCE, TileManager } from "./render/tile-manager";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const debugEl = document.getElementById("debug") as HTMLDivElement;
const loadingEl = document.getElementById("loading") as HTMLDivElement;
// Sans ?view ni ?cam, c'est le jeu ; avec, la caméra libre des captures.
const viewerMode = params.has("view") || params.has("cam");
// ?bench=1 : banc de test de performances (parcours fixe, rapport à la fin).
const benchMode = !viewerMode && params.has("bench");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
// Définition : ×2,5 au plus en jeu (mesuré fluide en ×3 sur le téléphone de test, marge gardée pour la chauffe sur 30 minutes).
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(params.get("dpr") ?? (viewerMode ? 2 : 2.5))));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const shadows = params.get("shadow") !== "0";
renderer.shadowMap.enabled = shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 260, 1000);
const camera = new THREE.PerspectiveCamera(viewerMode ? 60 : 62, 1, 0.15, 1200);

// Soleil : jour de l'année et heure solaire en paramètres (?h=16&day=200).
const sunDir = new THREE.Vector3(0, 1, 0);
const sunLight = new THREE.DirectionalLight("#ffe8c4", 3.0);
sunLight.position.copy(sunDir).multiplyScalar(400);
sunLight.castShadow = shadows;
const mapSize = Number(params.get("shadowmap") ?? 4096);
sunLight.shadow.mapSize.set(mapSize, mapSize);
const cam = sunLight.shadow.camera;
cam.left = -230; cam.right = 230; cam.top = 230; cam.bottom = -230; cam.near = 50; cam.far = 900;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.6;
scene.add(sunLight);
const sky = createSky(sunDir);
scene.add(sky);
const hemi = new THREE.HemisphereLight("#bcd3ee", "#9a8e78", 1.9);
scene.add(hemi);
// Direction artistique « affiche » ; l'ambiance (jour, couchant, nuit) suit l'heure de jeu (cf. Atmosphere).
const style = useTheme("affiche")!;
scene.fog = new THREE.Fog(style.fog[0], style.fog[1], style.fog[2]);
renderer.toneMapping = THREE.NeutralToneMapping;
addOverlay(style.overlay);

/** Grain de papier et vignette par-dessus l'image (deux couches CSS, très peu coûteuses). */
function addOverlay([grain, vignette]: [number, number]): void {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  const img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const v = Math.random() * 255;
    img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
    img.data[4 * i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:2;opacity:${grain};background:url(${cv.toDataURL()});mix-blend-mode:overlay;`;
  const vg = document.createElement("div");
  vg.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:2;background:radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${vignette}) 100%);`;
  document.body.append(el, vg);
}

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

async function main(): Promise<void> {
  const world = await loadWorldBase();
  const focus = viewerMode ? viewerView(params) : null;
  const start = focus ? { x: focus[0], y: focus[1] } : gameSpawn(params);
  const terrainView = TerrainView.create(world.terrain, world.manifest, Number(params.get("step") ?? 2.5), style.ground);
  await terrainView.preload(start.x, start.y);
  scene.add(terrainView.group);

  const t0 = performance.now();
  const colliders = new Colliders();
  const styleRes = new StyleResources();
  // Heure de jeu : ?h=17 (départ), ?speed=0.02 (heures de jeu par seconde ; 0 = figée), ?style=nuit = 23 h 30 figée.
  const night = params.get("style") === "nuit";
  const hour = Number(params.get("h") ?? (night ? 23.5 : 16));
  const speed = Number(params.get("speed") ?? (night || viewerMode || benchMode ? 0 : 1 / 50));
  const atmosphere = new Atmosphere(hour, speed, Number(params.get("day") ?? 200), scene, renderer, sunLight, hemi, sky.material as THREE.ShaderMaterial, styleRes);
  sunDir.copy(atmosphere.lightDir);
  sunLight.position.copy(sunDir).multiplyScalar(400);
  // ?budget=4 : temps de construction des tuiles par image (ms) ; ?budget=1000 construit d'un bloc (comparaison).
  const tiles = new TileManager(world, (d) => buildTileSteps(styleRes, d, world.terrain), colliders, Number(params.get("detail") ?? DETAIL_DISTANCE), Number(params.get("budget") ?? 4));
  // ?hide=bati,toits,... masque des maillages (diagnostic).
  tiles.hidden = new Set((params.get("hide") ?? "").split(",").filter(Boolean));
  scene.add(tiles.group);
  await tiles.preload(start.x, start.y);
  const { loaded, triangles, draws } = tiles.stats;
  console.log(`tuiles construites en ${Math.round(performance.now() - t0)} ms ${JSON.stringify({ loaded, triangles, draws, terrain: terrainView.triangles })}`);

  const ctx: GameContext = {
    renderer, scene, camera, sky, sunLight, sunDir, atmosphere, world, tiles, terrainView, colliders, params, debugEl,
    ready: (extra) => {
      loadingEl.remove();
      document.body.classList.add(viewerMode ? "viewer" : benchMode ? "bench" : "game");
      (window as unknown as { __autun: object }).__autun = {
        ready: true, stats: { ...tiles.stats, terrainTriangles: terrainView.triangles }, tiles, terrain: world.terrain, terrainView, ...extra,
      };
    },
  };
  if (viewerMode) startViewer(ctx);
  else if (benchMode) startBench(ctx);
  else startGame(ctx);
}

main().catch((e: unknown) => {
  loadingEl.textContent = `Erreur : ${String(e)}`;
  console.error(e);
});
