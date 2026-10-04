/**
 * The condition questions that fill the body map (product v7 contract 2.2, rom-protocol 2.3
 * conditionAutoMap). Pure, no DOM.
 *
 * Its own module (D-024, A2-3): src/medical/body-map.ts is imported by plan.ts (validateIntake), which
 * reaches the shared plan chunk of every build. Once a v7 chunk imports ROM_DATA, the bundler keeps
 * the whole range data with any module that reads a slice of it, so body-map.ts reads none of it and
 * re-exports this function: the data stays in the v7 chunks that ask the questions (contract 8.8).
 */
import { conditionAutoMap } from "../movements/rom/rom-v7.json";
import type { Text } from "../movements/types";

/** The questions to ask for the person's conditions, in order (conditionAutoMap). */
export function autoFillQuestions(
  conditions: readonly string[],
): { condition: string; ask: Text; answers: Text[] }[] {
  return conditionAutoMap
    .filter((row) => conditions.includes(row.condition) && row.ask.ar !== "" && row.ask.en !== "")
    .map((row) => ({ condition: row.condition, ask: row.ask, answers: row.answers }));
}
