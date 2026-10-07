/**
 * "Building your program" (D-032 item 4): after the health form, the range of motion check and the
 * walk, about six seconds that show the medical information and the camera's computer vision turning
 * into a training program, then «برنامجك جاهز» and Continue. Skip ends it from the start; both call
 * onDone. Light background, Cairo, gold and purple, Arabic first and mirrored for English.
 *
 * The beats, the summary handling and every drawn position are in programBuildScene.ts (pure, tested in
 * node); this file draws a frame of it in SVG once a requestAnimationFrame. With reduced motion it is a
 * calm still of the final state with every caption and Continue. The captions are in a polite live
 * region. Loaded lazily (VITE_V7 builds), never in the first script.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import type { Lang } from "../../app/i18n";
import { buildCopy } from "./programBuildCopy";
import {
  BONES,
  BuildDirector,
  CORE,
  FIGURE,
  GROUND,
  HEAD_R,
  LANDMARKS,
  LANE_X0,
  LANES,
  NOW_X,
  RECORD,
  RINGS,
  STAGE,
  VIEW,
  PEDESTAL,
  WEEK,
  arcTicks,
  arcWedge,
  beatAt,
  buildPlan,
  easeBack,
  frameAt,
  slotHeight,
  weekTop,
  type BuildPlan,
  type CardKind,
  type EngineFrame,
  type Frame,
  type GaitFrame,
  type Pt,
  type SkeletonFrame,
  type SourceKind,
} from "./programBuildScene";
import "./program-build.css";

export default function ProgramBuild(props: {
  lang: Lang;
  onDone(): void;
  summary?: { joints: number; walk: boolean; exercises: number };
}) {
  const { lang, summary } = props;
  const plan = useMemo(() => buildPlan(summary), [summary?.joints, summary?.walk, summary?.exercises]);
  const still = useReducedMotion();
  const onDone = useRef(props.onDone);
  onDone.current = props.onDone;
  const director = useMemo(() => new BuildDirector(plan, () => onDone.current(), still), [plan]);
  const [t, setT] = useState(director.t);
  const skipRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (still) {
      director.toStill();
      setT(director.t);
      return;
    }
    let frame = 0;
    let last = -1;
    const draw = (now: number) => {
      const wasReady = director.finished;
      director.tick(last < 0 ? 0 : now - last);
      last = now;
      // Skip leaves when the program is ready: its focus goes on to Continue.
      if (!wasReady && director.finished && document.activeElement === skipRef.current)
        refocus.current = true;
      setT(director.t);
      if (director.t < plan.settle) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [director, still, plan]);

  const ready = t >= plan.end;
  useEffect(() => {
    if (ready && refocus.current) {
      refocus.current = false;
      continueRef.current?.focus();
    }
  }, [ready]);

  return (
    <ProgramBuildView
      lang={lang}
      plan={plan}
      t={t}
      still={still}
      onSkip={() => director.skip()}
      onContinue={() => director.continue()}
      skipRef={skipRef}
      continueRef={continueRef}
    />
  );
}

/** prefers-reduced-motion, kept up to date. */
function useReducedMotion(): boolean {
  const query = () =>
    typeof window === "undefined" || !window.matchMedia
      ? null
      : window.matchMedia("(prefers-reduced-motion: reduce)");
  const [reduced, setReduced] = useState(() => !!query()?.matches);
  useEffect(() => {
    const q = query();
    if (!q) return;
    const changed = () => setReduced(q.matches);
    changed();
    q.addEventListener?.("change", changed);
    return () => q.removeEventListener?.("change", changed);
  }, []);
  return reduced;
}

export interface ProgramBuildViewProps {
  lang: Lang;
  plan: BuildPlan;
  t: number;
  /** Reduced motion: the composed still of the final state. */
  still: boolean;
  onSkip(): void;
  onContinue(): void;
  skipRef?: Ref<HTMLButtonElement>;
  continueRef?: Ref<HTMLButtonElement>;
}

/** The page at one moment: the stage, the status line and the one action. */
export function ProgramBuildView({
  lang,
  plan,
  t,
  still,
  onSkip,
  onContinue,
  skipRef,
  continueRef,
}: ProgramBuildViewProps) {
  const c = buildCopy(lang);
  const beat = beatAt(plan, t);
  const ready = !beat;
  const rtl = lang === "ar";
  return (
    <div
      className={`pb${still ? " is-still" : ""}${ready ? " is-ready" : ""}`}
      lang={lang}
      dir={rtl ? "rtl" : "ltr"}
      data-beat={beat ? beat.id : "ready"}
    >
      <div className="pb-top">
        <img className="pb-logo" src="/brand/azm-logo.webp" alt={c.brand} />
        {!still && !ready && (
          <button ref={skipRef} type="button" className="pb-skip" data-action="skip" onClick={onSkip}>
            {c.skip}
          </button>
        )}
      </div>
      <div className="pb-main">
        <div className="pb-stage">
          <Scene plan={plan} t={t} rtl={rtl} />
        </div>
        <div className="pb-status">
          {still ? (
            <ul className="pb-list">
              {plan.beats.map((b) => (
                <li key={b.id}>
                  <Tick />
                  {c.beats[b.id]}
                </li>
              ))}
            </ul>
          ) : (
            <div className="pb-meter" aria-hidden="true">
              {plan.beats.map((b) => (
                <span key={b.id}>
                  <i
                    style={{
                      transform: `scaleX(${Math.min(1, Math.max(0, (t - b.start) / (b.end - b.start)))})`,
                    }}
                  />
                </span>
              ))}
            </div>
          )}
          <p className="pb-caption" role="status" aria-live="polite">
            {ready ? <Tick big /> : <span className="pb-spin" aria-hidden="true" />}
            <span key={beat ? beat.id : "ready"} className="pb-caption-text">
              {beat ? c.beats[beat.id] : c.ready}
            </span>
          </p>
        </div>
        <div className="pb-actions">
          {ready && (
            <button
              ref={continueRef}
              type="button"
              className="pb-continue"
              data-action="continue"
              onClick={onContinue}
            >
              {c.continue}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Tick({ big = false }: { big?: boolean }) {
  return (
    <svg
      className={big ? "pb-tick is-big" : "pb-tick"}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="11" />
      <path d="m7.5 12.4 3 3 6-6.6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ the stage */

const FIGURE_AT = `translate(${FIGURE.x} ${FIGURE.y}) scale(${FIGURE.s})`;

/**
 * One frame of the story in the stage's units, no text and no numbers. Drawn left to right; the stage
 * is mirrored for Arabic (CSS), except the check, which reads the same in both.
 */
function Scene({ plan, t, rtl }: { plan: BuildPlan; t: number; rtl: boolean }) {
  const f = frameAt(plan, t);
  return (
    <svg className="pb-scene" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} aria-hidden="true" focusable="false">
      <Defs reveal={f.body.reveal} />
      <rect width={STAGE.w} height={STAGE.h} fill="url(#pb-dots)" />
      <Hud f={f} />
      <Body f={f} />
      <Records f={f} />
      <Gait g={f.gait} />
      <Skeleton s={f.skeleton} />
      {f.engine && <Engine e={f.engine} plan={plan} rtl={rtl} />}
    </svg>
  );
}

function Defs({ reveal }: { reveal: number }) {
  return (
    <defs>
      <pattern id="pb-dots" width="18" height="18" patternUnits="userSpaceOnUse">
        <circle className="pb-dot" cx="9" cy="9" r="0.9" />
      </pattern>
      <pattern id="pb-lines" width="8" height="6" patternUnits="userSpaceOnUse">
        <rect className="pb-line" width="8" height="0.6" />
      </pattern>
      {/* In the figure's own units (it is drawn scaled), top to toe. */}
      <linearGradient id="pb-body" x1="0" y1="0" x2="0" y2="440" gradientUnits="userSpaceOnUse">
        <stop offset="0" className="pb-stop-white" />
        <stop offset="1" className="pb-stop-lilac" />
      </linearGradient>
      <linearGradient id="pb-scan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="pb-stop-gold" stopOpacity="0" />
        <stop offset="1" className="pb-stop-gold" stopOpacity="0.5" />
      </linearGradient>
      <linearGradient id="pb-band" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="pb-stop-purple" stopOpacity="0" />
        <stop offset="0.5" className="pb-stop-purple" stopOpacity="0.07" />
        <stop offset="1" className="pb-stop-purple" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="pb-shimmer" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" className="pb-stop-gold" stopOpacity="0" />
        <stop offset="0.5" className="pb-stop-gold" stopOpacity="0.42" />
        <stop offset="1" className="pb-stop-gold" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="pb-pedestal">
        <stop offset="0" className="pb-stop-purple" stopOpacity="0.16" />
        <stop offset="0.6" className="pb-stop-purple" stopOpacity="0.06" />
        <stop offset="1" className="pb-stop-purple" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="pb-halo">
        <stop offset="0" className="pb-stop-purple" stopOpacity="0.32" />
        <stop offset="1" className="pb-stop-purple" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="pb-shade">
        <stop offset="0" className="pb-stop-shade" stopOpacity="0.2" />
        <stop offset="1" className="pb-stop-shade" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="pb-core">
        <stop offset="0" className="pb-stop-white" />
        <stop offset="0.28" className="pb-stop-gold" stopOpacity="0.5" />
        <stop offset="0.6" className="pb-stop-cream" stopOpacity="0.5" />
        <stop offset="0.8" className="pb-stop-purple" stopOpacity="0.07" />
        <stop offset="1" className="pb-stop-purple" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="pb-spark-gold">
        <stop offset="0" className="pb-stop-white" />
        <stop offset="0.35" className="pb-stop-gold" />
        <stop offset="1" className="pb-stop-gold" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="pb-spark-purple">
        <stop offset="0" className="pb-stop-white" />
        <stop offset="0.35" className="pb-stop-purple" />
        <stop offset="1" className="pb-stop-purple" stopOpacity="0" />
      </radialGradient>
      <clipPath id="pb-reveal">
        <rect width={STAGE.w} height={reveal} />
      </clipPath>
      <clipPath id="pb-record">
        <rect width={RECORD.w} height={RECORD.h} rx="14" />
      </clipPath>
      {/* The body's silhouette: the scan's glow lights the body only. */}
      <mask id="pb-figure">
        <g className="pb-mask" transform={FIGURE_AT}>
          {FIGURE_SHAPES}
        </g>
      </mask>
    </defs>
  );
}

/** The body map's figure (BodyMap.tsx), in its own 240 by 440 units. */
const FIGURE_SHAPES = (
  <>
    <circle cx="120" cy="38" r="23" />
    <rect x="108" y="54" width="24" height="30" rx="9" />
    <path d="M84 84C100 78 140 78 156 84L170 94C176 98 177 106 175 114L163 196C161 214 160 232 158 256L82 256C80 232 79 214 77 196L65 114C63 106 64 98 70 94Z" />
    <path className="pb-arm" d="M72 104L56 168L44 230" />
    <path className="pb-arm" d="M168 104L184 168L196 230" />
    <circle cx="41" cy="250" r="11" />
    <circle cx="199" cy="250" r="11" />
    <path className="pb-leg" d="M100 250L95 336L92 404" />
    <path className="pb-leg" d="M140 250L145 336L148 404" />
    <ellipse cx="87" cy="421" rx="16" ry="9" />
    <ellipse cx="153" cy="421" rx="16" ry="9" />
  </>
);

function Body({ f }: { f: Frame }) {
  const { body, joints } = f;
  return (
    <g>
      {body.opacity > 0.001 && (
        <ellipse
          cx={PEDESTAL.x}
          cy={PEDESTAL.y}
          rx={PEDESTAL.rx}
          ry={PEDESTAL.ry}
          fill="url(#pb-pedestal)"
          opacity={body.opacity}
        />
      )}
      {body.opacity > 0.001 && (
        <g opacity={body.opacity} clipPath="url(#pb-reveal)">
          <g transform={FIGURE_AT}>
            <g className="pb-body-edge">{FIGURE_SHAPES}</g>
            <g className="pb-body-fill">{FIGURE_SHAPES}</g>
          </g>
        </g>
      )}
      {body.scan > 0.001 && (
        <g opacity={body.scan}>
          <rect
            x="0"
            y={body.scanY - 48}
            width={STAGE.w}
            height="48"
            fill="url(#pb-scan)"
            mask="url(#pb-figure)"
          />
          <line className="pb-scanglow" x1="92" x2="268" y1={body.scanY} y2={body.scanY} />
          <line className="pb-scanline" x1="92" x2="268" y1={body.scanY} y2={body.scanY} />
          <circle className="pb-scanend" cx="92" cy={body.scanY} r="2.6" />
          <circle className="pb-scanend" cx="268" cy={body.scanY} r="2.6" />
        </g>
      )}
      {joints.map(
        (j, i) =>
          j.opacity > 0.001 &&
          j.on > 0 && (
            <g key={i} transform={`translate(${j.at[0]} ${j.at[1]})`} opacity={j.opacity}>
              <circle r={16 * easeBack(j.on)} fill="url(#pb-halo)" />
              {j.pulse > 0 && j.pulse < 1 && (
                <circle className="pb-pulse" r={6 + 18 * j.pulse} opacity={0.7 * (1 - j.pulse)} />
              )}
              <circle className="pb-joint" r={5 * easeBack(j.on)} />
            </g>
          ),
      )}
    </g>
  );
}

/** The two records: the condition (a clipboard and lines) and the body map (a small figure). */
function Records({ f }: { f: Frame }) {
  const r = f.records;
  if (r.opacity <= 0.001) return null;
  return (
    <g opacity={r.opacity}>
      {r.links.map((l, i) => (
        <g key={i} opacity={l.draw > 0 ? 1 : 0}>
          <line
            className="pb-link"
            x1={l.from[0]}
            y1={l.from[1]}
            x2={l.to[0]}
            y2={l.to[1]}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - l.draw}
          />
          <circle className="pb-link-end" cx={l.from[0]} cy={l.from[1]} r="2.6" />
          {l.flow > 0 && l.flow < 1 && (
            <circle
              className="pb-flow"
              cx={l.from[0] + (l.to[0] - l.from[0]) * l.flow}
              cy={l.from[1] + (l.to[1] - l.from[1]) * l.flow}
              r="3"
              opacity={Math.min(1, (1 - l.flow) * 4)}
            />
          )}
        </g>
      ))}
      {r.cards.map((card, i) => (
        <g key={i} transform={`translate(${card.at[0]} ${card.at[1]})`} opacity={card.opacity}>
          <ellipse cx={RECORD.w / 2} cy={RECORD.h + 4} rx={RECORD.w / 2} ry="8" fill="url(#pb-shade)" />
          <rect className="pb-record" width={RECORD.w} height={RECORD.h} rx="14" />
          {i === 0 ? (
            <>
              <rect className="pb-tile" x="10" y="10" width="24" height="24" rx="8" />
              <path className="pb-glyph-line" d="M18 15.5h8M17 16v11.5h10V16M19.5 21h5M19.5 24h3.5" />
              <rect className="pb-bar is-strong" x="42" y="13" width="42" height="5" rx="2.5" />
              <rect className="pb-bar" x="42" y="23" width="28" height="5" rx="2.5" />
              <rect className="pb-bar" x="10" y="42" width="74" height="5" rx="2.5" />
            </>
          ) : (
            <>
              <rect className="pb-tile" x="10" y="10" width="24" height="40" rx="8" />
              <path
                className="pb-glyph-line"
                d="M22 17.5a2.5 2.5 0 1 0 0.01 0M22 20.5v12M22 33l-3.5 10M22 33l3.5 10M17 23.5l5 1 5-1"
              />
              <circle className="pb-glyph-dot" cx="17" cy="23.5" r="2" />
              <rect className="pb-bar is-strong" x="42" y="13" width="42" height="5" rx="2.5" />
              <rect className="pb-bar" x="42" y="23" width="34" height="5" rx="2.5" />
              <rect className="pb-chip" x="42" y="36" width="19" height="11" rx="5.5" />
              <rect className="pb-chip" x="65" y="36" width="19" height="11" rx="5.5" />
            </>
          )}
          {card.shimmer > 0 && card.shimmer < 1 && (
            <rect
              clipPath="url(#pb-record)"
              x={-46 + (RECORD.w + 46) * card.shimmer}
              width="46"
              height={RECORD.h}
              fill="url(#pb-shimmer)"
            />
          )}
        </g>
      ))}
    </g>
  );
}

/** The camera's frame: soft corners, faint scan lines, a sweeping band and a live dot. */
function Hud({ f }: { f: Frame }) {
  const h = f.hud;
  if (h.opacity <= 0.001) return null;
  const { x, y, w } = VIEW;
  const vh = h.bottom - y;
  const [r, a] = [22, 36];
  return (
    <g opacity={h.opacity}>
      <rect x={x} y={y} width={w} height={vh} rx={r} fill="url(#pb-lines)" />
      <rect x={x} y={h.band} width={w} height="34" fill="url(#pb-band)" />
      <path
        className="pb-frame"
        d={
          `M${x} ${y + a}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + a}` +
          `M${x + w - a} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + a}` +
          `M${x + w} ${y + vh - a}V${y + vh - r}Q${x + w} ${y + vh} ${x + w - r} ${y + vh}H${x + w - a}` +
          `M${x + a} ${y + vh}H${x + r}Q${x} ${y + vh} ${x} ${y + vh - r}V${y + vh - a}`
        }
      />
      <circle className="pb-live" cx={x + 20} cy={y + 20} r="3.6" opacity={h.live} />
    </g>
  );
}

function Skeleton({ s }: { s: SkeletonFrame | null }) {
  if (!s || s.opacity <= 0.001) return null;
  const p = s.pose;
  const gold = new Set(s.gold);
  const neck = [(p.shR[0] + p.shL[0]) / 2, (p.shR[1] + p.shL[1]) / 2];
  const hold = s.hold;
  return (
    <g opacity={s.opacity}>
      {s.arc.opacity > 0.001 && (
        <g opacity={s.arc.opacity}>
          <path className="pb-arc-fill" d={arcWedge(p.shR, 34, s.arc.deg)} />
          <path className="pb-arc-ticks" d={arcTicks(p.shR, 37, 42, s.arc.deg, 15)} />
          <path className="pb-arc" d={arcWedge(p.shR, 34, s.arc.deg)} />
        </g>
      )}
      <g opacity={s.bones}>
        <line className="pb-bone" x1={neck[0]} y1={neck[1]} x2={p.head[0]} y2={p.head[1] + HEAD_R} />
        {BONES.map(([a, b]) => (
          <line
            key={a + b}
            className={gold.has(a) && gold.has(b) ? "pb-bone is-gold" : "pb-bone"}
            x1={p[a][0]}
            y1={p[a][1]}
            x2={p[b][0]}
            y2={p[b][1]}
          />
        ))}
        <circle className="pb-head" cx={p.head[0]} cy={p.head[1]} r={HEAD_R} />
      </g>
      {LANDMARKS.map(
        (l, i) =>
          l !== "head" && (
            <circle
              key={l}
              className={gold.has(l) ? "pb-lm is-gold" : "pb-lm"}
              cx={p[l][0]}
              cy={p[l][1]}
              r={(l === "nose" ? 2.8 : 4.1) * s.pop[i]}
            />
          ),
      )}
      {s.reticles.map((r, i) => (
        <path key={i} className="pb-reticle" opacity={r.opacity} d={reticle(r.at, r.size)} />
      ))}
      {hold.opacity > 0.001 && (
        <g transform={`translate(${hold.at[0]} ${hold.at[1]})`} opacity={hold.opacity}>
          <circle className="pb-hold-track" r="14" />
          {hold.progress > 0 && (
            <circle
              className="pb-hold"
              r="14"
              transform="rotate(-90)"
              pathLength={1}
              strokeDasharray={`${hold.progress} 1`}
            />
          )}
          {hold.pulse > 0 && hold.pulse < 1 && (
            <circle className="pb-hold-pulse" r={14 + 16 * hold.pulse} opacity={0.7 * (1 - hold.pulse)} />
          )}
        </g>
      )}
    </g>
  );
}

/** Four corner brackets around a tracked point. */
function reticle([x, y]: Pt, s: number) {
  const a = 4;
  return `M${x - s} ${y - s + a}V${y - s}H${x - s + a}M${x + s - a} ${y - s}H${x + s}V${y - s + a}M${x + s} ${y + s - a}V${y + s}H${x + s - a}M${x - s + a} ${y + s}H${x - s}V${y + s - a}`;
}

const polyline = (points: Pt[]) => points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");

function Gait({ g }: { g: GaitFrame | null }) {
  if (!g || g.opacity <= 0.001) return null;
  return (
    <g opacity={g.opacity}>
      <line
        className="pb-ground"
        x1="40"
        x2="320"
        y1={GROUND + 4}
        y2={GROUND + 4}
        strokeDashoffset={g.belt}
      />
      {g.trails.map((tr) => (
        <path key={tr.leg} className={`pb-trace is-${tr.leg}`} d={polyline(tr.points)} />
      ))}
      {(["right", "left"] as const).map((leg) => (
        <g key={leg}>
          <rect
            className="pb-lane"
            x={LANE_X0}
            y={LANES[leg] - 4}
            width={NOW_X - LANE_X0 + 4}
            height="8"
            rx="4"
          />
          <circle className={`pb-key is-${leg}`} cx={LANE_X0 - 12} cy={LANES[leg]} r="3.6" />
        </g>
      ))}
      {g.bars.map((b, i) => (
        <rect
          key={i}
          className={`pb-gait is-${b.leg}`}
          x={b.from}
          y={LANES[b.leg] - 4}
          width={b.to - b.from}
          height="8"
          rx="4"
        />
      ))}
      <line className="pb-now" x1={NOW_X} x2={NOW_X} y1={GROUND + 10} y2={LANES.left + 11} />
      {g.steps.map((s, i) => (
        <circle
          key={i}
          className={`pb-step is-${s.leg}`}
          cx={s.at[0]}
          cy={s.at[1]}
          r={3 + 15 * s.k}
          opacity={0.7 * (1 - s.k)}
        />
      ))}
    </g>
  );
}

/** The exercise glyphs (the guided cards' line art, src/app/ExerciseArt.tsx), 24 by 24. */
const GLYPHS: Record<CardKind, ReactNode> = {
  stretch: (
    <>
      <path d="M3 9.5c2-3.3 4-3.3 6 0s4 3.3 6 0 4-3.3 6 0" />
      <path d="M3 15.5c2-3.3 4-3.3 6 0s4 3.3 6 0 4-3.3 6 0" opacity="0.55" />
    </>
  ),
  strengthen: <path d="M6.5 7.5v9M3.5 10v4M17.5 7.5v9M20.5 10v4M6.5 12h11" />,
  walk: (
    <>
      <circle cx="13" cy="4.2" r="2" />
      <path d="M12.6 7.6 11 14m0 0-3.4 7m3.4-7 3.6 3.3.9 3.7M12.3 9.2 8.4 11.6m3.9-2.4 3.4 3" />
    </>
  ),
};

/** What fed the program: the records, the pose the camera tracked, the steps of the walk (24 by 24). */
const SOURCE_GLYPHS: Record<SourceKind, ReactNode> = {
  record: <path d="M8.5 5.5h7M7.5 6v13h9V6M10 11h4M10 14h2.5" />,
  // three tracked points and the angle between them
  pose: (
    <>
      <path d="M4.5 18 11 8.5l8.5 5.5" />
      <path className="is-gold" d="M8.6 12a4.5 4.5 0 0 0 5.6 4" />
      <circle className="is-dot" cx="4.5" cy="18" r="2" />
      <circle className="is-dot" cx="11" cy="8.5" r="2" />
      <circle className="is-dot" cx="19.5" cy="14" r="2" />
    </>
  ),
  // the walk's timing bars, right and left
  steps: (
    <>
      <rect className="is-right" x="3" y="6.5" width="12" height="4.5" rx="2.25" />
      <rect className="is-left" x="9" y="13" width="12" height="4.5" rx="2.25" />
    </>
  ),
};

function Engine({ e, plan, rtl }: { e: EngineFrame; plan: BuildPlan; rtl: boolean }) {
  const core = e.core;
  const h = slotHeight(plan.rows);
  const top = weekTop(plan.rows);
  return (
    <g>
      {e.slots.map((s, d) => {
        const x = WEEK.x0 + d * (WEEK.w + WEEK.gap);
        return (
          <g key={d} opacity={s.opacity} transform={`translate(0 ${s.lift * 10})`}>
            <rect className="pb-slot" x={x} y={top} width={WEEK.w} height={h} rx="13" />
            <circle className="pb-day" cx={x + WEEK.w / 2} cy={top + h + 11} r="2.2" />
          </g>
        );
      })}
      {e.cards.map((c, i) => {
        if (c.landed <= 0) return null;
        const dx = c.at[0] - CORE[0];
        const dy = c.at[1] - 13 - CORE[1];
        const len = Math.hypot(dx, dy);
        return (
          <line
            key={i}
            className="pb-ray"
            x1={CORE[0] + (dx / len) * RINGS[2]}
            y1={CORE[1] + (dy / len) * RINGS[2]}
            x2={c.at[0]}
            y2={c.at[1] - 13}
            opacity={c.landed}
          />
        );
      })}
      <g transform={`translate(${CORE[0]} ${CORE[1]})`}>
        <circle r={88 * core.glow} fill="url(#pb-core)" />
        {core.burst > 0 && core.burst < 1 && (
          <circle className="pb-burst" r={24 + 80 * core.burst} opacity={0.55 * (1 - core.burst)} />
        )}
        {core.rings.map((ring, i) => (
          <g
            key={i}
            transform={`rotate(${ring.angle}) scale(${ring.scale})`}
            opacity={Math.min(1, ring.scale)}
          >
            <circle className={`pb-ring is-${i}`} r={RINGS[i]} />
          </g>
        ))}
        {core.badges.map((b) => {
          const a = (b.angle * Math.PI) / 180;
          return (
            b.scale > 0 && (
              <g
                key={b.kind}
                transform={`translate(${RINGS[2] * Math.cos(a)} ${RINGS[2] * Math.sin(a)}) scale(${b.scale})`}
              >
                <circle className="pb-badge" r="14.5" />
                <g className="pb-glyph is-badge" transform="translate(-9 -9) scale(0.75)">
                  {SOURCE_GLYPHS[b.kind]}
                </g>
              </g>
            )
          );
        })}
        <circle className="pb-disc" r={21 * core.disc} />
        {core.check > 0 && (
          <path
            className="pb-check"
            d="M-8.5 0.5L-2.8 6.2L8.5 -5.8"
            transform={rtl ? "scale(-1 1)" : undefined}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - core.check}
          />
        )}
      </g>
      {e.sparks.map((s, i) => (
        <g key={i} opacity={s.opacity}>
          <path
            className={s.gold ? "pb-trail is-gold" : "pb-trail"}
            d={polyline(s.tail.slice(0, 2))}
            strokeWidth={s.r * 0.7}
          />
          <path
            className={s.gold ? "pb-trail is-gold is-near" : "pb-trail is-near"}
            d={polyline([...s.tail.slice(1), s.at])}
            strokeWidth={s.r * 1.3}
          />
          <circle
            cx={s.at[0]}
            cy={s.at[1]}
            r={s.r * 2.4}
            fill={s.gold ? "url(#pb-spark-gold)" : "url(#pb-spark-purple)"}
          />
        </g>
      ))}
      {e.cards.map((c, i) => {
        if (c.opacity <= 0.001) return null;
        const kind = plan.cards[i].kind;
        return (
          <g key={i}>
            {c.landed > 0 && c.landed < 1 && (
              <ellipse
                className="pb-land"
                cx={c.at[0]}
                cy={c.at[1] + 14}
                rx="20"
                ry="5"
                opacity={1 - c.landed}
              />
            )}
            <g
              className="pb-card"
              transform={`translate(${c.at[0]} ${c.at[1]}) rotate(${c.angle}) scale(${c.scale})`}
              opacity={c.opacity}
            >
              <ellipse cx="0" cy="14" rx="15" ry="4" fill="url(#pb-shade)" />
              <rect className="pb-card-face" x="-16" y="-13" width="32" height="26" rx="8" />
              <g className={`pb-glyph is-${kind}`} transform="translate(-7.8 -7.8) scale(0.65)">
                {GLYPHS[kind]}
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}
