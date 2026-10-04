/**
 * The intake form in both builds (product v7 contract C-9, 1.2): a default build keeps the four steps
 * and the v1 pain question exactly as before; a VITE_V7 build adds the "Your body" step after
 * "Movement and precautions" (its own lazily loaded chunk) and drops the v1 pain question, which the
 * body map answers (pain[] is written from it, contract 2.2 rule 3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function form(v7: boolean) {
  vi.resetModules();
  vi.doMock("../../src/app/v7flag", () => ({ V7_UI: v7 }));
  return (await import("../../src/app/IntakeForm")).default;
}
const steps = (html: string) => html.match(/<ol>.*?<\/ol>/s)![0].match(/<li/g)!.length;

describe("the intake form", () => {
  afterEach(() => {
    vi.doUnmock("../../src/app/v7flag");
    vi.resetModules();
  });

  it("keeps four steps in a default build", async () => {
    const IntakeForm = await form(false);
    const html = renderToStaticMarkup(
      createElement(IntakeForm, { lang: "ar", initial: null, onSaved: () => {} }),
    );
    expect(steps(html)).toBe(4);
    expect(html).toContain("١ / ٤");
    expect(html).toContain("الحركة والاحتياطات");
  });

  it("adds the Your body step in a v7 build", async () => {
    const IntakeForm = await form(true);
    const html = renderToStaticMarkup(
      createElement(IntakeForm, { lang: "en", initial: null, onSaved: () => {} }),
    );
    expect(steps(html)).toBe(5);
    expect(html).toContain("1 / 5");
  });
});
