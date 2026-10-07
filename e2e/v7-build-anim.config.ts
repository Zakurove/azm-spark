/**
 * Playwright for the program build animation (D-032 item 4) on a VITE_V7=1 build, where
 * /?programBuild=preview shows it alone:
 *
 *   npx playwright test -c e2e/v7-build-anim.config.ts
 *   AZM_SHOTS_DIR=<dir> npx playwright test -c e2e/v7-build-anim.config.ts       also the screenshots
 *   AZM_SHOTS_DIR=<dir> AZM_SHOTS_VIDEO=1 npx playwright test -c ...              and the videos
 *
 * It builds the app into a temporary folder and serves it with vite preview on a private port
 * (AZM_ANIM_PORT, default 5891), so it never touches the dev server's dependency cache, which the
 * worktrees share through node_modules. The database is a throwaway in the same folder (the preview
 * calls no API). The main e2e config skips e2e/v7-build-anim.spec.ts: its server has no VITE_V7.
 */
import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.AZM_ANIM_PORT ?? 5891);
/** One folder per run, set once in the main process and inherited by the worker (as the e2e config). */
const RUN = (process.env.AZM_ANIM_RUN ??= `${Date.now()}-${process.pid}`);
export const ANIM_TMP = join(tmpdir(), `azm-build-anim-${RUN}`);
mkdirSync(ANIM_TMP, { recursive: true });
const DIST = join(ANIM_TMP, "dist");
/** Tells the spec it runs on this config's VITE_V7=1 build. */
process.env.AZM_BUILD_ANIM_E2E = "1";

export default defineConfig({
  testDir: HERE,
  testMatch: /v7-build-anim\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  outputDir: join(ANIM_TMP, "results"),
  globalTeardown: join(HERE, "v7-build-anim-teardown.ts"),
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  webServer: {
    command:
      `npx vite build --outDir "${DIST}" --emptyOutDir --logLevel warn && ` +
      `npx vite preview --outDir "${DIST}" --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      VITE_V7: "1",
      AZM_DATABASE: join(ANIM_TMP, "azm.sqlite"),
      AZM_CHECK_HOME: "",
      AZM_BOOTH_CODE: "",
      VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
    },
  },
});
