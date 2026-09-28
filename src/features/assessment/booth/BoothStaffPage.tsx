/**
 * S55 Booth staff mode (/?booth=1), stub. The booth stream builds the code form: POST
 * /api/booth/verify (api.boothVerify), then saveBoothCode (../boothMode.ts) keeps the code in
 * sessionStorage for this tab only (contract v3 I).
 */
import type { Lang } from "../../../app/i18n";
import { t } from "../../../i18n";
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
  return (
    <CheckRoot ui={{ lang, onLanguage, booth: true, screenKey: "S55" }}>
      <ScreenStubView id="S55" title={t(lang, "assessment.booth.title")} exit={false} />
    </CheckRoot>
  );
}
