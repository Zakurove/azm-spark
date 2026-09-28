/** Removes the run's throwaway database folder (see playwright.config.ts). */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function globalTeardown() {
  const run = process.env.AZM_E2E_RUN;
  if (run) rmSync(join(tmpdir(), `azm-e2e-${run}`), { recursive: true, force: true });
}
