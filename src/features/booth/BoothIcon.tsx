/**
 * Line glyphs of the booth journey: one stroke weight, round ends, currentColor, drawn on a 24 grid
 * like the portal's Icon.tsx. Directional glyphs (arrows) mirror in RTL.
 */
const GLYPHS: Record<string, React.ReactNode> = {
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  menu: (
    <>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </>
  ),
  close: <path d="m6.5 6.5 11 11m0 -11-11 11" />,
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  cross: <path d="m7 7 10 10M17 7 7 17" />,
  adapt: (
    <>
      <path d="M4 7h9m4 0h3M4 17h3m4 0h9" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" />
      <path d="M14 3.5V8h4M9.5 12h5M9.5 15.5h5" />
    </>
  ),
  spark: <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7-5.6-1.9L10.1 9zM18.5 3.5v3m-1.5-1.5h3" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c.7-3.7 3.4-5.8 7-5.8s6.3 2.1 7 5.8" />
    </>
  ),
  spine: <path d="M12 3v18M9 5.5h6M8.5 9h7M8.5 12.5h7M9 16h6M9.5 19.2h5" />,
  wheelchair: (
    <>
      <circle cx="10" cy="5" r="1.8" />
      <path d="M10 8v6h5.5l2.5 5M7.5 10.5a6 6 0 1 0 8 7.4" />
    </>
  ),
  pain: <path d="M13 3 6 13.5h5.2L10 21l7.5-10.8h-5.3z" />,
  shield: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  pill: (
    <>
      <rect x="3.6" y="8.6" width="16.8" height="6.8" rx="3.4" transform="rotate(-38 12 12)" />
      <path d="m9.9 9.4 4.2 5.2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="12.8" r="3.4" />
    </>
  ),
  reset: <path d="M5 12a7 7 0 1 0 2.2-5.1M5 4.5v3.8h3.8" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  heart: (
    <path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10z" />
  ),
  phone: (
    <path d="M6.5 3.5h3l1.5 4-2 1.3a10.5 10.5 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />
  ),
  power: <path d="M12 3.5v8M7.2 6.2a7.5 7.5 0 1 0 9.6 0" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </>
  ),
  up: <path d="M5 16 10 11l3.5 3.5L19 9m0 0h-4.5M19 9v4.5" />,
};

const DIRECTIONAL = new Set(["arrow", "back", "up"]);

export default function BoothIcon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={DIRECTIONAL.has(name) ? "bx-icon bx-icon-dir" : "bx-icon"}
    >
      {GLYPHS[name] ?? GLYPHS.spark}
    </svg>
  );
}
