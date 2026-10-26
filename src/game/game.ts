import { HEAD_HEIGHT, solveCamera } from "../core/camera-rig";
import { createPlayer, stepPlayer } from "../core/player";
import { Controls } from "../input/controls";
import { createPlayerModel } from "../render/player-model";
import type { GameContext } from "./context";
import { FrameMeter } from "./hud";

/** Point de départ : place du Champ de Mars, face au nord (mairie et théâtre au fond). */
const SPAWN = { x: -10, y: -40, heading: 0 };

/** ?at=x,y&yaw=radians : point de départ imposé (tests, captures). */
export function gameSpawn(params: URLSearchParams): { x: number; y: number; yaw: number } {
  const at = params.get("at")?.split(",").map(Number);
  const yaw = Number(params.get("yaw") ?? SPAWN.heading);
  return at && at.length === 2 && at.every(Number.isFinite) ? { x: at[0]!, y: at[1]!, yaw } : { x: SPAWN.x, y: SPAWN.y, yaw };
}
const STEP = 1 / 60;
const MIN_PITCH = -0.3;
const MAX_PITCH = 1.25;
const SHADOW_HALF = 80;

export function startGame(ctx: GameContext): void {
  const { camera, renderer, scene, sky, sunLight, sunDir, atmosphere, world, params, debugEl, tiles, terrainView, colliders } = ctx;
  const { terrain } = world;
  const spawn = gameSpawn(params);
  const startYaw = spawn.yaw;
  const player = createPlayer(spawn.x, spawn.y, terrain, startYaw);
  const model = createPlayerModel();
  scene.add(model.group);

  // Carte d'ombres centrée sur le joueur : plus fine qu'une carte pour toute la zone.
  const sc = sunLight.shadow.camera;
  sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF; sc.near = 20; sc.far = 700;
  sc.updateProjectionMatrix();
  scene.add(sunLight.target);

  const controls = new Controls(
    document.getElementById("touch")!,
    document.getElementById("stick-base")!,
    document.getElementById("stick-knob")!,
  );
  const fsButton = document.getElementById("fullscreen");
  fsButton?.addEventListener("click", () => {
    void document.documentElement.requestFullscreen?.().then(async () => {
      try {
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
      } catch {
        /* le verrouillage d'orientation n'existe pas partout */
      }
    });
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyF") debugEl.style.display = debugEl.style.display === "block" ? "none" : "block";
  });
  if (params.has("debug")) debugEl.style.display = "block";

  let yaw = startYaw;
  let pitch = 0.28;
  const distance = Number(params.get("dist") ?? 3.6);
  let camDist = distance;
  const meter = new FrameMeter(renderer, debugEl, () => ` · x ${player.x.toFixed(0)} y ${player.y.toFixed(0)} · ${(player.speed * 3.6).toFixed(1)} km/h · ${tiles.stats.loaded.length} tuiles · ${atmosphere.clock}`);

  let last = performance.now();
  let acc = 0;
  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const input = controls.poll();
    yaw += input.lookYaw;
    pitch = Math.min(Math.max(pitch + input.lookPitch, MIN_PITCH), MAX_PITCH);

    acc += dt;
    while (acc >= STEP) {
      stepPlayer(player, { forward: input.forward, right: input.right, run: input.run }, yaw, STEP, terrain, colliders);
      acc -= STEP;
    }

    // Caméra : la distance revient doucement quand l'obstacle disparaît, se resserre aussitôt à l'approche d'un mur.
    const rig = solveCamera({ x: player.x, y: player.y, z: player.z, yaw, pitch, distance: distance }, colliders, terrain);
    camDist = rig.distance < camDist ? rig.distance : Math.min(rig.distance, camDist + dt * 6);
    const k = rig.distance > 0 ? camDist / rig.distance : 1;
    const tz = player.z + HEAD_HEIGHT;
    const cx = player.x + (rig.x - player.x) * k, cy = player.y + (rig.y - player.y) * k, cz = tz + (rig.z - tz) * k;
    camera.position.set(cx, cz, -cy);
    camera.lookAt(player.x, tz - 0.1, -player.y);

    model.update(player.x, player.y, player.z, player.heading, player.stride, player.speed);
    model.group.visible = camDist > 0.9;

    tiles.update(player.x, player.y);
    terrainView.update(player.x, player.y);

    atmosphere.advance(dt);
    sunDir.copy(atmosphere.lightDir);

    // Le soleil suit le joueur (cases de 0,5 m pour que les ombres ne scintillent pas).
    const sx = Math.round(player.x / 0.5) * 0.5, sy = Math.round(player.y / 0.5) * 0.5;
    sunLight.target.position.set(sx, player.z, -sy);
    sunLight.position.set(sx + sunDir.x * 300, player.z + sunDir.y * 300, -sy + sunDir.z * 300);
    sunLight.target.updateMatrixWorld();
    sky.position.copy(camera.position);

    renderer.render(scene, camera);
    meter.tick(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  ctx.ready({ player, colliders, camera: () => ({ x: camera.position.x, y: -camera.position.z, z: camera.position.y }) });
}
