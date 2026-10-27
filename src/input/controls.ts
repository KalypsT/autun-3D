/**
 * Commandes : à pied, joystick flottant à gauche et regard en glissant à droite ;
 * en véhicule, direction en glissant horizontalement à gauche, pédales Accélérer et Freiner à droite.
 * Clavier et souris dans les deux cas.
 */

export interface ControlSample {
  forward: number;
  right: number;
  run: boolean;
  /** Rotation demandée depuis le dernier appel, en radians (droite = lacet +, bas = tangage +). */
  lookYaw: number;
  lookPitch: number;
  /** Véhicule : direction -1 à 1, accélérateur et frein 0-1, frein à main 0 ou 1. */
  steer: number;
  throttle: number;
  brake: number;
  handbrake: number;
  /** Klaxon (ou sonnette) enfoncé. */
  horn: boolean;
  /** Le regard a été touché depuis le dernier appel (la caméra de poursuite attend avant de se recaler). */
  looking: boolean;
}

export type ControlMode = "foot" | "drive";

const STICK_RADIUS = 58;
const DEAD_ZONE = 0.12;
const RUN_THRESHOLD = 0.85;
const TOUCH_LOOK = 0.0048;
const MOUSE_LOOK = 0.0032;
/** Course horizontale du doigt pour braquer à fond (px). */
const STEER_RANGE = 70;

interface Pointer {
  id: number;
  x: number;
  y: number;
}

export class Controls {
  private readonly keys = new Set<string>();
  private stick: (Pointer & { cx: number; cy: number }) | null = null;
  private readonly looks = new Map<number, Pointer & { mouse: boolean }>();
  private lookYaw = 0;
  private lookPitch = 0;
  private stickX = 0;
  private stickY = 0;
  private readonly pedals = new Map<number, "gas" | "brake" | "handbrake" | "horn">();
  private looked = false;
  /** À pied ou en véhicule : change le rôle du doigt de gauche et affiche les pédales. */
  mode: ControlMode = "foot";
  /** Multiplicateur de la rotation de la caméra au doigt et à la souris (réglage de sensibilité). */
  sensitivity = 1;
  private readonly cleanup: (() => void)[] = [];
  private readonly pedalEls: HTMLElement[] = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly base: HTMLElement,
    private readonly knob: HTMLElement,
    gas: HTMLElement | null = null,
    brake: HTMLElement | null = null,
    handbrake: HTMLElement | null = null,
    horn: HTMLElement | null = null,
  ) {
    const on = (el: EventTarget, type: string, fn: (e: Event) => void): void => {
      el.addEventListener(type, fn);
      this.cleanup.push(() => el.removeEventListener(type, fn));
    };
    on(window, "keydown", (e) => this.keys.add((e as KeyboardEvent).code));
    on(window, "keyup", (e) => this.keys.delete((e as KeyboardEvent).code));
    on(window, "blur", () => this.keys.clear());
    on(surface, "contextmenu", (e) => e.preventDefault());
    on(surface, "pointerdown", (e) => this.down(e as PointerEvent));
    on(surface, "pointermove", (e) => this.move(e as PointerEvent));
    on(surface, "pointerup", (e) => this.up(e as PointerEvent));
    on(surface, "pointercancel", (e) => this.up(e as PointerEvent));
    for (const [el, kind] of [[gas, "gas"], [brake, "brake"], [handbrake, "handbrake"], [horn, "horn"]] as const) {
      if (!el) continue;
      this.pedalEls.push(el);
      const press = (e: Event): void => {
        const p = e as PointerEvent;
        p.preventDefault();
        el.setPointerCapture(p.pointerId);
        this.pedals.set(p.pointerId, kind);
        el.classList.add("on");
      };
      const release = (e: Event): void => {
        this.pedals.delete((e as PointerEvent).pointerId);
        if (![...this.pedals.values()].includes(kind)) el.classList.remove("on");
      };
      on(el, "pointerdown", press);
      on(el, "pointerup", release);
      on(el, "pointercancel", release);
      on(el, "contextmenu", (e) => e.preventDefault());
    }
  }

  private down(e: PointerEvent): void {
    this.surface.setPointerCapture(e.pointerId);
    if (e.pointerType === "mouse") {
      this.looks.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, mouse: true });
      return;
    }
    if (e.clientX < window.innerWidth * 0.5 && !this.stick) {
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY };
      this.base.style.display = this.knob.style.display = "block";
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.left = `${e.clientX}px`;
      this.knob.style.top = `${e.clientY}px`;
    } else {
      this.looks.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, mouse: false });
    }
  }

  private move(e: PointerEvent): void {
    if (this.stick && this.stick.id === e.pointerId) {
      if (this.mode === "drive") {
        const dx = Math.max(-STEER_RANGE, Math.min(STEER_RANGE, e.clientX - this.stick.cx));
        // Courbe progressive : petits gestes précis au centre, braquage franc en bout de course.
        const t = dx / STEER_RANGE;
        this.stickX = Math.sign(t) * Math.abs(t) ** 1.3;
        this.stickY = 0;
        this.knob.style.left = `${this.stick.cx + dx}px`;
        this.knob.style.top = `${this.stick.cy}px`;
        return;
      }
      let dx = e.clientX - this.stick.cx, dy = e.clientY - this.stick.cy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      this.stickX = dx / STICK_RADIUS;
      this.stickY = dy / STICK_RADIUS;
      this.knob.style.left = `${this.stick.cx + dx}px`;
      this.knob.style.top = `${this.stick.cy + dy}px`;
      return;
    }
    const look = this.looks.get(e.pointerId);
    if (!look) return;
    if (look.mouse && e.buttons === 0) return;
    const k = (look.mouse ? MOUSE_LOOK : TOUCH_LOOK) * this.sensitivity;
    this.lookYaw += (e.clientX - look.x) * k;
    this.lookPitch += (e.clientY - look.y) * k;
    this.looked = true;
    look.x = e.clientX;
    look.y = e.clientY;
  }

  private up(e: PointerEvent): void {
    if (this.stick && this.stick.id === e.pointerId) {
      this.stick = null;
      this.stickX = this.stickY = 0;
      this.base.style.display = this.knob.style.display = "none";
    }
    this.looks.delete(e.pointerId);
  }

  /**
   * Lâche tout : doigts, touches, pédales. À la pause, un doigt resté posé ne doit pas laisser une pédale « collée » à la reprise
   * (les `pointerup` suivants tombent sur le menu, pas sur les commandes).
   */
  reset(): void {
    this.keys.clear();
    this.stick = null;
    this.stickX = this.stickY = 0;
    this.looks.clear();
    this.pedals.clear();
    this.lookYaw = this.lookPitch = 0;
    this.looked = false;
    this.base.style.display = this.knob.style.display = "none";
    for (const el of this.pedalEls) el.classList.remove("on");
  }

  /** Lit l'état des commandes et remet à zéro les rotations accumulées. */
  poll(): ControlSample {
    let forward = 0, right = 0, run = false;
    const mag = Math.hypot(this.stickX, this.stickY);
    if (mag > DEAD_ZONE) {
      const scaled = (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
      forward = (-this.stickY / mag) * scaled;
      right = (this.stickX / mag) * scaled;
      run = mag > RUN_THRESHOLD;
    }
    const k = this.keys;
    const kf = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const kr = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    if (kf !== 0 || kr !== 0) {
      const l = Math.hypot(kf, kr);
      forward = kf / l;
      right = kr / l;
      run = k.has("ShiftLeft") || k.has("ShiftRight");
    }
    // Véhicule : direction au doigt (ou Q/A et D), pédales (ou Z/W/flèche haut, S/flèche bas), frein à main (ou espace).
    let steer = this.stickX, throttle = 0, brake = 0, handbrake = 0, horn = k.has("KeyH");
    for (const p of this.pedals.values()) {
      if (p === "gas") throttle = 1;
      else if (p === "brake") brake = 1;
      else if (p === "horn") horn = true;
      else handbrake = 1;
    }
    if (kr !== 0) steer = kr;
    if (kf > 0) throttle = 1;
    if (kf < 0) brake = 1;
    if (k.has("Space")) handbrake = 1;
    const sample = { forward, right, run, lookYaw: this.lookYaw, lookPitch: this.lookPitch, steer, throttle, brake, handbrake, horn, looking: this.looked || this.looks.size > 0 };
    this.lookYaw = this.lookPitch = 0;
    this.looked = false;
    return sample;
  }

  dispose(): void {
    this.cleanup.forEach((f) => f());
  }
}
