import { newNoteId, type PlaceNote } from "./notes";

/** Où les notes et leurs captures sont gardées (IndexedDB dans le navigateur, mémoire en secours et pour les tests). */
export interface NotesBackend {
  list(): Promise<PlaceNote[]>;
  put(note: PlaceNote, shot: Blob | null): Promise<void>;
  remove(id: string): Promise<void>;
  shot(id: string): Promise<Blob | null>;
}

export class MemoryBackend implements NotesBackend {
  private readonly notes = new Map<string, PlaceNote>();
  private readonly shots = new Map<string, Blob>();
  list = (): Promise<PlaceNote[]> => Promise.resolve([...this.notes.values()]);
  put(note: PlaceNote, shot: Blob | null): Promise<void> {
    this.notes.set(note.id, note);
    if (shot) this.shots.set(note.id, shot);
    return Promise.resolve();
  }
  remove(id: string): Promise<void> {
    this.notes.delete(id);
    this.shots.delete(id);
    return Promise.resolve();
  }
  shot = (id: string): Promise<Blob | null> => Promise.resolve(this.shots.get(id) ?? null);
}

/** Liste des notes (la plus récente en premier) au-dessus d'un support de stockage. */
export class NotesStore {
  notes: PlaceNote[] = [];

  constructor(private readonly backend: NotesBackend) {}

  async load(): Promise<PlaceNote[]> {
    try {
      this.notes = (await this.backend.list()).sort((a, b) => b.time - a.time);
    } catch {
      this.notes = [];
    }
    return this.notes;
  }

  /** Enregistre une note ; renvoie false si le stockage refuse (la note reste alors seulement en mémoire jusqu'au rechargement). */
  async add(fields: Omit<PlaceNote, "id" | "time" | "hasShot">, shot: Blob | null, time = Date.now()): Promise<boolean> {
    const note: PlaceNote = { ...fields, id: newNoteId(time, this.notes), time, hasShot: shot !== null };
    this.notes.unshift(note);
    try {
      await this.backend.put(note, shot);
      return true;
    } catch {
      return false;
    }
  }

  async remove(id: string): Promise<void> {
    this.notes = this.notes.filter((n) => n.id !== id);
    try {
      await this.backend.remove(id);
    } catch {
      /* la note a disparu de la liste ; le stockage sera nettoyé plus tard */
    }
  }

  async shot(id: string): Promise<Blob | null> {
    try {
      return await this.backend.shot(id);
    } catch {
      return null;
    }
  }

  /** Captures de toutes les notes en URL de données (pour l'export complet). */
  async shotUrls(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const n of this.notes) {
      if (!n.hasShot) continue;
      const blob = await this.shot(n.id);
      if (blob) out.set(n.id, await blobToDataUrl(blob));
    }
    return out;
  }
}

/** Contenu d'un blob en URL de données base64 (par morceaux : pas de spread sur de grands tableaux). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
}
