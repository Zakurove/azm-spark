/**
 * Builders for the flow screen tests (tests/flow-*.test.ts): the reducer walks of flow-walks.ts, and
 * a static render of a screen inside its .azm-check root (no DOM: react-dom/server).
 */
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lang } from "../src/app/i18n";
import type { CheckApi } from "../src/features/assessment/api";
import type { FlowModel } from "../src/features/assessment/flowMachine";
import type { ScreenProps } from "../src/features/assessment/screenTypes";
import { CheckRoot } from "../src/features/assessment/shared/CheckRoot";
import type { CheckUi } from "../src/features/assessment/shared/CheckUi";

export * from "./flow-walks";

/** A check API that never answers (static renders never call it). */
export const NO_API = new Proxy({} as CheckApi, {
  get: () => () => new Promise(() => undefined),
});

/** The static markup of a screen for a model, inside its .azm-check root. */
export function render(
  Screen: ComponentType<ScreenProps>,
  model: FlowModel,
  lang: Lang = "en",
  ui: Partial<CheckUi> = {},
): string {
  const guest = model.data.config.mode === "guest";
  // The shell measures its bars in a layout effect, which a static render skips on purpose.
  const error = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
    error(...args);
  };
  try {
    return renderMarkup(Screen, model, lang, { guest, ...ui });
  } finally {
    console.error = error;
  }
}

function renderMarkup(
  Screen: ComponentType<ScreenProps>,
  model: FlowModel,
  lang: Lang,
  ui: Partial<CheckUi> & { guest: boolean },
): string {
  const screen = createElement(Screen, {
    model,
    dispatch: () => undefined,
    api: NO_API,
    retryCamera: () => undefined,
  });
  return renderToStaticMarkup(
    createElement(CheckRoot, {
      ui: {
        lang,
        booth: model.data.config.booth,
        requestLeave: () => undefined,
        screenKey: model.state.kind,
        ...ui,
      },
      children: screen,
    }),
  );
}

/** The visible text of markup: tags removed, entities decoded, spaces collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<\/?(strong|bdi|b|em|span)(\s[^>]*)?>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The copy rules every rendered screen keeps (UX spec 0.2): no dash characters (a hyphen between
 * letters, an en dash, an em dash, a minus sign), no unfilled {token}, no copy key shown as text.
 */
export function copyProblems(html: string): string[] {
  const text = textOf(html);
  const out: string[] = [];
  // Arabic pages show Arabic Indic digits (Q30), except inside a Latin run such as T6.
  if (/ lang="ar"/.test(html.slice(0, 200))) {
    const ascii = text.match(/(?<![A-Za-z0-9.:/=])\d+(?![A-Za-z])/);
    if (ascii)
      out.push(
        `ASCII digits in Arabic: ${text.slice(Math.max(0, (ascii.index ?? 0) - 30), (ascii.index ?? 0) + 30)}`,
      );
  }
  if (/[–—−]/.test(text)) out.push("en dash, em dash or minus sign");
  if (/\p{L}-\p{L}/u.test(text)) out.push("hyphen between letters");
  if (/\{\w+\}/.test(text)) out.push(`unfilled token in: ${text.match(/.{0,30}\{\w+\}.{0,30}/)?.[0]}`);
  if (/\bassessment\.[a-z]/.test(text)) out.push(`copy key shown: ${text.match(/assessment\.[\w.]+/)?.[0]}`);
  return out;
}
