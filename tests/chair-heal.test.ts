/**
 * Booth v2 (B6): a stable chair is assumed. A profile saved before, whose plan left every movement out
 * for want of a chair tick (reason "chair", always a plan in review), is planned again the next time it
 * is read, once, under a new version; its intake (and goal) stays as it was.
 */
import { afterEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApi } from "../server/api";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const OLD_INTAKE = {
  age: 50,
  conditions: ["none"],
  diagnosisNotes: "",
  medications: "",
  mobility: "seated",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: [],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};
/** The plan the rules made before booth v2 for a seated person who did not tick the chair. */
const OLD_PLAN = {
  status: "review",
  reasons: ["no_exercises"],
  notes: ["self_reported_clearance"],
  exclusions: [
    { exerciseId: "seated_shoulder_press", reason: "chair" },
    { exerciseId: "seated_biceps_curl", reason: "chair" },
    { exerciseId: "sit_to_stand", reason: "standing" },
  ],
  exercises: [],
  days: [0, 2, 4],
  time: "09:00",
  warmUpMinutes: 5,
  coolDownMinutes: 5,
  estimatedMinutes: 10,
  recoveryHours: 48,
  created: 1_790_000_000_000,
};

it("plans a profile left in review by the old chair rule again, once, and keeps its answers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "azm-chair-"));
  dirs.push(dir);
  const file = join(dir, "azm.sqlite");
  const service = createApi(file);
  const server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { origin, "Content-Type": "application/json", "X-Azm-Request": "1" };
  const reg = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Chair Test",
      email: "chair@example.test",
      password: "test-password-9281",
      adultConfirmed: true,
    }),
  });
  const cookie = reg.headers.get("set-cookie")!.split(";")[0];
  const { user } = (await reg.json()) as { user: { id: string } };
  const db = new DatabaseSync(file);
  db.prepare("INSERT INTO profiles VALUES(?,?,?,?)").run(
    user.id,
    JSON.stringify(OLD_INTAKE),
    JSON.stringify(OLD_PLAN),
    3,
  );
  const me = async () =>
    (await (await fetch(`${origin}/api/auth/me`, { headers: { ...headers, cookie } })).json()) as {
      intake: typeof OLD_INTAKE;
      plan: { status: string; version: number; exclusions: { reason: string }[]; created: number };
    };
  const first = await me();
  expect(first.plan.status).toBe("ready");
  expect(first.plan.version).toBe(4);
  expect(first.plan.exclusions.map((e) => e.reason)).not.toContain("chair");
  expect(first.plan.created).toBe(OLD_PLAN.created);
  expect(first.intake).toEqual(OLD_INTAKE);
  // Read again: nothing changes.
  const second = await me();
  expect(second.plan.version).toBe(4);
  expect(second.plan).toEqual(first.plan);
  // A plan in review for another reason is left alone.
  db.prepare("UPDATE profiles SET plan=?, version=? WHERE user_id=?").run(
    JSON.stringify({ ...OLD_PLAN, reasons: ["cardiac"], exclusions: [] }),
    7,
    user.id,
  );
  const third = await me();
  expect(third.plan.status).toBe("review");
  expect(third.plan.version).toBe(7);
  db.close();
  await new Promise<void>((r) => server.close(() => r()));
  service.close();
});
