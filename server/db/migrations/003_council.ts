// Council round (decisions Q2, Q25, Q32, Q33, O6, O17; contract v3 I). Every change keeps the rows it
// finds, minimised where the council removed a field:
//
//   check_locks       Q25 (c): the lock record is { until, releasableByClearance } per person, without
//                     the reason id. recent_change was the only reason a clearance answer releases.
//   safety_events     Q25 (a): counters per day, reason, test id (or precheck) and setting. The rows of
//                     schema 2 had no test id: a pre-check reason keeps "precheck", the rest "none".
//   product_counts    Q25 (a) denominators (checks started and completed per setting) and the Q2 (6)
//                     anonymous product counts, in the same form: no user id, day only.
//   check_state       Q33 (3): faintReported, a date only, cleared by either answer to pc_faint_since.
//   adult_confirmations  Q2 (5), Q32 (6): the adult confirmation, once per account, with its time.
//   assessments.active   O6: the time of the last activity of a check, for the 30 minute resume window.
//   booth_passes      O17: the booth device session of the day and the one check visitor tokens, as
//                     hashes only, with no user id, device or IP.
//
// Q25 (d): outside the pilot only the counts keep which stop or symptom ended a check, so the ended
// reason of a stored check no longer names it ("stop" for every stop and the pain question).
export const version = 3;
export const name = "council";
export const sql = `
 CREATE TABLE check_locks_v3(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  until INTEGER NOT NULL,
  releasable_by_clearance INTEGER NOT NULL DEFAULT 0 CHECK(releasable_by_clearance IN (0,1)));
 INSERT INTO check_locks_v3(user_id,until,releasable_by_clearance)
  SELECT user_id, until, CASE WHEN reason='recent_change' THEN 1 ELSE 0 END FROM check_locks;
 DROP TABLE check_locks;
 ALTER TABLE check_locks_v3 RENAME TO check_locks;
 CREATE TABLE safety_events_v3(
  day TEXT NOT NULL,
  reason TEXT NOT NULL,
  test_id TEXT NOT NULL,
  setting TEXT NOT NULL CHECK(setting IN ('booth','home')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, reason, test_id, setting));
 INSERT INTO safety_events_v3(day,reason,test_id,setting,count)
  SELECT day, reason, CASE WHEN reason LIKE 'precheck:%' THEN 'precheck' ELSE 'none' END, setting, count
  FROM safety_events;
 DROP TABLE safety_events;
 ALTER TABLE safety_events_v3 RENAME TO safety_events;
 CREATE TABLE product_counts(
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  key TEXT NOT NULL DEFAULT '',
  setting TEXT NOT NULL CHECK(setting IN ('booth','home')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, metric, key, setting));
 ALTER TABLE check_state ADD COLUMN faint_reported TEXT;
 CREATE TABLE adult_confirmations(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  confirmed_at INTEGER NOT NULL);
 ALTER TABLE assessments ADD COLUMN active INTEGER;
 UPDATE assessments SET ended_reason='stop' WHERE ended_reason LIKE 'stop:%' OR ended_reason LIKE 'between:%';
 UPDATE assessments SET ended_reason='replaced' WHERE ended_reason='postponed';
 CREATE TABLE booth_passes(
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('staff','visitor')),
  expires INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1)));`;
