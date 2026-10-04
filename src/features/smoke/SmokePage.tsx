/**
 * The real model smoke page (product v7 contract 8.4, stream G, step G1): on a VITE_E2E=1 build,
 * /?e2eSmoke=<name> runs the real CameraPoseSource and the real runners on the camera that
 * Playwright's Chromium fakes from a recorded video (--use-file-for-fake-video-capture), and gives
 * the results as JSON to the harness, which summarises them in local-docs/qa/v7/smoke-<date>.md. Any
 * other option of a run (the pose model, for example) is read from the page's own URL.
 *
 * Placeholder of step A6 (contract 1.3), replaced by G1: it renders nothing. src/app/App.tsx opens it
 * in a VITE_E2E=1 build only, so a default build has no chunk for it.
 */
import type { Lang } from "../../app/i18n";

export interface SmokePageProps {
  /** The run: the value of ?e2eSmoke=<name>, named by G's harness. */
  name: string;
  lang: Lang;
  onLanguage(): void;
}

export default function SmokePage(_props: SmokePageProps): null {
  return null;
}
