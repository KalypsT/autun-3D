import * as THREE from "three";
import type { VehicleDef } from "../core/vehicle-catalog";
import { lampBoxes } from "./traffic-models";
import { merge } from "./vehicle-model";

/**
 * Feux du véhicule conduit par le joueur (lot rapide après J7, D90) : phares et feux arrière qui s'allument à la nuit tombée, feux stop
 * quand on freine (de jour aussi), feu de recul, et un **faisceau peint sur la chaussée** devant le véhicule. Le faisceau est une
 * plaque transparente en mélange additif, pas une vraie lampe : une lampe three.js ferait recalculer l'éclairage de tous les
 * matériaux de la ville. Coût : 0 appel de dessin le jour sans freiner, 3 la nuit (phares, feux arrière, faisceau).
 * Repère du modèle : avant vers −z, haut +y, origine au sol sous le centre de gravité.
 */

/** Faisceau : longueur et largeur au bout (m), intensité la nuit noire. */
const BEAM = { car: { length: 18, width: 9, glow: 0.55 }, moto: { length: 15, width: 7, glow: 0.45 }, small: { length: 8, width: 4, glow: 0.35 } } as const;

let beamTexture: THREE.DataTexture | null = null;

/** Tache de lumière d'un phare vue du dessus : vive près du véhicule, qui s'élargit et s'éteint au loin, bords doux (u : travers, v : distance). */
function beamMap(): THREE.DataTexture {
  if (beamTexture) return beamTexture;
  const W = 64, H = 128, data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const v = j / (H - 1);
    const half = 0.4 + 0.6 * v;
    const along = Math.min(1, v * 4) * (1 - v) ** 1.6;
    for (let i = 0; i < W; i++) {
      const u = Math.abs((i / (W - 1)) * 2 - 1) / half;
      const across = u >= 1 ? 0 : (1 - u * u) ** 1.5;
      const a = Math.round(255 * along * across);
      data.set([a, a, a, 255], (j * W + i) * 4);
    }
  }
  beamTexture = new THREE.DataTexture(data, W, H);
  beamTexture.magFilter = THREE.LinearFilter;
  beamTexture.minFilter = THREE.LinearFilter;
  beamTexture.needsUpdate = true;
  return beamTexture;
}

/** Boîtes lumineuses fusionnées en une géométrie (x, y, z du centre, taille commune). */
function lampGeometry(spots: readonly (readonly [number, number, number])[], size: readonly [number, number, number]): THREE.BufferGeometry {
  if (spots.length === 0) return new THREE.BufferGeometry();
  return merge(spots.map(([x, y, z]) => new THREE.BoxGeometry(size[0], size[1], size[2]).translate(x, y, z)));
}

/** Où sont les feux d'un véhicule (repère du modèle). Voitures : les feux des modèles de la circulation ; deux-roues : estimés d'après la fiche. */
export function lampLayout(def: VehicleDef): { head: [number, number, number][]; tail: [number, number, number][]; frontZ: number; kind: keyof typeof BEAM } {
  if (def.family === "car") {
    const l = lampBoxes(def.id);
    return { head: l.head, tail: l.tail, frontZ: l.head[0]![2], kind: "car" };
  }
  const s = def.spec, r = s.wheelRadius;
  const frontZ = -(s.front + r * 0.6), rearZ = s.rear + r * 0.7;
  const [hy, ty] = def.family === "moto" ? [0.85, 0.8] : def.family === "bike" ? [0.78, 0.72] : [0.55, 0.25];
  return { head: [[0, hy, frontZ]], tail: [[0, ty, rearZ]], frontZ, kind: def.family === "moto" ? "moto" : "small" };
}

function reverseSpots(tail: readonly [number, number, number][]): [number, number, number][] {
  return tail.map(([x, y, z]) => [x * 0.6, y, z]);
}

export class VehicleLights {
  readonly group = new THREE.Group();
  private readonly headMat = new THREE.MeshBasicMaterial({ color: "#fff1c0", transparent: true, opacity: 0, depthWrite: false });
  private readonly tailMat = new THREE.MeshBasicMaterial({ color: "#ff3a22", transparent: true, opacity: 0, depthWrite: false });
  private readonly reverseMat = new THREE.MeshBasicMaterial({ color: "#f4f1ea", transparent: true, opacity: 0, depthWrite: false });
  private readonly beamMat: THREE.MeshBasicMaterial;
  private glow: number;
  private readonly fullGlow: number;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly layout: ReturnType<typeof lampLayout>;
  private readonly head: THREE.Mesh;
  private readonly tail: THREE.Mesh;
  private readonly reverse: THREE.Mesh | null;

  constructor(def: VehicleDef) {
    const l = lampLayout(def), car = l.kind === "car";
    this.layout = l;
    const head = new THREE.Mesh(lampGeometry(l.head, this.headSize), this.headMat);
    const tail = new THREE.Mesh(lampGeometry(l.tail, this.tailSize), this.tailMat);
    // Feu de recul : à l'intérieur des feux arrière (voitures seulement).
    const reverse = car ? new THREE.Mesh(lampGeometry(reverseSpots(l.tail), [0.12, 0.1, 0.07]), this.reverseMat) : null;
    this.head = head;
    this.tail = tail;
    this.reverse = reverse;
    const b = BEAM[l.kind];
    this.glow = this.fullGlow = b.glow;
    this.beamMat = new THREE.MeshBasicMaterial({
      map: beamMap(), color: "#ffd98a", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const beamGeo = new THREE.PlaneGeometry(b.width, b.length);
    // À plat, le bord proche (v = 0) contre l'avant du véhicule, le faisceau vers −z.
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.translate(0, 0.06, l.frontZ - b.length / 2 + 0.3);
    const beam = new THREE.Mesh(beamGeo, this.beamMat);
    for (const m of [head, tail, reverse, beam]) {
      if (!m) continue;
      m.castShadow = m.receiveShadow = false;
      m.visible = false;
      this.meshes.push(m);
      this.group.add(m);
    }
    beam.renderOrder = 1;
  }

  private get headSize(): [number, number, number] {
    return this.layout.kind === "car" ? [0.32, 0.2, 0.06] : [0.14, 0.12, 0.06];
  }

  private get tailSize(): [number, number, number] {
    return this.layout.kind === "car" ? [0.3, 0.18, 0.06] : [0.1, 0.07, 0.05];
  }

  /** Phares et feux cassés (D110) : ils ne s'allument plus ; le faisceau au sol faiblit avec chaque phare perdu. */
  setBroken(b: { headRight: boolean; headLeft: boolean; tailRight: boolean; tailLeft: boolean }): void {
    const keep = (spots: readonly [number, number, number][], right: boolean, left: boolean) => spots.filter(([x]) => (x > 0 ? !right : x < 0 ? !left : !(right && left)));
    const head = keep(this.layout.head, b.headRight, b.headLeft), tail = keep(this.layout.tail, b.tailRight, b.tailLeft);
    this.head.geometry.dispose();
    this.head.geometry = lampGeometry(head, this.headSize);
    this.tail.geometry.dispose();
    this.tail.geometry = lampGeometry(tail, this.tailSize);
    if (this.reverse) {
      this.reverse.geometry.dispose();
      this.reverse.geometry = lampGeometry(reverseSpots(tail), [0.12, 0.1, 0.07]);
    }
    this.glow = (this.fullGlow * head.length) / Math.max(1, this.layout.head.length);
  }

  /** Nuit 0-1 (comme les fenêtres), frein appuyé en roulant, marche arrière. */
  update(night: number, braking: boolean, reversing: boolean): void {
    const n = Math.min(Math.max(night, 0), 1);
    this.set(this.headMat, n);
    this.set(this.tailMat, braking ? 1 : n * 0.65);
    this.set(this.reverseMat, reversing ? 1 : 0);
    this.set(this.beamMat, n * this.glow);
  }

  private set(m: THREE.MeshBasicMaterial, opacity: number): void {
    m.opacity = opacity;
    const on = opacity > 0.01;
    for (const mesh of this.meshes) if (mesh.material === m) mesh.visible = on;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of [this.headMat, this.tailMat, this.reverseMat, this.beamMat]) m.dispose();
  }
}
