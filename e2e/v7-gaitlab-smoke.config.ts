/**
 * Playwright for the walk lab's real model smoke (D-035 item 4; contract 8.4): the walk lab
 * (/?gaitlab=side|front) on rendered walks at home, with Chromium's fake camera playing each video and
 * the real pose model. On demand, never in CI (it needs the videos and a GPU):
 *
 *   AZM_SMOKE_VIDEOS=/Users/nasser/Development/Azm6.0/local-docs/qa/v7/videos-home \
 *     AZM_SMOKE_PORT=5942 npx playwright test -c e2e/v7-gaitlab-smoke.config.ts
 *
 * It builds the app with VITE_E2E=1 and VITE_V7=1 into a temporary folder and serves it with vite
 * preview on a private port (AZM_SMOKE_PORT, default 5751), as e2e/v7-smoke.config.ts does. The run
 * options are in e2e/v7-gaitlab-smoke.spec.ts.
 */
import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.AZM_SMOKE_PORT ?? 5751);
const RUN = (process.env.AZM_SMOKE_RUN ??= `${Date.now()}-${process.pid}`);
export const SMOKE_TMP = join(tmpdir(), `azm-smoke-${RUN}`);
mkdirSync(SMOKE_TMP, { recursive: true });
const DIST = join(SMOKE_TMP, "dist");
const BASE = process.env.AZM_SMOKE_BASE ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: HERE,
  testMatch: /v7-gaitlab-smoke\.spec\.ts$/,
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
          VITE_V7: "1",
          AZM_DATABASE: join(SMOKE_TMP, "azm.sqlite"),
          AZM_CHECK_HOME: "",
          AZM_BOOTH_CODE: "",
          VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
        },
      },
});
