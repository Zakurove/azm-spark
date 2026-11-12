/** D-041: the company page's drawings, inline SVG in the logo's colours (no image files, no text). */
const INK = "#231F20";
const PURPLE = "#6F57AA";
const GOLD = "#F9C022";

/** The hero: a phone whose app opens into an augmented reality cube standing on a real floor. */
export function HeroArt() {
  return (
    <svg className="co-art co-art-hero" viewBox="0 0 520 470" role="img" aria-hidden>
      <defs>
        <linearGradient id="coScreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f6f3fc" />
        </linearGradient>
        <linearGradient id="coBeam" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={PURPLE} stopOpacity="0.28" />
          <stop offset="1" stopColor={PURPLE} stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="260" cy="230" r="205" fill={PURPLE} opacity="0.07" />
      <circle cx="260" cy="230" r="150" fill={GOLD} opacity="0.08" />
      {/* The real floor the camera found: an ellipse with its grid. */}
      <g opacity="0.55" stroke={PURPLE} strokeWidth="1.2" fill="none">
        <ellipse cx="300" cy="402" rx="190" ry="44" strokeDasharray="5 6" />
        <ellipse cx="300" cy="402" rx="120" ry="27" strokeDasharray="4 6" />
        <path d="M110 402h380M300 358v88M175 377l250 50M175 427l250-50" strokeDasharray="3 7" />
      </g>
      {/* The phone. */}
      <g transform="rotate(-8 190 250)">
        <rect x="95" y="70" width="190" height="352" rx="34" fill={INK} />
        <rect x="107" y="82" width="166" height="328" rx="24" fill="url(#coScreen)" />
        <rect x="160" y="91" width="60" height="9" rx="4.5" fill={INK} />
        <rect x="122" y="118" width="88" height="10" rx="5" fill={INK} opacity="0.85" />
        <rect x="122" y="136" width="56" height="7" rx="3.5" fill={INK} opacity="0.25" />
        <rect x="122" y="160" width="136" height="88" rx="16" fill={PURPLE} />
        <circle cx="146" cy="186" r="11" fill={GOLD} />
        <rect x="164" y="180" width="70" height="8" rx="4" fill="#fff" opacity="0.9" />
        <rect x="136" y="214" width="96" height="7" rx="3.5" fill="#fff" opacity="0.55" />
        <rect x="136" y="228" width="64" height="7" rx="3.5" fill="#fff" opacity="0.4" />
        {[264, 300, 336].map((y, i) => (
          <g key={y}>
            <rect x="122" y={y} width="136" height="26" rx="10" fill="#fff" stroke="#ebe6f6" />
            <circle cx="138" cy={y + 13} r="6" fill={i === 1 ? GOLD : PURPLE} opacity={i === 1 ? 1 : 0.35} />
            <rect x="152" y={y + 9} width={i === 2 ? 60 : 80} height="7" rx="3.5" fill={INK} opacity="0.3" />
          </g>
        ))}
        <rect x="122" y="374" width="136" height="24" rx="12" fill={GOLD} />
      </g>
      {/* The beam from the screen to the object. */}
      <path d="M262 150 L410 120 L410 300 L262 330 Z" fill="url(#coBeam)" opacity="0.8" />
      <path
        d="M268 160 L392 228M268 320 L392 260"
        stroke={PURPLE}
        strokeWidth="1.4"
        strokeDasharray="4 5"
        opacity="0.6"
      />
      {/* The augmented reality cube on the floor. */}
      <g transform="translate(395 232)">
        <ellipse cx="0" cy="166" rx="66" ry="14" fill={INK} opacity="0.14" />
        <path d="M-62 62 L0 94 L0 166 L-62 134 Z" fill={PURPLE} />
        <path d="M0 94 L62 62 L62 134 L0 166 Z" fill="#5a4594" />
        <path d="M0 30 L62 62 L0 94 L-62 62 Z" fill="#9a87d0" />
        <path
          d="M-62 62 L0 94 L62 62 M0 94 L0 166"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
        <circle cx="0" cy="62" r="7" fill={GOLD} />
      </g>
      {/* The anchor ring where the object stands. */}
      <g transform="translate(395 396)" fill="none" stroke={GOLD} strokeWidth="2.4">
        <ellipse rx="78" ry="17" opacity="0.9" />
        <ellipse rx="96" ry="22" opacity="0.35" />
      </g>
      {/* Sparks. */}
      <circle cx="455" cy="150" r="9" fill={GOLD} />
      <circle cx="80" cy="120" r="6" fill={GOLD} opacity="0.8" />
      <circle cx="470" cy="330" r="5" fill={PURPLE} opacity="0.6" />
      <path d="M350 92l5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill={PURPLE} opacity="0.7" />
    </svg>
  );
}

/** Mobile apps: three screens of one app, side by side. */
export function AppsArt() {
  const screen = (x: number, tilt: number, accent: string, i: number) => (
    <g transform={`rotate(${tilt} ${x + 55} 120)`} key={i}>
      <rect x={x} y="22" width="110" height="200" rx="20" fill={INK} />
      <rect x={x + 7} y="29" width="96" height="186" rx="14" fill="#fff" />
      <rect x={x + 18} y="44" width="50" height="7" rx="3.5" fill={INK} opacity="0.75" />
      <rect x={x + 18} y="60" width="74" height="54" rx="10" fill={accent} opacity={i === 1 ? 1 : 0.85} />
      <rect x={x + 18} y="124" width="74" height="16" rx="6" fill="#f1edf9" />
      <rect x={x + 18} y="146" width="74" height="16" rx="6" fill="#f1edf9" />
      <rect x={x + 18} y="186" width="74" height="16" rx="8" fill={GOLD} />
    </g>
  );
  return (
    <svg className="co-art" viewBox="0 0 360 250" role="img" aria-hidden>
      <circle cx="180" cy="125" r="112" fill={PURPLE} opacity="0.07" />
      {screen(28, -9, "#8f7bc7", 0)}
      {screen(222, 9, "#8f7bc7", 2)}
      {screen(125, 0, PURPLE, 1)}
      <circle cx="320" cy="40" r="8" fill={GOLD} />
    </svg>
  );
}

/** Augmented reality: a phone sees a chair that is not there, placed on the real floor. */
export function ArArt() {
  return (
    <svg className="co-art" viewBox="0 0 360 250" role="img" aria-hidden>
      <circle cx="180" cy="125" r="112" fill={GOLD} opacity="0.1" />
      <g stroke={PURPLE} strokeWidth="1.2" fill="none" opacity="0.5">
        <ellipse cx="225" cy="208" rx="120" ry="26" strokeDasharray="4 6" />
        <path d="M105 208h240M225 182v52" strokeDasharray="3 6" />
      </g>
      {/* The chair, drawn as the phone shows it. */}
      <g transform="translate(232 112)">
        <ellipse cx="0" cy="98" rx="52" ry="10" fill={INK} opacity="0.12" />
        <rect x="-40" y="-36" width="64" height="64" rx="12" fill={PURPLE} />
        <rect x="-46" y="22" width="88" height="22" rx="10" fill="#8f7bc7" />
        <rect x="-38" y="44" width="8" height="52" rx="4" fill={INK} />
        <rect x="26" y="44" width="8" height="52" rx="4" fill={INK} />
        <path
          d="M-58 -50h22M-58 -50v22M50 -50h-22M50 -50v22M-58 108h22M-58 108v-22M50 108h-22M50 108v-22"
          stroke={GOLD}
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
      </g>
      {/* The phone that places it. */}
      <g transform="rotate(-10 78 130)">
        <rect x="30" y="40" width="96" height="176" rx="18" fill={INK} />
        <rect x="37" y="47" width="82" height="162" rx="12" fill="#f6f3fc" />
        <rect x="58" y="104" width="34" height="34" rx="7" fill={PURPLE} opacity="0.85" />
        <path
          d="M50 92h10M50 92v10M100 92h-10M100 92v10M50 150h10M50 150v-10M100 150h-10M100 150v-10"
          stroke={GOLD}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="78" cy="190" r="10" fill="#fff" stroke={INK} strokeOpacity="0.2" />
      </g>
      <path
        d="M128 120 Q170 100 186 108"
        stroke={PURPLE}
        strokeWidth="1.6"
        strokeDasharray="4 5"
        fill="none"
      />
      <circle cx="318" cy="46" r="7" fill={GOLD} />
    </svg>
  );
}

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Line icons of the use cases, the steps and the reasons (24 by 24). */
export const ICONS = {
  scan: icon(
    "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10",
  ),
  cube: icon("M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 0 8-4.5M12 12 4 7.5"),
  hand: icon(
    "M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L4 15.5a1.6 1.6 0 0 1 2.4-2.1L9 15",
  ),
  bag: icon("M5 8h14l-1 12H6L5 8Zm4 0V6.5a3 3 0 0 1 6 0V8"),
  cap: icon("M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Zm4 2.2V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.8M21.5 9v5"),
  home: icon("M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5"),
  spark: icon("M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"),
  pulse: icon("M3 12h4l2-5 4 10 2-5h6"),
  landmark: icon("M3 20h18M5 20v-8M9.5 20v-8M14.5 20v-8M19 20v-8M2.5 10 12 4l9.5 6H2.5Z"),
  chat: icon("M4 5h16v11H9l-5 4V5Zm4 5h8"),
  pen: icon("M4 20l4-1 11-11-3-3L5 16l-1 4Zm10-13 3 3"),
  code: icon("M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"),
  rocket: icon(
    "M12 15l-3-3c1.5-4.5 4.5-7.5 10-8-.5 5.5-3.5 8.5-8 10Zm-3-3H5l2.5-3.5H11M12 15v4l3.5-2.5V13M6.5 17.5 5 19",
  ),
  globe: icon(
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9Z",
  ),
  eye: icon(
    "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  ),
  shield: icon("M12 3 19.5 6v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6L12 3Zm-3.5 9 2.5 2.5 4.5-5"),
  mail: icon("M3.5 6h17v12h-17V6Zm0 0 8.5 7 8.5-7"),
} as const;
