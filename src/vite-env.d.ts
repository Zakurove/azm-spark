/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" on the Playwright build: enables FixturePoseSource (contract v3 K). Never set in production. */
  readonly VITE_E2E?: string;
  /** "1" shows the movement check entries that are still stubs (featureFlag.ts): the booth build. */
  readonly VITE_CHECK_UI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
