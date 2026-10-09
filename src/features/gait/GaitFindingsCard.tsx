/**
 * The gait card (product v7 contract 2.8.4 and 2.9, stream C, step C4): how the person walks, in plain
 * words, on the findings page and at the end of the walk. The walk's key numbers (steps a minute,
 * speed and step length when the walk gave metres), one step cycle as a skeleton replay (no video),
 * and the patterns the server's rules found, each in the server's own lines (the rules never run on
 * the phone):
 *   - while provisional (from the gait POST until complete, C-13) the pattern lines only, never the
 *     possible reasons, the program lines or the referrals;
 *   - a result read against the interim age and sex norms (flags norm_interim, CG-16, GAIT-Q11)
 *     carries the existing approximate label «مقارنة تقريبية» (D-028, AP-12);
 *   - the quality notes of the clinical copy: the handrail held or touched, timing only, the pad.
 * No result shown and the gate passed: the no pattern line; no view passed: the walk was not clear.
 * A walk read for timing only (D-035 item 2, the MVP's home walk: 3 clean cycles a side across the
 * passes, below the full gate) shows its steps a minute and each side's step time with the clinical
 * timing only line, and no pattern line at all (the patterns were not assessed). A walk that gave
 * nothing shows the unclear line and, at the end of the walk, what to change next time.
 */
import type { Lang } from "../../app/i18n";
import { bidiText } from "../../i18n/rich";
import type { GaitPatternResult, GaitStoredView } from "../../medical/gait-types";
import { romResultLine } from "../../movements/rom";
import { gt, noPatternLine, num, qualityLine, referralLine, sideWord, supportLine } from "./copy";
import { Replay } from "./Replay";
import "./gait.css";

export interface GaitFindingsCardProps {
  gait: GaitStoredView;
  lang: Lang;
  /** At the end of the walk: what to change next time, when the walk gave nothing (gait.retry.reason.*). */
  reason?: string | null;
}

/** MVP_TIMING_CYCLES: GAIT_MVP.timingCyclesPerSide, the timing only level's clean cycles a side. */
const MVP_TIMING_CYCLES = 3;
const FULL_CYCLES = 6;

/**
 * What a stored walk gave (D-035 item 2; engine/gait/verdict.ts on the stored view, which keeps each
 * view's clean cycles and the walk's quality): full (a view passed its gate, or the toward and away
 * views together), timing (timing only, 3 clean cycles a side in a group and a cadence) or none.
 */
export function storedLevel(
  gait: Pick<GaitStoredView, "views" | "quality" | "metrics">,
): "full" | "timing" | "none" {
  if (gait.quality.gatePassed) return "full";
  const groups: { left: number; right: number }[] = [];
  const toward = gait.views.filter((v) => v.view === "front" || v.view === "back");
  if (toward.length)
    groups.push(
      toward.reduce((a, v) => ({ left: a.left + v.cleanCycles.left, right: a.right + v.cleanCycles.right }), {
        left: 0,
        right: 0,
      }),
    );
  for (const v of gait.views) if (v.view !== "front" && v.view !== "back") groups.push(v.cleanCycles);
  const enough = (n: number) => groups.some((g) => g.left >= n && g.right >= n);
  if (!gait.quality.timingOnly && enough(FULL_CYCLES)) return "full";
  if (gait.quality.timingOnly && typeof gait.metrics.cadence?.value === "number" && enough(MVP_TIMING_CYCLES))
    return "timing";
  return "none";
}

/** A result the person is shown (gait-rules 5.0: possible or likely, at low confidence or more). */
const shown = (p: GaitPatternResult) =>
  (p.status === "possible" || p.status === "likely") && p.confidence !== null && p.lines.pattern.en !== "";

/** The key numbers of the walk: steps a minute; speed and step length when the walk gave metres. */
export function keyNumbers(
  gait: Pick<GaitStoredView, "metrics">,
  lang: Lang,
): { id: string; value: string; label: string }[] {
  const m = gait.metrics;
  const out: { id: string; value: string; label: string }[] = [];
  const cadence = m.cadence?.value;
  if (typeof cadence === "number")
    out.push({ id: "cadence", value: num(lang, cadence), label: gt(lang, "card.cadence") });
  const speed = m.speed_mps?.value;
  if (typeof speed === "number")
    out.push({ id: "speed", value: num(lang, speed, 2), label: gt(lang, "card.speed") });
  const step = m.step_length_m?.value;
  if (typeof step === "number")
    out.push({ id: "step", value: num(lang, step * 100), label: gt(lang, "card.step") });
  return out;
}

function Approximate({ lang }: { lang: Lang }) {
  return <span className="fx-pill gx-approx">{romResultLine("label_approximate")[lang]}</span>;
}

/** The timing only level's numbers: steps a minute and each side's step time (seconds). */
function timingNumbers(gait: Pick<GaitStoredView, "metrics">, lang: Lang) {
  const out = keyNumbers({ metrics: { cadence: gait.metrics.cadence } }, lang);
  const step = gait.metrics.step_time_s?.sides;
  for (const side of ["right", "left"] as const) {
    const v = step?.[side];
    if (typeof v === "number")
      out.push({
        id: `step_time_${side}`,
        value: num(lang, v, 2),
        label: gt(lang, "card.stepTime", { side: sideWord(side, lang) }),
      });
  }
  return out;
}

export function GaitFindingsCard({ gait, lang, reason }: GaitFindingsCardProps) {
  const level = storedLevel(gait);
  const numbers =
    level === "full" ? keyNumbers(gait, lang) : level === "timing" ? timingNumbers(gait, lang) : [];
  const results = gait.patterns.filter(shown);
  const supports = gait.findings
    .map((f) => ({ f, line: supportLine(f.id, f.side, lang) }))
    .filter((s): s is { f: (typeof gait.findings)[number]; line: string } => s.line !== null);
  const flags = gait.quality.flags;
  const notes: string[] = [];
  // The walk ended because of the pain (C-15, D-030 C4-5).
  if (gait.outcome === "pain_limited") notes.push(qualityLine("pain_limited", lang));
  if (flags.includes("handrail_firm")) notes.push(qualityLine("handrail_held", lang));
  else if (flags.includes("handrail_light")) notes.push(qualityLine("handrail_light", lang));
  if (gait.quality.timingOnly && level !== "none") notes.push(qualityLine("quality_timing_only", lang));
  if (gait.mode === "walking_pad") notes.push(qualityLine("pad_compare", lang));
  return (
    <section
      className="fx-glass fx-card gx-card"
      data-provisional={gait.provisional || undefined}
      lang={lang}
    >
      <div className="gx-card-head">
        <h2 className="fx-h2">{gt(lang, "card.title")}</h2>
        {numbers.length > 0 && (
          <ul className="gx-numbers">
            {numbers.map((n) => (
              <li key={n.id} data-metric={n.id}>
                <b>{n.value}</b>
                <span>{n.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {gait.replay && (
        <figure className="gx-replay-box">
          <Replay cycle={gait.replay} label={gt(lang, "card.replay")} />
          <figcaption>{gt(lang, "card.replay")}</figcaption>
        </figure>
      )}
      {level === "timing" ? null : level === "none" ? (
        <>
          <p className="fx-body is-muted">{gt(lang, "card.unclear")}</p>
          {reason && <p className="fx-body gx-reason">{bidiText(lang, reason)}</p>}
        </>
      ) : results.length === 0 ? (
        <p className="fx-body">{bidiText(lang, noPatternLine(lang))}</p>
      ) : (
        <ul className="gx-patterns">
          {results.map((p, i) => (
            <li key={`${p.pattern}:${p.side}:${i}`} data-pattern={p.pattern} data-status={p.status}>
              <p className="gx-pattern-line">{bidiText(lang, p.lines.pattern[lang])}</p>
              <div className="fx-chips">
                {p.lines.confidence && <span className="fx-pill is-violet">{p.lines.confidence[lang]}</span>}
                {p.flags?.includes("norm_interim") && <Approximate lang={lang} />}
              </div>
              {!gait.provisional && p.lines.reasons && (
                <p className="fx-body is-muted">{bidiText(lang, p.lines.reasons[lang])}</p>
              )}
              {!gait.provisional &&
                p.lines.targets.map((tl, k) => (
                  <p key={k} className="fx-body gx-target">
                    {bidiText(lang, tl[lang])}
                  </p>
                ))}
              {!gait.provisional &&
                p.referrals
                  .map((id) => referralLine(id, lang))
                  .filter((line): line is string => line !== null)
                  .map((line) => (
                    <p key={line} className="fx-note gx-referral">
                      <span>{bidiText(lang, line)}</span>
                    </p>
                  ))}
            </li>
          ))}
        </ul>
      )}
      {level === "full" &&
        supports.map(({ f, line }) => (
          <p key={f.id} className="fx-body is-muted gx-support-line" data-finding={f.id}>
            {bidiText(lang, line)} {f.flags?.includes("norm_interim") && <Approximate lang={lang} />}
          </p>
        ))}
      {notes.map((n) => (
        <p key={n} className="fx-body is-muted gx-quality">
          {bidiText(lang, n)}
        </p>
      ))}
    </section>
  );
}
