/**
 * Playwright for the v7 flow of D-032 (the tests come before the program): the dev server with the v7
 * flags on (VITE_V7=1 for the client, AZM_V7=1 for the server) and VITE_E2E=1 (the simulated person and
 * the page hooks), against a throwaway AZM_DATABASE in a fresh temporary folder, on a private port. Home
 * is open for v7, so no booth code is set.
 *
 *   AZM_E2E_PORT=<port> npx playwright test -c e2e/v7-flow.config.ts      (npm run e2e:v7)
 *
 * The specs it runs (e2e/v7-flow.spec.ts, e2e/v7-form.spec.ts for the health form of D-034 item 5,
 * e2e/v7-gait.spec.ts for the walk at home and its lab of D-035, and e2e/v7-coach-lab.spec.ts for the coach's connection test of D-035 item 4) skip themselves under the
 * default config (e2e/playwright.config.ts), whose server has the flags off. The connection test runs
 * twice: in Chromium with its fake microphone and camera, and in Playwright's WebKit as an iPhone (the
 * closest proxy to iPhone Safari: it has navigator.audioSession and its capture rules).
 */
import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.AZM_E2E_PORT ?? 5299);
const ROOT = join(HERE, "..");
/** The specs read it to run (set here, inherited by the workers). */
process.env.AZM_E2E_V7 = "1";
/** A fresh throwaway folder per run, removed by e2e/global-teardown.ts (as the default config). */
const RUN = (process.env.AZM_E2E_RUN ??= `${Date.now()}-${process.pid}`);
export const E2E_DATA = join(tmpdir(), `azm-e2e-${RUN}`);
mkdirSync(E2E_DATA, { recursive: true });

export default defineConfig({
  testDir: HERE,
  testMatch: /v7-(flow|form|gait|coach-lab|romlab)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
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
      VITE_V7: "1",
      AZM_V7: "1",
      AZM_DATABASE: join(E2E_DATA, "azm.sqlite"),
      AZM_CHECK_HOME: "",
      AZM_BOOTH_CODE: "",
      VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
    },
  },
  projects: [
    { name: "chromium", testIgnore: /v7-coach-lab\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "lab-chromium",
      testMatch: /v7-coach-lab\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["microphone", "camera"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    {
      name: "lab-webkit",
      testMatch: /v7-coach-lab\.spec\.ts$/,
      use: { ...devices["iPhone 13"], permissions: ["microphone", "camera"] },
    },
  ],
});
