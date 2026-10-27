import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Atmosphere } from "./atmosphere";
import type { StyleResources } from "./stylized";

function make(hour: number, speed: number, day: number): Atmosphere {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#fff", 100, 500);
  const sky = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, zenith: { value: new THREE.Color() }, sun: { value: new THREE.Vector3() },
      stars: { value: 0 }, cloudLight: { value: 1 }, disc: { value: 1 },
    },
  });
  const res = { glowMat: { opacity: 0, visible: false }, haloMat: { opacity: 0, visible: false } } as unknown as StyleResources;
  const renderer = { toneMappingExposure: 1 } as unknown as THREE.WebGLRenderer;
  return new Atmosphere(hour, speed, day, scene, renderer, new THREE.DirectionalLight(), new THREE.HemisphereLight(), sky, res);
}

describe("horloge du jeu", () => {
  it("l'heure s'affiche HH:MM", () => {
    expect(make(16.5, 0, 200).clock).toBe("16:30");
  });

  it("à l'arrêt (pause, vitesse nulle), ni l'heure ni le jour ne bougent", () => {
    const a = make(23.99, 0, 200);
    a.advance(1000);
    expect([a.hour, a.day]).toEqual([23.99, 200]);
  });

  it("le jour avance à minuit, et boucle en fin d'année", () => {
    const a = make(23.9, 1 / 50, 200);
    a.advance(4); // 0,08 h : encore le même jour
    expect(a.day).toBe(200);
    a.advance(4);
    expect(a.day).toBe(201);
    expect(a.hour).toBeLessThan(0.1);
    const b = make(23.99, 1, 365);
    b.advance(0.05);
    expect(b.day).toBe(1);
  });
});
