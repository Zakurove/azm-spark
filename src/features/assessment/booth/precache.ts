/**
 * Booth phones work offline (council O18, UX spec S55, 0.7): when booth mode turns on, the phone keeps
 * the pose model, the check's cue files in both languages, the alarm and the chime in a named cache.
 *
 * "This phone is ready to work offline" (booth.offlineReady) is shown only when it is true: every
 * file is in the cache AND a service worker controls the page, so a reload without a connection can
 * still open the app and serve those files. Without both, staff are never told the phone is ready;
 * the preparing line shows only while the files are fetched.
 */
// SPEC-GAP: booth-offline-service-worker. The app has no service worker yet, and the alarm and chime
// files (Appendix B) and the check cue recordings (O24) do not exist yet, so booth.offlineReady never
// shows until they land; the files that exist are kept in the cache meanwhile.
import voiceScript from "../../../app/voice-script.json";

export const BOOTH_CACHE = "azm-booth-v1";

/** Phones take the lite model (src/app/poseSource.ts, coarse pointer). */
const MODEL = "/models/pose_landmarker_lite.task";
const WASM = ["/wasm/vision_wasm_internal.js", "/wasm/vision_wasm_internal.wasm"];
/** Appendix B: the alarm (S45) and the check in chime (S43, S47, S48). */
const TONES = ["/cues/alarm.mp3", "/cues/chime.mp3"];

/** Every file a booth phone needs offline (O18): model, runtime, check cues in ar and en, tones. */
export function boothAssets(): string[] {
  const cues = Object.keys(voiceScript).filter((id) => id.startsWith("check_") || id.startsWith("test_"));
  const perLang = (lang: "ar" | "en") => cues.map((id) => `/cues/${lang}/${id}.mp3`);
  return [MODEL, ...WASM, ...TONES, ...perLang("ar"), ...perLang("en")];
}

export interface PrecacheResult {
  cached: string[];
  missing: string[];
}

export interface PrecacheDeps {
  fetch: typeof fetch;
  caches: CacheStorage;
  assets?: string[];
  /** Files fetched at the same time. */
  parallel?: number;
}

/** Puts every booth file in the cache (files already there are kept); reports what is missing. */
export async function precacheBooth(deps: PrecacheDeps): Promise<PrecacheResult> {
  const assets = deps.assets ?? boothAssets();
  const cache = await deps.caches.open(BOOTH_CACHE);
  const cached: string[] = [];
  const missing: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < assets.length) {
      const url = assets[next++];
      try {
        if (await cache.match(url)) {
          cached.push(url);
          continue;
        }
        const res = await deps.fetch(url, { cache: "reload" });
        if (!res.ok) {
          missing.push(url);
          continue;
        }
        await cache.put(url, res);
        cached.push(url);
      } catch {
        missing.push(url);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, deps.parallel ?? 4) }, worker));
  return { cached, missing };
}

export type OfflineStatus = "preparing" | "ready" | "notReady";

/** Ready only with every file cached and a service worker in control (see the file comment). */
export function offlineStatus(result: PrecacheResult | null, serviceWorkerControls: boolean): OfflineStatus {
  if (!result) return "preparing";
  return result.missing.length === 0 && serviceWorkerControls ? "ready" : "notReady";
}
