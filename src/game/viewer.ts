import * as THREE from "three";
import type { GameContext } from "./context";
import { FrameMeter } from "./hud";

const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  aerial: [-150, -230, 140, 0, 10, 5],
  street: [28, -25, 1.7, -5, 70, 8],
  place: [-95, -75, 2.0, 30, -20, 4],
  mairie: [10, 35, 1.7, 15, 95, 10],
  church: [-40, -95, 1.7, -86, -136, 12],
  cathedrale: [-330, -250, 1.7, -300, -330, 14],
  lycee: [250, 120, 1.7, 290, 100, 4],
  parking: [-60, 150, 1.7, -20, 170, 3],
};

/** Vue demandée : ?cam=x,y,h,cibleX,cibleY,hCible ou ?view=nom. */
export function viewerView(params: URLSearchParams): [number, number, number, number, number, number] {
  const custom = params.get("cam")?.split(",").map(Number);
  return custom && custom.length === 6 && custom.every(Number.isFinite)
    ? (custom as [number, number, number, number, number, number])
    : (VIEWS[params.get("view") ?? "aerial"] ?? VIEWS["aerial"]!);
}

/** Caméra libre pour les captures et le diagnostic : ?view=nom ou ?cam=x,y,h,cibleX,cibleY,hCible. */
export function startViewer(ctx: GameContext): void {
  const { camera, renderer, scene, sky, params, debugEl, world, tiles, terrainView } = ctx;
  const { terrain } = world;
  let yaw = 0, pitch = 0;
  const pos = new THREE.Vector3();
  const ground = (x: number, y: number): number => terrain.heightAt(x, y);

  const v = viewerView(params);
  const z = ground(v[0], v[1]) + v[2];
  pos.set(v[0], z, -v[1]);
  const dx = v[3] - v[0], dy = v[4] - v[1], dz = ground(v[3], v[4]) + v[5] - z;
  yaw = Math.atan2(dx, dy);
  pitch = Math.atan2(dz, Math.hypot(dx, dy));

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "KeyF") debugEl.style.display = debugEl.style.display === "block" ? "none" : "block";
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  const canvas = renderer.domElement;
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw += e.movementX * 0.005;
    pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.005));
  });

  const meter = new FrameMeter(renderer, debugEl);
  let last = performance.now();
  const fwd = new THREE.Vector3();
  const tick = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const speed = (keys.has("ShiftLeft") ? 25 : 6) * dt;
    fwd.set(Math.sin(yaw), 0, -Math.cos(yaw));
    if (keys.has("KeyW") || keys.has("ArrowUp")) pos.addScaledVector(fwd, speed);
    if (keys.has("KeyS") || keys.has("ArrowDown")) pos.addScaledVector(fwd, -speed);
    if (keys.has("KeyD") || keys.has("ArrowRight")) pos.add(new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(speed));
    if (keys.has("KeyA") || keys.has("ArrowLeft")) pos.add(new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(-speed));
    if (keys.has("KeyE")) pos.y += speed;
    if (keys.has("KeyQ")) pos.y -= speed;
    camera.position.copy(pos);
    const cp = Math.cos(pitch);
    camera.lookAt(pos.x + Math.sin(yaw) * cp, pos.y + Math.sin(pitch), pos.z - Math.cos(yaw) * cp);
    sky.position.copy(camera.position);
    tiles.update(pos.x, -pos.z);
    terrainView.update(pos.x, -pos.z);
    renderer.render(scene, camera);
    meter.tick(dt);
    requestAnimationFrame(tick);
  };
  if (params.has("debug")) debugEl.style.display = "block";
  requestAnimationFrame(tick);
  ctx.ready();
}
