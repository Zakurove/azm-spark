/**
 * Stubs of the progress stream's screens: the Today slot (S03 above S01), the offer after the intake
 * (S02), the results page (S53, nav "My results") and the example page (S54, /?example=progress).
 * Each is a real slot with its final props; the progress stream fills the bodies.
 */
import type { Lang } from "../../app/i18n";
import { t } from "../../i18n";
import { precheckItem } from "../../movements/assessments";
import { minutesUnit } from "../assessment/shared/format";
import { CheckDialog } from "../assessment/shared/CheckDialog";
import CheckIcon from "../assessment/shared/CheckIcon";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { ScreenStubView } from "../assessment/shared/ScreenStub";

/* ---------------------------------------------------------------- S01 and S03 on Today */

export interface TodayCheckSlotProps {
  lang: Lang;
  /** This tab is in verified booth mode (S01 homeSoon does not apply). */
  booth: boolean;
  /** Opens the check (CheckApp, signed in). */
  onStart(): void;
  /** Opens the results page (S53). */
  onOpenResults(): void;
  /** Opens the health profile (S01 blocked). */
  onOpenHealth(): void;
}

/**
 * The Today slot: S03 (the next day question, when due) above the S01 entry card. The real slot
 * loads GET /api/assessments/context and GET /api/progress (api.ts) and picks the S01 variant.
 */
export function TodayCheckSlot({ lang }: TodayCheckSlotProps) {
  return (
    <CheckRoot ui={{ lang }} page={false} className="check-slot">
      <section className="check-card" aria-labelledby="check-today-title" data-screen="S01">
        <span className="check-card-icon">
          <CheckIcon name="spark" />
        </span>
        <h2 id="check-today-title">{t(lang, "assessment.name")}</h2>
        <p className="check-body">{t(lang, "assessment.entry.homeSoon")}</p>
        <span className="check-chip check-stub-id" lang="en" dir="ltr">
          S01
        </span>
      </section>
    </CheckRoot>
  );
}

/* ---------------------------------------------------------------- S02 after the intake */

export interface AfterIntakeOfferProps {
  lang: Lang;
  /** Estimated minutes of the base selection (estimateMinutes, S27). */
  minutes: [number, number];
  onStart(): void;
  onLater(): void;
}

/** S02: offered once after the intake is saved, only while home checks are open. */
export function AfterIntakeOffer({ lang, minutes, onStart, onLater }: AfterIntakeOfferProps) {
  return (
    <CheckRoot ui={{ lang }} page={false}>
      <CheckDialog
        titleId="check-after-intake-title"
        onClose={onLater}
        initialFocus="#check-after-intake-title"
      >
        <h2 id="check-after-intake-title" tabIndex={-1}>
          {t(lang, "assessment.afterIntake.title")}
        </h2>
        <p className="check-body">
          {t(lang, "assessment.afterIntake.body", {
            minutesFrom: minutes[0],
            minutesTo: minutes[1],
            unit: minutesUnit(lang, minutes[1]),
          })}
        </p>
        <div className="check-actions">
          <button type="button" className="cta" onClick={onStart}>
            {t(lang, "assessment.afterIntake.start")}
          </button>
          <button type="button" className="ghost" onClick={onLater}>
            {t(lang, "assessment.afterIntake.later")}
          </button>
        </div>
        <span className="check-chip check-stub-id" lang="en" dir="ltr">
          S02
        </span>
      </CheckDialog>
    </CheckRoot>
  );
}

/* ---------------------------------------------------------------- S03 */

export interface NextDayQuestionProps {
  lang: Lang;
  onSend(value: "usual" | "settled" | "lasting"): Promise<void>;
  onNotNow(): void;
}

export function NextDayQuestion({ lang }: NextDayQuestionProps) {
  return (
    <CheckRoot ui={{ lang }} page={false}>
      <section className="check-card" data-screen="S03">
        <h2>{precheckItem("ac_next_day").ask[lang]}</h2>
      </section>
    </CheckRoot>
  );
}

/* ---------------------------------------------------------------- S53 My results */

export interface ResultsPageProps {
  lang: Lang;
  booth: boolean;
  onStartCheck(): void;
  onOpenProgram(): void;
}

/** S53, the nav page نتائجي · My results (the name avoids "progress", O7). */
export function ResultsPage({ lang }: ResultsPageProps) {
  return (
    <CheckRoot ui={{ lang, screenKey: "S53" }} page={false} className="check-results-page">
      <section className="check-card" data-screen="S53" aria-labelledby="check-results-heading">
        <h2 id="check-results-heading">{t(lang, "progress.checks.heading")}</h2>
        <p className="check-body">{t(lang, "progress.empty.body")}</p>
        <span className="check-chip check-stub-id" lang="en" dir="ltr">
          S53
        </span>
      </section>
    </CheckRoot>
  );
}

/* ---------------------------------------------------------------- S54 example */

export interface ExampleProgressProps {
  lang: Lang;
  onLanguage(): void;
  /** Booth mode or open home checks: "Try the movement check" is shown (S54). */
  canTryCheck: boolean;
  onTryCheck(): void;
  onRegister(): void;
}

/** S54, /?example=progress: read only, bundled, labelled as an example on every card (D-008). */
export function ExampleProgress({ lang, onLanguage }: ExampleProgressProps) {
  return (
    <CheckRoot ui={{ lang, onLanguage, screenKey: "S54" }}>
      <section className="check-offline-wrap" role="region" aria-label={t(lang, "progress.example.tag")}>
        <p className="check-offline">
          <CheckIcon name="info" />
          <span>{t(lang, "progress.example.banner")}</span>
        </p>
      </section>
      <ScreenStubView id="S54" title={t(lang, "progress.example.title")} brand exit={false} />
    </CheckRoot>
  );
}
