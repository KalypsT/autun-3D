import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/** Version affichée dans le rapport du banc de test : commit et date de construction. */
function buildId(): string {
  let commit = "local";
  try {
    commit = execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    /* pas de dépôt git */
  }
  return `${commit} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
}

// Chemins relatifs : le jeu se sert depuis https://<compte>.github.io/<dépôt>/.
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
  define: { __BUILD__: JSON.stringify(buildId()) },
});
