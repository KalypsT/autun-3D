import * as THREE from "three";
import type { GameContext } from "./context";
import { NavDebug } from "../render/nav-debug";
import { NavManager } from "./nav-manager";
import { PedSim, type Observer } from "../core/pedestrians";
import { createCrowd } from "../render/crowd/crowd";
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
  // Galerie des personnages (startGallery) : le départ du jeu.
  characters: [-10, -40, 1.7, -10, -20, 1.2],
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
  const { camera, renderer, scene, sky, params, debugEl, world, tiles, terrainView, atmosphere, sunDir, sunLight } = ctx;
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

  // ?nav=1 ou ?nav=all : recouvrement de la navigation (files, passages, places, points d'intérêt ; avec all, le graphe routier).
  const navParam = params.get("nav");
  // ?sim=80 : 80 passants de la simulation autour de la caméra (captures) ; ?warm=20 : secondes simulées avant la première image (défaut 20).
  const simN = Math.min(Math.max(Math.floor(Number(params.get("sim") ?? 0)) || 0, 0), 400);
  const nav = navParam || simN > 0 ? new NavManager() : null;
  const pedSim = simN > 0 && nav ? new PedSim(nav.graph, terrain, ctx.colliders, { capacity: simN, seed: Number(params.get("seed") ?? 7), spawnInView: true }) : null;
  const crowd = pedSim ? createCrowd(scene, pedSim.state) : null;
  if (pedSim && crowd) pedSim.onSpawn = (slot, recipe) => crowd.assign?.(slot, recipe);
  const observer = (): Observer => ({ x: pos.x, y: -pos.z, vx: 0, vy: 0, yaw, onFoot: true, vehicle: null });
  const navDebug = nav && navParam ? new NavDebug(nav.graph, terrain, navParam === "all") : null;
  if (navDebug) scene.add(navDebug.group);
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
    atmosphere.advance(dt);
    sunDir.copy(atmosphere.lightDir);
    sunLight.position.copy(sunDir).multiplyScalar(400);
    tiles.update(pos.x, -pos.z);
    terrainView.update(pos.x, -pos.z);
    nav?.update(pos.x, -pos.z);
    navDebug?.update(pos.x, -pos.z);
    if (pedSim && crowd && nav!.graph.edgeCount > 0) {
      pedSim.step(dt, observer());
      crowd.update(pedSim.state, pos.x, pos.z);
    }
    renderer.render(scene, camera);
    meter.tick(dt);
    requestAnimationFrame(tick);
  };
  if (params.has("debug")) debugEl.style.display = "block";
  requestAnimationFrame(tick);
  if (nav) {
    void nav.preload(v[0], v[1]).then(() => {
      if (pedSim && crowd) {
        // Les passants ont déjà marché un moment : on simule `warm` secondes avant la première image.
        pedSim.prefill(observer());
        for (let i = 0, n = Math.round(Number(params.get("warm") ?? 20) * 60); i < n; i++) pedSim.step(1 / 60, observer());
        // ?hit=3 : trois passants autour de la cible sont poussés (captures des chutes), puis on laisse 1,2 s passer.
        const hits = Math.min(Math.max(Math.floor(Number(params.get("hit") ?? 0)) || 0, 0), 20);
        if (hits > 0) {
          const near: number[] = [];
          pedSim.queryCircle(v[3], v[4], 30, near);
          near.slice(0, hits).forEach((slot, k) => pedSim.applyImpulse(slot, 5.5 - (k % 2) * 3, 1.5 * (k % 3 - 1)));
          for (let i = 0; i < Math.round(Number(params.get("after") ?? 1.2) * 60); i++) pedSim.step(1 / 60, observer());
        }
        crowd.update(pedSim.state, pos.x, pos.z);
        crowd.setShadows(true);
      }
      ctx.ready();
    });
  } else ctx.ready();
}
