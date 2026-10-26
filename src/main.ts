import * as THREE from "three";
import { sunDirection, sunPosition } from "./core/sun";
import { Colliders } from "./core/collision";
import { loadWorldBase } from "./data/load";
import type { GameContext } from "./game/context";
import { gameSpawn, startGame } from "./game/game";
import { startViewer, viewerView } from "./game/viewer";
import { createSky, HORIZON } from "./render/sky";
import { useTheme } from "./render/style";
import { buildTileStyled, StyleResources } from "./render/stylized";
import { TerrainView } from "./render/terrain";
import { TileManager } from "./render/tile-manager";

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
const hemi = new THREE.HemisphereLight("#bcd3ee", "#9a8e78", 1.9);
scene.add(hemi);
// Direction artistique « affiche » par défaut ; ?style=nuit pour la version de nuit (fenêtres allumées).
const style = useTheme(params.get("style") ?? "affiche")!;
scene.fog = new THREE.Fog(style.fog[0], style.fog[1], style.fog[2]);
sunLight.color.set(style.sun.color);
sunLight.intensity = style.sun.intensity;
hemi.color.set(style.hemi.sky);
hemi.groundColor.set(style.hemi.ground);
hemi.intensity = style.hemi.intensity;
renderer.toneMapping = style.tone === "neutral" ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = style.exposure;
{
  const u = (sky.material as THREE.ShaderMaterial).uniforms;
  (u["horizon"]!.value as THREE.Color).set(style.sky.horizon);
  (u["mid"]!.value as THREE.Color).set(style.sky.mid);
  (u["zenith"]!.value as THREE.Color).set(style.sky.zenith);
  u["bands"]!.value = style.sky.bands;
  u["disc"]!.value = style.sky.disc;
  u["stars"]!.value = style.sky.stars;
  u["clouds"]!.value = style.sky.clouds;
}
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
  const terrainView = TerrainView.create(world.terrain, world.groundMeta, world.groundA, world.groundB, Number(params.get("step") ?? 2.5), style.ground);
  terrainView.settle(start.x, start.y);
  scene.add(terrainView.group);

  const t0 = performance.now();
  const colliders = new Colliders();
  const styleRes = new StyleResources();
  const tiles = new TileManager(world, (d) => buildTileStyled(styleRes, d, world.terrain), colliders, Number(params.get("detail") ?? 210));
  // ?hide=bati,toits,... masque des maillages (diagnostic).
  tiles.hidden = new Set((params.get("hide") ?? "").split(",").filter(Boolean));
  scene.add(tiles.group);
  await tiles.preload(start.x, start.y);
  const { loaded, triangles, draws } = tiles.stats;
  console.log(`tuiles construites en ${Math.round(performance.now() - t0)} ms ${JSON.stringify({ loaded, triangles, draws, terrain: terrainView.triangles })}`);

  const ctx: GameContext = {
    renderer, scene, camera, sky, sunLight, sunDir, world, tiles, terrainView, colliders, params, debugEl,
    ready: (extra) => {
      loadingEl.remove();
      document.body.classList.add(viewerMode ? "viewer" : "game");
      (window as unknown as { __autun: object }).__autun = {
        ready: true, stats: { ...tiles.stats, terrainTriangles: terrainView.triangles }, tiles, ...extra,
      };
    },
  };
  if (viewerMode) startViewer(ctx);
  else startGame(ctx);
}

main().catch((e: unknown) => {
  loadingEl.textContent = `Erreur : ${String(e)}`;
  console.error(e);
});
