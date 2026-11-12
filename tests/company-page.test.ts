/**
 * D-041 (temporary): the Azm Spark Establishment website. Rendered as a visitor reads it: the name,
 * 2026, both services, how augmented reality works, the national number, and no way into the app.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CompanyPage from "../src/app/CompanyPage";

const html = renderToStaticMarkup(createElement(CompanyPage));
const text = html.replace(/<[^>]+>/g, " ");

describe("the company page (D-041)", () => {
  it("names the establishment, its year and its national number, with the logo", () => {
    expect(text).toContain("مؤسسة عزم سبارك");
    expect(text).toContain("2026");
    expect(text).toContain("7055522556");
    expect(text).toContain("الرقم الوطني الموحد");
    expect(html).toContain("/brand/azm-spark-logo.png");
    expect(html).toContain("/brand/azm-spark-mark.png");
  });
  it("presents both services, how augmented reality works and where it is used", () => {
    for (const s of [
      "تطوير تطبيقات الجوال",
      "تطوير الواقع المعزز",
      "ما هو الواقع المعزز؟",
      "أين يُستخدم الواقع المعزز؟",
      "كيف نعمل",
    ])
      expect(text, s).toContain(s);
    for (const id of ["services", "ar", "process", "contact"]) expect(html).toContain(`id="${id}"`);
  });
  it("offers no way into the app (no sign in, demo or test page)", () => {
    for (const s of ["/demo", "romlab", "gaitlab", "login", "تسجيل الدخول"]) expect(html, s).not.toContain(s);
  });
});
