/**
 * Placeholder screen of the round 3 foundation. The parallel streams replace each stub in their
 * folder's index.ts with the real screen; until then the stub shows its title from the copy (or the
 * check data), inside the real shell, with Back where the flow allows it.
 *
 * The screen id chip is a development aid: it shows only in development and E2E builds, never in
 * production (a Latin "S01" is not copy).
 */
import type { ReactNode } from "react";
import type { Lang } from "../../../app/i18n";
import { bidiText } from "../../../i18n/rich";
import { backTarget, type FlowModel } from "../flowMachine";
import type { ScreenComponent, ScreenProps } from "../screenTypes";
import { CheckShell } from "./CheckShell";
import { useCheckUi } from "./CheckUi";

export interface StubOptions {
  /** The full wordmark in the content header (S05, S12, S14, S50 to S54). */
  brand?: boolean;
  /** Hide Exit (safety screens). */
  noExit?: boolean;
}

/** Development and E2E builds show the screen id chip; production never does. */
export const SHOW_SCREEN_IDS = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";

/**
 * Screens that play a line (3.0 caption slot: entry and intro cues, the sound check, Listen on the
 * questions and warnings, the helper briefing, spoken instruction cards, the camera primer, postpone,
 * paused and safety screens, the stop list and check in, the rest and skip lines, the answer zone
 * questions, the results' check_done). Only these carry the Sound control.
 */
export const SOUND_SCREENS: ReadonlySet<string> = new Set([
  "S14",
  "S14b",
  "S16",
  "S17",
  "S18",
  "S19",
  "S20",
  "S21",
  "S22",
  "S23",
  "S24",
  "S25",
  "S26",
  "S28",
  "S29",
  "S31",
  "S33",
  "S35",
  "S36",
  "S37",
  "S38",
  "S38b",
  "S39",
  "S40a",
  "S40b",
  "S41",
  "S42",
  "S43",
  "S44",
  "S45",
  "S46",
  "S47",
  "S48",
  "S49",
  "S50",
  "S51",
  "S52",
]);

/** The entry screens that carry the language switch (UX spec wireframes). */
export const LANGUAGE_SCREENS: ReadonlySet<string> = new Set(["S05", "S05b", "S12", "S14", "S54", "S55"]);

/** The screen id chip of a stub (development and E2E builds only). */
export function ScreenIdChip({ id }: { id: string }) {
  if (!SHOW_SCREEN_IDS) return null;
  return (
    <span className="check-chip check-stub-id" lang="en" dir="ltr">
      {id}
    </span>
  );
}

export function ScreenStubView({
  id,
  title,
  brand,
  exit = true,
  onBack,
  notice,
  describedBy,
}: {
  id: string;
  title: string;
  brand?: boolean;
  exit?: boolean;
  onBack?: () => void;
  /** A notice kept in the sticky top bar area (S54 example banner). */
  notice?: ReactNode;
  /** Ids that describe the h1 (read with it when focus moves to it on load). */
  describedBy?: string;
}) {
  const { lang } = useCheckUi();
  return (
    <CheckShell
      brand={brand}
      exit={exit}
      onBack={onBack}
      sound={SOUND_SCREENS.has(id)}
      language={LANGUAGE_SCREENS.has(id)}
      notice={notice}
    >
      <div className="check-stub" data-screen={id}>
        <h1 aria-describedby={describedBy}>{bidiText(lang, title)}</h1>
        <ScreenIdChip id={id} />
      </div>
    </CheckShell>
  );
}

/** A stub screen whose title comes from the copy or the check data for the current state. */
export function stub(
  id: string,
  titleOf: (lang: Lang, model: FlowModel) => string,
  opts: StubOptions = {},
): ScreenComponent {
  function Stub({ model, dispatch }: ScreenProps) {
    const { lang } = useCheckUi();
    const back = backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
    return (
      <ScreenStubView
        id={id}
        title={titleOf(lang, model)}
        brand={opts.brand}
        exit={!opts.noExit}
        onBack={back}
      />
    );
  }
  Stub.displayName = `Stub${id}`;
  return Stub;
}
