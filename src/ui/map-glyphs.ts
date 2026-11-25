import { worldToScreen, type MapView } from "../core/mapview";

/** Dessins communs à la minimap et à la carte agrandie (D310) : le trait de l'itinéraire et la pastille du dernier véhicule. */

const CREAM = "#fff8e6";
const ROUTE = "#d9472b";
const INK = "#1b1f27";
/** Pastille du dernier véhicule : bleu nuit, comme la flèche du joueur. */
const VEHICLE = "#1f4a63";
const OCHRE = "#f1b24a";

/**
 * Trait de l'itinéraire : brique bordé de crème, comme le repère. `width` : épaisseur du trait (px CSS). Les segments loin de la vue
 * (`margin` px au-delà du cadre) ne sont pas tracés.
 */
export function drawRoute(ctx: CanvasRenderingContext2D, view: MapView, points: readonly number[], width: number, margin = 40): void {
  if (points.length < 4) return;
  const path = new Path2D();
  let open = false;
  let [px, py] = worldToScreen(view, points[0]!, points[1]!);
  const outside = (x: number, y: number): boolean => x < -margin || y < -margin || x > view.w + margin || y > view.h + margin;
  for (let i = 2; i + 1 < points.length; i += 2) {
    const [x, y] = worldToScreen(view, points[i]!, points[i + 1]!);
    if (outside(px, py) && outside(x, y) && (Math.max(px, x) < -margin || Math.min(px, x) > view.w + margin || Math.max(py, y) < -margin || Math.min(py, y) > view.h + margin)) {
      open = false;
    } else {
      if (!open) path.moveTo(px, py);
      path.lineTo(x, y);
      open = true;
    }
    px = x;
    py = y;
  }
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = width + 2.5;
  ctx.stroke(path);
  ctx.strokeStyle = ROUTE;
  ctx.lineWidth = width;
  ctx.stroke(path);
  ctx.restore();
}

/** Pastille du dernier véhicule en (x, y) : disque bleu nuit cerclé de crème, une voiture ou une roue de deux-roues dedans. `r` : rayon (px). */
export function drawVehicleBadge(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, r: number): void {
  ctx.save();
  ctx.fillStyle = VEHICLE;
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = Math.max(1.3, r * 0.22);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = CREAM;
  const k = r / 7;
  if (kind === "car") {
    // Carrosserie et toit, deux roues.
    ctx.beginPath();
    ctx.roundRect(x - 4.2 * k, y - 0.6 * k, 8.4 * k, 2.8 * k, 0.8 * k);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 2.6 * k, y - 0.6 * k);
    ctx.lineTo(x - 1.6 * k, y - 2.8 * k);
    ctx.lineTo(x + 1.8 * k, y - 2.8 * k);
    ctx.lineTo(x + 2.8 * k, y - 0.6 * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = INK;
    for (const dx of [-2.4, 2.4]) {
      ctx.beginPath();
      ctx.arc(x + dx * k, y + 2.3 * k, 1.1 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Deux roues et un cadre.
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = Math.max(1, 1.1 * k);
    for (const dx of [-2.6, 2.6]) {
      ctx.beginPath();
      ctx.arc(x + dx * k, y + 1.2 * k, 1.9 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - 2.6 * k, y + 1.2 * k);
    ctx.lineTo(x - 0.4 * k, y - 1.6 * k);
    ctx.lineTo(x + 2.6 * k, y + 1.2 * k);
    ctx.moveTo(x + 1 * k, y - 2.8 * k);
    ctx.lineTo(x + 2.6 * k, y + 1.2 * k);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Monument de la chasse (D320) en (x, y), rayon `r` (px) : disque gris et « ? » crème tant qu'il n'est pas découvert, disque ocre et
 * coche encre une fois trouvé.
 */
export function drawHuntPin(ctx: CanvasRenderingContext2D, x: number, y: number, found: boolean, r: number): void {
  ctx.save();
  ctx.fillStyle = found ? OCHRE : "#7d838b";
  ctx.strokeStyle = found ? INK : CREAM;
  ctx.lineWidth = Math.max(1.3, r * 0.2);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (found) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.6, r * 0.28);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x - r * 0.45, y + r * 0.02);
    ctx.lineTo(x - r * 0.1, y + r * 0.38);
    ctx.lineTo(x + r * 0.48, y - r * 0.36);
    ctx.stroke();
  } else {
    ctx.fillStyle = CREAM;
    ctx.font = `900 ${Math.round(r * 1.4)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x, y + r * 0.08);
  }
  ctx.restore();
}
