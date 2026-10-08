/// <reference types="vite/client" />

declare module "*landing.json?v7" {
  const copy: (typeof import("./i18n/en/landing.json"))["v7"];
  export default copy;
}

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

/** The installed voice packs, public/cues/packs/index.json (vite.config.ts, voicePacks). */
declare module "virtual:voice-packs" {
  const index: {
    default: string;
    packs: {
      id: string;
      name: { ar: string; en: string };
      provider: string;
      voices: { ar: string; en: string };
    }[];
  };
  export default index;
}
