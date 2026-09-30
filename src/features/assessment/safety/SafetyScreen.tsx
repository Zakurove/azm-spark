/**
 * S36 to S40b, the safety screens (UX spec S36 to S40, map 2.7; council O12, O24-2, O24-6, O30, O42):
 * emergency, autonomic dysreflexia, faint, fall (standing and seated forms), stop and seek care, stop
 * for pain. One layout (SafetyScreen of 5.7), filled by safetyView:
 *
 *   top bar     the booth badge and Sound only: no Back and no Exit (the footer is the only way out)
 *   caption     the sentence being spoken
 *   card        cream, a 4 px red band on S36 and S37; the 40 px heading with its icon; on S36 the
 *               ambulance number as 64 px text; every sentence of the data text, the one being read
 *               highlighted; the extra cards (the AD card for SCI, scr_faint_sci and the collapsed AD
 *               card on S38); Listen again; the kept line; the paused line with {when}, or at the booth
 *               the staff line
 *   footer      the 997 call first on S36 and S37 (the only screens that name it, D-016), the 937
 *               call on S40a, then the way out
 *
 * Every sentence is spoken on entry, 800 ms after the heading takes focus (speech.ts: the O12 (4)
 * interim gate for the Arabic body). Nothing waits for the network: the lock is set on the phone and
 * posts are queued by the flow. States: L never (routing is local); E not applicable; Er never shown
 * (posts retry in the background); Off works (banner); Cam not applicable (the camera is off here;
 * the faint question S38b is answered by tap in this build).
 *
 * The faint follow up (S38b) comes after S38 and every fall stop (O42): on S38 20 s after it opened,
 * once the sentence then being spoken has ended (at most 5 s more), or earlier on a touch outside the
 * controls once the S38 speech has ended (R3C-07); on S39 when the screen is touched (at the booth,
 * staff touch it once the person is settled); and from the footer's Continue. S38 says the camera is
 * on while it runs; no camera trigger is armed on S38 or S38b (R3C-06).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { emergencyCallButton } from "../../../movements/assessments";
import type { ScreenProps } from "../screenTypes";
import { CheckShell, type CallLinkProps } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { CameraOnLine } from "../camera/CameraOnLine";
import { sameWords } from "../camera/cues";
import { useCameraWatch } from "../camera/watch";
import { safetyView } from "./content";
import { useLatest, useSpeechSequence, useWakeLock } from "./hooks";
import { BigNumber, SafetyHeading, SentenceStack, TextWithTimes } from "./parts";
import { SAFETY_TIMING } from "./timing";

export function SafetyScreen({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const state = model.state;
  // The time the screen opened: the paused line's {when} is read against it (never re-read later).
  const [openedAt] = useState(() => Date.now());
  const view = state.kind === "safety" ? safetyView(state, model.data, lang, openedAt) : null;
  const key = view ? `${view.id}:${state.kind === "safety" ? state.screen : ""}:${lang}` : "none";
  // S38: the faint question is due (20 s passed) while a sentence was being spoken: it opens at the
  // end of that sentence (R3C-07 (2)).
  const askDue = useRef(false);
  const asked = useRef(false);
  const askFaint = () => {
    if (asked.current) return;
    asked.current = true;
    seqRef.current.stop();
    dispatch({ type: "FAINT_ASK" });
  };
  const seq = useSpeechSequence(view?.speech ?? [], {
    key,
    beforeLine: () => {
      if (!askDue.current) return true;
      askFaint();
      return false;
    },
    onEnd: () => {
      if (askDue.current) askFaint();
    },
  });
  useWakeLock(true);
  // S38: the camera stays on until the faint question is answered (a raised hand in its check in), and
  // the screen says so while it runs (principle 13).
  const cameraOn = useCameraWatch(model, dispatch);

  // S38 (R3C-07): the faint question 20 s after S38 opened. A sentence being spoken then is finished
  // first, at most 5 s more, so no safety sentence is cut mid word; with no voice playing (Sound off,
  // blocked, an error) it opens at 20 s. The "seen seated" camera trigger is not part of the rule. The
  // sequence stops, so the question's own cue takes over.
  const seqRef = useRef(seq);
  seqRef.current = seq;
  useEffect(() => {
    if (!view?.askFaint || view.kind !== "faint") return;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      if (!seqRef.current.speaking()) return askFaint();
      askDue.current = true;
      wait = setTimeout(askFaint, SAFETY_TIMING.faintAskSentenceMs);
    }, SAFETY_TIMING.faintAskAfterMs);
    return () => {
      clearTimeout(timer);
      clearTimeout(wait);
    };
  }, [view?.askFaint, view?.kind]);

  // A touch on the screen opens the faint question (O42), except on a control: on S39 at any time, on
  // S38 once its speech has ended, so its sentences are never cut (R3C-07 (1)).
  const root = useRef<HTMLDivElement>(null);
  const spoken = useLatest(seq.done);
  useEffect(() => {
    if (!view?.askFaint || (view.kind !== "fall" && view.kind !== "faint")) return;
    const faint = view.kind === "faint";
    const el = root.current?.closest(".check-page") ?? document;
    const onDown = (e: Event) => {
      const target = e.target as HTMLElement | null;
      // Controls keep their own action (the call, Listen again, Sound); a touch elsewhere is the cue.
      if (target?.closest("a, button, summary, .check-topbar, .check-footer")) return;
      if (faint && !spoken.current) return;
      if (faint) askFaint();
      else dispatch({ type: "FAINT_ASK" });
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [view?.kind, view?.askFaint]);

  if (!view) return null;
  const calls: CallLinkProps[] = view.calls.map((n) =>
    n === "997"
      ? { number: "997", label: emergencyCallButton(lang).label }
      : { number: "937", label: t(lang, "assessment.common.call937") },
  );
  // The way out continues the check (to S38b or the end question) as the primary; otherwise, below a
  // call control, it is the outlined way out.
  const forward = view.exitForward;
  const exit = { label: view.exitLabel, onClick: () => dispatch({ type: "EXIT" }) };
  return (
    <CheckShell
      exit={false}
      sound
      footer={{
        call: calls,
        ...(forward || calls.length === 0 ? { primary: exit } : { secondary: exit }),
      }}
    >
      <div
        ref={root}
        className={`safety-screen is-${view.kind}`}
        data-screen={view.id}
        data-safety-screen={state.kind === "safety" ? state.screen : undefined}
      >
        <section className={`check-card is-cream safety-card${view.band ? " has-band" : ""}`}>
          <SafetyHeading icon={view.icon} text={view.heading} />
          {view.kind === "faint" && <CameraOnLine on={cameraOn} />}
          {view.kind === "emergency" && <AdJump blocks={view.blocks} />}
          {view.bigNumber && <BigNumber />}
          {view.blocks.map((b) =>
            b.collapsed ? (
              <details key={b.screen} className="safety-collapsed">
                <summary>
                  <span className="safety-collapsed-heading">{bidiText(lang, b.heading ?? "")}</span>
                  <span className="safety-collapsed-first">{bidiText(lang, b.sentences[0] ?? "")}</span>
                </summary>
                <SentenceStack block={b.screen} sentences={b.sentences.slice(1)} current={null} />
              </details>
            ) : b.heading ? (
              <section key={b.screen} className="safety-extra" aria-labelledby={`safety-h-${b.screen}`}>
                <h2
                  id={`safety-h-${b.screen}`}
                  className={seq.mark === `${b.screen}:h` ? "is-current" : undefined}
                  aria-current={seq.mark === `${b.screen}:h` ? "true" : undefined}
                >
                  {bidiText(lang, b.heading)}
                </h2>
                <SentenceStack block={b.screen} sentences={b.sentences} current={seq.mark} />
              </section>
            ) : (
              <SentenceStack
                key={b.screen}
                block={b.screen}
                sentences={b.sentences}
                current={seq.mark}
                skipFirst={b === view.blocks[0] && sameWords(b.sentences[0] ?? "", view.heading)}
              />
            ),
          )}
        </section>
        <button type="button" className="ghost safety-listen" onClick={() => seq.replay(view.listen)}>
          <CheckIcon name="speaker" />
          {t(lang, "assessment.common.listen")}
        </button>
        {view.kept && <p className="check-body safety-kept">{view.kept}</p>}
        {view.paused && (
          <p className="check-body safety-paused">
            <TextWithTimes text={view.paused} />
          </p>
        )}
        {view.boothStaff && <p className="check-body safety-paused">{view.boothStaff}</p>}
      </div>
    </CheckShell>
  );
}

/**
 * O12 (2): on S36 for SCI the AD card's heading and first action must be visible without scrolling.
 * When a larger text setting pushes them below the fold, a 48 px link under the h1 moves focus to the
 * card (assessment.safety.adJump). It is measured after layout and again on resize.
 */
function AdJump({
  blocks,
}: {
  blocks: readonly { screen: string; heading?: string; collapsed?: boolean }[];
}) {
  const { lang } = useCheckUi();
  const ad = blocks.find((b) => b.screen === "scr_ad" && b.heading && !b.collapsed);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    if (!ad) return;
    const measure = () => {
      const card = document.getElementById("safety-h-scr_ad")?.parentElement;
      const first = card?.querySelector("h2 + *") ?? card?.querySelector("h2");
      if (!first) return setBelow(false);
      const footer = document.querySelector<HTMLElement>(".check-footer");
      const fold = Math.min(window.innerHeight, footer?.getBoundingClientRect().top ?? window.innerHeight);
      setBelow(first.getBoundingClientRect().bottom > fold);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ad?.screen, lang]);
  if (!ad || !below) return null;
  return (
    <a
      className="safety-ad-jump"
      href="#safety-h-scr_ad"
      onClick={(e) => {
        e.preventDefault();
        const h = document.getElementById("safety-h-scr_ad");
        if (!h) return;
        h.tabIndex = -1;
        h.scrollIntoView({ block: "start" });
        h.focus();
      }}
    >
      {t(lang, "assessment.safety.adJump")}
    </a>
  );
}
