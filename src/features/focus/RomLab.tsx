/**
 * The range test page (D-035 item 4): /?romlab=<movementId>&side=right|left (&position=<id>, &lang=en),
 * VITE_V7 builds only, signed in or not, never saving. It runs exactly one movement with the real
 * camera (focusCameraSession, the check's own pose source and model choice) and the real RomRunner
 * through the real RomController and its measuring screens, so what Nasser sees and hears here is what
 * the check does. Beside the screen, live diagnostics: the angle, the runner's phase, the hold's
 * progress, which of the movement's own landmarks are seen, the frame rate, every cue and compensation
 * event by name, each attempt's outcome and reasons. At the end a verdict («Measured: 132°» or «Not
 * measured because …») and a compact JSON block to screenshot, so Nasser and the tech lead share one
 * reference. /?romlab=1 lists the movements as links.
 *
 * Nothing is posted: the controller's saves are dropped here, and no check is started. Video never
 * leaves the phone. Nothing is spoken: the check uses no phone speech (D-036 item 1), and the page runs
 * no Live coach; the screens carry every line, as the check does without the coach.
 */
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import type { Frame } from "../../engine/types";
import type { RomEvent, RomMeasureResult } from "../../engine/rom/types";
import { movementLandmarks } from "../../engine/rom/quality";
import { ROM_ENGINE_VERSION, ROM_RULES_VERSION, ROM_DATA, movementDef } from "../../movements/rom";
import {
  ROM_MOVEMENT_IDS,
  type RomMovementId,
  type RomPositionId,
  type RomSide,
} from "../../movements/rom/types";
import type { RomBlock, RomProtocol, RomProtocolItem } from "../../medical/rom-protocol";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { useCameraSession } from "../assessment/camera/session";
import { useOrientation } from "../assessment/camera/hooks";
import { focusCameraSession } from "./camera";
import { instructionLines, movementName, positionName } from "./copy";
import { sideRegion } from "./names";
import { Actions, Glass, Kicker, Page, Title, TopBar } from "./parts";
import { MeasureScreen, ResultScreen } from "./RangeScreens";
import { RomController } from "./romController";
import { localizeDigits } from "../../i18n";
import "../assessment/safety/safety.css";
import "./focus.css";
import "./romlab.css";

const clock = () => performance.now();

const COPY = {
  ar: {
    title: "صفحة اختبار القياس",
    index: "اختر حركة لتجربتها. لا يُحفظ شيء.",
    start: "ابدأ",
    stop: "أوقف",
    again: "ابدأ من جديد",
    list: "كل الحركات",
    measured: "قيست",
    notMeasured: "لم تُقس، والسبب",
    stopped: "أوقفتها قبل النهاية",
    diag: "التشخيص المباشر",
    angle: "الزاوية",
    phase: "المرحلة",
    hold: "الثبات",
    seen: "النقاط الظاهرة",
    fps: "الإطارات في الثانية",
    model: "النموذج",
    events: "الأحداث",
    attempts: "المحاولات",
    json: "للتصوير",
    camera: "الكاميرا",
    noSave: "صفحة اختبار: لا يُحفظ شيء.",
    noAngle: "لا قراءة",
  },
  en: {
    title: "Range test page",
    index: "Pick a movement to try. Nothing is saved.",
    start: "Start",
    stop: "Stop",
    again: "Start over",
    list: "All movements",
    measured: "Measured",
    notMeasured: "Not measured because",
    stopped: "Stopped before the end",
    diag: "Live diagnostics",
    angle: "Angle",
    phase: "Phase",
    hold: "Hold",
    seen: "Landmarks seen",
    fps: "Frames a second",
    model: "Model",
    events: "Events",
    attempts: "Attempts",
    json: "To screenshot",
    camera: "Camera",
    noSave: "A test page: nothing is saved.",
    noAngle: "no reading",
  },
} as const;

/** Why a movement was not measured, in plain words (the reason id and the tries' reasons follow). */
const REASON: Record<string, { ar: string; en: string }> = {
  quality: {
    ar: "لم نجد ثباتا عند أقصى الحركة، أو لم تظهر نقاط الحركة",
    en: "no steady top was found, or the movement's own points were not seen",
  },
  no_active_movement: { ar: "لم تتحرك المفصلة عن وضع البداية", en: "the joint did not move from the start" },
  pain_stop: { ar: "توقف للألم", en: "stopped for pain" },
  by_choice: { ar: "أوقفتها بنفسك", en: "you stopped it" },
};

const LANDMARK_NAMES: Record<number, string> = {
  0: "nose",
  2: "L eye",
  5: "R eye",
  7: "L ear",
  8: "R ear",
  11: "L shoulder",
  12: "R shoulder",
  13: "L elbow",
  14: "R elbow",
  15: "L wrist",
  16: "R wrist",
  23: "L hip",
  24: "R hip",
  25: "L knee",
  26: "R knee",
  27: "L ankle",
  28: "R ankle",
  29: "L heel",
  30: "R heel",
  31: "L toe",
  32: "R toe",
};

const isMovement = (id: string | null): id is RomMovementId =>
  id !== null && (ROM_MOVEMENT_IDS as readonly string[]).includes(id);

/** The sides a movement is tried on here: a limb's left and right, a side bend's directions, else none. */
function sidesOf(id: RomMovementId): RomSide[] {
  const def = movementDef(id);
  return !def.axial || def.bothDirections ? ["right", "left"] : ["none"];
}

const blockOf = (p: RomPositionId): RomBlock =>
  p.startsWith("seated") ? "seated" : p === "lying_back" ? "lying" : "standing";

/** The one item the page runs (the fields a runner and the screens read). */
export function labItem(movementId: RomMovementId, side: RomSide, position?: RomPositionId): RomProtocolItem {
  const def = movementDef(movementId);
  const pos = def.positions.find((p) => p.id === position) ?? def.positions[0];
  return {
    movementId,
    side,
    region: def.region,
    position: pos.id,
    block: blockOf(pos.id),
    order: 1,
    priority: def.priority,
    verdict: def.verdict,
    normId: pos.normId,
    graded: pos.graded,
    askCanMove: false,
    helperRequired: false,
    approximate: def.verdict === "caution" || def.approximateInPersonView,
  };
}

/** The page's link for a movement, side and position. */
export const labUrl = (id: RomMovementId, side: RomSide, position: RomPositionId, lang: Lang) =>
  `/?romlab=${id}${side === "none" ? "" : `&side=${side}`}&position=${position}${lang === "en" ? "&lang=en" : ""}`;

export interface RomLabProps {
  lang: Lang;
  onLanguage(): void;
}

/** /?romlab=<movementId> runs that movement; any other value (/?romlab=1) lists the movements. */
export default function RomLab({ lang, onLanguage }: RomLabProps) {
  const qs = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const id = qs.get("romlab");
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  if (!isMovement(id)) return <LabIndex lang={lang} onLanguage={onLanguage} />;
  const sides = sidesOf(id);
  const asked = qs.get("side") as RomSide | null;
  const side = asked && sides.includes(asked) ? asked : sides[0];
  const position = (qs.get("position") ?? undefined) as RomPositionId | undefined;
  return (
    <LabRun
      key={`${id}:${side}:${position ?? ""}`}
      lang={lang}
      onLanguage={onLanguage}
      item={labItem(id, side, position)}
    />
  );
}

/** /?romlab=1: every measured movement, each position and side, as links. */
export function LabIndex({ lang, onLanguage }: RomLabProps) {
  const c = COPY[lang];
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx">
      <Page lang={lang} top={<TopBar lang={lang} onLanguage={onLanguage} />} screen="romlab_index">
        <Glass className="fx-card rl-index">
          <Kicker>{c.title}</Kicker>
          <Title>{c.index}</Title>
          <ul className="rl-list">
            {ROM_MOVEMENT_IDS.map((id) => (
              <li key={id} data-movement={id}>
                <b>{movementName(id, lang)}</b>
                <span className="rl-links">
                  {movementDef(id).positions.flatMap((p, _k, all) =>
                    sidesOf(id).map((side) => (
                      <a key={`${p.id}:${side}`} href={labUrl(id, side, p.id, lang)}>
                        {[
                          all.length > 1 ? positionName(p.id, lang) : null,
                          side === "none" ? null : sideRegion({ region: movementDef(id).region, side }, lang),
                        ]
                          .filter(Boolean)
                          .join(", ") || movementName(id, lang)}
                      </a>
                    )),
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Glass>
      </Page>
    </CheckRoot>
  );
}

/** What the page has seen of the runner (the diagnostics and the JSON block). */
interface LabLog {
  events: { t: number; text: string; kind: string }[];
  attempts: {
    index: number;
    outcome: string;
    value: number | null;
    answer: string;
    reasons: string[];
    flags: string[];
  }[];
  cues: string[];
  compensations: string[];
  frames: number[];
}

const newLog = (): LabLog => ({ events: [], attempts: [], cues: [], compensations: [], frames: [] });

/** One runner event as a line of the log, or null for the ones the panel shows elsewhere (live, plateau). */
function eventLine(e: RomEvent): { kind: string; text: string } | null {
  switch (e.kind) {
    case "phase":
      return { kind: "phase", text: `phase ${e.phase} (attempt ${e.attempt})` };
    case "hold":
      return {
        kind: "hold",
        text: `hold ${e.hold.deg}° (moved ${e.hold.excursionDeg}°${e.hold.smallExcursion ? ", small" : ""})`,
      };
    case "compensation":
      return { kind: "compensation", text: `compensation ${e.id} ${e.level} (${e.value})` };
    case "cue":
      return { kind: "cue", text: `line ${e.cue}` };
    case "quality":
      return { kind: "quality", text: `quality ${e.issue}` };
    case "attempt":
      return {
        kind: "attempt",
        text: `attempt ${e.record.index} ${e.record.outcome}${e.record.value === null ? "" : ` ${e.record.value}°`}${
          e.record.reasons.length ? ` [${e.record.reasons.join(", ")}]` : ""
        }`,
      };
    case "stop":
      return { kind: "stop", text: `stop ${e.reason}` };
    case "done":
      return { kind: "done", text: "done" };
    default:
      return null;
  }
}

function LabRun({ lang, onLanguage, item }: RomLabProps & { item: RomProtocolItem }) {
  const c = COPY[lang];
  const def = movementDef(item.movementId);
  // The check's camera; on a VITE_E2E=1 build &e2ePerson=1 is FocusApp's simulated person instead.
  const ctlRef = useRef<RomController | null>(null);
  const camera = useMemo(() => {
    if (import.meta.env.VITE_E2E === "1" && new URLSearchParams(location.search).get("e2ePerson") === "1")
      return focusCameraSession({
        createSource: async () => {
          const { PersonSource } = await import("./e2e/PersonSource");
          return new PersonSource(() => ctlRef.current);
        },
      });
    return focusCameraSession();
  }, []);
  const log = useRef<LabLog>(newLog());
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const protocol = useMemo<RomProtocol>(
    () => ({
      rulesVersion: ROM_RULES_VERSION,
      items: [item],
      deferred: [],
      notMeasured: [],
      sitBeforeStand: false,
    }),
    [item],
  );
  const ctl = useMemo(
    () =>
      new RomController({
        protocol,
        painByRegion: {},
        intake: null,
        lang,
        poseModel: () => camera.model,
        onRunnerEvents: (_item, events) => {
          const l = log.current;
          for (const e of events) {
            const line = eventLine(e);
            const at = e.kind === "attempt" ? e.record.t1 : e.kind === "hold" ? e.hold.t : e.t;
            if (line) l.events.push({ t: Math.round(at), ...line });
            if (e.kind === "cue") l.cues.push(e.cue);
            if (e.kind === "compensation") l.compensations.push(`${e.id}:${e.level}`);
            if (e.kind === "attempt")
              l.attempts.push({
                index: e.record.index,
                outcome: e.record.outcome,
                value: e.record.value,
                answer: `${e.record.answer ?? ""}${e.record.answerSource ? `/${e.record.answerSource}` : ""}`,
                reasons: e.record.reasons,
                flags: e.record.flags,
              });
          }
          if (l.events.length > 200) l.events.splice(0, l.events.length - 200);
        },
      }),
    // The language changes the screens only: the movement keeps running.
    [protocol, camera],
  );
  ctlRef.current = ctl;
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);

  // The controller's output is dropped (a test page never saves, and nothing is spoken).
  useEffect(
    () =>
      ctl.subscribe(() => {
        ctl.drain();
        redraw();
      }),
    [ctl],
  );

  const orientation = useOrientation();
  const tilt = useRef(orientation.tilt);
  tilt.current = orientation.tilt;
  const frame = useRef<Frame | null>(null);
  const cam = useCameraSession(
    (f) => {
      frame.current = f;
      const fr = log.current.frames;
      fr.push(f.t);
      while (fr.length > 1 && f.t - fr[0] > 1000) fr.shift();
      if (started) ctl.feed(f, { rollDeg: tilt.current?.rollDeg ?? null, tilt: tilt.current });
    },
    !finished,
    camera.session,
  );
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const id = setInterval(() => {
      const t = clock();
      ctl.tick(t);
      setNow(t);
    }, 250);
    return () => clearInterval(id);
  }, [ctl]);

  const start = () => {
    const t = clock();
    ctl.startBlock(item.block, t);
    ctl.ready(t);
    ctl.ready(t);
    setStarted(true);
  };
  const stopNow = () => {
    const t = clock();
    ctl.requestStop(t);
    ctl.stopRouted({ endsCheck: true, afterRest: false }, t);
    setFinished(true);
  };

  const step = ctl.current;
  const result: RomMeasureResult | null = ctl.resultOf(item);
  const ended = finished || step.kind === "pain_stop" || step.kind === "ended" || step.kind === "end";
  const verdict = verdictOf(result, ended, lang);

  let screen: ReactNode;
  if (!started)
    screen = (
      <div className="fx-split">
        <Glass className="fx-card">
          <Kicker>{c.title}</Kicker>
          <Title>{movementName(item.movementId, lang)}</Title>
          <span className="fx-pill is-violet">
            {sideRegion(item, lang)}, {positionName(item.position, lang)}
          </span>
          <ol className="fx-steps">
            {instructionLines(item.movementId, item.side, item.position, lang).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
          <p className="rl-note">{c.noSave}</p>
        </Glass>
        <Actions
          sticky
          items={[
            {
              label: c.start,
              onClick: start,
              name: "ready",
              icon: "play",
              disabled: cam.status !== "running",
            },
          ]}
        />
      </div>
    );
  else if (step.kind === "measure")
    screen = (
      <MeasureScreen
        lang={lang}
        ctl={ctl}
        item={item}
        n={1}
        total={1}
        video={cam.video}
        frame={frame}
        clock={clock}
        now={now}
      />
    );
  else if (step.kind === "result" && !finished)
    screen = (
      <ResultScreen
        lang={lang}
        ctl={ctl}
        item={item}
        result={step.result}
        saved={null}
        intake={null}
        last
        onNext={() => setFinished(true)}
        onAgain={() => ctl.tryAgain(clock())}
      />
    );
  else screen = <span />;

  const json = labJson(item, result, log.current, camera.model);
  const gate = movementLandmarks(def, item.side).gate;
  const lm = frame.current?.lm ?? null;
  const vis = ROM_DATA.engine.visibilityMin;
  const fr = log.current.frames;
  const fps = fr.length > 1 ? Math.round(((fr.length - 1) * 1000) / (fr[fr.length - 1] - fr[0])) : 0;
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx">
      <Page
        lang={lang}
        top={<TopBar lang={lang} onLanguage={onLanguage} />}
        screen={`romlab_${step.kind}${ctl.phase ? `_${ctl.phase}` : ""}`}
        step={`romlab:${item.movementId}:${step.kind === "measure" ? "measure" : step.kind}`}
        wide={step.kind === "measure"}
      >
        <div className="rl-page" data-romlab={item.movementId} data-verdict={verdict?.kind ?? ""}>
          {screen}
          {verdict && step.kind !== "measure" && (
            <Glass className={`fx-card rl-verdict is-${verdict.kind}`}>
              <p className="rl-verdict-line" role="status">
                {verdict.text}
              </p>
              <Actions
                items={[
                  {
                    label: c.list,
                    onClick: () => location.assign(`/?romlab=1${lang === "en" ? "&lang=en" : ""}`),
                    kind: "quiet",
                    name: "list",
                  },
                  { label: c.again, onClick: () => location.reload(), name: "again_lab", icon: "refresh" },
                ]}
              />
            </Glass>
          )}
          <Glass className="fx-card rl-diag">
            <div className="rl-diag-head">
              <Kicker>{c.diag}</Kicker>
              {started && !ended && (
                <button type="button" className="fx-chip" onClick={stopNow} data-action="lab_stop">
                  {c.stop}
                </button>
              )}
            </div>
            <dl className="rl-grid">
              <dt>{c.angle}</dt>
              <dd data-diag="angle" dir="ltr">
                {ctl.live === null ? c.noAngle : `${ctl.live}°`}
              </dd>
              <dt>{c.phase}</dt>
              <dd data-diag="phase" dir="ltr">
                {ctl.phase ?? step.kind}
                {ctl.phase === "attempt" || ctl.phase === "practice" ? ` ${ctl.attempt.index}` : ""}
              </dd>
              <dt>{c.hold}</dt>
              <dd data-diag="hold">
                <span className="rl-bar">
                  <i style={{ width: `${Math.round(ctl.holdProgress * 100)}%` }} />
                </span>
              </dd>
              <dt>{c.fps}</dt>
              <dd data-diag="fps" dir="ltr">
                {fps}
              </dd>
              <dt>{c.model}</dt>
              <dd dir="ltr">
                {camera.model}, {cam.status}
              </dd>
              <dt>{c.seen}</dt>
              <dd data-diag="seen" dir="ltr" className="rl-seen">
                {gate.map((i) => {
                  const ok = !!lm && (lm[i]?.visibility ?? 0) >= vis;
                  return (
                    <span key={i} className={ok ? "is-seen" : "is-hidden"}>
                      {LANDMARK_NAMES[i] ?? `#${i}`} {ok ? "seen" : "hidden"}
                    </span>
                  );
                })}
              </dd>
            </dl>
            <Kicker>{c.attempts}</Kicker>
            <ul className="rl-log" dir="ltr" data-diag="attempts">
              {log.current.attempts.map((a, i) => (
                <li key={i}>
                  {a.index === 0 ? "practice" : `attempt ${a.index}`}: {a.outcome}
                  {a.value === null ? "" : ` ${a.value}°`}
                  {a.answer ? ` (${a.answer})` : ""}
                  {a.reasons.length ? ` [${a.reasons.join(", ")}]` : ""}
                  {a.flags.length ? ` {${a.flags.join(", ")}}` : ""}
                </li>
              ))}
            </ul>
            <Kicker>{c.events}</Kicker>
            <ol className="rl-log" dir="ltr" data-diag="events">
              {log.current.events.slice(-40).map((e, i) => (
                <li key={i} className={`is-${e.kind}`}>
                  {(e.t / 1000).toFixed(1)} s {e.text}
                </li>
              ))}
            </ol>
          </Glass>
          {(verdict || started) && (
            <Glass className="fx-card rl-json">
              <Kicker>{c.json}</Kicker>
              <pre dir="ltr" data-diag="json">
                {JSON.stringify(json)}
              </pre>
            </Glass>
          )}
        </div>
      </Page>
    </CheckRoot>
  );
}

/** The verdict once the movement ended: measured with its value, or not measured with its reasons. */
export function verdictOf(
  result: RomMeasureResult | null,
  ended: boolean,
  lang: Lang,
): { kind: "measured" | "not_measured" | "stopped"; text: string } | null {
  const c = COPY[lang];
  if (!result) return ended ? { kind: "stopped", text: c.stopped } : null;
  const deg = (v: number) => `${localizeDigits(lang, String(Math.abs(v)))}°`;
  if (result.status === "measured" && result.value !== null)
    return { kind: "measured", text: `${c.measured}: ${deg(result.value)}` };
  if (result.status === "stopped" && result.value !== null)
    return { kind: "measured", text: `${c.measured}: ${deg(result.value)} (${REASON.pain_stop[lang]})` };
  const tries = [...result.practice, ...result.attempts]
    .filter((a) => a.reasons.length)
    .map((a) => a.reasons.join("+"));
  const why = (result.reason && REASON[result.reason]?.[lang]) ?? result.reason ?? "";
  return {
    kind: result.status === "stopped" ? "stopped" : "not_measured",
    text: `${c.notMeasured} ${why}${tries.length ? ` (${tries.join(", ")})` : ""}`,
  };
}

/** The compact JSON block: what the runner decided and why, in one line to screenshot. */
export function labJson(
  item: RomProtocolItem,
  result: RomMeasureResult | null,
  log: LabLog,
  model: string,
): Record<string, unknown> {
  return {
    mv: item.movementId,
    side: item.side,
    pos: item.position,
    engine: ROM_ENGINE_VERSION,
    model,
    status: result?.status ?? "running",
    reason: result?.reason ?? null,
    value: result?.value ?? null,
    nValid: result?.nValid ?? 0,
    flags: result?.flags ?? [],
    retries: result?.quality.retries ?? 0,
    issues: result?.quality.issues ?? [],
    fps: result?.quality.medianFps ?? null,
    tries: log.attempts.map((a) => [
      a.index,
      a.outcome,
      a.value,
      a.answer,
      a.reasons.join("+"),
      a.flags.join("+"),
    ]),
    lines: log.cues,
    comps: log.compensations,
  };
}
