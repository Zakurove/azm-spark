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

describe("booth mode is a server pass, never the code (S55, S55b, O17)", () => {
  const SESSION = "a".repeat(64);
  const TOKEN = "b".repeat(64);

  async function withStore<T>(run: (store: Map<string, string>) => Promise<T>): Promise<T> {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const { vi } = await import("vitest");
    vi.stubGlobal("sessionStorage", fake);
    try {
      return await run(store);
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("reads only a pass the server issued, until it ends; never a value typed into the storage", () =>
    withStore(async (store) => {
      const booth = await import("../src/features/assessment/boothMode");
      store.set("azm.booth", "typed-by-hand");
      expect(booth.isBoothMode()).toBe(false);
      store.set("azm.booth", JSON.stringify({ kind: "staff", session: "short", expires: 9e15 }));
      expect(booth.isBoothMode()).toBe(false);
      booth.saveStaffSession(SESSION, 5000);
      expect(JSON.parse(store.get("azm.booth")!)).toEqual({ kind: "staff", session: SESSION, expires: 5000 });
      expect(booth.readBoothPass(4000)).toEqual({ kind: "staff", session: SESSION, expires: 5000 });
      expect(booth.isBoothMode(4000)).toBe(true);
      // At closing time the pass ends and is removed.
      expect(booth.isBoothMode(5000)).toBe(false);
      expect(store.has("azm.booth")).toBe(false);
      booth.saveVisitorToken(TOKEN, 9e15);
      expect(booth.readBoothPass()).toMatchObject({ kind: "visitor", token: TOKEN });
      booth.clearBoothPass();
      expect(booth.isBoothMode()).toBe(false);
    }));

  it("a booth start gets its one check token: the visitor's own, or a new one from the staff session", () =>
    withStore(async () => {
      const booth = await import("../src/features/assessment/boothMode");
      const calls: string[] = [];
      const api = {
        boothToken: async (session: string) => {
          calls.push(session);
          return { ok: true as const, value: { token: TOKEN, expires: 9e15 } };
        },
      };
      expect(await booth.boothStartToken(api)).toBeNull();
      booth.saveVisitorToken(TOKEN, 9e15);
      expect(await booth.boothStartToken(api)).toBe(TOKEN);
      expect(calls).toEqual([]);
      booth.saveStaffSession(SESSION, 9e15);
      expect(await booth.boothStartToken(api)).toBe(TOKEN);
      expect(calls).toEqual([SESSION]);
    }));

  it("the pass holds unless the server refuses it; a network error keeps booth mode (O18)", () =>
    withStore(async () => {
      const booth = await import("../src/features/assessment/boothMode");
      const refused = {
        boothToken: async () => ({
          ok: false as const,
          error: { kind: "http" as const, status: 403, code: "BOOTH_SESSION", body: {} },
        }),
        boothRedeem: async () => ({ ok: true as const, value: { ok: false as const } }),
      };
      const offline = {
        boothToken: async () => ({ ok: false as const, error: { kind: "network" as const } }),
        boothRedeem: async () => ({ ok: false as const, error: { kind: "network" as const } }),
      };
      booth.saveStaffSession(SESSION, 9e15);
      expect(await booth.boothPassHolds(offline)).toBe(true);
      expect(await booth.boothPassHolds(refused)).toBe(false);
      booth.saveVisitorToken(TOKEN, 9e15);
      expect(await booth.boothPassHolds(offline)).toBe(true);
      expect(await booth.boothPassHolds(refused)).toBe(false);
      // Redeeming keeps the token only when the server accepts it.
      booth.clearBoothPass();
      expect(await booth.redeemVisitorToken(refused, TOKEN)).toBe(false);
      expect(booth.isBoothMode()).toBe(false);
      const ok = {
        boothRedeem: async () => ({ ok: true as const, value: { ok: true as const, expires: 9e15 } }),
      };
      expect(await booth.redeemVisitorToken(ok, "not-a-token")).toBe(false);
      expect(await booth.redeemVisitorToken(ok, TOKEN)).toBe(true);
      expect(booth.readBoothPass()).toMatchObject({ kind: "visitor", token: TOKEN });
    }));
});
