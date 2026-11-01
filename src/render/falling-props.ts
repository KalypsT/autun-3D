import * as THREE from "three";
import type { Furniture, HeightField } from "../data/types";
import { buildBreakables } from "./props";
import { toThree } from "./geometry";

/**
 * Mobilier arraché par un véhicule (D160) : le poteau, la poubelle ou la borne bascule autour de son pied, dans le sens où roulait le véhicule,
 * reste couché un moment, puis disparaît. Dessin et logique d'animation seulement : le maillage de la tuile a déjà perdu le mobilier.
 * Analogie : une quille qui tombe, puis qu'on ramasse.
 */

/** Durée de la chute (s) selon la hauteur de l'objet : un poteau de 4 m met plus longtemps à basculer qu'une poubelle. */
const FALL_TALL = 0.9;
const FALL_SHORT = 0.4;
/** Temps pendant lequel l'objet reste couché avant de disparaître (s). */
const LINGER = 20;
const MAX_ALIVE = 24;
/** Angle final : presque à plat. */
const FLAT = 1.45;

interface Fallen {
  mesh: THREE.Mesh;
  axis: THREE.Vector3;
  t: number;
  fall: number;
}

const TALL = new Set(["street_lamp", "traffic_signals"]);

export class FallingProps {
  private readonly list: Fallen[] = [];
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

  constructor(private readonly scene: THREE.Scene, private readonly terrain: HeightField) {}

  /** Nombre d'objets couchés ou en chute (pour les tests et la mesure). */
  get count(): number {
    return this.list.length;
  }

  /** Fait tomber `f`, poussé dans la direction unitaire (dx, dy) du repère données. */
  spawn(f: Furniture, dx: number, dy: number): void {
    const z = this.terrain.heightAt(f.x, f.y);
    // Les lanternes sont dessinées avec le reste : elles s'éteignent en tombant.
    const b = buildBreakables([f], this.terrain);
    b.solid.positions.push(...b.glow.positions);
    b.solid.normals.push(...b.glow.normals);
    b.solid.colors.push(...b.glow.colors);
    const geometry = b.solid.build();
    const [bx, by, bz] = toThree(f.x, f.y, z);
    geometry.translate(-bx, -by, -bz);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(bx, by, bz);
    mesh.castShadow = true;
    this.scene.add(mesh);
    // Axe horizontal perpendiculaire à la direction de chute : tourner autour de lui couche le poteau vers (dx, dy).
    const dir = new THREE.Vector3(dx, 0, -dy);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    const axis = new THREE.Vector3(0, 1, 0).cross(dir.normalize()).normalize();
    this.list.push({ mesh, axis, t: 0, fall: TALL.has(f.kind) ? FALL_TALL : FALL_SHORT });
    while (this.list.length > MAX_ALIVE) this.remove(0);
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      p.t += dt;
      // Gravité : l'angle croît comme le carré du temps, sans rebondir.
      const k = Math.min(1, p.t / p.fall);
      p.mesh.quaternion.setFromAxisAngle(p.axis, FLAT * k * k);
      if (p.t > p.fall + LINGER) this.remove(i);
    }
  }

  private remove(i: number): void {
    const p = this.list[i]!;
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    this.list.splice(i, 1);
  }
}
