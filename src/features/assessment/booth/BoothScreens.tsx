/**
 * The booth screens as the check's screen registry holds them (screens.ts reads BOOTH_SCREENS). None
 * has a flow state; each is reached outside the flow:
 *   S55   the staff page /?booth=1 (BoothStaffPage, rendered by App)
 *   S55b  the visitor token page /?boothToken= (VisitorTokenPage) and the ended card
 *   S57   the booth tools over every screen (BoothLayer, NewVisitorButton, StaffCountCorrection)
 *   S58   the setup tips, opened in place by the camera and results screens (SetupTipsView)
 * so their registry entries are thin screens over the same parts, never a second design.
 */
import { t } from "../../../i18n";
import { readBoothPass } from "../boothMode";
import type { ScreenProps } from "../screenTypes";
import CheckIcon from "../shared/CheckIcon";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { startNextVisitor } from "./BoothLayer";
import { TokenEndedCard } from "./VisitorTokenPage";
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
          onClick={() => location.replace(lang === "en" ? "/?booth=1&lang=en" : "/?booth=1")}
        >
          {t(lang, "assessment.booth.turnOn")}
        </button>
      </div>
    </CheckShell>
  );
}

/** S55b inside the check: booth mode for this check only, or the ended card. */
export function TokenStatusScreen({ dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const on = readBoothPass()?.kind === "visitor";
  return (
    <CheckShell exit={false}>
      <div className="booth-screen" data-screen="S55b">
        <h1>{t(lang, "assessment.name")}</h1>
        {on ? (
          <>
            <p className="booth-status" role="status">
              <CheckIcon name="badge" />
              <span>{t(lang, "assessment.booth.tokenOn")}</span>
            </p>
            <button type="button" className="cta" onClick={() => dispatch({ type: "CONTINUE" })}>
              {t(lang, "assessment.common.continue")}
            </button>
          </>
        ) : (
          <TokenEndedCard onContinue={() => dispatch({ type: "EXIT" })} />
        )}
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
