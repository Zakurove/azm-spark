/**
 * S32 Camera denied, no camera, camera busy or stopped (map 2.9). Try again keeps the flow and reloads
 * the page, because iOS Safari asks again only after a reload; "later" leaves the check.
 */
import { detectPlatform, CameraProblemCard } from "../shared/states";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";

export function CameraProblem({ model, dispatch, retryCamera }: ScreenProps) {
  const s = model.state;
  const kind = s.kind === "cam.problem" ? s.problem : "denied";
  const platform =
    typeof navigator === "undefined"
      ? "other"
      : detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const guest = model.data.config.mode === "guest";
  return (
    <CheckShell>
      <CameraProblemCard
        kind={kind}
        platform={platform}
        onRetry={kind === "denied" ? retryCamera : () => dispatch({ type: "RETRY" })}
        onLater={() => dispatch({ type: "LATER" })}
        onDemo={guest ? () => dispatch({ type: "TRY_WORKOUT" }) : undefined}
      />
    </CheckShell>
  );
}
