/**
 * Playwright for the movement check (contract v3 K and L): runs `npm run dev` with VITE_E2E=1 (the
 * FixturePoseSource and the foundation gallery exist only in that build) against a throwaway
 * AZM_DATABASE in a fresh temporary folder, on a private port, never the dev database.
 *
 *   npm run e2e                         the specs in e2e/
 *   AZM_SHOTS_DIR=<dir> npm run e2e     also writes the review screenshots (e2e/*-shots.spec.ts)
 */
import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.AZM_E2E_PORT ?? 5299);
const ROOT = join(HERE, "..");
/**
 * A fresh throwaway folder per run. The run id is set once in the main process and inherited by the
 * workers, so every process agrees on the path; e2e/global-teardown.ts removes the folder.
 */
const RUN = (process.env.AZM_E2E_RUN ??= `${Date.now()}-${process.pid}`);
export const E2E_DATA = join(tmpdir(), `azm-e2e-${RUN}`);
mkdirSync(E2E_DATA, { recursive: true });

export default defineConfig({
  testDir: HERE,
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  // Traces and failure screenshots stay in the run's temporary folder, out of the repo.
  outputDir: join(E2E_DATA, "results"),
  globalTeardown: join(HERE, "global-teardown.ts"),
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 90_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      VITE_E2E: "1",
      AZM_DATABASE: join(E2E_DATA, "azm.sqlite"),
      AZM_CHECK_HOME: "",
      AZM_BOOTH_CODE: "",
      VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
