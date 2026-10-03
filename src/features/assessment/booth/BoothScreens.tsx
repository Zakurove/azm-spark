/**
 * The booth screens as the check's screen registry holds them (screens.ts reads BOOTH_SCREENS). None
 * has a flow state; each is reached outside the flow:
 *   S55   the staff page /?booth=check (BoothStaffPage, rendered by App; parked since booth v2,
 *         where /?booth=1 is the booth journey)
 *   S57   the booth tools over every screen (BoothLayer, NewVisitorButton, StaffCountCorrection)
 *   S58   the setup tips, opened in place by the camera and results screens (SetupTipsView)
 * so their registry entries are thin screens over the same parts, never a second design.
 */
import { t } from "../../../i18n";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { startNextVisitor } from "./BoothLayer";
import "./booth.css";

/** S55 inside the check: the way to the staff page (the code is typed only there). */
export function StaffEntryScreen(_: ScreenProps) {
  const { lang } = useCheckUi();
  return (
    <CheckShell exit={false}>
      <div className="booth-screen" data-screen="S55">
        <h1>{t(lang, "assessment.booth.title")}</h1>
        <button
          type="button"
          className="cta"
          onClick={() => location.replace(lang === "en" ? "/?booth=check&lang=en" : "/?booth=check")}
        >
          {t(lang, "assessment.booth.turnOn")}
        </button>
      </div>
    </CheckShell>
  );
}

/** S57 inside the check: the confirm to start for the next visitor. */
export function NewVisitorScreen({ model, dispatch }: ScreenProps) {
  const { lang, online } = useCheckUi();
  return (
    <CheckShell exit={false}>
      <div className="booth-screen" data-screen="S57">
        <h1>{t(lang, "assessment.booth.resetConfirm")}</h1>
        <div className="booth-actions">
          <button
            type="button"
            className="cta"
            onClick={() => startNextVisitor(dispatch, { guest: model.data.config.mode === "guest", online })}
          >
            {t(lang, "assessment.booth.resetYes")}
          </button>
          <button type="button" className="ghost" onClick={() => dispatch({ type: "BACK" })}>
            {t(lang, "assessment.exit.stay")}
          </button>
        </div>
      </div>
    </CheckShell>
  );
}
