import * as THREE from "three";
import type { HexagoneFront, HexagoneModel, HexagoneNorthEast, HeightField } from "../data/types";
import { hash01, toThree, type MeshBuilder, type Vec3 } from "./geometry";
import type { LandmarkSinks } from "./landmarks";

/**
 * Façades de l'Hexagone (D166, lot 2 de docs/plans/hexagone.md) : la façade ouest d'après les photos 1, 2 et 4 (vitrage et portes doubles sous un bandeau,
 * bandeau-fenêtre sombre, bandeau haut, auvent d'entrée portant « HEXAGONE ») et la face nord-est d'après la photo 5 (étage en bardage sombre à joints
 * debout, en porte-à-faux sur poteaux fins, au-dessus d'un rez-de-chaussée enduit à portes vitrées ; oriel à stores). Les autres côtés restent des murs unis.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const WHITE = new THREE.Color(1, 1, 1);
const BLIND = C("#d8cfb5");

type XY = [number, number];

/** Repère d'un mur droit : `s` vers la droite vu de l'extérieur, `t` vers l'extérieur ; origine sur la normale `cap` à `d` mètres du sommet. */
export interface Frame {
  n: XY;
  u: XY;
  o: XY;
  pt(s: number, t: number): XY;
  /** Coordonnées (s, t) d'un point. */
  st(p: XY): XY;
}

export function frameOf(m: HexagoneModel, cap: number, d: number): Frame {
  const n: XY = [Math.sin((cap * Math.PI) / 180), Math.cos((cap * Math.PI) / 180)];
  const u: XY = [-n[1], n[0]];
  const o: XY = [m.c[0] + n[0] * d, m.c[1] + n[1] * d];
  return {
    n, u, o,
    pt: (s, t) => [o[0] + u[0] * s + n[0] * t, o[1] + u[1] * s + n[1] * t],
    st: (p) => [(p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1], (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1]],
  };
}

/** Outils de dessin dans un repère : plaques verticales et pavés, au-dessus du relief si le bas est `null`. */
class Draw {
  constructor(readonly f: Frame, readonly sinks: LandmarkSinks, readonly terrain: HeightField) {}

  get mb(): MeshBuilder { return this.sinks.solid; }

  P(s: number, t: number, z: number): Vec3 {
    const [x, y] = this.f.pt(s, t);
    return toThree(x, y, z);
  }

  N(k: number, kt: number, up = 0): Vec3 {
    return toThree(this.f.u[0] * k + this.f.n[0] * kt, this.f.u[1] * k + this.f.n[1] * kt, up);
  }

  /** Altitude du relief au pied du repère en `s`, à la distance `t`. */
  ground(s: number, t = 0): number {
    return this.terrain.heightAt(...this.f.pt(s, t));
  }

  /** Plaque verticale à la distance t, de s0 à s1, de z0 (nombre, ou null : le relief) à z1 ; façade vers l'extérieur. */
  plate(s0: number, s1: number, z0: number | null, z1: number, t: number, col: THREE.Color, high?: THREE.Color): void {
    const a = z0 ?? this.ground(s0, t) - 0.1, b = z0 ?? this.ground(s1, t) - 0.1;
    if (high) this.mb.quadGradient(this.P(s0, t, a), this.P(s1, t, b), this.P(s1, t, z1), this.P(s0, t, z1), this.N(0, 1), col, high);
    else this.mb.quad(this.P(s0, t, a), this.P(s1, t, b), this.P(s1, t, z1), this.P(s0, t, z1), this.N(0, 1), col);
  }

  /** Pavé : s0..s1, t0..t1, z0..z1 ; le dessous est plus sombre (soffite), le côté s0 et s1 un peu moins éclairés. Pas de face arrière. */
  box(s0: number, s1: number, t0: number, t1: number, z0: number | null, z1: number, col: THREE.Color): void {
    const zb = z0 ?? Math.min(this.ground(s0, t1), this.ground(s1, t1)) - 0.1;
    this.mb.quad(this.P(s0, t1, zb), this.P(s1, t1, zb), this.P(s1, t1, z1), this.P(s0, t1, z1), this.N(0, 1), col);
    this.mb.quad(this.P(s0, t0, zb), this.P(s0, t1, zb), this.P(s0, t1, z1), this.P(s0, t0, z1), this.N(-1, 0), shade(col, 0.9));
    this.mb.quad(this.P(s1, t1, zb), this.P(s1, t0, zb), this.P(s1, t0, z1), this.P(s1, t1, z1), this.N(1, 0), shade(col, 0.9));
    this.mb.quad(this.P(s0, t0, z1), this.P(s1, t0, z1), this.P(s1, t1, z1), this.P(s0, t1, z1), toThree(0, 0, 1), shade(col, 1.05));
    if (z0 !== null) this.mb.quad(this.P(s0, t0, z0), this.P(s1, t0, z0), this.P(s1, t1, z0), this.P(s0, t1, z0), toThree(0, 0, -1), shade(col, 0.78));
  }

  /** Vitrage en dégradé ; il s'allume la nuit (`lit` : part des vitrages allumés, tirée sur la position). */
  glass(s0: number, s1: number, z0: number | null, z1: number, t: number, lo: THREE.Color, hi: THREE.Color, lit: number): void {
    this.plate(s0, s1, z0, z1, t, lo, hi);
    if (hash01(`${this.f.o[0].toFixed(1)},${this.f.o[1].toFixed(1)},${s0.toFixed(1)},${z1.toFixed(1)}`) < lit) {
      const a = z0 ?? this.ground(s0, t) - 0.1, b = z0 ?? this.ground(s1, t) - 0.1;
      this.sinks.glow.quadGradient(this.P(s0, t + 0.006, a), this.P(s1, t + 0.006, b), this.P(s1, t + 0.006, z1), this.P(s0, t + 0.006, z1), this.N(0, 1),
        C("#ffb04a"), C("#fff0b0"));
    }
  }

  /** Texte de l'atlas posé sur le plan, centré en s, bas à z, de hauteur h (largeur 6,4 h). */
  label(s: number, z: number, h: number, t: number, text: string, color: string): void {
    const w = h * 6.4, r = this.sinks.atlas.get(text, color);
    this.sinks.names.quad(this.P(s - w / 2, t, z), this.P(s + w / 2, t, z), this.P(s + w / 2, t, z + h), this.P(s - w / 2, t, z + h), this.N(0, 1),
      [r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1], WHITE);
  }

  /** Porte vitrée à deux vantaux, cadre clair (largeur w, hauteur h) posée sur le mur à la distance t. */
  door(s: number, w: number, h: number, t: number, frame: THREE.Color, glass: THREE.Color, lit: number): void {
    const z0 = this.ground(s, t) + 0.04;
    this.plate(s - w / 2, s + w / 2, z0, z0 + h, t + 0.04, frame);
    this.glass(s - w / 2 + 0.1, s - 0.04, z0 + 0.08, z0 + h - 0.1, t + 0.07, shade(glass, 0.8), glass, lit);
    this.glass(s + 0.04, s + w / 2 - 0.1, z0 + 0.08, z0 + h - 0.1, t + 0.07, shade(glass, 0.8), glass, lit);
    this.plate(s - 0.04, s + 0.04, z0, z0 + h, t + 0.075, frame);
    this.plate(s - w / 2, s + w / 2, z0 + h - 0.38, z0 + h - 0.32, t + 0.075, frame);
  }
}

/** Façade principale (ouest). */
export function buildFront(sinks: LandmarkSinks, m: HexagoneModel, terrain: HeightField): void {
  const F: HexagoneFront = m.front!;
  const f = frameOf(m, F.cap, F.d), d = new Draw(f, sinks, terrain);
  const band = C(m.colors.band), glass = C(m.colors.glass), frame = C(m.colors.frame);
  const [zGl, zLow, zRib, zTop] = F.levels;
  const [s0, s1] = F.s, [c0, c1, depth, zCan] = F.canopy;
  const outCanopy = (a: number, b: number): [number, number][] => {
    const parts: [number, number][] = [[a, Math.min(b, c0)], [Math.max(a, c1), b]];
    return parts.filter(([x, y]) => y - x > 0.05);
  };

  // Vitrage du rez-de-chaussée : travées de 2 m séparées de meneaux clairs, piliers enduits tous les 4 m.
  for (let s = s0; s < s1 - 0.01; s += 2) {
    const e = Math.min(s + 2, s1);
    d.glass(s, e, null, zGl, 0, shade(glass, 0.85), glass, 0.7);
    d.plate(e - 0.04, e + 0.04, null, zGl, 0.03, shade(frame, 0.8));
  }
  for (let s = s0; s <= s1 + 0.01; s += 4) d.box(s - 0.24, s + 0.24, 0, 0.22, null, zGl, band);
  for (const c of F.doors) d.door(c, 2.4, 2.35, 0, frame, glass, 0.8);

  // Bandeau bas, bandeau-fenêtre sombre et bandeau haut, de part et d'autre de l'auvent (au droit de l'auvent, le bloc de l'auvent les remplace).
  for (const [a, b] of outCanopy(s0, s1)) {
    d.box(a, b, 0, 0.5, zGl, zLow, band);
    for (let s = a; s < b - 0.01; s += 2.3) {
      const e = Math.min(s + 2.3, b);
      d.glass(s, e, zLow, zRib, 0, shade(glass, 0.8), glass, 0.5);
      d.plate(e - 0.03, e + 0.03, zLow, zRib, 0.03, shade(frame, 0.7));
    }
    d.box(a, b, 0, 0.9, zRib, zTop, band);
  }

  // Auvent d'entrée : bloc plein débordant, soffite ; l'enseigne sur sa face.
  d.box(c0, c1, 0, depth, zGl, zCan, band);
  d.label(F.sign[1], (zGl + zLow) / 2 - 0.7, 1.4, depth + 0.03, F.sign[0], "#3a2d24");
}

/** Face nord-est : rez-de-chaussée enduit, étage en bardage sombre en porte-à-faux sur poteaux. */
export function buildNorthEast(sinks: LandmarkSinks, m: HexagoneModel, terrain: HeightField): void {
  const N: HexagoneNorthEast = m.ne!;
  const f = frameOf(m, N.cap, N.d), d = new Draw(f, sinks, terrain);
  const wall = C(m.colors.wall), glass = C(m.colors.glass), frame = C(m.colors.frame), zinc = C(m.colors.zinc);
  const [s0, s1] = N.s;

  // Rez-de-chaussée : enduit par pans de 3 m (suivent le relief), portes vitrées.
  for (let s = s0; s < s1 - 0.01; s += 3) d.plate(s, Math.min(s + 3, s1), null, N.floor, 0, wall);
  for (const c of N.doors) d.door(c, 2.3, 2.3, 0, frame, glass, 0.6);

  // Étage : soffite clair, bardage à joints debout (une latte sur deux plus sombre), côtés, toit.
  const o = N.over;
  d.mb.quad(d.P(s0, 0, N.floor), d.P(s1, 0, N.floor), d.P(s1, o, N.floor), d.P(s0, o, N.floor), toThree(0, 0, -1), shade(wall, 0.92));
  let i = 0;
  for (let s = s0; s < s1 - 0.01; s += 0.6, i++) d.plate(s, Math.min(s + 0.6, s1), N.floor, N.top, o, shade(zinc, i % 2 ? 0.9 : 1.04));
  d.plate(s0, s0 + 0.001, N.floor, N.top, o, zinc);
  d.mb.quad(d.P(s0, 0, N.floor), d.P(s0, o, N.floor), d.P(s0, o, N.top), d.P(s0, 0, N.top), d.N(-1, 0), shade(zinc, 0.85));
  d.mb.quad(d.P(s1, o, N.floor), d.P(s1, 0, N.floor), d.P(s1, 0, N.top), d.P(s1, o, N.top), d.N(1, 0), shade(zinc, 0.85));
  d.mb.quad(d.P(s0, 0, N.top), d.P(s1, 0, N.top), d.P(s1, o, N.top), d.P(s0, o, N.top), toThree(0, 0, 1), shade(C(m.colors.deck), 1.05));

  // Poteaux fins (sous l'angle du porte-à-faux).
  for (const s of N.poles) d.box(s - 0.07, s + 0.07, o - 0.3, o - 0.16, null, N.floor, frame);

  // Fenêtre carrée à cadre clair, oriel à stores beiges en saillie.
  const [ws, ww] = N.window, [os, ow] = N.oriel, z1 = N.floor + 0.75;
  d.plate(ws - ww / 2 - 0.08, ws + ww / 2 + 0.08, z1 - 0.08, z1 + 1.18, o + 0.02, frame);
  d.glass(ws - ww / 2, ws + ww / 2, z1, z1 + 1.1, o + 0.04, shade(glass, 0.8), glass, 0.5);
  d.box(os - ow / 2, os + ow / 2, o, o + 0.55, N.floor + 0.55, N.floor + 1.75, shade(zinc, 1.1));
  d.plate(os - ow / 2 + 0.12, os + ow / 2 - 0.12, N.floor + 0.7, N.floor + 1.6, o + 0.58, BLIND);
}
