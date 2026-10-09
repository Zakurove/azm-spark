/**
 * The coach's connection test page (D-035 item 4): /?coachlab=1 on a VITE_V7 build, signed in, with
 * &lang=en for English. One tap runs the Live coach's connection a stage at a time on this phone
 * (labRun.ts) and shows each stage with a tick and its time, or the exact error, then a verdict with
 * its reasons and the technical details to copy, so Nasser and the tech lead read the same thing.
 *
 *   - The tap does what the focus check's tap does (the phone's voice unlock, which sets the iOS audio
 *     session to playback, and the coach's AudioContext), so the test meets the check's conditions.
 *   - «مع تشغيل الكاميرا» opens the front camera first and keeps it on, as the range and walk screens
 *     do, and checks that it still runs once the microphone starts.
 *   - «كما قبل إصلاح iOS» asks for the microphone without setting play-and-record first, as v7.1 did: on
 *     an iPhone the microphone step then fails with InvalidStateError, which proves the cause.
 * Nothing is saved but the run's usage row (its cost and its failure). VITE_E2E builds with
 * ?e2eCoach=fake run on the fake coach (no token, no Google) with the real microphone and speaker.
 */
import { useEffect, useRef, useState } from "react";
import type { Lang } from "../../app/i18n";
import Icon from "../../app/Icon";
import { coachDeviceId, mintLabToken, sendUsageReport } from "./api";
import { audioSessionType, coachAudioContext, unlockCoachAudio } from "./audio/context";
import { MicCapture, browserMicDeps, captureModule, type ModuleSource } from "./audio/mic";
import { Speaker } from "./audio/speaker";
import {
  failureLine,
  labResponder,
  labSteps,
  runCoachLab,
  type LabDeps,
  type LabResult,
  type LabStep,
  type LabStepId,
} from "./labRun";
import { FakeLiveTransport } from "./fake";
import { PhoneVoice } from "./phoneVoice";
import { GenaiTransport } from "./transport";
import "./coach.css";

const COPY = {
  ar: {
    title: "اختبار اتصال المدرّب",
    intro:
      "يجرّب كل خطوة من اتصال المدرّب الصوتي على هذا الجهاز، ويعرض نتيجتها أو الخطأ كما هو. لا يحفظ شيئًا مما تقوله.",
    camera: "مع تشغيل الكاميرا",
    cameraHint: "كما في قياس الحركة: الكاميرا تعمل قبل الميكروفون.",
    old: "كما قبل إصلاح iOS، للمقارنة",
    oldHint: "يطلب الميكروفون وجلسة الصوت على وضع التشغيل، كما كان قبل الإصلاح.",
    run: "ابدأ الاختبار",
    again: "أعد الاختبار",
    running: "يجري الاختبار…",
    steps: {
      token: "رمز الاتصال من الخادم",
      socket: "فتح الاتصال",
      setup: "جاهزية جلسة المدرّب",
      mic: "إذن الميكروفون وتدفّق الصوت",
      audio: "معالج الصوت في المتصفح",
      first_audio: "أول صوت من المدرّب وتشغيله",
      answer: "سؤال «هل تسمعني؟» وإجابتك",
    } as Record<LabStepId, string>,
    answerNow: "أجب بصوتك الآن: «نعم، أسمعك»",
    skipped: "لم يُجرَّب",
    pass: "المدرّب يعمل على هذا الجهاز.",
    fail: "المدرّب لا يعمل على هذا الجهاز بعد.",
    reasons: "الأسباب",
    said: "قال المدرّب",
    heard: "سمع منك",
    details: "التفاصيل التقنية",
    copy: "انسخ التقرير",
    copied: "نُسخ التقرير",
    signIn: "سجّل الدخول أولًا، ثم افتح هذه الصفحة من جديد.",
    signInLink: "تسجيل الدخول",
    consent: "وافق على المدرّب المباشر في نموذج حالتك الطبية أولًا، ثم أعد الاختبار.",
    cameraFailed: "لم تعمل الكاميرا، فجرى الاختبار دونها:",
    seconds: (ms: number) => `${(ms / 1000).toLocaleString("ar", { maximumFractionDigits: 1 })} ث`,
  },
  en: {
    title: "Coach connection test",
    intro:
      "Tries each step of the voice coach's connection on this device and shows its result, or the error as it is. Nothing you say is kept.",
    camera: "With the camera on",
    cameraHint: "As in the movement check: the camera runs before the microphone.",
    old: "As before the iOS fix, to compare",
    oldHint: "Asks for the microphone with the audio session left on playback, as before the fix.",
    run: "Run the test",
    again: "Run again",
    running: "Testing…",
    steps: {
      token: "Connection token from the server",
      socket: "Connection opened",
      setup: "Coach session ready",
      mic: "Microphone permission and stream",
      audio: "The browser's audio processing",
      first_audio: "The coach's first audio, played",
      answer: "«Can you hear me?» and your answer",
    } as Record<LabStepId, string>,
    answerNow: "Answer aloud now: «Yes, I can hear you»",
    skipped: "Not tried",
    pass: "The coach works on this device.",
    fail: "The coach does not work on this device yet.",
    reasons: "Reasons",
    said: "The coach said",
    heard: "It heard",
    details: "Technical details",
    copy: "Copy the report",
    copied: "Report copied",
    signIn: "Sign in first, then open this page again.",
    signInLink: "Sign in",
    consent: "Agree to the live coach in your health form first, then run the test again.",
    cameraFailed: "The camera did not start, so the test ran without it:",
    seconds: (ms: number) => `${(ms / 1000).toLocaleString("en", { maximumFractionDigits: 1 })} s`,
  },
} as const;

/** VITE_E2E builds only: ?e2eCoach=fake runs the lab on the fake coach (no token, no Google). */
function fakeLab(): boolean {
  return (
    import.meta.env.VITE_E2E === "1" &&
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("e2eCoach") === "fake"
  );
}

/** 0.5 s of a soft 440 Hz tone as 24 kHz 16 bit PCM: the fake coach's voice. */
function tone(): ArrayBuffer {
  const n = 12_000;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.round(2000 * Math.sin((2 * Math.PI * 440 * i) / 24_000));
  return pcm.buffer;
}

const FAKE_TOKEN = {
  sessionId: "00000000-0000-4000-8000-000000000000",
  token: "auth_tokens/e2e-lab",
  model: "fake",
  apiVersion: "v1beta" as const,
  voice: "Achird",
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
  newSessionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  history: [
    { role: "user" as const, text: "[CTX lab lang=ar]" },
    { role: "model" as const, text: "جاهز." },
  ],
  minutesLeft: 60,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function CoachLab({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const [withCamera, setWithCamera] = useState(false);
  const [asBefore, setAsBefore] = useState(false);
  const [steps, setSteps] = useState<LabStep[]>(labSteps);
  const [live, setLive] = useState({ said: "", heard: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LabResult | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [copied, setCopied] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef<MediaStream | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    return () => {
      for (const t of camera.current?.getTracks() ?? []) t.stop();
    };
  }, [lang]);

  const run = () => {
    if (busy) return;
    // Inside the tap, as the focus check's tap: the phone's voice (iOS: the playback session) and the
    // coach's AudioContext.
    PhoneVoice.unlock();
    unlockCoachAudio();
    const sessionAtTap = audioSessionType();
    setBusy(true);
    setResult(null);
    setCopied(false);
    setCameraError("");
    setSteps(labSteps());
    setLive({ said: "", heard: "" });
    void (async () => {
      if (withCamera) {
        try {
          camera.current = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          if (video.current) {
            video.current.srcObject = camera.current;
            await video.current.play().catch(() => undefined);
          }
          await sleep(500);
        } catch (e) {
          setCameraError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
          camera.current = null;
        }
      }
      let micStream: MediaStream | null = null;
      let module: ModuleSource | null = null;
      const fake = fakeLab();
      const cameraState = async (settle: number) => {
        const track = camera.current?.getVideoTracks()[0];
        if (!track) return null;
        const before = video.current?.currentTime ?? 0;
        await sleep(settle);
        const after = video.current?.currentTime ?? 0;
        return {
          readyState: track.readyState,
          muted: track.muted,
          advancing: after > before,
          running: track.readyState === "live" && !track.muted && after > before,
        };
      };
      const deps: LabDeps = {
        now: () => performance.now(),
        mint: () =>
          fake
            ? Promise.resolve({ ok: true, token: FAKE_TOKEN, serverDate: null })
            : mintLabToken({ lang, deviceId: coachDeviceId() }),
        transport: () =>
          fake ? new FakeLiveTransport({ setupMs: 400, respond: labResponder(tone) }) : new GenaiTransport(),
        mic: (granted) =>
          new MicCapture({
            ...browserMicDeps,
            prepare: asBefore ? undefined : browserMicDeps.prepare,
            async getUserMedia(constraints) {
              const s = await browserMicDeps.getUserMedia(constraints);
              micStream = s;
              const t = s.getAudioTracks()[0];
              const st = t?.getSettings() ?? {};
              granted([t?.label, st.sampleRate ? `${st.sampleRate} Hz` : ""].filter(Boolean).join(", "));
              return s;
            },
            async addModule(ctx) {
              module = await captureModule(ctx);
            },
          }),
        speaker: () => new Speaker(),
        report: (r) => {
          if (!fake) sendUsageReport(r);
        },
        async probe(when) {
          const ctx = coachAudioContext();
          const track = (micStream as MediaStream | null)?.getAudioTracks()[0];
          return {
            audioSession: audioSessionType(),
            context: { state: ctx.state, sampleRate: ctx.sampleRate },
            ...(when === "after_mic" || when === "end"
              ? {
                  mic: track
                    ? { readyState: track.readyState, muted: track.muted, settings: track.getSettings() }
                    : null,
                  worklet: module,
                }
              : {}),
            camera: await cameraState(when === "after_mic" ? 800 : 0),
          };
        },
      };
      const r = await runCoachLab(deps, (s, l) => {
        setSteps(s);
        setLive(l);
      });
      r.diagnostics.tap = { audioSession: sessionAtTap, asBefore, withCamera, fake };
      r.diagnostics.userAgent = navigator.userAgent;
      for (const t of camera.current?.getTracks() ?? []) t.stop();
      camera.current = null;
      if (video.current) video.current.srcObject = null;
      setResult(r);
      setBusy(false);
    })();
  };

  const report = result
    ? JSON.stringify(
        {
          ok: result.ok,
          reasons: result.reasons,
          steps: result.steps.map((s) => ({
            step: s.id,
            status: s.status,
            ms: s.ms === null ? null : Math.round(s.ms),
            detail: s.detail || undefined,
            failure: s.failure ?? undefined,
          })),
          said: result.said,
          heard: result.heard,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )
    : "";
  const copy = () => {
    void navigator.clipboard
      ?.writeText(report)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  const tokenFailure = steps.find((s) => s.id === "token")?.failure;
  const answering = steps.find((s) => s.id === "answer")?.status === "running";

  return (
    <main
      className="coach-lab"
      data-busy={busy ? "true" : "false"}
      data-verdict={result ? (result.ok ? "pass" : "fail") : ""}
    >
      <header>
        <p className="section-kicker">Azm</p>
        <h1>{c.title}</h1>
        <p>{c.intro}</p>
      </header>
      <div className="coach-lab-options">
        <button
          type="button"
          className="coach-lab-toggle"
          aria-pressed={withCamera}
          disabled={busy}
          onClick={() => setWithCamera(!withCamera)}
        >
          <span className="coach-lab-switch" aria-hidden="true" />
          <span>
            <b>{c.camera}</b>
            <small>{c.cameraHint}</small>
          </span>
        </button>
        <button
          type="button"
          className="coach-lab-toggle"
          aria-pressed={asBefore}
          disabled={busy}
          onClick={() => setAsBefore(!asBefore)}
          data-option="as-before"
        >
          <span className="coach-lab-switch" aria-hidden="true" />
          <span>
            <b>{c.old}</b>
            <small>{c.oldHint}</small>
          </span>
        </button>
      </div>
      {withCamera && <video ref={video} className="coach-lab-video" muted playsInline autoPlay />}
      <button type="button" className="cta coach-lab-run" onClick={run} disabled={busy}>
        <Icon name="sound" size={18} />
        {busy ? c.running : result ? c.again : c.run}
      </button>
      {cameraError && (
        <p className="coach-lab-note" role="status">
          {c.cameraFailed} {cameraError}
        </p>
      )}
      <ol className="coach-lab-steps" aria-live="polite">
        {steps.map((s) => (
          <li key={s.id} data-step={s.id} data-status={s.status}>
            <span className="coach-lab-mark" aria-hidden="true">
              {s.status === "ok" ? (
                <Icon name="check" size={16} />
              ) : s.status === "failed" ? (
                <Icon name="close" size={16} />
              ) : s.status === "running" ? (
                <span className="coach-lab-spin" />
              ) : null}
            </span>
            <span className="coach-lab-step">
              <b>{c.steps[s.id]}</b>
              {s.status === "ok" && (s.ms !== null || s.detail) && (
                <small>{[s.ms !== null ? c.seconds(s.ms) : "", s.detail].filter(Boolean).join(" · ")}</small>
              )}
              {s.status === "failed" && s.failure && <code>{failureLine(s.failure)}</code>}
              {s.status === "skipped" && <small>{c.skipped}</small>}
            </span>
          </li>
        ))}
      </ol>
      {answering && (
        <p className="coach-lab-prompt" role="status">
          {c.answerNow}
        </p>
      )}
      {(live.said || live.heard) && (
        <dl className="coach-lab-words">
          {live.said && (
            <>
              <dt>{c.said}</dt>
              <dd>{live.said}</dd>
            </>
          )}
          {live.heard && (
            <>
              <dt>{c.heard}</dt>
              <dd data-heard>{live.heard}</dd>
            </>
          )}
        </dl>
      )}
      {result && (
        <section className="coach-lab-verdict" role="status">
          <h2>
            <Icon name={result.ok ? "check" : "info"} size={20} />
            {result.ok ? c.pass : c.fail}
          </h2>
          {tokenFailure?.name === "HTTP_401" && (
            <p>
              {c.signIn} <a href="/?app=1">{c.signInLink}</a>
            </p>
          )}
          {tokenFailure?.message === "CONSENT_REQUIRED" && <p>{c.consent}</p>}
          {result.reasons.length > 0 && (
            <>
              <h3>{c.reasons}</h3>
              <ul>
                {result.reasons.map((r) => (
                  <li key={r}>
                    <code>{r}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          <details>
            <summary>{c.details}</summary>
            <pre data-report>{report}</pre>
          </details>
          <button type="button" className="text-button" onClick={copy}>
            {copied ? c.copied : c.copy}
          </button>
        </section>
      )}
    </main>
  );
}
