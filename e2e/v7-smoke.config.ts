/**
 * Playwright for the v7 real model smoke (product v7 contract 8.4, stream G, step G1): on demand and
 * before every staging deploy, never in CI (it needs the videos and a GPU).
 *
 *   AZM_SMOKE_VIDEOS=/Users/nasser/Development/Azm6.0/local-docs/qa/v7/videos \
 *     npx playwright test -c e2e/v7-smoke.config.ts
 *
 * It builds the app with VITE_E2E=1 into a temporary folder and serves that build with vite preview on
 * a private port (AZM_SMOKE_PORT, default 5750), so the smoke measures the production bundle and never
 * touches the dev server's dependency cache, which the worktrees share through node_modules.
 * AZM_SMOKE_BASE=<url> uses a server that is already running instead. The database is a throwaway in
 * the same folder (the smoke page calls no API; the app shell may). The run options are in
 * e2e/v7-model-smoke.spec.ts.
 */
import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.AZM_SMOKE_PORT ?? 5750);
/** One folder per run, set once in the main process and inherited by the worker (as the e2e config). */
const RUN = (process.env.AZM_SMOKE_RUN ??= `${Date.now()}-${process.pid}`);
export const SMOKE_TMP = join(tmpdir(), `azm-smoke-${RUN}`);
mkdirSync(SMOKE_TMP, { recursive: true });
const DIST = join(SMOKE_TMP, "dist");
const BASE = process.env.AZM_SMOKE_BASE ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: HERE,
  testMatch: /v7-model-smoke\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [["list"]],
  outputDir: join(SMOKE_TMP, "results"),
  globalTeardown: join(HERE, "v7-smoke-teardown.ts"),
  use: { baseURL: BASE, trace: "off" },
  webServer: process.env.AZM_SMOKE_BASE
    ? undefined
    : {
        command:
          `npx vite build --outDir "${DIST}" --emptyOutDir --logLevel warn && ` +
          `npx vite preview --outDir "${DIST}" --port ${PORT} --strictPort --host 127.0.0.1`,
        cwd: ROOT,
        url: BASE,
        reuseExistingServer: false,
        timeout: 240_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          VITE_E2E: "1",
          AZM_DATABASE: join(SMOKE_TMP, "azm.sqlite"),
          AZM_CHECK_HOME: "",
          AZM_BOOTH_CODE: "",
          VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
        },
      },
});
