/**
 * The sessions block of My results (UX spec S53): consistency and adherence from the existing session
 * data. The last 8 weeks in the reading direction (the latest week at the inline end), done sessions as
 * filled squares and planned ones not done as outlined squares (shape and fill, not colour), this
 * week's count, and three tiles: active minutes per week, reps within range "n of every 10" (never a
 * percentage) and the average effort. Tiles are a dl.
 */
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { bidiText } from "../../i18n/rich";
import { CHECK_DATA } from "../../movements/assessments";
import type { ProgressResponse, StoredCheck } from "../assessment/api";
import CheckIcon from "../assessment/shared/CheckIcon";
import { useCheckUi } from "../assessment/shared/CheckUi";
import { dayLabel, weekStartMs } from "./format";

export interface SessionsData {
  weeks: { start: number | string; done: number; planned: number }[];
  validShare: number | null;
  avgEffort: number | null;
  activeMinutesPerWeek: number | null;
}

/** The sessions part of GET /api/progress (its week starts are ISO days on the wire). */
export function sessionsOf(
  p: Pick<ProgressResponse, "sessions" | "validShare" | "avgEffort" | "activeMinutesPerWeek">,
): SessionsData {
  return {
    weeks: (p.sessions?.weeks ?? []) as SessionsData["weeks"],
    validShare: p.validShare,
    avgEffort: p.avgEffort,
    activeMinutesPerWeek: p.activeMinutesPerWeek,
  };
}

/** Whether there is anything to show: a session done, or a value for a tile. */
export function hasSessions(s: SessionsData): boolean {
  return (
    s.weeks.some((w) => w.done > 0) ||
    s.validShare !== null ||
    s.avgEffort !== null ||
    (s.activeMinutesPerWeek !== null && s.activeMinutesPerWeek > 0)
  );
}

/** Reps within range as "n of every 10" (UX spec S53: round(validShare × 10), never a percentage). */
export function inRangeOfTen(validShare: number): number {
  return Math.max(0, Math.min(10, Math.round(validShare * 10)));
}

export function SessionsBlock({
  data,
  year,
  onOpenProgram,
  chips,
}: {
  data: SessionsData;
  year?: boolean;
  onOpenProgram?: () => void;
  chips?: ReactNode;
}) {
  const { lang } = useCheckUi();
  if (!hasSessions(data)) {
    return (
      <div className="check-card">
        <p className="check-body">{t(lang, "progress.sessions.none")}</p>
        {onOpenProgram && (
          <button type="button" className="ghost" onClick={onOpenProgram}>
            {t(lang, "progress.sessions.toProgram")}
          </button>
        )}
      </div>
    );
  }
  const weeks = data.weeks;
  const current = weeks[weeks.length - 1];
  const n = weeks.length;
  return (
    <div className="check-card pg-sessions">
      {chips && <div className="pg-chips">{chips}</div>}
      {n > 0 && (
        <>
          <p className="check-meta">{bidiText(lang, t(lang, "progress.sessions.weeks", { weeks: n }))}</p>
          <ol className="pg-weeks">
            {weeks.map((w, i) => {
              const start = weekStartMs(w.start);
              const squares = Math.max(w.planned, w.done);
              return (
                <li key={i} className="pg-week">
                  {Array.from({ length: squares }, (_, k) => (
                    <span key={k} className={`pg-square${k < w.done ? " is-done" : ""}`} aria-hidden="true" />
                  ))}
                  <span className="check-visually-hidden">
                    {t(lang, "progress.sessions.weekLabel", {
                      date: start === null ? "" : dayLabel(lang, start, { weekday: false, year }),
                      done: w.done,
                      planned: w.planned,
                    })}
                  </span>
                </li>
              );
            })}
          </ol>
          {current && (
            <p className="check-body">
              {bidiText(
                lang,
                t(lang, "progress.sessions.thisWeek", { done: current.done, planned: current.planned }),
              )}
            </p>
          )}
        </>
      )}
      <dl className="pg-tiles">
        {data.activeMinutesPerWeek !== null && (
          <div className="pg-tile">
            <dt>{t(lang, "progress.sessions.minutes")}</dt>
            <dd>{bidiText(lang, String(Math.round(data.activeMinutesPerWeek)))}</dd>
            {n > 0 && (
              <dd className="pg-date">
                {bidiText(lang, t(lang, "progress.sessions.minutesHint", { weeks: n }))}
              </dd>
            )}
          </div>
        )}
        {data.validShare !== null && (
          <div className="pg-tile">
            <dt>{t(lang, "progress.sessions.inRange")}</dt>
            <dd>
              {bidiText(
                lang,
                t(lang, "progress.sessions.inRangeValue", { n: inRangeOfTen(data.validShare), total: 10 }),
              )}
            </dd>
          </div>
        )}
        {data.avgEffort !== null && (
          <div className="pg-tile">
            <dt>{t(lang, "progress.sessions.effort")}</dt>
            <dd>
              {bidiText(
                lang,
                t(lang, "progress.sessions.effortValue", {
                  n: Math.round(data.avgEffort * 10) / 10,
                  max: 10,
                }),
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------ history */

/** Checks shown in the history: completed or ended early, oldest first (S53 wireframe). */
export function historyRows(checks: readonly StoredCheck[]): StoredCheck[] {
  return checks
    .filter((c) => c.status === "completed" || c.status === "ended_early")
    .sort((a, b) => (a.completed ?? a.started) - (b.completed ?? b.started));
}

/** One row per check: its date, where and how it ended, 56 px; opens the S52 view of that check. */
export function CheckHistoryList({
  checks,
  onOpen,
}: {
  checks: readonly StoredCheck[];
  onOpen(id: string): void;
}) {
  const { lang } = useCheckUi();
  return (
    <ul className="pg-history">
      {checks.map((c) => (
        <li key={c.id}>
          <button type="button" className="pg-history-row" data-check={c.id} onClick={() => onOpen(c.id)}>
            <span className="pg-history-text">
              <span className="pg-meta-part">{dayLabel(lang, c.completed ?? c.started)}</span>{" "}
              <span className="pg-meta-part">
                {c.setting === "booth"
                  ? CHECK_DATA.progress.labels.boothPoint[lang]
                  : t(lang, "progress.trend.home")}
              </span>{" "}
              <span className="pg-meta-part">
                {t(
                  lang,
                  c.status === "completed" ? "progress.history.completed" : "progress.history.endedEarly",
                )}
              </span>
            </span>
            <CheckIcon name="arrow-forward" size={20} />
          </button>
        </li>
      ))}
    </ul>
  );
}
