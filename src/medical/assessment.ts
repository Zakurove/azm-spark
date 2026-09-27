/**
 * Movement check: setting, context and setup (contract v2, section B).
 *
 * This module holds the types of contract v2 B. The pre-check (src/medical/precheck.ts) is built
 * on them; protocol selection (contextFromIntake, baseSelection, finalizeProtocol) is added here by
 * its own task. Pure TypeScript, no DOM: shared by the client and the server.
 */
import type { CheckPosition, Clearance, Setting, Side, Support } from "../movements/types";

export type { CheckPosition, Setting };

/** From the intake (signed in) or from the guest steps (booth; clearance counts as unsure there). */
export interface CheckContext {
  position: CheckPosition;
  support: Support;
  pain: string[];
  restrictions: string[];
  conditions: string[];
  clearance: Clearance;
}

/**
 * Asked at the first check of a series and kept with the setup (spec 2.1 data map), so the rules
 * and the comparison series stay stable. The prostheses are answered at every check (worn now).
 */
export interface StoredSetup {
  painSides?: Side[];
  limbLoss?: { arm?: Side; leg?: Side };
  sciT6?: boolean;
  armProsthesis?: boolean;
  legProsthesis?: boolean;
}
