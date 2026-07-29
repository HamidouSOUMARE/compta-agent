import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Le dashboard lit data/output/ecritures.json à la racine du repo : on autorise
// Vite à servir/importer des fichiers hors du dossier dashboard/.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [resolve(__dirname, "..")] },
    port: 5173,
  },
});
