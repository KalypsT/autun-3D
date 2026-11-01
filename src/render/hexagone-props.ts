import * as THREE from "three";
import type { HeightField, HexagoneProp } from "../data/types";
import { toThree, type MeshBuilder, type Vec3 } from "./geometry";

/**
 * Mobilier du parvis de l'Hexagone (D168, lot 4 de docs/plans/hexagone.md), d'après les photos 1, 2 et 4 : sphère rayée sur son pied, colonne Morris
 * à affiches, mâts à drapeaux (France, Europe), lampadaire à tête triangulaire, bacs hexagonaux de topiaires en spirale, arceaux à vélos. Tout est
 * de révolution (`lathe`) ou de plaques : un maillage de quelques centaines de triangles par objet.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);

const STONE = C("#d2cbbb"), STRIPE_LIGHT = C("#ece8dc"), STRIPE_DARK = C("#3d3b3d");
const PLANTER = C("#ebe8df"), GRAVEL = C("#34353a"), LEAF = C("#3f7a4c"), TRUNK = C("#4a3a2a");
const POLE = C("#c9ccce"), METAL = C("#7b8186"), LAMP_HEAD = C("#dcdede");
const MORRIS_BASE = C("#6f7378"), MORRIS_CAP = C("#3a4a42");
const POSTERS = ["#3a3f93", "#d8c9a0", "#a23b4a", "#2f6f8f", "#e8e2c9"].map(C);
const FR = [C("#1f3f9a"), C("#f3f1ea"), C("#d23a3a")], EU_BLUE = C("#1d3f9c"), EU_GOLD = C("#f1c630"), OTHER = [C("#c43a3a"), C("#e0b030")];

/** Surface de révolution autour de la verticale (x, y), de `z0` : `profile` = (rayon, hauteur) du bas vers le haut, une couleur par bande ; `seg` pans ; `tint` module la couleur par pan. */
function lathe(mb: MeshBuilder, x: number, y: number, z0: number, profile: [number, number][], colors: THREE.Color[], seg: number, rot = 0, tint?: (j: number, i: number) => THREE.Color | null): void {
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, h0] = profile[i]!, [r1, h1] = profile[i + 1]!;
    if (r0 < 1e-6 && r1 < 1e-6) continue;
    for (let j = 0; j < seg; j++) {
      const a0 = rot + (2 * Math.PI * j) / seg, a1 = rot + (2 * Math.PI * (j + 1)) / seg, am = (a0 + a1) / 2;
      const dr = r1 - r0, dz = h1 - h0, nl = Math.hypot(dr, dz) || 1;
      const n = toThree((Math.cos(am) * dz) / nl, (Math.sin(am) * dz) / nl, -dr / nl);
      const P = (r: number, a: number, h: number): Vec3 => toThree(x + r * Math.cos(a), y + r * Math.sin(a), z0 + h);
      const col = tint?.(j, i) ?? colors[i % colors.length]!;
      if (r0 < 1e-6) mb.tri(P(0, a0, h0), P(r1, a0, h1), P(r1, a1, h1), n, col);
      else if (r1 < 1e-6) mb.tri(P(r0, a0, h0), P(r0, a1, h0), P(0, a0, h1), n, col);
      else mb.quad(P(r0, a0, h0), P(r0, a1, h0), P(r1, a1, h1), P(r1, a0, h1), n, col);
    }
  }
}

/** Barre horizontale de section carrée (côté `w`) entre deux points à la même altitude. */
function bar(mb: MeshBuilder, p: [number, number], q: [number, number], z: number, w: number, col: THREE.Color): void {
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len, h = w / 2;
  const V = (pt: [number, number], k: number, zz: number): Vec3 => toThree(pt[0] + nx * h * k, pt[1] + ny * h * k, zz);
  mb.quad(V(p, 1, z - h), V(q, 1, z - h), V(q, 1, z + h), V(p, 1, z + h), toThree(nx, ny, 0), col);
  mb.quad(V(p, -1, z - h), V(q, -1, z - h), V(q, -1, z + h), V(p, -1, z + h), toThree(-nx, -ny, 0), col);
  mb.quad(V(p, 1, z + h), V(q, 1, z + h), V(q, -1, z + h), V(p, -1, z + h), toThree(0, 0, 1), col);
  mb.quad(V(p, 1, z - h), V(q, 1, z - h), V(q, -1, z - h), V(p, -1, z - h), toThree(0, 0, -1), shade(col, 0.7));
}

export function buildHexagoneProps(mb: MeshBuilder, glow: MeshBuilder | null, props: readonly HexagoneProp[], terrain: HeightField): void {
  for (const p of props) {
    const g = terrain.heightAt(p.x, p.y);
    const rot = (((p.a ?? 0) * Math.PI) / 180);
    switch (p.k) {
      case "sphere": {
        // Pied de pierre (cône tronqué), sphère de 1,25 m de rayon à bandes horizontales blanc cassé et sombres.
        lathe(mb, p.x, p.y, g, [[0.62, 0], [0.5, 0.18], [0.42, 0.7], [0.55, 0.75], [0.0, 0.75]], [STONE, STONE, shade(STONE, 1.05), shade(STONE, 1.1)], 12);
        const R = 1.25, prof: [number, number][] = [];
        for (let k = 0; k <= 10; k++) {
          const f = -Math.PI / 2 + (Math.PI * k) / 10;
          prof.push([Math.max(R * Math.cos(f), 0), R + R * Math.sin(f)]);
        }
        lathe(mb, p.x, p.y, g + 0.72, prof, [STRIPE_LIGHT, STRIPE_DARK], 16, rot);
        break;
      }
      case "column": {
        // Colonne Morris : socle, affiches (quatre faces de tons différents), toit.
        lathe(mb, p.x, p.y, g, [[0.85, 0], [0.85, 0.4], [0.8, 0.4], [0.8, 2.6], [0.88, 2.6], [0.88, 2.8], [0.55, 3.15], [0.2, 3.4], [0, 3.45]],
          [MORRIS_BASE, MORRIS_BASE, MORRIS_BASE, MORRIS_CAP, MORRIS_CAP, MORRIS_CAP, MORRIS_CAP, MORRIS_CAP], 16, rot,
          (j, i) => (i === 2 ? POSTERS[Math.floor(j / 3) % POSTERS.length]! : null));
        break;
      }
      case "lamp": {
        lathe(mb, p.x, p.y, g, [[0.1, 0], [0.07, 0.3], [0.06, 5.2], [0, 5.25]], [METAL], 8);
        // Tête : plaque triangulaire inclinée, face claire dessus, dessous éclairé la nuit.
        const tri = (k: number): Vec3 => {
          const a = rot + (2 * Math.PI * k) / 3;
          return toThree(p.x + 0.55 * Math.cos(a) + 0.15 * Math.cos(rot), p.y + 0.55 * Math.sin(a) + 0.15 * Math.sin(rot), g + 5.3 + 0.12 * Math.cos(a - rot));
        };
        mb.tri(tri(0), tri(1), tri(2), toThree(0, 0, 1), LAMP_HEAD);
        mb.tri(tri(0), tri(1), tri(2), toThree(0, 0, -1), shade(LAMP_HEAD, 0.7));
        if (glow) glow.tri(tri(0), tri(1), tri(2), toThree(0, 0, -1), C("#ffd890"));
        break;
      }
      case "flag": {
        lathe(mb, p.x, p.y, g, [[0.07, 0], [0.05, 0.4], [0.04, 7.4], [0, 7.45]], [POLE], 8);
        lathe(mb, p.x, p.y, g + 7.3, [[0.0, 0], [0.09, 0.07], [0.0, 0.16]], [C("#d6b24a")], 8);
        // Drapeau : plaque de 1,5 × 1 m tendue vers le cap `a`, visible des deux côtés.
        const d: [number, number] = [Math.sin(rot), Math.cos(rot)], w = 1.5, h = 1.0, z1 = g + 7.15, z0 = z1 - h;
        const q = (s: number, z: number, off = 0): Vec3 => toThree(p.x + d[0] * (0.06 + s * w) - d[1] * off, p.y + d[1] * (0.06 + s * w) + d[0] * off, z);
        const n: Vec3 = toThree(-d[1], d[0], 0), nb: Vec3 = toThree(d[1], -d[0], 0);
        const band = (s0: number, s1: number, col: THREE.Color): void => {
          mb.quad(q(s0, z0), q(s1, z0), q(s1, z1), q(s0, z1), n, col);
          mb.quad(q(s0, z0, -0.003), q(s1, z0, -0.003), q(s1, z1, -0.003), q(s0, z1, -0.003), nb, col);
        };
        if ((p.v ?? 0) === 1) {
          band(0, 1, EU_BLUE);
          for (let k = 0; k < 12; k++) {
            const a = (2 * Math.PI * k) / 12, cs = 0.5 + 0.2 * Math.cos(a) * (h / w), cz = (z0 + z1) / 2 + 0.3 * Math.sin(a), ss = 0.025;
            mb.quad(q(cs - ss, cz - 0.03, 0.004), q(cs + ss, cz - 0.03, 0.004), q(cs + ss, cz + 0.03, 0.004), q(cs - ss, cz + 0.03, 0.004), n, EU_GOLD);
            mb.quad(q(cs - ss, cz - 0.03, -0.007), q(cs + ss, cz - 0.03, -0.007), q(cs + ss, cz + 0.03, -0.007), q(cs - ss, cz + 0.03, -0.007), nb, EU_GOLD);
          }
        } else if ((p.v ?? 0) === 0) {
          band(0, 1 / 3, FR[0]!);
          band(1 / 3, 2 / 3, FR[1]!);
          band(2 / 3, 1, FR[2]!);
        } else {
          band(0, 0.5, OTHER[0]!);
          band(0.5, 1, OTHER[1]!);
        }
        break;
      }
      case "planter": {
        // Bac hexagonal blanc (30 cm à 42 cm de haut), gravier sombre, quatre topiaires en spirale.
        lathe(mb, p.x, p.y, g, [[1.55, 0], [1.55, 0.42], [1.42, 0.42], [1.42, 0.34], [0, 0.34]], [PLANTER, shade(PLANTER, 1.05), shade(PLANTER, 0.9), GRAVEL], 6, rot);
        const spots: [number, number, number][] = [[0, 0, 2.7], [0.8, 0.5, 1.7], [-0.7, 0.6, 1.45], [0.1, -0.85, 1.2]];
        spots.forEach(([dx, dy, h], k) => {
          const x = p.x + dx * Math.cos(rot) - dy * Math.sin(rot), y = p.y + dx * Math.sin(rot) + dy * Math.cos(rot), z = g + 0.34;
          lathe(mb, x, y, z, [[0.07, 0], [0.05, 0.5], [0, 0.55]], [TRUNK], 6);
          const tiers = Math.max(3, Math.round(h / 0.55));
          for (let t = 0; t < tiers; t++) {
            const f = t / tiers, r = 0.62 * (1 - 0.62 * f) * (h / 2.7 + 0.35), zt = 0.5 + f * (h - 0.6), sway = 0.12 * (t % 2 ? 1 : -1) * (1 - f);
            lathe(mb, x + sway, y, z + zt, [[0, 0], [r, 0.12], [r * 0.82, 0.3], [0, 0.4]], [shade(LEAF, 0.9 + 0.08 * ((t + k) % 3))], 8);
          }
        });
        break;
      }
      case "rack": {
        // Arceau à vélos : deux poteaux et une barre, plan perpendiculaire au cap `a`.
        const d: [number, number] = [Math.cos(rot), Math.sin(rot)];
        for (const s of [-0.3, 0.3]) lathe(mb, p.x + d[0] * s, p.y + d[1] * s, g, [[0.02, 0], [0.02, 0.8]], [METAL], 4);
        bar(mb, [p.x - d[0] * 0.3, p.y - d[1] * 0.3], [p.x + d[0] * 0.3, p.y + d[1] * 0.3], g + 0.8, 0.04, METAL);
        break;
      }
    }
  }
}
