import type { Lang } from "./i18n";

/** The privacy notice's address (Q32 (1), H5), kept apart from the notice so a link does not load it. */
export function privacyHref(lang: Lang): string {
  return lang === "en" ? "/?privacy=1&lang=en" : "/?privacy=1";
}
