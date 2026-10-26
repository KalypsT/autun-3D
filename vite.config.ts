import { defineConfig } from "vite";

// Chemins relatifs : le jeu se sert depuis https://<compte>.github.io/<dépôt>/.
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
