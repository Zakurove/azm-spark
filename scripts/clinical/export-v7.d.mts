/** Types for scripts/clinical/export-v7.mjs. */
type Name = "rom" | "gait" | "targets";
export declare const INPUT_FILES: Record<Name, string>;
export declare const OUTPUT_FILES: Record<Name, string>;
export declare const DROP_ANYWHERE: readonly string[];
export declare const KEEP: Record<Name, readonly string[]>;
export declare const DROP_TOP: Record<Name, readonly string[]>;
export declare const NUMBERS_MODE: Record<Name, readonly string[]>;
export declare const ROM_PROSE: Record<string, readonly string[]>;
export declare const REGION_IDS: readonly string[];
export declare const REGION_ALIASES: Record<string, string>;
export declare const OPTIONAL_ROLES: Record<string, string>;
export declare const STANDARD_ROLE_REFS: Record<string, unknown>;
export declare const EVIDENCE: readonly string[];
export declare const EVIDENCE_RANGES: Record<string, string>;
export declare const ENGINE_PROSE: Record<string, Record<string, unknown>>;
export declare const NORM_FLAGS: readonly string[];
export declare const HIP_END_RANGE_IDS: readonly string[];
export declare const PATTERN_PROSE: readonly string[];
export declare const MAPPING_PROSE: readonly string[];
export declare function strip(value: unknown): unknown;
export declare function numbersOnly(value: unknown): unknown;
export declare function numbersInProse(value: unknown, where?: string): string[];
export declare function normaliseRegions(value: unknown, where?: string): unknown;
export declare function landmarkRef(v: unknown, where: string): unknown;
export declare function movementDef(
  m: Record<string, unknown>,
  regions: { id: string; axial: boolean }[],
): Record<string, unknown>;
export declare function hipEndRange(items: string[], where: string): string[];
export declare function exportRom(source: unknown): Record<string, unknown>;
export declare function exportGait(source: unknown): Record<string, unknown>;
export declare function exportTargets(source: unknown): Record<string, unknown>;
export declare function gaitNumbersInProse(source: unknown): string[];
export declare function exportV7(
  sources: unknown,
):
  | { data: Record<Name, Record<string, unknown>>; errors?: undefined }
  | { data?: undefined; errors: string[] };
export declare function inputArg(argv: readonly string[]): string | null;
