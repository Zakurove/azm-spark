/**
 * Line glyphs for the 13 para sports and the four goals (booth v2, B3). They are placeholders until
 * the illustrated sport set arrives: a sport whose icon in sports.ts starts with "/" is drawn from that
 * image instead, so the set replaces these without a code change.
 */
const GLYPHS: Record<string, React.ReactNode> = {
  // The goals.
  mobility: (
    <path d="M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1M18 3.5v3.7h-3.7M6 20.5v-3.7h3.7" />
  ),
  strength: <path d="M6.5 7.5v9M3.5 10v4M17.5 7.5v9M20.5 10v4M6.5 12h11" />,
  habit: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="3.5" />
      <path d="M8.5 3v4M15.5 3v4M4 10h16M9.3 15l1.9 1.9 3.7-3.8" />
    </>
  ),
  sport: (
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5.2A3 3 0 0 0 8 10M16 6h2.8A3 3 0 0 1 16 10M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z" />
  ),
  // The sports.
  wheelchair_basketball: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4v16M6.6 6.2c2.9 3.1 2.9 8.5 0 11.6M17.4 6.2c-2.9 3.1-2.9 8.5 0 11.6" />
    </>
  ),
  para_athletics: (
    <>
      <circle cx="9" cy="14" r="5.5" />
      <circle cx="9" cy="14" r="1.3" />
      <circle cx="20" cy="17.5" r="1.8" />
      <path d="M14.4 15.2 18.4 17M11 8.6l3.2-4.1h3" />
    </>
  ),
  para_powerlifting: <path d="M2.5 12h19M6 7.5v9M8.8 6v12M15.2 6v12M18 7.5v9" />,
  boccia: (
    <>
      <circle cx="8" cy="15" r="4.5" />
      <circle cx="17.2" cy="13.8" r="3.3" />
      <circle cx="13.2" cy="6.4" r="1.7" />
    </>
  ),
  wheelchair_tennis: (
    <>
      <ellipse cx="9.5" cy="9.5" rx="5" ry="6" transform="rotate(-45 9.5 9.5)" />
      <path d="m13.4 13.4 6.6 6.6M6.6 9.6l5.8-.2M9.6 6.6l-.2 5.8" />
      <circle cx="19" cy="5" r="1.8" />
    </>
  ),
  para_table_tennis: (
    <>
      <circle cx="10" cy="10" r="6.2" />
      <path d="m14.2 14.6 4.4 4.4a1.5 1.5 0 0 0 2.1-2.1l-4.4-4.4" />
      <circle cx="19.5" cy="5" r="1.6" />
    </>
  ),
  sitting_volleyball: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4c-1.3 3.7-.4 6.9 2.9 9.1M4.5 9.4c3.9-.7 7 .6 8.5 3.3M8 18.9c.7-3.6 3-5.8 7.3-6.4M14.9 13.1 19.4 15" />
    </>
  ),
  para_swimming: (
    <>
      <circle cx="16.5" cy="6.5" r="2" />
      <path d="M3 15.5c1.8-1.3 3.7-1.3 5.5 0s3.7 1.3 5.5 0 3.7-1.3 5.5 0M3 19.5c1.8-1.3 3.7-1.3 5.5 0s3.7 1.3 5.5 0 3.7-1.3 5.5 0M5.5 12.5l5-4 4.5 3" />
    </>
  ),
  para_archery: (
    <>
      <circle cx="11" cy="13" r="7.5" />
      <circle cx="11" cy="13" r="4" />
      <circle cx="11" cy="13" r="0.8" />
      <path d="m11 13 9-9M16.5 3.8H20v3.5" />
    </>
  ),
  handcycling: (
    <>
      <circle cx="6" cy="16" r="4" />
      <circle cx="18" cy="16" r="4" />
      <path d="M6 16 10 9.5h4.5L18 16M14.5 9.5 13.6 6h3" />
    </>
  ),
  wheelchair_fencing: (
    <path d="M4 20 18.5 5.5M18.5 5.5l1.7-1.7M6.2 14.6l3.2 3.2M20 20 5.5 5.5M5.5 5.5 3.8 3.8M17.8 14.6l-3.2 3.2" />
  ),
  wheelchair_rugby: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 4v6M12 14v6M4 12h6M14 12h6M6.3 6.3l4.3 4.3M13.4 13.4l4.3 4.3" />
    </>
  ),
  para_badminton: (
    <path d="M12 20.5a2.6 2.6 0 0 0 2.6-2.6H9.4a2.6 2.6 0 0 0 2.6 2.6zM9.4 17.9 6.2 5M14.6 17.9 17.8 5M12 17.9V4M6.2 5c3.9 1.2 7.7 1.2 11.6 0M7.5 11h9" />
  ),
};

export default function SportIcon({ icon, size = 28 }: { icon: string; size?: number }) {
  if (icon.startsWith("/"))
    return <img src={icon} width={size} height={size} alt="" aria-hidden="true" className="sport-icon-img" />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[icon] ?? GLYPHS.sport}
    </svg>
  );
}
