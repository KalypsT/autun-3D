import { MemoryBackend, type NotesBackend } from "../core/notes-store";
import type { PlaceNote } from "../core/notes";

const DB_NAME = "autun3d";
const DB_VERSION = 1;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Notes et captures dans IndexedDB : le stockage local (≈ 5 Mo) ne suffirait pas pour des captures. */
class IdbBackend implements NotesBackend {
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<PlaceNote[]> {
    return request(this.db.transaction("notes").objectStore("notes").getAll() as IDBRequest<PlaceNote[]>);
  }

  async put(note: PlaceNote, shot: Blob | null): Promise<void> {
    const tx = this.db.transaction(["notes", "shots"], "readwrite");
    tx.objectStore("notes").put(note);
    if (shot) tx.objectStore("shots").put(shot, note.id);
    await done(tx);
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction(["notes", "shots"], "readwrite");
    tx.objectStore("notes").delete(id);
    tx.objectStore("shots").delete(id);
    await done(tx);
  }

  async shot(id: string): Promise<Blob | null> {
    return ((await request(this.db.transaction("shots").objectStore("shots").get(id))) as Blob | undefined) ?? null;
  }
}

/** IndexedDB si le navigateur l'autorise, sinon la mémoire (les notes durent alors jusqu'au rechargement). */
export async function openNotesBackend(): Promise<{ backend: NotesBackend; persistent: boolean }> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("pas d'IndexedDB");
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("shots")) db.createObjectStore("shots");
    };
    return { backend: new IdbBackend(await request(open)), persistent: true };
  } catch {
    return { backend: new MemoryBackend(), persistent: false };
  }
}
