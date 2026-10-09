/**
 * The gait lab (D-035 item 4): /?gaitlab=side or /?gaitlab=front, VITE_V7 builds only, signed in or
 * not, never saving. It runs the walk's capture alone (the GaitController of the focus check, with the
 * real camera and the real model) so Nasser and the tech lead share one reference:
 *   - live: the skeleton over the picture, the steps and passes counted (by the change of direction),
 *     the clean cycles a side, the share of frames with the legs seen, the frame rate, the contacts
 *     found and the gate (full: 6 a side; timing only: 3 a side across the passes);
 *   - at the end: the verdict in one line («Cadence 104 steps a minute, right step 0.58 s, left
 *     0.62 s», or «Not analysed because ...») and a JSON block to screenshot.
 * Query: lang=en (Arabic first), model=full|lite (the device's remembered model, as the smoke page
 * sets it), height=<cm> (step length), auto=1 (no taps: the real model smoke drives it); on a VITE_E2E
 * build fixture=<gait fixture> plays a recorded walk instead of the camera. Nothing is posted: no
 * intake is read and no result leaves the page. The page is its own lazy chunk (App.tsx).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Lang } from "../../app/i18n";
import type { PoseSource } from "../../app/poseSource";
import type { GaitAnalysis, GaitEvent, GaitViewResult } from "../../engine/gait/types";
import { walkVerdict, type WalkReason, type WalkVerdict } from "../../engine/gait/verdict";
import { GAIT_ENGINE, GAIT_MVP } from "../../engine/gait/params";
import type { Frame } from "../../engine/types";
import { evaluateGait } from "../../medical/gait-rules";
import type { GaitPlan } from "../../medical/gait-eligibility";
import type { Intake } from "../../medical/plan";
import { CameraSession, useCameraSession } from "../assessment/camera/session";
import { MODEL_MEMORY_KEY, useFocusCamera } from "../focus/camera";
import { Actions, Body, Glass, Kicker, Page, Title } from "../focus/parts";
import { Stage } from "../focus/Stage";
import { CAMERA_STEPS, GaitController, type RecordingDiagnostics } from "./controller";
import { gt } from "./copy";
import "../focus/focus.css";
import "./gait.css";

export type GaitLabView = "side" | "front";

/** The lab's state on window (the real model smoke reads it). */
export interface GaitLabState {
  status: "running" | "done";
  view: GaitLabView;
  result: GaitLabResult | null;
}

export interface GaitLabResult {
  view: GaitLabView;
  model: "lite" | "full";
  level: WalkVerdict["level"];
  verdict: string;
  cadence: number | null;
  stepTime: WalkVerdict["stepTime"];
  cleanCycles: WalkVerdict["cleanCycles"];
  reasons: WalkReason[];
  /** For a full reading: the patterns the rules found (possible or likely), as pattern:side:status. */
  patterns: string[];
  diagnostics: RecordingDiagnostics[];
  views: { view: string; cleanCycles: { left: number; right: number }; fps: number; issues: string[] }[];
  engineVersion: string;
  at: string;
}

/** The lab's own words (a test page: Arabic first, complete English, no dash characters). */
const L = {
  title: { ar: "مختبر المشي", en: "Walk lab" },
  side: { ar: "المنظر الجانبي", en: "Side view" },
  front: { ar: "المنظر الأمامي", en: "Front view" },
  never: { ar: "صفحة اختبار لا تحفظ شيئًا.", en: "A test page that saves nothing." },
  start: { ar: "ابدأ", en: "Start" },
  finish: { ar: "أنهِ الآن", en: "Finish now" },
  again: { ar: "من جديد", en: "Start again" },
  showResult: { ar: "اعرض النتيجة", en: "Show the result" },
  tryAgain: { ar: "لنجرّب مرة أخرى", en: "Try again" },
  steps: { ar: "خطوات", en: "Steps" },
  passes: { ar: "مرات", en: "Passes" },
  cycles: { ar: "دورات نظيفة يمين ويسار", en: "Clean cycles right and left" },
  visible: { ar: "الساقان ظاهرتان", en: "Legs seen" },
  fps: { ar: "إطارات في الثانية", en: "Frames a second" },
  events: { ar: "ملامسات القدم", en: "Foot contacts" },
  gate: { ar: "البوابة", en: "Gate" },
  full: { ar: "كامل", en: "full" },
  timing: { ar: "توقيت فقط", en: "timing only" },
  none: { ar: "لم يكتمل", en: "not yet" },
  step: { ar: "الخطوة", en: "Step" },
  copy: { ar: "انسخ", en: "Copy" },
} as const;
const say = (lang: Lang, k: keyof typeof L) => L[k][lang];

const REASON_TEXT: Record<WalkReason, { ar: string; en: string }> = {
  nothing_recorded: { ar: "لم يُسجَّل مشي", en: "no walk was recorded" },
  no_person: { ar: "لم نرك في الصورة", en: "nobody was seen" },
  wrong_view: { ar: "الاتجاه غير مناسب لهذا المنظر", en: "the wrong view for this recording" },
  low_fps: { ar: "الإطارات أقل من 20 في الثانية", en: "under 20 frames a second" },
  visibility: { ar: "القدمان لم تظهرا بوضوح", en: "the feet were not seen clearly" },
  tracking: { ar: "لم نتابع الساقين بثبات", en: "the legs were not followed steadily" },
  too_few_steps: { ar: "الخطوات النظيفة أقل من 3 لكل جهة", en: "fewer than 3 clean cycles a side" },
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The verdict line: the numbers of a reading, or why there is none. */
export function verdictLine(v: WalkVerdict, lang: Lang, patterns: string[] = []): string {
  if (v.level === "none") {
    const why = v.reasons.map((r) => REASON_TEXT[r][lang]).join(lang === "ar" ? "، " : ", ");
    return lang === "ar"
      ? `لم يُحلَّل لأن ${why || "لا سبب"}.`
      : `Not analysed because ${why || "no reason"}.`;
  }
  const parts: string[] = [];
  if (v.cadence !== null)
    parts.push(
      lang === "ar"
        ? `الإيقاع ${Math.round(v.cadence)} خطوة في الدقيقة`
        : `Cadence ${Math.round(v.cadence)} steps a minute`,
    );
  if (v.stepTime.right !== null)
    parts.push(
      lang === "ar" ? `الخطوة اليمنى ${r2(v.stepTime.right)} ث` : `right step ${r2(v.stepTime.right)} s`,
    );
  if (v.stepTime.left !== null)
    parts.push(lang === "ar" ? `اليسرى ${r2(v.stepTime.left)} ث` : `left ${r2(v.stepTime.left)} s`);
  parts.push(
    v.level === "timing"
      ? lang === "ar"
        ? "توقيت فقط"
        : "timing only"
      : patterns.length
        ? `${lang === "ar" ? "محتمل" : "possible"} ${patterns.join(lang === "ar" ? "، " : ", ")}`
        : lang === "ar"
          ? "لا نمط"
          : "no pattern",
  );
  return parts.join(lang === "ar" ? "، " : ", ") + (lang === "ar" ? "." : ".");
}

/** A neutral intake for the rules of a full reading in the lab (no body map, no condition). */
const LAB_INTAKE = (heightCm: number | null): Intake => ({
  age: 40,
  conditions: [],
  diagnosisNotes: "",
  medications: "",
  mobility: "standing",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: [],
  goal: "mobility",
  days: [],
  time: "",
  sessionMinutes: 20,
  consent: true,
  sex: "male",
  regions: [],
  walking: { status: "without_aid" },
  ...(heightCm ? { heightCm } : {}),
});

function planFor(view: GaitLabView): GaitPlan {
  return {
    offered: true,
    modes: ["overground"],
    defaultMode: "overground",
    padAllowed: false,
    helperRequired: false,
    antalgicOnly: false,
    staticStance: false,
    views: { overground: view === "front" ? ["front", "back"] : ["side"], walking_pad: [] },
  };
}

function resultOf(
  ctl: GaitController,
  view: GaitLabView,
  lang: Lang,
  model: "lite" | "full",
  heightCm: number | null,
): GaitLabResult {
  const body = ctl.body();
  const views: GaitViewResult[] = body?.analysis.views ?? [];
  const v = walkVerdict(views);
  let patterns: string[] = [];
  if (body && v.level === "full")
    try {
      patterns = evaluateGait({
        analysis: body.analysis as GaitAnalysis,
        intake: LAB_INTAKE(heightCm),
        romProfile: null,
        today: { painByRegion: {} },
        plan: ctl.plan,
        setup: body.setup,
      })
        .patterns.filter((p) => p.status === "possible" || p.status === "likely")
        .map((p) => `${p.pattern}:${p.side}:${p.status}`);
    } catch {
      patterns = [];
    }
  return {
    view,
    model,
    level: v.level,
    verdict: verdictLine(v, lang, patterns),
    cadence: v.cadence,
    stepTime: v.stepTime,
    cleanCycles: v.cleanCycles,
    reasons: v.reasons,
    patterns,
    diagnostics: ctl.diagnostics(),
    views: views.map((x) => ({
      view: x.view,
      cleanCycles: x.quality.cleanCycles,
      fps: x.quality.medianFps,
      issues: [...x.quality.issues],
    })),
    engineVersion: body?.analysis.engineVersion ?? "",
    at: new Date().toISOString(),
  };
}

export default function GaitLab({ view: asked }: { view: string }) {
  const qs = useMemo(() => new URLSearchParams(location.search), []);
  const view: GaitLabView = asked === "front" ? "front" : "side";
  const lang: Lang = qs.get("lang") === "en" ? "en" : "ar";
  const auto = qs.get("auto") === "1";
  const heightCm = Number(qs.get("height")) || null;
  const forced = qs.get("model");
  // The device's remembered model, as the smoke page sets it (C-10), before the camera starts.
  useMemo(() => {
    if (forced !== "full" && forced !== "lite") return;
    try {
      const at = Date.now();
      localStorage.setItem(
        MODEL_MEMORY_KEY,
        JSON.stringify({ rom: { model: forced, at }, gait: { model: forced, at } }),
      );
    } catch {
      /* private mode: the probe decides */
    }
  }, [forced]);
  const focus = useFocusCamera();
  const [run, setRun] = useState(0);
  const ctl = useMemo(
    () =>
      new GaitController({
        plan: planFor(view),
        painBefore: null,
        intake: { walking: { status: "without_aid" }, ...(heightCm ? { heightCm } : {}), regions: [] },
        poseModel: () => focus.model,
      }),
    // A new controller for each run of the lab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run],
  );
  const version = useRef(0);
  const subscribe = useMemo(
    () => (fn: () => void) =>
      ctl.subscribe(() => {
        version.current++;
        fn();
      }),
    [ctl],
  );
  useSyncExternalStore(subscribe, () => version.current);

  // The camera: the focus check's camera, or a recorded walk on a VITE_E2E build.
  const fixture = import.meta.env.VITE_E2E === "1" ? qs.get("fixture") : null;
  const e2eCam = useMemo(() => {
    if (!fixture) return null;
    return new CameraSession(async (): Promise<PoseSource> => {
      const { FixturePoseSource } = await import("../assessment/e2e/FixturePoseSource");
      return new FixturePoseSource(fixture, { loop: false });
    });
  }, [fixture]);
  const session = e2eCam ?? focus.session;
  const frame = useRef<Frame | null>(null);
  const times = useRef<number[]>([]);
  const step = ctl.current;
  const cameraOn = CAMERA_STEPS.has(step.id);
  const cam = useCameraSession(
    (f) => {
      frame.current = f;
      const ts = times.current;
      ts.push(f.t);
      while (ts.length > 1 && f.t - ts[0] > 2000) ts.shift();
      ctl.feed(f, { rollDeg: null });
    },
    cameraOn,
    session,
  );
  useEffect(() => {
    if (!e2eCam) focus.preload("gait");
  }, [e2eCam, focus]);

  // The walk's taps the lab answers itself: the intro, the shoes, the path; auto also the placement.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    ctl.start(t0);
    for (let i = 0; i < 6 && ctl.current.id !== "place"; i++) {
      if (ctl.current.id === "gear") ctl.setGear({ shoes: true, brace: null }, t0);
      else ctl.confirm(t0);
    }
    const id = setInterval(() => {
      const t = performance.now();
      ctl.tick(t);
      setNow(t);
    }, 250);
    return () => clearInterval(id);
  }, [ctl]);
  const probed = useRef(false);
  useEffect(() => {
    if (step.id !== "place" || cam.status !== "running") return;
    if (!e2eCam && !probed.current && !forced) {
      probed.current = true;
      void focus.probe("gait").catch(() => null);
    }
    if (auto) ctl.confirm(performance.now());
  }, [step.id, cam.status, auto, ctl, e2eCam, focus, forced]);
  // auto: a re-record shows the result (the smoke never walks again).
  useEffect(() => {
    if (auto && step.id === "retry") ctl.retry(false, performance.now());
  }, [auto, step.id, ctl]);

  // The live reading, every 2 s while walking (never in the real capture, which reads at checkpoints).
  const [live, setLive] = useState<{ views: GaitViewResult[]; at: number } | null>(null);
  useEffect(() => {
    if (step.id !== "walk") return;
    const id = setInterval(() => setLive({ views: ctl.analyseNow(), at: performance.now() }), 2000);
    return () => clearInterval(id);
  }, [step.id, ctl]);

  // The end: the result, never posted.
  const [result, setResult] = useState<GaitLabResult | null>(null);
  useEffect(() => {
    if (step.id !== "saving" || result) return;
    setResult(resultOf(ctl, view, lang, focus.model, heightCm));
  }, [step.id, result, ctl, view, lang, focus.model, heightCm]);
  useEffect(() => {
    (window as unknown as { __azmGaitLab?: GaitLabState }).__azmGaitLab = {
      status: result ? "done" : "running",
      view,
      result,
    };
  }, [result, view]);

  const restart = () => {
    setResult(null);
    setLive(null);
    probed.current = false;
    setRun((n) => n + 1);
  };

  const d = ctl
    .diagnostics()
    .find((x) => x.rec === (view === "front" ? "overground_front" : "overground_side"));
  const lv = ctl.live();
  const verdict = live ? walkVerdict(live.views) : null;
  const events: GaitEvent[] = (live?.views ?? [])
    .flatMap((v) => v.events)
    .filter((e) => e.type === "ic")
    .sort((a, b) => a.t - b.t);
  const fps =
    times.current.length > 1
      ? Math.round(
          ((times.current.length - 1) * 10000) / (times.current[times.current.length - 1] - times.current[0]),
        ) / 10
      : null;
  const level = result?.level ?? verdict?.level ?? null;
  const cycles = result?.cleanCycles ?? verdict?.cleanCycles ?? d?.cleanCycles ?? { left: 0, right: 0 };

  return (
    <Page
      lang={lang}
      screen={`gaitlab-${step.id}`}
      step={result ? "result" : "lab"}
      top={<header className="fx-top" />}
      wide
    >
      <div className="gx-lab" data-lab-view={view} data-step={step.id} data-level={level ?? "none"}>
        <Glass className="fx-card gx-lab-head">
          <Kicker>{say(lang, "title")}</Kicker>
          <Title>{say(lang, view)}</Title>
          <Body lang={lang} text={say(lang, "never")} muted />
        </Glass>
        {!result && (
          <Stage video={cam.hasPicture ? cam.video : null} frame={frame} highlight={[]}>
            <div className="fx-stage-top">
              <span className="fx-pill is-glass gx-lab-step" data-step={step.id}>
                <b>{step.id}</b>
              </span>
            </div>
          </Stage>
        )}
        {!result && (
          <Glass className="fx-card gx-lab-live">
            <dl className="gx-lab-grid">
              <div>
                <dt>{say(lang, "steps")}</dt>
                <dd data-live="steps">{lv?.steps ?? d?.steps ?? 0}</dd>
              </div>
              <div>
                <dt>{say(lang, "passes")}</dt>
                <dd data-live="passes">
                  {d?.passes ?? 0} / {view === "front" ? 2 * (lv?.target ?? 0) : (lv?.target ?? 0)}
                </dd>
              </div>
              <div>
                <dt>{say(lang, "cycles")}</dt>
                <dd data-live="cycles">
                  {cycles.right} / {cycles.left}
                </dd>
              </div>
              <div>
                <dt>{say(lang, "visible")}</dt>
                <dd data-live="visible">
                  {d?.visibleShare === null || d?.visibleShare === undefined
                    ? "none"
                    : `${Math.round(d.visibleShare * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>{say(lang, "fps")}</dt>
                <dd data-live="fps">{fps ?? "none"}</dd>
              </div>
              <div>
                <dt>{say(lang, "gate")}</dt>
                <dd data-live="gate">
                  {say(lang, level === "full" ? "full" : level === "timing" ? "timing" : "none")} ·{" "}
                  {GAIT_ENGINE.cleanCyclesPerSide} / {GAIT_MVP.timingCyclesPerSide}
                </dd>
              </div>
            </dl>
            <p className="fx-meta" data-live="events">
              {say(lang, "events")}:{" "}
              {events
                .slice(-10)
                .map((e) => `${e.side === "right" ? "R" : "L"} ${(e.t / 1000).toFixed(2)}`)
                .join("  ") || "none"}
            </p>
            {step.id === "place" && (
              <Body lang={lang} text={gt(lang, view === "front" ? "place.front3" : "place.side3")} />
            )}
            {step.id === "walk" && (
              <Body lang={lang} text={gt(lang, view === "front" ? "walk.frontSay" : "walk.sideSay")} />
            )}
            {step.id === "retry" && (
              <Body lang={lang} text={gt(lang, `retry.reason.${ctl.retryReason() ?? "more_steps"}`)} />
            )}
          </Glass>
        )}
        {!result && (
          <Actions
            sticky
            items={[
              step.id === "place" && !auto
                ? {
                    label: say(lang, "start"),
                    name: "start",
                    icon: "play",
                    onClick: () => ctl.confirm(performance.now()),
                  }
                : null,
              step.id === "walk"
                ? {
                    label: say(lang, "finish"),
                    name: "finish",
                    icon: "check",
                    onClick: () => ctl.finishNow(performance.now()),
                  }
                : null,
              step.id === "retry"
                ? {
                    label: say(lang, "showResult"),
                    name: "show_result",
                    kind: "secondary",
                    onClick: () => ctl.retry(false, performance.now()),
                  }
                : null,
              step.id === "retry"
                ? {
                    label: say(lang, "tryAgain"),
                    name: "try_again",
                    icon: "refresh",
                    onClick: () => ctl.retry(true, performance.now()),
                  }
                : null,
            ]}
          />
        )}
        {result && (
          <>
            <Glass className="fx-card gx-lab-result" tone={result.level === "none" ? "rose" : "gold"}>
              <p className="gx-lab-verdict" data-result={result.level}>
                {result.verdict}
              </p>
              <pre className="gx-lab-json" dir="ltr" data-result="json">
                {JSON.stringify(result, null, 1)}
              </pre>
            </Glass>
            <Actions
              items={[{ label: say(lang, "again"), name: "again", icon: "refresh", onClick: restart }]}
            />
          </>
        )}
        <span hidden data-now={Math.round(now)} />
      </div>
    </Page>
  );
}
