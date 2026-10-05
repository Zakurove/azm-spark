/** Removes the smoke run's temporary folder: the build, the database and any Y4M left (v7-smoke.config.ts). */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function globalTeardown() {
  const run = process.env.AZM_SMOKE_RUN;
  if (run) rmSync(join(tmpdir(), `azm-smoke-${run}`), { recursive: true, force: true });
}
