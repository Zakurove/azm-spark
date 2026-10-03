/**
 * Step 1 (contract C2).
 *
 *   ReportStep  Saad's sample report as a document card. «اقرأ التقرير» sends it to POST
 *               /api/booth/report (the same reading as at home); the chips of what was read animate
 *               in. Without an answer within 8 s (or without a reading engine) the booth shows its
 *               own reading of the same sample, so the journey never waits.
 *   AboutStep   "Try it as yourself": three tap screens (condition chips with clearance when it is
 *               needed, position, weaker side) and an optional report photo that fills them.
 */
import { useEffect, useRef, useState } from "react";
import type { Lang } from "../../app/i18n";
import { optionNames } from "../../app/platform-copy";
import BoothIcon from "./BoothIcon";
import { boothCopy } from "./copy";
import { needsClearance, toggleCondition, SELF_CONDITIONS, type SelfAnswers } from "./intake";
import type { Journey, Reading } from "./journey";
import { Actions, n, StepHead, stepKicker } from "./parts";
import { imageData, pause, readable, readReport } from "./api";
import { READ_FALLBACK_MS, SAAD, SAAD_EXTRACTION, SAAD_REPORT_SRC, type BoothExtraction } from "./story";
import { readingChips, type ChipKind } from "./views";

/** The reading animation runs at least this long, so the chips arrive as a reading, not a flash. */
const MIN_READ_MS = 1800;

const CHIP_ICON: Record<ChipKind, string> = {
  age: "user",
  condition: "spine",
  mobility: "wheelchair",
  pain: "pain",
  restrictions: "shield",
  medications: "pill",
};

/** Whether the component is still on screen (a reset can end a reading half way). */
function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    // StrictMode mounts twice in development: the second mount is alive again.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

export function Chips({ x, lang }: { x: BoothExtraction; lang: Lang }) {
  return (
    <ul className="bx-chips" aria-live="polite">
      {readingChips(x, lang).map((c, i) => (
        <li
          key={`${c.kind}:${c.value}`}
          className="bx-chip"
          style={{ ["--i" as string]: i }}
          data-chip={c.kind}
        >
          <span className="bx-chip-icon">
            <BoothIcon name={CHIP_ICON[c.kind]} size={20} />
          </span>
          <span className="bx-chip-text">
            <small>{c.label}</small>
            <b>{c.value}</b>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ story */

export function ReportStep({
  lang,
  session,
  reading,
  onRead,
  onBack,
  onNext,
}: {
  lang: Lang;
  session: string;
  reading: Reading | null;
  onRead(x: BoothExtraction, source: Reading["source"]): void;
  onBack(): void;
  onNext(): void;
}) {
  const k = boothCopy(lang);
  const alive = useAlive();
  const [busy, setBusy] = useState(false);

  const read = async () => {
    if (busy) return;
    setBusy(true);
    const started = performance.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), READ_FALLBACK_MS);
    let live: BoothExtraction | null = null;
    const image = await imageData(SAAD_REPORT_SRC);
    if (image) {
      const r = await readReport(session, image, lang, ctl.signal);
      if (r.ok && readable(r.value) && r.value.extracted.conditions.length) live = r.value;
    }
    clearTimeout(timer);
    const left = MIN_READ_MS - (performance.now() - started);
    if (left > 0) await pause(left);
    if (!alive.current) return;
    setBusy(false);
    onRead(live ?? SAAD_EXTRACTION, live ? "live" : "cached");
  };

  const state = reading ? "read" : busy ? "reading" : "idle";
  return (
    <div className="bx-report" data-screen="report" data-reading={state} data-source={reading?.source}>
      <figure className={`bx-doc${busy ? " scanning" : ""}${reading ? " read" : ""}`}>
        <img src={SAAD_REPORT_SRC} alt={k.reportAlt} width={1200} height={1697} />
        <span className="bx-doc-beam" aria-hidden="true" />
      </figure>
      <div className="bx-report-side">
        <StepHead kicker={stepKicker(lang, 0)} title={k.reportTitle} />
        {!reading && (
          <div className="bx-person">
            <span className="bx-avatar" aria-hidden="true">
              {SAAD.name[lang].slice(0, 1)}
            </span>
            <ul>
              {SAAD.story.map((line) => (
                <li key={line.en}>{line[lang]}</li>
              ))}
            </ul>
          </div>
        )}
        {state === "idle" && <p className="bx-notice">{k.reportNotice}</p>}
        {state === "reading" && (
          <div className="bx-reading" role="status">
            <span className="bx-reading-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {k.reportReading}
          </div>
        )}
        {reading && (
          <section className="bx-read" aria-label={k.readTitle}>
            <h2 className="bx-h2">
              <BoothIcon name="spark" size={18} />
              {k.readTitle}
            </h2>
            <Chips x={reading.extraction} lang={lang} />
            <p className="bx-rule-note">
              <BoothIcon name="shield" size={18} />
              {k.readNote}
            </p>
          </section>
        )}
        <Actions
          lang={lang}
          onBack={onBack}
          primary={
            reading
              ? { label: k.next, onClick: onNext }
              : { label: k.reportRead, onClick: () => void read(), busy, icon: "spark", name: "read" }
          }
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ as yourself */

const POSITION_ART = {
  seated: "/illustrations/landing/chair-press.webp",
  wheelchair: "/illustrations/landing/wheelchair-press.webp",
  standing: "/illustrations/landing/standing.webp",
} as const;

export function AboutStep({
  lang,
  session,
  journey,
  onTap,
  onRead,
  onBack,
  onNext,
}: {
  lang: Lang;
  session: string;
  journey: Journey;
  onTap(a: Partial<SelfAnswers>): void;
  onRead(x: BoothExtraction): void;
  onBack(): void;
  onNext(): void;
}) {
  const k = boothCopy(lang);
  const a = journey.self;
  const tap = journey.tap;
  const ready =
    tap === 0
      ? a.conditions.length > 0 && (!needsClearance(a.conditions) || !!a.clearance)
      : tap === 1
        ? !!a.position
        : !!a.side;
  const titles = [
    [k.aboutConditionTitle, k.aboutConditionBody],
    [k.aboutPositionTitle, k.aboutPositionBody],
    [k.aboutSideTitle, k.aboutSideBody],
  ] as const;
  const kicker = (
    <>
      {stepKicker(lang, 0)}
      <span className="bx-kicker-dot" aria-hidden="true" />
      <span>{k.tapOf(n(lang, tap + 1), n(lang, 3))}</span>
    </>
  );
  return (
    <div className="bx-about" data-screen="about" data-tap={tap}>
      <StepHead kicker={kicker} title={titles[tap][0]} body={titles[tap][1]} />
      {tap === 0 && <Conditions lang={lang} answers={a} session={session} onTap={onTap} onRead={onRead} />}
      {tap === 1 && (
        <div className="bx-cards three" role="radiogroup" aria-label={k.aboutPositionTitle}>
          {(["seated", "wheelchair", "standing"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={a.position === p}
              className={`bx-card-pick${a.position === p ? " on" : ""}`}
              onClick={() => onTap({ position: p })}
              data-pick={p}
            >
              <span className="bx-pick-art" aria-hidden="true">
                <img src={POSITION_ART[p]} alt="" />
              </span>
              <b>{k.positions[p]}</b>
              <span className="bx-pick-mark" aria-hidden="true">
                <BoothIcon name="check" size={18} />
              </span>
            </button>
          ))}
        </div>
      )}
      {tap === 2 && (
        <div className="bx-cards three sides" role="radiogroup" aria-label={k.aboutSideTitle}>
          {(["none", "left", "right"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={a.side === s}
              className={`bx-card-pick${a.side === s ? " on" : ""}`}
              onClick={() => onTap({ side: s })}
              data-pick={s}
            >
              <span className="bx-pick-art" aria-hidden="true">
                <SideFigure side={s} />
              </span>
              <b>{k.sides[s]}</b>
              <span className="bx-pick-mark" aria-hidden="true">
                <BoothIcon name="check" size={18} />
              </span>
            </button>
          ))}
        </div>
      )}
      <Actions lang={lang} onBack={onBack} primary={{ label: k.next, onClick: onNext, disabled: !ready }} />
    </div>
  );
}

function Conditions({
  lang,
  answers: a,
  session,
  onTap,
  onRead,
}: {
  lang: Lang;
  answers: SelfAnswers;
  session: string;
  onTap(a: Partial<SelfAnswers>): void;
  onRead(x: BoothExtraction): void;
}) {
  const k = boothCopy(lang);
  const alive = useAlive();
  const file = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<"idle" | "reading" | "read" | "failed">("idle");
  const ask = needsClearance(a.conditions);

  const readPhoto = async (f: File) => {
    setPhoto("reading");
    const image = await imageData(f);
    const r = image ? await readReport(session, image, lang) : null;
    if (!alive.current) return;
    if (r?.ok && readable(r.value)) {
      onRead(r.value);
      setPhoto("read");
    } else setPhoto("failed");
  };

  return (
    <>
      <div className="bx-cond" role="group" aria-label={k.aboutConditionTitle}>
        {SELF_CONDITIONS.map((c) => {
          const on = a.conditions.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              className={`bx-pill${on ? " on" : ""}${c === "none" ? " none" : ""}`}
              onClick={() => onTap({ conditions: toggleCondition(a.conditions, c) })}
              data-condition={c}
            >
              {on && <BoothIcon name="check" size={18} />}
              {optionNames[c]?.[lang] ?? c}
            </button>
          );
        })}
      </div>
      {ask && (
        <div className="bx-clear" role="radiogroup" aria-label={k.aboutClearance}>
          <p>{k.aboutClearance}</p>
          <div>
            {(["yes", "no", "unsure"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={a.clearance === v}
                className={`bx-pill${a.clearance === v ? " on" : ""}`}
                onClick={() => onTap({ clearance: v })}
                data-clearance={v}
              >
                {k.clearance[v]}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="bx-photo" data-photo={photo}>
        {photo === "reading" ? (
          <p className="bx-reading" role="status">
            <span className="bx-reading-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {k.photoReading}
          </p>
        ) : (
          <button
            type="button"
            className="bx-quiet"
            onClick={() => file.current?.click()}
            data-action="photo"
          >
            <BoothIcon name="camera" />
            {k.photoOpen}
          </button>
        )}
        {photo === "read" && <p role="status">{k.photoRead}</p>}
        {photo === "failed" && <p role="status">{k.photoFailed}</p>}
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readPhoto(f);
            e.target.value = "";
          }}
        />
      </div>
    </>
  );
}

/**
 * A calm figure; the weaker side, when there is one, glows purple. It reads like a mirror, as the
 * camera screen does: the person's left side is on the left of the picture.
 */
function SideFigure({ side }: { side: "none" | "left" | "right" }) {
  const glow = side === "none" ? null : side;
  return (
    <svg viewBox="0 0 120 120" className="bx-side-figure" data-glow={glow ?? "none"}>
      <circle cx="60" cy="26" r="12" className="head" />
      <path d="M60 40v40" className="body" />
      <path d="M60 46 38 52 30 76" className={`arm${glow === "left" ? " weak" : ""}`} />
      <path d="M60 46 82 52 90 76" className={`arm${glow === "right" ? " weak" : ""}`} />
      <path d="M60 80 46 108" className={`leg${glow === "left" ? " weak" : ""}`} />
      <path d="M60 80 74 108" className={`leg${glow === "right" ? " weak" : ""}`} />
    </svg>
  );
}
