import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calibrator } from "../engine/calibration";
import { computeMetrics } from "../engine/geometry";
import { PoseSmoother } from "../engine/oneEuro";
import { CueOrchestrator } from "../engine/orchestrator";
import { profileById, unscoredLandmarks } from "../engine/profiles";
import { RepEngine } from "../engine/repEngine";
import { CueId, EngineEvent, ExerciseDef, Frame, LM, PRF, SessionSummary, Severity } from "../engine/types";
import { EXERCISES, exercisesForProfile, variantForProfile } from "../exercises/defs";
import { CuePlayer } from "./audio";
import { CUE_TEXT, fmtNum, Lang, pct as fmtPct, T } from "./i18n";
import { drawOverlay } from "./overlay";
import { CameraPoseSource, PoseSource, TracePoseSource } from "./poseSource";

type Stage = "loading" | "framing" | "calibrating" | "training" | "rpe" | "summary";

const FLAG_JOINTS: Partial<Record<CueId, number[]>> = {
  sit_tall: [LM.l_shoulder, LM.r_shoulder, LM.l_hip, LM.r_hip],
  relax_shoulders: [LM.l_shoulder, LM.r_shoulder],
  even_arms: [LM.l_elbow, LM.r_elbow, LM.l_wrist, LM.r_wrist],
  fuller_range: [LM.l_wrist, LM.r_wrist],
  stand_fully: [LM.l_hip, LM.r_hip, LM.l_knee, LM.r_knee],
};

const qs = new URLSearchParams(location.search);

export default function App() {
  const [lang, setLang] = useState<Lang>((qs.get("lang") as Lang) || "ar");
  const [profileId, setProfileId] = useState<string>(qs.get("profile") || "wheelchair");
  const [exerciseId, setExerciseId] = useState<string>(qs.get("ex") || "seated_shoulder_press");
  const [demo, setDemo] = useState<boolean>(qs.get("demo") !== "0"); // demo default ON for MVP
  const [inSession, setInSession] = useState<boolean>(qs.get("autostart") === "1");

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const t = useCallback(<K extends keyof typeof T>(k: K) => (T[k] as { ar: string; en: string })[lang] ?? "", [lang]);

  const availableExercises = exercisesForProfile(profileId);
  useEffect(() => {
    if (!availableExercises.some((e) => e.id === exerciseId) && availableExercises[0]) {
      setExerciseId(availableExercises[0].id);
    }
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (inSession) {
    return (
      <SessionScreen
        lang={lang}
        profileId={profileId}
        exerciseId={exerciseId}
        demo={demo}
        onExit={() => setInSession(false)}
      />
    );
  }

  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark">ع</span>
          <div>
            <h1 className="brand-name">{t("appName")} <span className="brand-latin"><bdi dir="ltr">SPARK</bdi></span></h1>
            <div className="brand-sub">{t("appSub")}</div>
          </div>
        </div>
        <button className="lang-toggle" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
          {lang === "ar" ? "English" : "العربية"}
        </button>
      </header>

      <main className="home-main">
        <section>
          <h2 className="section-title">{t("chooseProfile")}</h2>
          <div className="card-grid profiles">
            {["wheelchair", "hemiparesis_right", "hemiparesis_left", "standing"].map((id) => (
              <button
                key={id}
                className={`card option ${profileId === id ? "selected" : ""}`}
                onClick={() => setProfileId(id)}
                aria-pressed={profileId === id}
              >
                <span className="option-icon" aria-hidden>{id === "wheelchair" ? "♿" : id === "standing" ? "🧍" : "🧠"}</span>
                <span className="option-name">{T.profiles[id][lang]}</span>
                <span className="option-note">{T.profileNotes[id][lang]}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="section-title">{t("chooseExercise")}</h2>
          <div className="card-grid exercises">
            {availableExercises.map((e) => (
              <button
                key={e.id}
                className={`card option ${exerciseId === e.id ? "selected" : ""}`}
                onClick={() => setExerciseId(e.id)}
                aria-pressed={exerciseId === e.id}
              >
                <span className="option-name">{e.name[lang]}</span>
                <span className="option-note">{e.description[lang]}</span>
                <span className="option-meta">{t("targetReps")}: {fmtNum(e.targetReps, lang)} {t("reps")}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="start-row">
          <button className="cta" onClick={() => setInSession(true)}>{t("start")}</button>
          <label className="demo-toggle">
            <input type="checkbox" checked={demo} onChange={(ev) => setDemo(ev.target.checked)} />
            <span>{demo ? t("demoMode") : t("cameraMode")}</span>
          </label>
        </section>

        <section className="pillars">
          <div className="pill">🔒 {t("privacy")}</div>
          <div className="pill">📏 {t("yourBaseline")}</div>
          <div className="pill">🗣 {t("arabicFirst")}</div>
        </section>
      </main>

      <footer className="home-footer">{t("disclaimer")}</footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SessionScreen(props: { lang: Lang; profileId: string; exerciseId: string; demo: boolean; onExit: () => void }) {
  const { lang, profileId, exerciseId, demo, onExit } = props;
  const def = useMemo<ExerciseDef>(() => EXERCISES.find((e) => e.id === exerciseId)!, [exerciseId]);
  const profile = useMemo(() => profileById(profileId), [profileId]);
  const variant = useMemo(() => variantForProfile(def, profileId), [def, profileId]);
  const contextSet = useMemo(
    () => new Set([...variant.contextLandmarks, ...unscoredLandmarks(profile)]),
    [variant, profile],
  );
  // demo-mode furniture: a wheelchair for wheelchair users, a chair for sit-to-stand
  const scene = demo ? (profile.seated ? ("wheelchair" as const) : exerciseId === "sit_to_stand" ? ("chair" as const) : null) : null;

  const t = useCallback(<K extends keyof typeof T>(k: K) => (T[k] as { ar: string; en: string })[lang] ?? "", [lang]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [stage, setStage] = useState<Stage>("loading");
  const [err, setErr] = useState<string | null>(null);
  const [framingOk, setFramingOk] = useState(false);
  const [calProgress, setCalProgress] = useState(0);
  const [pctNow, setPctNow] = useState(0);
  const [counts, setCounts] = useState({ valid: 0, partial: 0, compensated: 0 });
  const [caption, setCaption] = useState<{ text: string; severity: Severity } | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [muted, setMuted] = useState(false);

  // mutable pipeline
  const pipe = useRef({
    smoother: new PoseSmoother(),
    calibrator: null as Calibrator | null,
    engine: null as RepEngine | null,
    orch: new CueOrchestrator(),
    prf: null as PRF | null,
    stage: "loading" as Stage,
    framingSince: 0,
    flags: {} as Record<string, number>,
    flash: new Set<number>(),
    flashUntil: 0,
    startedAt: 0,
    lastCaptionUntil: 0,
    total: 0,
    frameLostSince: 0,
    lastFramingCueT: 0,
    stopSource: null as null | (() => void),
  });
  const player = useMemo(() => new CuePlayer(lang), [lang]);
  const fast = qs.get("fast") === "1";

  const setStageBoth = (s: Stage) => {
    pipe.current.stage = s;
    setStage(s);
  };

  const showCaption = useCallback((text: string, severity: Severity, ms = 2600) => {
    setCaption({ text, severity });
    pipe.current.lastCaptionUntil = performance.now() + ms;
  }, []);

  const speakCue = useCallback(
    (cue: CueId | { count: number }, severity: Severity) => {
      if (typeof cue === "object") {
        void player.count(cue.count);
        return;
      }
      void player.cue(cue);
      showCaption(CUE_TEXT[cue][lang], severity);
      const joints = FLAG_JOINTS[cue];
      if (joints) {
        pipe.current.flash = new Set(joints);
        pipe.current.flashUntil = performance.now() + 2000;
      }
    },
    [player, lang, showCaption],
  );

  const finishSet = useCallback(() => {
    speakCue("set_done", "praise");
    setStageBoth("rpe");
  }, [speakCue]);

  const onFrame = useCallback(
    (raw: Frame) => {
      const P = pipe.current;
      const sm = { ...raw, lm: P.smoother.smooth(raw.lm, raw.t) };
      const mf = computeMetrics(sm, def.metrics, variant.requiredLandmarks);

      // paint
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          if (performance.now() > P.flashUntil) P.flash = new Set();
          drawOverlay(ctx, sm, { contextLandmarks: contextSet, flashJoints: P.flash, mirrored: !demo, scene });
        }
      }

      if (performance.now() > P.lastCaptionUntil) setCaption(null);

      switch (P.stage) {
        case "framing": {
          setFramingOk(mf.framingOk);
          if (mf.framingOk) {
            if (!P.framingSince) P.framingSince = raw.t;
            if (raw.t - P.framingSince > 2000) {
              P.calibrator = new Calibrator(def);
              setStageBoth("calibrating");
            }
          } else {
            P.framingSince = 0;
          }
          break;
        }
        case "calibrating":
        case "training": {
          // in-session framing guard: hold the pipeline while the user is out of frame
          if (!mf.framingOk) {
            if (!P.frameLostSince) P.frameLostSince = raw.t;
            if (raw.t - P.frameLostSince > 3000 && raw.t - P.lastFramingCueT > 10000) {
              P.lastFramingCueT = raw.t;
              speakCue("get_in_frame", "warn");
            }
            break;
          }
          P.frameLostSince = 0;
          if (P.stage === "training") {
            const events = P.engine!.step(mf);
            for (const ev of events) handleEvent(ev);
            const deferred = P.orch.tick(raw.t);
            if (deferred) speakCue(deferred.cue as CueId, deferred.severity);
            break;
          }
          P.calibrator!.feed(mf);
          const prog = P.calibrator!.progress(raw.t, fast ? 60 : 150);
          setCalProgress(prog);
          if (P.calibrator!.ready(raw.t, fast ? 60 : 150)) {
            P.prf = P.calibrator!.build();
            P.engine = new RepEngine(def, P.prf, profile);
            P.startedAt = Date.now();
            setStageBoth("training");
            showCaption(T.calibDone[lang], "praise");
          }
          break;
        }
        default:
          break;
      }

      function handleEvent(ev: EngineEvent) {
        if (ev.kind === "progress") setPctNow(ev.pct);
        if (ev.kind === "flag") {
          P.flags[ev.ruleId] = (P.flags[ev.ruleId] ?? 0) + 1;
          const out = P.orch.push(ev);
          if (out) speakCue(out.cue as CueId, out.severity);
        }
        if (ev.kind === "rep") {
          setCounts((c) => ({ ...c, [ev.cls]: c[ev.cls as keyof typeof c] + 1 }));
          if (ev.cls !== "partial") {
            P.total += 1;
            const out = P.orch.push(ev);
            if (out) speakCue(out.cue, out.severity);
            if (P.total >= def.targetReps) finishSet();
          }
        }
      }
    },
    [def, variant, profile, contextSet, demo, scene, lang, speakCue, showCaption, finishSet, fast],
  );

  // source lifecycle
  useEffect(() => {
    let src: PoseSource;
    let cancelled = false;
    (async () => {
      try {
        if (demo) {
          src = new TracePoseSource(exerciseId, exerciseId === "seated_shoulder_press" ? { leanDeg: 12, leanFromRep: 4 } : {});
        } else {
          src = new CameraPoseSource(videoRef.current!);
        }
        setStageBoth("loading");
        pipe.current.stopSource = () => src.stop();
        await src.start(onFrame);
        if (cancelled) {
          src.stop();
          return;
        }
        setStageBoth("framing");
      } catch (e) {
        console.error(e);
        setErr(T.cameraError[lang]);
      }
    })();
    return () => {
      cancelled = true;
      src?.stop();
    };
  }, [demo, exerciseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // canvas sizing
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = Math.round(wrap.clientWidth * window.devicePixelRatio);
      canvas.height = Math.round(wrap.clientHeight * window.devicePixelRatio);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const stopNow = useCallback(() => {
    if (pipe.current.stage === "training" || pipe.current.stage === "calibrating" || pipe.current.stage === "framing") {
      pipe.current.stopSource?.(); // camera/pose halt immediately — privacy + battery
      setStageBoth(pipe.current.stage === "training" ? "rpe" : "summary");
      if (pipe.current.stage !== "training") onExit();
    } else onExit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExit]);

  // Escape always stops; focus lands on STOP when training starts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopNow]);
  const stopBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (stage === "training") stopBtnRef.current?.focus();
    if (stage === "rpe" || stage === "summary") pipe.current.stopSource?.();
  }, [stage]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  const saveAndSummarize = (rpeVal: number | null) => {
    const P = pipe.current;
    const s: SessionSummary = {
      exerciseId,
      profileId: profileId as SessionSummary["profileId"],
      startedAt: P.startedAt || Date.now(),
      endedAt: Date.now(),
      reps: counts,
      flags: P.flags,
      rpe: rpeVal ?? undefined,
      romPct: P.engine ? Math.min(100, Math.round(P.engine.bestRom * 100)) : undefined,
    };
    try {
      const key = "azm5.sessions";
      const arr = JSON.parse(localStorage.getItem(key) ?? "[]");
      arr.push(s);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch { /* storage unavailable — session still shown */ }
    setSummary(s);
    setStageBoth("summary");
  };

  const totalReps = counts.valid + counts.partial + counts.compensated;

  return (
    <div className="session" data-stage={stage}>
      <header className="hud-top">
        <div className="hud-brand">
          <span className="brand-mark small">ع</span>
          <div>
            <div className="hud-title">{def.name[lang]}</div>
            <div className="hud-sub">{T.profiles[profileId][lang]} · {demo ? t("demoMode") : t("cameraMode")}</div>
          </div>
        </div>
        <div className="privacy-chip"><span className="cam-dot" /> {t("privacy")}</div>
      </header>

      <div className="stage-wrap" ref={wrapRef}>
        {!demo && <video ref={videoRef} className="cam" playsInline muted />}
        {demo && <div className="demo-backdrop" aria-hidden />}
        <canvas ref={canvasRef} className="overlay" />

        {stage === "loading" && !err && <div className="stage-note">{t("loadingModel")}</div>}
        {err && (
          <div className="stage-note error">
            {err}
            <button className="ghost" onClick={onExit}>{t("home")}</button>
          </div>
        )}

        {stage === "framing" && (
          <div className={`banner ${framingOk ? "ok" : ""}`}>
            <strong>{t("framingTitle")}</strong>
            <span>{framingOk ? t("framingOk") : def.camera[lang]}</span>
          </div>
        )}

        {stage === "calibrating" && (
          <div className="banner cal">
            <strong>{t("calibTitle")}</strong>
            <span>{t("calibBody")}</span>
            <div className="cal-bar"><i style={{ width: `${Math.round(calProgress * 100)}%` }} /></div>
          </div>
        )}

        {(stage === "training" || stage === "rpe") && (
          <>
            <aside className="hud-side">
              <div className="rep-card">
                <div className="rep-num">{fmtNum(counts.valid, lang)}</div>
                <div className="rep-label">{t("validReps")} — {t("targetReps")} {fmtNum(def.targetReps, lang)}</div>
                <div className="rep-sub">
                  <span className="chip partial"><b>{fmtNum(counts.partial, lang)}</b> {t("partialReps")}</span>
                  <span className="chip comp"><b>{fmtNum(counts.compensated, lang)}</b> {t("compReps")}</span>
                </div>
              </div>
              <div className="legend">
                <div><span className="dot g" /> {t("legendScored")}</div>
                <div><span className="dot a" /> {t("legendFlag")}</div>
                <div><span className="dot d" /> {t("legendContext")}</div>
              </div>
            </aside>

            <div className="range-meter" aria-label="range">
              <div className="rm-track">
                <i className="rm-fill" style={{ height: `${Math.round(Math.min(1, pctNow) * 100)}%` }} />
                <span className="rm-mark enter" />
                <span className="rm-mark count" />
              </div>
              <div className="rm-label">{fmtPct(Math.min(1, pctNow), lang)}</div>
            </div>
          </>
        )}

        {caption && (
          <div className={`cue-toast ${caption.severity}`}>
            <span className="spk" aria-hidden>🔊</span>
            <span>{caption.text}</span>
          </div>
        )}

        {stage === "rpe" && (
          <div className="modal">
            <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="rpe-title">
              <h3 id="rpe-title">{t("rpeTitle")}</h3>
              <div className="rpe-grid">
                {Array.from({ length: 11 }, (_, i) => (
                  <button
                    key={i}
                    autoFocus={i === 0}
                    className={`rpe-btn ${rpe === i ? "sel" : ""}`}
                    aria-pressed={rpe === i}
                    onClick={() => setRpe(i)}
                  >
                    {fmtNum(i, lang)}
                  </button>
                ))}
              </div>
              {rpe !== null && rpe >= 8 && <p className="rpe-warn">{t("rpeHigh")}</p>}
              <div className="modal-actions">
                <button className="ghost" onClick={() => saveAndSummarize(null)}>{t("skip")}</button>
                <button className="cta small" disabled={rpe === null} onClick={() => saveAndSummarize(rpe)}>
                  {t("summaryTitle")}
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === "summary" && summary && (
          <div className="modal">
            <div className="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="sum-title">
              <h3 id="sum-title">{t("summaryTitle")} — {def.name[lang]}</h3>
              <div className="sum-grid">
                <div className="sum-cell good"><b>{fmtNum(summary.reps.valid, lang)}</b><span>{t("validReps")}</span></div>
                <div className="sum-cell"><b>{fmtNum(summary.reps.partial, lang)}</b><span>{t("partialReps")}</span></div>
                <div className="sum-cell"><b>{fmtNum(summary.reps.compensated, lang)}</b><span>{t("compReps")}</span></div>
                <div className="sum-cell gold"><b>{summary.romPct != null ? fmtPct(summary.romPct / 100, lang) : "—"}</b><span>{t("bestRom")} {t("ofYourRange")}</span></div>
              </div>
              {summary.rpe != null && <p className="sum-note">{t("rpeLabel")}: {fmtNum(summary.rpe, lang)}/{fmtNum(10, lang)}</p>}
              <p className="sum-note save">✓ {t("saveNote")} — {t("privacy")}</p>
              <div className="modal-actions">
                <button className="ghost" onClick={onExit}>{t("home")}</button>
                <button className="cta small" onClick={() => location.reload()}>{t("again")}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="hud-bottom">
        <button className="stop" ref={stopBtnRef} onClick={stopNow}>⏹ {t("stop")}</button>
        <button className="ghost" onClick={() => setMuted(!muted)} aria-pressed={muted}>
          {muted ? "🔇 " + t("soundOff") : "🔊 " + t("soundOn")}
        </button>
        <div className="hud-progress">
          <span>{t("set")} {fmtNum(1, lang)}</span>
          <div className="set-bar"><i style={{ width: `${Math.min(100, Math.round((totalReps / def.targetReps) * 100))}%` }} /></div>
          <span>{fmtNum(totalReps, lang)}/{fmtNum(def.targetReps, lang)}</span>
        </div>
        <button className="ghost" onClick={onExit}>{t("home")}</button>
      </footer>
    </div>
  );
}
