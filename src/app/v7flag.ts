/**
 * The v7 build flag (product v7 contract C-9): VITE_V7=1 builds the v7 UI (the intake additions, the
 * focus check, the findings, the program links and the coach settings). A build time constant, so a
 * default build drops every `V7_UI ? lazy(() => import(...)) : null` chunk; the only v7 module the
 * landing may import (8.8). Production builds without it until Nasser's release decision.
 */
export const V7_UI: boolean = import.meta.env.VITE_V7 === "1";
