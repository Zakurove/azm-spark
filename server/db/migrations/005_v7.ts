// Azm v7 storage (product v7 contract section 3). New tables only: every table of 001 to 004 and
// every row in it stays exactly as it was. The intake JSON in profiles.intake gains the v7 fields
// without a schema change.
//
//   focus_checks       one focus check (C-2): its own record beside the v1 assessments, with the range
//                      protocol, the gait plan, the day's answers (ids and numbers only), the v1 data
//                      map of the pre-check, the rule versions and the device ({ os, browser }; the pose
//                      model is kept per measurement and per gait view, C-10)
//   rom_measurements   one movement and side of a check: measured, or a not measured row that complete
//                      and an ending stop write (C-4); the grade the server computed (C-3)
//   gait_analyses      one gait analysis: the combined and per view metrics, the findings (provisional
//                      until complete, C-13) and one replay cycle (landmarks only, no video)
//   agent_sessions     one live coach segment per user, ref and segment (C-6): the minutes reserved and
//                      used, counts and times only; no transcript, audio, event text or tool arguments
//
// JSON columns are written and read only through server/modules/focus/store.ts and
// server/modules/agent/budget.ts. ended_reason never names a symptom (Q25 (d)).
export const version = 5;
export const name = "v7";
export const sql = `
 CREATE TABLE focus_checks(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('baseline','retest')),
  setting TEXT NOT NULL CHECK(setting IN ('home','booth')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','ended_early','abandoned')),
  protocol TEXT NOT NULL,
  gait_plan TEXT,
  today TEXT NOT NULL,
  precheck TEXT NOT NULL,
  versions TEXT NOT NULL,
  device TEXT NOT NULL,
  intake_version INTEGER NOT NULL,
  started INTEGER NOT NULL,
  active INTEGER NOT NULL,
  completed INTEGER,
  ended_reason TEXT CHECK(ended_reason IS NULL OR ended_reason IN ('stop','stale','replaced','all_skipped','consent_revoked')));
 CREATE INDEX focus_checks_user ON focus_checks(user_id, started);
 CREATE TABLE rom_measurements(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  check_id TEXT NOT NULL REFERENCES focus_checks(id) ON DELETE CASCADE,
  movement_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('left','right','none')),
  position TEXT,
  value REAL,
  unit TEXT NOT NULL DEFAULT 'deg' CHECK(unit = 'deg'),
  source TEXT NOT NULL CHECK(source IN ('measured','not_measured_camera','not_measured_today','not_applicable')),
  reason TEXT,
  pain INTEGER NOT NULL DEFAULT 0 CHECK(pain IN (0,1)),
  pain_level INTEGER CHECK(pain_level IS NULL OR pain_level BETWEEN 0 AND 10),
  pain_before INTEGER CHECK(pain_before IS NULL OR pain_before BETWEEN 0 AND 10),
  cause TEXT CHECK(cause IS NULL OR cause IN ('tight','pain','weak')),
  percent_normal REAL,
  finding TEXT NOT NULL,
  grade_ignoring_pain TEXT CHECK(grade_ignoring_pain IS NULL OR grade_ignoring_pain IN ('within','mild','marked')),
  norm TEXT,
  median REAL,
  n_valid INTEGER NOT NULL DEFAULT 0,
  attempts TEXT NOT NULL,
  flags TEXT NOT NULL,
  quality TEXT NOT NULL,
  pose_model TEXT CHECK(pose_model IS NULL OR pose_model IN ('lite','full')),
  movement_version INTEGER,
  norms_version TEXT NOT NULL,
  engine_version TEXT,
  created INTEGER NOT NULL,
  UNIQUE(check_id, movement_id, side));
 CREATE INDEX rom_measurements_user ON rom_measurements(user_id, movement_id, side, created);
 CREATE TABLE gait_analyses(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  check_id TEXT REFERENCES focus_checks(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('overground','walking_pad')),
  views TEXT NOT NULL,
  setup TEXT NOT NULL,
  metrics TEXT NOT NULL,
  findings TEXT NOT NULL,
  quality TEXT NOT NULL,
  replay TEXT,
  pose_model TEXT NOT NULL CHECK(pose_model IN ('lite','full')),
  rules_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created INTEGER NOT NULL);
 CREATE INDEX gait_analyses_user ON gait_analyses(user_id, created);
 CREATE TABLE agent_sessions(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  block TEXT NOT NULL CHECK(block IN ('rom','gait','session')),
  segment TEXT NOT NULL,
  ref TEXT NOT NULL,
  remints INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  device TEXT NOT NULL,
  model TEXT NOT NULL,
  instruction_version TEXT NOT NULL,
  minutes_reserved REAL NOT NULL,
  minutes_used REAL,
  connect_ms INTEGER,
  turns INTEGER,
  tool_calls TEXT,
  prompt_tokens INTEGER,
  response_tokens INTEGER,
  end_reason TEXT,
  minted INTEGER NOT NULL,
  reported INTEGER,
  UNIQUE(user_id, ref, segment));
 CREATE INDEX agent_sessions_user_day ON agent_sessions(user_id, day);
 CREATE INDEX agent_sessions_day ON agent_sessions(day);`;
