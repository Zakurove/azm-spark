import { useRef, useState } from "react";
import { Lang } from "./i18n";
import { labels, errorText } from "./platform-copy";
import { api } from "./api";
import Icon from "./Icon";
import type { ReportRegion } from "../medical/body-map";

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
    /** v7: body map suggestions, only from a server with AZM_V7=1 (contract 2.2). */
    regions?: ReportRegion[];
  };
  missing: string[];
  questions: string[];
  summary: string;
  confidence: string;
}

/**
 * The body of POST /api/medical-report. Pressing «اقرأ تقريري» is the consent (booth v2, B8, option
 * A): every read carries reportConsent true, which the server still requires before it sends anything.
 */
export function reportRequest(
  body: { kind: "text"; text: string } | { kind: "image"; image: string },
  lang: Lang,
): Record<string, unknown> {
  return { ...body, lang, reportConsent: true };
}

/** Optional medical report reading of a fresh intake (C47): a secondary link «عندك تقرير طبي؟» under
 * the first questions opens the panel. One action, «اقرأ تقريري», reads a photo (or the pasted text),
 * with one plain line under it; the /privacy page keeps the processor details. The image is
 * downscaled on the phone; on any failure the form continues by hand, and skipping stays open. */
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
    [paste, setPaste] = useState(false),
    [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open)
    return (
      <button type="button" className="text-button report-open" onClick={() => setOpen(true)}>
        <Icon name="health" size={17} />
        {c.reportTitle}
      </button>
    );

  const read = async (body: { kind: "text"; text: string } | { kind: "image"; image: string }) => {
    setBusy(true);
    setError("");
    try {
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
    await read({ kind: "image", image });
  };

  return (
    <section className="report-upload" aria-label={c.reportTitle} aria-busy={busy}>
      <div className="report-heading">
        <span className="report-icon">
          <Icon name="health" size={19} />
        </span>
        <div>
          <h3>{c.reportTitle}</h3>
          <p>{c.reportBody}</p>
        </div>
      </div>
      {busy ? (
        <div className="report-busy" role="status">
          <span className="report-spinner" aria-hidden />
          {c.reportBusy}
        </div>
      ) : (
        <>
          {paste ? (
            <>
              <label className="field report-paste">
                <span>{c.reportPaste}</span>
                <textarea rows={4} maxLength={20000} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <div className="report-actions">
                <button
                  type="button"
                  className="report-read"
                  disabled={!text.trim()}
                  onClick={() => void read({ kind: "text", text: text.trim() })}
                >
                  <Icon name="spark" size={17} />
                  {c.reportRead}
                </button>
                <button type="button" className="text-button" onClick={() => setPaste(false)}>
                  {c.reportPhotoOpen}
                </button>
              </div>
            </>
          ) : (
            <div className="report-actions">
              <button type="button" className="report-read" onClick={() => fileRef.current?.click()}>
                <Icon name="camera" size={17} />
                {c.reportRead}
              </button>
              <button type="button" className="text-button" onClick={() => setPaste(true)}>
                {c.reportPasteOpen}
              </button>
            </div>
          )}
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
          <p className="report-notice">{c.reportNotice}</p>
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
