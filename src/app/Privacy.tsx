/**
 * The privacy notice (council Q32 (1), H5): in plain words, the company responsible for the data, the
 * purposes, what is kept (the 2.1 data map), what is never kept, where it is stored, who receives it,
 * how long it is kept, the rights and how to use them. Opened with /?privacy=1, linked from the
 * landing footer, the sign up screen and the medical report consent.
 */
import type { ReactNode } from "react";
import type { Lang } from "./i18n";
import Brand from "./Brand";
import { t, type I18nKey } from "../i18n";
import { bidiText, tx } from "../i18n/rich";
import { CHECK_DATA } from "../movements/assessments";
import { V7_UI } from "./v7flag";

/**
 * v7 (D-024 item 5, A5-14 with A2-14): the focus check's purpose and what it keeps, beside the
 * movement check's lines. A v7 intake adds sex, height and the body map; the focus check keeps range
 * and walking results as numbers, one step as skeleton lines, and of the day's answers the pain score
 * per area and whether a helper was there. A default build shows neither line.
 */
const FOCUS_PURPOSES: I18nKey[] = V7_UI ? ["privacy.purposes.focus"] : [];
const FOCUS_KEPT: I18nKey[] = V7_UI ? ["privacy.kept.focus"] : [];

/**
 * The company responsible for the data and the contact for rights requests (Q32 (1), (4)).
 */
// SPEC-GAP: privacy-controller. Q32 (1) names "the legal entity that owns Azm" as controller and a
// contact email, and Q32 (4) a named privacy lead; Nasser names them before the Oct 9 freeze (owner
// actions, item 10). Until then the page names Gymwise.ai, the company the repository names, and asks
// people to make rights requests to the Azm team; set `email` and the page shows it instead.
export const PRIVACY_OWNER: { controller: string; email: string | null } = {
  controller: "Gymwise.ai",
  email: null,
};

/** The link to the notice, keeping the language (privacyHref.ts). */
export { privacyHref } from "./privacyHref";

function Section({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return (
    <section className="privacy-section">
      <h2>{heading}</h2>
      {children}
    </section>
  );
}

export default function Privacy({
  lang,
  onLanguage,
  onBack,
}: {
  lang: Lang;
  onLanguage(): void;
  onBack(): void;
}) {
  const list = (keys: I18nKey[]) => (
    <ul>
      {keys.map((k) => (
        <li key={k}>{tx(lang, k)}</li>
      ))}
    </ul>
  );
  const email = PRIVACY_OWNER.email;
  return (
    <div className="privacy-page">
      <header className="portal-header">
        <button type="button" className="brand-link" onClick={onBack} aria-label={t(lang, "privacy.back")}>
          <Brand />
        </button>
        <div className="landing-header-actions">
          <button type="button" className="text-button" onClick={onBack}>
            {t(lang, "privacy.back")}
          </button>
          <button type="button" className="language" onClick={onLanguage}>
            {lang === "ar" ? "English" : "العربية"}
          </button>
        </div>
      </header>
      <main className="privacy-main">
        <h1>{t(lang, "privacy.title")}</h1>
        <p>{tx(lang, "privacy.intro")}</p>
        <Section heading={t(lang, "privacy.controller.heading")}>
          <p>{tx(lang, "privacy.controller.body", { controller: PRIVACY_OWNER.controller })}</p>
        </Section>
        <Section heading={t(lang, "privacy.purposes.heading")}>
          {list([
            "privacy.purposes.plan",
            "privacy.purposes.check",
            ...FOCUS_PURPOSES,
            "privacy.purposes.sessions",
            "privacy.purposes.safety",
          ])}
        </Section>
        <Section heading={t(lang, "privacy.kept.heading")}>
          {list([
            "privacy.kept.account",
            "privacy.kept.profile",
            "privacy.kept.check",
            ...FOCUS_KEPT,
            "privacy.kept.sessions",
            "privacy.kept.consents",
          ])}
        </Section>
        <Section heading={t(lang, "privacy.notKept.heading")}>
          {list(["privacy.notKept.video", "privacy.notKept.report"])}
        </Section>
        <Section heading={t(lang, "privacy.where.heading")}>
          {/* H5: the storage sentence, word for word, until the move to a Saudi region. */}
          <p>{bidiText(lang, CHECK_DATA.boundary.storageNotice[lang])}</p>
        </Section>
        <Section heading={t(lang, "privacy.receivers.heading")}>
          {list(["privacy.receivers.railway", "privacy.receivers.openai"])}
        </Section>
        <Section heading={t(lang, "privacy.retention.heading")}>
          {list(["privacy.retention.account", "privacy.retention.report", "privacy.retention.pause"])}
        </Section>
        <Section heading={t(lang, "privacy.rights.heading")}>
          {list([
            "privacy.rights.access",
            "privacy.rights.correct",
            "privacy.rights.delete",
            "privacy.rights.withdraw",
          ])}
          <p>
            {email
              ? tx(lang, "privacy.rights.contactEmail", { email })
              : tx(lang, "privacy.rights.contactTeam")}
          </p>
        </Section>
        <p className="privacy-adults">{tx(lang, "privacy.adults")}</p>
      </main>
    </div>
  );
}
