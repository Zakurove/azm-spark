/**
 * S54, /?example=progress (UX spec S54, D-008): a read only example for the booth and the landing,
 * rendered from the bundled fixture (example-fixture.json) and compared by the real rules, so it works
 * offline and never shows a verdict the rules would not give. Clearly labelled: the banner sits in
 * the sticky top bar area (never scrolls away, never dismissible) and is read first (the h1 that takes
 * focus is described by it), and every card carries the Example pill. Nothing is interactive except
 * the table toggles and the actions. Dates sit in a fixed past example year and show the year.
 */
import { useId, useMemo } from "react";
import type { Lang } from "../../app/i18n";
import { t } from "../../i18n";
import CheckIcon from "../assessment/shared/CheckIcon";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { CheckShell } from "../assessment/shared/CheckShell";
import { EXAMPLE_PERSON, exampleSessions, exampleViews } from "./example";
import { ResultsFooter } from "./ResultsPage";
import { seriesCards } from "./series";
import { SessionsBlock, sessionsOf } from "./Sessions";
import { SeriesCard } from "./ThenNow";
import "./progress.css";

export interface ExampleProgressProps {
  lang: Lang;
  onLanguage(): void;
  /** Booth mode or open home checks: "Try the movement check" is shown (S54). */
  canTryCheck: boolean;
  onTryCheck(): void;
  onRegister(): void;
}

const DATES = { year: true };

export function ExampleProgress({
  lang,
  onLanguage,
  canTryCheck,
  onTryCheck,
  onRegister,
}: ExampleProgressProps) {
  const bannerId = useId();
  const headingId = useId();
  const sessionsId = useId();
  const cards = useMemo(() => seriesCards(exampleViews(), EXAMPLE_PERSON), []);
  const sessions = useMemo(() => sessionsOf(exampleSessions()), []);
  const tag = t(lang, "progress.example.tag");
  const banner = (
    <section className="check-offline-wrap check-example-banner" role="region" aria-label={tag}>
      <p className="check-offline">
        <CheckIcon name="info" />
        <span id={bannerId}>{t(lang, "progress.example.banner")}</span>
      </p>
    </section>
  );
  const register = { label: t(lang, "progress.example.register"), onClick: onRegister };
  return (
    <CheckRoot ui={{ lang, onLanguage, screenKey: "S54" }}>
      <CheckShell
        brand
        exit={false}
        language
        notice={banner}
        footer={
          canTryCheck
            ? {
                primary: { label: t(lang, "progress.example.tryCheck"), onClick: onTryCheck },
                secondary: register,
              }
            : { primary: register }
        }
      >
        <h1 aria-describedby={bannerId}>{t(lang, "progress.example.title")}</h1>
        {!canTryCheck && <p className="check-body">{t(lang, "assessment.guest.boothOnly.title")}</p>}
        <section className="pg-section" data-screen="S54" aria-labelledby={headingId}>
          <h2 id={headingId}>{t(lang, "progress.checks.heading")}</h2>
          <ul className="pg-cards">
            {cards.map((c) => (
              <li key={c.key}>
                <SeriesCard
                  view={c.view}
                  earlier={c.earlier}
                  boothPoints={c.boothPoints}
                  example
                  dates={DATES}
                />
              </li>
            ))}
          </ul>
        </section>
        <section className="pg-section" aria-labelledby={sessionsId}>
          <h2 id={sessionsId}>{t(lang, "progress.sessions.heading")}</h2>
          <SessionsBlock data={sessions} year chips={<span className="pg-chip">{tag}</span>} />
        </section>
        <ResultsFooter />
      </CheckShell>
    </CheckRoot>
  );
}
