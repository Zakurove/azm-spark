/**
 * The booth demo's person (Nasser at KSCDR: /demo with no registration). Each visitor is a fresh
 * account, tagged as a demo by its address on a reserved domain (RFC 2606 .invalid, never a real
 * mailbox), so no schema change is needed and a demo is never mixed with real people:
 *
 *   demo-<uuid>@demo.azm-spark.invalid, named «زائر» (Visitor)
 *
 * It holds what a normal registration and health form record: the adult confirmation, the focus
 * check and Live coach consents (the coach works at once), and a ready v7 health form: Fahd, a man of
 * 45 with a stiff, painful right shoulder, who walks without an aid. His range movements are the
 * seated shoulder ones (no lying down at a booth) and the walk is offered. With AZM_V7=1 his program
 * waits for the movement check (D-032 item 3), so the full journey plays the build and the program.
 * The password is random and never derived, so nobody signs in to a demo account by password.
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createPlan, type Intake, type Plan } from "../../../src/medical/plan";
import { confirmAdult } from "../account/store";
import { acceptConsent } from "../consents/store";
import { markAwaiting } from "../program/awaiting";
import { v7Enabled } from "../focus/routes";
import { DEMO_DOMAIN } from "../../../src/app/demoAccount";

export { DEMO_DOMAIN, isDemoEmail } from "../../../src/app/demoAccount";

/** The demo person's name on the account (the demo home says «زائر» or "Visitor" by language). */
export const DEMO_NAME = "زائر";
/** A demo session lasts a booth day. */
export const DEMO_SESSION_MS = 24 * 60 * 60 * 1000;

/** The demo health form (Fahd): valid for validateIntake, with every v7 field the focus check needs. */
export const DEMO_INTAKE: Intake = {
  age: 45,
  conditions: ["none"],
  diagnosisNotes: "",
  medications: "",
  mobility: "standing",
  support: "none",
  pain: ["shoulder"],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: [],
  goal: "mobility",
  days: [0, 2, 4],
  time: "18:00",
  sessionMinutes: 30,
  consent: true,
  sex: "male",
  heightCm: 175,
  walking: { status: "without_aid" },
  romFlags: { osteoporosis: false, neckCaution: false },
  regions: [{ region: "shoulder", side: "right", problems: ["pain", "stiffness"], origin: "person" }],
};

export interface DemoPerson {
  id: string;
  email: string;
  name: string;
  /** The session cookie's value (only its hash is stored). */
  session: string;
  /** The stored program (version 1). */
  plan: Plan;
}

/** Creates a fresh demo person with the profile and consents above, and a session for them. */
export function createDemoPerson(db: DatabaseSync, now: number): DemoPerson {
  const id = randomUUID();
  const email = `demo-${randomUUID()}@${DEMO_DOMAIN}`;
  const password = `${randomBytes(16).toString("hex")}:${randomBytes(64).toString("hex")}`;
  const session = randomBytes(32).toString("hex");
  const plan = { ...createPlan(DEMO_INTAKE), created: now };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(id, email, DEMO_NAME, password, now);
    confirmAdult(db, id, now);
    acceptConsent(db, id, "focus_check", now);
    acceptConsent(db, id, "live_coach", now);
    db.prepare("INSERT INTO profiles VALUES(?,?,?,?)").run(
      id,
      JSON.stringify(DEMO_INTAKE),
      JSON.stringify(plan),
      1,
    );
    // D-032 item 3: the program waits for the movement check, as after a first health form.
    if (v7Enabled()) markAwaiting(db, id, now);
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      createHash("sha256").update(session).digest("hex"),
      id,
      now + DEMO_SESSION_MS,
    );
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
  return { id, email, name: DEMO_NAME, session, plan: { ...plan, version: 1 } };
}
