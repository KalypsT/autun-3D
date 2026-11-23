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

/** Identifiant du jeu dans DomoThib Games : son dossier sur l'hôte des jeux (contrat, docs/domothib.md §2). */
const DOMOTHIB_ID = "autun-3d";

// Deux builds (D305) :
// - `vite build` : GitHub Pages, chemins relatifs (le jeu se sert depuis https://<compte>.github.io/<dépôt>/) ;
// - `vite build --mode domothib` : DomoThib Games, servi sous https://games.loragif.fr/autun-3d/ ; le code lit le mode
//   (`import.meta.env.MODE`, src/domothib/host.ts) pour se connecter au pont.
export default defineConfig(({ mode }) => ({
  base: mode === "domothib" ? `/${DOMOTHIB_ID}/` : "./",
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
  define: { __BUILD__: JSON.stringify(buildId()) },
}));
