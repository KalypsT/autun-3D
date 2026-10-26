import * as THREE from "three";
import { sunDirection, sunPosition } from "./core/sun";
import { loadWorld } from "./data/load";
import type { GameContext } from "./game/context";
import { startGame } from "./game/game";
import { startViewer } from "./game/viewer";
import { buildCity } from "./render/buildings";
import { createSky, HORIZON } from "./render/sky";
import { buildTerrain } from "./render/terrain";
import { buildTrees } from "./render/trees";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const debugEl = document.getElementById("debug") as HTMLDivElement;
const loadingEl = document.getElementById("loading") as HTMLDivElement;
// Sans ?view ni ?cam, c'est le jeu ; avec, la caméra libre des captures.
const viewerMode = params.has("view") || params.has("cam");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(params.get("dpr") ?? (viewerMode ? 2 : 1.5))));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const shadows = params.get("shadow") !== "0";
renderer.shadowMap.enabled = shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 260, 1000);
const camera = new THREE.PerspectiveCamera(viewerMode ? 60 : 62, 1, 0.15, 1200);

// Soleil : jour de l'année et heure solaire en paramètres (?h=16&day=200).
const sun = sunPosition(Number(params.get("day") ?? 200), Number(params.get("h") ?? 16));
const [sx, sy, sz] = sunDirection(sun);
const sunDir = new THREE.Vector3(sx, sz, -sy);
const sunLight = new THREE.DirectionalLight("#ffe8c4", 3.0);
sunLight.position.copy(sunDir).multiplyScalar(400);
sunLight.castShadow = shadows;
const mapSize = Number(params.get("shadowmap") ?? (viewerMode ? 4096 : 2048));
sunLight.shadow.mapSize.set(mapSize, mapSize);
const cam = sunLight.shadow.camera;
cam.left = -230; cam.right = 230; cam.top = 230; cam.bottom = -230; cam.near = 50; cam.far = 900;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.6;
scene.add(sunLight);
const sky = createSky(sunDir);
scene.add(sky);
scene.add(new THREE.HemisphereLight("#bcd3ee", "#9a8e78", 1.9));

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

async function main(): Promise<void> {
  const world = await loadWorld();
  scene.add(await buildTerrain(world.terrain, world.groundMeta, world.groundImage, Number(params.get("step") ?? 2)));
  const t0 = performance.now();
  const city = buildCity(world);
  // ?hide=misc,sprites-0,... masque des maillages (diagnostic).
  const hidden = new Set((params.get("hide") ?? "").split(",").filter(Boolean));
  city.group.children.forEach((m) => { if (hidden.has(m.name)) m.visible = false; });
  scene.add(city.group);
  console.log(`ville construite en ${Math.round(performance.now() - t0)} ms ${JSON.stringify(city.stats)}`);
  scene.add(buildTrees(world.trees));

  const ctx: GameContext = {
    renderer, scene, camera, sky, sunLight, sunDir, world, params, debugEl,
    ready: (extra) => {
      loadingEl.remove();
      document.body.classList.add(viewerMode ? "viewer" : "game");
      (window as unknown as { __autun: object }).__autun = { ready: true, stats: city.stats, ...extra };
    },
  };
  if (viewerMode) startViewer(ctx);
  else startGame(ctx);
}

main().catch((e: unknown) => {
  loadingEl.textContent = `Erreur : ${String(e)}`;
  console.error(e);
});
