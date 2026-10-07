// D-032 item 3 (the tests come before the program): a profile saved with AZM_V7=1 for the first time
// awaits the movement check. A new table only: every table of 001 to 005 and every row in it stays
// exactly as it was, so a person who had a program before has no row and keeps it.
//
//   check_first   one row per person who started with v7: since when the program waits for the check,
//                 and when and how it stopped waiting (the check's targeted week, or the history when
//                 nothing can be measured or the person cannot use a camera)
//
// Read and written only through server/modules/program/awaiting.ts.
export const version = 6;
export const name = "check_first";
export const sql = `
 CREATE TABLE check_first(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  since INTEGER NOT NULL,
  cleared INTEGER,
  cleared_by TEXT CHECK(cleared_by IS NULL OR cleared_by IN ('check','history')));`;
