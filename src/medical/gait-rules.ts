/**
 * The gait findings (product v7 contract 2.9, stream C, step C3): evaluateGait runs the confidence
 * model (firing, caps, downgrades, corroboration, painDayRule, unilateralRule), the patterns and the
 * support findings with their copy. Pure, no DOM: the server runs it at the gait POST (provisional)
 * and again at complete with the final range rows (C-13). Pattern lines say what the walk suggests
 * and contributors are possible reasons, never facts (section 11).
 *
 * Placeholder of step A5 (contract 1.3), replaced by C3: no pattern and no finding.
 */
import type { GaitFindingsInput, GaitPatternResult, GaitSupportFinding } from "./gait-types";
import { GAIT_RULES_VERSION } from "../movements/gait";

export function evaluateGait(_input: GaitFindingsInput): {
  patterns: GaitPatternResult[];
  findings: GaitSupportFinding[];
  rulesVersion: string;
} {
  return { patterns: [], findings: [], rulesVersion: GAIT_RULES_VERSION };
}
