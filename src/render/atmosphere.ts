import * as THREE from "three";
import { calendarAt, DEFAULT_CALENDAR, type CalendarConfig, type CalendarDay, type Season } from "../core/calendar";
import { fixedWeather, weatherAt, type WeatherKind, type WeatherState } from "../core/weather";
import { sunDirection, sunPosition } from "../core/sun";
import { THEMES } from "./style";
import type { StyleResources } from "./stylized";
import { setGroundWeather } from "./weather-fx";
import { Precipitation, RAIN, SNOW } from "./precipitation";

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
const GREY = new THREE.Color();
/** Couleur grisée par les nuages : vers sa propre luminance (légèrement bleutée), d'autant plus que `k` est grand ; `lift` l'éclaircit. */
function overcast(hex: string, k: number, lift = 1): THREE.Color {
  const c = col(hex);
  const l = (0.3 * c.r + 0.59 * c.g + 0.11 * c.b) * lift;
  return c.lerp(GREY.setRGB(l * 0.97, l * 0.99, l * 1.04), k);
}
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Heure, soleil, lune, ciel, brouillard et lumières : tout ce qui change du lever au coucher. */
export class Atmosphere {
  hour: number;
  /** Heures de jeu écoulées par seconde réelle (0 : horloge arrêtée). */
  speed: number;
  /** Date du jeu : jours écoulés depuis le début de la partie (avance à chaque minuit). Voir `core/calendar.ts`. */
  date: number;
  /** Durée des saisons et saison figée (réglages). */
  private config: CalendarConfig = DEFAULT_CALENDAR;
  private cal: CalendarDay;
  /** Météo imposée (`?weather=`), ou null : celle du calendrier. */
  private forced: WeatherKind | null = null;
  private wx: WeatherState = fixedWeather("beau");
  /** Saison d'une date avec les réglages en cours (pour la météo des jours voisins). */
  private readonly seasonOf = (d: number): Season => calendarAt(d, 12, this.config).season;
  /** Direction vers la source de lumière (soleil, puis lune) dans le repère three ; modifiée sur place. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  private lastApplied = -1;
  /** Éclairs (D196) : intensités de base (sans éclair), temps avant le prochain, éclair en cours. */
  private baseHemi = 1;
  private baseCloudLight = 1;
  private nextFlash = 5;
  private flash = 0;
  private flashes: number[] = [];
  /** Coup de tonnerre : délai (s) depuis l'éclair, selon la distance de la foudre, et force (0 à 1). Branché par le jeu (son). */
  onThunder: ((delay: number, strength: number) => void) | null = null;
  /** Pluie et neige qui tombent autour de la caméra (créées à la première averse). */
  private rain: Precipitation | null = null;
  private snowfall: Precipitation | null = null;
  private time = 0;

  constructor(
    hour: number,
    speed: number,
    date: number,
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sunLight: THREE.DirectionalLight,
    private readonly hemi: THREE.HemisphereLight,
    private readonly skyMat: THREE.ShaderMaterial,
    private readonly res: StyleResources,
  ) {
    this.hour = hour;
    this.speed = speed;
    this.date = Math.max(0, Math.floor(date));
    this.cal = calendarAt(this.date, hour, this.config);
    this.apply();
  }

  /** À chaque image : l'heure avance (sauf horloge arrêtée), la pluie tombe, les éclairs passent. */
  advance(dt: number): void {
    this.tick(dt);
    if (this.speed === 0) return;
    const next = this.hour + dt * this.speed;
    if (next >= 24) this.date++;
    this.hour = next % 24;
    // Réglage à 4 images/s : assez fin pour un cycle de plusieurs minutes.
    if (Math.abs(this.hour - this.lastApplied) > 0.01 || this.hour < this.lastApplied) this.apply();
  }

  /** Le calendrier à l'heure actuelle (saison, jour de la semaine, jour astronomique) ; recalculé à chaque réglage de l'ambiance. */
  get calendar(): CalendarDay {
    return this.cal;
  }

  /** Jour astronomique de l'année (1 à 365) : soleil, oiseaux, notes de lieu. */
  get day(): number {
    return Math.round(this.cal.doy);
  }

  get calendarConfig(): CalendarConfig {
    return this.config;
  }

  /** Change la durée des saisons ou fige une saison ; la date reste celle donnée (voir `rescaleDate`). */
  setCalendar(config: CalendarConfig, date = this.date): void {
    this.config = { ...config };
    this.date = Math.max(0, Math.floor(date));
    this.apply();
  }

  /** La météo à l'heure actuelle (D195), recalculée avec l'ambiance (environ deux fois par seconde réelle). */
  get weather(): WeatherState {
    return this.wx;
  }

  /** Impose une météo (et la fige), ou rend celle du calendrier (null). */
  setWeather(kind: WeatherKind | null): void {
    this.forced = kind;
    this.apply();
  }

  /** Impose la date (jours de jeu) ; l'ambiance suit tout de suite. */
  setDate(date: number): void {
    this.date = Math.max(0, Math.floor(date));
    this.apply();
  }

  /**
   * À chaque image (même horloge arrêtée) : éclairs d'orage. Un éclair dure 0,1 à 0,2 s (parfois deux de suite) ; il éclaire le ciel et
   * la lumière d'ambiance, puis le tonnerre suit avec le retard de la distance.
   */
  private tick(dt: number): void {
    this.time += dt;
    const light = 1 - 0.7 * this.night;
    if (this.wx.rain > 0.005 && !this.rain) this.scene.add((this.rain = new Precipitation(RAIN)).mesh);
    if (this.wx.snowfall > 0.005 && !this.snowfall) this.scene.add((this.snowfall = new Precipitation(SNOW)).mesh);
    this.rain?.update(this.wx.rain, this.time, light);
    this.snowfall?.update(this.wx.snowfall, this.time, light);
    const storm = this.wx.storm;
    const u = this.skyMat.uniforms;
    if (storm > 0.3) {
      this.nextFlash -= dt * storm;
      if (this.nextFlash <= 0) {
        this.nextFlash = 4 + Math.random() * 12;
        this.flashes = Math.random() < 0.4 ? [0, 0.22 + Math.random() * 0.15] : [0];
        this.flash = 0;
        const km = 0.4 + Math.random() * 5;
        this.onThunder?.((km * 1000) / 343, Math.min(1, 1.6 / (0.6 + km)));
      }
    }
    let f = 0;
    if (this.flashes.length) {
      this.flash += dt;
      for (const t0 of this.flashes) {
        const t = this.flash - t0;
        if (t >= 0 && t < 0.18) f = Math.max(f, 1 - t / 0.18);
      }
      if (this.flash > Math.max(...this.flashes) + 0.2) this.flashes = [];
    }
    this.hemi.intensity = this.baseHemi * (1 + 2.5 * f);
    u["cloudLight"]!.value = this.baseCloudLight + 1.2 * f;
  }

  /** Nuit pour les lumières allumées (fenêtres, lampadaires, feux des voitures) : 0 le jour, 1 la nuit noire, de 3° à −6° de hauteur du soleil. */
  get night(): number {
    return this.res.glowMat.opacity;
  }

  /** Phares (D196) : la nuit, et aussi de jour dans la brume, sous une forte pluie ou sous la neige. */
  get headlights(): number {
    const wx = this.wx;
    return Math.max(this.night, Math.min(1, wx.fog * 1.5), wx.rain > 0.6 ? 1 : 0, wx.snowfall > 0.5 ? 1 : 0);
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
    this.cal = calendarAt(this.date, this.hour, this.config);
    this.wx = this.forced ? fixedWeather(this.forced) : weatherAt(this.date, this.hour, this.seasonOf);
    const sun = sunPosition(this.cal.doy, this.hour);
    const [sx, sy, sz] = sunDirection(sun);
    const elev = (sun.elevation * 180) / Math.PI;
    const p = this.palette(elev);
    const wx = this.wx;
    // Météo (D196) : ciel et brouillard grisés par les nuages, soleil voilé, lumière d'ambiance un peu relevée (ombres plus douces).
    const grey = 0.85 * smooth(0.25, 1, wx.cloud);
    const veil = smooth(0.35, 0.95, wx.cloud);
    const lift = 1 + 0.15 * wx.fog;

    // Lumière : le soleil (jamais sous 5° pour ne pas éclairer par en dessous), puis la lune du côté opposé.
    const lo = Math.max(sun.elevation, 0.09);
    const c = Math.cos(lo), sunAz = sun.azimuth;
    const sunL = new THREE.Vector3(Math.sin(sunAz) * c, Math.sin(lo), -Math.cos(sunAz) * c);
    const moonL = new THREE.Vector3(-Math.sin(sunAz) * 0.55, 0.8, Math.cos(sunAz) * 0.55).normalize();
    const w = smooth(-4, -12, elev);
    this.lightDir.copy(sunL).lerp(moonL, w).normalize();

    this.sunLight.color.copy(overcast(p.sun, grey * 0.6));
    this.sunLight.intensity = p.sunI * (1 - 0.78 * veil);
    this.hemi.color.copy(overcast(p.hemiSky, grey));
    this.hemi.groundColor.copy(overcast(p.hemiGround, grey * 0.7));
    this.hemi.intensity = this.baseHemi = p.hemiI * (1 + 0.3 * veil);
    this.renderer.toneMappingExposure = p.exposure * (1 - 0.05 * wx.cloud);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(overcast(p.fog, Math.max(grey, 0.8 * wx.fog), lift));
    // Pluie et neige rapprochent l'horizon ; la brume le ramène à moins de 200 m.
    const far = p.fogFar * (1 - 0.35 * wx.rain - 0.3 * wx.snowfall);
    fog.far = far + (170 - far) * wx.fog;
    fog.near = p.fogNear * (1 - 0.4 * wx.rain) * (1 - 0.95 * wx.fog);

    const u = this.skyMat.uniforms;
    const horizon = overcast(p.horizon, Math.max(grey, 0.8 * wx.fog), lift);
    (u["horizon"]!.value as THREE.Color).copy(horizon);
    (u["mid"]!.value as THREE.Color).copy(overcast(p.mid, grey));
    (u["zenith"]!.value as THREE.Color).copy(overcast(p.zenith, grey));
    (u["sun"]!.value as THREE.Vector3).set(sx, sz, -sy);
    u["stars"]!.value = smooth(-4, -10, elev) * (1 - wx.cloud);
    u["cloudLight"]!.value = this.baseCloudLight = 0.18 + 0.82 * smooth(-8, 8, elev);
    u["disc"]!.value = wx.cloud < 0.55 ? 1 : 0;
    if (u["cover"]) u["cover"].value = wx.cloud;
    if (u["clouds"]) u["clouds"].value = wx.cloud > 0.05 ? 1 : 0;
    // Le sol mouillé reflète le bas du ciel.
    setGroundWeather(wx.wet, wx.snow, horizon.multiplyScalar(0.9));

    // Fenêtres et lampadaires : s'allument de 3° à -6° (plus tôt par temps très couvert).
    const glow = smooth(3 + 5 * veil, -6, elev);
    this.res.glowMat.opacity = glow;
    this.res.glowMat.visible = glow > 0.01;
    this.res.haloMat.opacity = 0.32 * glow;
    this.res.haloMat.visible = glow > 0.01;
  }
}
