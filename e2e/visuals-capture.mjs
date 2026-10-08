import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const phase = process.argv[2] ?? "after";
const base = process.env.AZM_VISUALS_URL ?? "http://127.0.0.1:5950";
const out = `docs/v7-visuals/screenshots/${phase}`;
mkdirSync(out, { recursive: true });
const movements = JSON.parse(readFileSync("src/movements/rom/rom-v7.json", "utf8")).movements.map(
  (m) => m.id,
);
movements.splice(movements.indexOf("trunk_lateral_flexion") + 1, 0, "trunk_lateral_flexion_wheelchair");
const browser = await chromium.launch();
const results = [];
try {
  for (const lang of ["ar", "en"]) {
    for (const [width, height] of [
      [390, 844],
      [1440, 900],
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const screens = movements.flatMap((movement) =>
        ["right", "left"].map((side) => ({ name: `${movement}_${side}`, query: { movement, side } })),
      );
      for (const walk of ["pad_side", "pad_front", "overground_side", "overground_front", "pad_safety"]) {
        for (const side of walk.endsWith("side") ? ["right", "left"] : ["right"])
          screens.push({ name: `${walk}_${side}`, query: { walk, side } });
      }
      screens.push({ name: "landing", query: null });
      for (const screen of screens) {
        const url = screen.query
          ? `${base}/e2e/visuals-review.html?${new URLSearchParams({ ...screen.query, lang })}`
          : `${base}/?lang=${lang}`;
        await page.goto(url);
        await page.locator("h1,h2").first().waitFor();
        if (!screen.query && phase !== "before") await page.locator("#ld-v7-coach").waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.locator('img[loading="lazy"]').evaluateAll(async (images) => {
          for (const img of images) {
            img.loading = "eager";
            await img.decode().catch(() => {});
          }
        });
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          dir: document.documentElement.dir,
          pictures: [...document.querySelectorAll(".v7-illustration img")].map((img) => ({
            source: img.currentSrc,
            alt: img.alt,
            transform: getComputedStyle(img).transform,
            width: img.getBoundingClientRect().width,
            height: img.getBoundingClientRect().height,
            containerHeight: img.parentElement.getBoundingClientRect().height,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          })),
          broken: [...document.images]
            .filter((img) => !img.complete || img.naturalWidth === 0)
            .map((img) => img.getAttribute("src")),
        }));
        if (layout.dir !== (lang === "ar" ? "rtl" : "ltr")) errors.push("Wrong reading direction");
        if (phase !== "before") {
          if (!layout.pictures.length) errors.push("Missing illustration");
          if (layout.pictures.some((picture) => picture.containerHeight + 1 < picture.height))
            errors.push("Illustration extends beyond its container");
          const mirrored =
            screen.query?.side === "left" && (screen.query.movement || screen.query.walk?.endsWith("side"));
          if (
            screen.query &&
            layout.pictures[0]?.transform !== (mirrored ? "matrix(-1, 0, 0, 1, 0, 0)" : "none")
          )
            errors.push("Wrong artwork mirroring");
          if (
            screen.query?.movement?.endsWith("wheelchair") &&
            !layout.pictures[0]?.source.includes("wheelchair")
          )
            errors.push("Missing wheelchair variant");
          if (!screen.query && layout.pictures.some((p) => p.source.includes("_phone") !== width <= 640))
            errors.push("Wrong landing crop");
        }
        const file = `${out}/${lang}_${width}x${height}_${screen.name}.png`;
        await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
        results.push({ file, ...layout, errors: [...errors] });
        if (!screen.query && phase !== "before") {
          for (const name of ["range", "walk", "coach"]) {
            const section = page.locator(`#ld-v7-${name}`).locator("..").locator("..");
            const box = await section.evaluate((element) => {
              const r = element.getBoundingClientRect();
              return [
                Math.max(0, r.left + scrollX - 16),
                r.top + scrollY,
                Math.min(document.documentElement.scrollWidth, r.right + scrollX + 16),
                r.bottom + scrollY,
              ].map(Math.round);
            });
            execFileSync("python3", [
              "-c",
              "from PIL import Image; import sys,json; Image.open(sys.argv[1]).crop(json.loads(sys.argv[3])).save(sys.argv[2])",
              file,
              `${out}/${lang}_${width}x${height}_landing_${name}.png`,
              JSON.stringify(box),
            ]);
          }
        }
        errors.length = 0;
      }
      await context.close();
      console.log(`${lang} ${width} complete`);
    }
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/checks.json`, JSON.stringify(results, null, 2) + "\n");
}
if (results.some((r) => r.overflow || r.broken.length || r.errors.length)) process.exitCode = 1;
