/**
 * S05b Available at the booth only (contract v3 I, UX spec S05b, Q31 (6)): /?check=1 without verified
 * booth mode while home checks are closed. A visitor sees what the check is and two ways on: an
 * example of the results page (/?example=progress) and a workout to try (/?try=1).
 */
// SPEC-GAP: booth-only-actions. Contract v3 I and the task name "Try a workout" (/?try=1) as the
// second action, the UX spec S05b and its body copy name "Watch a demo" (/demo). The action follows
// the contract with the landing's existing label; the body line still says "watch a demo" until the
// copy owner aligns it.
import { t } from "../../../i18n";
import { CHECK_DATA } from "../../../movements/assessments";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";

export function BoothOnly({ dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  return (
    <CheckShell
      brand
      exit={false}
      sound={false}
      footer={{
        primary: {
          label: t(lang, "assessment.guest.boothOnly.example"),
          onClick: () => dispatch({ type: "EXAMPLE" }),
        },
        secondary: {
          label: t(lang, "landing.actions.tryWorkout"),
          onClick: () => dispatch({ type: "TRY_WORKOUT" }),
        },
      }}
    >
      <section className="check-card is-info" aria-labelledby="check-booth-only-title">
        <span className="check-card-icon">
          <CheckIcon name="info" />
        </span>
        <h1 id="check-booth-only-title">{t(lang, "assessment.guest.boothOnly.title")}</h1>
        <p className="check-body">{t(lang, "assessment.guest.boothOnly.body")}</p>
      </section>
      <p className="check-label">{CHECK_DATA.boundary.notMedical[lang]}</p>
    </CheckShell>
  );
}
