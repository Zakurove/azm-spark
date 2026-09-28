/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" on the Playwright build: enables FixturePoseSource (contract v3 K). Never set in production. */
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
