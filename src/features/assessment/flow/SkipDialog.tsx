/**
 * The skip dialog of S28 (S28, S34c, S34i): "Skip this test?" with skipping is normal (principle 12), so the confirm is the primary.
 * A working foundation version; the flow stream owns and may restyle it.
 */
import { t } from "../../../i18n";
import type { ScreenProps } from "../screenTypes";
import { CheckDialog } from "../shared/CheckDialog";
import { useCheckUi } from "../shared/CheckUi";

export function SkipDialogStub({ dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  return (
    <CheckDialog
      titleId="check-skip-title"
      onClose={() => dispatch({ type: "SKIP_CANCEL" })}
      initialFocus="[data-confirm]"
    >
      <h2 id="check-skip-title">{t(lang, "assessment.skip.title")}</h2>
      <p className="check-body">{t(lang, "assessment.skip.body")}</p>
      <div className="check-actions">
        <button
          type="button"
          className="cta"
          data-confirm=""
          onClick={() => dispatch({ type: "SKIP_CONFIRM" })}
        >
          {t(lang, "assessment.skip.confirm")}
        </button>
        <button type="button" className="ghost" onClick={() => dispatch({ type: "SKIP_CANCEL" })}>
          {t(lang, "assessment.skip.cancel")}
        </button>
      </div>
    </CheckDialog>
  );
}
