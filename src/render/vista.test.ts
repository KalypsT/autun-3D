import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loadRealWorld } from "../core/testing";
import { Atmosphere } from "./atmosphere";
import type { StyleResources } from "./stylized";
import type { TerrainView } from "./terrain";
import type { TileManager } from "./tile-manager";
import { Vista, VISTA_RANGE } from "./vista";

// Panorama (D268) : en hauteur, l'horizon s'éloigne ; au sol, rien ne change.
function atmosphere(weather: "beau" | "brume"): { a: Atmosphere; fog: THREE.Fog } {
  const scene = new THREE.Scene();
  const fog = new THREE.Fog("#fff", 100, 500);
  scene.fog = fog;
  const sky = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, zenith: { value: new THREE.Color() }, sun: { value: new THREE.Vector3() },
      stars: { value: 0 }, cloudLight: { value: 1 }, disc: { value: 1 }, cover: { value: 0 }, clouds: { value: 0 },
    },
  });
  const res = { glowMat: { opacity: 0, visible: false }, haloMat: { opacity: 0, visible: false } } as unknown as StyleResources;
  const renderer = { toneMappingExposure: 1 } as unknown as THREE.WebGLRenderer;
  const a = new Atmosphere(15, 0, 200, scene, renderer, new THREE.DirectionalLight(), new THREE.HemisphereLight(), sky, res);
  a.setWeather(weather);
  return { a, fog };
}

describe("panorama (D268)", () => {
  it("brouillard : inchangé au sol, éloigné vers la portée en belvédère, toujours rapproché par la brume", () => {
    const { a, fog } = atmosphere("beau");
    const [near0, far0] = [fog.near, fog.far];
    a.setVista(0, VISTA_RANGE);
    expect([fog.near, fog.far]).toEqual([near0, far0]);
    a.setVista(1, VISTA_RANGE);
    expect(fog.far).toBeCloseTo(VISTA_RANGE, 0);
    expect(fog.near).toBeGreaterThan(near0);
    a.setVista(0.5, VISTA_RANGE);
    expect(fog.far).toBeGreaterThan(far0);
    expect(fog.far).toBeLessThan(VISTA_RANGE);
    a.setVista(0, VISTA_RANGE);
    expect(fog.far).toBeCloseTo(far0, 6);
    const mist = atmosphere("brume");
    mist.a.setVista(1, VISTA_RANGE);
    expect(mist.fog.far).toBeLessThan(200);
  });

  it("belvédère : la caméra domine la ville depuis la Croix de la Libération, pas dans les rues ni sur la place", () => {
    const world = loadRealWorld();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.15, 1200);
    const vista = new Vista(world.terrain, world.manifest, {} as TerrainView, {} as TileManager, atmosphere("beau").a, camera, new URLSearchParams());
    const eye = (x: number, y: number, h = 1.7): number => vista.dominance(x, y, world.terrain.heightAt(x, y) + h);
    // Sur la terrasse de la croix : plus de 200 m au-dessus du relief alentour (le panorama est entier).
    expect(eye(-838.5, -1805.5)).toBeGreaterThan(200);
    // Parvis de la cathédrale, place du Champ de Mars, avenue de la gare : moins de 90 m (rien ne change).
    for (const [x, y] of [[36.6, -560], [20, -40], [-450, 450]] as const) expect(eye(x, y)).toBeLessThan(90);
  });
});
