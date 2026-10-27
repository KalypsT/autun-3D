/** « Noter ce lieu » : signaler une erreur de carte (« à cet endroit, ce n'est pas comme ça en vrai »). Les captures sont stockées à part. */

import { compassName } from "./mapview";

export interface PlaceNote {
  id: string;
  /** Date (ms depuis 1970). */
  time: number;
  /** Position (repère local, m) et direction regardée (rad, 0 = nord, sens horaire). */
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Heure et jour du jeu. */
  hour: number;
  day: number;
  text: string;
  /** Une capture est enregistrée avec la note. */
  hasShot: boolean;
}

export function clockText(hour: number): string {
  const h = Math.floor(hour) % 24, m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function newNoteId(time: number, existing: readonly PlaceNote[]): string {
  let id = `n${time.toString(36)}`;
  for (let k = 2; existing.some((n) => n.id === id); k++) id = `n${time.toString(36)}-${k}`;
  return id;
}

/** Une ligne lisible par note : position, direction, heure du jeu, texte. */
export function noteLine(n: PlaceNote, index: number): string {
  const text = n.text.trim() || "(sans texte)";
  return `${index + 1}. x ${n.x.toFixed(0)}, y ${n.y.toFixed(0)}, face au ${compassName(n.heading)}, ${clockText(n.hour)} : ${text}`;
}

/** Rapport texte (à coller dans une conversation) : une ligne par note, sans les captures. */
export function notesText(notes: readonly PlaceNote[], version: string): string {
  const head = `Lieux notés (${notes.length}) — Autun 3D ${version}`;
  return [head, ...notes.map(noteLine)].join("\n");
}

export interface NotesExport {
  format: "autun3d-notes";
  version: 1;
  game: string;
  exportedAt: string;
  notes: (PlaceNote & { screenshot?: string })[];
}

/** Export JSON complet ; `shots` donne la capture (URL de données) d'une note si elle existe. */
export function notesExport(notes: readonly PlaceNote[], version: string, shots: ReadonlyMap<string, string>, now = new Date()): NotesExport {
  return {
    format: "autun3d-notes",
    version: 1,
    game: version,
    exportedAt: now.toISOString(),
    notes: notes.map((n) => {
      const screenshot = shots.get(n.id);
      return screenshot ? { ...n, screenshot } : { ...n };
    }),
  };
}

/** Notes lues d'un JSON (stockage ou fichier) : les entrées incomplètes sont écartées. */
export function parseNotes(raw: unknown): PlaceNote[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaceNote[] = [];
  for (const n of raw as Record<string, unknown>[]) {
    if (!n || typeof n["id"] !== "string" || typeof n["text"] !== "string") continue;
    const nums = ["time", "x", "y", "z", "heading", "hour", "day"].map((k) => n[k]);
    if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    out.push({
      id: n["id"], time: n["time"] as number, x: n["x"] as number, y: n["y"] as number, z: n["z"] as number, heading: n["heading"] as number,
      hour: n["hour"] as number, day: n["day"] as number, text: n["text"], hasShot: n["hasShot"] === true,
    });
  }
  return out;
}
