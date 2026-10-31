import * as THREE from "three";
import type { GameContext } from "./context";
import { NavDebug } from "../render/nav-debug";
import { NavManager } from "./nav-manager";
import { PedSim, type Observer } from "../core/pedestrians";
import { createCrowd } from "../render/crowd/crowd";
import { FrameMeter } from "./hud";
import { PigeonSim, type PigeonState } from "../core/pigeons";
import { PigeonRenderer } from "../render/pigeons";

const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  aerial: [-150, -230, 140, 0, 10, 5],
  street: [28, -25, 1.7, -5, 70, 8],
  place: [-95, -75, 2.0, 30, -20, 4],
  mairie: [10, 35, 1.7, 15, 95, 10],
  church: [-40, -95, 1.7, -86, -136, 12],
  cathedrale: [-330, -250, 1.7, -300, -330, 14],
  lycee: [250, 120, 1.7, 290, 100, 4],
  // Lycée Bonaparte (D148) : depuis le Champ de Mars, vers l'ouest-sud-ouest, comme la photo 1.
  bonaparte: [-40, -92, 1.7, -92, -119, 5],
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
  // ?pigeons=30 : jusqu'à 30 pigeons autour de la caméra ; ?scare=0.8 : la volée visée s'envole, puis 0,8 s passent avant la première image.
  const pigN = Math.min(Math.max(Math.floor(Number(params.get("pigeons") ?? 0)) || 0, 0), 60);
  const nav = navParam || simN > 0 || pigN > 0 ? new NavManager() : null;
  const pedSim = simN > 0 && nav ? new PedSim(nav.graph, terrain, ctx.colliders, { capacity: simN, seed: Number(params.get("seed") ?? 7), spawnInView: true }) : null;
  const crowd = pedSim ? createCrowd(scene, pedSim.state) : null;
  if (pedSim && crowd) pedSim.onSpawn = (slot, recipe) => crowd.assign?.(slot, recipe);
  // Les pigeons ne fuient pas la caméra : leur « joueur » est reculé de 40 m derrière elle (`?pigobs=x,y` le place ailleurs) : les captures voient les oiseaux de près, posés.
  const pigAt = params.get("pigobs")?.split(",").map(Number);
  const pigObserver = (): Observer => ({
    ...observer(), x: pigAt?.[0] ?? pos.x - Math.sin(yaw) * 40, y: pigAt?.[1] ?? -pos.z + Math.cos(yaw) * 40, hour: atmosphere.hour,
  });
  const pigSim = pigN > 0 && nav ? new PigeonSim(nav.graph, terrain, ctx.colliders, { capacity: pigN, seed: Number(params.get("seed") ?? 7), spawnInView: true }) : null;
  const pigView = pigSim ? new PigeonRenderer(scene, pigN) : null;
  // ?pigsheet=x,y : planche de modèles (8 poses, de profil, tournés vers l'est, alignés vers l'est depuis ce point) pour juger l'oiseau de près.
  const sheetAt = params.get("pigsheet")?.split(",").map(Number);
  const sheet = pigSim && sheetAt && sheetAt.length === 2 ? pigeonSheet(terrain, sheetAt[0]!, sheetAt[1]!) : null;
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
    if (pigSim && pigView && nav!.graph.edgeCount > 0) {
      if (!sheet) pigSim.step(dt, pigObserver());
      pigView.update(sheet ?? pigSim.state, pos.x, -pos.z, 100);
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
      if (pigSim && pigView) {
        const obs = pigObserver;
        pigSim.prefill(obs());
        for (let i = 0, n = Math.round(Number(params.get("warm") ?? 20) * 60); i < n; i++) pigSim.step(1 / 60, obs());
        const scare = Number(params.get("scare") ?? 0);
        if (scare > 0) {
          pigSim.scatter(v[3], v[4], 40);
          for (let i = 0; i < Math.round(scare * 60); i++) pigSim.step(1 / 60, obs());
        }
        pigView.update(sheet ?? pigSim.state);
        if (params.has("debug")) console.log("pigeons", JSON.stringify(pigSim.stats), JSON.stringify(pigSim.spotList().filter((sp) => sp.busy).map((sp) => [Math.round(sp.x), Math.round(sp.y)])), JSON.stringify(Array.from(pigSim.state.alive).flatMap((a, i) => (a ? [[+pigSim.state.x[i]!.toFixed(1), +pigSim.state.y[i]!.toFixed(1)]] : [])).slice(0, 8)));
      }
      ctx.ready();
    });
  } else ctx.ready();
}

/** Huit oiseaux dans huit poses (debout, coup de bec, marche, alerte, montée, descente, plané, atterrissage) et les quatre plumages. */
function pigeonSheet(terrain: { heightAt(x: number, y: number): number }, x0: number, y0: number): PigeonState {
  const n = 8, f = (): Float32Array => new Float32Array(n);
  const st: PigeonState = { capacity: n, alive: new Uint8Array(n).fill(1), x: f(), y: f(), z: f(), heading: f(), pitch: f(), wing: f(), wing2: f(), fold: f(), peck: f(), bob: f(), tint: new Uint8Array(n) };
  const poses = [
    { }, { peck: 1 }, { bob: 0.014 }, { fold: 0.35, wing: 0.3 },
    { fold: 1, wing: 0.9, wing2: 0.4, pitch: 0.5, up: 1.0 }, { fold: 1, wing: -0.7, wing2: -0.4, pitch: -0.2, up: 1.0 }, { fold: 1, wing: 0.15, up: 1.0 }, { fold: 1, wing: 0.9, wing2: 0.5, pitch: 0.7, up: 0.5 },
  ];
  poses.forEach((p: { peck?: number; bob?: number; fold?: number; wing?: number; wing2?: number; pitch?: number; up?: number }, i) => {
    st.x[i] = x0 + i * 0.7;
    st.y[i] = y0;
    st.z[i] = terrain.heightAt(st.x[i]!, y0) + (p.up ?? 0);
    st.heading[i] = Math.PI / 2;
    st.peck[i] = p.peck ?? 0;
    st.bob[i] = p.bob ?? 0;
    st.fold[i] = p.fold ?? 0;
    st.wing[i] = p.wing ?? 0;
    st.wing2[i] = p.wing2 ?? 0;
    st.pitch[i] = p.pitch ?? 0;
    st.tint[i] = i % 4;
  });
  return st;
}
