import * as THREE from "three";
import { recipeFromSeed } from "../core/character";
import { createVehicle } from "../core/vehicle";
import { CATALOG, FAMILIES, paletteColor, type VehicleDef } from "../core/vehicle-catalog";
import { createPlayerModel } from "../render/player-model";
import type { VehicleModel } from "../render/vehicle-model";
import type { GameContext } from "./context";
import { followSun, gameSpawn } from "./game";
import { ParkedModels } from "../render/parked-models";
import { ZONES, type Zone } from "../core/damage";
import { buildModel, restGeometryOf } from "./vehicles";

/**
 * ?view=vehicles : la galerie des véhicules du catalogue, rangés par famille devant la caméra, au départ du jeu (captures, choix des mesures).
 * Paramètres : `ids=citadine,moto-routiere` (liste ; défaut : tout), `family=car|moto|bike|kickscooter`, `heading` (cap en rad : 0 vers le nord, loin de la caméra ;
 * 3,14 de face ; 1,57 de profil ; défaut 2,35 : de trois quarts), `variant` (couleur), `perRow` (4), `eye` (hauteur de l'œil ; défaut : monte avec le nombre de rangées), `rider=1` (un conducteur sur les deux-roues), `parked=1` (les véhicules tels qu'ils sont garés dans le jeu : instances au repos, sans conducteur).
 * `dent=front:0.8,left:0.5` (zones écrasées, voitures seulement : D110). Un appui sur l'écran passe à la couleur suivante de chaque palette.
 */
export function startVehicleGallery(ctx: GameContext): void {
  const { camera, renderer, scene, sky, atmosphere, tiles, terrainView, world, params } = ctx;
  const spawn = gameSpawn(params);
  const ground = world.terrain.heightAt(spawn.x, spawn.y);
  const ids = params.get("ids")?.split(",");
  const family = params.get("family");
  const defs: VehicleDef[] = CATALOG.filter((d) => (!ids || ids.includes(d.id)) && (!family || d.family === family));
  const heading = Number(params.get("heading") ?? 2.35);
  const perRow = Math.max(1, Math.floor(Number(params.get("perRow") ?? 4)));
  const withRider = params.get("rider") === "1";
  let variant = Math.floor(Number(params.get("variant") ?? 0)) || 0;
  // `dent=front:0.8,left:0.5` : zones écrasées (0 à 1), pour juger les dégâts (D110).
  const dent = params.has("dent") ? parseDent(params.get("dent")!) : null;

  const rows = Math.ceil(defs.length / perRow);
  // La caméra monte avec le nombre de rangées, pour voir celles de derrière par-dessus celles de devant.
  const eye = Number(params.get("eye") ?? 1.5 + 2.4 * (rows - 1));
  // Une case par véhicule, large comme le plus long de la rangée ; la caméra recule pour tout cadrer.
  const cell = Math.max(2.4, ...defs.map((d) => d.size.length)) + 0.9;
  const width = Math.min(defs.length, perRow) * cell;
  const dist = Math.max(5, width / 2 / Math.tan(THREE.MathUtils.degToRad(46)) + 2.5);
  const placed: { model: VehicleModel; rider: ReturnType<typeof createPlayerModel> | null }[] = [];
  const asParked = params.get("parked") === "1";
  const parked = new ParkedModels(400, restGeometryOf);
  if (asParked) scene.add(parked.group);
  const build = (): void => {
    if (asParked) {
      const items = defs.map((def, i) => {
        const row = Math.floor(i / perRow), col = i % perRow;
        const inRow = Math.min(perRow, defs.length - row * perRow);
        const state = createVehicle(spawn.x + (col - (inRow - 1) / 2) * cell, spawn.y + dist + row * cell, heading, world.terrain);
        return { model: def.id, x: state.x, y: state.y, z: state.z, heading, pitch: 0, color: paletteColor(def, variant) };
      });
      parked.set(items);
      hint.textContent = `Garés (instances) : ${defs.map((d) => `${d.name} (${paletteColor(d, variant)})`).join(" · ")}`;
      return;
    }
    for (const p of placed) {
      scene.remove(p.model.group);
      p.model.dispose();
      p.rider?.dispose();
    }
    placed.length = 0;
    defs.forEach((def, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const inRow = Math.min(perRow, defs.length - row * perRow);
      const x = spawn.x + (col - (inRow - 1) / 2) * cell, y = spawn.y + dist + row * cell;
      const state = createVehicle(x, y, heading, world.terrain);
      const model = buildModel(def, variant);
      if (dent) model.setDamage?.(dent);
      model.update(state);
      scene.add(model.group);
      let rider: ReturnType<typeof createPlayerModel> | null = null;
      if (withRider && model.pose !== "hidden") {
        rider = createPlayerModel(recipeFromSeed(10 + i));
        model.group.add(rider.group);
        rider.ride(model, 0.6);
      }
      placed.push({ model, rider });
    });
    hint.textContent = `${defs.map((d) => `${FAMILIES[d.family].icon} ${d.name} (${paletteColor(d, variant)})`).join(" · ")}`;
  };
  const hint = document.createElement("div");
  hint.style.cssText = "position:fixed;left:50%;bottom:10px;transform:translateX(-50%);max-width:94vw;padding:5px 12px;border-radius:10px;background:rgba(0,0,0,.5);color:#fff;font:12px system-ui,sans-serif;pointer-events:none;text-align:center;";
  document.body.append(hint);
  build();
  renderer.domElement.addEventListener("click", () => {
    variant++;
    build();
  });

  const camX = spawn.x, camZ = -spawn.y;
  camera.position.set(camX, ground + eye, camZ);
  camera.lookAt(camX, ground + 0.7, camZ - dist - (rows - 1) * cell * 0.5);
  const placeSun = followSun(ctx);
  ctx.ready({});
  const frame = (): void => {
    tiles.update(spawn.x, spawn.y, 0, 0);
    terrainView.update(spawn.x, spawn.y);
    atmosphere.advance(0);
    placeSun(spawn.x, spawn.y, ground);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** `front:0.8,left:0.5` → écrasement de chaque zone (les autres à zéro). */
export function parseDent(text: string): Record<Zone, number> {
  const zones: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0 };
  for (const part of text.split(",")) {
    const [z, v] = part.split(":");
    if (z && (ZONES as readonly string[]).includes(z)) zones[z as Zone] = Math.min(1, Math.max(0, Number(v ?? 1) || 0));
  }
  return zones;
}
