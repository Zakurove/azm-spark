// D-035 item 3 (the Live coach never connected on iPhone Safari): why a coach segment did not run is
// kept on its row. One nullable column only: every table of 001 to 006 and every row in it stays as it
// was (a row from before reads null).
//
//   agent_sessions.failure   JSON { stage, name, message } of the last failure a usage report named
//                            (src/coach/failure.ts): the stage that failed, the browser's or the
//                            socket's error name and its cleaned message (no URL, token or key, never
//                            anything the person said), or null
//
// Written and read only through server/modules/agent/budget.ts.
export const version = 7;
export const name = "coach_failure";
export const sql = `
 ALTER TABLE agent_sessions ADD COLUMN failure TEXT;`;
