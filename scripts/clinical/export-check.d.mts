/** Types for scripts/clinical/export-check.mjs. */
export declare const KEEP: readonly string[];
export declare const DROP_TOP: readonly string[];
export declare const DROP_ANYWHERE: readonly string[];
export declare function exportCheck(
  source: unknown,
): { data: Record<string, unknown>; errors?: undefined } | { data?: undefined; errors: string[] };
