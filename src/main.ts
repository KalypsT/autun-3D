import * as THREE from "three";
import { sunDirection, sunPosition } from "./core/sun";
import { loadWorld } from "./data/load";
import { buildBuildings } from "./render/buildings";
import { buildTerrain } from "./render/terrain";
import { buildTrees } from "./render/trees";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const debugEl = document.getElementById("debug") as HTMLDivElement;
const loadingEl = document.getElementById("loading") as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(params.get("dpr") ?? 2)));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const shadows = params.get("shadow") !== "0";
renderer.shadowMap.enabled = shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const sky = new THREE.Color("#a9c4de");
scene.background = sky;
scene.fog = new THREE.Fog(sky, 220, 760);
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 1200);

// Soleil : jour de l'année et heure solaire en paramètres (?h=16&day=200).
const sun = sunPosition(Number(params.get("day") ?? 200), Number(params.get("h") ?? 16));
const [sx, sy, sz] = sunDirection(sun);
const sunLight = new THREE.DirectionalLight("#fff1dc", 3.2);
sunLight.position.set(sx * 400, sz * 400, -sy * 400);
sunLight.castShadow = shadows;
sunLight.shadow.mapSize.set(4096, 4096);
const cam = sunLight.shadow.camera;
cam.left = -230; cam.right = 230; cam.top = 230; cam.bottom = -230; cam.near = 50; cam.far = 900;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.6;
scene.add(sunLight);
scene.add(new THREE.HemisphereLight("#bcd4f0", "#8a7d6a", 1.15));

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// --- Caméra libre provisoire (le jeu aura ses propres commandes) ---------------------------------
let yaw = 0, pitch = 0;
const pos = new THREE.Vector3();
function setView(x: number, y: number, hAbove: number, tx: number, ty: number, tzAbove: number, ground: (x: number, y: number) => number): void {
  const z = ground(x, y) + hAbove;
  pos.set(x, z, -y);
  const dx = tx - x, dy = ty - y, dz = ground(tx, ty) + tzAbove - z;
  yaw = Math.atan2(dx, dy);
  pitch = Math.atan2(dz, Math.hypot(dx, dy));
}
function applyCamera(): void {
  camera.position.copy(pos);
  const cp = Math.cos(pitch);
  camera.lookAt(pos.x + Math.sin(yaw) * cp, pos.y + Math.sin(pitch), pos.z - Math.cos(yaw) * cp);
}
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "KeyF") debugEl.style.display = debugEl.style.display === "block" ? "none" : "block";
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
let dragging = false;
canvas.addEventListener("pointerdown", (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  yaw += e.movementX * 0.005;
  pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.005));
});

async function main(): Promise<void> {
  const world = await loadWorld();
  const { terrain } = world;
  scene.add(buildTerrain(terrain, world.groundMeta, world.groundImage, Number(params.get("step") ?? 2)));
  const b = buildBuildings(world.buildings, terrain);
  scene.add(b.walls, b.roofs);
  scene.add(buildTrees(world.trees));
  loadingEl.remove();

  const ground = (x: number, y: number): number => terrain.heightAt(x, y);
  const views: Record<string, [number, number, number, number, number, number]> = {
    aerial: [-150, -230, 140, 0, 10, 5],
    street: [28, -25, 1.7, -5, 70, 8],
    place: [-95, -75, 2.0, 30, -20, 4],
    mairie: [10, 35, 1.7, 15, 95, 10],
    church: [-40, -95, 1.7, -86, -136, 12],
  };
  // ?cam=x,y,hauteur_oeil,cibleX,cibleY,hauteur_cible (mètres locaux) remplace la vue nommée.
  const custom = params.get("cam")?.split(",").map(Number);
  const v = custom && custom.length === 6 && custom.every(Number.isFinite)
    ? (custom as [number, number, number, number, number, number])
    : (views[params.get("view") ?? "aerial"] ?? views["aerial"]!);
  setView(v[0], v[1], v[2], v[3], v[4], v[5], ground);

  let last = performance.now(), frames = 0, acc = 0, fps = 0;
  const tick = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const speed = (keys.has("ShiftLeft") ? 25 : 6) * dt;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    if (keys.has("KeyW") || keys.has("ArrowUp")) pos.addScaledVector(new THREE.Vector3(fx, 0, fz), speed);
    if (keys.has("KeyS") || keys.has("ArrowDown")) pos.addScaledVector(new THREE.Vector3(fx, 0, fz), -speed);
    if (keys.has("KeyD") || keys.has("ArrowRight")) pos.addScaledVector(new THREE.Vector3(-fz, 0, fx), speed);
    if (keys.has("KeyA") || keys.has("ArrowLeft")) pos.addScaledVector(new THREE.Vector3(-fz, 0, fx), -speed);
    if (keys.has("KeyE")) pos.y += speed;
    if (keys.has("KeyQ")) pos.y -= speed;
    applyCamera();
    renderer.render(scene, camera);
    frames++; acc += dt;
    if (acc >= 0.5) {
      fps = frames / acc; frames = 0; acc = 0;
      const i = renderer.info;
      debugEl.textContent = `${fps.toFixed(0)} i/s · ${i.render.calls} appels · ${(i.render.triangles / 1000).toFixed(0)}k tri · ${i.memory.geometries} géo`;
    }
    requestAnimationFrame(tick);
  };
  if (params.has("debug")) debugEl.style.display = "block";
  requestAnimationFrame(tick);
  (window as unknown as { __autun: object }).__autun = { ready: true, triangles: b.triangles };
}

main().catch((e: unknown) => {
  loadingEl.textContent = `Erreur : ${String(e)}`;
  console.error(e);
});
