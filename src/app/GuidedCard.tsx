import { useEffect, useRef, useState } from "react";
import { stepsOf, type WeeklyItem } from "../medical/weekly";
import { libraryById } from "../medical/pool";
import { cardKind, type CardSlot } from "../medical/session";
import { fmtNum, Lang, T, westernDigits } from "./i18n";
import { copy } from "./product";
import { guidedCopy } from "./guided-copy";
import { labels } from "./platform-copy";
import ExerciseArt from "./ExerciseArt";
import Icon from "./Icon";

/**
 * A guided card (booth v2, contract D): one exercise of the day's weekly plan, done inside the
 * session. Its picture (or its category glyph), the numbered steps, then a timer for a hold or a tap
 * counter for reps, set by set (with the rules' rest between counted sets), and the effort at the end.
 * "Done" keeps the card (it counts toward the sessions done); "Skip this exercise" moves on and keeps
 * nothing. No camera and no voice: the camera movements of the session keep their own screen.
 */
export interface CardResult {
  done: { sets: number; reps: number } | { sets: number; seconds: number };
  rpe: number | null;
  startedAt: number;
}

type Phase = "ready" | "running" | "paused" | "rest" | "effort";

const RING = 2 * Math.PI * 46;

/**
 * The ring's minutes and seconds (E3-7): a size that keeps «10:00» inside the ring, smaller on a short
 * phone, where the ring is smaller too (guided.css).
 */
const CLOCK_FACE = { fontSize: "min(46px, 6.4vh)" } as const;

export default function GuidedCard({
  lang,
  item,
  slot,
  position,
  total,
  restSeconds,
  saving = false,
  error = false,
  onDone,
  onSkip,
  onExit,
}: {
  lang: Lang;
  item: WeeklyItem;
  slot: CardSlot;
  /** This card's place in the session (1 based) and the session's length. */
  position: number;
  total: number;
  /** The rules' rest between the sets of a counted card. */
  restSeconds: number;
  saving?: boolean;
  error?: boolean;
  onDone: (r: CardResult) => void;
  onSkip: () => void;
  onExit: () => void;
}) {
  const g = guidedCopy(lang),
    c = copy(lang);
  const n = (v: number) => fmtNum(v, lang);
  // Library text in Western digits in Arabic too (D-036 item 3), whatever digits it was written in.
  const digits = (s: string) => (lang === "ar" ? westernDigits(s) : s);
  const ex = libraryById(item.id);
  const kind = cardKind(item);
  const sets = Math.max(1, item.sets);
  const hold = (item.holdSeconds ?? 0) * 1000;
  const reps = item.reps ?? 8;
  const rest = Math.max(0, restSeconds) * 1000;

  const [phase, setPhase] = useState<Phase>("ready");
  const [setNo, setSetNo] = useState(1);
  const [count, setCount] = useState(0);
  const [remaining, setRemaining] = useState(kind === "timer" ? hold : 0);
  const [rpe, setRpe] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [pulse, setPulse] = useState(0);
  const endAt = useRef(0);
  const startedAt = useRef<number | null>(null);
  const totals = useRef({ reps: 0, seconds: 0 });

  // The timer of a hold and the rest between counted sets: the time left, from the clock.
  useEffect(() => {
    if (phase !== "running" && phase !== "rest") return;
    const tick = () => {
      const left = Math.max(0, endAt.current - Date.now());
      setRemaining(left);
      if (left > 0) return;
      // Once at zero: the next tick never counts the same set twice.
      clearInterval(timer);
      if (phase === "rest") {
        setSetNo((s) => s + 1);
        setCount(0);
        setStatus("");
        setPhase("ready");
        return;
      }
      totals.current.seconds += item.holdSeconds ?? 0;
      if (setNo < sets) {
        setStatus(g.setDone(n(setNo)));
        setSetNo(setNo + 1);
        setRemaining(hold);
        setPhase("ready");
      } else {
        setStatus(g.allDone);
        setPhase("effort");
      }
    };
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [phase, setNo]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = () => {
    startedAt.current ??= Date.now();
  };
  const startTimer = () => {
    begin();
    endAt.current = Date.now() + (phase === "paused" ? remaining : hold);
    setStatus("");
    setPhase("running");
  };
  const tap = () => {
    if (phase !== "ready") return;
    begin();
    const next = count + 1;
    setCount(next);
    setPulse((p) => p + 1);
    if (next < reps) return;
    totals.current.reps += reps;
    if (setNo < sets) {
      setStatus(g.setDone(n(setNo)));
      endAt.current = Date.now() + rest;
      setRemaining(rest);
      setPhase(rest > 0 ? "rest" : "ready");
      if (rest === 0) {
        setSetNo(setNo + 1);
        setCount(0);
      }
    } else {
      setStatus(g.allDone);
      setPhase("effort");
    }
  };
  const finish = (value: number | null) =>
    onDone({
      done:
        kind === "timer" ? { sets, seconds: totals.current.seconds } : { sets, reps: totals.current.reps },
      rpe: value,
      startedAt: startedAt.current ?? Date.now(),
    });

  if (!ex) return null;
  const name = ex.name[lang];
  // v7 (E1-8, D-026 item 9): a targeted item's steps name the hold its dose resolved.
  const steps = stepsOf(ex, item, lang);
  const resting = phase === "rest";
  // The ring: a hold empties as it runs, the counter fills with each rep, the rest empties in purple.
  const share =
    phase === "effort"
      ? 1
      : resting
        ? rest > 0
          ? remaining / rest
          : 0
        : kind === "timer"
          ? hold > 0
            ? remaining / hold
            : 0
          : count / reps;
  // v7 (D-029 item 1, E3-7): a timer of a minute or more (walking practice, an older adult's held
  // stretch) shows minutes and seconds throughout, as the session's own clock does (Workout.tsx).
  const timed = resting || kind === "timer";
  const left = Math.ceil(remaining / 1000);
  const clock = timed && (resting ? rest : hold) >= 60_000;
  const big = !timed ? (
    n(count)
  ) : clock ? (
    <bdi>
      {n(Math.floor(left / 60))}:{n(left % 60).padStart(2, "0")}
    </bdi>
  ) : (
    n(left)
  );
  const under = resting
    ? g.rest
    : kind === "timer"
      ? clock
        ? labels(lang).minutes
        : g.seconds
      : g.of(n(reps));
  const ring = (
    <svg className="gcard-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="gcard-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fde08a" />
          <stop offset="1" stopColor="#e9b52a" />
        </linearGradient>
      </defs>
      <circle className="gcard-ring-track" cx="50" cy="50" r="46" />
      <circle
        className={`gcard-ring-fill${resting ? " is-rest" : ""}`}
        cx="50"
        cy="50"
        r="46"
        strokeDasharray={RING}
        strokeDashoffset={RING * (1 - Math.max(0, Math.min(1, share)))}
      />
    </svg>
  );
  const face = (
    <>
      {ring}
      <span className="gcard-ring-face">
        <b key={kind === "counter" && !resting ? pulse : undefined} style={clock ? CLOCK_FACE : undefined}>
          {big}
        </b>
        <small>{under}</small>
      </span>
    </>
  );

  return (
    <div
      className="gcard"
      data-phase={phase}
      data-kind={kind}
      data-slot={slot}
      data-sets={sets}
      data-reps={kind === "counter" ? reps : undefined}
    >
      <div className="gcard-backdrop" aria-hidden="true" />
      <header className="gcard-top">
        <span className="gcard-slot gcard-glass">
          <span>{g.slot[slot]}</span>
          <b>{g.progress(n(position), n(total))}</b>
        </span>
        <button type="button" className="gcard-exit gcard-glass" aria-label={g.exit} onClick={onExit}>
          <Icon name="close" size={20} />
        </button>
      </header>
      <div className="gcard-bar" aria-hidden="true">
        <i style={{ inlineSize: `${(Math.min(position, total) / Math.max(1, total)) * 100}%` }} />
      </div>
      <main className="gcard-body">
        {/* Focusable, so a keyboard can scroll the steps on a short screen. */}
        <section className="gcard-info" tabIndex={0} aria-label={name}>
          <div className="gcard-hero">
            <ExerciseArt category={ex.category} />
            <div>
              <h1>{name}</h1>
              <p className="gcard-desc">{digits(ex.description[lang])}</p>
            </div>
          </div>
          {(ex.equipment.length > 0 || item.note) && (
            <div className="gcard-chips">
              {ex.equipment.map((e) => (
                <span key={e} className="gcard-chip">
                  {g.equipment[e] ?? e}
                </span>
              ))}
            </div>
          )}
          {item.note && (
            <p className="gcard-note">
              <Icon name="info" size={15} />
              {item.note[lang]}
            </p>
          )}
          {ex.cautions && (
            <p className="gcard-note" data-note="caution">
              <Icon name="info" size={15} />
              {digits(ex.cautions[lang])}
            </p>
          )}
          <h2 className="gcard-steps-title">{g.steps}</h2>
          <ol className="gcard-steps">
            {steps.map((s, i) => (
              <li key={s}>
                <span className="gcard-num" aria-hidden="true">
                  {n(i + 1)}
                </span>
                <span>{digits(s)}</span>
              </li>
            ))}
          </ol>
          {/* The NIA credit line of a text adapted from NIA, shown with the exercise (E1-8). */}
          {ex.credit && (
            <p className="gcard-desc" data-note="credit" style={{ marginTop: 14 }}>
              {ex.credit[lang]}
            </p>
          )}
        </section>
        <section className="gcard-panel gcard-glass">
          {phase === "effort" ? (
            <div className="gcard-effort">
              <p className="gcard-done-line" role="status">
                <span className="gcard-done-mark" aria-hidden="true">
                  <Icon name="check" size={18} />
                </span>
                {g.allDone}
              </p>
              <h2 id="gcard-effort-title">{T.rpeTitle[lang]}</h2>
              <div className="gcard-rpe" role="group" aria-labelledby="gcard-effort-title">
                {Array.from({ length: 11 }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={rpe === i ? "sel" : ""}
                    aria-pressed={rpe === i}
                    onClick={() => setRpe(i)}
                  >
                    {n(i)}
                  </button>
                ))}
              </div>
              <div className="gcard-rpe-labels" aria-hidden="true">
                <span>{c.easy}</span>
                <span>{c.hard}</span>
              </div>
              {rpe !== null && rpe >= 8 && (
                <p className="gcard-warn" role="status">
                  {T.rpeHigh[lang]}
                </p>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {g.saveError}
                </p>
              )}
              <div className="gcard-actions">
                <button
                  type="button"
                  className="gcard-cta"
                  disabled={rpe === null || saving}
                  onClick={() => finish(rpe)}
                >
                  {saving ? g.saving : g.done}
                </button>
                <button type="button" className="gcard-ghost" disabled={saving} onClick={() => finish(null)}>
                  {T.skip[lang]}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="gcard-set">{resting ? g.restNext(n(setNo + 1)) : g.setOf(n(setNo), n(sets))}</p>
              {kind === "counter" ? (
                <button
                  type="button"
                  className="gcard-ring gcard-tap"
                  disabled={phase !== "ready"}
                  aria-label={g.tapLabel(n(count), n(reps))}
                  onClick={tap}
                >
                  {face}
                </button>
              ) : (
                <div className="gcard-ring" role="timer" aria-label={`${big} ${g.seconds}`}>
                  {face}
                </div>
              )}
              <p className="gcard-hint">
                {resting ? g.restHint : kind === "counter" ? g.tapHint : g.holdHint}
              </p>
              {kind === "timer" && (
                <button
                  type="button"
                  className="gcard-cta"
                  onClick={phase === "running" ? () => setPhase("paused") : startTimer}
                >
                  <Icon name={phase === "running" ? "pause" : "play"} size={17} />
                  {phase === "running" ? g.pause : phase === "paused" ? g.resume : g.start}
                </button>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {g.saveError}
                </p>
              )}
              <p className="gcard-status" role="status" aria-live="polite">
                {status}
              </p>
              <button type="button" className="gcard-skip" disabled={saving} onClick={onSkip}>
                {g.skipExercise}
              </button>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
