/**
 * The value card of each part of the camera sequence (UX spec 4.2 table, S34c to S34k). Every
 * state carries an icon and a word, never a colour alone (4.4); nothing that carries a value is
 * dimmed (the paused HUD shows the frozen value in muted ink, with the pause icon). Buttons marked
 * "at the phone" are full width and stacked 16 px apart.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { Lang } from "../../../app/i18n";
import { countPhrase, formatNumber, t, unitWord } from "../../../i18n";
import { bidiText, tx } from "../../../i18n/rich";
import { reasonText, testDef } from "../../../movements/assessments";
import { SetupTipsList } from "../booth/SetupTips";
import CheckIcon from "../shared/CheckIcon";
import type { CamSnapshot, CamTest } from "./controller";
import { Dots, LeanArrow, Ring, TopView } from "./hud";
import {
  ARM_KEY,
  FIX_KEY,
  fixOf,
  PHASE_KEY,
  SETUP_TITLE,
  SIDE_KEY,
  viewDiagramFor,
  type AttemptDot,
  type PhaseWord,
} from "./view";

export type Band = "none" | "adjust" | "ready" | "info" | "paused" | "saved";

const BAND_ICON: Record<Band, string> = {
  none: "people",
  adjust: "alert-triangle",
  ready: "check",
  info: "info",
  paused: "pause",
  saved: "check",
};

/** The 12 px state band with its icon and 56 px word (4.4). */
export function StateBand({ band, word, icon }: { band: Band; word: ReactNode; icon?: string }) {
  return (
    <div className={`s34-band is-${band}`}>
      <span className="s34-word">
        <span className="s34-band-icon" aria-hidden="true">
          <CheckIcon name={icon ?? BAND_ICON[band]} size={40} />
        </span>
        {word}
      </span>
    </div>
  );
}

/** The phase word at 56 px; paused shows the pause icon and "Paused" (never a dimmed value). */
function PhaseLine({ word, lang, paused }: { word: PhaseWord | null; lang: Lang; paused?: boolean }) {
  if (paused)
    return (
      <p className="s34-phase is-paused">
        <CheckIcon name="pause" size={44} />
        <span>{t(lang, PHASE_KEY.paused)}</span>
      </p>
    );
  if (!word) return null;
  return <p className="s34-phase">{t(lang, PHASE_KEY[word])}</p>;
}

/** Labels drawn apart by a short rule (in Arabic a middle dot reads as a zero). */
export function Parts({ lang, parts }: { lang: Lang; parts: string[] }) {
  return (
    <span className="s34-parts">
      {parts.map((part, k) => (
        <span key={k} className="s34-part">
          {k > 0 && <span className="check-visually-hidden">{lang === "ar" ? "، " : ", "}</span>}
          {bidiText(lang, part)}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------ S34c setup */

export interface SetupPanelProps {
  snap: CamSnapshot;
  test: CamTest;
  lang: Lang;
  motion: { onAllow(): void } | null;
  /** At home, without a tilt reading: one line that the phone's level is not checked (C28). */
  motionOff: boolean;
  onTips(): void;
  onSkip(): void;
  tipsAfterSec: number;
  skipAfterSec: number;
  reducedMotion: boolean;
}

/**
 * S34c (C28): one line, the fix for the first failing check or «جاهز». The checks that pass are not
 * listed; the staff readout lists every failing check at the booth.
 */
export function SetupPanel({
  snap,
  test,
  lang,
  motion,
  motionOff,
  onTips,
  onSkip,
  tipsAfterSec,
  skipAfterSec,
  reducedMotion,
}: SetupPanelProps) {
  const s = snap.setup;
  const first = s.issues[0] ?? null;
  const band: Band = s.ok ? "ready" : first === "no_person" || first === null ? "none" : "adjust";
  const word = s.ok ? t(lang, "assessment.setup.ready") : t(lang, SETUP_TITLE[first ?? "no_person"]);
  const diagram = first === "wrong_view" ? viewDiagramFor(test.testId, test.side, test.weaker) : null;
  const waiting = !s.ok && s.issues.length > 0;
  // Motion access (map 2.9) is answered at the phone: Allow comes first, the state under it.
  if (motion && first === "motion")
    return (
      <div className="s34-panel s34-setup is-motion">
        <div className="s34-at-phone">
          <button type="button" className="cta" onClick={motion.onAllow}>
            {t(lang, "assessment.setup.allowMotion")}
          </button>
        </div>
        <StateBand band={band} word={word} />
      </div>
    );
  return (
    <div className="s34-panel s34-setup">
      <div className="s34-row">
        <StateBand band={band} word={word} />
        {s.ok && (
          <Ring progress={s.hold} size={72} tone="hold" steps={reducedMotion ? 10 : undefined}>
            {s.hold >= 1 ? <CheckIcon name="check" size={32} /> : null}
          </Ring>
        )}
      </div>
      {motionOff && <p className="s34-meta">{t(lang, "assessment.camera.motionOff")}</p>}
      {diagram && <TopView kind={diagram} label={t(lang, "assessment.setup.viewDiagramAlt")} />}
      {waiting && s.waitedSec >= tipsAfterSec && (
        <div className="s34-at-phone">
          <button type="button" className="ghost" onClick={onTips}>
            {t(lang, "assessment.setup.tipsLink")}
          </button>
          {s.waitedSec >= skipAfterSec && (
            <button type="button" className="ghost" onClick={onSkip}>
              {t(lang, "assessment.setup.skipAfterWait")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ S34d calibrate */

export function CalibratePanel({
  snap,
  lang,
  sideLabel,
  offer,
  reducedMotion,
}: {
  snap: CamSnapshot;
  lang: Lang;
  sideLabel: string | null;
  /** After 20 s without a still window (O35): «سأحاول مرة أخرى» and skip, as big tap buttons. */
  offer: { onTryAgain(): void; onSkip(): void } | null;
  reducedMotion: boolean;
}) {
  if (offer && snap.calibrationOffer)
    return (
      <div className="s34-panel s34-offer">
        <StateBand band="info" word={t(lang, "assessment.hud.phase.still")} />
        <div className="s34-at-phone">
          <button type="button" className="cta s34-zone-button" onClick={offer.onTryAgain}>
            {t(lang, "assessment.setup.stillness.tryAgain")}
          </button>
          <button type="button" className="ghost s34-zone-button" onClick={offer.onSkip}>
            {t(lang, "assessment.common.skipTest")}
          </button>
        </div>
      </div>
    );
  const word: PhaseWord = snap.phaseWord === "upright" ? "upright" : "still";
  return (
    <div className="s34-panel s34-calibrate">
      {sideLabel && <p className="s34-side">{sideLabel}</p>}
      <div className="s34-main-row">
        <Ring progress={snap.calibrateHold} size={112} tone="hold" steps={reducedMotion ? 10 : undefined}>
          {snap.calibrateHold >= 1 ? <CheckIcon name="check" size={48} /> : null}
        </Ring>
      </div>
      <StateBand band="info" word={t(lang, PHASE_KEY[word])} />
    </div>
  );
}

/* ------------------------------------------------------------ S34e and S34g1 range */

export function RangePanel({
  snap,
  lang,
  side,
  showDegrees,
  reducedMotion,
}: {
  snap: CamSnapshot;
  lang: Lang;
  side: "left" | "right";
  /** O3: live degrees are behind a flag, off at the booth and at home. */
  showDegrees: boolean;
  reducedMotion: boolean;
}) {
  const paused = !!snap.paused;
  const armLabel = t(lang, ARM_KEY[side]);
  if (snap.part === "calibrate")
    return (
      <CalibratePanel
        snap={snap}
        lang={lang}
        sideLabel={armLabel}
        offer={null}
        reducedMotion={reducedMotion}
      />
    );
  if (snap.part === "rest" && snap.rest)
    return <RestPanel snap={snap} lang={lang} next={nextTry(snap, lang)} reducedMotion={reducedMotion} />;
  const word = snap.phaseWord === "rest" ? null : snap.phaseWord;
  return (
    <div className={`s34-panel s34-range${paused ? " is-paused" : ""}`}>
      <div className="s34-row s34-row-top">
        <span className="s34-side">{armLabel}</span>
        {snap.practice ? (
          <span className="s34-badge-practice">{t(lang, "assessment.common.practice")}</span>
        ) : (
          <Dots dots={snap.dots} lang={lang} />
        )}
      </div>
      <div className="s34-main-row">
        {showDegrees && snap.live !== null && (
          <span
            className="s34-degrees"
            role="img"
            aria-label={countPhrase(lang, "deg", Math.round(snap.live))}
          >
            <span aria-hidden="true">{bidiText(lang, `${Math.round(snap.live)}°`)}</span>
          </span>
        )}
        <Ring
          progress={snap.hold}
          size={112}
          tone="hold"
          frozen={paused}
          steps={reducedMotion ? 5 : undefined}
        >
          {snap.holdDone ? <CheckIcon name="check" size={48} /> : null}
        </Ring>
      </div>
      <PhaseLine word={word} lang={lang} paused={paused} />
    </div>
  );
}

function nextTry(snap: CamSnapshot, lang: Lang): string | null {
  const n = snap.dots.filter((d) => d === "saved").length + 1;
  if (n > snap.dots.length) return null;
  return t(lang, "assessment.common.tryOf", { n, total: snap.dots.length });
}

/* ------------------------------------------------------------ S34f and S34g2 timed */

export function TimedPanel({
  snap,
  lang,
  test,
  compact,
  reducedMotion,
}: {
  snap: CamSnapshot;
  lang: Lang;
  test: CamTest;
  compact: boolean;
  reducedMotion: boolean;
}) {
  const def = testDef(test.testId);
  const variants = "variants" in def ? def.variants : [];
  const variant = variants.find((v) => v.id === test.variant) ?? null;
  const sideLabel = test.side === "none" ? null : t(lang, ARM_KEY[test.side]);
  const parts = [sideLabel, variant?.label[lang]].filter((x): x is string => !!x);
  const top = parts.length ? <Parts lang={lang} parts={parts} /> : null;
  const paused = !!snap.paused;
  if (snap.part === "calibrate")
    return (
      <CalibratePanel
        snap={snap}
        lang={lang}
        sideLabel={sideLabel}
        offer={null}
        reducedMotion={reducedMotion}
      />
    );
  if (snap.part === "rest" && snap.rest)
    return <RestPanel snap={snap} lang={lang} next={null} reducedMotion={reducedMotion} />;
  if (snap.countdown !== null && snap.countdown !== "go" && snap.runnerPhase === "ready")
    return (
      <div className="s34-panel s34-timed">
        {top && <p className="s34-side">{top}</p>}
        <div className="s34-main-row">
          <span className="s34-countdown" key={String(snap.countdown)}>
            {bidiText(lang, String(snap.countdown))}
          </span>
        </div>
        <StateBand band="info" word={t(lang, "assessment.hud.phase.ready")} />
      </div>
    );
  if (snap.countdown === "go")
    return (
      <div className="s34-panel s34-timed">
        {top && <p className="s34-side">{top}</p>}
        <div className="s34-main-row">
          <span className="s34-go">{t(lang, "assessment.hud.phase.go")}</span>
        </div>
      </div>
    );
  const trial = snap.runnerPhase === "attempt" || snap.timeUp || snap.kind === "cam.saved";
  const remaining = snap.trialRemaining ?? 30;
  const count = trial ? snap.count : null;
  const size = compact ? 176 : 232;
  return (
    <div className={`s34-panel s34-timed${paused ? " is-paused" : ""}`}>
      {top && <p className="s34-side">{top}</p>}
      <div className="s34-main-row">
        <Ring
          progress={trial ? remaining / 30 : 1}
          size={size}
          tone="time"
          frozen={paused}
          steps={reducedMotion ? 30 : undefined}
        >
          {count !== null && (
            <span
              className="s34-count"
              role="img"
              aria-label={`${t(lang, "assessment.hud.countLabel")} ${formatNumber(lang, count)}`}
            >
              <span aria-hidden="true">{bidiText(lang, String(count))}</span>
            </span>
          )}
        </Ring>
      </div>
      {snap.timeUp || snap.kind === "cam.saved" ? (
        <PhaseLine word={snap.kind === "cam.saved" ? "saved" : "timeUp"} lang={lang} />
      ) : paused ? (
        <PhaseLine word={null} lang={lang} paused />
      ) : trial ? (
        <p className="s34-line40">{tx(lang, "assessment.hud.timeLeft", { s: remaining, unit: "sec" })}</p>
      ) : snap.practice ? (
        <span className="s34-badge-practice">{t(lang, "assessment.common.practice")}</span>
      ) : (
        <PhaseLine word={snap.phaseWord} lang={lang} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ S34g3 side lean */

export function LeanPanel({
  snap,
  lang,
  test,
  otherDots,
  reducedMotion,
}: {
  snap: CamSnapshot;
  lang: Lang;
  test: CamTest;
  otherDots: AttemptDot[];
  reducedMotion: boolean;
}) {
  if (snap.part === "calibrate")
    return (
      <CalibratePanel snap={snap} lang={lang} sideLabel={null} offer={null} reducedMotion={reducedMotion} />
    );
  const me = test.side === "left" ? "left" : "right";
  const left = me === "left" ? snap.dots : otherDots;
  const right = me === "right" ? snap.dots : otherDots;
  const paused = !!snap.paused;
  const resting = snap.part === "rest";
  const centred = snap.phaseWord === "centred" || resting;
  const word: PhaseWord | null =
    snap.phaseWord === "rest" || (resting && snap.phaseWord !== "saved") ? "centred" : snap.phaseWord;
  // No number and no magnitude (spec 4.3, O4): direction, phase and the centre band only.
  return (
    <div className={`s34-panel s34-lean-panel${paused ? " is-paused" : ""}`}>
      <div className="s34-row s34-sides" dir="ltr">
        <span className="s34-side-dots">
          <span className="s34-side" dir="auto">
            {t(lang, SIDE_KEY.left)}
          </span>
          <Dots dots={left} lang={lang} physical />
        </span>
        <span className="s34-side-dots">
          <Dots dots={right} lang={lang} physical />
          <span className="s34-side" dir="auto">
            {t(lang, SIDE_KEY.right)}
          </span>
        </span>
      </div>
      <div className="s34-main-row">
        <LeanArrow
          direction={snap.leanDirection}
          centred={centred}
          phase={word === "return" ? "back" : word === "pause" ? "hold" : "out"}
        />
        {snap.practice && <span className="s34-badge-practice">{t(lang, "assessment.common.practice")}</span>}
      </div>
      <PhaseLine word={word} lang={lang} paused={paused} />
    </div>
  );
}

/* ------------------------------------------------------------ S34h saved */

export function SavedPanel({ snap, lang, timed }: { snap: CamSnapshot; lang: Lang; timed: boolean }) {
  // O28: the attempt's value is never shown here; a timed test keeps its final count visible.
  return (
    <div className="s34-panel s34-saved">
      {!timed && <Dots dots={snap.dots} lang={lang} />}
      <div className="s34-main-row">
        {timed ? (
          <span className="s34-count is-final">{bidiText(lang, String(snap.count))}</span>
        ) : (
          <span className="s34-saved-icon" aria-hidden="true">
            <CheckIcon name="check" size={96} />
          </span>
        )}
      </div>
      <StateBand band="saved" word={t(lang, "assessment.hud.phase.saved")} />
    </div>
  );
}

/* ------------------------------------------------------------ S34i retry */

/**
 * S34i (C30): the reason and the countdown, which starts the next try on its own; "Skip this test" is
 * a text link and STOP is the stage's own. With no try left the ring counts to the next step and the
 * tips stay at hand.
 */
export function RetryPanel({
  snap,
  lang,
  test,
  issue,
  exhausted,
  onSkip,
  onTips,
  reducedMotion,
}: {
  snap: CamSnapshot;
  lang: Lang;
  test: CamTest;
  issue: string;
  exhausted: boolean;
  onSkip(): void;
  onTips(): void;
  reducedMotion: boolean;
}) {
  const fix = fixOf(issue, test.testId, test.side, test.weaker);
  const retry = snap.retry ?? { remaining: 6, total: 6, counting: false };
  const timed = test.testId === "arm_curl_30s" || test.testId === "chair_stand_30s";
  return (
    <div className="s34-panel s34-retry" data-exhausted={exhausted || undefined}>
      <StateBand
        band="adjust"
        icon={exhausted ? "alert-triangle" : "refresh"}
        word={t(lang, FIX_KEY[fix.fix])}
      />
      {exhausted && <p className="s34-meta">{bidiText(lang, reasonText("quality", lang))}</p>}
      {!exhausted && fix.fix === "touched" && (
        <p className="s34-meta">{t(lang, "assessment.retry.touchedHelper")}</p>
      )}
      {!exhausted && fix.fix === "low_fps" && (
        <p className="s34-meta">{t(lang, "assessment.retry.lowFpsBody")}</p>
      )}
      <div className="s34-restart">
        <Ring
          progress={retry.remaining / retry.total}
          size={56}
          tone="time"
          steps={reducedMotion ? retry.total : undefined}
        >
          <span className="s34-ring-num">{bidiText(lang, String(retry.remaining))}</span>
        </Ring>
        {!exhausted && (
          <span className="s34-meta">
            {/* A timed test repeats after the two minute rest (S34j), not after the ring. */}
            {timed
              ? t(lang, "assessment.retry.after2min")
              : tx(lang, "assessment.retry.restartIn", { s: retry.remaining, unit: "sec" })}
          </span>
        )}
      </div>
      <div className="s34-at-phone">
        {exhausted ? (
          <button type="button" className="ghost" onClick={onTips}>
            {t(lang, "assessment.setup.tipsLink")}
          </button>
        ) : (
          <button type="button" className="check-text-button s34-text-button" onClick={onSkip}>
            {t(lang, "assessment.common.skipTest")}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ S34j rest */

export function RestPanel({
  snap,
  lang,
  next,
  wheelchairDiagram,
  reducedMotion,
}: {
  snap: CamSnapshot;
  lang: Lang;
  next: string | null;
  wheelchairDiagram?: boolean;
  reducedMotion: boolean;
}) {
  const rest = snap.rest ?? { remaining: 0, total: 1 };
  return (
    <div className="s34-panel s34-rest">
      <StateBand band="info" icon="clock" word={t(lang, "assessment.hud.phase.rest")} />
      <div className="s34-main-row">
        <Ring
          progress={rest.total ? rest.remaining / rest.total : 0}
          size={160}
          tone="time"
          steps={reducedMotion ? rest.total : undefined}
        >
          <span className="s34-rest-num">{bidiText(lang, String(rest.remaining))}</span>
        </Ring>
        <span className="s34-side">{unitWord(lang, "sec", rest.remaining)}</span>
      </div>
      {next && <p className="s34-side">{bidiText(lang, t(lang, "assessment.rest.after", { next }))}</p>}
      {wheelchairDiagram && (
        <div className="s34-row">
          <TopView kind="side_change_wheelchair" label={t(lang, "assessment.setup.viewDiagramAlt")} />
          <p className="s34-meta">{t(lang, "assessment.hud.sideChangeWheelchair")}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ loading, errors, landscape */

export function LoadingPanel({ text }: { text: string }) {
  return (
    <div className="s34-panel s34-loading" role="status">
      <div className="check-spinner" aria-hidden="true" />
      <p className="s34-side">{text}</p>
    </div>
  );
}

/** A model load failure (S34 Er): Try again, or do the check later. */
export function ModelErrorPanel({
  lang,
  onRetry,
  onLater,
}: {
  lang: Lang;
  onRetry(): void;
  onLater(): void;
}) {
  return (
    <div className="s34-panel s34-error" role="alert">
      <StateBand band="adjust" icon="info" word={t(lang, "assessment.state.error.title")} />
      <p className="s34-meta">{t(lang, "assessment.state.error.body")}</p>
      <div className="s34-at-phone">
        <button type="button" className="cta" onClick={onRetry}>
          {t(lang, "assessment.common.retry")}
        </button>
        <button type="button" className="ghost" onClick={onLater}>
          {t(lang, "assessment.camera.later")}
        </button>
      </div>
    </div>
  );
}

export function UprightPanel({ lang }: { lang: Lang }) {
  return (
    <div className="s34-panel s34-upright">
      <StateBand band="adjust" icon="phone-rotate" word={tx(lang, "assessment.setup.turnUpright")} />
    </div>
  );
}

/* ------------------------------------------------------------ setup tips (S58 on the stage) */

/**
 * The setup tips over the stage (the tips link of S34c and S34i), with Go back: the S58 list of the
 * booth stream (the wheelchair tip first for a wheelchair user), with the test's own distance.
 */
export function TipsSheet({
  lang,
  meters,
  wheelchair,
  onBack,
}: {
  lang: Lang;
  /** The test's distance from the phone (its setup.distanceM). */
  meters: readonly [number, number];
  wheelchair: boolean;
  onBack(): void;
}) {
  // Focus goes to the title, so the sheet opens at its top with the first tips in view (never to Back
  // at its bottom). The sheet ends above the STOP zone: STOP stays visible and reachable.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="s34-sheet" role="dialog" aria-modal="true" aria-labelledby="s34-tips-title">
      <div className="s34-sheet-card">
        <h2 id="s34-tips-title" className="s34-sheet-title" tabIndex={-1} ref={title}>
          {t(lang, "assessment.tips.title")}
        </h2>
        <div className="s34-tips">
          <SetupTipsList wheelchair={wheelchair} meters={{ metersFrom: meters[0], metersTo: meters[1] }} />
        </div>
        <button type="button" className="cta" onClick={onBack}>
          {t(lang, "assessment.tips.back")}
        </button>
      </div>
    </div>
  );
}
