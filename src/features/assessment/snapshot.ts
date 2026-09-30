/**
 * The reload snapshot's key and the one question App.tsx asks before the check is loaded: whether a
 * snapshot of this mode waits (S32's reload reopens the signed in check). Kept apart from
 * useCheckFlow so the landing's first script does not carry the flow (acceptance F-4).
 */
import type { FlowConfig, FlowModel } from "./flowMachine";

export const SNAPSHOT_KEY = "azm.check.snapshot";

/** Whether a reload snapshot of this mode waits (App reopens the signed in check after S32's reload). */
export function hasSnapshot(mode: FlowConfig["mode"]): boolean {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY);
    return !!raw && (JSON.parse(raw) as FlowModel)?.data?.config?.mode === mode;
  } catch {
    return false;
  }
}
