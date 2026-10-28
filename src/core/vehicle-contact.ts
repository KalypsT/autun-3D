import type { VehicleSpec, VehicleState } from "./vehicle";

/**
 * Chocs entre deux véhicules (J3-2) : les cercles de coque (`VehicleSpec.hull`) qui se chevauchent sont écartés, au prorata inverse des masses,
 * et une impulsion au point de contact change les vitesses et les lacets des deux. Même calcul que `collide` de `vehicle.ts` contre un mur,
 * avec deux corps mobiles. Analogie : deux autos tamponneuses de masses différentes : la plus légère part le plus loin.
 */

export interface Body {
  state: VehicleState;
  spec: VehicleSpec;
}

const RESTITUTION = 0.2;

/** Pire vitesse d'impact (m/s) du dernier contact, laissée dans `state.impact` des deux véhicules. Renvoie vrai s'il y a eu contact. */
export function contactVehicles(a: Body, b: Body): boolean {
  const sa = a.state, sb = b.state;
  // Rejet rapide : les emprises sont loin l'une de l'autre.
  let reachA = 0, reachB = 0;
  for (const [off, r] of a.spec.hull) reachA = Math.max(reachA, Math.abs(off) + r);
  for (const [off, r] of b.spec.hull) reachB = Math.max(reachB, Math.abs(off) + r);
  if (Math.hypot(sa.x - sb.x, sa.y - sb.y) > reachA + reachB) return false;
  const ma = a.spec.mass, mb = b.spec.mass;
  let touched = false;
  for (const [offA, ra] of a.spec.hull) {
    for (const [offB, rb] of b.spec.hull) {
      const sinA = Math.sin(sa.heading), cosA = Math.cos(sa.heading), sinB = Math.sin(sb.heading), cosB = Math.cos(sb.heading);
      const ax = sa.x + sinA * offA, ay = sa.y + cosA * offA, bx = sb.x + sinB * offB, by = sb.y + cosB * offB;
      const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy), reach = ra + rb;
      if (d >= reach) continue;
      touched = true;
      // Normale de A vers B (au hasard si les centres sont confondus).
      const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
      const overlap = reach - d;
      sa.x -= nx * overlap * (mb / (ma + mb));
      sa.y -= ny * overlap * (mb / (ma + mb));
      sb.x += nx * overlap * (ma / (ma + mb));
      sb.y += ny * overlap * (ma / (ma + mb));
      // Point de contact et bras de levier de chaque véhicule (depuis son centre de gravité).
      const px = ax + nx * ra, py = ay + ny * ra;
      const rax = px - sa.x, ray = py - sa.y, rbx = px - sb.x, rby = py - sb.y;
      // Vitesse du point de contact : v + ω × r (lacet horaire : (w·ry, −w·rx)).
      const vax = sa.vx + sa.yawRate * ray, vay = sa.vy - sa.yawRate * rax;
      const vbx = sb.vx + sb.yawRate * rby, vby = sb.vy - sb.yawRate * rbx;
      const vn = (vbx - vax) * nx + (vby - vay) * ny;
      if (vn >= 0) continue;
      const rna = rax * ny - ray * nx, rnb = rbx * ny - rby * nx;
      const ia = a.spec.yawInertia, ib = b.spec.yawInertia;
      const j = (-(1 + RESTITUTION) * vn) / (1 / ma + 1 / mb + (rna * rna) / ia + (rnb * rnb) / ib);
      sa.vx -= (j * nx) / ma;
      sa.vy -= (j * ny) / ma;
      sa.yawRate += (rna * j) / ia;
      sb.vx += (j * nx) / mb;
      sb.vy += (j * ny) / mb;
      sb.yawRate -= (rnb * j) / ib;
      sa.impact = Math.max(sa.impact, -vn);
      sb.impact = Math.max(sb.impact, -vn);
    }
  }
  return touched;
}
