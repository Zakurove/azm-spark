/**
 * S31 Camera primer (home only) and the permission requests it shares with the booth staff screen.
 *
 * S31 asks for the camera once per check at home, with one privacy line and the button (C08); on iOS
 * the same tap asks for motion (the tap is the gesture iOS needs for
 * DeviceOrientationEvent.requestPermission and for audio). The tap asks for the camera, closes the
 * stream again at once (the camera screens open their own), asks for motion where the browser needs
 * it, keeps the screen awake, then goes on to the camera screens. A refused, missing or busy camera
 * opens S32. At the booth staff allow the camera and motion on S55 when they turn booth mode on.
 */
import { useState } from "react";
import { t } from "../../../i18n";
import { backTarget, testCounter } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { cameraProblemOf } from "./copy";
import { unlockAudio } from "./voice";

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/** iOS asks for motion access separately (DeviceOrientationEvent.requestPermission). */
export function needsMotionPermission(): boolean {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return false;
  const doe = (window as unknown as { DeviceOrientationEvent: OrientationPermission }).DeviceOrientationEvent;
  return typeof doe.requestPermission === "function";
}

/** In E2E builds a fixture pose source needs no camera (contract v3 K). */
function fixtureCamera(): boolean {
  if (import.meta.env.VITE_E2E !== "1" || typeof location === "undefined") return false;
  return new URLSearchParams(location.search).has("e2eFixture");
}

/**
 * The permission requests of the primer's tap, in order: camera (closed again at once), motion on iOS
 * (a refusal is not an error here: S34c handles it), the wake lock. Throws the camera error.
 */
export async function askCamera(): Promise<void> {
  if (fixtureCamera()) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error("no camera");
    e.name = "NotFoundError";
    throw e;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  for (const track of stream.getTracks()) track.stop();
  if (needsMotionPermission()) {
    const doe = (window as unknown as { DeviceOrientationEvent: OrientationPermission })
      .DeviceOrientationEvent;
    await doe.requestPermission?.().catch(() => "denied");
  }
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };
    await nav.wakeLock?.request("screen");
  } catch {
    /* not supported or refused: the screen may dim, nothing else changes */
  }
}

export function CameraPrimer({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const [busy, setBusy] = useState(false);
  const c = testCounter(model);
  const allow = async () => {
    if (busy) return;
    unlockAudio();
    setBusy(true);
    try {
      await askCamera();
      dispatch({ type: "PREP_NEXT" });
    } catch (e) {
      dispatch({ type: "CAMERA_ERROR", problem: cameraProblemOf(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <CheckShell
      counter={
        c
          ? {
              text: t(lang, "assessment.common.testOf", { n: c.n, total: c.total }),
              value: c.n,
              max: c.total,
            }
          : undefined
      }
      onBack={backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined}
      footer={{ primary: { label: t(lang, "assessment.primer.allow"), onClick: () => void allow(), busy } }}
    >
      <div className="flow-stack" data-screen="S31">
        <h1>{t(lang, "assessment.primer.title")}</h1>
        <p className="check-body">{t(lang, "assessment.primer.body")}</p>
        {busy && (
          <p className="check-meta" role="status">
            {t(lang, "assessment.state.loading.camera")}
          </p>
        )}
      </div>
    </CheckShell>
  );
}
