import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, Server } from "node:http";
import { createApi } from "../server/api";
import { moduleRoutes } from "../server/modules";
import type { Route } from "../server/http/types";
import { migrations } from "../server/db/migrations";

// A user route next to the real module routes, to prove the session gate and params for modules.
const probe: Route = {
  method: "POST",
  path: /^\/api\/probe\/(?<id>[a-z0-9]+)$/,
  auth: "user",
  handle: ({ user, params, body, json }) => json(200, { user: user?.id, id: params.id, echo: body.echo }),
};
const broken: Route = {
  method: "GET",
  path: /^\/api\/broken$/,
  auth: "public",
  handle: () => {
    throw new Error("boom");
  },
};
const silent: Route = { method: "GET", path: /^\/api\/silent$/, auth: "public", handle: () => {} };

let origin: string, server: Server, service: ReturnType<typeof createApi>, cookie: string, userId: string;
const headers = (extra: Record<string, string> = {}) => ({
  origin,
  "Content-Type": "application/json",
  "X-Azm-Request": "1",
  ...extra,
});
beforeAll(async () => {
  service = createApi(":memory:", [...moduleRoutes, probe, broken, silent]);
  server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const r = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: "Health Probe",
      email: "health@example.test",
      password: "test-password-5530",
    }),
  });
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  userId = (await r.json()).user.id;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  service.close();
});

it("answers GET /api/health without a cookie, uncached, with no data beyond the schema", async () => {
  const r = await fetch(`${origin}/api/health`);
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  const body = await r.json();
  expect(Object.keys(body).sort()).toEqual(["ok", "schema", "uptimeSec"]);
  expect(body.ok).toBe(true);
  expect(body.schema).toBe(migrations[migrations.length - 1].version);
  expect(Number.isInteger(body.uptimeSec) && body.uptimeSec >= 0).toBe(true);
});

it("answers HEAD /api/health like GET, without a body, for uptime monitors", async () => {
  const r = await fetch(`${origin}/api/health`, { method: "HEAD" });
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("application/json");
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(await r.text()).toBe("");
  // HEAD only borrows GET routes: a POST only module route still answers 405.
  expect((await fetch(`${origin}/api/probe/abc`, { method: "HEAD", headers: { cookie } })).status).toBe(405);
});

it("keeps the origin check in front of module routes", async () => {
  const r = await fetch(`${origin}/api/health`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  expect(r.status).toBe(403);
  expect(await r.json()).toEqual({ error: "ORIGIN" });
  const foreign = await fetch(`${origin}/api/probe/abc`, {
    method: "POST",
    headers: headers({ origin: "https://other.test", cookie }),
    body: "{}",
  });
  expect(foreign.status).toBe(403);
});

it("answers a wrong method on a module path with 405", async () => {
  const r = await fetch(`${origin}/api/health`, { method: "POST", headers: headers(), body: "{}" });
  expect(r.status).toBe(405);
  expect(await r.json()).toEqual({ error: "METHOD" });
});

it("gates user module routes on a session and passes params, body and user", async () => {
  const anon = await fetch(`${origin}/api/probe/abc`, { method: "POST", headers: headers(), body: "{}" });
  expect(anon.status).toBe(401);
  expect(await anon.json()).toEqual({ error: "AUTH_REQUIRED" });
  const r = await fetch(`${origin}/api/probe/abc`, {
    method: "POST",
    headers: headers({ cookie }),
    body: JSON.stringify({ echo: "hi" }),
  });
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ user: userId, id: "abc", echo: "hi" });
  const bad = await fetch(`${origin}/api/probe/abc`, {
    method: "POST",
    headers: headers({ cookie }),
    body: "{",
  });
  expect(bad.status).toBe(400);
});

it("turns module errors and silent handlers into 500 SERVER", async () => {
  for (const path of ["/api/broken", "/api/silent"]) {
    const r = await fetch(origin + path);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "SERVER" });
  }
});

it("leaves the legacy chain as it was: unknown routes 401 without a session and 404 with one", async () => {
  const anon = await fetch(`${origin}/api/nope`);
  expect(anon.status).toBe(401);
  expect(await anon.json()).toEqual({ error: "AUTH_REQUIRED" });
  const r = await fetch(`${origin}/api/nope`, { headers: { cookie } });
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: "NOT_FOUND" });
  expect((await fetch(`${origin}/api/healthz`, { headers: { cookie } })).status).toBe(404);
  expect((await fetch(`${origin}/api/auth/me`, { headers: { cookie } })).status).toBe(200);
});
