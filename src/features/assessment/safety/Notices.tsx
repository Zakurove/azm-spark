/**
 * S42 "That is fine" after a stop, S46 the skip notice and S46b next test or results now (UX spec S42,
 * S46, S46b; council O43, Q19 (7), P6). Screens at the phone, in the check shell.
 *
 * S42  After a stop for tiredness, choice or something else: the reason in plain words (after tired its
 *      own line, R3C-20); after tired and other a one minute rest (check_rest_minute) with a ring,
 *      during which "Start the next test now" stays enabled (primaries are never disabled). End
 *      today's check goes to the end question. "Change my reason" returns to the stop list. The
 *      stopped test is measured again at the next check (O43: no same day redo). After a second no
 *      response alarm no next test is offered (R3C-02 (2)).
 * S46  Confirms a skip in plain words: the title by what skipped it, one row per skipped test and side
 *      with its reason. Continue goes on (the flow's continuation).
 * S46b A guest after each test: two equally prominent buttons, the next test's name under the first.
 *
 * States: L, E, Er, Cam not applicable (nothing waits); Off works (the banner shows).
 */
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA, reasonText } from "../../../movements/assessments";
import type { ReasonId } from "../../../movements/types";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { isLastTest, skipNoticeView, testName } from "./content";
import { useCountdown, useSpeechSequence } from "./hooks";
import { CountdownRing } from "./parts";
import { cueSpeech } from "./speech";
import { SAFETY_TIMING } from "./timing";

/* ------------------------------------------------------------------ S42 */

export function StopDone({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const s = model.state.kind === "stopDone" ? model.state : null;
  const rest = s?.restSec === 60;
  const totalMs = SAFETY_TIMING.stopRestSec * 1000;
  const left = useCountdown(totalMs, rest);
  useSpeechSequence(rest ? [cueSpeech("check_rest_minute", lang)] : [], { key: `S42:${rest}:${lang}` });
  if (!s) return null;
  // Testing ended for today (a second no response alarm): the check ends through S49 (R3C-02 (2)).
  const last = isLastTest(model.data, s.i) || model.data.testingEnded;
  const resting = rest && left > 0;
  const primary = last
    ? t(lang, "assessment.stopDone.finish")
    : resting
      ? t(lang, "assessment.rest.nextNow")
      : t(lang, "assessment.stopDone.next");
  // S42 follows only a stop the person chose (tired, something else, just wanted to stop). The data
  // stores tired and something else as stopped_symptom, whose text says we stopped for safety; here the
  // person stopped. After tired the display only line stopped_tired (R3C-20); after something else the
  // by_choice text. The stored reason is unchanged.
  const shownReason = s.reason === "stopped_symptom" ? "by_choice" : s.reason;
  const reason =
    s.option === "tired"
      ? t(lang, "assessment.stopDone.tired")
      : shownReason in CHECK_DATA.reasons
        ? reasonText(shownReason as ReasonId, lang)
        : null;
  const seconds = Math.ceil(left / 1000);
  return (
    <CheckShell
      sound
      footer={{
        primary: { label: primary, onClick: () => dispatch({ type: "STOP_NEXT" }) },
        ...(last
          ? {}
          : {
              secondary: {
                label: t(lang, "assessment.stopDone.end"),
                onClick: () => dispatch({ type: "STOP_END" }),
              },
            }),
      }}
    >
      <div className="safety-notice" data-screen="S42">
        <h1>{t(lang, "assessment.stopDone.title")}</h1>
        {reason && <p className="check-body">{bidiText(lang, reason)}</p>}
        {rest && (
          <section className="check-card is-info safety-rest">
            <CountdownRing
              leftMs={left}
              totalMs={totalMs}
              size={96}
              label={<bdi>{bidiText(lang, String(seconds))}</bdi>}
            />
            <p className="check-body">
              {t(lang, last ? "assessment.stopDone.restLast" : "assessment.stopDone.rest")}
            </p>
          </section>
        )}
        <button
          type="button"
          className="check-text-button"
          onClick={() => dispatch({ type: "CHANGE_REASON" })}
        >
          {t(lang, "assessment.stopDone.changeReason")}
        </button>
      </div>
    </CheckShell>
  );
}

/* ------------------------------------------------------------------ S46 */

export function SkipNotice({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const s = model.state.kind === "skipNotice" ? model.state : null;
  const view = skipNoticeView(s?.rows ?? [], lang);
  useSpeechSequence(view.cue ? [cueSpeech(view.cue, lang)] : [], { key: `S46:${view.title}` });
  return (
    <CheckShell
      sound
      footer={{
        primary: {
          label: t(lang, "assessment.common.continue"),
          onClick: () => dispatch({ type: "CONTINUE" }),
        },
      }}
    >
      <div className="safety-notice" data-screen="S46">
        <div role="status">
          <h1>{bidiText(lang, view.title)}</h1>
        </div>
        {view.rows.length > 0 && (
          <ul className="check-card safety-skip-rows">
            {view.rows.map((r) => (
              <li key={r.key}>
                <p className="check-h2">
                  {bidiText(lang, r.test)}
                  {r.side && <span className="safety-skip-side"> {bidiText(lang, r.side)}</span>}
                </p>
                {r.reason && <p className="check-body">{bidiText(lang, r.reason)}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </CheckShell>
  );
}

/* ------------------------------------------------------------------ S46b */

export function GuestAfterTest({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const s = model.state.kind === "guestAfterTest" ? model.state : null;
  const run = s ? model.data.tests[s.next] : undefined;
  const [next, results] = CHECK_DATA.selection.guestBooth.afterEachTest.buttons;
  return (
    <CheckShell sound={false}>
      <div className="safety-notice" data-screen="S46b">
        <h1>{t(lang, "assessment.guest.afterTest.title")}</h1>
        <div className="safety-equal">
          <button type="button" className="cta" onClick={() => dispatch({ type: "GUEST_NEXT_TEST" })}>
            {bidiText(lang, next.label[lang])}
          </button>
          {run && (
            <p className="check-meta">
              {bidiText(
                lang,
                t(lang, "assessment.guest.afterTest.upNext", { test: testName(run.testId, lang) }),
              )}
            </p>
          )}
          <button type="button" className="cta" onClick={() => dispatch({ type: "GUEST_RESULTS" })}>
            {bidiText(lang, results.label[lang])}
          </button>
        </div>
      </div>
    </CheckShell>
  );
}
