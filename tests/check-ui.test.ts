/**
 * Pure rendering rules of the check UI foundation (no DOM): the bidirectional isolation of copy
 * (UX spec 0.2), the caption severity icons (4.3, principle 10) and the answer list order (principle 2).
 */
import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bidiSegments, bidiText, tx } from "../src/i18n/rich";
import { t } from "../src/i18n";

const html = (node: ReactNode) => renderToStaticMarkup(createElement("p", null, node));

describe("bidirectional isolation of copy (UX spec 0.2)", () => {
  it("wraps Latin runs in bdi lang en and numbers in bdi, in Arabic only", () => {
    expect(bidiSegments("ar", "في Safari، افتح قائمة الصفحة")).toEqual([
      "في ",
      { latin: "Safari" },
      "، افتح قائمة الصفحة",
    ]);
    expect(bidiSegments("ar", "في متصفح Samsung Internet، اضغط")).toEqual([
      "في متصفح ",
      { latin: "Samsung Internet" },
      "، اضغط",
    ]);
    expect(bidiSegments("ar", "المستوى T6 أو أعلى")).toEqual(["المستوى ", { latin: "T6" }, " أو أعلى"]);
    expect(bidiSegments("ar", "نحو ١٦ إلى ٢١ دقيقة")).toEqual([
      "نحو ",
      { number: "١٦" },
      " إلى ",
      { number: "٢١" },
      " دقيقة",
    ]);
    expect(bidiSegments("en", "In Safari, open 3 menus")).toEqual(["In Safari, open 3 menus"]);
  });

  it("renders the camera steps with the browser names isolated and read in English", () => {
    const ios = html(tx("ar", "assessment.camera.denied.ios"));
    expect(ios).toContain('<bdi lang="en">Safari</bdi>');
    expect(ios.match(/<bdi lang="en">Safari<\/bdi>/g)).toHaveLength(2);
    expect(html(tx("ar", "assessment.camera.denied.android"))).toContain('<bdi lang="en">Chrome</bdi>');
    // English is plain text.
    expect(html(tx("en", "assessment.camera.denied.ios"))).not.toContain("<bdi");
  });

  it("shows 997 and 937 in Arabic Indic digits in Arabic text (Q30)", () => {
    expect(t("ar", "assessment.common.call937")).toContain("٩٣٧");
    expect(t("ar", "assessment.common.call937")).not.toMatch(/937/);
    expect(html(bidiText("ar", "اتصل بالرقم 997"))).toBe("<p>اتصل بالرقم <bdi>٩٩٧</bdi></p>");
    expect(html(bidiText("en", "Call 997"))).toBe("<p>Call 997</p>");
  });
});

describe("caption severity is never colour alone (4.3, principle 10)", () => {
  it("draws an icon per severity and writes the safety caption in red", async () => {
    const { CaptionBar, SEVERITY_ICON } = await import("../src/features/assessment/shared/CaptionBar");
    expect(SEVERITY_ICON).toEqual({ info: "info", warn: "alert-triangle", safety: "stop-square" });
    const render = (severity: "info" | "warn" | "safety") =>
      renderToStaticMarkup(
        createElement(CaptionBar, { text: "Stop now", severity, onReplay: () => undefined }),
      );
    const shapes = new Set(
      (["info", "warn", "safety"] as const).map((s) => render(s).match(/<svg[\s\S]*<\/svg>/)![0]),
    );
    expect(shapes.size).toBe(3);
    expect(render("safety")).toContain('class="check-caption is-safety"');
    expect(render("safety")).toContain('data-severity="safety"');
  });
});

describe("answer lists keep the data order (principle 2)", () => {
  it("puts none first only where the spec asks (S08), and describes it instead of naming it", async () => {
    const { MultiAnswerList, orderedOptions } = await import("../src/features/assessment/shared/answers");
    const options = [
      { value: "back", label: "Back" },
      { value: "hip", label: "Hip" },
      { value: "none", label: "No ongoing pain" },
    ];
    expect(orderedOptions(options, "none").map((o) => o.value)).toEqual(["back", "hip", "none"]);
    expect(orderedOptions(options, "none", true).map((o) => o.value)).toEqual(["none", "back", "hip"]);
    const html = renderToStaticMarkup(
      createElement(MultiAnswerList<string>, {
        labelledBy: "q",
        options,
        value: [],
        exclusive: "none",
        onChange: () => undefined,
      }),
    );
    expect(html.indexOf("No ongoing pain")).toBeGreaterThan(html.indexOf("Hip"));
    // The "clears the other choices" note is a description, not part of the button's name.
    const none = html.match(/<button[^>]*aria-describedby="([^"]+)"[^>]*>[\s\S]*?No ongoing pain/);
    expect(none).not.toBeNull();
    expect(html).toContain(`id="${none![1]}"`);
  });
});

describe("booth mode is a verified session (S55)", () => {
  it("reads only a code kept after a verify, never a value typed into the storage", async () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const { vi } = await import("vitest");
    vi.stubGlobal("sessionStorage", fake);
    try {
      const booth = await import("../src/features/assessment/boothMode");
      store.set("azm.booth", "typed-by-hand");
      expect(booth.isBoothMode()).toBe(false);
      booth.saveBoothCode("1234", 1000);
      expect(JSON.parse(store.get("azm.booth")!)).toEqual({ code: "1234", verifiedAt: 1000 });
      expect(booth.readBoothCode()).toBe("1234");
      expect(booth.boothVerifiedSession()).toBe(true);
      booth.clearBoothCode();
      expect(booth.isBoothMode()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
