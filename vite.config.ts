import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApi } from "./server/api";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { v7Landing } from "./scripts/v7-landing-plugin";

const CHECK_DATA = fileURLToPath(new URL("./src/movements/check-v1.json", import.meta.url));
const VOICE_PACKS = fileURLToPath(new URL("./public/cues/packs/index.json", import.meta.url));

/** A virtual module whose default export is `pick` of a JSON file, rebuilt when the file changes. */
function jsonModule(id: string, file: string, pick: (data: unknown) => unknown = (data) => data): Plugin {
  return {
    name: `azm-${id}`,
    resolveId: (source) => (source === id ? "\0" + id : null),
    load(source) {
      if (source !== "\0" + id) return null;
      this.addWatchFile(file);
      return `export default ${JSON.stringify(pick(JSON.parse(readFileSync(file, "utf8"))))};`;
    },
  };
}

/**
 * virtual:check-unit-forms: the check data's unit forms (progress.unitForms) on their own. The copy
 * accessor (src/i18n/index.ts) needs them on the landing; importing them from check-v1.json would put
 * the whole 270 KB check data in the landing's first script (acceptance F-4). The data file stays the
 * one source.
 */
const checkUnitForms = () =>
  jsonModule(
    "virtual:check-unit-forms",
    CHECK_DATA,
    (data) => (data as { progress: { unitForms: unknown } }).progress.unitForms,
  );

/**
 * virtual:voice-packs: public/cues/packs/index.json, the installed voice packs (src/app/voicePacks.ts).
 * The file stays in public beside the packs, where scripts/generate-voice.mjs writes it; Vite does not
 * let a script import a file from public directly.
 */
const voicePacks = () => jsonModule("virtual:voice-packs", VOICE_PACKS);

export default defineConfig({
  plugins: [
    v7Landing(),
    react(),
    checkUnitForms(),
    voicePacks(),
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
