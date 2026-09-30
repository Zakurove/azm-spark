import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApi } from "./server/api";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const CHECK_DATA = fileURLToPath(new URL("./src/movements/check-v1.json", import.meta.url));

/**
 * virtual:check-unit-forms: the check data's unit forms (progress.unitForms) on their own. The copy
 * accessor (src/i18n/index.ts) needs them on the landing; importing them from check-v1.json would put
 * the whole 270 KB check data in the landing's first script (acceptance F-4). The data file stays the
 * one source.
 */
function checkUnitForms(): Plugin {
  const id = "virtual:check-unit-forms";
  return {
    name: "azm-check-unit-forms",
    resolveId: (source) => (source === id ? "\0" + id : null),
    load(source) {
      if (source !== "\0" + id) return null;
      this.addWatchFile(CHECK_DATA);
      const data = JSON.parse(readFileSync(CHECK_DATA, "utf8")) as { progress: { unitForms: unknown } };
      return `export default ${JSON.stringify(data.progress.unitForms)};`;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    checkUnitForms(),
    {
      name: "azm-api",
      configureServer(server: any) {
        const api = createApi();
        server.middlewares.use(api.handle);
        server.httpServer?.once("close", api.close);
      },
      configurePreviewServer(server: any) {
        const api = createApi();
        server.middlewares.use(api.handle);
        server.httpServer?.once("close", api.close);
      },
    },
  ],
  build: { target: "es2022" },
  // vitest
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
} as never);
