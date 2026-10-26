import * as THREE from "three";
import { canvasTexture, Paint, rng } from "./paint";

/** Textures répétables : `size` est le côté du motif en mètres (UV = mètres / size). */
export interface SurfaceTexture {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  size: number;
}

const N = 512;

function finish(p: Paint, size: number, normalStrength: number): SurfaceTexture {
  return {
    map: canvasTexture(p.color, { srgb: true, repeat: true }),
    normalMap: canvasTexture(p.normalCanvas(normalStrength, true), { srgb: false, repeat: true }),
    size,
  };
}

/** Dessine `fn` à la position donnée et, près des bords, aux positions décalées pour que le motif se raccorde. */
function wrapped(x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const dx of [0, -N, N]) {
    for (const dy of [0, -N, N]) {
      const px = x + dx, py = y + dy;
      if (px + r >= 0 && px - r <= N && py + r >= 0 && py - r <= N) fn(px, py);
    }
  }
}

function grain(p: Paint, rand: () => number, amount: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * N, y = rand() * N, r = 0.6 + rand() * 1.8;
    const v = Math.floor(rand() * 255);
    wrapped(x, y, r, (px, py) => {
      p.tint((c) => c.arc(px, py, r, 0, Math.PI * 2), `rgba(${v},${v},${v},${amount})`);
      const hv = 128 + (rand() - 0.5) * 60;
      p.h.fillStyle = `rgba(${hv},${hv},${hv},0.5)`;
      p.h.beginPath();
      p.h.arc(px, py, r, 0, Math.PI * 2);
      p.h.fill();
    });
  }
}

/** Enduit à la chaux : presque blanc (la teinte vient du sommet), taches et grain. */
export function plasterTexture(): SurfaceTexture {
  const p = new Paint(N, N, true);
  const rand = rng(11);
  p.rect(0, 0, N, N, "#f1eee6", 128);
  for (let i = 0; i < 90; i++) {
    const x = rand() * N, y = rand() * N, r = 20 + rand() * 70;
    const dark = rand() < 0.55;
    wrapped(x, y, r, (px, py) => {
      const g = p.c.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, dark ? "rgba(120,105,80,0.035)" : "rgba(255,255,255,0.08)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      p.c.fillStyle = g;
      p.c.fillRect(px - r, py - r, 2 * r, 2 * r);
    });
  }
  grain(p, rand, 0.07, 2600);
  return finish(p, 2, 1.2);
}

/** Pierre de taille calcaire : assises de 0,4 m, joints creux, légères variations de teinte. */
export function ashlarTexture(): SurfaceTexture {
  const p = new Paint(N, N, true);
  const rand = rng(23);
  const rows = 5, rowH = N / rows;
  p.rect(0, 0, N, N, "#e9e6dc", 150);
  for (let r = 0; r < rows; r++) {
    // Partition de 512 px en blocs de 0,6 à 1,0 m (soit 150 à 256 px).
    const lens: number[] = [];
    let sum = 0;
    while (sum < N) {
      const l = Math.min(150 + rand() * 106, N - sum);
      if (N - sum - l < 100 && N - sum - l > 0) {
        lens.push((N - sum) / 2, (N - sum) / 2);
        sum = N;
      } else {
        lens.push(l);
        sum += l;
      }
    }
    let x = (r % 2) * 80;
    const y = r * rowH;
    for (const l of lens) {
      const v = 0.9 + rand() * 0.12;
      const col = `rgb(${Math.round(240 * v)},${Math.round(236 * v)},${Math.round(224 * v)})`;
      for (const off of [0, -N]) {
        const bx = ((x + off) % N + N) % N - (off === 0 ? 0 : 0);
        p.rect(bx + 1.5, y + 1.5, l - 3, rowH - 3, col, 150 + rand() * 12);
        if (bx + l > N) p.rect(bx - N + 1.5, y + 1.5, l - 3, rowH - 3, col, 150);
      }
      // Joint
      p.tint((c) => c.rect(x, y, 2, rowH), "rgba(70,62,50,0.55)");
      p.h.fillStyle = "rgb(100,100,100)";
      p.h.fillRect(x, y, 3, rowH);
      x = (x + l) % N;
    }
    p.tint((c) => c.rect(0, y, N, 2), "rgba(70,62,50,0.55)");
    p.h.fillStyle = "rgb(100,100,100)";
    p.h.fillRect(0, y, N, 3);
  }
  grain(p, rand, 0.1, 3200);
  return finish(p, 2, 1.8);
}

function tileRows(
  p: Paint, rand: () => number, rows: number, cols: number, palette: string[], opts: { round: boolean; relief: number; shade: number },
): void {
  const th = N / rows, tw = N / cols;
  p.rect(0, 0, N, N, "#3a2a22", 90);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * tw * 0.5;
    for (let cidx = -1; cidx <= cols; cidx++) {
      const x = cidx * tw + off, y = r * th;
      const col = palette[Math.floor(rand() * palette.length)]!;
      const w = tw - 2, h = th * 2.1;  // chaque tuile recouvre la rangée du dessous
      p.fill((c) => {
        c.moveTo(x + 1, y);
        c.lineTo(x + 1 + w, y);
        c.lineTo(x + 1 + w, y + h - (opts.round ? w / 2 : 0));
        if (opts.round) c.arc(x + 1 + w / 2, y + h - w / 2, w / 2, 0, Math.PI);
        else c.lineTo(x + 1, y + h);
        c.closePath();
      }, col, opts.relief - 10 + rand() * 20);
      // Ombre au bas de chaque tuile, sur la rangée suivante
      const g = p.c.createLinearGradient(0, y + th * 0.9, 0, y + th * 1.5);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.6, `rgba(0,0,0,${opts.shade})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      p.c.fillStyle = g;
      p.c.fillRect(x + 1, y + th * 0.9, w, th * 0.6);
      p.h.fillStyle = `rgba(${opts.relief + 55},${opts.relief + 55},${opts.relief + 55},0.55)`;
      p.h.fillRect(x + 1, y, w, th * 0.35);
    }
  }
}

export function plainTileTexture(): SurfaceTexture {
  const p = new Paint(N, N, true);
  const rand = rng(31);
  // Tuiles plates : rouge-brun nuancé, avec des tuiles plus sombres et quelques-unes plus claires.
  tileRows(p, rand, 16, 10, ["#b45a3c", "#a8523a", "#9a4a34", "#bb6540", "#8e4a38", "#a35f42", "#7d4638", "#c0704a"], { round: true, relief: 150, shade: 0.5 });
  grain(p, rand, 0.12, 2000);
  return finish(p, 1.6, 2.2);
}

export function mechanicalTileTexture(): SurfaceTexture {
  const p = new Paint(N, N, true);
  const rand = rng(37);
  tileRows(p, rand, 8, 6, ["#b4603f", "#ad5a3b", "#b96744", "#a9563a"], { round: false, relief: 150, shade: 0.45 });
  for (let x = 0; x < N; x += N / 12) {
    p.rect(x, 0, 2, N, "rgba(0,0,0,0.18)", 130);
    p.rect(x + 2, 0, 2, N, "rgba(255,255,255,0.1)", 170);
  }
  grain(p, rand, 0.12, 1600);
  return finish(p, 1.6, 2.0);
}

export function slateTexture(): SurfaceTexture {
  const p = new Paint(N, N, true);
  const rand = rng(41);
  tileRows(p, rand, 8, 6, ["#66737f", "#5d6a77", "#6f7b87", "#566370", "#76828d"], { round: false, relief: 140, shade: 0.55 });
  for (let i = 0; i < 160; i++) {
    const x = rand() * N, y = rand() * N;
    p.tint((c) => c.rect(x, y, 14 + rand() * 30, 1.5), "rgba(255,255,255,0.07)");
  }
  grain(p, rand, 0.1, 1600);
  return finish(p, 1.6, 1.6);
}

export function zincTexture(): SurfaceTexture {
  const p = new Paint(N, N, true);
  const rand = rng(43);
  p.rect(0, 0, N, N, "#9aa3a8", 128);
  const seams = 4;
  for (let i = 0; i < seams; i++) {
    const x = (i * N) / seams;
    p.rect(x - 3, 0, 6, N, "#b4bcc0", 215);
    p.rect(x + 3, 0, 3, N, "rgba(0,0,0,0.22)", 120);
  }
  for (let i = 0; i < 70; i++) {
    const x = rand() * N;
    p.tint((c) => c.rect(x, 0, 2 + rand() * 6, N), `rgba(${rand() < 0.5 ? "255,255,255" : "60,70,80"},0.05)`);
  }
  grain(p, rand, 0.08, 800);
  return finish(p, 1.6, 1.4);
}

export function flatRoofTexture(): SurfaceTexture {
  const p = new Paint(N, N, true);
  const rand = rng(47);
  p.rect(0, 0, N, N, "#8a8780", 128);
  for (let i = 0; i < 70; i++) {
    const x = rand() * N, y = rand() * N, r = 14 + rand() * 50;
    wrapped(x, y, r, (px, py) => {
      const g = p.c.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, rand() < 0.5 ? "rgba(40,40,36,0.16)" : "rgba(220,220,210,0.16)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      p.c.fillStyle = g;
      p.c.fillRect(px - r, py - r, 2 * r, 2 * r);
    });
  }
  grain(p, rand, 0.3, 5200);
  return finish(p, 2, 1.6);
}
