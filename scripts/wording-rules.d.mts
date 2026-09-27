/** Types for scripts/wording-rules.mjs (shared by tests/wording.test.ts and the copy writing scripts). */
export declare const LETTER: string;
export declare const DASH_CHARS: RegExp;
export declare const HYPHEN_BETWEEN_LETTERS: RegExp;
export declare const SPACED_HYPHEN: RegExp;
export declare const ARABIC_MARKS: RegExp;
export declare const FORBIDDEN_PHRASE: string;
export declare const DASH_PROBLEM: string;
export declare const PHRASE_PROBLEM: string;
export declare function wordingProblems(text: string): string[];
export declare const HAS_LETTER: RegExp;
export declare const URL_LIKE: RegExp;
export declare const EMAIL: RegExp;
export declare const PATH: RegExp;
export declare const LOCALE: RegExp;
export declare const LOWER_ID: RegExp;
export declare function isCopyValue(s: string): boolean;
export declare const USER_FACING_KEYS: ReadonlySet<string>;
export interface DataString {
  where: string;
  text: string;
  userFacing: boolean;
}
export declare function dataStrings(value: unknown, where?: string): DataString[];
export declare function dataStringProblems(s: Pick<DataString, "text" | "userFacing">): string[];
export declare function dataViolations(value: unknown, where?: string): string[];
