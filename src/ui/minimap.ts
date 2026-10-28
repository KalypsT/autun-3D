import { imageMatrix, imagesInView, pickLevel, worldToScreen, formatDistance, type MapView } from "../core/mapview";
import { clampToDisc, waypointFrom, type Waypoint } from "../core/waypoint";
import type { MapData } from "./map-data";

/** Rayon visible autour du joueur (m) et taille de la pastille (px CSS). */
export const MINIMAP_RADIUS_M = 180;
export const MINIMAP_SIZE = 140;

const PAPER = "#f2e4c0";
const INK = "#2b2118";
const ACCENT = "#d9472b";
const VEHICLE_COLORS: Record<string, string> = { bike: "#2f7f8f", kickscooter: "#f1b24a", moto: "#7a4a8a", car: "#1f4a63" };

export interface MinimapVehicle {
  x: number;
  y: number;
  kind: string;
}

export interface MinimapState {
  /** Position du joueur (m). */
  x: number;
  y: number;
  /** Direction de la caméra : le haut de la minimap (sauf nord fixe). */
  cameraYaw: number;
  /** Direction du joueur ou du véhicule conduit : celle de la flèche au centre. */
  facing: number;
  north: boolean;
  vehicles: readonly MinimapVehicle[];
  waypoint: Waypoint | null;
  /** Voitures de police (J4) : points qui alternent bleu et rouge (`flash`), ramenés sur le bord quand elles sont hors du disque. */
  police?: readonly { x: number; y: number }[];
  flash?: boolean;
  /** Armes au sol disponibles (J5-3) : petits losanges orange. */
  caches?: readonly { x: number; y: number }[];
  /** Zone de recherche quand la police a perdu la piste : cercle autour de la dernière position connue. */
  search?: { x: number; y: number; r: number } | null;
}

/**
 * Minimap : un canvas 2D rond qui tourne avec la caméra (ou nord fixe), dessiné par les mêmes images que la carte agrandie.
 * Mise à jour à 15-20 Hz par le jeu ; `time` accumule dans `cost` le temps passé à la préparer et à la dessiner (objectif : moins d'1 ms par mise à jour).
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr: number;
  /** Temps de mise à jour : nombre d'appels, total et pire cas (ms). */
  readonly cost = { calls: 0, totalMs: 0, maxMs: 0 };

  private data: MapData | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(MINIMAP_SIZE * this.dpr);
    this.ctx = canvas.getContext("2d", { alpha: true })!;
  }

  /** Les données de la carte arrivent après le démarrage du jeu. */
  attach(data: MapData): void {
    this.data = data;
  }

  /** Exécute `fn` (préparation de l'état puis `update`) en comptant son temps dans `cost`. */
  time<T>(fn: () => T): T {
    const t0 = performance.now();
    const out = fn();
    const dt = performance.now() - t0;
    this.cost.calls++;
    this.cost.totalMs += dt;
    if (dt > this.cost.maxMs) this.cost.maxMs = dt;
    return out;
  }

  update(s: MinimapState): void {
    this.draw(s);
  }

  private draw(s: MinimapState): void {
    const { ctx, dpr } = this;
    const size = MINIMAP_SIZE, r = size / 2 - 8;
    const scale = r / MINIMAP_RADIUS_M;
    const heading = s.north ? 0 : s.cameraYaw;
    const view: MapView = { cx: s.x, cy: s.y, scale, heading, w: size, h: size };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, size, size);

    const data = this.data;
    if (data) {
      data.nextFrame();
      const level = pickLevel(data.index.levels, scale, dpr);
      let drawn = 0;
      for (const info of imagesInView(data.index.images, data.index.size, view)) {
        const img = data.image(info, level);
        if (!img) continue;
        const [a, b, c, d, e, f] = imageMatrix(view, info.x0, info.y1, level);
        ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
        ctx.drawImage(img, 0, 0);
        drawn++;
      }
      // En attendant les images fines (ou au bord de la zone), la vue d'ensemble donne au moins le décor.
      if (drawn === 0) {
        const o = data.overview();
        if (o) {
          const [a, b, c, d, e, f] = imageMatrix(view, data.index.overview.x0, data.index.overview.y1, data.index.overview.res);
          ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
          ctx.drawImage(o, 0, 0);
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Véhicules garés proches : les voitures (partout) en petits points, les deux-roues (à chercher) en losanges plus gros.
    ctx.strokeStyle = "#fff8e6";
    ctx.lineWidth = 1;
    for (const v of s.vehicles) {
      const [px, py] = worldToScreen(view, v.x, v.y);
      if (Math.hypot(px - size / 2, py - size / 2) > r - 3) continue;
      ctx.fillStyle = VEHICLE_COLORS[v.kind] ?? INK;
      ctx.beginPath();
      if (v.kind === "car") {
        ctx.arc(px, py, 2, 0, Math.PI * 2);
      } else {
        ctx.moveTo(px, py - 4);
        ctx.lineTo(px + 4, py);
        ctx.lineTo(px, py + 4);
        ctx.lineTo(px - 4, py);
        ctx.closePath();
      }
      ctx.fill();
      if (v.kind !== "car") ctx.stroke();
    }

    // Zone de recherche : un disque rouge pâle cerclé de pointillés.
    if (s.search) {
      const [cx, cy] = worldToScreen(view, s.search.x, s.search.y);
      ctx.beginPath();
      ctx.arc(cx, cy, s.search.r * scale, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(217, 71, 43, 0.16)";
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Police : sur le bord du disque quand elle est plus loin (on voit d'où elle vient).
    if (s.police) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#fff8e6";
      s.police.forEach((p, i) => {
        const [px, py] = worldToScreen(view, p.x, p.y);
        const q = clampToDisc(px - size / 2, py - size / 2, r - 5);
        ctx.fillStyle = (i % 2 === 0) === !!s.flash ? "#2f5fd0" : ACCENT;
        ctx.beginPath();
        ctx.arc(size / 2 + q.x, size / 2 + q.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    // Armes au sol : un losange orange dans le disque (hors du disque, rien : le repère « arme » du jeu indique la plus proche).
    if (s.caches) {
      ctx.fillStyle = "#f1b24a";
      ctx.strokeStyle = "#1b1f27";
      ctx.lineWidth = 1.2;
      for (const c of s.caches) {
        const [px, py] = worldToScreen(view, c.x, c.y);
        if (Math.hypot(px - size / 2, py - size / 2) > r - 6) continue;
        ctx.beginPath();
        ctx.moveTo(px, py - 5);
        ctx.lineTo(px + 4, py);
        ctx.lineTo(px, py + 5);
        ctx.lineTo(px - 4, py);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Repère : épingle dans le champ, flèche sur le bord et distance au-delà.
    let label: { text: string; x: number; y: number } | null = null;
    if (s.waypoint) {
      const [px, py] = worldToScreen(view, s.waypoint.x, s.waypoint.y);
      const p = clampToDisc(px - size / 2, py - size / 2, r - 6);
      const x = size / 2 + p.x, y = size / 2 + p.y;
      ctx.fillStyle = ACCENT;
      ctx.strokeStyle = "#fff8e6";
      ctx.lineWidth = 1.5;
      if (p.outside) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.angle);
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(5.5, 4);
        ctx.lineTo(0, 1);
        ctx.lineTo(-5.5, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        const d = waypointFrom(s.x, s.y, s.waypoint, 0).distance;
        label = { text: formatDistance(d), x: size / 2 + p.x * 0.62, y: size / 2 + p.y * 0.62 };
      } else {
        ctx.beginPath();
        ctx.arc(x, y - 5, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y - 3);
        ctx.lineTo(x + 3, y - 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Le joueur : une flèche au centre, tournée selon la direction du joueur par rapport à celle de la caméra.
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(s.facing - heading);
    ctx.fillStyle = "#1f4a63";
    ctx.strokeStyle = "#fff8e6";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    if (label) {
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = PAPER;
      ctx.fillStyle = INK;
      ctx.strokeText(label.text, label.x, label.y);
      ctx.fillText(label.text, label.x, label.y);
    }

    // Anneau, et « N » à l'endroit du nord.
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(43, 33, 24, .85)";
    ctx.stroke();
    const na = -heading;
    const nx = size / 2 + Math.sin(na) * (r + 0.5), ny = size / 2 - Math.cos(na) * (r + 0.5);
    ctx.beginPath();
    ctx.arc(nx, ny, 7, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.font = "700 9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff8e6";
    ctx.fillText("N", nx, ny + 0.5);
  }
}
