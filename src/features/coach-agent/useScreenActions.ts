/**
 * A screen's buttons for the live coach (D-036 item 2): while the screen shows, the buttons the coach
 * may press on the person's spoken words are registered in the host's ScreenActions, and taken away
 * when it goes. `entry.key` names the screen (a new key is a new screen for the answer guard), and
 * `entry.alive` says whether the app is still on it, so a press that arrives after the app moved on
 * presses nothing. The press functions are the latest render's, the very functions the visible buttons
 * call. The visible buttons keep working for touch whatever the coach does.
 */
import { useLayoutEffect, useRef } from "react";
import type { ScreenAction, ScreenActions } from "../../coach/actions";

/** The buttons of the screen showing now, or null when it has none the coach may press. */
export interface ScreenEntry {
  key: string;
  actions: readonly ScreenAction[];
  /** False once the app has moved past this screen (the step on the screen is no longer the host's). */
  alive?: () => boolean;
}

export function useScreenActions(
  registry: ScreenActions | null | undefined,
  entry: ScreenEntry | null,
): void {
  const latest = useRef(entry);
  latest.current = entry;
  const key = entry?.key ?? null;
  useLayoutEffect(() => {
    if (!registry || key === null) return;
    const mine = () => (latest.current?.key === key ? latest.current : null);
    return registry.show(
      key,
      () => mine()?.actions ?? [],
      () => {
        const e = mine();
        return !!e && (e.alive?.() ?? true);
      },
    );
  }, [registry, key]);
}
