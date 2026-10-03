import { useEffect, useState } from "react";
import { privacyHref } from "./privacyHref";
import { Lang, fmtNum, pct } from "./i18n";
import { formatNumber, t, unitWord, type I18nKey } from "../i18n";
import Brand from "./Brand";
import Icon from "./Icon";

/*
 * Landing for people and families (technical plan, "Landing page reimagining", phase 1 part of F15):
 * the hero and the four step loop. Copy lives in src/i18n/{ar,en}/landing.json. Simplicity cut C36:
 * one gold action (Start free) with a quiet Try a workout link, at the top and the bottom only; the
 * steps as a plain numbered list with the one measure and compare example; no benefits section; the
 * movement check action only while the check can start. The footer has no disclaimer (D-017 item 2):
 * the privacy link and the brand line.
 *
 * Hero headline: option 1 of the plan, the tech lead's default. Nasser may swap it for one of the
 * other two options, which are in landing.json in both languages:
 *   const HERO_HEADLINE = "landing.hero.headline.therapyEnded"; // option 2: انتهى العلاج، وحركتك مستمرة
 *   const HERO_HEADLINE = "landing.hero.headline.stillYours"; // option 3: الرياضة ما زالت لك، مهما تغيّر جسمك
 */
export const HERO_HEADLINE: I18nKey = "landing.hero.headline.lastSession";

// Council wording (Q23 (6), Q29, H1, H2): the hero line and the closing text are the council's texts,
// with no prescribe, prove or progress; the check is قياس الحركة (never فحص); the loop is Measure,
// Plan, Coach, Measure again; Arabic says عزم, never عزم سبارك; the phone is هاتفك.
// SPEC-GAP: landing-doctor. The plan's later "proof" section speaks of results you can show your
// doctor; until the SFDA opinion of spec Q23 arrives the page never mentions sharing with a doctor.

/**
 * Example values for the then and now card (always shown with the Example tag). They follow the
 * worked example of the clinical spec (section 5): shoulder abduction, start 100, now 117, band 16,
 * so the change reads "higher than your starting point". Whole degrees, never a population norm.
 */
export const EXAMPLE = { start: 100, now: 117 } as const;

/** Example points of the progress card in the loop (third check onward, spec section 5 trends). */
const EXAMPLE_POINTS = [100, 108, 117] as const;
/** The default "about the same" band of shoulder abduction (check data, noiseBandRules.default). */
export const EXAMPLE_BAND = 16;

export const LOOP_STEPS = ["measure", "prescribe", "coach", "prove"] as const;
export type LoopStep = (typeof LOOP_STEPS)[number];

/** The guest movement check route (arrives with the check feature), keeping the page language. */
export function checkHref(lang: Lang): string {
  return lang === "en" ? "/?check=1&lang=en" : "/?check=1";
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** Where a value sits on the example chart, in percent of its height. */
const CHART_LO = 76;
const CHART_HI = 124;
export function chartPos(v: number): number {
  return ((v - CHART_LO) / (CHART_HI - CHART_LO)) * 100;
}

/**
 * The person's own points over time, with the "about the same" band around the start shaded (spec
 * section 5, trends). Built with inline positions so it mirrors in RTL and never distorts.
 */
function PointsChart() {
  const start = EXAMPLE_POINTS[0];
  const last = EXAMPLE_POINTS.length - 1;
  return (
    <div className="ld-mock-chart">
      <span
        className="ld-chart-band"
        style={{
          bottom: `${chartPos(start - EXAMPLE_BAND)}%`,
          height: `${chartPos(start + EXAMPLE_BAND) - chartPos(start - EXAMPLE_BAND)}%`,
        }}
      />
      <span className="ld-chart-start" style={{ bottom: `${chartPos(start)}%` }} />
      {EXAMPLE_POINTS.map((v, i) => (
        <i
          key={i}
          className={i === last ? "now" : undefined}
          style={{ insetInlineStart: `${6 + (i * 88) / last}%`, bottom: `${chartPos(v)}%` }}
        />
      ))}
    </div>
  );
}

/** One value of the then and now card: the number, and its unit word below it. */
function Degrees({ lang, label, value }: { lang: Lang; label: string; value: number }) {
  return (
    <div className="ld-then-cell">
      <span>{label}</span>
      <b>{formatNumber(lang, value)}</b>
      <small>{unitWord(lang, "deg", value)}</small>
    </div>
  );
}

function ExampleCard({ lang }: { lang: Lang }) {
  return (
    <div className="ld-card ld-card-then">
      <div className="ld-then-head">
        <span className="ld-tag">{t(lang, "landing.example.tag")}</span>
        <span className="ld-then-test">{t(lang, "landing.example.test")}</span>
      </div>
      <div className="ld-then-values">
        <Degrees lang={lang} label={t(lang, "landing.example.start")} value={EXAMPLE.start} />
        <Degrees lang={lang} label={t(lang, "landing.example.now")} value={EXAMPLE.now} />
        <Degrees lang={lang} label={t(lang, "landing.example.change")} value={EXAMPLE.now - EXAMPLE.start} />
      </div>
      <div className="ld-then-verdict">{t(lang, "landing.example.verdict")}</div>
    </div>
  );
}

/** The measure and compare example (C36): the person's own checks over time, labelled Example. */
function CompareMock({ lang }: { lang: Lang }) {
  return (
    <div className="ld-mock" aria-hidden>
      <div className="ld-mock-prove">
        <div className="ld-mock-prove-head">
          <span>{t(lang, "landing.loop.mocks.prove.label")}</span>
          <span className="ld-tag">{t(lang, "landing.example.tag")}</span>
        </div>
        <PointsChart />
        <div className="ld-mock-prove-axis">
          <span>{t(lang, "landing.example.start")}</span>
          <span>{t(lang, "landing.example.now")}</span>
        </div>
      </div>
    </div>
  );
}

export default function Landing({
  lang,
  onLanguage,
  onEnter,
  onDemo,
  tryCheck,
}: {
  lang: Lang;
  onLanguage: () => void;
  onEnter: (register?: boolean) => void;
  onDemo: () => void;
  /** The movement check can start (booth mode or open home checks): its action shows (C36). */
  tryCheck: boolean;
}) {
  const [rep, setRep] = useState(3);
  useEffect(() => {
    // The live card counts reps; with reduced motion it stays on one still frame.
    if (prefersReducedMotion()) return;
    const id = setInterval(() => setRep((r) => (r % 8) + 1), 1150);
    return () => clearInterval(id);
  }, []);
  const actions = (
    <div className="ld-ctas">
      <button className="cta ld-cta-start" onClick={() => onEnter(true)}>
        {t(lang, "landing.actions.startFree")}
        <Icon name="arrow" size={16} />
      </button>
      <button className="ld-cta-link" onClick={onDemo}>
        <Icon name="play" size={16} />
        {t(lang, "landing.actions.tryWorkout")}
      </button>
    </div>
  );
  return (
    <div className="ld-shell">
      <header className="ld-header">
        <div className="ld-header-inner">
          <Brand />
          <div className="landing-header-actions">
            <button className="language" lang={lang === "ar" ? "en" : "ar"} onClick={onLanguage}>
              {t(lang, "landing.header.language")}
            </button>
            <button className="ghost ld-login" onClick={() => onEnter(false)}>
              {t(lang, "landing.header.login")}
            </button>
          </div>
        </div>
      </header>
      <main>
        <section className="ld-hero">
          <span className="ld-glow ld-glow-gold" aria-hidden />
          <span className="ld-glow ld-glow-violet" aria-hidden />
          <div className="ld-hero-copy">
            <h1>{t(lang, HERO_HEADLINE)}</h1>
            <p className="ld-hero-body">{t(lang, "landing.hero.body")}</p>
            {actions}
          </div>
          <div className="ld-stage" aria-hidden>
            <span className="ld-stage-disc" />
            <span className="ld-stage-ring" />
            <img className="ld-stage-img" src="/illustrations/landing/wheelchair-press.webp" alt="" />
            <div className="ld-card ld-card-live">
              <div className="ld-live-head">
                <span className="ld-live-dot" />
                {t(lang, "landing.hero.live.label")}
              </div>
              <div className="ld-live-name">{t(lang, "landing.hero.live.exercise")}</div>
              <div className="ld-live-count">
                <b>{fmtNum(rep, lang)}</b>
                <span>/ {fmtNum(8, lang)}</span>
              </div>
              <div className="ld-bar">
                <i style={{ width: `${(rep / 8) * 100}%` }} />
              </div>
              <div className="ld-live-range">
                <span>{t(lang, "landing.hero.live.range")}</span>
                <b>{pct(0.96, lang)}</b>
              </div>
            </div>
            <ExampleCard lang={lang} />
          </div>
        </section>

        <section className="ld-how" aria-labelledby="ld-how-title">
          <div className="ld-how-head">
            <h2 id="ld-how-title">{t(lang, "landing.loop.title")}</h2>
            <p>{t(lang, "landing.loop.intro")}</p>
          </div>
          <ol className="ld-how-flow">
            {LOOP_STEPS.map((step, i) => (
              <li className="ld-step" key={step}>
                <div className="ld-step-head">
                  <span className="ld-step-num" aria-hidden>
                    {fmtNum(i + 1, lang)}
                  </span>
                  <h3>{t(lang, `landing.loop.steps.${step}.title`)}</h3>
                </div>
                <p>{t(lang, `landing.loop.steps.${step}.body`)}</p>
              </li>
            ))}
          </ol>
          <CompareMock lang={lang} />
          {/* While home checks are closed /?check=1 is the booth only screen (S05b): no action here. */}
          {tryCheck && (
            <div className="ld-how-action">
              <a className="ghost ld-cta-check" href={checkHref(lang)}>
                <Icon name="camera" size={18} />
                {t(lang, "landing.actions.tryCheck")}
              </a>
            </div>
          )}
        </section>

        <section className="ld-close">
          <h2>{t(lang, "landing.close.title")}</h2>
          <p>{t(lang, "landing.close.body")}</p>
          {actions}
        </section>
      </main>
      <footer className="ld-footer">
        <div className="ld-footer-inner">
          <a className="ld-privacy" href={privacyHref(lang)}>
            {t(lang, "privacy.link")}
          </a>
          <span className="ld-brandline">{t(lang, "landing.footer.brandline")}</span>
        </div>
      </footer>
    </div>
  );
}
