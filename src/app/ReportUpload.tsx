import { useRef, useState } from "react";
import { Lang } from "./i18n";
import { labels, errorText } from "./platform-copy";
import { api } from "./api";
import Icon from "./Icon";
import { t } from "../i18n";
import { bidiText } from "../i18n/rich";
import { privacyHref } from "./privacyHref";

export interface ReportResult {
  document: string;
  extracted: {
    age: number | null;
    conditions: string[];
    diagnosisNotes: string;
    medications: string;
    mobility: string;
    support: string;
    pain: string[];
    restrictions: string[];
    symptoms: string;
    recentChange: string;
  };
  missing: string[];
  questions: string[];
  summary: string;
  confidence: string;
}

/**
 * The body of POST /api/medical-report: the report with the separate consent of Q32 (2), which the
 * server needs before it sends anything to the model.
 */
export function reportRequest(
  body: { kind: "text"; text: string } | { kind: "image"; image: string },
  lang: Lang,
): Record<string, unknown> {
  return { ...body, lang, reportConsent: true };
}

/** Optional medical report analysis of a fresh intake (C47): a secondary link «عندك تقرير طبي؟» under
 * the first questions; choosing it opens the panel with the transfer notice before any upload.
 * The image is downscaled on the phone; on any failure the form continues by hand.
 * Nothing can be sent until the person ticks the separate report consent (Q32 (2)); skipping and
 * answering by hand stays open at all times. */
export default function ReportUpload({
  lang,
  onExtracted,
  opened = false,
}: {
  lang: Lang;
  onExtracted: (r: ReportResult) => void;
  /** Starts with the panel open (tests); the intake starts with the link. */
  opened?: boolean;
}) {
  const c = labels(lang);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState(opened),
    [text, setText] = useState(""),
    [consent, setConsent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open)
    return (
      <button type="button" className="text-button report-open" onClick={() => setOpen(true)}>
        <Icon name="health" size={17} />
        {c.reportTitle}
      </button>
    );

  const analyze = async (body: { kind: "text"; text: string } | { kind: "image"; image: string }) => {
    setBusy(true);
    setError("");
    try {
      if (!consent) return;
      const result = await api<ReportResult>("/medical-report", reportRequest(body, lang));
      if (result.document === "not_medical" || result.document === "unreadable") {
        setError("NOT_MEDICAL");
        return;
      }
      onExtracted(result);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    const image = await downscale(file);
    if (!image) {
      setError("REPORT_INVALID");
      return;
    }
    await analyze({ kind: "image", image });
  };

  return (
    <section className="report-upload" aria-label={c.reportTitle}>
      <div className="report-heading">
        <span className="landing-feature-icon report-icon">
          <Icon name="health" size={19} />
        </span>
        <div>
          <h3>{c.reportTitle}</h3>
          <p>{c.reportBody}</p>
        </div>
      </div>
      {busy ? (
        <div className="report-busy">
          <span className="report-spinner" aria-hidden />
          {c.reportBusy}
        </div>
      ) : (
        <>
          <div className="report-consent">
            <p>{bidiText(lang, c.reportConsentBody)}</p>
            <label className="consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{c.reportConsentCheck}</span>
            </label>
            <a className="report-privacy-link" href={privacyHref(lang)} target="_blank" rel="noreferrer">
              {t(lang, "privacy.link")}
            </a>
          </div>
          <div className="report-actions">
            <button
              type="button"
              className="ghost"
              disabled={!consent}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="camera" size={16} />
              {c.reportUpload}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </div>
          <label className="field report-paste">
            <span>{c.reportPaste}</span>
            <textarea
              rows={3}
              maxLength={20000}
              value={text}
              disabled={!consent}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {text.trim().length > 0 && (
            <button
              type="button"
              className="cta report-analyze"
              disabled={!consent}
              onClick={() => void analyze({ kind: "text", text: text.trim() })}
            >
              {c.reportAnalyze}
              <Icon name="arrow" size={16} />
            </button>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error === "NOT_MEDICAL" ? c.reportNotMedical : errorText(error, lang)}
            </p>
          )}
          <div className="report-foot">
            <button type="button" className="text-button" onClick={() => setOpen(false)}>
              {c.reportSkip}
            </button>
          </div>
          <p className="field-help report-privacy">{c.reportPrivacy}</p>
        </>
      )}
    </section>
  );
}

async function downscale(file: File): Promise<string | null> {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    URL.revokeObjectURL(url);
    const long = Math.max(img.width, img.height),
      scale = Math.min(1, 1600 / long);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}
