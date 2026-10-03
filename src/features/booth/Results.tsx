/**
 * Step 5 (contract C7): "Your starting point". The set's measure.rangeDeg as a large number on a
 * protractor arc that fills to it, the reps and the steady reps; beside it a then and now card,
 * always tagged «مثال» · Example, for the same check 4 weeks later (the person's own points only,
 * never a norm and never a promise).
 */
import { useEffect, useState } from "react";
import type { Lang } from "../../app/i18n";
import type { SessionSummary } from "../../engine/types";
import { unitWord } from "../../i18n";
import BoothIcon from "./BoothIcon";
import { boothCopy } from "./copy";
import { Actions, n, StepHead, stepKicker } from "./parts";
import { THEN_NOW_EXAMPLE } from "./story";

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts up to `to` once (or shows it at once with reduced motion). */
function useCountUp(to: number, ms = 1300) {
  const [v, setV] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (reducedMotion()) {
      setV(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

export function ResultsStep({
  lang,
  summary,
  demo,
  onRetry,
  onNext,
}: {
  lang: Lang;
  summary: SessionSummary;
  demo: boolean;
  onRetry(): void;
  onNext(): void;
}) {
  const k = boothCopy(lang);
  const m = summary.measure && summary.measure.kind !== "hip_rise" ? summary.measure : null;
  const reps = summary.reps.valid + summary.reps.compensated;
  const steady = summary.steadyReps ?? summary.reps.valid;
  const shown = useCountUp(m?.rangeDeg ?? 0);
  return (
    <div className="bx-results" data-screen="results" data-range={m?.rangeDeg ?? ""}>
      <StepHead kicker={stepKicker(lang, 4)} title={m ? k.resultsTitle : k.noRange} />
      <div className="bx-results-grid">
        <section className="bx-start" aria-label={k.resultsKicker}>
          <div className="bx-start-head">
            <span className="bx-start-kicker">{k.resultsKicker}</span>
            {demo && <span className="bx-tag">{k.exampleTag}</span>}
          </div>
          <Protractor lang={lang} deg={m?.rangeDeg ?? 0} shown={shown} empty={!m} />
          <p className="bx-start-label">{k.rangeLabel}</p>
          <div className="bx-stats">
            <div>
              <b>{n(lang, reps)}</b>
              <span>{k.reps(reps)}</span>
            </div>
            <div>
              <b>{n(lang, steady)}</b>
              <span>{k.steady}</span>
            </div>
          </div>
        </section>
        <ThenNow lang={lang} />
      </div>
      <Actions
        lang={lang}
        secondary={{ label: k.tryAgain, onClick: onRetry, icon: "reset", name: "retry" }}
        primary={m ? { label: k.toProgram, onClick: onNext, name: "program" } : undefined}
      />
    </div>
  );
}

/**
 * A protractor from 0 to 180 degrees: the arc fills to the range, the large number sits inside it.
 * The arc starts at the reading side's start (mirrored in RTL); the number is never mirrored.
 */
function Protractor({ lang, deg, shown, empty }: { lang: Lang; deg: number; shown: number; empty: boolean }) {
  const k = boothCopy(lang);
  const share = Math.max(0, Math.min(1, deg / 180));
  const R = 120,
    C = 140,
    Y = 150;
  const d = `M ${C - R} ${Y} A ${R} ${R} 0 0 1 ${C + R} ${Y}`;
  const ticks = [0, 30, 60, 90, 120, 150, 180];
  return (
    <div className="bx-pro" style={{ ["--share" as string]: share }} data-empty={empty || undefined}>
      <svg viewBox="0 0 280 168" aria-hidden="true">
        <defs>
          <linearGradient id="bx-pro-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#f6d36b" />
            <stop offset="1" stopColor="#e3ab1f" />
          </linearGradient>
        </defs>
        <g className="bx-pro-arc">
          <path d={d} className="track" pathLength={100} />
          {!empty && <path d={d} className="fill" pathLength={100} />}
          {ticks.map((t) => {
            const a = Math.PI - (t / 180) * Math.PI;
            const x1 = C + (R + 14) * Math.cos(a),
              y1 = Y - (R + 14) * Math.sin(a),
              x2 = C + (R + 22) * Math.cos(a),
              y2 = Y - (R + 22) * Math.sin(a);
            return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className="tick" />;
          })}
        </g>
      </svg>
      <div className="bx-pro-value">
        <b>
          {empty ? "·" : n(lang, shown)}
          {!empty && <sup>°</sup>}
        </b>
        {!empty && <span>{unitWord(lang, "deg", deg)}</span>}
        {empty && <span>{k.noRange}</span>}
      </div>
    </div>
  );
}

function ThenNow({ lang }: { lang: Lang }) {
  const k = boothCopy(lang);
  const { start, now } = THEN_NOW_EXAMPLE;
  const change = now - start;
  return (
    <section className="bx-thennow" aria-label={`${k.exampleTag}: ${k.exampleTitle}`} data-example="">
      <div className="bx-thennow-head">
        <span className="bx-tag">{k.exampleTag}</span>
        <h2>{k.exampleTitle}</h2>
      </div>
      <div className="bx-thennow-chart" aria-hidden="true">
        <svg viewBox="0 0 240 90">
          <defs>
            <linearGradient id="bx-tn-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#b9a6d8" />
              <stop offset="1" stopColor="#8065ad" />
            </linearGradient>
          </defs>
          <path d="M 24 64 C 90 60, 150 34, 216 24" className="line" />
          <circle cx="24" cy="64" r="7" className="then" />
          <circle cx="216" cy="24" r="9" className="now" />
        </svg>
      </div>
      <div className="bx-thennow-values">
        <div>
          <span>{k.exampleStart}</span>
          <b>
            {n(lang, start)}
            <sup>°</sup>
          </b>
        </div>
        <div className="now">
          <span>{k.exampleNow}</span>
          <b>
            {n(lang, now)}
            <sup>°</sup>
          </b>
        </div>
        <div className="change">
          <span>{k.exampleChange}</span>
          <b>
            <BoothIcon name="up" size={20} />
            {n(lang, change)}
            <sup>°</sup>
          </b>
        </div>
      </div>
      <p className="bx-thennow-note">{k.exampleNote}</p>
    </section>
  );
}
