import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Atmosphere } from "./atmosphere";
import type { StyleResources } from "./stylized";

function make(hour: number, speed: number, date: number): Atmosphere {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#fff", 100, 500);
  const sky = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, zenith: { value: new THREE.Color() }, sun: { value: new THREE.Vector3() },
      stars: { value: 0 }, cloudLight: { value: 1 }, disc: { value: 1 }, cover: { value: 0 }, clouds: { value: 0 },
    },
  });
  const res = { glowMat: { opacity: 0, visible: false }, haloMat: { opacity: 0, visible: false } } as unknown as StyleResources;
  const renderer = { toneMappingExposure: 1 } as unknown as THREE.WebGLRenderer;
  return new Atmosphere(hour, speed, date, scene, renderer, new THREE.DirectionalLight(), new THREE.HemisphereLight(), sky, res);
}

describe("horloge du jeu", () => {
  it("l'heure s'affiche HH:MM", () => {
    expect(make(16.5, 0, 200).clock).toBe("16:30");
  });

  it("à l'arrêt (pause, vitesse nulle), ni l'heure ni la date ne bougent", () => {
    const a = make(23.99, 0, 9);
    a.advance(1000);
    expect([a.hour, a.date]).toEqual([23.99, 9]);
  });

  it("la date avance à minuit ; le calendrier suit (semaine, saison, soleil)", () => {
    const a = make(23.9, 1 / 50, 13);
    a.advance(4); // 0,08 h : encore le même jour
    expect(a.date).toBe(13);
    expect(a.calendar).toMatchObject({ season: 1, weekday: 6 });
    a.advance(4);
    expect(a.date).toBe(14);
    expect(a.hour).toBeLessThan(0.1);
    expect(a.calendar).toMatchObject({ season: 2, weekday: 0 });
    expect(a.day).toBe(Math.round(a.calendar.doy));
  });

  it("une saison figée garde son soleil ; la durée des saisons change la saison d'une date", () => {
    const a = make(12, 0, 9);
    a.setCalendar({ length: 7, frozen: 3 });
    expect(a.calendar.season).toBe(3);
    a.setCalendar({ length: 14, frozen: null });
    expect(a.calendar.season).toBe(0);
  });
});

describe("météo à l'écran (D196)", () => {
  const sunOf = (a: Atmosphere): number => (a as unknown as { sunLight: THREE.DirectionalLight }).sunLight.intensity;
  const fogOf = (a: Atmosphere): THREE.Fog => (a as unknown as { scene: THREE.Scene }).scene.fog as THREE.Fog;

  it("par temps couvert, le soleil est voilé ; sous la pluie et dans la brume, l'horizon se rapproche", () => {
    const a = make(14, 0, 9);
    a.setWeather("beau");
    const sun = sunOf(a), far = fogOf(a).far;
    a.setWeather("nuageux");
    expect(sunOf(a)).toBeLessThan(sun * 0.7);
    a.setWeather("pluie");
    expect(fogOf(a).far).toBeLessThan(far * 0.8);
    a.setWeather("brume");
    expect(fogOf(a).far).toBeLessThan(200);
  });

  it("les phares s'allument de jour dans la brume et sous la pluie, pas par beau temps", () => {
    const a = make(14, 0, 9);
    a.setWeather("beau");
    expect(a.headlights).toBe(0);
    a.setWeather("brume");
    expect(a.headlights).toBe(1);
    a.setWeather("pluie");
    expect(a.headlights).toBe(1);
  });

  it("l'orage fait des éclairs, chacun suivi d'un coup de tonnerre", () => {
    const a = make(22, 0, 9);
    a.setWeather("orage");
    const thunders: number[] = [];
    a.onThunder = (delay) => thunders.push(delay);
    for (let i = 0; i < 60 * 60; i++) a.advance(1 / 60);
    expect(thunders.length).toBeGreaterThan(2);
    for (const d of thunders) expect(d).toBeGreaterThan(1);
    a.setWeather("beau");
    thunders.length = 0;
    for (let i = 0; i < 60 * 60; i++) a.advance(1 / 60);
    expect(thunders.length).toBe(0);
  });
});
