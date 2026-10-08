import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/** Keep the existing landing dictionary in the first script; its v7 copy belongs to the lazy part. */
export function v7Landing(): Plugin {
  let enabled = false;
  return {
    name: "azm-v7-landing",
    enforce: "pre",
    configResolved(config) {
      enabled = config.env.VITE_V7 === "1";
    },
    load(id) {
      const [file, query] = id.split("?");
      if (!/\/src\/i18n\/(ar|en)\/landing\.json$/.test(file)) return null;
      this.addWatchFile(file);
      const { v7, ...existing } = JSON.parse(readFileSync(file, "utf8"));
      return query === "v7" ? `export default ${JSON.stringify(v7)};` : JSON.stringify(existing);
    },
    transform(source, id) {
      if (enabled || !id.endsWith("/src/app/Landing.tsx")) return null;
      // Remove the opt in JSX before compilation so the default child array and script stay identical.
      return source
        .replace(/\/\/ @v7-only-begin[\s\S]*?\/\/ @v7-only-end\n/g, "")
        .replace(/\s*\{\/\* @v7-only-begin \*\/\}[\s\S]*?\{\/\* @v7-only-end \*\/\}/g, "");
    },
  };
}
