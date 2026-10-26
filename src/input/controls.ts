/** Commandes : joystick flottant à gauche, regard en glissant à droite, clavier et souris. */

export interface ControlSample {
  forward: number;
  right: number;
  run: boolean;
  /** Rotation demandée depuis le dernier appel, en radians (droite = lacet +, bas = tangage +). */
  lookYaw: number;
  lookPitch: number;
}

const STICK_RADIUS = 58;
const DEAD_ZONE = 0.12;
const RUN_THRESHOLD = 0.85;
const TOUCH_LOOK = 0.0048;
const MOUSE_LOOK = 0.0032;

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
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly base: HTMLElement,
    private readonly knob: HTMLElement,
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
    const k = look.mouse ? MOUSE_LOOK : TOUCH_LOOK;
    this.lookYaw += (e.clientX - look.x) * k;
    this.lookPitch += (e.clientY - look.y) * k;
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
    const sample = { forward, right, run, lookYaw: this.lookYaw, lookPitch: this.lookPitch };
    this.lookYaw = this.lookPitch = 0;
    return sample;
  }

  dispose(): void {
    this.cleanup.forEach((f) => f());
  }
}
