/**
 * S05b Available at the booth only (contract v3 I, UX spec S05b, Q31 (6)): /?check=1 without verified
 * booth mode while home checks are closed. A visitor sees what the check is and two ways on: an
 * example of the results page (/?example=progress) and a demo to watch (the demo session). Every
 * label names where it goes (WCAG 2.4.4). Where the example page is still a stub (featureFlag.ts), the
 * body names the demo only, so it never promises a button that is not there. The language switch shows here (an entry screen); Sound
 * does not (nothing plays).
 */
// Contract v3 I names "Try a workout" as the second action, the UX spec S05b "Watch a demo" (/demo);
// the contract gives the UX spec the last word on interaction, so the screen follows the spec, and the
// body says the same thing as the buttons.
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA } from "../../../movements/assessments";
import { CHECK_UI } from "../featureFlag";
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
      language
      footer={
        // The example page is still a stub: it is offered only where the check UI is on.
        CHECK_UI
          ? {
              primary: {
                label: t(lang, "assessment.guest.boothOnly.example"),
                onClick: () => dispatch({ type: "EXAMPLE" }),
              },
              secondary: {
                label: t(lang, "assessment.camera.demo"),
                onClick: () => dispatch({ type: "DEMO" }),
              },
            }
          : {
              primary: {
                label: t(lang, "assessment.camera.demo"),
                onClick: () => dispatch({ type: "DEMO" }),
              },
            }
      }
    >
      <section className="check-card is-info" aria-labelledby="check-booth-only-title">
        <span className="check-card-icon">
          <CheckIcon name="info" />
        </span>
        <h1 id="check-booth-only-title">{t(lang, "assessment.guest.boothOnly.title")}</h1>
        <p className="check-body">
          {t(lang, CHECK_UI ? "assessment.guest.boothOnly.body" : "assessment.guest.boothOnly.bodyDemo")}
        </p>
      </section>
      <p className="check-label">{bidiText(lang, CHECK_DATA.boundary.notMedical[lang])}</p>
    </CheckShell>
  );
}
