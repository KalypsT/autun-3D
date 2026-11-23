import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_VERSION, IMMUTABLE_DIR, immutableUrl, PUBLIC_DATA, PUBLIC_DECALS } from "./data-version";
import { dataUrl } from "./load";

/** Même calcul que tools/data/data_version.py : SHA-256 des lignes « <sha256 du fichier>  <chemin> » triées par chemin, 12 caractères. */
function fingerprint(folder: string): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) files.push(path);
    }
  };
  walk(folder);
  const lines = files
    .map((path) => [relative(folder, path).split(sep).join("/"), createHash("sha256").update(readFileSync(path)).digest("hex")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.map(([rel, digest]) => `${digest}  ${rel}\n`).join("")).digest("hex").slice(0, 12);
}

describe("version des données lourdes (D305, contrat DomoThib §6)", () => {
  it("une seule constante : l'empreinte écrite par tools/data/data_version.py, qui nomme le seul dossier de public/immuable", () => {
    expect(DATA_VERSION).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.parse(readFileSync("src/data/data-version.json", "utf8"))).toEqual({ version: DATA_VERSION });
    expect(readdirSync("public/immuable")).toEqual([DATA_VERSION]);
    expect(readdirSync(`public/${IMMUTABLE_DIR}`).sort()).toEqual(["data", "decals"]);
    expect(PUBLIC_DATA).toBe(`public/immuable/${DATA_VERSION}/data`);
    expect(PUBLIC_DECALS).toBe(`public/immuable/${DATA_VERSION}/decals`);
  });

  it("la version change avec le contenu : elle est égale à l'empreinte des fichiers (sinon : python3 tools/data/data_version.py)", () => {
    expect(fingerprint(`public/immuable/${DATA_VERSION}`), "données régénérées sans nouvelle version : lancer python3 tools/data/data_version.py").toBe(DATA_VERSION);
  });

  it("le jeu construit toutes ses adresses de données depuis cette version, quelle que soit la base du build", () => {
    expect(immutableUrl("./", "data/world.json")).toBe(`./immuable/${DATA_VERSION}/data/world.json`);
    expect(immutableUrl("/autun-3d/", "decals/fresque.png")).toBe(`/autun-3d/immuable/${DATA_VERSION}/decals/fresque.png`);
    expect(dataUrl("map/index.json")).toBe(`/immuable/${DATA_VERSION}/data/map/index.json`);
  });

  it("rien d'autre dans public/ que les données versionnées, le manifeste DomoThib et la jaquette", () => {
    expect(readdirSync("public").filter((n) => !["immuable", "domothib.json", "jaquette.webp"].includes(n))).toEqual([]);
  });

  it("tools/data/data_version.py lit le même fichier et calcule la même empreinte ; la chaîne de données écrit dans ce dossier", () => {
    expect(execFileSync("python3", ["tools/data/data_version.py", "--check"], { encoding: "utf8" })).toContain(`données à jour : ${DATA_VERSION}`);
    expect(readFileSync("tools/data/config.py", "utf8")).toContain("from data_version import DATA as PUBLISHED_DATA");
  });
});
