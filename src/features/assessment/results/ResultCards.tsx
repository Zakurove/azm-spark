/**
 * The per test cards and the skipped tests of a results screen (UX spec S50 to S52 shared rules, P6):
 *   - one card per test in run order (h2 the test name), a row per side in the order the test ran,
 *     with the side named («ذراعك اليمنى»), never mirrored;
 *   - a measured side shows its value (56 px) with the unit word beside it; the result sentence is its
 *     accessible name only (C31, C41); when the saved comparison is known (S52), start and now with
 *     the verdict (ThenNow);
 *   - a side not measured shows "Not measured today" (22 px) with one neutral line, its reason, never
 *     greyed (P1); a reason already said on the screen is not said again (R-13);
 *   - tests that did not run are named in one muted line, then each distinct reason once (C32).
 */
import { t, type Lang } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA, skipReasonText, testDef } from "../../../movements/assessments";
import type { TestId } from "../../../movements/types";
import { isReasonId, resultSentence, resultUnitOf, sideLabel } from "../../progress/format";
import type { SeriesViewLike } from "../../progress/series";
import { ThenNow, ValueNumber, type HeavierOfferState } from "../../progress/ThenNow";
import { useCheckUi } from "../shared/CheckUi";
import { SkippedTests } from "../shared/SkippedTests";
import { NOT_REACHED, type ResultCardModel, type ResultRow, type ResultsModel } from "./model";

/**
 * A reason in plain words (data:reasons), with the substitute sentence when it ran (P6); a test left
 * when a signed in check ended early reads assessment.results.notReached.
 */
function reasonWords(lang: Lang, reason: string, substituteRan?: boolean): string {
  if (reason === NOT_REACHED) return t(lang, "assessment.results.notReached");
  return isReasonId(reason) ? skipReasonText(reason, lang, { substituteRan }) : "";
}

function ReasonText({ reason, substituteRan }: { reason: string; substituteRan?: boolean }) {
  const { lang } = useCheckUi();
  const words = reasonWords(lang, reason, substituteRan);
  return words ? <>{bidiText(lang, words)}</> : null;
}

function Row({
  testId,
  row,
  view,
  sideLevel,
  heavier,
}: {
  testId: TestId;
  row: ResultRow;
  view?: SeriesViewLike;
  sideLevel: 3 | 4;
  heavier?: HeavierOfferState;
}) {
  const { lang } = useCheckUi();
  const side = sideLabel(lang, testId, row.side);
  const SideHeading = sideLevel === 3 ? "h3" : "h4";
  const unit = resultUnitOf(testId);
  return (
    <div className="rs-row" data-side={row.side} data-status={row.status}>
      {side && <SideHeading className="rs-side">{side}</SideHeading>}
      {row.status === "measured" && row.value !== undefined ? (
        view ? (
          <ThenNow view={view} heavierOffer={heavier} />
        ) : (
          <div
            className="rs-value"
            {...(row.censored
              ? {}
              : {
                  role: "img",
                  "aria-label": resultSentence(lang, testId, row.side, row.value, {
                    detail: row.detail,
                    variant: row.variant,
                  }),
                })}
          >
            <ValueNumber unit={unit} value={row.value} censored={row.censored} big />
          </div>
        )
      ) : (
        <>
          <p className="rs-not">{CHECK_DATA.progress.labels.notMeasured[lang]}</p>
          {row.reason && (
            <p className="check-body">
              <ReasonText reason={row.reason} />
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function ResultCard({
  card,
  views,
  level = 2,
  heavier,
}: {
  card: ResultCardModel;
  views?: Map<string, SeriesViewLike>;
  level?: 2 | 3;
  heavier?: (view: SeriesViewLike) => HeavierOfferState | undefined;
}) {
  const { lang } = useCheckUi();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className="check-card rs-card" data-test={card.testId}>
      <Heading className="rs-test">{bidiText(lang, testDef(card.testId).name[lang])}</Heading>
      {card.rows.map((row) => {
        const view = views?.get(`${card.testId}:${row.side}`);
        return (
          <Row
            key={row.side}
            testId={card.testId}
            row={row}
            view={view}
            sideLevel={level === 2 ? 3 : 4}
            heavier={view && heavier ? heavier(view) : undefined}
          />
        );
      })}
    </section>
  );
}

/** Every card, then the skipped tests (P6: every skipped test is named with its reason). */
export function ResultCards({
  model,
  views,
  level = 2,
  heavier,
}: {
  model: ResultsModel;
  views?: Map<string, SeriesViewLike>;
  level?: 2 | 3;
  heavier?: (view: SeriesViewLike) => HeavierOfferState | undefined;
}) {
  return (
    <>
      {model.cards.map((card) => (
        <ResultCard key={card.testId} card={card} views={views} level={level} heavier={heavier} />
      ))}
      <Skipped model={model} />
    </>
  );
}

function Skipped({ model }: { model: ResultsModel }) {
  const { lang } = useCheckUi();
  return (
    <SkippedTests
      names={model.skipped.map((e) => testDef(e.testId).name[lang])}
      reasons={model.skipped.flatMap((e) => e.sides.map((s) => reasonWords(lang, s.reason, s.substituteRan)))}
    />
  );
}
