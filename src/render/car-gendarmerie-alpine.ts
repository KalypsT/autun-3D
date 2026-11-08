import * as THREE from "three";
import { DOWN, FRONT, REAR, SIDE, frontTurn, rearTurn, type Guide, type Sculpt } from "./car-sculpt";
import { SPORTIVE } from "./car-sportive";
import { box } from "./vehicle-model";
import { lettering, wordLength } from "./car-lettering";

/**
 * Gendarmerie en berlinette (D282), d'après les photos fournies par l'utilisateur : la caisse de la sportive (Augusta Janus, D277, la même berlinette)
 * dans la livrée de la gendarmerie (lettrage réel, exception choisie par l'utilisateur, comme D281) : bleu de France, double bande blanche du capot
 * au toit, le mot GENDARMERIE sur les portes au milieu d'une triple bande blanche (pas sur le capot : voir plus bas), chevrons rouges et jaunes sous les phares et
 * sur le bouclier arrière, un seul gyrophare rond sur le toit (son feu qui clignote est à part : `CAR_BODIES["gendarmerie-alpine"].beacons`).
 */

const WHITE = "#eef1f4";
const YELLOW = "#f2d21b";
const RED = "#d42a26";
const DOME = "#2b49a8";
const DARK = "#1d1f24";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Rayon vers le flanc gauche (on écrit le mot de chaque côté, à l'endroit). */
const LEFT = new THREE.Vector3(1, 0, 0);

/** Bout de la caisse en s (celle de la sportive). */
const END = 4.136;

export const GENDARMERIE_ALPINE: Sculpt = {
  ...SPORTIVE,
  details: (k, glass) => {
    const out = SPORTIVE.details(k, glass);

    // Double bande blanche sur le capot et sur le toit.
    const stripe = (ss: readonly number[]): Guide[][] => [ss.map((s) => g(0.16, 3, s, DOWN)), ss.map((s) => g(0.05, 3, s, DOWN))];
    out.push(k.decal(stripe([0.08, 0.45, 0.9, 1.4]), WHITE, 0.012));
    out.push(k.decal(stripe([2.25, 2.55, 2.84]), WHITE, 0.012));

    // Le mot n'est pas écrit sur le capot, faute de triangles (plafond de 1 200 pour les détails, déjà bien pris par la sportive) : il est sur les portes.

    // Flancs : le mot sur la porte, au milieu d'une triple bande blanche.
    const H = 0.068, wl = wordLength("GENDARMERIE", H), w0 = 1.6, w1 = w0 + wl;
    for (const [y, half] of [[0.548, 0.011], [0.52, 0.007], [0.495, 0.005]] as const) {
      out.push(k.sideLine([[1.16, y], [w0 - 0.05, y]], half, WHITE, 0.012));
      out.push(k.sideLine([[w1 + 0.05, y], [3.02, y + 0.01]], half, WHITE, 0.012));
    }
    out.push(...lettering(k, "GENDARMERIE", H, 0.012, WHITE, 0.013, (u, v) => g(1, 0.49 + v, w1 - u, SIDE)));
    out.push(...lettering(k, "GENDARMERIE", H, 0.012, WHITE, 0.013, (u, v) => g(-1, 0.49 + v, w0 + u, LEFT)));

    // Chevrons rouges et jaunes sous les phares, qui tournent sur l'aile.
    const band = (y: number): Guide[] => [g(0.3, y, 0.02, FRONT), g(0.55, y, 0.05, frontTurn(15)), g(0.72, y, 0.1, frontTurn(40)), g(0.83, y, 0.2, frontTurn(68))];
    out.push(k.decal([band(0.585), band(0.505)], YELLOW, 0.02));
    for (const [x0, x1, a0, a1, s0, s1] of [[0.34, 0.4, 3, 6, 0.03, 0.03], [0.5, 0.56, 12, 15, 0.05, 0.05], [0.66, 0.71, 32, 38, 0.08, 0.09]] as const) {
      out.push(k.decal([[g(x0, 0.585, s0, frontTurn(a0)), g(x1, 0.585, s1, frontTurn(a1))], [g(x0 + 0.05, 0.505, s0, frontTurn(a0)), g(x1 + 0.05, 0.505, s1, frontTurn(a1))]], RED, 0.025));
    }

    // Arrière : chevrons rouges et jaunes sur tout le bouclier (la plaque au-dessus), en V vers le milieu.
    const back = (y: number): Guide[] => [g(0.28, y, END, REAR), g(0.5, y, END - 0.01, rearTurn(8)), g(0.68, y, END - 0.04, rearTurn(25)), g(0.8, y, END - 0.12, rearTurn(55))];
    out.push(k.decal([back(0.69), back(0.6), back(0.4)], YELLOW, 0.02));
    for (const [x, a, s] of [[0.33, 2, END], [0.5, 8, END - 0.01], [0.64, 22, END - 0.035]] as const) {
      out.push(k.decal([[g(x, 0.69, s, rearTurn(a)), g(x + 0.06, 0.69, s, rearTurn(a))], [g(x - 0.08, 0.4, s, rearTurn(a)), g(x - 0.02, 0.4, s, rearTurn(a))]], RED, 0.025));
    }

    // Gyrophare rond sur le toit, sur son pied.
    out.push(box(0.15, 0.07, 0.15, 0, 1.285, k.z(2.32), DOME));
    out.push(box(0.17, 0.02, 0.17, 0, 1.245, k.z(2.32), DARK));
    return out;
  },
};
