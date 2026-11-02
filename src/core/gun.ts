import { type Arena } from "./melee";
import { type Inventory, type WeaponDef } from "./weapons";

/**
 * Armes à feu du joueur (J5-3, D84 ; visée libre T1, D205). Logique pure : le tir est instantané (un rayon, pas une balle qui vole), avec dispersion,
 * chargeur et rechargement. Le rendu (traits, éclairs, étincelles) lit `shots`.
 *
 * Deux façons de tirer. **À la hanche** : on braque l'arme vers la personne la plus proche dans un cône devant la caméra (le pouce n'a pas la précision
 * d'une souris). **En visée** : un rayon part de la caméra par le viseur, au centre de l'écran ; le premier mur, véhicule, relief ou passant qu'il
 * rencontre est le point visé, et la balle part de l'arme vers ce point (on vise depuis l'épaule, pas depuis l'œil).
 *
 * Analogie : un pointeur laser tenu à hauteur de poitrine. Le rayon a une altitude (D205) : il peut passer au-dessus d'une tête, finir dans une pente,
 * frôler le toit d'une voiture ; dans la tête, il fait trois fois plus mal. Un fusil à pompe lance huit rayons en éventail, plus faibles de loin.
 */

/** Ce que le tir demande au monde : les passants (`Arena`), le premier passant sur un rayon, et le premier mur (fraction 0 à 1 du segment, null sinon). */
export interface ShootWorld extends Arena {
  /**
   * Altitude des pieds (`z`, m) et hauteur du corps (`h`, m : debout ≈ 1,75, assis ≈ 1,3, à terre ≈ 0,45) d'un passant (D205).
   * Absent : les passants sont des colonnes sans fin (le tir ne tient pas compte de la hauteur).
   */
  span?(slot: number, out: { z: number; h: number }): void;
  /** Altitude du sol en (x, y), la plus haute sous `z` (ponts, terrasses). Absent : pas de relief, rien ne s'arrête dans le sol. */
  ground?(x: number, y: number, z: number): number;
  rayPed(x: number, y: number, dx: number, dy: number, maxDist: number, out: { slot: number; dist: number }): boolean;
  /** Premier obstacle (mur, et pour les balles aussi les obstacles ronds : véhicules garés, troncs, poteaux) : fraction 0-1 du segment, ou null. */
  wall(ax: number, ay: number, bx: number, by: number): number | null;
  /**
   * Premier véhicule touché par le rayon (garé ou de la circulation, D113) à moins de `maxDist` : sa distance et un numéro à rendre à `hurtVehicle`,
   * ou null. Absent : les balles ignorent les véhicules (essais).
   */
  rayVehicle?(x: number, y: number, dx: number, dy: number, maxDist: number): { dist: number; id: number } | null;
  /** Une balle a touché ce véhicule en (x, y) : dégâts de l'arme (le monde les ramène à l'échelle des véhicules). */
  hurtVehicle?(id: number, damage: number, x: number, y: number): void;
}

/** Demi-angle (rad) du cône de visée assistée (tir à la hanche) autour du regard de la caméra : ±20° (±40° avant le mode visée, D206). */
export const GUN_ASSIST_ANGLE = 0.35;
/** Les armes pointent à la hauteur de la poitrine : le trait part d'un peu devant le joueur. */
export const MUZZLE = 0.55;
/** Après un tir, le personnage reste en position de tir (s). */
export const AIM_HOLD = 1.4;
/** Plancher des dégâts d'un plomb éloigné (fraction des dégâts de près). */
export const FALLOFF_MIN = 0.25;
/** Hauteur de l'arme au-dessus des pieds (m) : celle de la pose de tir, à l'épaule. */
export const MUZZLE_Z = 1.35;
/** Tir dans la tête (D205) : la part haute du corps (m) et le multiplicateur des dégâts (un passant meurt d'une balle de pistolet dans la tête). */
export const HEAD_SIZE = 0.28;
export const HEAD_MULT = 3;
/** En visée, la dispersion est réduite de moitié (on prend le temps de viser) ; à la hanche, elle est augmentée de 40 % (D206). */
export const AIM_SPREAD = 0.5;
export const HIP_SPREAD = 1.4;
/** Pas (m, à l'horizontale) du contrôle du relief le long d'un rayon. */
const GROUND_STEP = 1.5;
/** Hauteur d'une carrosserie (m) : une balle plus haute passe au-dessus. */
const VEHICLE_TOP = 1.55;

/** Le rayon du viseur en visée : départ (la caméra) et direction (unitaire), en mètres du monde (x est, y nord, z haut). */
export interface AimRay {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

/** Altitude du tireur (ses pieds) et, en visée, le rayon du viseur (null : tir à la hanche). */
export interface GunView {
  z: number;
  aim: AimRay | null;
}

/** Ce qu'un rayon a touché : distance à l'horizontale (m), 0 rien / 1 mur, sol ou véhicule / 2 personne, l'emplacement, la tête, le véhicule. */
interface Cast {
  s: number;
  kind: 0 | 1 | 2;
  slot: number;
  head: boolean;
  veh: number;
}

/** Un rayon tiré à ce pas, pour le rendu : départ, arrivée, ce qui a été touché (0 rien, 1 mur, 2 personne). */
export interface Shot {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  kind: 0 | 1 | 2;
}

export interface GunResult {
  /** Tirs partis à ce pas (une cartouche, quel que soit le nombre de plombs). */
  fired: number;
  /** Personnes touchées, dont tuées, et balles dans la tête. */
  hits: number;
  killed: number;
  heads: number;
  /** Le chargeur est vide et la réserve aussi : la détente claque dans le vide (une fois par appui). */
  dry: boolean;
  /** Un rechargement vient de commencer, de finir. */
  reloadStarted: boolean;
  reloadDone: boolean;
  /** Rayons de ce pas (valables pour `fxCount` entrées). */
  shots: Shot[];
  fxCount: number;
}

const MAX_SHOTS = 12;

export class Gun {
  /** Cap voulu (rad) : vers la cible assistée, sinon le regard ; le jeu y tourne le joueur. */
  facing = 0;
  /** Il y a une cible assistée. */
  targeted = false;
  /** Emplacement de la cible assistée (−1 sans). */
  target = -1;
  /** Secondes de rechargement restantes (0 : pas en train de recharger). */
  reloading = 0;
  /** Secousse du dernier tir : 1 au tir, retombe à 0 en 0,18 s. */
  recoil = 0;
  /** Secondes depuis le dernier tir ou le dernier appui. */
  idle = Infinity;
  /** En visée (D205) : le point visé (m) et ce qu'il y a sous le viseur (0 rien, 1 mur, sol ou véhicule, 2 personne, 3 une tête). */
  aiming = false;
  readonly aimPoint = { x: 0, y: 0, z: 0 };
  aimKind: 0 | 1 | 2 | 3 = 0;
  readonly result: GunResult = { fired: 0, hits: 0, killed: 0, heads: 0, dry: false, reloadStarted: false, reloadDone: false, shots: Array.from({ length: MAX_SHOTS }, () => ({ x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, kind: 0 as 0 | 1 | 2 })), fxCount: 0 };
  private cooldown = 0;
  private pressed = false;
  private rng: number;
  private readonly found: number[] = [];
  private readonly pos = { x: 0, y: 0 };
  private readonly hit = { slot: -1, dist: 0 };
  private readonly body = { z: 0, h: 0 };
  private readonly cast: Cast = { s: 0, kind: 0, slot: -1, head: false, veh: -1 };
  private readonly damage = new Map<number, { dmg: number; nx: number; ny: number; heads: number }>();

  constructor(seed = 1) {
    this.rng = (seed >>> 0) || 1;
  }

  /** En position de tir (en visée, bouton tenu, ou tir récent) : pour la pose. Fondu 0 à 1. */
  get aim(): number {
    return this.aiming || this.idle < AIM_HOLD ? 1 : 0;
  }

  cancel(): void {
    this.reloading = 0;
    this.recoil = 0;
    this.cooldown = 0;
    this.targeted = false;
    this.target = -1;
    this.pressed = false;
    this.aiming = false;
    this.aimKind = 0;
  }

  /** Nombre pseudo-aléatoire de 0 à 1 (graine du tireur : la même série de tirs donne les mêmes rayons). */
  private random(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  /**
   * Un pas de `dt` s. `want` : bouton tenu ; `reload` : demande de rechargement (touche) ; (x, y) : le joueur ; `look` : cap du regard de la caméra (rad) ;
   * `world` : les passants et les murs (null : rien à toucher) ; `view` : altitude du tireur et rayon du viseur en visée (null : tir à plat, sans
   * hauteur, comme avant D205 : essais et banc). Renvoie `result` (réutilisé).
   */
  step(dt: number, want: boolean, reload: boolean, weapon: WeaponDef, inv: Inventory, x: number, y: number, look: number, world: ShootWorld | null, view: GunView | null = null): GunResult {
    const res = this.result;
    res.fired = res.hits = res.killed = res.heads = res.fxCount = 0;
    res.dry = res.reloadStarted = res.reloadDone = false;
    this.recoil = Math.max(0, this.recoil - dt / 0.18);
    this.idle += dt;
    if (want) this.idle = Math.min(this.idle, 0);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.facing = look;
    this.targeted = false;
    this.target = -1;
    const aim = weapon.kind === "gun" ? (view?.aim ?? null) : null;
    this.aiming = aim !== null;
    this.aimKind = 0;
    if (weapon.kind !== "gun") return res;
    const id = weapon.id;
    if (aim && view) {
      // Visée libre (D205) : le point visé est ce que touche le rayon du viseur, à partir du point de ce rayon le plus proche du tireur (rien derrière lui).
      const ox = aim.ox, oy = aim.oy, oz = aim.oz;
      const t0 = Math.max(0, (x - ox) * aim.dx + (y - oy) * aim.dy + (view.z + MUZZLE_Z - oz) * aim.dz);
      const sx = ox + aim.dx * t0, sy = oy + aim.dy * t0, sz = oz + aim.dz * t0;
      const c = this.trace(sx, sy, sz, aim.dx, aim.dy, aim.dz, weapon.range, false, world);
      const h = Math.hypot(aim.dx, aim.dy);
      const slope = h > 1e-6 ? aim.dz / h : 0, ux = h > 1e-6 ? aim.dx / h : 0, uy = h > 1e-6 ? aim.dy / h : 0;
      this.aimPoint.x = sx + ux * c.s;
      this.aimPoint.y = sy + uy * c.s;
      this.aimPoint.z = sz + slope * c.s;
      this.aimKind = c.kind === 2 ? (c.head ? 3 : 2) : c.kind;
      // Le tireur se tourne vers le point visé ; tout près (un mur devant), vers le regard, sans quoi l'épaule décalée le ferait pivoter.
      const ax = this.aimPoint.x - x, ay = this.aimPoint.y - y;
      this.facing = Math.hypot(ax, ay) > 2 ? Math.atan2(ax, ay) : Math.atan2(aim.dx, aim.dy);
    } else if (world && (want || this.idle < AIM_HOLD) && world.pick(x, y, look, weapon.range, GUN_ASSIST_ANGLE, 4, this.found) > 0) {
      // Visée assistée (à la hanche) : la personne la plus proche du regard dans le cône, à portée, sans mur entre elle et nous.
      for (const slot of this.found) {
        world.position(slot, this.pos);
        const wall = world.wall(x, y, this.pos.x, this.pos.y);
        if (wall !== null && wall < 0.98) continue;
        this.target = slot;
        this.targeted = true;
        this.facing = Math.atan2(this.pos.x - x, this.pos.y - y);
        break;
      }
    }
    // Rechargement en cours.
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        inv.reload(id);
        res.reloadDone = true;
      }
      this.pressed = want;
      return res;
    }
    const wantReload = reload || (want && inv.magOf(id) === 0);
    if (wantReload && inv.canReload(id)) {
      this.reloading = weapon.reload;
      res.reloadStarted = true;
      this.pressed = want;
      return res;
    }
    if (!want) {
      this.pressed = false;
      return res;
    }
    if (this.cooldown > 0) {
      this.pressed = true;
      return res;
    }
    if (!inv.fire(id)) {
      // Rien à tirer : un claquement par appui.
      res.dry = !this.pressed;
      this.pressed = true;
      return res;
    }
    this.pressed = true;
    this.cooldown = 1 / weapon.rate;
    this.recoil = 1;
    this.shoot(weapon, x, y, world, view, res);
    return res;
  }

  private shoot(weapon: WeaponDef, x: number, y: number, world: ShootWorld | null, view: GunView | null, res: GunResult): void {
    res.fired = 1;
    this.damage.clear();
    const mx = x + Math.sin(this.facing) * MUZZLE, my = y + Math.cos(this.facing) * MUZZLE;
    const mz = (view?.z ?? 0) + MUZZLE_Z;
    // Axe du tir : vers le point visé (visée), vers la poitrine de la cible (hanche, D205), sinon à l'horizontale et à plat (sans hauteur, comme avant).
    let pitch = 0, flat = true;
    if (view && this.aiming) {
      const d = Math.hypot(this.aimPoint.x - mx, this.aimPoint.y - my);
      pitch = d > 0.5 ? Math.atan2(this.aimPoint.z - mz, d) : 0;
      flat = false;
    } else if (view && this.targeted && world?.span) {
      world.position(this.target, this.pos);
      world.span(this.target, this.body);
      pitch = Math.atan2(this.body.z + this.body.h * 0.7 - mz, Math.max(0.5, Math.hypot(this.pos.x - mx, this.pos.y - my)));
      flat = false;
    }
    const spread = weapon.spread * (this.aiming ? AIM_SPREAD : HIP_SPREAD);
    const per = (d: number): number => (weapon.falloff ? Math.max(FALLOFF_MIN, 1 - (d / weapon.range) * (1 - FALLOFF_MIN)) : 1);
    for (let k = 0; k < weapon.pellets && res.fxCount < MAX_SHOTS; k++) {
      // Dispersion : triangulaire (plus de tirs près de l'axe qu'au bord du cône), à l'horizontale et, hors du tir à plat, en hauteur.
      const a = this.facing + (this.random() + this.random() - 1) * spread;
      const e = flat ? 0 : pitch + (this.random() + this.random() - 1) * spread * 0.6;
      const ce = Math.cos(e);
      const dx = Math.sin(a) * ce, dy = Math.cos(a) * ce, dz = Math.sin(e);
      const c = this.trace(mx, my, mz, dx, dy, dz, weapon.range, flat, world);
      const len = c.s / Math.max(ce, 1e-6);
      if (world) {
        if (c.kind === 1 && c.veh >= 0) world.hurtVehicle?.(c.veh, weapon.damage * per(len), mx + Math.sin(a) * c.s, my + Math.cos(a) * c.s);
        if (c.kind === 2) {
          const dmg = weapon.damage * per(len) * (c.head ? HEAD_MULT : 1);
          const hit = this.damage.get(c.slot);
          if (hit) {
            hit.dmg += dmg;
            if (c.head) hit.heads++;
          } else this.damage.set(c.slot, { dmg, nx: Math.sin(a), ny: Math.cos(a), heads: c.head ? 1 : 0 });
        }
      }
      const s = res.shots[res.fxCount++]!;
      s.x0 = mx;
      s.y0 = my;
      s.z0 = mz;
      s.x1 = mx + Math.sin(a) * c.s;
      s.y1 = my + Math.cos(a) * c.s;
      s.z1 = mz + Math.tan(e) * c.s;
      s.kind = c.kind;
    }
    // Les plombs d'un même tir touchent ensemble : les dégâts s'additionnent avant d'être appliqués (un coup, une seule chute).
    if (world) {
      for (const [slot, e] of this.damage) {
        const r = world.hurt(slot, e.dmg, e.nx, e.ny, weapon.impulse);
        if (r > 0) res.hits++;
        if (r === 2) res.killed++;
        if (r > 0 && e.heads > 0) res.heads++;
      }
    }
  }

  /**
   * Premier obstacle d'un rayon parti de (ox, oy, oz) dans la direction (dx, dy, dz) (unitaire), sur au plus `range` m : mur, véhicule, sol, passant.
   * `flat` : sans hauteur (ni relief, ni hauteur des corps, ni toit des voitures). Renvoie `cast` (réutilisé), distance comptée à l'horizontale.
   */
  private trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, flat: boolean, world: ShootWorld | null): Cast {
    const c = this.cast;
    c.kind = 0;
    c.slot = c.veh = -1;
    c.head = false;
    const h = Math.hypot(dx, dy);
    // Droit vers le haut ou le bas : rien à toucher (le sol, au pire, à nos pieds).
    if (h < 0.05) {
      c.s = 0;
      c.kind = dz < 0 && !flat ? 1 : 0;
      return c;
    }
    const ux = dx / h, uy = dy / h, slope = flat ? 0 : dz / h;
    let s = range * h;
    c.s = s;
    if (!world) return c;
    const wall = world.wall(ox, oy, ox + ux * s, oy + uy * s);
    if (wall !== null) {
      s = wall * s;
      c.s = s;
      c.kind = 1;
    }
    // Relief : on suit le rayon pas à pas ; le premier point sous le sol l'arrête (interpolé entre les deux derniers pas).
    if (!flat && world.ground) {
      let prev = oz - world.ground(ox, oy, oz + 0.5);
      for (let t = GROUND_STEP; t < s + GROUND_STEP; t += GROUND_STEP) {
        const tt = Math.min(t, s), z = oz + slope * tt;
        const gap = z - world.ground(ox + ux * tt, oy + uy * tt, z + 0.5);
        if (gap < 0) {
          s = tt - GROUND_STEP * (gap / (gap - prev || -1));
          s = Math.max(0, Math.min(s, tt));
          c.s = s;
          c.kind = 1;
          break;
        }
        prev = gap;
        if (tt >= s) break;
      }
    }
    // Une carrosserie arrête la balle (on s'abrite derrière une voiture), sauf si la balle passe au-dessus du toit.
    const veh = world.rayVehicle?.(ox, oy, ux, uy, s + 0.05) ?? null;
    if (veh && veh.dist <= s + 0.05) {
      const vx = ox + ux * veh.dist, vy = oy + uy * veh.dist, vz = oz + slope * veh.dist;
      if (flat || !world.ground || vz < world.ground(vx, vy, vz) + VEHICLE_TOP) {
        s = veh.dist;
        c.s = s;
        c.kind = 1;
        c.veh = veh.id;
      }
    }
    // Passants : le premier sur le rayon, à la hauteur du rayon ; un rayon qui passe au-dessus (ou en dessous) d'un corps continue derrière lui.
    let from = 0;
    for (let tries = 0; tries < 6 && from < s; tries++) {
      if (!world.rayPed(ox + ux * from, oy + uy * from, ux, uy, s - from, this.hit)) break;
      const at = from + this.hit.dist;
      if (flat || !world.span) {
        c.s = at;
        c.kind = 2;
        c.slot = this.hit.slot;
        c.veh = -1;
        break;
      }
      world.span(this.hit.slot, this.body);
      // Le rayon traverse le corps sur environ 0,5 m : on prend son altitude au milieu.
      const z = oz + slope * (at + 0.25), top = this.body.z + this.body.h;
      if (z >= this.body.z - 0.05 && z <= top + 0.05) {
        c.s = at;
        c.kind = 2;
        c.slot = this.hit.slot;
        c.head = this.body.h > 1.2 && z >= top - HEAD_SIZE;
        c.veh = -1;
        break;
      }
      from = at + 0.7;
    }
    return c;
  }
}
