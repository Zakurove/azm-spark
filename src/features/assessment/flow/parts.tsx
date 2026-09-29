/**
 * Small parts of the flow screens (UX spec 5.3 to 5.5), built on the shared shell and answers:
 *   SamePress        an answer counts only when the press starts and ends on the same button (O11a)
 *   Emphasized       bold words inside a data text, the text unchanged (0.2)
 *   SentenceStack    a long text one sentence per paragraph, the sentence being read highlighted
 *   NoticeCard       warn, info and care cards, the tone named for assistive technology
 *   ListenButton     "Listen to the question" / "Listen again", 48 px
 *   ScaleGrid        the 0 to 10 pain scale: 11 buttons in two rows, 0 at the reading start (Q7)
 *   AreaPicker       area chips, each chosen chip opening its own 0 to 10 row (S20)
 *   KgStepper        a kilogram value between two 56 px icon buttons, also typed (S30)
 *   QrCode           a QR code drawn on the device (S04)
 *   drawings         the intro, test, helper and permission prompt pictures (Appendix B stand ins)
 */
import { useId, useRef, useState, type ReactNode } from "react";
import type { Lang } from "../../../app/i18n";
import { formatNumber, t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA } from "../../../movements/assessments";
import type { CheckPosition, Side, TestId } from "../../../movements/types";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { parseNumberInput } from "../shared/format";
import { emphasize, samePress, SCALE_ROWS, snapKg, splitSentences, type Tone } from "./copy";
import { qrMatrix, qrPath } from "./qr";

/* ------------------------------------------------------------------ the same press rule */

/**
 * O11a: wraps answer buttons so a press that slides in from a neighbouring button does nothing. The
 * pointer down target is kept; a click on another button is swallowed. Keyboard clicks always count.
 */
export function SamePress({ children }: { children: ReactNode }) {
  const pressed = useRef<Element | null>(null);
  return (
    <div
      className="flow-same-press"
      onPointerDownCapture={(e) => {
        pressed.current = (e.target as Element).closest("button");
      }}
      onClickCapture={(e) => {
        const clicked = (e.target as Element).closest("button");
        if (!samePress(pressed.current, clicked, e.detail)) {
          e.preventDefault();
          e.stopPropagation();
        }
        pressed.current = null;
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ text */

/** A data text with some words bolded (0.2), digits and Latin runs isolated as everywhere. */
export function Emphasized({ text, words }: { text: string; words: readonly string[] }) {
  const { lang } = useCheckUi();
  return (
    <>
      {emphasize(text, words).map((p, i) =>
        p.strong ? (
          <strong key={i}>{bidiText(lang, p.text)}</strong>
        ) : (
          <span key={i}>{bidiText(lang, p.text)}</span>
        ),
      )}
    </>
  );
}

/**
 * A text holding a clock time («بعد الساعة ٣:١٥ مساءً»): the time is one left to right unit, so its
 * hours never swap with its minutes inside right to left text; the rest reads as bidiText.
 */
export function TimeText({ text }: { text: string }) {
  const { lang } = useCheckUi();
  // bidiText keeps a clock time as one left to right run (src/i18n/rich.tsx).
  return <>{bidiText(lang, text)}</>;
}

/**
 * SentenceStack (S33, S26): a long text, one sentence per paragraph, 12 px apart, nothing reordered
 * or dropped. The sentence being read has aria-current and a 4 px purple bar at the inline start;
 * its text colour does not change.
 */
export function SentenceStack({
  text,
  current,
  size = 20,
}: {
  text: string;
  current?: number | null;
  size?: 18 | 20 | 22;
}) {
  const { lang } = useCheckUi();
  return (
    <div className={`flow-sentences is-${size}`}>
      {splitSentences(text).map((s, i) => (
        <p
          key={i}
          aria-current={current === i ? "true" : undefined}
          className={current === i ? "is-current" : undefined}
        >
          {bidiText(lang, s)}
        </p>
      ))}
    </div>
  );
}

/**
 * NoticeCard (S25, S28): warn (warn tint, a 4 px band at the inline start, triangle) or info (purple
 * tint, info icon). The card is a section named by its tone word, so the tone is never colour alone.
 */
export function NoticeCard({
  tone,
  children,
  lead,
}: {
  tone: Tone;
  children: ReactNode;
  /** A control that leads the card (the 997 call control of warn_sci_t6, Q22). */
  lead?: ReactNode;
}) {
  const { lang } = useCheckUi();
  const word = t(lang, tone === "warn" ? "assessment.tone.warn" : "assessment.tone.info");
  return (
    <section className={`flow-notice is-${tone}`} aria-label={word}>
      {lead && <div className="flow-notice-lead">{lead}</div>}
      <div className="flow-notice-row">
        <span className="flow-notice-icon">
          <CheckIcon name={tone === "warn" ? "alert-triangle" : "info"} />
        </span>
        <div className="flow-notice-body">{children}</div>
      </div>
    </section>
  );
}

/** Listen control (48 px, ghost): plays the screen's lines again, each captioned. */
export function ListenButton({
  onClick,
  label,
  size,
}: {
  onClick(): void;
  label?: string;
  /** large: the 64 px button of S22 at the booth (B16). */
  size?: "large";
}) {
  const { lang } = useCheckUi();
  return (
    <button
      type="button"
      className={`ghost flow-listen${size === "large" ? " is-large" : ""}`}
      onClick={onClick}
    >
      <CheckIcon name="speaker" />
      {label ?? t(lang, "assessment.common.listen")}
    </button>
  );
}

/* ------------------------------------------------------------------ the pain scale (Q7) */

/** The digits of a scale cell in the page's language. */
const cellText = (lang: Lang, n: number) => formatNumber(lang, n);

/**
 * The 0 to 10 scale (S19, S20, Q7): eleven separate buttons in two rows (0 to 5, then 6 to 10), 0 at
 * the start of the reading direction, none preselected, never a slider. A radiogroup; each cell is
 * named "{value} out of 10", and 0 and 10 add their anchor. Arrow keys move between the cells.
 */
export function ScaleGrid({
  labelledBy,
  value,
  onChange,
  compact = false,
}: {
  labelledBy: string;
  value: number | null;
  onChange(v: number): void;
  compact?: boolean;
}) {
  const { lang } = useCheckUi();
  const id = useId();
  const zero = `${id}-zero`;
  const ten = `${id}-ten`;
  const anchors = { zero: tAnchor(lang, "zero"), ten: tAnchor(lang, "ten") };
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const next = Math.min(10, Math.max(0, from + delta));
    onChange(next);
    refs.current[next]?.focus();
  };
  const focusable = value ?? 0;
  return (
    <div className={`flow-scale${compact ? " is-compact" : ""}`}>
      <div role="radiogroup" aria-labelledby={labelledBy} className="flow-scale-rows">
        {SCALE_ROWS.map((row, r) => (
          <div className="flow-scale-row" key={r}>
            {row.map((n) => (
              <button
                key={n}
                ref={(el) => (refs.current[n] = el)}
                type="button"
                role="radio"
                aria-checked={value === n}
                tabIndex={n === focusable ? 0 : -1}
                aria-label={t(lang, "assessment.precheck.scale.cellLabel", { value: n, max: 10 })}
                aria-describedby={n === 0 ? zero : n === 10 ? ten : undefined}
                className="flow-scale-cell"
                onClick={() => onChange(n)}
                onKeyDown={(e) => {
                  const forward = lang === "ar" ? "ArrowLeft" : "ArrowRight";
                  const back = lang === "ar" ? "ArrowRight" : "ArrowLeft";
                  if (e.key === forward || e.key === "ArrowDown") {
                    e.preventDefault();
                    move(n, 1);
                  } else if (e.key === back || e.key === "ArrowUp") {
                    e.preventDefault();
                    move(n, -1);
                  }
                }}
              >
                {cellText(lang, n)}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="flow-scale-anchors">
        <p id={zero} className="check-meta">
          {bidiText(lang, anchors.zero)}
        </p>
        <p id={ten} className="check-meta">
          {bidiText(lang, anchors.ten)}
        </p>
      </div>
    </div>
  );
}

/** The anchor under 0 or 10 (data painScale.anchors, Q7). */
function tAnchor(lang: Lang, which: "zero" | "ten"): string {
  return CHECK_DATA.painScale.anchors[which][lang];
}

/* ------------------------------------------------------------------ area chips (S20, S24) */

/**
 * Area chips in data order. With `scale`, each chosen chip opens its own 0 to 10 row under it (S20);
 * without, the chips are a multiple choice (S24 follow up). `none` is the exclusive chip of S20.
 */
export function AreaPicker({
  labelledBy,
  areas,
  value,
  onChange,
  scale,
  noneLabel,
  none = false,
  onNone,
  describedBy,
  groupRef,
}: {
  labelledBy: string;
  areas: { id: string; label: string }[];
  value: Record<string, number | null>;
  onChange(v: Record<string, number | null>): void;
  scale: boolean;
  /** The exclusive "none" chip of S20 (answer {}), and whether it is chosen. */
  noneLabel?: string;
  none?: boolean;
  onNone?: () => void;
  describedBy?: string;
  groupRef?: React.RefObject<HTMLDivElement>;
}) {
  const { lang } = useCheckUi();
  const clearsId = useId();
  const chosen = (id: string) => id in value;
  const toggle = (id: string) => {
    const next = { ...value };
    if (chosen(id)) delete next[id];
    else next[id] = null;
    onChange(next);
  };
  return (
    <div
      className="check-answers flow-areas"
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      ref={groupRef}
    >
      {noneLabel && (
        <span id={clearsId} className="check-visually-hidden">
          {t(lang, "assessment.common.noneClears")}
        </span>
      )}
      {areas.map((a) => {
        const on = chosen(a.id);
        const rateId = `${clearsId}-${a.id}`;
        return (
          <div key={a.id} className={`flow-area${on ? " is-on" : ""}`}>
            <button
              type="button"
              className="check-answer is-multiple"
              aria-pressed={on}
              onClick={() => toggle(a.id)}
            >
              <span className="check-answer-mark" aria-hidden="true">
                <CheckIcon name="check" size={18} />
              </span>
              <span className="check-answer-text">{bidiText(lang, a.label)}</span>
            </button>
            {scale && on && (
              <div className="flow-area-scale">
                <p id={rateId} className="check-label">
                  {bidiText(
                    lang,
                    `${a.label}. ${t(lang, "assessment.precheck.areas.rate", { min: 0, max: 10 })}`,
                  )}
                </p>
                <ScaleGrid
                  labelledBy={rateId}
                  value={value[a.id] ?? null}
                  compact
                  onChange={(v) => onChange({ ...value, [a.id]: v })}
                />
              </div>
            )}
          </div>
        );
      })}
      {noneLabel && (
        <button
          type="button"
          className="check-answer is-multiple"
          aria-pressed={none}
          aria-describedby={clearsId}
          onClick={() => onNone?.()}
        >
          <span className="check-answer-mark" aria-hidden="true">
            <CheckIcon name="check" size={18} />
          </span>
          <span className="check-answer-text">{bidiText(lang, noneLabel)}</span>
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ kilograms (S30) */

/**
 * A kilogram value between two 56 px icon buttons (SVG minus and plus with text names, never the
 * characters), also typed with the numeric keypad. Typed Arabic Indic or Persian digits and ٫ or ,
 * are read (parseNumberInput); the value snaps to 0.5 kg inside the range and shows back in the
 * page's digits (١٫٥).
 */
export function KgStepper({
  kind,
  value,
  max,
  onChange,
}: {
  kind: "dumbbell" | "cuff";
  value: number;
  /** A lower top for the lighter choices after the practice (step down). */
  max?: number;
  onChange(v: number): void;
}) {
  const { lang } = useCheckUi();
  const labelId = useId();
  const [typing, setTyping] = useState<string | null>(null);
  const shown = formatNumber(lang, value);
  const commit = (raw: string) => {
    const n = parseNumberInput(raw);
    setTyping(null);
    if (n !== null) onChange(snapKg(kind, n, max));
  };
  return (
    <div className="flow-kg" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="check-label">
        {t(lang, "assessment.load.kg")}
      </p>
      <div className="flow-kg-row">
        <button
          type="button"
          className="flow-kg-button"
          aria-label={t(lang, "assessment.load.decrease")}
          onClick={() => onChange(snapKg(kind, value - 0.5, max))}
        >
          <CheckIcon name="minus" />
        </button>
        <input
          className="flow-kg-input"
          inputMode="decimal"
          aria-labelledby={labelId}
          value={typing ?? shown}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          }}
        />
        <button
          type="button"
          className="flow-kg-button"
          aria-label={t(lang, "assessment.load.increase")}
          onClick={() => onChange(snapKg(kind, value + 0.5, max))}
        >
          <CheckIcon name="plus" />
        </button>
      </div>
      <p className="check-visually-hidden" aria-live="polite">
        {t(lang, "assessment.load.kgValue", { kg: value })}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ QR (S04) */

/** A QR code drawn on the device (nothing sent), dark modules in ink on white with a quiet zone. */
export function QrCode({ text, alt, size = 176 }: { text: string; alt: string; size?: number }) {
  const matrix = qrMatrix(text);
  if (!matrix) return null;
  const n = matrix.length + 8;
  return (
    <svg
      className="flow-qr"
      role="img"
      aria-label={alt}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      data-qr={text}
    >
      <rect width={n} height={n} className="flow-qr-bg" />
      <path d={qrPath(matrix)} className="flow-qr-ink" />
    </svg>
  );
}

/* ------------------------------------------------------------------ drawings */

/**
 * Stand ins for the Appendix B drawings until the illustrations exist: plain line drawings in the
 * check tokens, with no text inside the image. Each has its alt text from the copy.
 */
export function IntroDrawing({ alt, position }: { alt: string; position: CheckPosition }) {
  return (
    <figure className="flow-drawing">
      <svg viewBox="0 0 320 180" role="img" aria-label={alt}>
        <rect x="0" y="0" width="320" height="180" rx="14" className="flow-draw-bg" />
        <line x1="20" y1="150" x2="300" y2="150" className="flow-draw-line" />
        <Seat x={70} wheel={position === "wheelchair"} />
        <circle cx="70" cy="62" r="11" className="flow-draw-ink" />
        <path d="M70 74v34m0 0h20m-20-18 18 10" className="flow-draw-stroke" />
        {[125, 160, 195].map((x) => (
          <path key={x} d={`M${x} 150c6 -6 14 -6 20 0`} className="flow-draw-soft" />
        ))}
        <rect x="250" y="70" width="18" height="32" rx="4" className="flow-draw-accent" />
        <path d="M259 102v48m-12 0h24" className="flow-draw-stroke" />
      </svg>
    </figure>
  );
}

function Seat({ x, wheel }: { x: number; wheel: boolean }) {
  return wheel ? (
    <g>
      <circle cx={x} cy={132} r={18} className="flow-draw-stroke" />
      <path d={`M${x - 20} 110h34v-40`} className="flow-draw-stroke" />
    </g>
  ) : (
    <path d={`M${x - 16} 150v-40h34m-34 0v-40m34 40v40`} className="flow-draw-stroke" />
  );
}

/** The instruction card drawing (S28): a fixed 16:9 box, the person's position and the phone. */
export function TestDrawing({
  alt,
  testId,
  position,
}: {
  alt: string;
  testId: TestId;
  position: CheckPosition;
}) {
  const arm =
    testId === "shoulder_abduction"
      ? "M70 86l40 -18"
      : testId === "arm_curl_30s"
        ? "M70 86v18l12 -14"
        : testId === "trunk_control_seated"
          ? "M70 86l-10 20"
          : "M60 80l20 8";
  return (
    <figure className="flow-drawing is-wide">
      <svg viewBox="0 0 320 180" role="img" aria-label={alt}>
        <rect x="0" y="0" width="320" height="180" rx="14" className="flow-draw-bg" />
        <line x1="20" y1="150" x2="300" y2="150" className="flow-draw-line" />
        {testId !== "chair_stand_30s" && <Seat x={70} wheel={position === "wheelchair"} />}
        {testId === "chair_stand_30s" && <path d="M40 150v-40h34v40M40 110v-40" className="flow-draw-soft" />}
        <circle cx={testId === "trunk_control_seated" ? 62 : 70} cy="58" r="11" className="flow-draw-ink" />
        <path d={`M70 70v36${testId === "chair_stand_30s" ? "v40" : "h20"}`} className="flow-draw-stroke" />
        <path d={arm} className="flow-draw-accent-stroke" />
        <rect x="250" y="70" width="18" height="32" rx="4" className="flow-draw-accent" />
        <path d="M259 102v48m-12 0h24" className="flow-draw-stroke" />
      </svg>
    </figure>
  );
}

/**
 * The P4 top down picture of the helper briefing (S26): the chair against the wall, the phone toward
 * the stronger side (chair stand) or in front (side lean), the support in front, and the helper beside
 * the weaker side, slightly behind. Mirrored for a weaker left side, from the person's own sides.
 */
export function TopDownDrawing({ alt, weaker, stand }: { alt: string; weaker: Side | null; stand: boolean }) {
  // The person faces down the picture (toward the phone); their right is the picture's left.
  const helperLeft = (weaker ?? "left") === "right";
  const phoneX = stand ? (helperLeft ? 240 : 80) : 160;
  return (
    <figure className="flow-drawing">
      <svg viewBox="0 0 320 200" role="img" aria-label={alt}>
        <rect x="0" y="0" width="320" height="200" rx="14" className="flow-draw-bg" />
        <line x1="40" y1="24" x2="280" y2="24" className="flow-draw-line" />
        <rect x="135" y="30" width="50" height="44" rx="6" className="flow-draw-soft" />
        <circle cx="160" cy="52" r="14" className="flow-draw-ink" />
        <circle cx={helperLeft ? 110 : 210} cy="46" r="12" className="flow-draw-accent" />
        {stand && (
          <rect x={helperLeft ? 180 : 100} y="96" width="40" height="18" rx="4" className="flow-draw-soft" />
        )}
        <rect x={phoneX - 9} y="160" width="18" height="28" rx="4" className="flow-draw-accent" />
        <path d={`M160 66L${phoneX} 158`} className="flow-draw-dash" />
      </svg>
    </figure>
  );
}

/**
 * The Q9 chair picture (S28 chair stand at home, Appendix B): a firm dining chair against a wall with
 * the support in front. Decorative: the gate question itself names what it shows.
 */
export function ChairGateDrawing() {
  return (
    <figure className="flow-drawing is-small" aria-hidden="true">
      <svg viewBox="0 0 320 150">
        <rect x="0" y="0" width="320" height="150" rx="14" className="flow-draw-bg" />
        <line x1="60" y1="20" x2="60" y2="130" className="flow-draw-line" />
        <line x1="20" y1="130" x2="300" y2="130" className="flow-draw-line" />
        <path d="M72 130V58M72 88h52v42M72 88v42" className="flow-draw-stroke" />
        <rect x="190" y="72" width="80" height="12" rx="4" className="flow-draw-accent" />
        <path d="M200 84v46M260 84v46" className="flow-draw-stroke" />
      </svg>
    </figure>
  );
}

/** The camera permission prompt drawing (S31): a system prompt with its Allow button circled. */
export function PromptDrawing({ alt }: { alt: string }) {
  return (
    <figure className="flow-drawing">
      <svg viewBox="0 0 320 170" role="img" aria-label={alt}>
        <rect x="0" y="0" width="320" height="170" rx="14" className="flow-draw-bg" />
        <rect x="50" y="20" width="220" height="130" rx="16" className="flow-draw-card" />
        <circle cx="160" cy="52" r="12" className="flow-draw-soft" />
        <rect x="90" y="74" width="140" height="8" rx="4" className="flow-draw-soft" />
        <rect x="110" y="88" width="100" height="8" rx="4" className="flow-draw-soft" />
        <rect x="66" y="112" width="84" height="26" rx="8" className="flow-draw-soft" />
        <rect x="170" y="112" width="84" height="26" rx="8" className="flow-draw-accent" />
        <ellipse cx="212" cy="125" rx="54" ry="24" className="flow-draw-ring" />
      </svg>
    </figure>
  );
}
