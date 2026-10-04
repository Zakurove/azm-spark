/**
 * Step A6 (A5-11, D-024 item 5): the API answers 413 while a body is still arriving and leaves the
 * rest unread, so it closes the connection with the answer (`Connection: close`). Before, a client
 * that reused the connection for its next request (a keep alive pool, as browsers and fetch keep)
 * waited on it without an answer.
 */
import { Agent, createServer, request, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "../../server/api";

let server: Server;
let service: ReturnType<typeof createApi>;
let origin = "";
beforeAll(async () => {
  service = createApi(":memory:");
  server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  service.close();
});

interface Answer {
  status: number;
  connection: string | undefined;
  body: string;
}

/** One request through `agent`; rejects after `ms` without an answer. */
function send(agent: Agent, path: string, body: string, ms = 3000): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const url = new URL(origin + path);
    const timer = setTimeout(() => reject(new Error(`no answer to ${path} within ${ms} ms`)), ms);
    const req = request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        agent,
        headers: { origin, "Content-Type": "application/json", "X-Azm-Request": "1" },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, connection: res.headers.connection, body: text });
        });
      },
    );
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end(body);
  });
}

describe("a body over the limit (413)", () => {
  it("is answered with Connection: close", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const big = JSON.stringify({ pad: "x".repeat(200 * 1024) });
      const r = await send(agent, "/api/auth/login", big);
      expect(r.status).toBe(413);
      expect(JSON.parse(r.body)).toEqual({ error: "TOO_LARGE" });
      expect(r.connection).toBe("close");
    } finally {
      agent.destroy();
    }
  });

  it("leaves a kept alive client free to send its next request", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const big = JSON.stringify({ pad: "x".repeat(200 * 1024) });
      expect((await send(agent, "/api/auth/login", big)).status).toBe(413);
      const next = await send(agent, "/api/auth/login", JSON.stringify({ email: "a@b.c", password: "x" }));
      expect(next.status).toBe(400);
      expect(JSON.parse(next.body)).toEqual({ error: "CREDENTIAL_FORMAT" });
    } finally {
      agent.destroy();
    }
  });

  it("keeps other answers on a kept alive connection, as before", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const r = await send(agent, "/api/auth/login", JSON.stringify({ email: "a@b.c", password: "x" }));
      expect(r.status).toBe(400);
      expect(r.connection).not.toBe("close");
    } finally {
      agent.destroy();
    }
  });
});
