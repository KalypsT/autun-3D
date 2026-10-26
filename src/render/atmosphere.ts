import * as THREE from "three";
import { sunDirection, sunPosition } from "../core/sun";
import { THEMES } from "./style";
import type { StyleResources } from "./stylized";

/** Une ambiance à une hauteur de soleil donnée. */
interface Palette {
  horizon: string;
  mid: string;
  zenith: string;
  fog: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  exposure: number;
  fogNear: number;
  fogFar: number;
}

const DAY = THEMES["affiche"]!, NIGHT = THEMES["nuit"]!;

const fromTheme = (t: typeof DAY): Palette => ({
  horizon: t.sky.horizon, mid: t.sky.mid, zenith: t.sky.zenith, fog: t.fog[0], sun: t.sun.color, sunI: t.sun.intensity,
  hemiSky: t.hemi.sky, hemiGround: t.hemi.ground, hemiI: t.hemi.intensity, exposure: t.exposure, fogNear: t.fog[1], fogFar: t.fog[2],
});

/** Jalons : hauteur du soleil (degrés) -> ambiance. Entre deux jalons, tout est interpolé. */
const STOPS: [number, Palette][] = [
  [-10, { ...fromTheme(NIGHT), sunI: 0.6, hemiI: 1.9, exposure: 1.3 }],
  [-3, { horizon: "#c86a6a", mid: "#5a4a86", zenith: "#1a2050", fog: "#6a4a7a", sun: "#ff8a5a", sunI: 0.9, hemiSky: "#6a6aa8", hemiGround: "#3a2a44", hemiI: 1.6, exposure: 1.2, fogNear: 110, fogFar: 640 }],
  [3, { horizon: "#ffa860", mid: "#f0907a", zenith: "#4a62a8", fog: "#f4a878", sun: "#ff9348", sunI: 2.2, hemiSky: "#b8a0b8", hemiGround: "#9a5a3a", hemiI: 1.3, exposure: 1.05, fogNear: 150, fogFar: 760 }],
  [15, fromTheme(DAY)],
];

const col = (hex: string): THREE.Color => new THREE.Color(hex);
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Heure, soleil, lune, ciel, brouillard et lumières : tout ce qui change du lever au coucher. */
export class Atmosphere {
  hour: number;
  /** Heures de jeu écoulées par seconde réelle (0 : horloge arrêtée). */
  speed: number;
  readonly day: number;
  /** Direction vers la source de lumière (soleil, puis lune) dans le repère three ; modifiée sur place. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  private lastApplied = -1;

  constructor(
    hour: number,
    speed: number,
    day: number,
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sunLight: THREE.DirectionalLight,
    private readonly hemi: THREE.HemisphereLight,
    private readonly skyMat: THREE.ShaderMaterial,
    private readonly res: StyleResources,
  ) {
    this.hour = hour;
    this.speed = speed;
    this.day = day;
    this.apply();
  }

  advance(dt: number): void {
    if (this.speed === 0) return;
    this.hour = (this.hour + dt * this.speed) % 24;
    // Réglage à 4 images/s : assez fin pour un cycle de plusieurs minutes.
    if (Math.abs(this.hour - this.lastApplied) > 0.01 || this.hour < this.lastApplied) this.apply();
  }

  get clock(): string {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  private palette(elevDeg: number): Palette {
    if (elevDeg <= STOPS[0]![0]) return STOPS[0]![1];
    for (let i = 1; i < STOPS.length; i++) {
      const [e1, p1] = STOPS[i]!;
      if (elevDeg <= e1) {
        const [e0, p0] = STOPS[i - 1]!;
        const t = (elevDeg - e0) / (e1 - e0);
        const mix = (a: string, b: string): string => "#" + col(a).lerp(col(b), t).getHexString();
        const num = (a: number, b: number): number => a + (b - a) * t;
        return {
          horizon: mix(p0.horizon, p1.horizon), mid: mix(p0.mid, p1.mid), zenith: mix(p0.zenith, p1.zenith), fog: mix(p0.fog, p1.fog),
          sun: mix(p0.sun, p1.sun), sunI: num(p0.sunI, p1.sunI), hemiSky: mix(p0.hemiSky, p1.hemiSky), hemiGround: mix(p0.hemiGround, p1.hemiGround),
          hemiI: num(p0.hemiI, p1.hemiI), exposure: num(p0.exposure, p1.exposure), fogNear: num(p0.fogNear, p1.fogNear), fogFar: num(p0.fogFar, p1.fogFar),
        };
      }
    }
    return STOPS[STOPS.length - 1]![1];
  }

  private apply(): void {
    this.lastApplied = this.hour;
    const sun = sunPosition(this.day, this.hour);
    const [sx, sy, sz] = sunDirection(sun);
    const elev = (sun.elevation * 180) / Math.PI;
    const p = this.palette(elev);

    // Lumière : le soleil (jamais sous 5° pour ne pas éclairer par en dessous), puis la lune du côté opposé.
    const lo = Math.max(sun.elevation, 0.09);
    const c = Math.cos(lo), sunAz = sun.azimuth;
    const sunL = new THREE.Vector3(Math.sin(sunAz) * c, Math.sin(lo), -Math.cos(sunAz) * c);
    const moonL = new THREE.Vector3(-Math.sin(sunAz) * 0.55, 0.8, Math.cos(sunAz) * 0.55).normalize();
    const w = smooth(-4, -12, elev);
    this.lightDir.copy(sunL).lerp(moonL, w).normalize();

    this.sunLight.color.set(p.sun);
    this.sunLight.intensity = p.sunI;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiI;
    this.renderer.toneMappingExposure = p.exposure;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(p.fog);
    fog.near = p.fogNear;
    fog.far = p.fogFar;

    const u = this.skyMat.uniforms;
    (u["horizon"]!.value as THREE.Color).set(p.horizon);
    (u["mid"]!.value as THREE.Color).set(p.mid);
    (u["zenith"]!.value as THREE.Color).set(p.zenith);
    (u["sun"]!.value as THREE.Vector3).set(sx, sz, -sy);
    u["stars"]!.value = smooth(-4, -10, elev);
    u["cloudLight"]!.value = 0.18 + 0.82 * smooth(-8, 8, elev);
    u["disc"]!.value = 1;

    // Fenêtres et lampadaires : s'allument de 3° à -6°.
    const glow = smooth(3, -6, elev);
    this.res.glowMat.opacity = glow;
    this.res.glowMat.visible = glow > 0.01;
    this.res.haloMat.opacity = 0.32 * glow;
    this.res.haloMat.visible = glow > 0.01;
  }
}
