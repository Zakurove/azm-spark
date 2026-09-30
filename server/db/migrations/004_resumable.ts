// Round 3 closeout (council R3C-22): a check that had an alarm (no response or a help request) may not
// be resumed on any device (O6 (1)). Only a boolean is kept on the check, the same state a stop leaves:
// no reason, no time and no alarm kind (Q25 (d)). Every existing check keeps its resume window.
export const version = 4;
export const name = "resumable";
export const sql = `
 ALTER TABLE assessments ADD COLUMN resumable INTEGER NOT NULL DEFAULT 1 CHECK(resumable IN (0,1));`;
