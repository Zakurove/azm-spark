import "./guided.css";

/**
 * The picture of a library exercise on its guided card (booth v2, contract D): a line glyph of its
 * category on a soft orb, until the illustrated set arrives. `size` "card" is the large orb of a card
 * in a session; "row" is the small tile of the weekly plan.
 */
const GLYPHS: Record<string, React.ReactNode> = {
  // a dumbbell
  upper_body: <path d="M6.5 7.5v9M3.5 10v4M17.5 7.5v9M20.5 10v4M6.5 12h11" />,
  // the trunk with its centre
  core: (
    <>
      <path d="M8.2 4h7.6l1.7 7.2-1.7 8.8H8.2L6.5 11.2z" />
      <circle cx="12" cy="11.5" r="2.3" />
    </>
  ),
  // a gentle wave of movement
  flexibility: (
    <>
      <path d="M3 9.5c2-3.3 4-3.3 6 0s4 3.3 6 0 4-3.3 6 0" />
      <path d="M3 15.5c2-3.3 4-3.3 6 0s4 3.3 6 0 4-3.3 6 0" opacity="0.55" />
    </>
  ),
  // a seated leg, knee lifted
  lower_body: (
    <>
      <circle cx="8" cy="4.5" r="1.9" />
      <path d="M8 7.5v6h5.5l1.5 7M13.5 13.5l3.6-3.2M5 21h14" />
    </>
  ),
  // a level held steady
  balance: (
    <>
      <circle cx="12" cy="4.8" r="1.9" />
      <path d="M12 7.6V20M4.5 11.5h15M8.5 20.5h7M4.5 11.5 3 15.5h3zM19.5 11.5l-1.5 4h3z" />
    </>
  ),
};

export default function ExerciseArt({
  category,
  size = "card",
}: {
  category: string;
  size?: "card" | "row";
}) {
  return (
    <span className={`ex-art ex-art-${size}`} data-category={category} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={size === "card" ? 1.4 : 1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[category] ?? GLYPHS.flexibility}
      </svg>
    </span>
  );
}
