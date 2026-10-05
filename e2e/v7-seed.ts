/**
 * The v7 e2e seed (product v7 contract 1.2 and 8.7, stream G): rows the A to Z run needs that no
 * route of the e2e server can write, written straight into the e2e database (the throwaway
 * AZM_DATABASE of e2e/playwright.config.ts, never the dev database), with the same columns the
 * server's stores write.
 *
 *   seedCoachSession   the agent_sessions row of the fake coach's mint (D-026 item 8, DG-6)
 *
 * G2 adds the completed baseline focus check 3 days old (section 4) beside it.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { E2E_COACH_SESSION_ID } from "../src/features/coach-agent/e2eCoach";
import { riyadhDate } from "../src/medical/precheck";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/** The ref of the seeded row: no check or workout, so a fallback count reads the booth pass (5.2). */
export const E2E_COACH_REF = "e2e_coach";
/** A workout part's segment, the block whose setting comes from the request (section 3). */
export const E2E_COACH_SEGMENT = "session:1";
/** The longest life a coach token can have (the 10 minute Live connection, 5.1), as the reservation. */
const E2E_COACH_MINUTES = 10;

/**
 * Writes the agent_sessions row of the fake coach's mint for this person. The fake mint of
 * ?e2eCoach=fake (src/features/coach-agent/e2eCoach.ts) returns E2E_COACH_SESSION_ID for every
 * segment, so its usage reports, the page hide report of 8.7 among them, reach the route and update
 * this row (the coach itself stays switched off on the e2e server, 1.2.1). The id is one per
 * database: seeding another person gives them the row, cleared of the reports made so far.
 */
export function seedCoachSession(dbFile: string, userId: string, now: number = Date.now()): void {
  const db = new DatabaseSync(dbFile);
  try {
    // The e2e server holds the same file open: wait for its writes rather than fail.
    db.exec("PRAGMA busy_timeout=10000");
    db.prepare(
      `INSERT INTO agent_sessions(id,user_id,block,segment,ref,remints,day,device,model,instruction_version,minutes_reserved,minted)
       VALUES(?,?,'session',?,?,0,?,?,'e2e_fake','e2e_fake',?,?)
       ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, day=excluded.day, minted=excluded.minted,
         minutes_used=NULL, connect_ms=NULL, turns=NULL, tool_calls=NULL, prompt_tokens=NULL,
         response_tokens=NULL, end_reason=NULL, reported=NULL`,
    ).run(
      E2E_COACH_SESSION_ID,
      userId,
      E2E_COACH_SEGMENT,
      E2E_COACH_REF,
      riyadhDate(now),
      createHash("sha256").update("e2e").digest("hex"),
      E2E_COACH_MINUTES,
      now,
    );
  } finally {
    db.close();
  }
}
