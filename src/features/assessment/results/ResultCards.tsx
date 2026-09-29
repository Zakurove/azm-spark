/**
 * The per test cards and the skip groups of a results screen (UX spec S50 to S52 shared rules, P6):
 *   - one card per test in run order (h2 the test name), a row per side in the order the test ran,
 *     with the side named («ذراعك اليمنى»), never mirrored;
 *   - a measured side shows its value (56 px) with the unit word beside it and the result sentence,
 *     or, when the saved comparison is known (S52), start and now with the verdict (ThenNow);
 *   - a side not measured shows "Not measured today" (22 px) with its reason, never greyed (P1);
 *   - tests that did not run are listed under "Not today" and "Not part of your check" with their
 *     reasons in plain words, in neutral words, never styled as a miss (S27 groups).
 */
import { t, type Lang } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA, skipReasonText, testDef } from "../../../movements/assessments";
import type { TestId } from "../../../movements/types";
import { isReasonId, resultSentence, resultUnitOf, sideLabel } from "../../progress/format";
import type { SeriesViewLike } from "../../progress/series";
import { ThenNow, ValueNumber, type HeavierOfferState } from "../../progress/ThenNow";
import { useCheckUi } from "../shared/CheckUi";
import {
  NOT_REACHED,
  type ResultCardModel,
  type ResultRow,
  type ResultsModel,
  type SkipEntry,
} from "./model";

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
          <>
            <ValueNumber unit={unit} value={row.value} censored={row.censored} big />
            {!row.censored && (
              <p className="check-body">
                {bidiText(
                  lang,
                  resultSentence(lang, testId, row.side, row.value, {
                    detail: row.detail,
                    variant: row.variant,
                  }),
                )}
              </p>
            )}
          </>
        )
      ) : (
        <>
          <p className="rs-not">{CHECK_DATA.progress.labels.notMeasured[lang]}</p>
          {row.reason && (
            <p className="check-body">
              <ReasonText reason={row.reason} />
            </p>
          )}
          {row.wheelchairTip && (
            <p className="check-body">{bidiText(lang, t(lang, "assessment.tips.wheelchair"))}</p>
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

function SkipGroup({
  titleKey,
  entries,
  level,
}: {
  titleKey: "notToday" | "notPart";
  entries: SkipEntry[];
  level: 2 | 3;
}) {
  const { lang } = useCheckUi();
  if (entries.length === 0) return null;
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className="rs-skips" data-group={titleKey}>
      <Heading className="rs-group">
        {titleKey === "notToday" ? t(lang, "assessment.plan.notToday") : t(lang, "assessment.plan.notPart")}
      </Heading>
      <ul className="check-card rs-skip-list">
        {entries.map((e) => {
          const same = e.sides.every((s) => s.reason === e.sides[0].reason);
          return (
            <li key={e.testId} data-test={e.testId}>
              <p className="rs-skip-name">{bidiText(lang, testDef(e.testId).name[lang])}</p>
              {same ? (
                <p className="check-body">
                  <ReasonText reason={e.sides[0].reason} substituteRan={e.sides[0].substituteRan} />
                </p>
              ) : (
                e.sides.map((s) => {
                  const side = sideLabel(lang, e.testId, s.side);
                  const reason = reasonWords(lang, s.reason, s.substituteRan);
                  return (
                    <p key={s.side} className="check-body">
                      {bidiText(lang, side ? t(lang, "assessment.plan.sideLine", { side, reason }) : reason)}
                    </p>
                  );
                })
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Every card, then the two skip groups (P6: every skipped test is named with its reason). */
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
      <SkipGroup titleKey="notToday" entries={model.notToday} level={level} />
      <SkipGroup titleKey="notPart" entries={model.notPart} level={level} />
    </>
  );
}
