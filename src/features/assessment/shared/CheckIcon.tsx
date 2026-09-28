/**
 * Icons of the movement check (UX spec 5.1): the app's line style (24 px grid, stroke 1.6, round
 * caps, currentColor, aria-hidden), with the additions the check screens need, so the parallel
 * streams never edit src/app/Icon.tsx. The medical plus is not used on check screens.
 * Only arrows mirror under RTL; play, stop and the media glyphs never do.
 */
import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  "arrow-back": <path d="M15 5 8 12l7 7" />,
  "arrow-forward": <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v1" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6m0 3v.5" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v5m0 3v.5" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6m4-6v6" />
    </>
  ),
  "wifi-off": (
    <>
      <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7m4 .1A10 10 0 0 1 19 13M2 9.5A15 15 0 0 1 7 6.6m4-.6a15 15 0 0 1 11 3.5" />
      <path d="M12 20h.01" />
    </>
  ),
  speaker: (
    <>
      <path d="m11 4-6 5H2v6h3l6 5z" />
      <path d="M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" />
    </>
  ),
  "speaker-off": (
    <>
      <path d="m11 4-6 5H2v6h3l6 5z" />
      <path d="m16 9 6 6m0-6-6 6" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10 10.5a2 2 0 1 0 0 3m7-3a2 2 0 1 0 0 3" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <path d="m8 6 2-3h4l2 3" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  "phone-call": (
    <path d="M5 3h4l2 5-3 2a11 11 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z" />
  ),
  "phone-level": (
    <>
      <rect x="8" y="3" width="8" height="18" rx="2" />
      <path d="M3 12h3m12 0h3" />
    </>
  ),
  "phone-rotate": (
    <>
      <rect x="8" y="3" width="8" height="18" rx="2" />
      <path d="M4 8a9 9 0 0 0 0 8m16-8a9 9 0 0 1 0 8" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6m1-5.5c2.6.2 5 2 5 5.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  sleeve: <path d="M8 3h8l4 7-3 2-2-3v12H9V9l-2 3-3-2z" />,
  "hand-raise": (
    <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5m0-6.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V12m0-3a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.6L8 14" />
  ),
  "lean-left": (
    <>
      <circle cx="9" cy="5" r="2" />
      <path d="M10 8 13 15v6m0-6-6-3" />
    </>
  ),
  "lean-right": (
    <>
      <circle cx="15" cy="5" r="2" />
      <path d="M14 8 11 15v6m0-6 6-3" />
    </>
  ),
  "arm-side": (
    <>
      <circle cx="12" cy="4" r="2" />
      <path d="M12 7v8m0 0-3 6m3-6 3 6M12 9l8-3M12 9l-3 4" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zm4 4h3v3h-3z" />
    </>
  ),
  badge: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="m8.5 14-1.5 7 5-3 5 3-1.5-7" />
    </>
  ),
  equals: <path d="M5 9h14M5 15h14" />,
  "arrow-up": <path d="M12 20V4m-6 6 6-6 6 6" />,
  "arrow-down": <path d="M12 4v16m-6-6 6 6 6-6" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chime: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  heart: <path d="M12 20s-8-4.5-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.5-8 10-8 10z" />,
  bolt: <path d="m13 2-8 12h6l-1 8 9-13h-7z" />,
  faint: (
    <>
      <circle cx="12" cy="6" r="3" />
      <path d="M4 20c2-5 5-7 8-7s6 2 8 7M9 5.5l1 1m4-1-1 1" />
    </>
  ),
  breath: <path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7" />,
  fall: (
    <>
      <circle cx="17" cy="5" r="2" />
      <path d="M15 8 9 11l-4 1m10-4 1 6 4 3M9 11l-1 6-4 3" />
    </>
  ),
  "stop-square": <rect x="5" y="5" width="14" height="14" rx="2" />,
  play: <path d="m8 4 12 8-12 8z" />,
  spark: <path d="m13 2-8 12h6l-1 8 9-13h-7z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4m10-4v4M3 11h18" />
    </>
  ),
  chart: <path d="M4 20V4m0 16h16M8 16l4-5 3 3 5-7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
};

export type CheckIconName = keyof typeof PATHS;

/** Arrows point in the reading direction, so they mirror under RTL. */
const DIRECTIONAL = new Set(["arrow-back", "arrow-forward"]);

export default function CheckIcon({
  name,
  size = 24,
  label,
}: {
  name: string;
  size?: number;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      className={DIRECTIONAL.has(name) ? "check-icon-dir" : undefined}
      focusable="false"
    >
      {PATHS[name] ?? PATHS.info}
    </svg>
  );
}

export const CHECK_ICON_NAMES = Object.keys(PATHS);
