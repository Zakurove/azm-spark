import { useState } from "react";
import { Lang, fmtDate, fmtNum, T } from "./i18n";
import { isGuided, type GuidedRecord, type SavedSession } from "./product";
import { ui, insight } from "./experience";
import { EXERCISES } from "../exercises/defs";
import { libraryById } from "../medical/pool";
import { guidedCopy } from "./guided-copy";
import RepReview from "./RepReview";
import Icon from "./Icon";
/**
 * The session numbers, one row per camera set or guided card (booth v2, D: a card has its reps or the
 * seconds it was held, and its effort; the camera columns stay empty).
 */
export function sessionCsv(records: SavedSession[]) {
  const rows = [
    [
      "date",
      "exercise",
      "completed_reps",
      "without_flags",
      "with_flags",
      "shorter_range",
      "best_range_pct",
      "effort_0_10",
      "mode",
      "held_seconds",
    ],
    ...records.map((r) =>
      isGuided(r)
        ? [
            new Date(r.endedAt).toISOString(),
            r.exerciseId,
            r.done.reps ?? "",
            "",
            "",
            "",
            "",
            r.rpe ?? "",
            "guided",
            r.done.seconds ?? "",
          ]
        : [
            new Date(r.endedAt).toISOString(),
            r.exerciseId,
            r.reps.valid + r.reps.compensated,
            r.reps.valid,
            r.reps.compensated,
            r.reps.partial,
            r.romPct ?? "",
            r.rpe ?? "",
            "camera",
            "",
          ],
    ),
  ];
  return rows.map((row) => row.join(",")).join("\r\n");
}

/** A guided card in the history: what was done of it (reps, or seconds held) and its effort. */
function GuidedRow({
  r,
  lang,
  open,
  onToggle,
}: {
  r: GuidedRecord;
  lang: Lang;
  open: boolean;
  onToggle: () => void;
}) {
  const g = guidedCopy(lang);
  const held = r.done.seconds != null;
  return (
    <div className="history-record" data-mode="guided">
      <button className="history-record-button" aria-expanded={open} onClick={onToggle}>
        <span className="history-symbol">
          <Icon name="check" />
        </span>
        <span className="history-record-title">
          <strong>{libraryById(r.exerciseId)?.name[lang] ?? r.exerciseId}</strong>
          <small>
            {fmtDate(r.endedAt, lang, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </small>
        </span>
        <span>
          <b>{fmtNum(held ? (r.done.seconds ?? 0) : (r.done.reps ?? 0), lang)}</b>
          <small>{held ? g.heldSeconds : g.repsDone}</small>
        </span>
        <Icon name="arrow" size={18} />
      </button>
      {open && (
        <div className="history-detail">
          <div className="record-metrics">
            <span>{g.guided}</span>
            <span>
              {g.setsDone}: {fmtNum(r.done.sets, lang)}
            </span>
            <span>
              {T.rpeLabel[lang]}: {r.rpe == null ? "·" : fmtNum(r.rpe, lang)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
/**
 * The workout history (C44): one list under the sessions block of My results, each session opening
 * its details, with the download of the session numbers. Nothing shows before the first session (the
 * sessions block above says so and links to the program).
 */
export default function History({ lang, records }: { lang: Lang; records: SavedSession[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const x = ui(lang);
  if (records.length === 0) return null;
  const download = () => {
    const url = URL.createObjectURL(new Blob([sessionCsv(records)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "azm-sessions.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="history-page" data-block="workouts">
      <div className="history-title">
        <h3>{x.recent}</h3>
        <button className="ghost" onClick={download}>
          <Icon name="download" size={18} />
          {x.export}
        </button>
      </div>
      <div className="history-list">
        {records.map((r, i) =>
          isGuided(r) ? (
            <GuidedRow
              key={`${r.endedAt}-${i}`}
              r={r}
              lang={lang}
              open={expanded === i}
              onToggle={() => setExpanded(expanded === i ? null : i)}
            />
          ) : (
            <div className="history-record" key={`${r.endedAt}-${i}`}>
              <button
                className="history-record-button"
                aria-expanded={expanded === i}
                onClick={() => setExpanded(expanded === i ? null : i)}
              >
                <span className="history-symbol">
                  <Icon name="check" />
                </span>
                <span className="history-record-title">
                  <strong>{EXERCISES.find((e) => e.id === r.exerciseId)?.name[lang]}</strong>
                  <small>
                    {fmtDate(r.endedAt, lang, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </small>
                </span>
                <span>
                  <b>{fmtNum(r.reps.valid + r.reps.compensated, lang)}</b>
                  <small>{x.completed}</small>
                </span>
                <Icon name="arrow" size={18} />
              </button>
              {expanded === i && (
                <div className="history-detail">
                  <p>{insight(r.reps, lang)}</p>
                  <div className="record-metrics">
                    <span>
                      {T.validReps[lang]}: {fmtNum(r.reps.valid, lang)}
                    </span>
                    <span>
                      {T.compReps[lang]}: {fmtNum(r.reps.compensated, lang)}
                    </span>
                    <span>
                      {T.partialReps[lang]}: {fmtNum(r.reps.partial, lang)}
                    </span>
                    <span>
                      {T.rpeLabel[lang]}: {r.rpe == null ? "·" : fmtNum(r.rpe, lang)}
                    </span>
                  </div>
                  {r.moments && <RepReview reps={r.moments} lang={lang} />}
                </div>
              )}
            </div>
          ),
        )}
      </div>
      <p className="micro history-export-note">{x.exportNote}</p>
    </section>
  );
}
