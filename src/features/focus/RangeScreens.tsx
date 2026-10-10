/**
 * The range screens of the focus check (product v7 plan 1.5 and 1.7, contract B3): a block's card, a
 * movement's setup card (the picture and the instructions), the measurement (the camera, the live range
 * meter against the typical band with its hold ring, no number on it since D-036 item 4, the questions
 * with their large buttons), the result of the movement (its words, the degrees small), the pain stop,
 * the rests and the sit before stand minute.
 *
 * The questions keep their buttons on screen whatever the coach does (rom-protocol 1.1 step 5): the
 * maximum question's three answers are the v1 answer zones (contract section 7), large enough to be
 * tapped by a helper or the booth staff while the person holds the end of the movement.
 */
import { useEffect, useMemo, useRef } from "react";
import type { Lang } from "../../app/i18n";
import { localizeDigits, t } from "../../i18n";
import { bidiText } from "../../i18n/rich";
import { tV7 } from "../../i18n/v7";
import type { RomMeasureResult } from "../../engine/rom/types";
import type { Frame } from "../../engine/types";
import { movementLandmarks } from "../../engine/rom/quality";
import type { RomBlock, RomProtocolItem } from "../../medical/rom-protocol";
import type { Intake, Sex } from "../../medical/plan";
import { movementDef } from "../../movements/rom";
import { RUNNER_RULES } from "../../engine/rom/runner";
import CheckIcon from "../assessment/shared/CheckIcon";
import { AnswerZones } from "../assessment/safety/parts";
import { useFoldFit } from "../assessment/safety/hooks";
import { copyText, instructionLines, lineText, movementName, positionName, resultView } from "./copy";
import { RangeMeter, type MeterReading } from "./Dial";
import { MovementPicture } from "./MovementPicture";
import { Actions, Body, Choices, Dots, Glass, Kicker, PainScale, Timer, Title } from "./parts";
import type { RomController } from "./romController";
import { QuestionText, sideRegion } from "./Screens";
import { Stage } from "./Stage";
import type { RomSaved } from "./api";

const BLOCK_TITLE: Record<
  RomBlock,
  "rom.block.seatedTitle" | "rom.block.standingTitle" | "rom.block.lyingTitle"
> = {
  seated: "rom.block.seatedTitle",
  standing: "rom.block.standingTitle",
  lying: "rom.block.lyingTitle",
};

/**
 * A block's card (C-16 confirm): the position, the movements, the support, helper and neck lines. The
 * v1 warnings no longer repeat here before every block (D-032 item 2): the intro says them once. D-034
 * item 5: its title says nothing has started yet, and its Ready is always on screen (sticky).
 */
export function BlockCard({
  lang,
  block,
  items,
  helper,
  stage,
  waiting = false,
  cameraError = false,
  onNoCamera,
  onReady,
}: {
  lang: Lang;
  block: RomBlock;
  items: RomProtocolItem[];
  helper: boolean;
  /** The camera's preview (the probe runs while it shows). */
  stage: React.ReactNode;
  /**
   * The camera's model probe of this block has not ended (C-10: the model is chosen before the block
   * measures, never mid attempt): «جاهز» waits for it.
   */
  waiting?: boolean;
  /** The camera cannot open (refused, none, busy): a calm line, and the way on without it. */
  cameraError?: boolean;
  /** D-032 item 3, a person whose program waits for the check: «لا أستطيع استخدام الكاميرا». */
  onNoCamera?: () => void;
  onReady(): void;
}) {
  const positions = [...new Set(items.map((i) => i.position))];
  const neck = items.some((i) => i.region === "neck");
  return (
    <div className="fx-split">
      <Glass className="fx-card fx-block">
        <Kicker>{tV7(lang, BLOCK_TITLE[block])}</Kicker>
        <Title>{tV7(lang, "rom.block.notStarted")}</Title>
        <div className="fx-chips">
          {positions.map((p) => (
            <span key={p} className="fx-pill">
              {positionName(p, lang)}
            </span>
          ))}
        </div>
        {/* A compact list: on this card the camera's picture matters most (the intro showed the joints). */}
        <ol className="fx-block-moves">
          {items.map((i, k) => (
            <li key={`${i.movementId}:${i.side}`}>
              <b aria-hidden="true">{localizeDigits(lang, String(k + 1))}</b>
              <span>{movementName(i.movementId, lang)}</span>
              <small>{sideRegion(i, lang)}</small>
            </li>
          ))}
        </ol>
        {block === "standing" && <Note lang={lang} icon="shield" text={copyText("support_line", lang)} />}
        {helper && <Note lang={lang} icon="people" text={copyText("helper_line", lang)} />}
        {/* Lying 2 to 3 m from the phone, the person does not get up to tap: someone beside taps. */}
        {block === "lying" && <Note lang={lang} icon="people" text={tV7(lang, "rom.block.lyingHelper")} />}
        {neck && <Note lang={lang} icon="alert-triangle" text={copyText("neck_stop_line", lang)} />}
      </Glass>
      <div className="fx-side">
        <Glass className="fx-card fx-preview">
          {stage}
          <p className="fx-meta">
            <CheckIcon name="camera" size={20} />
            <span>{tV7(lang, "rom.block.camera")}</span>
          </p>
          {waiting && !cameraError && (
            <p className="fx-meta" role="status" data-wait="camera">
              <span className="fx-spinner is-small" aria-hidden="true" />
              <span>{tV7(lang, "rom.block.cameraWait")}</span>
            </p>
          )}
          {cameraError && (
            <p className="fx-note" role="status" data-camera="error">
              <CheckIcon name="camera" size={20} />
              <span>{bidiText(lang, tV7(lang, "rom.block.cameraError"))}</span>
            </p>
          )}
        </Glass>
      </div>
      <Actions
        sticky
        items={[
          cameraError && onNoCamera
            ? {
                label: tV7(lang, "rom.onboarding.noCamera"),
                onClick: onNoCamera,
                kind: "secondary",
                name: "no_camera",
              }
            : null,
          {
            label: tV7(lang, helper || block === "lying" ? "rom.block.helperReady" : "rom.block.ready"),
            onClick: onReady,
            name: "ready",
            icon: "check",
            busy: waiting,
            disabled: waiting,
          },
        ]}
      />
    </div>
  );
}

function Note({ lang, icon, text }: { lang: Lang; icon: string; text: string }) {
  return (
    <p className="fx-note">
      <CheckIcon name={icon} size={20} />
      <span>{bidiText(lang, text)}</span>
    </p>
  );
}

/**
 * A movement's setup card (C-16 confirm, rom-protocol 1.1 step 1): the picture, the instructions, and
 * who stands beside. The safety lines the intro and the block's card already say are not repeated on
 * every movement (D-032 item 2). D-034 item 5: it says the movement has not started, and its Ready is
 * always on screen (sticky); the measurement then opens with «لنبدأ».
 */
export function SetupCard({
  lang,
  item,
  n,
  total,
  turnSide,
  wheelchair = false,
  onReady,
}: {
  lang: Lang;
  item: RomProtocolItem;
  n: number;
  total: number;
  turnSide: boolean;
  wheelchair?: boolean;
  onReady(): void;
}) {
  const steps = instructionLines(item.movementId, item.side, item.position, lang);
  return (
    <div className="fx-split" data-movement={item.movementId}>
      <Glass className="fx-card fx-figure">
        <div className="fx-figure-head">
          <Kicker>{tV7(lang, "rom.setup.kicker", { n, total })}</Kicker>
          <span className="fx-pill is-waiting" data-state="not-started">
            {tV7(lang, "rom.setup.notStarted")}
          </span>
        </div>
        <div className="fx-figure-art">
          <MovementPicture
            movementId={item.movementId}
            side={item.side}
            lang={lang}
            size={208}
            wheelchair={wheelchair}
          />
        </div>
        <Title>{movementName(item.movementId, lang)}</Title>
        <div className="fx-chips">
          <span className="fx-pill is-violet">{sideRegion(item, lang)}</span>
          <span className="fx-pill">{positionName(item.position, lang)}</span>
        </div>
      </Glass>
      <div className="fx-side">
        <Glass className="fx-card">
          {turnSide && <Note lang={lang} icon="phone-rotate" text={copyText("turn_side", lang)} />}
          <ol className="fx-steps">
            {steps.map((s, i) => (
              <li key={i}>{bidiText(lang, s)}</li>
            ))}
          </ol>
          {item.helperRequired && <Note lang={lang} icon="people" text={copyText("helper_line", lang)} />}
        </Glass>
      </div>
      <Actions
        sticky
        items={[{ label: tV7(lang, "rom.setup.ready"), onClick: onReady, name: "ready", icon: "play" }]}
      />
    </div>
  );
}

/** The same joint re-ask (contract 2.6): the pain now, before the next movement of the joint. */
export function ReaskScreen({
  lang,
  item,
  onAnswer,
}: {
  lang: Lang;
  item: RomProtocolItem;
  onAnswer(n: number): void;
}) {
  return (
    <>
      <Glass className="fx-card fx-question" data-reask={item.movementId}>
        <Kicker>{sideRegion(item, lang)}</Kicker>
        <QuestionText lang={lang} id="fx-reask" text={copyText("pain_ask", lang)} />
        <PainScale
          lang={lang}
          labelledBy="fx-reask"
          nextLabel={t(lang, "assessment.common.next")}
          onDone={onAnswer}
        />
      </Glass>
    </>
  );
}

export interface MeasureProps {
  lang: Lang;
  ctl: RomController;
  item: RomProtocolItem;
  n: number;
  total: number;
  video: HTMLVideoElement | null;
  frame: { current: Frame | null };
  /** The frames' clock, for the taps. */
  clock(): number;
  /** The time of the last redraw (the countdowns). */
  now: number;
}

/**
 * The measurement (rom-protocol 1.1): the camera with the body's lines, the range meter with the
 * typical band and the hold ring (no number, D-036 item 4), the phase's prompt, the correction caption,
 * the questions. No STOP since D-034 item 4: the X at the top opens the stop and leave options.
 *
 * The meter reads the controller each animation frame (`read`): a new angle does not render this
 * screen, only a new phase, caption or question does.
 */
export function MeasureScreen({ lang, ctl, item, n, total, video, frame, clock, now }: MeasureProps) {
  const phase = ctl.phase ?? "idle";
  const def = movementDef(item.movementId);
  const norm = ctl.norm(item);
  const hold = ctl.hold;
  const highlight = useMemo(() => movementLandmarks(def, item.side).gate, [def, item.side]);
  const att = ctl.attempt;
  // D-035: one valid attempt records the value; a second only when the person asks for it.
  const scored = Math.max(RUNNER_RULES.validAttempts, att.index);
  const caption = ctl.caption;
  const issue = phase === "calibrating" ? ctl.setupIssue : null;
  const asking =
    phase === "ask_max" || phase === "ask_pain" || phase === "ask_cause" || phase === "ask_can_move";
  // Pause has focus when the measurement opens and again when a question closes (STOP had it before
  // D-034 item 4); a question that opens takes it (QuestionText).
  const pauseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!asking) pauseRef.current?.focus({ preventScroll: true });
  }, [asking]);
  // The live reading, taken by the meter each animation frame (never React state at frame rate).
  const read = useRef<() => MeterReading>(() => ({ value: null, hold: null }));
  read.current = () => {
    const now = ctl.phase;
    if (now === "calibrating" || now === "paused") return { value: null, hold: null };
    return { value: ctl.live, hold: now === "attempt" || now === "practice" ? ctl.holdProgress : null };
  };
  const meterLabels = {
    band: tV7(lang, "rom.measure.band"),
    you: tV7(lang, "rom.measure.you"),
    hold: tV7(lang, "rom.measure.hold"),
  };
  // D-034 item 5: after Ready the measurement says «لنبدأ» clearly (and the voice says it, FocusApp),
  // with the start position under it, before the first attempt.
  const prompt =
    phase === "calibrating"
      ? tV7(lang, "rom.measure.letsStart")
      : phase === "practice"
        ? tV7(lang, "rom.measure.practice")
        : phase === "attempt"
          ? tV7(lang, att.index > RUNNER_RULES.validAttempts ? "rom.measure.again" : "rom.measure.now")
          : phase === "rest"
            ? tV7(lang, "rom.measure.rest")
            : phase === "paused"
              ? tV7(lang, "rom.measure.paused")
              : "";
  const sub =
    phase === "practice"
      ? copyText("practice", lang)
      : phase === "attempt"
        ? tV7(lang, "rom.measure.move")
        : phase === "calibrating"
          ? tV7(lang, "rom.measure.start")
          : "";
  const restLeft = phase === "rest" ? ctl.restLeft(now) : 0;
  // v1's 2 m sizes (UX spec 4.1), stepped down only as far as the answers need to fit above STOP: a
  // person 2 to 3 m from the phone cannot scroll or read small type (v1 useFoldFit levels).
  const root = useRef<HTMLDivElement>(null);
  const fit = useFoldFit(root, 3, `${phase}|${caption ?? ""}|${issue ?? ""}|${lang}`);
  return (
    <div
      ref={root}
      className="fx-measure"
      data-fit={fit}
      data-phase={phase}
      data-movement={item.movementId}
      data-asking={asking ? (phase === "ask_max" ? "max" : "other") : undefined}
    >
      <Stage video={video} frame={frame} highlight={highlight}>
        <div className="fx-stage-top">
          <span className="fx-pill is-glass">
            <b>{movementName(item.movementId, lang)}</b>
            <span>{sideRegion(item, lang)}</span>
          </span>
        </div>
        {ctl.instructionsOpen && !asking && (
          <div
            className="fx-stage-sheet"
            id="fx-instructions"
            role="region"
            aria-label={tV7(lang, "rom.measure.instructions")}
          >
            <ol className="fx-steps">
              {instructionLines(item.movementId, item.side, item.position, lang).map((line, i) => (
                <li key={i}>{bidiText(lang, line)}</li>
              ))}
            </ol>
          </div>
        )}
        {(caption || issue) && (
          <p className={`fx-caption${caption ? " is-warn" : ""}`} role="status">
            {bidiText(
              lang,
              caption ? lineText(caption, lang) : t(lang, `assessment.setup.issue.${issue}` as never),
            )}
          </p>
        )}
      </Stage>
      <Glass className="fx-card fx-sheet">
        <div className="fx-sheet-head">
          <div className="fx-sheet-where">
            <span className="fx-count">{tV7(lang, "rom.setup.kicker", { n, total })}</span>
            <Dots lang={lang} total={scored} index={att.index} valid={att.valid} />
          </div>
          <div className="fx-sheet-tools">
            {!asking && (
              <button
                type="button"
                className="fx-chip is-icon"
                onClick={() => ctl.showInstructions(!ctl.instructionsOpen)}
                aria-pressed={ctl.instructionsOpen}
                aria-controls={ctl.instructionsOpen ? "fx-instructions" : undefined}
                aria-label={tV7(
                  lang,
                  ctl.instructionsOpen ? "rom.measure.hideInstructions" : "rom.measure.instructions",
                )}
                data-action="instructions"
              >
                <CheckIcon name="info" size={22} />
              </button>
            )}
            {(phase === "practice" || phase === "attempt" || phase === "calibrating" || phase === "rest") && (
              <button
                ref={pauseRef}
                type="button"
                className="fx-chip"
                onClick={() => ctl.pause("screen", clock())}
                data-action="pause"
              >
                <CheckIcon name="pause" size={20} />
                <span>{tV7(lang, "rom.measure.pause")}</span>
              </button>
            )}
          </div>
        </div>
        {phase === "rest" && (
          <div className="fx-sheet-body is-rest">
            <Timer lang={lang} leftMs={restLeft} totalMs={ctl.restTotal()} size={150} />
            <div className="fx-prompt">
              <p className="fx-prompt-main">{prompt}</p>
              {att.valid > 0 && <p className="fx-prompt-sub">{bidiText(lang, copyText("recorded", lang))}</p>}
            </div>
          </div>
        )}
        {!asking && phase !== "rest" && (
          <div className="fx-sheet-body">
            <RangeMeter
              lang={lang}
              kind={def.kind}
              mode="live"
              read={() => read.current()}
              typical={norm.typical}
              withinFrom={norm.withinFrom}
              withinUpTo={norm.withinUpTo}
              labels={meterLabels}
            />
            <div className="fx-prompt" data-fold>
              {prompt && <p className="fx-prompt-main">{prompt}</p>}
              {sub && <p className="fx-prompt-sub">{bidiText(lang, sub)}</p>}
              {phase === "paused" && (
                <Actions
                  items={[
                    {
                      label: tV7(lang, "rom.measure.resume"),
                      onClick: () => ctl.resume("screen", clock()),
                      name: "resume",
                      icon: "play",
                    },
                  ]}
                />
              )}
            </div>
          </div>
        )}
        {phase === "ask_max" && hold && (
          <Question
            lang={lang}
            id="fx-ask-max"
            text={copyText("ask_max", lang)}
            held={
              <RangeMeter
                lang={lang}
                kind={def.kind}
                mode="held"
                value={hold.deg}
                typical={norm.typical}
                withinFrom={norm.withinFrom}
                withinUpTo={norm.withinUpTo}
                labels={meterLabels}
              />
            }
          >
            <div className="fx-v1 fx-zones" data-fold>
              <AnswerZones
                labelledBy="fx-ask-max"
                options={[
                  { value: "yes", label: copyText("ans_yes", lang), icon: "check", commitAtOnce: true },
                  {
                    value: "not_yet",
                    label: copyText("ans_not_yet", lang),
                    icon: "arrow-up",
                    commitAtOnce: true,
                  },
                  {
                    value: "hurts",
                    label: copyText("ans_hurts", lang),
                    icon: "alert-triangle",
                    commitAtOnce: true,
                  },
                ]}
                onAnswer={(v) => ctl.answerMax(v as "yes" | "not_yet" | "hurts", "button", clock())}
              />
            </div>
          </Question>
        )}
        {phase === "ask_can_move" && (
          <Question lang={lang} id="fx-can-move" text={copyText("can_move_ask", lang)}>
            <div className="fx-v1 fx-zones" data-fold>
              <AnswerZones
                labelledBy="fx-can-move"
                options={[
                  { value: "yes", label: copyText("ans_yes", lang), icon: "check", commitAtOnce: true },
                  { value: "no", label: copyText("ans_no", lang), icon: "close", commitAtOnce: true },
                ]}
                onAnswer={(v) => ctl.answerCanMove(v === "yes", clock())}
              />
            </div>
          </Question>
        )}
        {phase === "ask_pain" && (
          <Question lang={lang} id="fx-pain" text={copyText("pain_ask", lang)}>
            <PainScale
              lang={lang}
              labelledBy="fx-pain"
              readout={false}
              nextLabel={t(lang, "assessment.common.next")}
              onDone={(level) => ctl.answerPain(level, false, "button", clock())}
            />
          </Question>
        )}
        {phase === "ask_cause" && (
          <Question lang={lang} id="fx-cause" text={copyText("what_stopped_ask", lang)}>
            <Choices
              lang={lang}
              labelledBy="fx-cause"
              choices={[
                { value: "tight", label: copyText("what_stopped_tight", lang) },
                { value: "pain", label: copyText("what_stopped_pain", lang) },
                { value: "weak", label: copyText("what_stopped_weak", lang) },
              ]}
              onPick={(v) => ctl.answerCause(v as "tight" | "pain" | "weak", "button", clock())}
            />
          </Question>
        )}
      </Glass>
    </div>
  );
}

function Question({
  lang,
  id,
  text,
  held,
  children,
}: {
  lang: Lang;
  id: string;
  text: string;
  /** The held position, on a small meter (no number on the live screen, D-036 item 4). */
  held?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="fx-ask" data-question={id}>
      {held && <div className="fx-held">{held}</div>}
      <QuestionText lang={lang} id={id} text={text} as="h2" />
      {children}
    </div>
  );
}

/** A pain stop (C-15, a safety step): the movement stops; the person taps on. */
export function PainStopScreen({
  lang,
  item,
  onContinue,
}: {
  lang: Lang;
  item: RomProtocolItem;
  onContinue(): void;
}) {
  return (
    <>
      <Glass className="fx-card fx-safety is-pain" tone="rose">
        <span className="fx-badge is-rose" aria-hidden="true">
          <CheckIcon name="pause" size={28} />
        </span>
        <Kicker>{`${movementName(item.movementId, lang)} · ${sideRegion(item, lang)}`}</Kicker>
        <Title>{tV7(lang, "rom.painStop.title")}</Title>
        <Body lang={lang} text={copyText("pain_stop", lang)} />
        <Actions
          items={[{ label: t(lang, "assessment.common.continue"), onClick: onContinue, name: "continue" }]}
        />
      </Glass>
    </>
  );
}

/**
 * The result of one movement (plan 1.7): «Your knee bends to 95 degrees; typical for you is about 135».
 * D-036 item 4: the words lead (the label and the line); the meter settles where the person reached,
 * and the degrees are small under it.
 */
export function ResultScreen({
  lang,
  ctl,
  item,
  result,
  saved,
  intake,
  last,
  onNext,
  onAgain,
}: {
  lang: Lang;
  ctl: RomController;
  item: RomProtocolItem;
  result: RomMeasureResult;
  saved: RomSaved | null;
  intake: (Intake & { sex: Sex }) | null;
  last: boolean;
  onNext(): void;
  /** D-035: «حاول مرة أخرى», when the card may offer one more try (ctl.canTryAgain). */
  onAgain?: () => void;
}) {
  const def = movementDef(item.movementId);
  const norm = ctl.norm(item);
  // The server's grade once it answered (C-3); the same pure grade on the phone before that.
  const finding = saved?.grade.finding ?? ctl.findingOf(result);
  // The server's typical once it answered (null for a position without a graded norm: never another
  // position's), the phone's own before that.
  const typical = saved ? saved.typical : norm.typical;
  const view = resultView(item, result, finding, typical, intake, lang, (k) =>
    tV7(lang, `rom.${k}` as never),
  );
  const reached = view.value === null || result.value === null ? null : result.value;
  const tries = result.attempts.filter((a) => a.outcome === "valid");
  return (
    <div className="fx-split fx-result" data-finding={view.finding} data-value={result.value ?? ""}>
      <Glass className="fx-card fx-figure">
        <Kicker>{tV7(lang, "rom.result.kicker")}</Kicker>
        <Title>{movementName(item.movementId, lang)}</Title>
        <span className="fx-pill is-violet">{sideRegion(item, lang)}</span>
        {reached !== null ? (
          <RangeMeter
            lang={lang}
            kind={def.kind}
            mode="final"
            value={Math.max(0, reached)}
            typical={view.typical}
            withinFrom={norm.withinFrom}
            withinUpTo={norm.withinUpTo}
            labels={{
              band: tV7(lang, "rom.measure.band"),
              you: tV7(lang, "rom.measure.you"),
              hold: tV7(lang, "rom.measure.hold"),
            }}
            degrees={
              <>
                <bdi dir="ltr">{`${Math.abs(reached)}°`}</bdi>
                {def.kind === "lack" && <span>{tV7(lang, "rom.measure.fromStraight")}</span>}
              </>
            }
          />
        ) : (
          <div className="fx-figure-art">
            <MovementPicture
              movementId={item.movementId}
              side={item.side}
              lang={lang}
              size={160}
              wheelchair={intake?.mobility === "wheelchair"}
            />
          </div>
        )}
        {view.label && <span className={`fx-label is-${view.finding}`}>{view.label}</span>}
      </Glass>
      <div className="fx-side">
        <Glass className="fx-card">
          <p className="fx-result-line">{bidiText(lang, view.line)}</p>
          {view.notes.length > 0 && (
            <div className="fx-chips">
              {view.notes.map((n) => (
                <span key={n} className="fx-pill">
                  {n}
                </span>
              ))}
            </div>
          )}
          {view.more.map((m) => (
            <p key={m} className="fx-note">
              <CheckIcon name="info" size={20} />
              <span>{bidiText(lang, m)}</span>
            </p>
          ))}
          {result.flags.includes("censored") && result.value !== null && (
            <p className="fx-note" data-note="censored">
              <CheckIcon name="shield" size={20} />
              <span>{bidiText(lang, tV7(lang, "rom.result.censored"))}</span>
            </p>
          )}
          {tries.length > 0 && (
            <div className="fx-tries">
              <span>{tV7(lang, "rom.result.tries")}</span>
              <ol>
                {tries.map((a) => (
                  <li key={a.index} dir="ltr">
                    {bidiText(lang, String(Math.abs(a.value ?? 0)))}°
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Glass>
        <Actions
          items={[
            onAgain &&
              ctl.canTryAgain && {
                label: tV7(lang, "rom.result.again"),
                onClick: onAgain,
                kind: "quiet",
                name: "again",
                icon: "refresh",
              },
            {
              label: tV7(lang, last ? "rom.result.finish" : "rom.result.next"),
              onClick: onNext,
              name: "next",
              icon: "arrow-forward",
            },
          ]}
        />
      </div>
    </div>
  );
}

/** The rest after a stop for tiredness or something else, and the sit before stand minute (timers). */
export function TimerScreen({
  lang,
  kind,
  leftMs,
  totalMs,
  last,
  standing = false,
  onNext,
}: {
  lang: Lang;
  kind: "rest" | "sit";
  leftMs: number;
  totalMs: number;
  /** The lying block's last measurement, shown in the sit minute (it went straight into it). */
  last?: { item: RomProtocolItem; result: RomMeasureResult };
  /** The sit minute is over: «يمكنك الوقوف الآن ببطء» and the way on. */
  standing?: boolean;
  onNext?: () => void;
}) {
  const lastValue = last && last.result.value !== null ? Math.abs(last.result.value) : null;
  return (
    <div className="fx-timer-screen" data-timer={kind} data-standing={standing || undefined}>
      <Glass className="fx-card fx-hero">
        <span className="fx-badge is-violet" aria-hidden="true">
          <CheckIcon name={kind === "sit" ? "shield" : "clock"} size={28} />
        </span>
        <Title>{tV7(lang, kind === "sit" ? "rom.sit.title" : "rom.stopRest.title")}</Title>
        {kind === "sit" && !standing && <Body lang={lang} text={copyText("sit_before_stand", lang)} />}
        {standing ? (
          <p className="fx-sit-done" role="status">
            {bidiText(lang, tV7(lang, "rom.sit.done"))}
          </p>
        ) : (
          <Timer lang={lang} leftMs={leftMs} totalMs={totalMs} size={184} />
        )}
        {last && (
          <p className="fx-sit-last" data-movement={last.item.movementId}>
            <small>{tV7(lang, "rom.sit.last")}</small>
            <b>{movementName(last.item.movementId, lang)}</b>
            <span>{sideRegion(last.item, lang)}</span>
            {lastValue !== null && <em dir="ltr">{`${localizeDigits(lang, String(lastValue))}°`}</em>}
          </p>
        )}
        {standing && onNext && (
          <Actions
            items={[{ label: t(lang, "assessment.common.continue"), onClick: onNext, name: "next" }]}
          />
        )}
      </Glass>
    </div>
  );
}
