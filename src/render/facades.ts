import * as THREE from "three";
import type { Building, FacadeFiche, HeightField, Terrace, WallRun } from "../data/types";
import { finish, hash01, MeshBuilder, toThree, type Steps, type Vec3 } from "./geometry";
import { shopfrontExtras, styledTerrace } from "./shopfront";
import {
  type ElementSpec, canonicalWindow, doorDims, doorRequest, quantize, railingRequest, shopModuleRequest, signRequest, SHOP_MODULE_W, windowDims, windowRequest,
  type DoorStyle, type WindowSpec,
} from "./facade-specs";

/** Un élément posé sur un mur : sprite de façade ou enseigne. */
export interface Placement {
  key: string;
  atlas: "facade" | "sign";
  /** Point au milieu du bas du sprite (repère données). */
  x: number;
  y: number;
  z: number;
  /** Tangente horizontale unitaire du mur et normale sortante. */
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  /** Largeur imposée en mètres (sinon celle du sprite) : balcons étirés. */
  width?: number;
}

export interface FacadePlan {
  requests: ElementSpec[];
  signRequests: ElementSpec[];
  placements: Placement[];
  /** Éléments en volume sans texture : corniches, bandeaux, soubassements, balcons. */
  misc: MeshBuilder;
  stats: { windows: number; doors: number; shops: number; balconies: number; runs: number };
}

const STONE_LIGHT = new THREE.Color("#d8d0bc");
const WOOD = new THREE.Color("#6d5a46");
const SLAB = new THREE.Color("#cfc7b3");

interface Polyline {
  pts: [number, number][];
  tops: number[];
  cum: number[];
  length: number;
}

function runPolyline(b: Building, run: WallRun): Polyline {
  const ring = run.hole === undefined ? b.ring : b.holes[run.hole]!;
  const tops = run.hole === undefined ? b.top : b.holeTop[run.hole]!;
  const n = ring.length / 2;
  const count = (run.b - run.a + n) % n || n;
  const pts: [number, number][] = [];
  const tz: number[] = [];
  for (let j = 0; j <= count; j++) {
    const i = (run.a + j) % n;
    pts.push([ring[2 * i]!, ring[2 * i + 1]!]);
    tz.push(tops[i]!);
  }
  const cum = [0];
  for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1]! + Math.hypot(pts[j]![0] - pts[j - 1]![0], pts[j]![1] - pts[j - 1]![1]));
  return { pts, tops: tz, cum, length: cum[cum.length - 1]! };
}

interface Sample {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  top: number;
}

function sampleAt(pl: Polyline, s: number): Sample {
  const ss = Math.min(Math.max(s, 0), pl.length);
  let j = 1;
  while (j < pl.cum.length - 1 && pl.cum[j]! < ss) j++;
  const s0 = pl.cum[j - 1]!, s1 = pl.cum[j]!;
  const t = s1 > s0 ? (ss - s0) / (s1 - s0) : 0;
  const [x0, y0] = pl.pts[j - 1]!, [x1, y1] = pl.pts[j]!;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const tx = (x1 - x0) / len, ty = (y1 - y0) / len;
  return {
    x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, tx, ty, nx: ty, ny: -tx,
    top: pl.tops[j - 1]! + (pl.tops[j]! - pl.tops[j - 1]!) * t,
  };
}

function vec(x: number, y: number, z: number): Vec3 {
  return toThree(x, y, z);
}

/** Bande en saillie le long d'une série de murs : face avant et dessous (corniche, bandeau, soubassement). */
function strip(
  mb: MeshBuilder, pl: Polyline, zBottom: (s: number, top: number) => number, zTop: (s: number, top: number) => number,
  projection: number, color: THREE.Color, withSoffit: boolean,
): void {
  const steps = Math.max(1, Math.round(pl.length / 2));
  for (let i = 0; i < steps; i++) {
    const a = sampleAt(pl, (pl.length * i) / steps), b = sampleAt(pl, (pl.length * (i + 1)) / steps);
    const sa = (pl.length * i) / steps, sb = (pl.length * (i + 1)) / steps;
    const za0 = zBottom(sa, a.top), za1 = zTop(sa, a.top), zb0 = zBottom(sb, b.top), zb1 = zTop(sb, b.top);
    const oa: [number, number] = [a.x + a.nx * projection, a.y + a.ny * projection];
    const ob: [number, number] = [b.x + b.nx * projection, b.y + b.ny * projection];
    const nrm = toThree(a.nx, a.ny, 0);
    mb.quad(vec(oa[0], oa[1], za0), vec(ob[0], ob[1], zb0), vec(ob[0], ob[1], zb1), vec(oa[0], oa[1], za1), nrm, color);
    if (withSoffit) {
      mb.quad(vec(a.x, a.y, za0), vec(b.x, b.y, zb0), vec(ob[0], ob[1], zb0), vec(oa[0], oa[1], za0), [0, -1, 0], color);
    }
  }
}

function slabBox(mb: MeshBuilder, pl: Polyline, s0: number, s1: number, z: number, thick: number, proj: number): void {
  const a = sampleAt(pl, s0), b = sampleAt(pl, s1);
  const oa: [number, number] = [a.x + a.nx * proj, a.y + a.ny * proj], ob: [number, number] = [b.x + b.nx * proj, b.y + b.ny * proj];
  const nrm = toThree(a.nx, a.ny, 0);
  mb.quad(vec(oa[0], oa[1], z - thick), vec(ob[0], ob[1], z - thick), vec(ob[0], ob[1], z), vec(oa[0], oa[1], z), nrm, SLAB);
  mb.quad(vec(a.x, a.y, z), vec(b.x, b.y, z), vec(ob[0], ob[1], z), vec(oa[0], oa[1], z), [0, 1, 0], SLAB);
  mb.quad(vec(a.x, a.y, z - thick), vec(b.x, b.y, z - thick), vec(ob[0], ob[1], z - thick), vec(oa[0], oa[1], z - thick), [0, -1, 0], SLAB);
}

export function planFacades(buildings: readonly Building[], fiches: ReadonlyMap<string, FacadeFiche>, terrain: HeightField): FacadePlan {
  return finish(planFacadesSteps(buildings, fiches, terrain));
}

/** Comme `planFacades`, en rendant la main après chaque bâtiment. */
export function* planFacadesSteps(
  buildings: readonly Building[], fiches: ReadonlyMap<string, FacadeFiche>, terrain: HeightField,
  /** Sol libre devant les façades (trottoirs, places) : les terrasses ne s'installent que là. */
  free: (x: number, y: number) => boolean = () => false,
): Steps<FacadePlan> {
  const plan: FacadePlan = {
    requests: [], signRequests: [], placements: [], misc: new MeshBuilder(),
    stats: { windows: 0, doors: 0, shops: 0, balconies: 0, runs: 0 },
  };
  const railing = railingRequest();
  plan.requests.push(railing);

  const place = (key: string, atlas: Placement["atlas"], s: Sample, z: number, offset: number, width?: number): void => {
    const p: Placement = { key, atlas, x: s.x + s.nx * offset, y: s.y + s.ny * offset, z, tx: s.tx, ty: s.ty, nx: s.nx, ny: s.ny };
    if (width !== undefined) p.width = width;
    plan.placements.push(p);
  };

  for (const b of buildings) {
    const f = fiches.get(b.id);
    if (!f) continue;
    const fa = f.facade;
    const gh = f.storeys.ground, uh = f.storeys.upper;
    // Le mur d'entrée de la fiche (D120), sinon le plus long mur sur rue.
    const mainIdx = (() => {
      if (f.ground.front !== undefined && f.walls[f.ground.front]) return f.ground.front;
      let best = -1, len = 0;
      f.walls.forEach((w, i) => {
        if (w.role === "street" && w.hole === undefined && w.length > len) {
          best = i;
          len = w.length;
        }
      });
      return best;
    })();
    const doorStyle = f.ground.door.style;

    // Boucle (et non forEach) pour pouvoir rendre la main après chaque pan de mur : certains bâtiments en ont des dizaines.
    for (const [runIdx, run] of f.walls.entries()) {
      if (run.role === "party" || run.length < 1.8) continue;
      if (f.ground.kind === "blank" && run.eave - run.datum < 3.6) continue;
      const pl = runPolyline(b, run);
      const isStreet = run.role === "street";
      plan.stats.runs++;

      // --- éléments en volume -------------------------------------------------------
      const plinthColor = new THREE.Color(fa.plinth.color);
      if (isStreet || run.role === "court") {
        strip(plan.misc, pl, (s) => terrain.heightAt(sampleAt(pl, s).x, sampleAt(pl, s).y) - 0.25,
          (s) => terrain.heightAt(sampleAt(pl, s).x, sampleAt(pl, s).y) + fa.plinth.height, 0.035, plinthColor, false);
      }
      if (fa.cornice.kind !== "none" && !run.gable) {
        const h = fa.cornice.height;
        strip(plan.misc, pl, (_s, top) => top - h, (_s, top) => top + 0.02, fa.cornice.projection,
          fa.cornice.kind === "stone_moulded" ? STONE_LIGHT : WOOD, true);
      }
      if (fa.stringCourse && isStreet && f.levels >= 2) {
        const zc = run.datum + gh;
        strip(plan.misc, pl, () => zc - 0.08, () => zc + 0.08, 0.05, STONE_LIGHT, false);
      }

      // --- travées ------------------------------------------------------------------
      const bayW = fa.bayWidth * (isStreet ? 1 : 1.15);
      const margin = 0.6;
      const usable = run.length - 2 * margin;
      if (usable < 0.9) continue;
      const nBays = Math.max(1, Math.round(usable / bayW));
      const bay = usable / nBays;
      const center = (i: number): number => margin + (i + 0.5) * bay;

      // Fenêtre : les murs de cour restent simples.
      const base = fa.window;
      const spec: WindowSpec = {
        style: base.style, w: Math.max(0.5, quantize(base.width)), h: Math.max(0.6, quantize(base.height)),
        surround: isStreet ? base.surround : "none", lintel: isStreet ? base.lintel : "none", sill: isStreet ? base.sill : false,
        shutter: isStreet ? fa.shutters.kind : "none", shutterColor: fa.shutters.color, frame: base.frameColor,
      };
      // Tout doit tenir dans la travée, volets ouverts compris : on rétrécit, puis on dépouille.
      for (let guard = 0; guard < 14 && windowDims(spec).wm > bay - 0.08; guard++) {
        if (spec.w > 0.7) spec.w = quantize(spec.w - 0.1);
        else if (spec.shutter !== "none") spec.shutter = "none";
        else if (spec.surround !== "none") spec.surround = "none";
        else break;
      }

      // Rez-de-chaussée : porte et vitrines.
      const blocked = new Set<number>();
      const mainWall = runIdx === mainIdx;
      // Les commerces du mur, plus les vitrines d'angle (D179) des commerces des murs voisins.
      const shops = (f.ground.shops ?? []).filter((sh) => sh.wall === runIdx || sh.corner?.wall === runIdx)
        .map((sh) => (sh.wall === runIdx ? sh : { ...sh, wall: runIdx, s: sh.corner!.s, corner: undefined, terrace: undefined }));
      const wantsShop = f.ground.kind === "shop";
      // Le mur principal reçoit la porte ou les vitrines ; un autre mur sur rue, seulement les commerces qu'OpenStreetMap y place.
      // Boutique d'angle (D179) : la devanture du même commerce sur le mur voisin de l'entrée.
      const corner = wantsShop ? [f.ground.corner, ...(f.ground.corners ?? [])].find((c) => c?.wall === runIdx) : undefined;
      if (isStreet && f.ground.kind !== "blank" && (mainWall || corner || (wantsShop && shops.length > 0))) {
        const centers: { name: string | null; s: number; kind: string | null; terrace?: Terrace | undefined }[] = shops.map((sh) => ({ name: sh.name, s: sh.s, kind: sh.kind, terrace: sh.terrace }));
        if (wantsShop && centers.length === 0) centers.push({ name: null, s: run.length / 2, kind: null });
        const sf = f.ground.shopfront;
        const dev = corner ? corner.devanture : mainWall ? f.ground.devanture : undefined;
        if (wantsShop && dev && (mainWall || corner)) {
          // Devanture d'après photo (D141) : dessinée telle quelle (stylized.ts, `devantureGeometry`) ; pas de fenêtre au rez-de-chaussée derrière.
          const width = dev.bays.reduce((a, q) => a + q[1], 0);
          const mid = sampleAt(pl, dev.s0 + width / 2);
          const devKey = corner ? `dev|${b.id}|c|${runIdx}` : `dev|${b.id}`;
          plan.requests.push({ key: devKey, wm: width, hm: dev.h });
          place(devKey, "facade", sampleAt(pl, 0), terrain.heightAt(mid.x, mid.y), 0);
          plan.stats.shops++;
          // Terrasse d'après photo (D178) devant la devanture : sur sol libre seulement (sinon rien, la devanture porte déjà son store).
          const terr = corner ? corner.terrace : shops.find((sh) => sh.terrace)?.terrace;
          const withTerrace = terr ? { terrace: terr } : undefined;
          if (withTerrace?.terrace) {
            const span = withTerrace.terrace.span ?? [dev.s0, dev.s0 + width];
            const tm = sampleAt(pl, (span[0] + span[1]) / 2);
            styledTerrace(plan.misc, { x: tm.x, y: tm.y, tx: tm.tx, ty: tm.ty, nx: tm.nx, ny: tm.ny, width: span[1] - span[0], zTop: 0, zSign: 0, key: `${b.id}|dev` }, terrain, free, withTerrace.terrace);
          }
          for (let i = 0; i < nBays; i++) if (center(i) > dev.s0 - 0.5 && center(i) < dev.s0 + width + 0.5) blocked.add(i);
        } else if (wantsShop && sf) {
          for (const c of centers.slice(0, 2)) {
            const mods = Math.max(3, Math.min(5, Math.round((c.name ? 5.0 : 4.2) / SHOP_MODULE_W)));
            const width = mods * SHOP_MODULE_W;
            const s0 = Math.min(Math.max(c.s - width / 2, 0.45), Math.max(run.length - 0.45 - width, 0.45));
            if (s0 + width > run.length - 0.4) continue;
            const mid = sampleAt(pl, s0 + width / 2);
            const topZ = run.datum + gh - 0.95;
            const bottom = terrain.heightAt(mid.x, mid.y) + 0.03;
            const hv = Math.min(Math.max(quantize(topZ - bottom, 0.2), 1.6), 3.4);
            const doorMod = Math.floor(hash01(b.id, 5) * mods);
            let cursor = s0;
            for (let m = 0; m < mods; m++) {
              const isDoor = m === doorMod;
              const req = shopModuleRequest(sf.color, sf.glazing, hv, isDoor);
              plan.requests.push(req);
              const w = isDoor ? 1.2 : SHOP_MODULE_W;
              place(req.key, "facade", sampleAt(pl, cursor + w / 2), topZ - hv, 0.07);
              cursor += w;
            }
            const used = cursor - s0;
            // Pilastres de part et d'autre
            for (const sPil of [s0 - 0.12, s0 + used + 0.12]) {
              const sm = sampleAt(pl, sPil);
              const zb = terrain.heightAt(sm.x, sm.y);
              const col = new THREE.Color(sf.color);
              const o = 0.09, hw = 0.13;
              const a: [number, number] = [sm.x - sm.tx * hw, sm.y - sm.ty * hw], bb: [number, number] = [sm.x + sm.tx * hw, sm.y + sm.ty * hw];
              plan.misc.quad(vec(a[0] + sm.nx * o, a[1] + sm.ny * o, zb), vec(bb[0] + sm.nx * o, bb[1] + sm.ny * o, zb),
                vec(bb[0] + sm.nx * o, bb[1] + sm.ny * o, run.datum + gh - 0.3), vec(a[0] + sm.nx * o, a[1] + sm.ny * o, run.datum + gh - 0.3),
                toThree(sm.nx, sm.ny, 0), col);
            }
            if (c.name) {
              const sg = signRequest(c.name, sf.color, used + 0.4);
              plan.signRequests.push(sg);
              place(sg.key, "sign", sampleAt(pl, s0 + used / 2), run.datum + gh - 0.72, 0.1);
            } else {
              // Bandeau uni au-dessus des vitrines sans enseigne connue
              const sg = signRequest("", sf.color, used + 0.4);
              plan.signRequests.push(sg);
              place(sg.key, "sign", sampleAt(pl, s0 + used / 2), run.datum + gh - 0.72, 0.1);
            }
            // Store, terrasse, croix de pharmacie ou carotte de tabac selon le commerce.
            const front = sampleAt(pl, s0 + used / 2);
            shopfrontExtras(plan.misc, {
              x: front.x, y: front.y, tx: front.tx, ty: front.ty, nx: front.nx, ny: front.ny, width: used,
              zTop: topZ, zSign: run.datum + gh - 0.72, key: `${b.id}|${c.s.toFixed(1)}`,
            }, c.kind, new THREE.Color(sf.color), terrain, free, c.terrace);
            plan.stats.shops++;
            for (let i = 0; i < nBays; i++) if (center(i) > s0 - 0.5 && center(i) < s0 + used + 0.5) blocked.add(i);
          }
        } else if (doorStyle !== "none" && mainWall) {
          const style = doorStyle as DoorStyle;
          const d = doorDims(style);
          let i = Math.floor(hash01(b.id, 9) * nBays);
          if (d.wm > bay - 0.1 && style !== "carriage") i = Math.floor(nBays / 2);
          const mid = sampleAt(pl, center(i));
          const req = doorRequest(style, f.ground.door.color);
          plan.requests.push(req);
          place(req.key, "facade", mid, terrain.heightAt(mid.x, mid.y), 0.05);
          plan.stats.doors++;
          blocked.add(i);
          if (style === "carriage" && i + 1 < nBays) blocked.add(i + 1);
        }
      }

      // Étages et rez-de-chaussée : fenêtres.
      for (let level = 0; level < f.levels; level++) {
        const floorZ = run.datum + (level === 0 ? 0 : gh + (level - 1) * uh);
        const balconyHere = isStreet && fa.balcony && fa.balcony !== "none" && level === (fa.balconyLevel ?? 1) && level > 0;
        const lspec: WindowSpec = { ...spec };
        let sillZ = floorZ + (level === 0 ? 0.95 : 0.85);
        if (balconyHere) {
          lspec.style = "french_window";
          lspec.h = quantize(Math.min(2.2, uh - 0.45));
          lspec.sill = false;
          sillZ = floorZ + 0.08;
        } else if (level > 0 && base.style === "panes_4" && level === 1 && isStreet) {
          lspec.h = quantize(Math.min(base.height + 0.2, uh - 0.5));
          sillZ = floorZ + 0.55;
        }
        const cs = canonicalWindow(lspec);
        const dims = windowDims(cs);
        const topNeeded = sillZ + cs.h + dims.sur + 0.12 + fa.cornice.height;
        const req = windowRequest(cs);
        let any = false;
        for (let i = 0; i < nBays; i++) {
          if (level === 0 && blocked.has(i)) continue;
          if (level === 0 && !isStreet && hash01(b.id, 100 + i) < 0.35) continue;
          const s = sampleAt(pl, center(i));
          const spill = sampleAt(pl, Math.min(center(i) + dims.wm / 2, pl.length));
          if (topNeeded > Math.min(s.top, spill.top) + 0.1) continue;
          if (terrain.heightAt(s.x, s.y) + 0.3 > sillZ - dims.bottomPad) continue;
          if (!any) plan.requests.push(req);
          any = true;
          place(req.key, "facade", s, sillZ - dims.bottomPad, 0.045);
          plan.stats.windows++;
        }
        if (balconyHere && any) {
          if (fa.balcony === "filant") {
            slabBox(plan.misc, pl, margin * 0.7, run.length - margin * 0.7, floorZ, 0.14, 0.62);
            const len = run.length - margin * 1.4;
            const pieces = Math.max(1, Math.round(len / 1.0));
            for (let k = 0; k < pieces; k++) {
              const sc = sampleAt(pl, margin * 0.7 + ((k + 0.5) * len) / pieces);
              place(railing.key, "facade", sc, floorZ, 0.62, len / pieces);
            }
          } else {
            for (let i = 0; i < nBays; i++) {
              if (hash01(b.id, 300 + i) > 0.55) continue;
              slabBox(plan.misc, pl, center(i) - 0.8, center(i) + 0.8, floorZ, 0.14, 0.5);
              place(railing.key, "facade", sampleAt(pl, center(i)), floorZ, 0.5, 1.6);
            }
          }
          plan.stats.balconies++;
        }
      }
      yield;
    }
  }
  return plan;
}
