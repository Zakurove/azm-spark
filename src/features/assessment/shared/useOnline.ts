/**
 * Online state for the offline banner (UX spec 0.7): navigator.onLine, the online and offline events,
 * and any request that fails with a network error (reported by api.ts through reportNetwork).
 * The banner appears within a second; going back online shows a short "You are back online" toast.
 */
import { useEffect, useState } from "react";

type Listener = (online: boolean) => void;
const listeners = new Set<Listener>();
let failedRequest = false;

/** api.ts calls this after a network error (false) or any server answer (true). */
export function reportNetwork(reachable: boolean): void {
  if (failedRequest === !reachable) return;
  failedRequest = !reachable;
  for (const l of listeners) l(currentOnline());
}

function currentOnline(): boolean {
  const nav = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  return nav && !failedRequest;
}

/** Pure rule of the banner: offline when the browser says so or the last request failed. */
export function onlineState(navigatorOnline: boolean, lastRequestFailed: boolean): boolean {
  return navigatorOnline && !lastRequestFailed;
}

export function useOnline(): { online: boolean; backOnline: boolean } {
  const [online, setOnline] = useState(currentOnline);
  const [backOnline, setBackOnline] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (next: boolean) =>
      setOnline((prev) => {
        if (!prev && next) {
          setBackOnline(true);
          clearTimeout(timer);
          timer = setTimeout(() => setBackOnline(false), 3000);
        }
        return next;
      });
    const onOnline = () => {
      failedRequest = false;
      update(currentOnline());
    };
    const onOffline = () => update(false);
    listeners.add(update);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      listeners.delete(update);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearTimeout(timer);
    };
  }, []);
  return { online, backOnline };
}
