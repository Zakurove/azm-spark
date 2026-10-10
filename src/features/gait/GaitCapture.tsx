/**
 * The walk's screens (product v7 contract 2.8.4, stream C, step C4; plan 2.5; D-036 item 6: one walk,
 * the side view): the setup with the phone's placement (one clear instruction and picture: across
 * the picture and back, side on to the phone), every pad safety step and the clear path as taps
 * (C-16 confirm steps), the live capture with the walker's lines over the picture, a step counter,
 * «pass N of 4» or the pad's seconds, «I have finished» always there, and calm hints, the static single
 * leg stance, the pad's speed and handrail, and the result card (labels only while provisional).
 * GaitController holds the logic; this file wires it to the camera (the focus check's one camera,
 * C-10), the coach's events and the buttons the coach may press on the person's spoken words (D-036
 * item 2, coachActions.ts), and the gait route. Only the Live coach speaks (D-036 item 1): without it
 * the walk is silent and its screens carry every line.
 *
 * Loaded lazily by GaitStep, so the focus check's first chunk never carries the gait engine (section 9).
 * VITE_E2E builds only: ?e2eGait=1 plays the gait fixtures (tests/fixtures/gait/catalog.ts) for each
 * recording instead of the camera, and ?e2eFast=1 runs them twice as fast with a short warm up.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import type { Tilt } from "../../engine/quality";
import type { Frame } from "../../engine/types";
import { localizeDigits } from "../../i18n";
import { bidiText } from "../../i18n/rich";
import { tV7 } from "../../i18n/v7";
import type { GaitStoredView } from "../../medical/gait-types";
import CheckIcon from "../assessment/shared/CheckIcon";
import { CountdownRing } from "../assessment/safety/parts";
import { CameraSession, useCameraSession } from "../assessment/camera/session";
import { useOrientation } from "../assessment/camera/hooks";
import { useFocusCamera } from "../focus/camera";
import { Actions, Body, Glass, Kicker, Loading, Timer, Title } from "../focus/parts";
import { Stage } from "../focus/Stage";
import { readIntake, saveGait } from "./api";
import { useCoach } from "../coach-agent/useCoach";
import { SILENT_VOICE } from "../coach-agent/LocalVoice";
import { CoachCaption } from "../coach-agent/CoachCaption";
import { unlockCoachAudio } from "../coach-agent/audio/context";
import { useScreenActions } from "../coach-agent/useScreenActions";
import { gaitScreenActions } from "./coachActions";
import {
  CAMERA_STEPS,
  CAPTURE_RULES,
  GaitController,
  KM_PER_MILE,
  PAD_SPEED_KMH,
  type GearAnswer,
  type Orthosis,
  type RecordingId,
} from "./controller";
import { gt, num, qualityLine, setupLine, sideWord } from "./copy";
import { GaitFindingsCard } from "./GaitFindingsCard";
import type { GaitStepProps } from "./GaitStep";
import { Illustration } from "../visuals/Illustration";
import { Placement, type PlacementKind } from "./Placement";
import "./gait.css";

/* ------------------------------------------------------------------ e2e */

interface E2eGait {
  /** Gait fixtures in place of the camera. */
  gait: boolean;
  fast: boolean;
  clock: () => number;
}

/** The E2E options of a VITE_E2E=1 build (read once). */
function e2eOptions(): E2eGait {
  const real = { gait: false, fast: false, clock: () => performance.now() };
  if (import.meta.env.VITE_E2E !== "1" || typeof location === "undefined") return real;
  const qs = new URLSearchParams(location.search);
  const fast = qs.get("e2eFast") === "1";
  return { gait: qs.get("e2eGait") === "1", fast, clock: fast ? () => performance.now() * 2 : real.clock };
}

/** The gait fixture of a step (VITE_E2E builds): the recording's walk, or the stance. */
export function fixtureFor(ctl: GaitController): string {
  const s = ctl.current;
  if (s.id === "stance" || s.id === "stance_place") return "gait/stance";
  const rec: RecordingId | undefined =
    s.rec ?? ctl.plannedSteps.slice(ctl.plannedSteps.indexOf(s)).find((x) => x.rec)?.rec;
  switch (rec) {
    case "overground_side":
      return "gait/overground-side";
    case "pad_front":
      return "gait/pad-front";
    case "pad_side_a":
    case "pad_side_b":
      return ctl.viewsOf(rec)[0]?.nearSide === "left" ? "gait/pad-side-left" : "gait/pad-side-right";
    default:
      return "gait/overground-side";
  }
}

/* -------------------------------------------------------------- helpers */

const PLACEMENT: Record<RecordingId, PlacementKind> = {
  overground_side: "overground_side",
  pad_side_a: "pad_side",
  pad_side_b: "pad_side",
  pad_front: "pad_front",
};

/**
 * The walking pad's safety steps as one checklist (D-032 item 2; gait-rules eligibility.padSafety): the
 * floor and the space behind, the helper by the stop control, the safety key, the speed set by hand,
 * and the support away from the phone with the helper behind.
 */
export function padChecklist(lang: Lang): string[] {
  return [
    gt(lang, "pad.floor1"),
    gt(lang, "pad.floor2"),
    setupLine("pad_key", lang),
    setupLine("pad_auto_off", lang),
    gt(lang, "pad.support1"),
    gt(lang, "pad.support2"),
  ];
}

/** The step's main instruction, for the coach's repeat_instructions (2.11) and screen readers. */
export function instructionText(ctl: GaitController, lang: Lang): string {
  const s = ctl.current;
  const rec = s.rec;
  const side = rec ? ctl.viewsOf(rec)[0]?.nearSide : undefined;
  switch (s.id) {
    case "clear_path":
      return setupLine("clear_path", lang);
    case "pad_check":
      return padChecklist(lang).join(" ");
    case "pad_on":
      return gt(lang, "pad.on1");
    case "pad_start":
      return rec === "pad_side_a" ? gt(lang, "pad.start1") : gt(lang, "pad.startAgain");
    case "pad_stop":
      return setupLine("pad_stop", lang);
    case "stance":
    case "stance_place":
      return setupLine("single_leg_static", lang);
    case "place":
      if (rec === "overground_side")
        return `${gt(lang, "place.side1")} ${gt(lang, "place.side2")} ${gt(lang, "place.side3")}`;
      if (rec === "pad_front") return `${gt(lang, "place.padFront1")} ${gt(lang, "place.padFront2")}`;
      return `${gt(lang, "place.padSide1")} ${gt(lang, "place.padSide2")}${side ? "" : ""}`;
    case "walk":
      if (rec === "overground_side") return gt(lang, "walk.sideSay");
      return gt(lang, "walk.padTitle");
    default:
      return setupLine("stop_any_time", lang);
  }
}

/** The kind of a stand or walk step's view: the overground side walk, or the pad. */
const viewKindOf = (rec: RecordingId | undefined): "side" | "pad" =>
  rec === "overground_side" ? "side" : "pad";

/* --------------------------------------------------------------- the step */

export default function GaitCapture(props: GaitStepProps) {
  const { plan, checkId, lang, painBefore, onDone, onStop, onSkip } = props;
  const e2e = useMemo(e2eOptions, []);
  const clock = e2e.clock;
  const focus = useFocusCamera();
  const ctl = useMemo(
    () =>
      new GaitController({
        plan,
        painBefore: painBefore ?? null,
        poseModel: () => focus.model,
        ...(e2e.fast ? { warmUpSec: 6 } : {}),
      }),
    // One controller for the whole walk (its plan and score before are fixed when it starts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Every change of the controller renders the step (a version counter).
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

  // The walk's setup reads the intake (the aid, the height, a prosthesis side).
  useEffect(() => {
    let live = true;
    void readIntake().then((intake) => {
      if (live) ctl.setIntake(intake);
    });
    return () => {
      live = false;
    };
  }, [ctl]);

  // The camera: the focus check's one camera (C-10), or the gait fixtures on an E2E build.
  const e2eCam = useMemo(() => {
    if (import.meta.env.VITE_E2E !== "1" || !e2e.gait) return null;
    return new CameraSession(async () => {
      const { FixturePoseSource } = await import("../assessment/e2e/FixturePoseSource");
      const realEvery = (ms: number, fn: () => void) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      };
      // A spec may play another fixture for the next recording (window.azmGaitFixture, "empty": nobody).
      const pick = (window as unknown as { azmGaitFixture?: string }).azmGaitFixture;
      return new FixturePoseSource(pick || fixtureFor(ctl), { clock: { now: clock, every: realEvery } });
    });
  }, [ctl, e2e.gait, clock]);
  const session = e2eCam ?? focus.session;
  const step = ctl.current;
  const cameraOn = CAMERA_STEPS.has(step.id) && !ctl.stopList && !ctl.stopped;
  const orientation = useOrientation();
  const tilt = useRef<Tilt | null>(null);
  tilt.current = orientation.tilt;
  const frame = useRef<Frame | null>(null);
  const cam = useCameraSession(
    (f) => {
      frame.current = f;
      ctl.feed(f, { rollDeg: tilt.current?.rollDeg ?? null, tilt: tilt.current });
    },
    cameraOn,
    session,
  );
  // E2E: each recording plays its own fixture.
  const fixture = e2eCam ? fixtureFor(ctl) : null;
  useEffect(() => {
    if (e2eCam && fixture) void e2eCam.replaceSource();
  }, [e2eCam, fixture]);
  // C-10: the gait floor's probe once, at the first placement while the camera runs (never mid walk).
  const probed = useRef(false);
  useEffect(() => {
    if (e2eCam || probed.current || step.id !== "place" || cam.status !== "running") return;
    probed.current = true;
    void focus.probe("gait").catch(() => null);
  }, [e2eCam, step.id, cam.status, focus]);

  // The clock: timers, the overground rest after the last pass, a checkpoint's analysis.
  const [now, setNow] = useState(clock);
  useEffect(() => {
    ctl.start(clock());
    const id = setInterval(() => {
      const t = clock();
      ctl.tick(t);
      setNow(t);
    }, 250);
    return () => clearInterval(id);
  }, [ctl, clock]);

  // The walk's coach segment (C-6: gait), with the GaitController as its host (step D5): on with the
  // shell's sound switch, the live_coach consent and a network (props.coachOn), else off (C-5). Only
  // the Live coach speaks (D-036 item 1): no local voice, the screens carry every line.
  const coach = useCoach(
    props.coachOn
      ? { block: "gait", segment: "gait", lang, ref: { checkId }, host: ctl, local: SILENT_VOICE }
      : null,
  );
  ctl.coachLive = coach.mode === "live";
  ctl.coachOn = props.coachOn === true;
  // D-036 item 2: the buttons the Live coach may press on the person's spoken words, the very calls of
  // the taps (never the pad's safety checklist, a question or a stop).
  useScreenActions(ctl.actions, gaitScreenActions(ctl, clock));
  // The coach's events (2.11): every step start, checkpoint, hint and safety stop, to the walk's own
  // segment and to the shell's coach (off during the walk).
  const coachRef = useRef(props.coach);
  coachRef.current = props.coach;
  const pushRef = useRef(coach.push);
  pushRef.current = coach.push;
  useEffect(
    () =>
      ctl.onBridge((e) => {
        pushRef.current(e);
        coachRef.current(e);
      }),
    [ctl],
  );
  ctl.instructions = () => instructionText(ctl, lang);
  // What of B's slot shows (D-030 C4-7): told whenever it changes.
  const chrome = walkChrome(ctl);
  const onChrome = useRef(props.onChrome);
  onChrome.current = props.onChrome;
  useEffect(() => {
    onChrome.current?.({ hero: chrome.hero, skip: chrome.skip });
  }, [chrome.hero, chrome.skip]);
  // E2E builds only: the review screenshots and the specs read the walk (and play the coach's calls).
  useEffect(() => {
    if (import.meta.env.VITE_E2E !== "1") return;
    (window as unknown as { azmGait?: GaitController }).azmGait = ctl;
  }, [ctl]);

  // The partial walk is kept when the walk stops (gait-rules stops: the completed clean cycles count).
  const posted = useRef(false);
  const postPartial = () => {
    if (posted.current || !ctl.anythingRecorded) return;
    const body = ctl.body();
    // The gait route needs the pad's speed, asked after the walk (contract gap C4-6).
    if (!body || (body.setup.mode === "walking_pad" && body.setup.padSpeedKmh === null)) return;
    posted.current = true;
    void saveGait(checkId, body);
  };
  // The shell's X «توقّف الآن» (D-034 item 4: no red STOP on the walk's screens) stops the walk here.
  const stopRef = props.stopRef;
  useEffect(() => {
    if (!stopRef) return;
    stopRef.current = () => ctl.requestStop(clock());
    return () => {
      stopRef.current = null;
    };
  }, [stopRef, ctl, clock]);
  // D-036 item 1: on a walking pad that may still run, a stop's safety line (hold the support, the
  // helper stops the pad) is no longer spoken: the shell's stop list shows it.
  const padStop = useRef(false);
  useEffect(
    () =>
      ctl.onLine((line) => {
        if (line === "gait_pad_stop") padStop.current = true;
      }),
    [ctl],
  );
  const stopNote = () => {
    const note = padStop.current ? setupLine("pad_stop", lang) : null;
    padStop.current = false;
    return note;
  };
  // A stop (the X's or the coach's): the shell's stop list, with the coach's reason preselected.
  const stopList = ctl.stopList;
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;
  useEffect(() => {
    if (!stopList) return;
    postPartial();
    onStopRef.current(stopList.preselect, stopNote());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopList]);
  // A pain stop (C-15): the walk ends, kept; the stop list opens with pain, so the shell asks the
  // pain again before the next movements of the joints a walk loads (B3-5).
  useEffect(() => {
    if (ctl.outcome !== "pain_limited") return;
    postPartial();
    onStopRef.current("pain", stopNote());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.outcome]);

  // The save: the body of every recording kept, then the result card.
  useEffect(() => {
    if (step.id !== "saving") return;
    const body = ctl.body();
    if (!body) {
      ctl.nothingSaved(clock());
      return;
    }
    let live = true;
    posted.current = true;
    void saveGait(checkId, body).then((r) => {
      if (!live) return;
      if (r.ok) ctl.saved(r.value, clock());
      else if (r.status === 409 && r.code === "ALREADY_SAVED") ctl.saved(storedFrom(body), clock());
      else {
        posted.current = false;
        ctl.saveFailed(clock());
      }
    });
    return () => {
      live = false;
    };
  }, [step.id, step, ctl, checkId, clock]);

  // Leaving the result card: the stored walk to the shell, or nothing to save.
  const leaving = ctl.leaving;
  useEffect(() => {
    if (!leaving) return;
    if (ctl.stored) onDone(ctl.stored as GaitStoredView);
    else if (onSkip) onSkip();
    else onStopRef.current(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const stage = (compact: boolean, children?: ReactNode) => (
    <Stage video={cam.hasPicture ? cam.video : null} frame={frame} highlight={[]} compact={compact}>
      {children}
    </Stage>
  );
  return (
    <>
      <GaitScreen lang={lang} ctl={ctl} now={now} clock={clock} stage={stage} />
      {/* The live coach's words while it speaks (voice and captions together, step D5). */}
      <CoachCaption coach={coach} lang={lang} />
    </>
  );
}

/** A stored view's shape from a body the server already holds (409 ALREADY_SAVED after a lost answer). */
function storedFrom(body: ReturnType<GaitController["body"]> & object): GaitStoredView {
  const a = body.analysis;
  return {
    id: "",
    mode: a.mode,
    views: a.views.map((v) => ({
      view: v.view,
      ...(v.nearSide ? { nearSide: v.nearSide } : {}),
      metrics: v.metrics,
      cleanCycles: v.quality.cleanCycles,
    })),
    metrics: a.combined,
    patterns: [],
    findings: [],
    quality: {
      gatePassed: a.views.some((v) => v.quality.gatePassed),
      timingOnly: a.views.some((v) => v.quality.timingOnly),
      flags: a.flags,
    },
    replay: a.replay,
    provisional: true,
    ...(a.outcome ? { outcome: a.outcome } : {}),
    rulesVersion: "",
    created: Date.now(),
  };
}

/**
 * What to change next time, when the walk gave nothing (D-035 item 2): the line of the most useful
 * recording's reason, or null when a recording was read.
 */
function endReason(ctl: GaitController, lang: Lang): string | null {
  const d = ctl.diagnostics().filter((x) => !x.skipped && x.level !== null);
  if (!d.length || d.some((x) => x.level !== "none")) return null;
  const reason = d[0].reasons[0];
  const key =
    reason === "wrong_view"
      ? "side_on"
      : reason === "low_fps"
        ? "light"
        : reason === "visibility" || reason === "tracking"
          ? "whole_body"
          : reason === "no_person"
            ? "no_person"
            : "more_steps";
  return gt(lang, `retry.reason.${key}`);
}

/* -------------------------------------------------------------- screens */

export interface GaitScreenProps {
  lang: Lang;
  ctl: GaitController;
  now: number;
  clock(): number;
  /** The camera stage (compact for a preview), with things over the picture. */
  stage(compact: boolean, children?: ReactNode): ReactNode;
}

function Lines({ lang, lines }: { lang: Lang; lines: string[] }) {
  return (
    <ol className="fx-steps">
      {lines.map((l, i) => (
        <li key={i}>{bidiText(lang, l)}</li>
      ))}
    </ol>
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

/** The calm hint over the picture, or the level of the phone. */
function Hint({ lang, ctl }: { lang: Lang; ctl: GaitController }) {
  const h = ctl.hint;
  if (!h) return null;
  return (
    <p className="fx-caption is-warn gx-hint" role="status" data-hint={h}>
      {gt(lang, `hint.${h}`)}
    </p>
  );
}

/** A big choice with a second line (the mode). */
function BigChoice({
  title,
  note,
  icon,
  onPick,
  name,
}: {
  title: string;
  note: string;
  icon: "floor" | "pad";
  onPick(): void;
  name: string;
}) {
  return (
    <button type="button" className="gx-choice" onClick={onPick} data-value={name}>
      <span className="fx-choice-icon" aria-hidden="true">
        <ModeIcon kind={icon} />
      </span>
      <span className="gx-choice-text">
        <b>{title}</b>
        <small>{note}</small>
      </span>
    </button>
  );
}

/** A row of small answers (one of them chosen). */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange(v: T): void;
  name: string;
}) {
  return (
    <fieldset className="gx-field" data-field={name}>
      <legend>{label}</legend>
      <div className="gx-segmented">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            className={value === o.value ? "is-on" : undefined}
            data-value={o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function GearScreen({ lang, onDone }: { lang: Lang; onDone(g: GearAnswer): void }) {
  const [shoes, setShoes] = useState<"yes" | "no" | null>(null);
  const [brace, setBrace] = useState<"none" | Orthosis | null>(null);
  const [side, setSide] = useState<"right" | "left" | "both" | null>(null);
  const ready = shoes !== null && brace !== null && (brace === "none" || side !== null);
  return (
    <Glass className="fx-card gx-step" tone={undefined}>
      <Kicker>{gt(lang, "kicker")}</Kicker>
      <Title size="question">{gt(lang, "gear.title")}</Title>
      <Segmented<"yes" | "no">
        name="shoes"
        label={gt(lang, "gear.shoes")}
        value={shoes}
        onChange={setShoes}
        options={[
          { value: "yes", label: gt(lang, "gear.shoesYes") },
          { value: "no", label: gt(lang, "gear.shoesNo") },
        ]}
      />
      <Segmented<"none" | Orthosis>
        name="brace"
        label={gt(lang, "gear.brace")}
        value={brace}
        onChange={setBrace}
        options={[
          { value: "none", label: gt(lang, "gear.braceNone") },
          { value: "afo", label: gt(lang, "gear.braceAfo") },
          { value: "knee_brace", label: gt(lang, "gear.braceKnee") },
          { value: "kafo", label: gt(lang, "gear.braceKafo") },
        ]}
      />
      {brace !== null && brace !== "none" && (
        <Segmented<"right" | "left" | "both">
          name="side"
          label={gt(lang, "gear.side")}
          value={side}
          onChange={setSide}
          options={[
            { value: "right", label: gt(lang, "gear.sideRight") },
            { value: "left", label: gt(lang, "gear.sideLeft") },
            { value: "both", label: gt(lang, "gear.sideBoth") },
          ]}
        />
      )}
      <Actions
        items={[
          {
            label: gt(lang, "gear.next"),
            name: "next",
            icon: "arrow-forward",
            disabled: !ready,
            onClick: () =>
              ready &&
              onDone({
                shoes: shoes === "yes",
                brace: brace === "none" ? null : { kind: brace, side: side ?? "right" },
              }),
          },
        ]}
      />
    </Glass>
  );
}

function PadDetailsScreen({
  lang,
  onDone,
}: {
  lang: Lang;
  onDone(speed: number, unit: "kmh" | "mph", handrail: "none" | "light" | "firm"): void;
}) {
  const [unit, setUnit] = useState<"kmh" | "mph">("kmh");
  const [speed, setSpeed] = useState(3);
  const [handrail, setHandrail] = useState<"none" | "light" | "firm" | null>(null);
  const max = unit === "kmh" ? PAD_SPEED_KMH.max : Math.floor((PAD_SPEED_KMH.max / KM_PER_MILE) * 10) / 10;
  const min = unit === "kmh" ? PAD_SPEED_KMH.min : Math.ceil((PAD_SPEED_KMH.min / KM_PER_MILE) * 10) / 10;
  const set = (v: number) => setSpeed(Math.max(min, Math.min(max, Math.round(v * 10) / 10)));
  return (
    <Glass className="fx-card gx-step">
      <Kicker>{gt(lang, "kicker")}</Kicker>
      <Title size="question">{gt(lang, "pad.detailsTitle")}</Title>
      <fieldset className="gx-field" data-field="speed">
        <legend>{gt(lang, "pad.speed")}</legend>
        <div className="gx-speed">
          <button
            type="button"
            className="fx-chip is-icon"
            aria-label={gt(lang, "pad.less")}
            onClick={() => set(speed - PAD_SPEED_KMH.step)}
            data-action="less"
          >
            <CheckIcon name="minus" size={22} />
          </button>
          <output className="gx-speed-value" aria-live="polite">
            <b>{num(lang, speed, 1)}</b>
            <span>{gt(lang, unit === "kmh" ? "pad.kmh" : "pad.mph")}</span>
          </output>
          <button
            type="button"
            className="fx-chip is-icon"
            aria-label={gt(lang, "pad.more")}
            onClick={() => set(speed + PAD_SPEED_KMH.step)}
            data-action="more"
          >
            <CheckIcon name="plus" size={22} />
          </button>
        </div>
        <p className="fx-meta">{gt(lang, "pad.speedHint")}</p>
        <div className="gx-segmented is-small">
          {(["kmh", "mph"] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              className={unit === u ? "is-on" : undefined}
              onClick={() => {
                if (u === unit) return;
                setUnit(u);
                setSpeed(Math.round((u === "mph" ? speed / KM_PER_MILE : speed * KM_PER_MILE) * 10) / 10);
              }}
            >
              {gt(lang, u === "kmh" ? "pad.kmh" : "pad.mph")}
            </button>
          ))}
        </div>
      </fieldset>
      <Segmented<"none" | "light" | "firm">
        name="handrail"
        label={gt(lang, "pad.handrail")}
        value={handrail}
        onChange={setHandrail}
        options={[
          { value: "none", label: gt(lang, "pad.handrailNone") },
          { value: "light", label: gt(lang, "pad.handrailLight") },
          { value: "firm", label: gt(lang, "pad.handrailFirm") },
        ]}
      />
      <Actions
        items={[
          {
            label: gt(lang, "pad.next"),
            name: "next",
            icon: "arrow-forward",
            disabled: handrail === null,
            onClick: () => handrail && onDone(speed, unit, handrail),
          },
        ]}
      />
    </Glass>
  );
}

/** The standing calibration's progress (3 s), a calm gold bar. */
function Progress({ label, share }: { label: string; share: number }) {
  const pct = Math.round(share * 100);
  return (
    <div
      className="gx-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <i style={{ inlineSize: `${pct}%` }} />
    </div>
  );
}

/** The mode's two pictures: footsteps on the floor, and the walking pad. */
function ModeIcon({ kind }: { kind: "floor" | "pad" }) {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "floor" ? (
        <>
          <path d="M7.5 3.5c1.6 0 2.5 1.6 2.5 3.6S9.2 11 7.8 11 5 9.6 5 7.4 5.9 3.5 7.5 3.5z" />
          <path d="M6 13.2h3.4v1.9a1.7 1.7 0 0 1-3.4 0z" />
          <path d="M16.5 8.5c1.6 0 2.5 1.6 2.5 3.6s-.8 3.9-2.2 3.9-2.8-1.4-2.8-3.6.9-3.9 2.5-3.9z" />
          <path d="M15 18.2h3.4v1.9a1.7 1.7 0 0 1-3.4 0z" />
        </>
      ) : (
        <>
          <path d="M3 17.5h15.5a2.5 2.5 0 0 0 0-5H5.5" />
          <path d="M3 17.5l2.5 3M18 17.5l-2 3" />
          <path d="M15 12.5l3.5-8.5h2" />
          <circle cx="9" cy="6" r="1.6" />
          <path d="M9 8v3.5M7 10l2-1.5 2 1.5" />
        </>
      )}
    </svg>
  );
}

/** The pass now (from 1) of the fixed target («المرة 2 من 4»), read whole by a screen reader. */
function Counter({ value, label, of, total }: { value: string; label: string; of: string; total: string }) {
  return (
    <div className="gx-counter" aria-live="polite" role="status" aria-label={total} data-counter={total}>
      <span aria-hidden="true">{label}</span>
      <b aria-hidden="true">{value}</b>
      <em aria-hidden="true">{of}</em>
    </div>
  );
}

/** The walk's direction over the side path's picture: across, both ways (D-036 item 6). */
function AcrossArrow() {
  return (
    <svg className="gx-across" viewBox="0 0 240 24" aria-hidden="true" focusable="false">
      <path d="M14 12 H226" />
      <path d="M26 3 L12 12 L26 21" />
      <path d="M214 3 L228 12 L214 21" />
    </svg>
  );
}

/** The steps from which «لن أمشي اليوم» (the slot's skip) gives way to STOP: the person is set up to walk. */
const NO_SKIP: ReadonlySet<string> = new Set([
  "pad_on",
  "stand",
  "pad_start",
  "pad_warm_up",
  "walk",
  "walk_again",
  "retry",
  "pad_stop",
  "stance_place",
  "stance",
  "pad_details",
  "saving",
  "save_error",
  "pain_stop",
  "nothing",
  "done",
]);

/**
 * What the walk shows of B's slot (D-030 C4-7): its title card on the walk's first card only, and its
 * «لن أمشي اليوم» while nothing was recorded and the person is not set up to walk.
 */
export function walkChrome(ctl: GaitController): { hero: boolean; skip: boolean } {
  const s = ctl.current;
  return { hero: s.id === "intro", skip: !(ctl.anythingRecorded || NO_SKIP.has(s.id)) };
}

export function GaitScreen(props: GaitScreenProps) {
  const { ctl } = props;
  const s = ctl.current;
  const skipOff = !walkChrome(ctl).skip;
  return (
    <div className="gx-root" data-step={s.id} data-rec={s.rec} data-skip={skipOff ? "off" : "on"}>
      <StepScreen {...props} />
    </div>
  );
}

function StepScreen({ lang, ctl, now, clock, stage }: GaitScreenProps) {
  const s = ctl.current;
  const rec = s.rec;
  const plan = ctl.plan;
  const tap = () => ctl.confirm(clock());
  const card = (body: ReactNode, actions: ReactNode, opts: { tone?: "gold" | "violet" | "rose" } = {}) => (
    <div className={`gx-flow is-${s.id}`} data-step={s.id} data-rec={rec}>
      <Glass className="fx-card gx-step" tone={opts.tone}>
        {body}
      </Glass>
      {actions}
    </div>
  );
  const ready = (label: string, name = "ready") => (
    <Actions items={[{ label, name, icon: "check", onClick: tap }]} />
  );

  switch (s.id) {
    case "intro": {
      const both = plan.modes.length > 1;
      const lines = [
        gt(lang, both ? "intro.both" : ctl.mode === "walking_pad" ? "intro.pad" : "intro.overground", {
          n: localizeDigits(lang, String(CAPTURE_RULES.sidePasses)),
        }),
        gt(lang, "intro.minutes"),
      ];
      return card(
        <>
          {lines.map((l) => (
            <Body key={l} lang={lang} text={l} />
          ))}
          {plan.helperRequired && <Note lang={lang} icon="people" text={setupLine("helper_needed", lang)} />}
          {ctl.setup().aid !== "none" && <Note lang={lang} icon="info" text={setupLine("usual_aid", lang)} />}
          <Note lang={lang} icon="shield" text={setupLine("stop_any_time", lang)} />
        </>,
        <Actions
          items={[
            {
              label: gt(lang, "intro.start"),
              name: "start",
              icon: "arrow-forward",
              onClick: () => {
                // D-18: the coach's audio starts only inside a tap (iOS).
                if (ctl.coachOn) unlockCoachAudio();
                tap();
              },
            },
          ]}
        />,
      );
    }
    case "mode":
      return card(
        <>
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <Title size="question">{gt(lang, "mode.title")}</Title>
          <div className="gx-choices">
            <BigChoice
              name="overground"
              icon="floor"
              title={gt(lang, "mode.overground")}
              note={gt(lang, "mode.overgroundNote")}
              onPick={() => ctl.chooseMode("overground", clock())}
            />
            <BigChoice
              name="walking_pad"
              icon="pad"
              title={gt(lang, "mode.pad")}
              note={gt(lang, "mode.padNote")}
              onPick={() => ctl.chooseMode("walking_pad", clock())}
            />
          </div>
        </>,
        null,
      );
    case "gear":
      return (
        <div className="gx-flow is-gear" data-step="gear">
          <GearScreen lang={lang} onDone={(g) => ctl.setGear(g, clock())} />
        </div>
      );
    case "clear_path":
      return card(
        <>
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <Title>{gt(lang, "path.title")}</Title>
          <Body lang={lang} text={setupLine("clear_path", lang)} />
          <Body lang={lang} text={gt(lang, "path.length")} muted />
          <Note lang={lang} icon="refresh" text={setupLine("turn_slowly", lang)} />
        </>,
        ready(gt(lang, "path.ready")),
      );
    case "pad_check":
      return card(
        <>
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <Title>{gt(lang, "pad.checkTitle")}</Title>
          <Illustration
            group="walk"
            name="v7_walk_pad_safety"
            lang={lang}
            className="gx-placement"
            alt={
              lang === "ar"
                ? "فهد بجانب جهاز المشي المتوقف وسارة قرب زر الإيقاف"
                : "Fahd beside the stopped walking pad with Sara near the stop button"
            }
          />
          <ul className="gx-checklist">
            {padChecklist(lang).map((line) => (
              <li key={line}>
                <CheckIcon name="check" size={20} />
                <span>{bidiText(lang, line)}</span>
              </li>
            ))}
          </ul>
        </>,
        ready(gt(lang, "pad.checkReady")),
      );
    case "place":
      return <PlaceScreen lang={lang} ctl={ctl} stage={stage} />;
    case "pad_on":
      return (
        <div className="gx-flow gx-split is-pad_on" data-step="pad_on" data-rec={rec}>
          <Glass className="fx-card gx-step">
            <Kicker>{gt(lang, "kicker")}</Kicker>
            <Title>{gt(lang, "pad.onTitle")}</Title>
            <Body lang={lang} text={gt(lang, "pad.on1")} />
            {stage(true, <Hint lang={lang} ctl={ctl} />)}
          </Glass>
          <Actions items={[{ label: gt(lang, "pad.onReady"), name: "ready", icon: "check", onClick: tap }]} />
        </div>
      );
    case "stand": {
      const kind = viewKindOf(rec);
      return (
        <div className="gx-flow gx-capture is-stand" data-step="stand" data-rec={rec}>
          {stage(
            false,
            <>
              <div className="fx-stage-top">
                <span className="fx-pill is-glass">
                  <b>{gt(lang, "kicker")}</b>
                </span>
              </div>
              <Hint lang={lang} ctl={ctl} />
            </>,
          )}
          <Glass className="fx-card fx-sheet gx-sheet">
            <p className="fx-prompt-main">{gt(lang, `stand.${kind}Title`)}</p>
            <p className="fx-prompt-sub">{gt(lang, "stand.body")}</p>
            <Progress label={gt(lang, "stand.progress")} share={ctl.standingShare()} />
          </Glass>
        </div>
      );
    }
    case "pad_start": {
      const first = rec === "pad_side_a";
      return (
        <div className="gx-flow gx-split is-pad_start" data-step="pad_start" data-rec={rec}>
          <Glass className="fx-card gx-step">
            <Kicker>{gt(lang, "kicker")}</Kicker>
            <Title>{gt(lang, "pad.startTitle")}</Title>
            <Body lang={lang} text={first ? gt(lang, "pad.start1") : gt(lang, "pad.startAgain")} />
            {stage(true, <Hint lang={lang} ctl={ctl} />)}
          </Glass>
          <Actions
            items={[
              first && plan.modes.includes("overground")
                ? {
                    label: gt(lang, "pad.tooFast"),
                    name: "too_fast",
                    kind: "secondary",
                    onClick: () => ctl.padTooSlowForMe(clock()),
                  }
                : null,
              { label: gt(lang, "pad.walking"), name: "ready", icon: "check", onClick: tap },
            ]}
          />
        </div>
      );
    }
    case "pad_warm_up":
      return (
        <div className="gx-flow gx-capture is-warm" data-step="pad_warm_up" data-rec={rec}>
          {stage(false, <Hint lang={lang} ctl={ctl} />)}
          <Glass className="fx-card fx-sheet gx-sheet">
            <p className="fx-prompt-main">{gt(lang, "pad.warmTitle")}</p>
            <p className="fx-prompt-sub">{gt(lang, "pad.warm1")}</p>
            <Timer lang={lang} leftMs={ctl.timerLeft(now)} totalMs={ctl.timerTotal} size={132} />
            <PauseChip lang={lang} ctl={ctl} clock={clock} />
          </Glass>
        </div>
      );
    case "walk":
      return <WalkScreen lang={lang} ctl={ctl} stage={stage} clock={clock} />;
    case "walk_again":
      return card(
        <>
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <Title>{gt(lang, "again.title")}</Title>
          <Body lang={lang} text={gt(lang, "again.body")} />
        </>,
        <>
          <Actions
            items={[{ label: gt(lang, "again.walk"), name: "walk_again", icon: "play", onClick: tap }]}
          />
        </>,
        { tone: "rose" },
      );
    case "retry":
      // D-036 item 6: one calm «try once more», with «go on» always beside it.
      return card(
        <>
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <Title>{gt(lang, "retry.title")}</Title>
          <Body lang={lang} text={gt(lang, `retry.reason.${ctl.retryReason() ?? "more_steps"}`)} />
          <Body lang={lang} text={gt(lang, "retry.body")} muted />
        </>,
        <>
          <Actions
            items={[
              {
                label: gt(lang, "retry.skip"),
                name: "skip_part",
                kind: "secondary",
                onClick: () => ctl.retry(false, clock()),
              },
              {
                label: gt(lang, "retry.again"),
                name: "try_again",
                icon: "refresh",
                onClick: () => ctl.retry(true, clock()),
              },
            ]}
          />
        </>,
      );
    case "pad_stop":
      return card(
        <>
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <Title>{gt(lang, "pad.stopTitle")}</Title>
          <Body lang={lang} text={setupLine("pad_stop", lang)} />
        </>,
        <>{ready(gt(lang, "pad.stopped"))}</>,
      );
    case "stance_place":
      return (
        <div className="gx-flow gx-split is-stance_place" data-step="stance_place">
          <Glass className="fx-card fx-figure gx-figure">
            <Kicker>{gt(lang, "kicker")}</Kicker>
            <div className="gx-art">
              <Placement kind="stance" lang={lang} label={gt(lang, "stance.placeTitle")} />
            </div>
            <Title>{gt(lang, "stance.placeTitle")}</Title>
          </Glass>
          <div className="fx-side">
            <Glass className="fx-card">
              <Body
                lang={lang}
                text={gt(lang, ctl.mode === "walking_pad" ? "stance.placePad" : "stance.placeOverground")}
              />
              <Body lang={lang} text={setupLine("single_leg_static", lang)} muted />
              {stage(true, <Hint lang={lang} ctl={ctl} />)}
            </Glass>
            {ready(gt(lang, "stance.ready"))}
          </div>
        </div>
      );
    case "stance":
      return <StanceScreen lang={lang} ctl={ctl} now={now} clock={clock} stage={stage} />;
    case "pad_details":
      return (
        <div className="gx-flow is-pad_details" data-step="pad_details">
          <PadDetailsScreen lang={lang} onDone={(sp, u, h) => ctl.setPadDetails(sp, u, h, clock())} />
        </div>
      );
    case "saving":
      return (
        <div className="gx-flow is-saving" data-step="saving">
          <Loading text={gt(lang, "save.saving")} />
        </div>
      );
    case "save_error":
      return card(
        <>
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <Body lang={lang} text={gt(lang, "save.error")} />
        </>,
        <Actions
          items={[
            {
              label: gt(lang, "save.again"),
              name: "save_again",
              icon: "refresh",
              onClick: () => ctl.saveAgain(clock()),
            },
          ]}
        />,
      );
    case "pain_stop":
      return card(
        <>
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <Body lang={lang} text={qualityLine("pain_limited", lang)} />
        </>,
        null,
        { tone: "rose" },
      );
    case "nothing":
      return card(
        <>
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <Title>{gt(lang, "nothing.title")}</Title>
          <Body lang={lang} text={gt(lang, "nothing.body")} muted />
        </>,
        <Actions
          items={[
            {
              label: gt(lang, "nothing.next"),
              name: "continue",
              icon: "arrow-forward",
              onClick: () => ctl.leave(),
            },
          ]}
        />,
      );
    case "stopped":
      return null;
    case "done": {
      const stored = ctl.stored as GaitStoredView | null;
      return (
        <div className="gx-flow is-done" data-step="done">
          <Glass className="fx-card fx-hero gx-done" tone="gold">
            <span className="fx-badge is-gold" aria-hidden="true">
              <CheckIcon name="check" size={30} />
            </span>
            <Title>{gt(lang, "done.title")}</Title>
            {stored?.provisional && <Body lang={lang} text={gt(lang, "done.later")} muted />}
          </Glass>
          {stored && <GaitFindingsCard gait={stored} lang={lang} reason={endReason(ctl, lang)} />}
          <Actions
            items={[
              {
                label: gt(lang, "done.next"),
                name: "continue",
                icon: "arrow-forward",
                onClick: () => ctl.leave(),
              },
            ]}
          />
        </div>
      );
    }
  }
}

function PauseChip({ lang, ctl, clock }: { lang: Lang; ctl: GaitController; clock(): number }) {
  const paused = ctl.pausedBy !== null;
  return (
    <button
      type="button"
      className="fx-chip gx-pause"
      onClick={() => (paused ? ctl.resume("screen", clock()) : ctl.pause("screen", clock()))}
      aria-pressed={paused}
      data-action={paused ? "resume" : "pause"}
    >
      <CheckIcon name={paused ? "play" : "pause"} size={20} />
      <span>{gt(lang, paused ? "walk.resume" : "walk.pause")}</span>
    </button>
  );
}

function PlaceScreen({
  lang,
  ctl,
  stage,
}: {
  lang: Lang;
  ctl: GaitController;
  stage: GaitScreenProps["stage"];
}) {
  const rec = ctl.current.rec!;
  const near = ctl.viewsOf(rec)[0]?.nearSide ?? "right";
  const moved =
    rec === "pad_side_b" || (rec === "pad_front" && ctl.plannedSteps.some((x) => x.rec === "pad_side_a"));
  const titleKey =
    rec === "overground_side"
      ? "place.sideTitle"
      : rec === "pad_front"
        ? "place.padFrontTitle"
        : moved
          ? "place.padSideMoveTitle"
          : "place.padSideTitle";
  const title = gt(lang, titleKey, { side: sideWord(near, lang) });
  const lines =
    rec === "overground_side"
      ? [gt(lang, "place.side1"), gt(lang, "place.side2"), gt(lang, "place.side3")]
      : rec === "pad_front"
        ? [gt(lang, "place.padFront1"), gt(lang, "place.padFront2")]
        : [gt(lang, "place.padSide1"), gt(lang, "place.padSide2")];
  const level = ctl.hint !== "level";
  return (
    <div className="gx-flow gx-split is-place" data-step="place" data-rec={rec}>
      <Glass className="fx-card fx-figure gx-figure">
        {/* D-034 item 5: the phone's setup says nothing has started, and Ready stays on screen. */}
        <div className="fx-figure-head">
          <Kicker>{gt(lang, "kicker")}</Kicker>
          <span className="fx-pill is-waiting" data-state="not-started">
            {tV7(lang, "rom.setup.notStarted")}
          </span>
        </div>
        <figure className="gx-art">
          <Placement kind={PLACEMENT[rec]} side={near} lang={lang} label={title} />
          {/* D-036 item 6: the walk goes across the picture, side on to the phone, never toward it. */}
          {rec === "overground_side" && (
            <figcaption className="gx-art-caption is-across" data-caption={rec}>
              <AcrossArrow />
              <span>{gt(lang, "place.sideCaption")}</span>
            </figcaption>
          )}
        </figure>
        <Title>{title}</Title>
      </Glass>
      <div className="fx-side">
        <Glass className="fx-card">
          {/* The belt is stopped while the helper moves the phone (D-030 C4-3). */}
          {rec === "pad_side_b" && <Body lang={lang} text={setupLine("pad_other_side", lang)} />}
          <Lines lang={lang} lines={lines} />
          {stage(
            true,
            <div className="fx-stage-top">
              <span className={`fx-pill is-glass gx-level${level ? " is-level" : ""}`} data-level={level}>
                <CheckIcon name="phone-level" size={18} />
                <b>{gt(lang, level ? "place.level" : "place.tilted")}</b>
              </span>
            </div>,
          )}
          <p className="fx-meta">{gt(lang, "place.preview")}</p>
        </Glass>
      </div>
      <Actions
        sticky
        items={[
          {
            label: gt(lang, "place.ready"),
            name: "ready",
            icon: "check",
            onClick: () => ctl.confirm(performance.now()),
          },
        ]}
      />
    </div>
  );
}

function WalkScreen({
  lang,
  ctl,
  stage,
  clock,
}: {
  lang: Lang;
  ctl: GaitController;
  stage: GaitScreenProps["stage"];
  clock(): number;
}) {
  const rec = ctl.current.rec!;
  const live = ctl.live();
  const pad = rec.startsWith("pad");
  const title = pad ? gt(lang, "walk.padTitle") : gt(lang, "walk.sideTitle");
  const sub = pad ? gt(lang, "walk.padBody") : gt(lang, "walk.sideBody");
  const phase = live?.phase ?? "walking";
  const paused = ctl.pausedBy !== null;
  const left = live && pad ? Math.max(0, live.plannedSeconds - live.seconds) : 0;
  // D-036 item 6: «pass N of 4», the pass being walked, never beyond the fixed target.
  const passNow = live ? Math.min(live.passes + 1, live.target) : 0;
  return (
    <div
      className="gx-flow gx-capture is-walk"
      data-step="walk"
      data-rec={rec}
      data-phase={phase}
      data-paused={paused || undefined}
    >
      {stage(
        false,
        <>
          <div className="fx-stage-top">
            <span className="fx-pill is-glass">
              <b>{gt(lang, "kicker")}</b>
            </span>
            {live && (
              <span className="fx-pill is-glass is-count gx-steps">
                <b>{localizeDigits(lang, String(live.steps))}</b>
                <span>{gt(lang, "walk.steps")}</span>
              </span>
            )}
          </div>
          {phase === "checking" ? (
            <p className="fx-caption gx-checking" role="status">
              <span className="fx-spinner" aria-hidden="true" />
              {gt(lang, "walk.checking")}
            </p>
          ) : (
            <Hint lang={lang} ctl={ctl} />
          )}
        </>,
      )}
      <Glass className="fx-card fx-sheet gx-sheet">
        <div className="gx-sheet-row">
          <div className="gx-sheet-text">
            <p className="fx-prompt-main">{paused ? gt(lang, "walk.paused") : title}</p>
            {!paused && sub && <p className="fx-prompt-sub">{bidiText(lang, sub)}</p>}
          </div>
          {live &&
            (pad ? (
              <div className="gx-ring">
                <CountdownRing
                  leftMs={left * 1000}
                  totalMs={live.plannedSeconds * 1000}
                  size={112}
                  label={<b>{localizeDigits(lang, String(left))}</b>}
                />
                <span>{gt(lang, "walk.seconds")}</span>
              </div>
            ) : (
              <Counter
                value={localizeDigits(lang, String(passNow))}
                label={gt(lang, "walk.pass")}
                of={gt(lang, "walk.of", { n: localizeDigits(lang, String(live.target)) })}
                total={gt(lang, "walk.passOf", {
                  n: localizeDigits(lang, String(passNow)),
                  total: localizeDigits(lang, String(live.target)),
                })}
              />
            ))}
        </div>
        {live && !pad && (
          <div className="gx-passes" aria-hidden="true">
            {Array.from({ length: live.target }, (_, i) => (
              <i key={i} className={i < live.passes ? "is-done" : i === live.passes ? "is-now" : undefined} />
            ))}
          </div>
        )}
        <div className="gx-walk-actions">
          <PauseChip lang={lang} ctl={ctl} clock={clock} />
          {/* D-036 item 6: always a way to go on; the walk is read with what it holds. */}
          <button
            type="button"
            className="fx-chip gx-finish"
            onClick={() => ctl.finishWalk(clock())}
            data-action="finish_walk"
            disabled={phase === "checking"}
          >
            <CheckIcon name="check" size={20} />
            <span>{gt(lang, "walk.finish")}</span>
          </button>
        </div>
      </Glass>
    </div>
  );
}

function StanceScreen({
  lang,
  ctl,
  now,
  clock,
  stage,
}: {
  lang: Lang;
  ctl: GaitController;
  now: number;
  clock(): number;
  stage: GaitScreenProps["stage"];
}) {
  const st = ctl.stanceNow(now);
  const hold = CAPTURE_RULES.stanceHoldSec * 1000;
  const main =
    st.phase === "standing"
      ? gt(lang, "stance.standing")
      : st.phase === "switch"
        ? gt(lang, "stance.switch")
        : gt(lang, "stance.lift", { side: st.side ? sideWord(st.side, lang) : "" });
  return (
    <div
      className="gx-flow gx-capture is-stance"
      data-step="stance"
      data-phase={st.phase}
      data-side={st.side ?? undefined}
    >
      {stage(false, <Hint lang={lang} ctl={ctl} />)}
      <Glass className="fx-card fx-sheet gx-sheet">
        <div className="gx-sheet-row">
          <div className="gx-sheet-text">
            <p className="fx-prompt-main">{main}</p>
            {st.phase === "leg" && <p className="fx-prompt-sub">{gt(lang, "stance.liftBody")}</p>}
            {st.phase === "standing" && <p className="fx-prompt-sub">{gt(lang, "stand.body")}</p>}
            {st.phase === "standing" && (
              <Progress label={gt(lang, "stand.progress")} share={ctl.standingShare()} />
            )}
          </div>
          {st.phase === "leg" && (
            <div className="gx-ring">
              <CountdownRing
                leftMs={Math.max(0, st.leftMs)}
                totalMs={hold}
                size={112}
                label={<b>{localizeDigits(lang, String(Math.ceil(Math.max(0, st.leftMs) / 1000)))}</b>}
              />
            </div>
          )}
        </div>
        {st.phase === "leg" && (
          <Actions
            items={[
              {
                label: gt(lang, "stance.down"),
                name: "foot_down",
                kind: "secondary",
                onClick: () => ctl.stanceLegDone(clock()),
              },
            ]}
          />
        )}
        <PauseChip lang={lang} ctl={ctl} clock={clock} />
      </Glass>
    </div>
  );
}
