/**
 * Which source files are v7 only (product v7 contract 1.2, C-9, 8.8), for the shell and bundle tests
 * of step A6 (tests/v7/a-shell.test.ts, tests/v7/a-bundle.test.ts).
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The v7 modules, by their path from the repository root: what only a VITE_V7 build may load. Shared
 * on purpose, and so not listed: src/app/v7flag.ts (the build constant the landing may read),
 * src/medical/body-map.ts (validateIntake checks the v7 fields in every build, contract 2.2) and
 * src/medical/contraindications.ts (libraryPool applies the v7 contraindications in every build,
 * contract 2.10 rule 2; it reads no v7 data).
 */
export const V7_ONLY =
  /^src\/(features\/(focus|gait|coach-agent|program-v7|showcase|body-map|onboarding)\/|coach\/|engine\/(rom|gait|signal)\/|movements\/(rom|gait|targets)\/|medical\/(rom-|gait-|target|focus-|pain-rule|body-map-autofill)|i18n\/v7\.ts|i18n\/(ar|en)\/(intake7|rom|gait|coach|targets|showcase)\.json|app\/IntakeV7\.tsx)/;

/** The E2E only modules of v7 (stream G): the smoke page and the performance overlay. */
export const E2E_ONLY = /^src\/features\/smoke\//;

/** Every file under a folder. */
export function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}
