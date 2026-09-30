/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" on the Playwright build: enables FixturePoseSource (contract v3 K). Never set in production. */
  readonly VITE_E2E?: string;
  /** "0" hides the movement check entries outside the check (featureFlag.ts); unset, they show. */
  readonly VITE_CHECK_UI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The check data's unit forms on their own (vite.config.ts, checkUnitForms). */
declare module "virtual:check-unit-forms" {
  const unitForms: (typeof import("./movements/check-v1.json"))["progress"]["unitForms"];
  export default unitForms;
}
