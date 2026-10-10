/**
 * Landing page, phase 1 of F15 (technical plan, "Landing page reimagining"): the hero with the
 * then and now example card, the four step loop and the closing text without "or doctor" (clinical
 * spec Q23, Appendix B item 15). No disclaimer in the footer (D-017 item 2).
 *
 * The page is rendered to static markup in both languages, so what is checked is what a visitor
 * reads. Copy is read from src/i18n/{ar,en}/landing.json through t().
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Landing, {
  EXAMPLE,
  EXAMPLE_BAND,
  HERO_HEADLINE,
  LOOP_STEPS,
  chartPos,
  checkHref,
} from "../src/app/Landing";
import { DICTIONARIES, t } from "../src/i18n";
import { CHECK_DATA, testDef } from "../src/movements/assessments";
import { ARABIC_MARKS, wordingProblems } from "../scripts/wording-rules.mjs";
import type { Lang } from "../src/app/i18n";
import { disclaimersIn } from "./no-disclaimers";

const LANGS: Lang[] = ["ar", "en"];
const noop = () => {};
const render = (lang: Lang, tryCheck = false) =>
  renderToStaticMarkup(
    createElement(Landing, { lang, onLanguage: noop, onEnter: noop, onDemo: noop, tryCheck }),
  );

/** Decodes the few entities renderToStaticMarkup writes. */
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
/** The visible text of a piece of markup, one space between elements. */
const text = (html: string) =>
  decode(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
/** The inner markup of the first element that carries this class. */
function part(html: string, cls: string): string {
  const open = new RegExp(`<(\\w+)[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`).exec(html);
  if (!open) throw new Error(`No element with class ${cls}`);
  const tag = open[1];
  let depth = 1;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = open.index + open[0].length;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open.index + open[0].length, m.index);
  }
  throw new Error(`Unclosed ${cls}`);
}
/** Every string leaf of a dictionary with its dotted key. */
function leaves(v: unknown, prefix = ""): [string, string][] {
  if (typeof v === "string") return [[prefix, v]];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
    leaves(x, prefix ? `${prefix}.${k}` : k),
  );
}
/** Stems the clinical spec never allows in progress copy (spec section 5, progress.forbiddenInProgressText). */
function forbiddenStems(s: string): string[] {
  const { en, ar } = CHECK_DATA.progress.forbiddenInProgressText;
  const plain = s.toLowerCase().replace(ARABIC_MARKS, "");
  return [...en, ...ar].filter((stem) => plain.includes(stem));
}

describe("hero", () => {
  it("shows headline option 1 by default, in both languages", () => {
    expect(HERO_HEADLINE).toBe("landing.hero.headline.lastSession");
    expect(t("ar", HERO_HEADLINE)).toBe("من آخر جلسة علاج إلى حياة نشطة");
    expect(t("en", HERO_HEADLINE)).toBe("From your last therapy session to an active life");
    for (const lang of LANGS)
      expect(text(part(render(lang), "ld-hero-copy"))).toContain(t(lang, HERO_HEADLINE));
    expect(render("ar")).toMatch(/<h1>من آخر جلسة علاج إلى حياة نشطة<\/h1>/);
  });

  it("keeps the other two headline options ready in both languages", () => {
    expect(t("ar", "landing.hero.headline.therapyEnded")).toBe("انتهى العلاج، وحركتك مستمرة");
    expect(t("en", "landing.hero.headline.therapyEnded")).toBe("Therapy ended. Your movement goes on.");
    expect(t("ar", "landing.hero.headline.stillYours")).toBe("الرياضة ما زالت لك، مهما تغيّر جسمك");
    expect(t("en", "landing.hero.headline.stillYours")).toBe(
      "Training is still yours, whatever your body has been through",
    );
  });

  it("uses the council's supporting line (Q23 (6), H1): no prescribe, prove or progress", () => {
    expect(t("en", "landing.hero.body")).toBe(
      "Azm measures how you move today, builds an exercise plan that fits your medical condition, coaches every session through your phone camera, then measures again so you can see for yourself how your movement changes.",
    );
    expect(t("ar", "landing.hero.body")).toBe(
      "عزم يقيس حركتك اليوم، ويبني لك خطة تمارين تناسب حالتك الطبية، ويدرّبك في كل جلسة عبر كاميرا هاتفك، ثم يقيس حركتك مجددًا لترى بنفسك كيف تتغير.",
    );
  });

  it("has no small label above the heading", () => {
    for (const lang of LANGS) {
      const html = render(lang);
      expect(html).not.toContain("ld-eyebrow");
      expect(part(html, "ld-hero-copy").trim().startsWith("<h1>")).toBe(true);
    }
  });

  it("has one gold action, Start free, and a quiet Try a workout link, at the top and the bottom only (C36)", () => {
    for (const lang of LANGS) {
      const html = render(lang);
      const hero = part(html, "ld-hero-copy");
      expect(text(hero)).toContain(t(lang, "landing.actions.startFree"));
      expect(text(hero)).toContain(t(lang, "landing.actions.tryWorkout"));
      expect(hero.match(/class="cta /g)).toHaveLength(1);
      expect(hero).toMatch(
        new RegExp(`class="cta ld-cta-start"[^>]*>${t(lang, "landing.actions.startFree")}`),
      );
      // Twice on the page (top and bottom), never in the header.
      expect(html.match(/class="cta /g)).toHaveLength(2);
      expect(text(part(html, "ld-header"))).not.toContain(t(lang, "landing.actions.startFree"));
    }
  });

  it("keeps the athlete render and the live session card", () => {
    for (const lang of LANGS) {
      const stage = part(render(lang), "ld-stage");
      expect(stage).toContain("/illustrations/landing/wheelchair-press.webp");
      expect(text(part(stage, "ld-card-live"))).toContain(t(lang, "landing.hero.live.label"));
    }
  });
});

describe("then and now example card", () => {
  it("is labelled as an example and shows the example values in degrees", () => {
    const card = text(part(render("en"), "ld-card-then"));
    expect(card.startsWith("Example")).toBe(true);
    expect(card).toContain("Arm raise to the side, right");
    expect(card).toContain("Start 100 degrees");
    expect(card).toContain("Now 117 degrees");
    expect(card).toContain("Change 17 degrees");
    expect(card).toContain("Higher than your starting point");

    const ar = text(part(render("ar"), "ld-card-then"));
    expect(ar.startsWith("مثال")).toBe(true);
    expect(ar).toContain("رفع الذراع جانبًا، اليمنى");
    expect(ar).toContain("البداية 100 درجة");
    expect(ar).toContain("الآن 117 درجة");
    expect(ar).toContain("التغير 17 درجة");
    expect(ar).toContain("أعلى من نقطة بدايتك");
  });

  it("uses the wording of the clinical data", () => {
    const def = testDef("shoulder_abduction");
    const { labels, verdicts } = CHECK_DATA.progress;
    for (const lang of LANGS) {
      expect(t(lang, "landing.example.test")).toBe(
        `${def.name[lang]}${lang === "ar" ? "، " : ", "}${def.resultTokens.side.right[lang]}`,
      );
      expect(t(lang, "landing.example.start")).toBe(labels.start[lang]);
      expect(t(lang, "landing.example.now")).toBe(labels.now[lang]);
      expect(t(lang, "landing.example.change")).toBe(labels.change[lang]);
      expect(t(lang, "landing.example.verdict")).toBe(verdicts.higher[lang]);
    }
  });

  it("follows the progress rules of the spec: whole degrees, and higher only beyond the band", () => {
    const band = testDef("shoulder_abduction").noiseBandRules.default.abs;
    expect(EXAMPLE_BAND).toBe(band);
    expect(Number.isInteger(EXAMPLE.start) && Number.isInteger(EXAMPLE.now)).toBe(true);
    expect(EXAMPLE.now - EXAMPLE.start).toBeGreaterThan(band);
    // Below the near full range value, where the spec shows no verdict.
    expect(EXAMPLE.now).toBeLessThan(testDef("shoulder_abduction").noiseBandRules.nearFullRangeDeg);
  });

  it("never implies treatment or clinical improvement", () => {
    for (const lang of LANGS) {
      const card = text(part(render(lang), "ld-card-then"));
      expect(forbiddenStems(card)).toEqual([]);
      expect(card).not.toMatch(/treat|therap|clinic|rehab|علاج|تأهيل|عيادة/i);
    }
  });
});

describe("four step loop", () => {
  it("shows measure, plan, coach and measure again as a plain numbered list (C36)", () => {
    expect(LOOP_STEPS).toEqual(["measure", "prescribe", "coach", "prove"]);
    for (const lang of LANGS) {
      const flow = part(render(lang), "ld-how-flow");
      const items = flow.split("<li").slice(1);
      expect(items).toHaveLength(4);
      items.forEach((item, i) => {
        const step = LOOP_STEPS[i];
        expect(text(item)).toContain(t(lang, `landing.loop.steps.${step}.title`));
        expect(text(item)).toContain(t(lang, `landing.loop.steps.${step}.body`));
        expect(item).not.toContain('class="ld-mock"');
      });
      // One example only: measure and compare, labelled Example.
      expect(part(render(lang), "ld-how").match(/class="ld-mock"/g)).toHaveLength(1);
    }
    expect(LOOP_STEPS.map((s) => t("en", `landing.loop.steps.${s}.title`))).toEqual([
      "Measure",
      "Plan",
      "Coach",
      "Measure again",
    ]);
    expect(LOOP_STEPS.map((s) => t("ar", `landing.loop.steps.${s}.title`))).toEqual([
      "نقيس",
      "نخطط",
      "ندرّب",
      "نقيس مجددًا",
    ]);
  });

  it("measures for the person's own tracking, against their own start", () => {
    expect(t("en", "landing.loop.steps.measure.body")).toContain(
      "measures your movement for your own tracking",
    );
    expect(t("ar", "landing.loop.steps.measure.body")).toContain("يقيس حركتك لتتابعها بنفسك");
    expect(t("en", "landing.loop.steps.prove.body")).toContain("compared only with yourself");
    expect(t("ar", "landing.loop.steps.prove.body")).toContain("مقارنة بنفسك فقط");
  });

  it("re-checks every four weeks, as the spec's 28 day interval", () => {
    expect(CHECK_DATA.progress.retestDays).toBe(28);
    expect(t("en", "landing.loop.steps.prove.body")).toContain("Every four weeks");
    expect(t("ar", "landing.loop.steps.prove.body")).toContain("كل أربعة أسابيع");
  });

  it("keeps progress wording rules in the measure again step and its example chart", () => {
    for (const lang of LANGS) {
      const how = text(part(render(lang), "ld-how"));
      expect(forbiddenStems(how)).toEqual([]);
      expect(text(part(render(lang), "ld-mock"))).toContain(t(lang, "landing.example.tag"));
    }
  });

  it("draws the example chart with the start band and the latest point above it", () => {
    const html = part(render("en"), "ld-mock-chart");
    expect(html).toContain("ld-chart-band");
    expect(html.match(/<i /g)).toHaveLength(3);
    expect(chartPos(116)).toBeLessThan(chartPos(117));
    expect(chartPos(76)).toBe(0);
    expect(chartPos(124)).toBe(100);
  });

  it("offers the movement check only while it can start, on its guest route (C36)", () => {
    expect(checkHref("ar")).toBe("/?check=1");
    expect(checkHref("en")).toBe("/?check=1&lang=en");
    for (const lang of LANGS) expect(render(lang)).not.toContain("ld-how-action");
    const ar = part(render("ar", true), "ld-how-action");
    expect(ar).toContain('href="/?check=1"');
    expect(text(ar)).toBe("جرّب قياس الحركة");
    const en = part(render("en", true), "ld-how-action");
    expect(decode(en)).toContain('href="/?check=1&lang=en"');
    expect(text(en)).toBe("Try the movement check");
  });
});

describe("closing and footer", () => {
  it("shows no disclaimer: the footer is the privacy link and the brand line (D-017 item 2)", () => {
    for (const lang of LANGS) {
      expect(disclaimersIn(lang, text(render(lang, true)))).toEqual([]);
      const footer = part(render(lang), "ld-footer");
      expect(footer).not.toMatch(/ld-not-medical|ld-note/);
      expect(text(footer)).toContain(t(lang, "privacy.link"));
      expect(text(footer)).toContain(t(lang, "landing.footer.brandline"));
    }
  });

  it("has no hero chips: the two badges and their copy keys are gone (booth v2, B10)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const lang of LANGS) {
      const hero = part(render(lang), "ld-hero");
      expect(hero).not.toContain("ld-chip");
      expect(text(hero)).not.toMatch(/Video never leaves|No app, no equipment|الفيديو لا يغادر|بلا تطبيق/);
      const json = JSON.parse(readFileSync(`${__dirname}/../src/i18n/${lang}/landing.json`, "utf8"));
      expect(json.hero).not.toHaveProperty("chips");
    }
  });

  it("keeps the closing line and uses the council's closing text, without the doctor (spec Q23)", () => {
    expect(t("ar", "landing.close.title")).toBe("جسمك تغيّر، وعزمك باقٍ");
    expect(t("en", "landing.close.title")).toBe("Your body changed. Your resolve did not.");
    expect(t("en", "landing.close.body")).toBe(
      "Start free, for yourself or for someone in your family. Every session is saved so you can follow your training yourself.",
    );
    expect(t("ar", "landing.close.body")).toBe(
      "ابدأ مجانًا، لنفسك أو لأحد أهلك، وتُحفظ كل جلسة لتتابع تمرينك بنفسك.",
    );
    for (const lang of LANGS) {
      const close = text(part(render(lang), "ld-close"));
      expect(close).not.toMatch(/doctor|طبيب/i);
      expect(close).toContain(t(lang, "landing.close.title"));
    }
  });
});

describe("page wide rules", () => {
  it("says Azm in the English footer and brand line, never AZM SPARK (C36)", () => {
    const footer = text(part(render("en"), "ld-footer"));
    expect(footer).toContain("Azm. Training is still yours.");
    expect(render("en")).not.toMatch(/SPARK/i);
  });

  it("every landing string is in both languages and passes the wording rules", () => {
    const ar = new Map(leaves(DICTIONARIES.ar.landing));
    const en = new Map(leaves(DICTIONARIES.en.landing));
    expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, value] of [...ar, ...en]) expect(wordingProblems(value), key).toEqual([]);
  });

  it("Arabic says عزم (never عزم سبارك), هاتفك (never جوالك) and never calls the check فحص", () => {
    const page = text(render("ar"));
    for (const word of ["سبارك", "جوالك", "فحص", "تقدم", "يصف", "نصمم", "نُثبت"])
      expect(page).not.toContain(word);
    // No benefits section with health effect claims (C36, rule 5).
    expect(render("ar")).not.toContain("ld-health");
  });

  it("the rendered page has no dash, says حالتك الطبية and never claims to be a rehabilitation app", () => {
    for (const lang of LANGS) {
      const page = text(render(lang));
      expect(wordingProblems(page)).toEqual([]);
      expect(page).not.toMatch(/rehabilitation app|rehab app|تطبيق تأهيل/i);
    }
    expect(text(render("ar"))).toContain("حالتك الطبية");
    expect(text(render("en"))).toContain("your medical condition");
  });

  it("renders the full Azm wordmark and a language switch in the other language", () => {
    const ar = render("ar");
    // The wordmark at the size it shows (acceptance F-4: the 1596 px PNG cost 50 KB on the landing).
    expect(ar).toContain('src="/brand/azm-logo.webp"');
    expect(ar).toMatch(/<button class="language" lang="en">English<\/button>/);
    expect(render("en")).toMatch(/<button class="language" lang="ar">العربية<\/button>/);
  });

  it("shows Western digits in both languages, never Arabic Indic ones (D-036 item 3)", () => {
    expect(text(render("ar"))).not.toMatch(/[٠-٩٫]/);
    expect(text(part(render("ar"), "ld-card-then"))).toMatch(/100/);
    expect(text(part(render("en"), "ld-card-then"))).toMatch(/100/);
  });
});
