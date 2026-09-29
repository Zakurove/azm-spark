/**
 * The skip dialog of S28, also opened from S34c, S34e and S34i (UX spec S28): "Skip this test?",
 * skipping is normal and never counted against the person (principle 12), so "Yes, skip it" is the gold
 * action. As S28 asks, the dialog opens with focus on its title and "No, I will do it" comes first, so
 * a person who pressed Skip by mistake meets the way back first. Escape keeps the test.
 */
import { t } from "../../../i18n";
import type { ScreenProps } from "../screenTypes";
import { CheckDialog } from "../shared/CheckDialog";
import { useCheckUi } from "../shared/CheckUi";

export function SkipDialog({ dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  return (
    <CheckDialog
      titleId="check-skip-title"
      onClose={() => dispatch({ type: "SKIP_CANCEL" })}
      initialFocus="#check-skip-title"
    >
      <h2 id="check-skip-title" tabIndex={-1}>
        {t(lang, "assessment.skip.title")}
      </h2>
      <p className="check-body">{t(lang, "assessment.skip.body")}</p>
      <div className="check-actions">
        <button type="button" className="ghost" onClick={() => dispatch({ type: "SKIP_CANCEL" })}>
          {t(lang, "assessment.skip.cancel")}
        </button>
        <button
          type="button"
          className="cta"
          data-confirm=""
          onClick={() => dispatch({ type: "SKIP_CONFIRM" })}
        >
          {t(lang, "assessment.skip.confirm")}
        </button>
      </div>
    </CheckDialog>
  );
}
