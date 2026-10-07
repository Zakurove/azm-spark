/** Removes the build animation run's temporary folder (see v7-build-anim.config.ts). */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function globalTeardown() {
  const run = process.env.AZM_ANIM_RUN;
  if (run) rmSync(join(tmpdir(), `azm-build-anim-${run}`), { recursive: true, force: true });
}
