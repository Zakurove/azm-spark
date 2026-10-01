/**
 * S54, /?example=progress (UX spec S54, D-008, C37): a read only example for the booth and the
 * landing, rendered from the bundled fixture (example-fixture.json) and compared by the real rules, so
 * it works offline and never shows a verdict the rules would not give. One labelled card: one test,
 * start and now, the verdict in words; at the booth, the sign up QR for the visitor's own phone (away
 * from the booth the page is already on the person's phone, R-13). The banner
 * sits in the sticky top bar area (never scrolls away, never dismissible) and is read first (the h1
 * that takes focus is described by it). Dates sit in a fixed past example year and show the year.
 */
import { useId, useMemo } from "react";
import type { Lang } from "../../app/i18n";
import { t } from "../../i18n";
import { registerLink } from "../assessment/results/ResultsView";
import CheckIcon from "../assessment/shared/CheckIcon";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { CheckShell } from "../assessment/shared/CheckShell";
import { QrCode } from "../assessment/shared/QrCode";
import { EXAMPLE_PERSON, exampleViews } from "./example";
import { ResultsFooter } from "./ResultsPage";
import { seriesCards } from "./series";
import { SeriesCard } from "./ThenNow";
import "./progress.css";
import "../assessment/results/results.css";

export interface ExampleProgressProps {
  lang: Lang;
  onLanguage(): void;
  /** Booth mode or open home checks: "Try the movement check" is shown (S54). */
  canTryCheck: boolean;
  /** Booth mode: the sign up QR for the visitor's own phone. */
  booth: boolean;
  onTryCheck(): void;
  onRegister(): void;
}

const DATES = { year: true };

export function ExampleProgress({
  lang,
  onLanguage,
  canTryCheck,
  booth,
  onTryCheck,
  onRegister,
}: ExampleProgressProps) {
  const bannerId = useId();
  const card = useMemo(() => seriesCards(exampleViews(), EXAMPLE_PERSON)[0], []);
  const link = registerLink(typeof location === "undefined" ? "https://azm.invalid" : location.origin);
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
        <section className="pg-section" data-screen="S54">
          {card && <SeriesCard view={card.view} example dates={DATES} />}
        </section>
        {booth && (
          <section className="check-card is-info rs-keep">
            <div className="rs-qr">
              <QrCode text={link.url} label={t(lang, "assessment.guest.qrAlt")} showText />
              <p className="check-body">{t(lang, "assessment.guest.scan")}</p>
            </div>
          </section>
        )}
        <ResultsFooter />
      </CheckShell>
    </CheckRoot>
  );
}
