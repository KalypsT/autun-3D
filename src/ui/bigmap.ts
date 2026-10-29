import { clampToZone, fitScale, formatDistance, imageMatrix, imagesInView, panBy, pickLevel, screenToWorld, worldToScreen, zoomAt, type MapView } from "../core/mapview";
import { toggleWaypoint, waypointFrom, type Waypoint } from "../core/waypoint";
import type { MapData, Place, StreetInfo } from "./map-data";

/** Carte agrandie (écran de pause, ouvert par un appui sur la minimap) : fond par kilomètre, rues, lieux, joueur et repère. Nord en haut. */

export interface BigMapHooks {
  player(): { x: number; y: number; facing: number };
  waypoint(): Waypoint | null;
  setWaypoint(w: Waypoint | null): void;
  /** Reprendre la partie. */
  resume(): void;
  /** Ouvrir le menu (réglages, lieux notés, apparence, sauvegarde, crédits). */
  menu(): void;
}

const PAPER = "#f2e4c0";
const INK = "#2b2118";
const ACCENT = "#d9472b";
const LONG_PRESS_MS = 520;
/** Un doigt qui bouge de plus que cela (px) n'est plus un appui long ni un tap. */
const MOVE_SLOP = 10;
const PICK_RADIUS = 22;
const STREET_FROM_SCALE = [0.1, 0.18, 0.35, 0.8];
const COMMERCE_FROM_SCALE = 0.45;
/** En dessous de cette échelle (px/m), deux icônes qui se recouvrent ne sont pas dessinées toutes les deux. */
const ICON_OVERLAP_FROM_SCALE = 1.6;
/** Plus la valeur est petite, plus le lieu est important (étiqueté en premier, dessiné au-dessus). */
const PRIORITY: Record<string, number> = { perso: 0, police: 1, hopital: 2, mairie: 3, gare: 4, poste: 5, pharmacie: 6, ecole: 7, monument: 8, culture: 9, culte: 10, parc: 11, parking: 12, commerce: 13 };

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function lineLength(line: readonly number[]): number {
  let l = 0;
  for (let i = 2; i < line.length; i += 2) l += Math.hypot(line[i]! - line[i - 2]!, line[i + 1]! - line[i - 1]!);
  return l;
}

export class BigMap {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);
  private view: MapView = { cx: 0, cy: 0, scale: 0.14, heading: 0, w: 800, h: 400 };
  private opened = false;
  private dirty = false;
  private raf = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private press: { id: number; x: number; y: number; t0: number; done: boolean } | null = null;
  private pinch: { dist: number } | null = null;
  private selected: Place | null = null;
  /** Lieux dessinés à la dernière image, avec leur position à l'écran (pour le tap). */
  private shown: { p: Place; x: number; y: number }[] = [];
  private readonly hidden = new Set<string>();
  private readonly cardEl: HTMLDivElement;
  private readonly chipEl: HTMLDivElement;
  private readonly filterEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly bestLine: Map<StreetInfo, number[]>;
  private readonly byGroup: Map<string, string>;
  private readonly glyph: Map<string, { glyph: string; color: string; label: string }>;
  private readonly places: Place[];

  constructor(private readonly data: MapData, private readonly hooks: BigMapHooks) {
    this.places = [...data.places.places].sort((a, b) => (PRIORITY[a.cat] ?? 99) - (PRIORITY[b.cat] ?? 99));
    this.bestLine = new Map(data.places.streets.map((s) => [s, s.lines.reduce((best, l) => (lineLength(l) > lineLength(best) ? l : best))]));
    this.byGroup = new Map(data.places.categories.map((c) => [c.id, c.group]));
    this.glyph = new Map(data.places.categories.map((c) => [c.id, { glyph: c.glyph, color: c.color, label: c.label }]));

    const el = (this.el = document.createElement("div"));
    el.id = "bigmap";
    el.hidden = true;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
    const button = (cls: string, text: string, title: string, on: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = `bm-btn ${cls}`;
      b.textContent = text;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("click", on);
      return b;
    };
    this.chipEl = document.createElement("div");
    this.chipEl.className = "bm-chip";
    this.cardEl = document.createElement("div");
    this.cardEl.className = "bm-card";
    this.cardEl.hidden = true;
    this.hintEl = document.createElement("div");
    this.hintEl.className = "bm-hint";
    this.hintEl.textContent = "Glisser : déplacer · pincer : zoom · appui long : poser ou retirer un repère";
    const credit = document.createElement("div");
    credit.className = "bm-credit";
    credit.textContent = data.places.attribution;
    this.filterEl = document.createElement("div");
    this.filterEl.className = "bm-filters";
    this.filterEl.hidden = true;
    for (const g of data.places.groups) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      box.addEventListener("change", () => {
        if (box.checked) this.hidden.delete(g.id);
        else this.hidden.add(g.id);
        this.invalidate();
      });
      label.append(box, ` ${g.label}`);
      this.filterEl.append(label);
    }
    el.append(
      this.canvas,
      button("bm-resume", "▶  Reprendre", "Reprendre la partie", () => hooks.resume()),
      button("bm-menu", "☰  Menu", "Menu : réglages, lieux notés, apparence, sauvegarde, crédits", () => hooks.menu()),
      button("bm-filter", "Lieux ▾", "Choisir les lieux affichés", () => { this.filterEl.hidden = !this.filterEl.hidden; }),
      this.filterEl,
      this.chipEl,
      button("bm-here", "◎", "Centrer sur moi", () => this.center()),
      button("bm-zoom-out", "−", "Dézoomer", () => this.zoomBy(1 / 1.6)),
      button("bm-zoom-in", "+", "Zoomer", () => this.zoomBy(1.6)),
      this.cardEl,
      this.hintEl,
      credit,
    );
    document.body.append(el);

    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.down(e));
    c.addEventListener("pointermove", (e) => this.move(e));
    c.addEventListener("pointerup", (e) => this.up(e));
    c.addEventListener("pointercancel", (e) => this.up(e));
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.view = clampToZone(zoomAt(this.view, e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)), this.data.index.zone);
      this.invalidate();
    }, { passive: false });
    window.addEventListener("resize", () => {
      if (this.opened) this.resize();
    });
    data.onImage = () => {
      if (this.opened) this.invalidate();
    };
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
    this.el.hidden = false;
    this.filterEl.hidden = true;
    this.selected = null;
    this.cardEl.hidden = true;
    this.resize();
    const zone = this.data.index.zone;
    const p = this.hooks.player();
    // Vue d'ensemble centrée sur le joueur, au zoom qui montre une bonne part de l'anneau.
    this.view = { ...this.view, scale: Math.max(fitScale(zone, this.view.w, this.view.h) * 2.2, 0.2), cx: p.x, cy: p.y, heading: 0 };
    this.view = clampToZone(this.view, zone);
    this.hintEl.classList.remove("fade");
    void this.hintEl.offsetWidth;
    this.hintEl.classList.add("fade");
    this.syncChip();
    this.invalidate();
  }

  close(): void {
    this.opened = false;
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pointers.clear();
    this.press = null;
    this.pinch = null;
  }

  /** Le repère a changé ailleurs (ou ici) : la pastille et le dessin suivent. */
  syncChip(): void {
    const wp = this.hooks.waypoint();
    this.chipEl.replaceChildren();
    this.chipEl.hidden = !wp;
    if (!wp) return;
    const pl = this.hooks.player();
    const info = waypointFrom(pl.x, pl.y, wp, 0);
    const text = document.createElement("span");
    text.textContent = `📍 Repère à ${formatDistance(info.distance)}`;
    const remove = document.createElement("button");
    remove.textContent = "Retirer";
    remove.addEventListener("click", () => {
      this.hooks.setWaypoint(null);
      this.syncChip();
      this.invalidate();
    });
    this.chipEl.append(text, remove);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.view = { ...this.view, w, h };
  }

  private center(): void {
    const p = this.hooks.player();
    this.view = { ...this.view, cx: p.x, cy: p.y };
    this.invalidate();
  }

  private zoomBy(f: number): void {
    this.view = clampToZone(zoomAt(this.view, this.view.w / 2, this.view.h / 2, f), this.data.index.zone);
    this.invalidate();
  }

  private invalidate(): void {
    this.dirty = true;
    if (!this.raf && this.opened) this.raf = requestAnimationFrame(() => this.frame());
  }

  private frame(): void {
    this.raf = 0;
    if (!this.opened) return;
    this.dirty = false;
    this.draw();
    // Tant qu'un doigt est posé pour un appui long, on redessine pour montrer le cercle qui se remplit.
    if (this.dirty || (this.press && !this.press.done)) this.raf = requestAnimationFrame(() => this.frame());
  }

  // --- Gestes --------------------------------------------------------------------------------------------------------------

  private down(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    this.filterEl.hidden = true;
    if (this.pointers.size === 1) {
      this.press = { id: e.pointerId, x: e.offsetX, y: e.offsetY, t0: performance.now(), done: false };
      this.pinch = null;
      this.invalidate();
    } else {
      // Deuxième doigt : ce n'est plus un appui long.
      this.press = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
    }
  }

  private move(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.offsetX, y: e.offsetY };
    if (this.pointers.size >= 2 && this.pinch) {
      this.pointers.set(e.pointerId, cur);
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mx = (a!.x + b!.x) / 2, my = (a!.y + b!.y) / 2;
      if (this.pinch.dist > 0 && dist > 0) this.view = zoomAt(this.view, mx, my, dist / this.pinch.dist);
      this.pinch.dist = dist;
      this.view = clampToZone(this.view, this.data.index.zone);
      this.invalidate();
      return;
    }
    this.pointers.set(e.pointerId, cur);
    const p = this.press;
    if (p && p.id === e.pointerId && !p.done) {
      if (Math.hypot(cur.x - p.x, cur.y - p.y) < MOVE_SLOP) return;
      this.press = null;
    }
    if (p?.done) return;
    this.view = clampToZone(panBy(this.view, cur.x - prev.x, cur.y - prev.y), this.data.index.zone);
    this.invalidate();
  }

  private up(e: PointerEvent): void {
    const p = this.press;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (p && p.id === e.pointerId) {
      this.press = null;
      // Un doigt posé puis levé sans bouger : un tap, qui sélectionne le lieu le plus proche.
      if (!p.done && Math.hypot(e.offsetX - p.x, e.offsetY - p.y) < MOVE_SLOP) this.tap(e.offsetX, e.offsetY);
      this.invalidate();
    }
  }

  /** Appelé à chaque image tant qu'un appui est en cours : déclenche l'appui long. */
  private checkPress(now: number): void {
    const p = this.press;
    if (!p || p.done || now - p.t0 < LONG_PRESS_MS) return;
    p.done = true;
    const [wx, wy] = screenToWorld(this.view, p.x, p.y);
    this.hooks.setWaypoint(toggleWaypoint(this.hooks.waypoint(), wx, wy, 28 / this.view.scale));
    navigator.vibrate?.(30);
    this.syncChip();
    this.invalidate();
  }

  private tap(sx: number, sy: number): void {
    let best: Place | null = null, bd = PICK_RADIUS;
    for (const { p, x, y } of this.shown) {
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    this.selected = best;
    this.cardEl.replaceChildren();
    this.cardEl.hidden = !best;
    if (!best) return;
    const cat = this.glyph.get(best.cat);
    const pl = this.hooks.player();
    const title = document.createElement("strong");
    title.textContent = `${cat?.glyph ?? "•"} ${best.name}`;
    const sub = document.createElement("span");
    sub.textContent = `${cat?.label ?? best.cat} · à ${formatDistance(Math.hypot(best.x - pl.x, best.y - pl.y))}${best.mhs ? " · monument historique" : ""}`;
    this.cardEl.append(title, sub);
    if (best.note) {
      const note = document.createElement("em");
      note.textContent = best.note;
      this.cardEl.append(note);
    }
    const place = best;
    const mark = document.createElement("button");
    mark.textContent = "Poser le repère ici";
    mark.addEventListener("click", () => {
      this.hooks.setWaypoint({ x: place.x, y: place.y });
      this.syncChip();
      this.invalidate();
    });
    this.cardEl.append(mark);
  }

  private placeVisible(p: Place): boolean {
    const group = this.byGroup.get(p.cat);
    if (group && this.hidden.has(group)) return false;
    const s = this.view.scale;
    if (p.cat === "commerce") return s >= COMMERCE_FROM_SCALE;
    if (p.cat === "parking" || p.cat === "parc") return s >= 0.2;
    return s >= 0.08;
  }

  // --- Dessin -------------------------------------------------------------------------------------------------------------

  private draw(): void {
    const { ctx, view, dpr, data } = this;
    this.checkPress(performance.now());
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, view.w, view.h);
    data.nextFrame();

    // Fond : la vue d'ensemble en dessous (jamais de trou pendant le chargement), puis les kilomètres au niveau voulu.
    const ov = data.overview();
    if (ov) {
      const o = data.index.overview;
      const [a, b, c, d, e, f] = imageMatrix(view, o.x0, o.y1, o.res);
      ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(ov, 0, 0);
    }
    const level = pickLevel(data.index.levels, view.scale, dpr);
    if (level < data.index.overview.res) {
      for (const info of imagesInView(data.index.images, data.index.size, view)) {
        const img = data.image(info, level);
        if (!img) continue;
        const [a, b, c, d, e, f] = imageMatrix(view, info.x0, info.y1, level);
        ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
        ctx.drawImage(img, 0, 0);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const rects: Rect[] = [];
    this.drawStreets(rects);
    this.drawPlaces(rects);
    this.drawWaypoint();
    this.drawPlayer();
    this.drawPress();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private label(text: string, x: number, y: number, size: number, weight = 600): void {
    const { ctx } = this;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "rgba(247, 238, 214, .92)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = INK;
    ctx.fillText(text, x, y);
  }

  private drawStreets(rects: Rect[]): void {
    const { ctx, view } = this;
    const [x0, y0, x1, y1] = [-40, -40, view.w + 40, view.h + 40];
    for (const st of this.data.places.streets) {
      if (view.scale < STREET_FROM_SCALE[st.rank]!) continue;
      const line = this.bestLine.get(st)!;
      const size = st.rank === 0 ? 13 : 11.5;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      const tw = ctx.measureText(st.name).width;
      const pts: [number, number][] = [];
      let on = false;
      for (let i = 0; i < line.length; i += 2) {
        const p = worldToScreen(view, line[i]!, line[i + 1]!);
        pts.push(p);
        if (p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1) on = true;
      }
      if (!on) continue;
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      if (total < tw + 14) continue;
      const at = (s: number): [number, number] => {
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]!, b = pts[i]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (acc + l >= s && l > 0) {
            const t = (s - acc) / l;
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          }
          acc += l;
        }
        return pts[pts.length - 1]!;
      };
      const a = at(total / 2 - tw / 2), b = at(total / 2 + tw / 2);
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (angle > Math.PI / 2) angle -= Math.PI;
      else if (angle < -Math.PI / 2) angle += Math.PI;
      const ca = Math.abs(Math.cos(angle)), sa = Math.abs(Math.sin(angle));
      const hw = (tw * ca + size * sa) / 2 + 2, hh = (tw * sa + size * ca) / 2 + 2;
      const r: Rect = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
      if (r.x1 < 0 || r.x0 > view.w || r.y1 < 0 || r.y0 > view.h || rects.some((o) => overlaps(o, r))) continue;
      rects.push(r);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      this.label(st.name, 0, 0, size);
      ctx.restore();
    }
  }

  private drawPlaces(rects: Rect[]): void {
    const { ctx, view } = this;
    // Les lieux visibles, par ordre d'importance ; en vue d'ensemble, une icône qui en recouvre une plus importante est omise
    // (les centaines de monuments et de commerces du centre-ville formeraient sinon une bouillie).
    const shown: { p: Place; x: number; y: number }[] = [];
    const icons: Rect[] = [];
    for (const p of this.places) {
      if (!this.placeVisible(p)) continue;
      const [x, y] = worldToScreen(view, p.x, p.y);
      if (x < -20 || x > view.w + 20 || y < -20 || y > view.h + 20) continue;
      if (view.scale < ICON_OVERLAP_FROM_SCALE) {
        const r: Rect = { x0: x - 10, y0: y - 10, x1: x + 10, y1: y + 10 };
        if (icons.some((o) => overlaps(o, r))) continue;
        icons.push(r);
      }
      shown.push({ p, x, y });
    }
    this.shown = shown;
    // Les icônes les plus importantes sont dessinées en dernier (au-dessus) ; leurs noms sont placés en premier.
    const labels: { text: string; x: number; y: number; w: number }[] = [];
    for (const { p, x, y } of shown) {
      if (view.scale < 0.25 || (p.cat === "commerce" && view.scale < 0.7)) continue;
      ctx.font = "600 11px system-ui, sans-serif";
      const w = ctx.measureText(p.name).width;
      const r: Rect = { x0: x - w / 2 - 2, y0: y + 10, x1: x + w / 2 + 2, y1: y + 24 };
      const icon: Rect = { x0: x - 11, y0: y - 11, x1: x + 11, y1: y + 11 };
      if (rects.some((o) => overlaps(o, r))) {
        rects.push(icon);
        continue;
      }
      rects.push(r, icon);
      labels.push({ text: p.name, x, y: y + 17, w });
    }
    for (let i = shown.length - 1; i >= 0; i--) {
      const { p, x, y } = shown[i]!;
      const cat = this.glyph.get(p.cat);
      const r = p.cat === "commerce" ? 8 : 11;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#fff8e6";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = cat?.color ?? INK;
      ctx.stroke();
      ctx.font = `${p.cat === "commerce" ? 10 : 13}px system-ui, "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = INK;
      ctx.fillText(cat?.glyph ?? "•", x, y + 1);
      if (this.selected === p) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = ACCENT;
        ctx.stroke();
      }
    }
    for (const l of labels) this.label(l.text, l.x, l.y, 11);
  }

  private drawWaypoint(): void {
    const wp = this.hooks.waypoint();
    if (!wp) return;
    const { ctx, view } = this;
    const [x, y] = worldToScreen(view, wp.x, wp.y);
    ctx.fillStyle = ACCENT;
    ctx.strokeStyle = "#fff8e6";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 8, y - 14);
    ctx.lineTo(x + 8, y - 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 20, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 20, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#fff8e6";
    ctx.fill();
  }

  private drawPlayer(): void {
    const { ctx, view } = this;
    const p = this.hooks.player();
    const [x, y] = worldToScreen(view, p.x, p.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.facing - view.heading);
    ctx.fillStyle = "#1f4a63";
    ctx.strokeStyle = "#fff8e6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8.5, 9);
    ctx.lineTo(0, 4.5);
    ctx.lineTo(-8.5, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawPress(): void {
    const p = this.press;
    if (!p || p.done) return;
    const { ctx } = this;
    const t = Math.min((performance.now() - p.t0) / LONG_PRESS_MS, 1);
    if (t < 0.2) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 30, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = ACCENT;
    ctx.lineCap = "round";
    ctx.stroke();
  }
}
