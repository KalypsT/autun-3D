import * as THREE from "three";
import { REAR, SIDE, type Guide, type Sculpt } from "./car-sculpt";
import { CAMIONNETTE } from "./car-camionnette";
import { box } from "./vehicle-model";
import { lettering, wordLength } from "./car-lettering";

/**
 * Fourgon des pompiers (phase 4, malaise) : la caisse sculptée de la camionnette (D279), repeinte en rouge, avec ce qui fait reconnaître un
 * véhicule de secours de loin : large bande blanche sur les flancs, le mot POMPIERS en rouge dessus, filet jaune dessous, damier jaune et
 * rouge sur les portes arrière, rampe bleue à l'avant du toit et deux feux bleus à l'arrière (ceux qui clignotent sont dessinés à part,
 * `CAR_BODIES.pompiers.beacons`).
 */

const WHITE = "#f1f2ee";
const YELLOW = "#f2c81b";
const RED = "#c8211c";
const BAR = "#2b49a8";
const DARK = "#1d1f24";

const g = (x: number, y: number, s: number, dir: THREE.Vector3): Guide => ({ x, y, s, dir });

/** Bout de la caisse en s (comme la camionnette). */
const END = 5.036;
/** Rayon vers le flanc gauche (on écrit le mot de chaque côté, à l'endroit). */
const LEFT = new THREE.Vector3(1, 0, 0);

export const POMPIERS: Sculpt = {
  ...CAMIONNETTE,
  details: (k, glass) => {
    const out = CAMIONNETTE.details(k, glass);
    // Flancs : bande blanche, le mot en rouge dessus, filet jaune dessous.
    const H = 0.1, wl = wordLength("POMPIERS", H), w0 = 2.55, w1 = w0 + wl;
    out.push(k.sideLine([[0.55, 0.86], [2.4, 0.86], [4.95, 0.86]], 0.075, WHITE, 0.012));
    out.push(k.sideLine([[0.55, 0.74], [2.4, 0.74], [4.95, 0.74]], 0.022, YELLOW, 0.012));
    out.push(...lettering(k, "POMPIERS", H, 0.016, RED, 0.016, (u, v) => g(1, 0.81 + v, w1 - u, SIDE)));
    out.push(...lettering(k, "POMPIERS", H, 0.016, RED, 0.016, (u, v) => g(-1, 0.81 + v, w0 + u, LEFT)));
    // Portes arrière : damier jaune et rouge en bas, bande blanche au-dessus.
    out.push(k.plate(-0.82, 0.82, 0.86, 0.98, END, REAR, YELLOW, 0.016, 4));
    for (let i = 0; i < 8; i++) {
      const x0 = -0.82 + i * 0.205;
      out.push(k.plate(x0, x0 + 0.1, i % 2 ? 0.86 : 0.92, i % 2 ? 0.92 : 0.98, END, REAR, RED, 0.02));
    }
    out.push(k.plate(-0.82, 0.82, 1.42, 1.52, END, REAR, WHITE, 0.016, 4));
    // Rampe bleue sur l'avant du toit, deux feux à l'arrière, sur leurs pieds.
    out.push(box(1.16, 0.085, 0.22, 0, 2.01, k.z(2.42), BAR));
    for (const m of [-1, 1]) {
      out.push(box(0.05, 0.05, 0.12, m * 0.5, 1.975, k.z(2.42), DARK));
      out.push(box(0.2, 0.08, 0.14, m * 0.72, 2.0, k.z(4.9), BAR));
    }
    return out;
  },
};
