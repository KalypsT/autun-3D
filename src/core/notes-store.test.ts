import { describe, expect, it } from "vitest";
import { MemoryBackend, NotesStore, type NotesBackend } from "./notes-store";

const fields = { x: 1, y: 2, z: 3, heading: 0, hour: 12, day: 200, text: "t" };

describe("NotesStore", () => {
  it("ajoute, relit (plus récente d'abord) et supprime avec la capture", async () => {
    const backend = new MemoryBackend();
    const store = new NotesStore(backend);
    expect(await store.add(fields, new Blob(["jpg"]), 100)).toBe(true);
    await store.add({ ...fields, text: "u" }, null, 200);
    const again = new NotesStore(backend);
    expect((await again.load()).map((n) => n.text)).toEqual(["u", "t"]);
    expect(again.notes[1]!.hasShot).toBe(true);
    expect(await (await again.shot(again.notes[1]!.id))!.text()).toBe("jpg");
    await again.remove(again.notes[1]!.id);
    expect((await new NotesStore(backend).load()).map((n) => n.text)).toEqual(["u"]);
  });

  it("un support qui échoue ne casse rien : la note reste en mémoire, l'écriture dit qu'elle a échoué", async () => {
    const broken: NotesBackend = {
      list: () => Promise.reject(new Error("x")),
      put: () => Promise.reject(new Error("quota")),
      remove: () => Promise.reject(new Error("x")),
      shot: () => Promise.reject(new Error("x")),
    };
    const store = new NotesStore(broken);
    expect(await store.load()).toEqual([]);
    expect(await store.add(fields, null)).toBe(false);
    expect(store.notes).toHaveLength(1);
    expect(await store.shot("a")).toBeNull();
    await store.remove(store.notes[0]!.id);
    expect(store.notes).toHaveLength(0);
  });

  it("export des captures en URL de données", async () => {
    const store = new NotesStore(new MemoryBackend());
    await store.add(fields, new Blob(["abc"], { type: "image/jpeg" }), 1);
    const urls = await store.shotUrls();
    expect(urls.get(store.notes[0]!.id)).toBe("data:image/jpeg;base64,YWJj");
  });
});
