/**
 * The real model smoke page (product v7 contract 8.4, stream G, step G1): on a VITE_E2E=1 build,
 * /?e2eSmoke=<name> runs the real CameraPoseSource and the real runners on the camera that
 * Playwright's Chromium fakes from a recorded video (--use-file-for-fake-video-capture), and gives
 * the results as JSON to the harness (e2e/v7-model-smoke.spec.ts reads window.__azmSmoke), which
 * summarises them in local-docs/qa/v7/smoke-<date>.md. Any other option of a run (the pose model, for
 * example) is read from the page's own URL (spec.ts).
 *
 * The camera is the focus check's (focusCameraSession, C-10) on the run's model: model=full or lite
 * is kept in a memory store for the run only (the device's own model memory is never touched), and
 * model=auto runs the probe. Video never leaves the page. src/app/App.tsx opens this in a VITE_E2E=1
 * build only, so a default build has no chunk for it. It runs in the browser only: a server render is
 * empty.
 */
import { useEffect, useRef, useState } from "react";
import type { Lang } from "../../app/i18n";
import { focusCameraSession, MODEL_MEMORY_KEY, type PoseModel } from "../focus/camera";
import { RomRunner } from "../../engine/rom/runner";
import { analyseGaitView } from "../../engine/gait/analyse";
import { PerfMeter } from "./perf";
import { attachMeter } from "./perfProbe";
import { SmokeRun, type SmokeLive, type SmokeResult } from "./run";
import { parseSmokeSpec } from "./spec";
import "./smoke.css";

export interface SmokePageProps {
  /** The run: the value of ?e2eSmoke=<name>, named by G's harness. */
  name: string;
  lang: Lang;
  onLanguage(): void;
}

/** What the harness reads (window.__azmSmoke). */
export interface SmokeState {
  status: "running" | "done" | "error";
  error?: string;
  result?: SmokeResult;
}

const COPY = {
  ar: {
    title: "تشغيل النموذج الحقيقي على فيديو",
    camera: "الكاميرا",
    status: "الحالة",
    time: "الوقت",
    frames: "الإطارات",
    rate: "معدل الإطارات",
    model: "النموذج",
    detail: "القراءة",
    other: "English",
    statuses: { starting: "يبدأ", probing: "يقيس السرعة", running: "يعمل", done: "انتهى", error: "خطأ" },
    models: { full: "كامل", lite: "خفيف" },
  },
  en: {
    title: "Real model smoke run",
    camera: "Camera",
    status: "Status",
    time: "Time",
    frames: "Frames",
    rate: "Frame rate",
    model: "Model",
    detail: "Reading",
    other: "العربية",
    statuses: { starting: "starting", probing: "probing", running: "running", done: "done", error: "error" },
    models: { full: "Full", lite: "Lite" },
  },
} as const;

/** The forced model of a run as the focus camera's memory, for this run only. */
function modelMemory(model: PoseModel | null) {
  if (!model) return null;
  const at = Date.now();
  const data = new Map([[MODEL_MEMORY_KEY, JSON.stringify({ rom: { model, at }, gait: { model, at } })]]);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/** The WebGL renderer: tells the GPU from a software fallback (SwiftShader). */
function gpuName(): string | null {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return null;
  }
}

/** The result without the long lists, for the screen (the harness reads the whole of it). */
function shortResult(r: SmokeResult) {
  const { landmarks: _landmarks, ...rest } = r;
  return {
    ...rest,
    ...(rest.rom
      ? { rom: { ...rest.rom, trace: { ...rest.rom.trace, series: rest.rom.trace.series.length } } }
      : {}),
  };
}

export default function SmokePage({ name, lang, onLanguage }: SmokePageProps) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<SmokeState>({ status: "running" });
  const [live, setLive] = useState<SmokeLive | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const w = window as Window & { __azmSmoke?: SmokeState };
    const publish = (s: SmokeState) => {
      w.__azmSmoke = s;
      setState(s);
    };
    const parsed = parseSmokeSpec(name, location.search);
    if (!parsed.ok) {
      publish({ status: "error", error: parsed.error });
      return;
    }
    const spec = parsed.spec;
    const camera = focusCameraSession({ storage: modelMemory(spec.model === "auto" ? null : spec.model) });
    const meter = new PerfMeter(100_000);
    const detach = attachMeter(meter);
    const run = new SmokeRun(spec, {
      camera,
      createRunner: (opts) => new RomRunner(opts),
      analyse: analyseGaitView,
      meter,
      gpu: gpuName(),
      onMeasure(measure, ms) {
        try {
          performance.measure(measure, { start: performance.now() - ms, duration: ms });
          performance.clearMeasures(measure);
        } catch {
          /* no User Timing level 3 */
        }
      },
    });
    publish({ status: "running" });
    const offLive = run.onUpdate((l) => {
      setLive(l);
      setVideo(camera.session.video);
    });
    let alive = true;
    void run.start().then((result) => {
      if (alive) publish({ status: result.status, result, ...(result.error ? { error: result.error } : {}) });
    });
    return () => {
      alive = false;
      offLive();
      run.stop();
      detach();
    };
  }, [mounted, name]);

  // The session's one video element is shown while the page is up.
  useEffect(() => {
    const h = holder.current;
    if (!video || !h) return;
    h.appendChild(video);
    void video.play?.().catch(() => undefined);
    return () => {
      if (video.parentElement === h) h.removeChild(video);
    };
  }, [video]);

  if (!mounted) return null;
  const t = COPY[lang];
  const status = live && state.status === "running" ? live.status : state.status;
  return (
    <main
      className="smoke-page"
      dir={lang === "ar" ? "rtl" : "ltr"}
      data-testid="smoke-page"
      data-status={state.status}
    >
      <header>
        <div>
          <h1>{t.title}</h1>
          <p className="smoke-name" dir="ltr">
            {name}
          </p>
        </div>
        <button type="button" onClick={onLanguage}>
          {t.other}
        </button>
      </header>
      <div className="smoke-grid">
        <div className="smoke-video" ref={holder} aria-label={t.camera} />
        <section className="smoke-card">
          <dl>
            <dt>{t.status}</dt>
            <dd className="smoke-status" data-status={state.status}>
              {t.statuses[status]}
            </dd>
            <dt>{t.time}</dt>
            <dd dir="ltr">{live?.seconds ?? 0} s</dd>
            <dt>{t.frames}</dt>
            <dd>{live?.frames ?? 0}</dd>
            <dt>{t.rate}</dt>
            <dd dir="ltr">{live?.fps ?? 0} fps</dd>
            <dt>{t.model}</dt>
            <dd>{live ? t.models[live.model] : ""}</dd>
            {live?.detail ? (
              <>
                <dt>{t.detail}</dt>
                <dd dir="ltr">{live.detail}</dd>
              </>
            ) : null}
          </dl>
          {state.error ? (
            <p role="alert" dir="ltr">
              {state.error}
            </p>
          ) : null}
        </section>
      </div>
      {state.result ? (
        <pre className="smoke-result" data-testid="smoke-result">
          {JSON.stringify(shortResult(state.result), null, 2)}
        </pre>
      ) : null}
    </main>
  );
}
