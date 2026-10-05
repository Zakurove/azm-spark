/** Types of scripts/spike-live/run.mjs for the tests (tests/v7/d-spike-live.test.ts). */
export declare const PROBES: readonly string[];
export declare const PLAN: Readonly<Record<string, string>>;
export declare function parseArgs(argv: readonly string[]): {
  probes: string[];
  budgetUsd: number;
  plan: boolean;
  check: boolean;
  error: string | null;
};
