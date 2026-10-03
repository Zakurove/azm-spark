/**
 * The booth journey's calls (contract C2 and C8), with this tab's booth pass: the report reading and
 * the program. Every call can fail or be slow, and the booth never waits on one: the caller has its
 * fallback (the cached reading of Saad's sample report, the rules' own week). Nothing is kept.
 */
import type { Lang } from "../../app/i18n";
import type { Intake, Plan } from "../../medical/plan";
import type { WeeklyPlan } from "../../medical/weekly";
import type { BoothExtraction } from "./story";

export type Answer<T> = { ok: true; value: T } | { ok: false; status: number };

async function post<T>(
  path: string,
  session: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Answer<T>> {
  try {
    const r = await fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Azm-Request": "1", "X-Azm-Booth": session },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, value: (await r.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** POST /api/booth/report: the photo read once by the same engine as at home. */
export function readReport(
  session: string,
  image: string,
  lang: Lang,
  signal?: AbortSignal,
): Promise<Answer<BoothExtraction>> {
  return post<BoothExtraction>("/booth/report", session, { session, kind: "image", image, lang }, signal);
}

/** POST /api/booth/plan: the plan and the weekly plan (the model with the rules fallback). */
export function fetchPlan(
  session: string,
  intake: Intake,
  signal?: AbortSignal,
): Promise<Answer<{ plan: Plan; weekly: WeeklyPlan | null }>> {
  return post("/booth/plan", session, { session, intake }, signal);
}

/** Whether a reading is a medical document the booth can show. */
export const readable = (x: BoothExtraction) =>
  x.document === "medical_report" || x.document === "other_medical_document";

/**
 * An image as a JPEG data URL at most `long` pixels on its long side (the photo and the sample
 * report): small enough to send, sharp enough to read.
 */
export async function imageData(src: string | File, long = 1600): Promise<string | null> {
  let url = "";
  try {
    url = typeof src === "string" ? src : URL.createObjectURL(src);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, long / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    return null;
  } finally {
    if (typeof src !== "string" && url) URL.revokeObjectURL(url);
  }
}

/** Resolves after `ms`, or at once when the signal aborts. */
export const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
