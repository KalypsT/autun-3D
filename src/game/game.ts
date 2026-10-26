import { HEAD_HEIGHT, solveCamera } from "../core/camera-rig";
import { createPlayer, PLAYER_RADIUS, stepPlayer } from "../core/player";
import { stepVehicle } from "../core/vehicle";
import { Controls } from "../input/controls";
import { createPlayerModel } from "../render/player-model";
import type { GameContext } from "./context";
import { FrameMeter } from "./hud";
import { Fleet, type Vehicle } from "./vehicles";

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
/** On peut monter sur un véhicule à moins de cette distance (m). */
const MOUNT_DISTANCE = 2.2;
/** Caméra de poursuite : distance à l'arrêt et inclinaison de repos. */
const CHASE_DISTANCE = 3.9;
const CHASE_PITCH = 0.24;

function angleDelta(from: number, to: number): number {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/** Carte d'ombres centrée sur le joueur (plus fine qu'une carte pour toute la zone) ; renvoie de quoi placer le soleil à chaque image. */
export function followSun(ctx: GameContext): (x: number, y: number, z: number) => void {
  const { scene, sunLight, sunDir, atmosphere } = ctx;
  const sc = sunLight.shadow.camera;
  sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF; sc.near = 20; sc.far = 700;
  sc.updateProjectionMatrix();
  scene.add(sunLight.target);
  return (x, y, z) => {
    sunDir.copy(atmosphere.lightDir);
    // Cases de 0,5 m pour que les ombres ne scintillent pas.
    const sx = Math.round(x / 0.5) * 0.5, sy = Math.round(y / 0.5) * 0.5;
    sunLight.target.position.set(sx, z, -sy);
    sunLight.position.set(sx + sunDir.x * 300, z + sunDir.y * 300, -sy + sunDir.z * 300);
    sunLight.target.updateMatrixWorld();
  };
}

export function startGame(ctx: GameContext): void {
  const { camera, renderer, scene, sky, atmosphere, world, params, debugEl, tiles, terrainView, colliders } = ctx;
  const { terrain } = world;
  const spawn = gameSpawn(params);
  const startYaw = spawn.yaw;
  const player = createPlayer(spawn.x, spawn.y, terrain, startYaw);
  const model = createPlayerModel();
  scene.add(model.group);

  const placeSun = followSun(ctx);

  // Véhicules garés : aux parkings à vélos des tuiles déjà construites, puis de chaque nouvelle tuile.
  const fleet = new Fleet(scene, colliders, terrain);
  for (const furniture of tiles.loadedFurniture()) fleet.addFromTile({ furniture });
  tiles.onBuild = (data) => fleet.addFromTile(data);

  const controls = new Controls(
    document.getElementById("touch")!,
    document.getElementById("stick-base")!,
    document.getElementById("stick-knob")!,
    document.getElementById("gas"),
    document.getElementById("brake"),
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
  if (params.has("debug")) debugEl.style.display = "block";

  let yaw = startYaw;
  let pitch = 0.28;
  const distance = Number(params.get("dist") ?? 3.6);
  let camDist = distance;
  let riding: Vehicle | null = null;
  /** Descente demandée en roulant : on freine d'abord. */
  let leaving = false;
  let crank = 0;
  let lookIdle = 0;
  const speedOf = (): number => (riding ? riding.state.speed : player.speed);
  const meter = new FrameMeter(renderer, debugEl, () => ` · x ${player.x.toFixed(0)} y ${player.y.toFixed(0)} · ${(Math.abs(speedOf()) * 3.6).toFixed(1)} km/h · ${tiles.stats.loaded.length} tuiles · ${atmosphere.clock}`);

  const actionEl = document.getElementById("action") as HTMLButtonElement;
  const nearbyEl = document.getElementById("nearby")!;
  const nearbyArrow = document.getElementById("nearby-arrow")!;
  const nearbyText = document.getElementById("nearby-text")!;

  const mount = (v: Vehicle): void => {
    riding = v;
    leaving = false;
    fleet.take(v);
    v.model.group.add(model.group);
    model.group.visible = true;
    controls.mode = "drive";
    document.body.classList.add("driving");
  };
  const dismount = (): void => {
    const v = riding!;
    const s = v.state;
    // Pied à terre du côté gauche, hors des obstacles.
    const r = colliders.resolve(s.x - Math.cos(s.heading) * 0.75, s.y + Math.sin(s.heading) * 0.75, PLAYER_RADIUS);
    Object.assign(player, { x: r.x, y: r.y, z: terrain.heightAt(r.x, r.y), vx: 0, vy: 0, speed: 0, heading: s.heading });
    s.vx = s.vy = s.yawRate = s.steer = s.lean = 0;
    s.speed = 0;
    v.model.update(s);
    scene.add(model.group);
    fleet.park(v);
    riding = null;
    leaving = false;
    controls.mode = "foot";
    document.body.classList.remove("driving");
  };
  const act = (): void => {
    if (riding) {
      if (Math.abs(riding.state.speed) < 1.2) dismount();
      else leaving = true;
      return;
    }
    const n = fleet.nearest(player.x, player.y);
    if (n && n.distance < MOUNT_DISTANCE) mount(n.vehicle);
  };
  actionEl.addEventListener("click", act);
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyF") debugEl.style.display = debugEl.style.display === "block" ? "none" : "block";
    if (e.code === "KeyE" && !e.repeat) act();
  });
  // ?ride=velo : départ sur un vélo (captures, essais).
  if (params.get("ride") === "velo") mount(fleet.add("velo-depart", spawn.x, spawn.y, startYaw, 1));

  let hudTimer = 0;
  let actionLabel = "";
  const updateHud = (): void => {
    let label = "";
    const n = riding ? null : fleet.nearest(player.x, player.y);
    if (riding) label = "Descendre";
    else if (n && n.distance < MOUNT_DISTANCE) label = "Monter 🚲";
    if (label !== actionLabel) {
      actionLabel = label;
      actionEl.textContent = label;
      actionEl.classList.toggle("show", label !== "");
    }
    const showNearby = !!n && n.distance >= MOUNT_DISTANCE && n.distance < 400;
    nearbyEl.classList.toggle("show", showNearby);
    if (showNearby) {
      const bearing = Math.atan2(n.vehicle.state.x - player.x, n.vehicle.state.y - player.y);
      nearbyArrow.style.transform = `rotate(${bearing - yaw}rad)`;
      nearbyText.textContent = `🚲 ${Math.round(n.distance)} m`;
    }
  };

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
      if (riding) {
        const drive = leaving ? { throttle: 0, brake: 1, steer: 0 } : { throttle: input.throttle, brake: input.brake, steer: input.steer };
        stepVehicle(riding.state, riding.spec, drive, STEP, terrain, colliders);
        if (drive.throttle > 0) crank += (Math.max(riding.state.speed, 0.8) / riding.spec.wheelRadius) * 0.45 * STEP;
      } else stepPlayer(player, { forward: input.forward, right: input.right, run: input.run }, yaw, STEP, terrain, colliders);
      acc -= STEP;
    }
    if (riding) {
      const s = riding.state;
      if (leaving && Math.abs(s.speed) < 0.4) dismount();
      else {
        player.x = s.x;
        player.y = s.y;
        player.z = s.z;
        s.impact = 0;
        // Caméra de poursuite : se recale derrière le véhicule, sauf si l'on vient de regarder ailleurs.
        lookIdle = input.looking ? 0 : lookIdle + dt;
        if (lookIdle > 1.2) {
          const behind = s.heading + (s.speed < -0.3 ? Math.PI : 0);
          yaw += angleDelta(yaw, behind) * Math.min(1, dt * 2.5);
          pitch += (CHASE_PITCH - pitch) * Math.min(1, dt * 1.5);
        }
      }
    }

    // Caméra : la distance revient doucement quand l'obstacle disparaît, se resserre aussitôt à l'approche d'un mur.
    const speed = Math.abs(speedOf());
    const wanted = riding ? CHASE_DISTANCE + speed * 0.15 : distance;
    const focusZ = riding ? player.z + 0.2 : player.z;
    const rig = solveCamera({ x: player.x, y: player.y, z: focusZ, yaw, pitch, distance: wanted }, colliders, terrain);
    camDist = rig.distance < camDist ? rig.distance : Math.min(rig.distance, camDist + dt * 6);
    const k = rig.distance > 0 ? camDist / rig.distance : 1;
    const tz = focusZ + HEAD_HEIGHT;
    const cx = player.x + (rig.x - player.x) * k, cy = player.y + (rig.y - player.y) * k, cz = tz + (rig.z - tz) * k;
    camera.position.set(cx, cz, -cy);
    camera.lookAt(player.x, tz - 0.1, -player.y);
    const fov = 62 + Math.min(speed * 0.8, 8);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    if (riding) {
      riding.model.update(riding.state);
      model.ride(riding.model.seat, crank);
    } else {
      model.update(player.x, player.y, player.z, player.heading, player.stride, player.speed);
      model.group.visible = camDist > 0.9;
    }
    fleet.cull(cx, cy);
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.2;
      updateHud();
    }

    tiles.update(player.x, player.y);
    terrainView.update(player.x, player.y);

    atmosphere.advance(dt);
    placeSun(player.x, player.y, player.z);
    sky.position.copy(camera.position);

    renderer.render(scene, camera);
    meter.tick(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  ctx.ready({
    player, colliders, fleet,
    riding: () => riding,
    camera: () => ({ x: camera.position.x, y: -camera.position.z, z: camera.position.y }),
  });
}
