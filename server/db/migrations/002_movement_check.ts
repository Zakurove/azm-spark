// Movement check storage (contract v2, section E; clinical spec 2.1 data map). New tables only:
// every table of 001 and every row in it stays exactly as it was.
//
//   assessments         one check: setting, status, the setup and protocol frozen at start, and the
//                       pre-check fields of the data map (never raw answers)
//   assessment_results  one test side of a check: derived numbers, flags and the series key only
//   check_locks         the same day lock per person: reason and end time, deleted once it ends
//   consents            the movement check consent, with its version, accepted and revoked times
//   safety_events       postpone and stop counts per day, reason and setting, with NO user id
//   check_state         per person dates the pre-check needs across checks (see the SPEC-GAP)
//
// SPEC-GAP: check-state-table. Contract E has no place for changeReported when a check is postponed
// (nothing else is stored then), yet spec 2.2 pc_change needs it at the next check so an uncleared
// change cannot be bypassed; nor for pc_after_last yes (followUpResolved). check_state keeps only
// the two dates of the data map and the id of the check whose lasting follow up was resolved.
export const version = 2;
export const name = "movement_check";
export const sql = `
 CREATE TABLE assessments(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('baseline','retest')),
  setting TEXT NOT NULL CHECK(setting IN ('booth','home')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','ended_early','abandoned')),
  series_meta TEXT NOT NULL,
  setup TEXT NOT NULL,
  protocol TEXT NOT NULL,
  precheck TEXT NOT NULL,
  device TEXT NOT NULL,
  started INTEGER NOT NULL,
  completed INTEGER,
  ended_reason TEXT);
 CREATE INDEX assessments_user ON assessments(user_id, started);
 CREATE TABLE assessment_results(
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  test_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('left','right','none')),
  value REAL,
  unit TEXT NOT NULL CHECK(unit IN ('deg','count')),
  variant TEXT,
  band TEXT NOT NULL CHECK(band IN ('default','wide')),
  attempts TEXT NOT NULL,
  quality TEXT NOT NULL,
  detail TEXT NOT NULL,
  flags TEXT NOT NULL,
  n_valid INTEGER NOT NULL,
  median REAL,
  skipped_reason TEXT,
  series_key TEXT NOT NULL,
  pose_model TEXT NOT NULL,
  movement_version INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE(assessment_id, test_id, side));
 CREATE INDEX assessment_results_user ON assessment_results(user_id, test_id, side);
 CREATE TABLE check_locks(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  reason TEXT NOT NULL,
  until INTEGER NOT NULL);
 CREATE TABLE consents(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  revoked_at INTEGER);
 CREATE INDEX consents_user ON consents(user_id, kind);
 CREATE TABLE safety_events(
  day TEXT NOT NULL,
  reason TEXT NOT NULL,
  setting TEXT NOT NULL CHECK(setting IN ('booth','home')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, reason, setting));
 CREATE TABLE check_state(
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  change_reported TEXT,
  change_cleared TEXT,
  lasting_resolved TEXT);`;
