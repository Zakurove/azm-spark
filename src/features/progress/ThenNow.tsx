/**
 * The then and now parts of the results screens (UX spec S52, S53, S54, 5.8):
 *   ValueNumber   a value with its unit in words, read together ("120 degrees"); censored side lean
 *                 values as "more than {value}"
 *   VerdictPill   higher, about the same or lower, in words with a decorative icon (never colour)
 *   NumberLine    start and now on a line with the shaded "about the same" band (343 x 72)
 *   TrendChart    the person's own checks from the third one, with a real table as its alternative
 *   ThenNow       start, now, change, verdict, number line and the lines of compareSeries' output
 *   SeriesCard    one series on My results and the example, with its trend and earlier lines
 * Report per test and side only; no comparison with other people, no ranges, no percentages.
 */
import { useId, useState, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import { countPhrase, formatNumber, t } from "../../i18n";
import { bidiText } from "../../i18n/rich";
import { CHECK_DATA, testDef } from "../../movements/assessments";
import type { UnitFormId, Verdict } from "../../movements/types";
import CheckIcon from "../assessment/shared/CheckIcon";
import { useCheckUi } from "../assessment/shared/CheckUi";
import { bandSentence, changeText, dayLabel, moreThan, resultUnitOf, sideLabel, valueParts } from "./format";
import {
  fraction,
  numberLineRange,
  trendRange,
  type LoadStepView,
  type SeriesPoint,
  type SeriesViewLike,
} from "./series";

/** Date options of a page: the example shows the year of its fixed dates (S54). */
export interface DateStyle {
  year?: boolean;
}

/* ------------------------------------------------------------ value */

export function ValueNumber({
  unit,
  value,
  censored,
  big,
}: {
  unit: UnitFormId;
  value: number;
  censored?: boolean;
  big?: boolean;
}) {
  const { lang } = useCheckUi();
  const parts = valueParts(lang, unit, value);
  if (censored) {
    // «أكثر من ١٥» in place of the number, with the unit word beside it (spec 4.3, S51).
    const text = `${moreThan(lang, value)} ${parts.unit}`;
    return (
      <span className={`pg-number is-text${big ? " is-big" : ""}`}>
        <span className="pg-number-value">{bidiText(lang, text)}</span>
      </span>
    );
  }
  return (
    <span className={`pg-number${big ? " is-big" : ""}`}>
      <span className="check-visually-hidden">{parts.phrase}</span>
      <span className="pg-number-value" aria-hidden="true">
        {parts.number}
      </span>
      <span className="pg-number-unit" aria-hidden="true">
        {parts.unit}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------ verdict */

const VERDICT_ICON: Record<Verdict, string> = { higher: "arrow-up", same: "equals", lower: "arrow-down" };

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const { lang } = useCheckUi();
  return (
    <p className="pg-pill" data-verdict={verdict}>
      <CheckIcon name={VERDICT_ICON[verdict]} size={20} />
      <span>{CHECK_DATA.progress.verdicts[verdict][lang]}</span>
    </p>
  );
}

/* ------------------------------------------------------------ number line */

const LINE_W = 343;
const LINE_H = 72;
const PAD = 16;

/** The hatch of the "about the same" band, so it reads without colour. */
function Hatch({ id }: { id: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
      <line className="pg-hatch-line" x1="0" y1="0" x2="0" y2="8" />
    </pattern>
  );
}

function Diamond({ x, y, r, className }: { x: number; y: number; r: number; className: string }) {
  return <path className={className} d={`M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`} />;
}

/**
 * NumberLine (S52): increases toward the inline end, so in Arabic higher values sit to the left (O23).
 * role img, with the numberLine.label text alternative; the band legend is visible under it.
 */
export function NumberLine({
  start,
  now,
  band,
  unit,
}: {
  start: number;
  now: number;
  band: number;
  unit: UnitFormId;
}) {
  const { lang } = useCheckUi();
  const hatchId = useId();
  const { lo, hi } = numberLineRange(start, now, band, unit);
  const rtl = lang === "ar";
  const x = (v: number) => {
    const f = fraction(v, lo, hi);
    return PAD + (rtl ? 1 - f : f) * (LINE_W - 2 * PAD);
  };
  const y = 26;
  const bandFrom = x(Math.max(lo, start - band));
  const bandTo = x(Math.min(hi, start + band));
  const xs = x(start);
  const xn = x(now);
  // Values printed under both markers, moved apart when the markers are close.
  let sx = xs;
  let nx = xn;
  if (Math.abs(xn - xs) < 44) {
    const mid = (xs + xn) / 2;
    const dir = xn > xs || (xn === xs && !rtl) ? 1 : -1;
    sx = mid - 22 * dir;
    nx = mid + 22 * dir;
  }
  const label = t(lang, "progress.numberLine.label", { start, now, unit });
  return (
    <div className="pg-line">
      <svg viewBox={`0 0 ${LINE_W} ${LINE_H}`} role="img" aria-label={label} direction="ltr">
        <defs>
          <Hatch id={`${hatchId}h`} />
        </defs>
        <line className="pg-axis" x1={PAD} y1={y} x2={LINE_W - PAD} y2={y} />
        <rect
          className="pg-band"
          x={Math.min(bandFrom, bandTo)}
          y={y - 12}
          width={Math.abs(bandTo - bandFrom)}
          height={24}
          rx={4}
        />
        <rect
          x={Math.min(bandFrom, bandTo)}
          y={y - 12}
          width={Math.abs(bandTo - bandFrom)}
          height={24}
          rx={4}
          fill={`url(#${hatchId}h)`}
          className="pg-hatch"
        />
        <circle className="pg-mark-start" cx={xs} cy={y} r={8} />
        <Diamond className="pg-mark-now" x={xn} y={y} r={9} />
        <text className="pg-svg-text is-muted" x={sx} y={y + 36} textAnchor="middle">
          {formatNumber(lang, start)}
        </text>
        <text className="pg-svg-text" x={nx} y={y + 36} textAnchor="middle">
          {formatNumber(lang, now)}
        </text>
      </svg>
      <p className="pg-legend">
        <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
          <defs>
            <Hatch id={`${hatchId}l`} />
          </defs>
          <rect className="pg-band" x="1" y="1" width="20" height="12" rx="3" />
          <rect x="1" y="1" width="20" height="12" rx="3" fill={`url(#${hatchId}l)`} className="pg-hatch" />
        </svg>
        <span>{t(lang, "progress.numberLine.legendBand")}</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ trend */

const TREND_W = 343;
const TREND_H = 160;

/**
 * TrendChart (S53): the check date along the reading direction, the value upward, the start's band
 * shaded, points as filled diamonds and booth points as hollow squares. No lines, no trend words, no
 * arrows. Toggles to a real table (caption, th scope).
 */
export function TrendChart({
  points,
  start,
  band,
  unit,
  dates,
}: {
  points: readonly SeriesPoint[];
  start: number;
  band: number;
  unit: UnitFormId;
  dates?: DateStyle;
}) {
  const { lang } = useCheckUi();
  const [asTable, setAsTable] = useState(false);
  const headingId = useId();
  const hatchId = useId();
  const sorted = [...points].sort((a, b) => a.date - b.date);
  if (sorted.length === 0) return null;
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const { lo, hi } = trendRange(
    sorted.map((p) => p.value),
    start,
    band,
    unit,
  );
  const rtl = lang === "ar";
  const left = 44;
  const right = 12;
  const top = 12;
  const bottom = 34;
  const px = (d: number) => {
    const f = last > first ? (d - first) / (last - first) : 0.5;
    const w = TREND_W - left - right;
    return rtl ? TREND_W - left - f * w : left + f * w;
  };
  const py = (v: number) => top + (1 - fraction(v, lo, hi)) * (TREND_H - top - bottom);
  const dayOpts = { weekday: false, year: dates?.year };
  const summary = t(lang, "progress.trend.summary", {
    first: dayLabel(lang, first, dayOpts),
    last: dayLabel(lang, last, dayOpts),
  });
  const axisX = rtl ? TREND_W - left + 8 : left - 8;
  const anchor = rtl ? "start" : "end";
  const hasBooth = sorted.some((p) => p.setting === "booth");
  return (
    <div className="pg-trend">
      <div className="pg-trend-head">
        <h4 className="pg-h4" id={headingId}>
          {CHECK_DATA.progress.labels.trend[lang]}
        </h4>
        <button
          type="button"
          className="check-text-button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {t(lang, asTable ? "progress.trend.chart" : "progress.trend.table")}
        </button>
      </div>
      {asTable ? (
        <div className="pg-table-wrap">
          <table className="pg-table">
            <caption>{summary}</caption>
            <thead>
              <tr>
                <th scope="col">{t(lang, "progress.trend.colDate")}</th>
                <th scope="col">{t(lang, "progress.trend.colValue")}</th>
                <th scope="col">{t(lang, "progress.trend.colWhere")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={`${p.date}:${p.setting}`}>
                  <th scope="row">{dayLabel(lang, p.date, dayOpts)}</th>
                  <td>
                    {bidiText(
                      lang,
                      p.censored
                        ? `${moreThan(lang, p.value)}`
                        : countPhrase(lang, unit, Math.round(p.value)),
                    )}
                  </td>
                  <td>
                    {p.setting === "booth"
                      ? CHECK_DATA.progress.labels.boothPoint[lang]
                      : t(lang, "progress.trend.home")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${TREND_W} ${TREND_H}`} role="img" aria-label={summary} direction="ltr">
            <defs>
              <Hatch id={`${hatchId}t`} />
            </defs>
            <line className="pg-grid" x1={left} y1={py(hi)} x2={TREND_W - right} y2={py(hi)} />
            <line className="pg-axis" x1={left} y1={py(lo)} x2={TREND_W - right} y2={py(lo)} />
            <rect
              className="pg-band"
              x={left}
              y={py(Math.min(hi, start + band))}
              width={TREND_W - left - right}
              height={Math.max(2, py(Math.max(lo, start - band)) - py(Math.min(hi, start + band)))}
            />
            <rect
              x={left}
              y={py(Math.min(hi, start + band))}
              width={TREND_W - left - right}
              height={Math.max(2, py(Math.max(lo, start - band)) - py(Math.min(hi, start + band)))}
              fill={`url(#${hatchId}t)`}
              className="pg-hatch"
            />
            <text className="pg-svg-text is-muted" x={axisX} y={py(hi) + 5} textAnchor={anchor}>
              {formatNumber(lang, hi)}
            </text>
            <text className="pg-svg-text is-muted" x={axisX} y={py(lo) + 5} textAnchor={anchor}>
              {formatNumber(lang, lo)}
            </text>
            {sorted.map((p) =>
              p.setting === "booth" ? (
                <rect
                  key={`${p.date}b`}
                  className="pg-mark-booth"
                  x={px(p.date) - 7}
                  y={py(p.value) - 7}
                  width={14}
                  height={14}
                />
              ) : (
                <Diamond key={`${p.date}h`} className="pg-mark-now" x={px(p.date)} y={py(p.value)} r={8} />
              ),
            )}
            <text
              className="pg-svg-text is-muted"
              x={px(first)}
              y={TREND_H - 6}
              textAnchor={sorted.length > 1 ? (rtl ? "end" : "start") : "middle"}
            >
              {dayLabel(lang, first, { weekday: false })}
            </text>
            {sorted.length > 1 && (
              <text
                className="pg-svg-text is-muted"
                x={px(last)}
                y={TREND_H - 6}
                textAnchor={rtl ? "start" : "end"}
              >
                {dayLabel(lang, last, { weekday: false })}
              </text>
            )}
          </svg>
          <p className="pg-trend-legend">
            <span>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <Diamond className="pg-mark-now" x={8} y={8} r={7} />
              </svg>
              {t(lang, "progress.trend.home")}
            </span>
            {hasBooth && (
              <span>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect className="pg-mark-booth" x="2" y="2" width="12" height="12" />
                </svg>
                {CHECK_DATA.progress.labels.boothPoint[lang]}
              </span>
            )}
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ then and now */

/** A point's value as shown: the censored side lean value as "more than {value}". */
function PointValue({ point, unit, big }: { point: SeriesPoint; unit: UnitFormId; big?: boolean }) {
  return <ValueNumber unit={unit} value={point.value} censored={point.censored === true} big={big} />;
}

/** The extra lines of a comparison (S52 table), in data wording. */
export function comparisonLines(lang: Lang, v: SeriesViewLike): string[] {
  const p = CHECK_DATA.progress;
  const out: string[] = [];
  if (v.milestone) return [p.milestone[lang]];
  if (v.notComparable) return [p.notComparable[lang]];
  if (v.firstResult) return [CHECK_DATA.boundary.firstResult[lang]];
  if (v.startingPointSet) return [p.startingPointSet[lang]];
  if (v.largeDrop) return [p.largeDrop.text[lang]];
  if (v.nearFullRange) return [p.nearFullRange[lang]];
  if (v.noVerdict && v.noVerdict !== "censored") return [p.noVerdict[v.noVerdict][lang]];
  if (v.verdict === "lower" || v.lowerExtra) out.push(p.lowerExtra[lang]);
  if (v.verdict === "same" && v.unconfirmed) out.push(p.unconfirmed[lang]);
  return out;
}

/** Whether a comparison shows only the Now value (a first result or a new line of comparison). */
export function onlyNow(v: SeriesViewLike): boolean {
  return !v.baseline || v.firstResult === true || v.notComparable === true || v.milestone === true;
}

export interface HeavierOfferState {
  chosen: "heavier" | "same" | null;
  onChoose(choice: "heavier" | "same"): void;
}

export function ThenNow({
  view,
  dates,
  heavierOffer,
}: {
  view: SeriesViewLike;
  dates?: DateStyle;
  heavierOffer?: HeavierOfferState;
}) {
  const { lang } = useCheckUi();
  const unit = resultUnitOf(view.testId);
  const labels = CHECK_DATA.progress.labels;
  const dayOpts = { weekday: false, year: dates?.year };
  const single = onlyNow(view);
  const verdict = view.verdict;
  const lines = comparisonLines(lang, view);
  const showBand = verdict !== null && !single;
  return (
    <div className="pg-thennow">
      <dl className={`pg-values${single ? " is-single" : ""}`}>
        {!single && view.baseline && (
          <div className="pg-value">
            <dt>{labels.start[lang]}</dt>
            <dd>
              <PointValue point={view.baseline} unit={unit} />
              <span className="pg-date">{dayLabel(lang, view.baseline.date, dayOpts)}</span>
            </dd>
          </div>
        )}
        <div className="pg-value">
          <dt>{labels.now[lang]}</dt>
          <dd>
            <PointValue point={view.latest} unit={unit} big={single} />
            <span className="pg-date">{dayLabel(lang, view.latest.date, dayOpts)}</span>
          </dd>
        </div>
      </dl>
      {verdict !== null && !single && view.change !== null && (
        <p className="pg-change">
          <span className="pg-change-label">{labels.change[lang]}</span>
          <span>{bidiText(lang, changeText(lang, view.change, unit))}</span>
        </p>
      )}
      {verdict !== null && !single && <VerdictPill verdict={verdict} />}
      {showBand && view.baseline && (
        <NumberLine start={view.baseline.value} now={view.latest.value} band={view.band} unit={unit} />
      )}
      {lines.map((line) => (
        <p key={line} className="pg-note">
          {bidiText(lang, line)}
        </p>
      ))}
      {showBand && <p className="pg-band-note">{bidiText(lang, bandSentence(lang, view.band, unit))}</p>}
      {heavierOffer && view.testId === "arm_curl_30s" && view.loadStep && (
        <HeavierOffer state={heavierOffer} step={view.loadStep.to} />
      )}
    </div>
  );
}

/** Q26 (home, phase 2): two buttons of equal size and weight, none preselected. */
function HeavierOffer({ state }: { state: HeavierOfferState; step: LoadStepView }) {
  const { lang } = useCheckUi();
  const progression = testDef("arm_curl_30s").load.progression;
  const textId = useId();
  return (
    <div className="pg-offer" role="group" aria-labelledby={textId}>
      <p id={textId} className="check-body">
        {bidiText(lang, progression.offer[lang])}
      </p>
      <div className="pg-offer-buttons">
        {progression.buttons.map((b) => (
          <button
            key={b.value}
            type="button"
            className="ghost"
            aria-pressed={state.chosen === b.value}
            onClick={() => state.onChoose(b.value)}
          >
            {b.label[lang]}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ series card */

/** The name and side of a series card (h3 and a meta line, S53). */
export function SeriesHeading({
  view,
  level = 3,
  chips,
}: {
  view: SeriesViewLike;
  level?: 2 | 3;
  chips?: ReactNode;
}) {
  const { lang } = useCheckUi();
  const Heading = level === 2 ? "h2" : "h3";
  const side = sideLabel(lang, view.testId, view.side);
  return (
    <div className="pg-card-head">
      <div>
        <Heading className="pg-h3">{testDef(view.testId).name[lang]}</Heading>
        {side && <p className="check-meta">{side}</p>}
      </div>
      {chips && <div className="pg-chips">{chips}</div>}
    </div>
  );
}

export function SeriesCard({
  view,
  earlier = [],
  boothPoints = [],
  example,
  dates,
  heavierOffer,
}: {
  view: SeriesViewLike;
  earlier?: SeriesViewLike[];
  boothPoints?: SeriesPoint[];
  example?: boolean;
  dates?: DateStyle;
  heavierOffer?: HeavierOfferState;
}) {
  const { lang } = useCheckUi();
  const unit = resultUnitOf(view.testId);
  const booth = view.setting === "booth";
  const chips = (
    <>
      {booth && <span className="pg-chip is-plain">{CHECK_DATA.progress.labels.boothPoint[lang]}</span>}
      {example && <span className="pg-chip">{t(lang, "progress.example.tag")}</span>}
    </>
  );
  const trendPoints = view.points ? [...view.points, ...boothPoints] : null;
  return (
    <article className="check-card pg-series" data-series={`${view.testId}:${view.side}:${view.setting}`}>
      <SeriesHeading view={view} chips={booth || example ? chips : undefined} />
      {earlier.length > 0 && view.baseline && (
        <p className="check-meta">
          {bidiText(
            lang,
            t(lang, "progress.series.newLine", {
              date: dayLabel(lang, view.baseline.date, { weekday: false, year: dates?.year }),
            }),
          )}
        </p>
      )}
      <ThenNow view={view} dates={dates} heavierOffer={heavierOffer} />
      {trendPoints && view.baseline && (
        <TrendChart
          points={trendPoints}
          start={view.baseline.value}
          band={view.band}
          unit={unit}
          dates={dates}
        />
      )}
      {earlier.length > 0 && (
        <details className="pg-earlier">
          <summary>{t(lang, "progress.series.showEarlier")}</summary>
          {earlier.map((e) => (
            <div key={e.seriesKey} className="pg-earlier-line">
              <h4 className="pg-h4">{t(lang, "progress.series.earlier")}</h4>
              <ThenNow view={e} dates={dates} />
            </div>
          ))}
        </details>
      )}
    </article>
  );
}
