import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch();
const results = [];
try {
  for (const lang of ["ar", "en"]) {
    for (const width of [390, 1440]) {
      for (const reducedMotion of ["reduce", "no-preference"]) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 900 },
          reducedMotion,
        });
        const page = await context.newPage();
        for (const target of ["landing", "movement", "walk"]) {
          const query =
            target === "movement"
              ? "movement=trunk_lateral_flexion_wheelchair&side=left&"
              : target === "walk"
                ? "walk=pad_side&side=left&"
                : "";
          await page.goto(
            `http://127.0.0.1:5950/${target === "landing" ? "" : "e2e/visuals-review.html"}?${query}lang=${lang}`,
          );
          const picture = page.locator(".v7-illustration").first();
          await picture.waitFor();
          await page.evaluate(() => document.fonts.ready);
          await picture.scrollIntoViewIfNeeded();
          const images = await page.locator(".v7-illustration img").evaluateAll(async (items) => {
            for (const img of items) {
              const lazy = img.loading;
              img.loading = "eager";
              await img.decode();
              img.loading = lazy;
            }
            return items.map((img) => ({
              source: img.currentSrc,
              lazy: img.loading === "lazy",
              alt: img.alt,
              animation: getComputedStyle(img).animationName,
              fit: getComputedStyle(img).objectFit,
              fits: img.parentElement.clientHeight + 1 >= img.clientHeight,
            }));
          });
          const videos = await page.locator(".v7-illustration video").count();
          const changedArea = target === "landing" ? ".ld-v7" : ".gx-root,.fx-split";
          const accessibility =
            reducedMotion === "reduce"
              ? await new AxeBuilder({ page }).include(changedArea).analyze()
              : { violations: [] };
          if (target === "walk") {
            await page.locator('[data-action="ready"]').click({ trial: true });
            await page.locator(".safety-stop").click({ trial: true });
          }
          const errors = [];
          if (
            videos ||
            images.some((i) => !i.lazy || !i.alt || !i.fits || i.animation !== "none" || i.fit !== "contain")
          )
            errors.push("Still image display check failed");
          if (accessibility.violations.length) errors.push("Accessibility violation");
          results.push({
            lang,
            width,
            reducedMotion,
            target,
            images,
            videos,
            violations: accessibility.violations,
            errors,
          });
        }
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  writeFileSync("docs/v7-visuals/browser-checks.json", JSON.stringify(results, null, 2) + "\n");
}
console.log(`${results.length} browser checks, ${results.filter((r) => r.errors.length).length} failures`);
if (results.some((r) => r.errors.length)) process.exitCode = 1;
