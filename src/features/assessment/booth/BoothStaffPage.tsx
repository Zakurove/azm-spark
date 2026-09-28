/**
 * S55 Booth staff mode (/?booth=1), stub. The booth stream builds the code form: POST
 * /api/booth/verify (api.boothVerify), then saveBoothCode (../boothMode.ts) keeps the code in
 * sessionStorage for this tab only (contract v3 I), and the page sets `booth` again so the badge shows.
 *
 * The booth badge tells staff the device's mode at a glance (S57), so it shows only once this tab is
 * in verified booth mode, never before a code is verified. No Sound: nothing plays on this page.
 */
import { useState } from "react";
import type { Lang } from "../../../app/i18n";
import { t } from "../../../i18n";
import { isBoothMode } from "../boothMode";
import { CheckRoot } from "../shared/CheckRoot";
import { ScreenStubView } from "../shared/ScreenStub";

export interface BoothStaffPageProps {
  lang: Lang;
  onLanguage(): void;
  /** Leaves staff mode for the landing. */
  onExit(): void;
  /** Opens the visitor check (/?check=1) once booth mode is on. */
  onOpenGuest(): void;
}

export function BoothStaffPage({ lang, onLanguage }: BoothStaffPageProps) {
  // Read when the page opens. The code form (booth stream) adds the setter: after a successful verify
  // and saveBoothCode, it sets booth to isBoothMode() so the badge appears.
  const [booth] = useState(isBoothMode);
  return (
    <CheckRoot ui={{ lang, onLanguage, booth, screenKey: "S55" }}>
      <ScreenStubView id="S55" title={t(lang, "assessment.booth.title")} exit={false} />
    </CheckRoot>
  );
}
