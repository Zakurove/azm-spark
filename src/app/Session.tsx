import Brand from './Brand';
import { Preferences,RepMoment,ui,insight } from './experience';
import RepReview from './RepReview';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calibrator } from "../engine/calibration";
import { computeMetrics } from "../engine/geometry";
import { PoseSmoother } from "../engine/oneEuro";
import { CueOrchestrator } from "../engine/orchestrator";
import { unscoredLandmarks } from "../engine/profiles";
import { RepEngine } from "../engine/repEngine";
import { CueId, EngineEvent, ExerciseDef, Frame, LM, PRF, SessionSummary, Severity } from "../engine/types";
import { EXERCISES, variantForProfile } from "../exercises/defs";
import { CuePlayer } from "./audio";
import { CUE_TEXT, fmtNum, Lang, pct as fmtPct, T } from "./i18n";
import { drawOverlay } from "./overlay";
import { CameraPoseSource, CameraStatus, PoseSource, TracePoseSource } from "./poseSource";
import { camCopy } from "./camera-copy";
import { copy, illustration, sessionProfile, Setup } from "./product";
import Icon from "./Icon";
import Dialog from "./Dialog";

type Stage = "loading" | "framing" | "calibrating" | "training" | "rpe" | "summary";

const FLAG_JOINTS: Partial<Record<CueId, number[]>> = {
  sit_tall: [LM.l_shoulder, LM.r_shoulder, LM.l_hip, LM.r_hip],
  relax_shoulders: [LM.l_shoulder, LM.r_shoulder],
  even_arms: [LM.l_elbow, LM.r_elbow, LM.l_wrist, LM.r_wrist],
  fuller_range: [LM.l_wrist, LM.r_wrist],
  stand_fully: [LM.l_hip, LM.r_hip, LM.l_knee, LM.r_knee],
};

const qs = new URLSearchParams(location.search);

export default function SessionScreen(props: { lang: Lang; setup: Setup; exerciseId: string; demo: boolean; targetReps?: number; setNumber?: number; onSave?: (summary: SessionSummary, moments: RepMoment[]) => Promise<void>; onContinue?: () => void; preferences: Preferences; onPreferences: (p: Preferences) => void; onExit: () => void; onRestart: () => void; onDemo: () => void; trial?: boolean; onRegister?: () => void }) {
  const { lang, setup, exerciseId, demo, preferences, onPreferences, onExit, onRestart, onDemo } = props;
  const c = copy(lang), x = ui(lang), k = camCopy(lang);
  const profile = useMemo(() => sessionProfile(setup), [setup]);
  const profileId = profile.id;
  const def = useMemo<ExerciseDef>(() => ({...EXERCISES.find((e) => e.id === exerciseId)!, ...(props.targetReps ? {targetReps:props.targetReps} : {})}), [exerciseId, props.targetReps]);
  const variant = useMemo(() => variantForProfile(def, profileId), [def, profileId]);
  const contextSet = useMemo(
    () => new Set([...variant.contextLandmarks, ...unscoredLandmarks(profile)]),
    [variant, profile],
  );
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
  const [muted, setMuted] = useState(preferences.voice==='off');
  const [moments,setMoments]=useState<RepMoment[]>([]);
  const [phase,setPhase]=useState('idle');
  const [tracking,setTracking]=useState(true);
  const [saved, setSaved] = useState(false);
  const [saving,setSaving]=useState(false);
  const [camStatus,setCamStatus]=useState<CameraStatus>("model");
  const [presence,setPresence]=useState<"none"|"partial"|"ok">("none");
  const [hold,setHold]=useState(0);
  const [errKind,setErrKind]=useState<"denied"|"none"|"generic"|null>(null);
  const [attempt,setAttempt]=useState(0);

  // mutable pipeline
  const pipe = useRef({
    smoother: new PoseSmoother(),
    calibrator: null as Calibrator | null,
    engine: null as RepEngine | null,
    orch: new CueOrchestrator(),
    prf: null as PRF | null,
    stage: "loading" as Stage,
    framingSince: 0,
    framingStart: 0,
    flags: {} as Record<string, number>,
    flash: new Set<number>(),
    flashUntil: 0,
    startedAt: 0,
    lastCaptionUntil: 0,
    total: 0,
    moments: [] as RepMoment[],
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

  const showCaption = useCallback((text: string, severity: Severity, ms = 4200) => {
    setCaption({ text, severity });
    pipe.current.lastCaptionUntil = performance.now() + ms;
  }, []);

  const speakCue = useCallback(
    (cue: CueId | { count: number }, severity: Severity) => {
      if (typeof cue === "object") {
        void player.count(cue.count);
        return;
      }
      void player.cue(cue, severity);
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
      setTracking(mf.framingOk);
      const shouldersSeen = raw.lm[LM.l_shoulder].visibility > 0.5 && raw.lm[LM.r_shoulder].visibility > 0.5;
      const pres = mf.framingOk ? "ok" : shouldersSeen ? "partial" : "none";
      setPresence(pres);

      // paint
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          if (performance.now() > P.flashUntil) P.flash = new Set();
          drawOverlay(ctx, sm, { contextLandmarks: contextSet, flashJoints: P.flash, mirrored: !demo, demo, sourceWidth: videoRef.current?.videoWidth, sourceHeight: videoRef.current?.videoHeight });
        }
      }

      if (performance.now() > P.lastCaptionUntil) setCaption(null);

      switch (P.stage) {
        case "framing": {
          setFramingOk(mf.framingOk);
          if (mf.framingOk) {
            if (!P.framingSince) P.framingSince = raw.t;
            setHold(Math.min(1, (raw.t - P.framingSince) / 2000));
            if (raw.t - P.framingSince > 2000) {
              P.calibrator = new Calibrator(def);
              setHold(0);
              setStageBoth("calibrating");
            }
          } else {
            P.framingSince = 0;
            setHold(0);
            if (!demo && P.framingStart && raw.t - P.framingStart > 6000 && raw.t - P.lastFramingCueT > 10000) {
              P.lastFramingCueT = raw.t;
              void player.cue((pres === "partial" ? "move_back" : "get_in_frame") as CueId, "info");
            }
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
        if(ev.kind === "phase") setPhase(ev.phase);
        if (ev.kind === "progress") setPctNow(ev.pct);
        if (ev.kind === "flag") {
          P.flags[ev.ruleId] = (P.flags[ev.ruleId] ?? 0) + 1;
          const out = P.orch.push(ev);
          if (out) speakCue(out.cue as CueId, out.severity);
        }
        if (ev.kind === "rep") {
          P.moments.push({cls:ev.cls,durSec:ev.durSec,peakPct:ev.peakPct});
          setMoments([...P.moments]);
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
    [def, variant, profile, contextSet, demo, lang, speakCue, showCaption, finishSet, fast, player],
  );

  // source lifecycle
  useEffect(() => {
    let src: PoseSource | undefined;
    let cancelled = false;
    (async () => {
      try {
        if (demo) {
          src = new TracePoseSource(exerciseId, exerciseId === "seated_shoulder_press" ? { leanDeg: 12, leanFromRep: 4 } : {});
        } else {
          const cam = new CameraPoseSource(videoRef.current!);
          cam.onStatus = setCamStatus;
          src = cam;
        }
        setStageBoth("loading");
        pipe.current.stopSource = () => src?.stop();
        await src.start(onFrame);
        if (cancelled) {
          src.stop();
          return;
        }
        pipe.current.framingStart = performance.now();
        setStageBoth("framing");
      } catch (e) {
        src?.stop();
        if (cancelled) return;
        console.error(e);
        const name = (e as { name?: string })?.name;
        setErrKind(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "none" : "generic");
        setErr(T.cameraError[lang]);
      }
    })();
    return () => {
      cancelled = true;
      src?.stop();
    };
  }, [demo, exerciseId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => player.stop(), [player]);
  // A propped phone must not dim or lock mid set.
  useEffect(() => {
    if (demo) return;
    let lock: { release: () => Promise<void> } | null = null, active = true;
    const request = async () => { try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { lock = null; } };
    void request();
    const onVisible = () => { if (active && document.visibilityState === "visible") void request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; document.removeEventListener("visibilitychange", onVisible); void lock?.release().catch(() => undefined); };
  }, [demo]);
  useEffect(() => {player.pace=preferences.pace;player.guidanceOnly=preferences.voice==='essential';},[player,preferences]);
  useEffect(() => {if(stage==='calibrating')void player.line('calibration');if(stage==='training')void player.line('training');},[stage,player]);

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
    player.stop();
    if (pipe.current.stage === "training" || pipe.current.stage === "calibrating" || pipe.current.stage === "framing") {
      pipe.current.stopSource?.(); // camera/pose halt immediately — privacy + battery
      if (pipe.current.stage === "training") setStageBoth("rpe");
      else onExit();
    } else { pipe.current.stopSource?.(); onExit(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExit, player]);

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

  const saveAndSummarize = async (rpeVal: number | null) => {
    if(saving)return;setSaving(true);
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
    if(props.onSave){
      try{await props.onSave(s,P.moments);setSaved(!demo);}catch{setSaved(false);setSaving(false);showCaption(lang==='ar'?'تعذّر حفظ المجموعة. حاول مجددًا.':'Could not save this set. Please retry.','warn');return;}
    }
    setSaving(false);
    setSummary(s);
    setStageBoth("summary");
  };

  const totalReps = counts.valid + counts.partial + counts.compensated;

  const dialogs = <>
    {stage==='rpe'&&<Dialog titleId="rpe-title"><div className="result-symbol"><Icon name="check" size={30}/></div><p className="eyebrow">{demo?c.demoSummary:c.resultIntro}</p><h2 id="rpe-title">{t("rpeTitle")}</h2>{demo&&<p>{c.demoNotSaved}</p>}<div className="rpe-grid">{Array.from({length:11},(_,i)=><button key={i} className={`rpe-btn ${rpe===i?'sel':''}`} aria-pressed={rpe===i} onClick={()=>setRpe(i)}>{fmtNum(i,lang)}</button>)}</div><div className="rpe-labels"><span>{c.easy}</span><span>{c.hard}</span></div>{rpe!==null&&rpe>=8&&<p className="rpe-warn" role="status">{t("rpeHigh")}</p>}{caption?.severity==='warn'&&<p className="form-error" role="alert">{caption.text}</p>}<div className="modal-actions"><button className="cta" disabled={rpe===null||saving} onClick={()=>saveAndSummarize(rpe)}>{saving?(lang==='ar'?'جارٍ الحفظ…':'Saving…'):c.finish}</button><button className="ghost" disabled={saving} onClick={()=>saveAndSummarize(null)}>{t("skip")}</button></div></Dialog>}
    {stage==='summary'&&summary&&<Dialog titleId="sum-title"><div className="result-symbol"><Icon name="check" size={30}/></div><p className="eyebrow">{demo?c.demoSummary:c.resultIntro}</p><h2 id="sum-title">{t("summaryTitle")}</h2><p>{def.name[lang]}</p><div className="sum-grid"><div><b>{fmtNum(summary.reps.valid,lang)}</b><span>{t("validReps")}</span></div><div><b>{fmtNum(summary.reps.compensated,lang)}</b><span>{t("compReps")}</span></div><div><b>{fmtNum(summary.reps.partial,lang)}</b><span>{t("partialReps")}</span></div><div><b>{summary.romPct!=null?fmtPct(summary.romPct/100,lang):'·'}</b><span>{t("bestRom")}</span></div></div><p className="micro">{t("ofYourRange")}</p>{summary.rpe!=null&&<p>{t("rpeLabel")}: {fmtNum(summary.rpe,lang)}/{fmtNum(10,lang)}</p>}<div className="summary-insight"><Icon name="spark" size={20}/><div><h3>{x.insight}</h3><p>{insight(summary.reps,lang)}</p></div></div><RepReview reps={moments} lang={lang} demo={demo}/><p className="sum-note">{demo?c.demoNotSaved:props.trial?k.trialNote:saved?t("saveNote"):c.saveFailed}</p><div className="modal-actions">{props.trial?<><button className="cta" onClick={props.onRegister}>{k.register}<Icon name="arrow" size={16}/></button><button className="ghost" onClick={onRestart}>{k.tryAgain}</button></>:<><button className="cta" onClick={props.onContinue??onRestart}>{props.onContinue?(lang==='ar'?'متابعة البرنامج':'Continue program'):c.repeat}</button><button className="ghost" onClick={onExit}>{c.newSession}</button></>}</div></Dialog>}
  </>;
  const repsDone = counts.valid + counts.compensated;
  const toggleSound = () => { setMuted(!muted); onPreferences({ ...preferences, voice: !muted ? 'off' : 'full' }); };
  if (!demo) return <div className="cam-shell" data-stage={stage} data-presence={presence}>
    <header className="cam-top">
      <button className="cam-round" onClick={stopNow} aria-label={k.exit}><Icon name="close" size={20}/></button>
      <div className="cam-title"><b>{def.name[lang]}</b><span className="cam-live"><i/>{k.live}</span></div>
      <button className={`cam-round ${muted ? 'is-muted' : ''}`} onClick={toggleSound} aria-pressed={muted} aria-label={muted ? k.muted : k.sound}><Icon name="sound" size={20}/></button>
    </header>
    <div className="cam-view" ref={wrapRef}>
      <video ref={videoRef} className="cam" playsInline muted/>
      <canvas ref={canvasRef} className="overlay"/>
      <div className="cam-hud">
        {stage === 'loading' && !err && <div className="cam-center-card"><span className="cam-spinner" aria-hidden/><b role="status">{camStatus === 'camera' ? k.loadingCam : k.loadingModel}</b></div>}
        {err && <div className="cam-center-card cam-error" role="alert"><Icon name="camera" size={34}/><b>{errKind === 'denied' ? k.errDenied : errKind === 'none' ? k.errNone : k.errGeneric}</b><p>{errKind === 'denied' ? k.errDeniedBody : k.errGenericBody}</p><div className="cam-error-actions"><button className="cta" onClick={() => { setErr(null); setErrKind(null); setAttempt(a => a + 1); }}>{k.retry}</button><button className="ghost" onClick={onDemo}>{k.watchDemo}</button></div></div>}
        {stage === 'framing' && <>
          <svg className={`cam-silhouette ${presence}`} viewBox="0 0 200 260" aria-hidden><circle cx="100" cy="54" r="30"/><path d="M32 258 C32 176 58 120 100 112 C142 120 168 176 168 258"/></svg>
          <div className={`cam-status-card ${presence}`} role="status">
            {presence === 'ok'
              ? <span className="cam-ring-wrap"><svg className="cam-ring" viewBox="0 0 44 44"><circle className="track" cx="22" cy="22" r="19"/><circle className="fill ok" cx="22" cy="22" r="19" style={{ strokeDasharray: `${hold * 119.4} 119.4` }}/></svg><Icon name="check" size={22}/></span>
              : <span className="cam-status-dot"/>}
            <div><b>{presence === 'ok' ? k.hold : presence === 'partial' ? k.partial : k.noPerson}</b><p>{presence === 'ok' ? k.holdBody : presence === 'partial' ? (exerciseId === 'sit_to_stand' ? k.partialRise : k.partialBody) : k.noPersonBody}</p></div>
          </div>
        </>}
        {stage === 'calibrating' && <div className="cam-status-card cal" role="status">
          <span className="cam-ring-wrap"><svg className="cam-ring" viewBox="0 0 44 44"><circle className="track" cx="22" cy="22" r="19"/><circle className="fill" cx="22" cy="22" r="19" style={{ strokeDasharray: `${calProgress * 119.4} 119.4` }}/></svg><b>{fmtNum(Math.round(calProgress * 100), lang)}</b></span>
          <div><b>{k.calTitle}</b><p>{tracking ? k.calBody : k.lostBody}</p></div>
        </div>}
        {(stage === 'training' || stage === 'rpe' || stage === 'summary') && <>
          {caption ? <div className={`cam-caption ${caption.severity}`} aria-live="assertive">{caption.text}</div> : !tracking && stage === 'training' ? <div className="cam-caption warn">{k.lost}</div> : null}
          <div className="cam-count">
            <div className="cam-count-num"><b>{fmtNum(repsDone, lang)}</b><span>/ {fmtNum(def.targetReps, lang)}</span></div>
            <div className="cam-count-bar"><i style={{ width: `${Math.min(100, repsDone / def.targetReps * 100)}%` }}/></div>
            <div className="cam-count-meta"><span>{({ idle: x.phaseIdle, lifting: x.phaseLifting, top: x.phaseTop, lowering: x.phaseLowering } as Record<string, string>)[phase] ?? x.phaseIdle}</span><span>{k.range} <b>{fmtPct(Math.min(1, pctNow), lang)}</b></span></div>
          </div>
        </>}
      </div>
    </div>
    <footer className="cam-bottom"><button className="stop cam-stop" ref={stopBtnRef} onClick={stopNow}><Icon name="stop" size={22}/>{k.stop}</button></footer>
    {dialogs}
  </div>;
  const stageIndex = stage === "loading" || stage === "framing" ? 0 : stage === "calibrating" ? 1 : 2;
  return <div className={`session ${preferences.focus?"focus-session":""} ${demo ? "demo-session" : "camera-session"}`} data-stage={stage}>
    <header className="session-header">
      <button className="brand" onClick={onExit} aria-label={t("home")}><Brand/></button>
      <div className={`session-mode ${demo ? "is-demo" : ""}`}><span />{demo ? c.demo : c.live}</div>
      <div className="session-tools"><button className="ghost focus-toggle" aria-pressed={preferences.focus} onClick={()=>onPreferences({...preferences,focus:!preferences.focus})}><Icon name="focus" size={17}/>{preferences.focus?x.standard:x.focus}</button><button className="text-button" onClick={onExit}>{t("home")}</button></div>
    </header>
    <main className="session-main">
      <div className="session-title"><div><p className="eyebrow">{c[setup.position]} · {demo ? t("demoMode") : t("cameraMode")}</p><h1>{def.name[lang]}</h1></div><div className="session-steps">{c.stageLabels.map((label,i)=><span key={label} className={stageIndex===i?'current':stageIndex>i?'done':''}><b>{stageIndex>i?<Icon name="check" size={13}/>:fmtNum(i+1,lang)}</b>{label}</span>)}</div></div>
      <div className={`tracking-status ${tracking?'ready':'lost'}`}><span className="status-dot"/><span role="status">{demo?x.simulated:tracking?x.tracking:x.lost}</span><small>{!tracking?x.lostNote:stage==='training'?({idle:x.phaseIdle,lifting:x.phaseLifting,top:x.phaseTop,lowering:x.phaseLowering} as Record<string,string>)[phase]:stage==='calibrating'?x.calStart:''}</small></div>
      <div className="session-grid">
        <section className={`movement-panel ${demo?'demo-panel':'camera-panel'}`} aria-label={demo?c.demo:c.live}>
          <div className="movement-heading"><span><Icon name={demo?"play":"camera"} size={17}/>{demo?c.guide:c.live}</span><small>{demo?c.demoNotice:''}</small></div>
          {demo?<>
            <div className="demo-reference"><img src={illustration(setup,exerciseId)} alt={`${c.illustration}: ${def.name[lang]}`}/><span>{c.demoGuide}</span></div>
            <div className="signal-strip"><div className="tracking-view" ref={wrapRef}><canvas ref={canvasRef} className="overlay" aria-label={c.signals}/></div><div><strong>{c.signals}</strong><p>{c.signalNote}</p><div className="legend"><span><i className="dot g"/>{t("legendScored")}</span><span><i className="dot a"/>{t("legendFlag")}</span></div></div></div>
          </>:<div className="camera-view" ref={wrapRef}><video ref={videoRef} className="cam" playsInline muted/><canvas ref={canvasRef} className="overlay"/>{(stage==='loading'||err)&&<div className="camera-placeholder"><Icon name="camera" size={42}/><p>{err??c.loading}</p>{err&&<button className="cta" onClick={onDemo}>{c.cameraFallback}</button>}</div>}</div>}
          {stage==='training'&&<RepReview reps={moments} lang={lang} demo={demo} compact/>}
        </section>
        <aside className="coach-panel">
          <div className="coach-heading"><span className="coach-symbol"><Icon name="spark" size={22}/></span><span>{c.coaching}</span><span className="status-dot"/></div>
          <div className="coach-message" aria-live="polite" aria-atomic="true">
            {stage==='loading'&&<div className="banner"><strong>{c.loading}</strong><p>{demo?c.demoBody:c.cameraHelp}</p></div>}
            {stage==='framing'&&<div className={`banner ${framingOk?'ok':''}`}><span className="step-label">{c.stageLabels[0]}</span><strong>{t("framingTitle")}</strong><p>{framingOk?t("framingOk"):def.camera[lang]}</p></div>}
            {stage==='calibrating'&&<div className="banner cal"><span className="step-label">{c.stageLabels[1]}</span><strong>{t("calibTitle")}</strong><p>{t("calibBody")}</p><div className="cal-bar" role="progressbar" aria-label={t("calibTitle")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(calProgress*100)}><i style={{width:`${Math.round(calProgress*100)}%`}}/></div></div>}
            {(stage==='training'||stage==='rpe'||stage==='summary')&&<div className={`cue-toast ${caption?.severity??'idle'}`}><span className="step-label">{c.stageLabels[2]}</span><strong>{caption?.text??(demo?c.demoWaiting:c.waiting)}</strong><p>{t("yourBaseline")}</p></div>}
          </div>
          {(stage==='training'||stage==='rpe'||stage==='summary')&&<div className="rep-card"><span className="metric-label">{c.total}</span><div className="rep-main"><b className="rep-num">{fmtNum(counts.valid+counts.compensated,lang)}</b><span>/ {fmtNum(def.targetReps,lang)}</span></div><div className="set-bar"><i style={{width:`${Math.min(100,(counts.valid+counts.compensated)/def.targetReps*100)}%`}}/></div><div className="rep-sub"><span><b>{fmtNum(counts.valid,lang)}</b>{t("validReps")}</span><span><b>{fmtNum(counts.compensated,lang)}</b>{t("compReps")}</span><span><b>{fmtNum(counts.partial,lang)}</b>{t("partialReps")}</span></div></div>}
          {stage==='training'&&<div className="range-meter"><div><span>{c.range}</span><b>{fmtPct(Math.min(1,pctNow),lang)}</b></div><div className="range-track"><i style={{width:`${Math.max(0,Math.min(1,pctNow))*100}%`}}/></div><p>{c.rangeHint}</p></div>}

        </aside>
      </div>
    </main>
    <footer className="session-controls"><button className="stop" ref={stopBtnRef} onClick={stopNow}><Icon name="stop" size={18}/>{t("stop")}</button><button className="ghost sound-button" onClick={()=>{setMuted(!muted);onPreferences({...preferences,voice:!muted?'off':'full'});}} aria-pressed={muted}><Icon name="sound" size={18}/>{muted?t("soundOff"):t("soundOn")}</button><p>{demo?c.demoNotice:''}</p><span className="control-set">{t("set")} {fmtNum(props.setNumber??1,lang)} · {fmtNum(totalReps,lang)} {t("reps")}</span></footer>
    {dialogs}
  </div>;
}
