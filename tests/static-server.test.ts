/**
 * The production server's files (server/static.ts), acceptance F-4: compressed text and runtime,
 * 404 for a missing file instead of the app page, the app page for app addresses, ranges, caching.
 */
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticHandler, pickEncoding } from "../server/static";

let dir = "";
let server: Server;
let base = "";
const SCRIPT = "export const copy = " + JSON.stringify("A line of app copy. ".repeat(4000)) + ";\n";
const PAGE = "<!doctype html><html><head><title>Azm</title></head><body><div id=root></div></body></html>";
const PNG = Buffer.alloc(4096, 7);
const WASM = Buffer.from("\0asm" + "runtime ".repeat(2000));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "azm-static-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "brand"));
  mkdirSync(join(dir, "wasm"));
  writeFileSync(join(dir, "index.html"), PAGE);
  writeFileSync(join(dir, "assets", "index-abc.js"), SCRIPT);
  writeFileSync(join(dir, "assets", "tiny.css"), "a{color:red}");
  writeFileSync(join(dir, "brand", "azm.png"), PNG);
  writeFileSync(join(dir, "wasm", "vision.wasm"), WASM);
  const handler = createStaticHandler(dir);
  await handler.warm();
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function get(path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Reply> {
  return new Promise((resolveReply, reject) => {
    const req = request(`${base}${path}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolveReply({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("compression", () => {
  it("sends the app script with Brotli when accepted, a fraction of its size, cached for a year", async () => {
    const r = await get("/assets/index-abc.js", { "Accept-Encoding": "gzip, deflate, br" });
    expect(r.status).toBe(200);
    expect(r.headers["content-encoding"]).toBe("br");
    expect(r.headers["content-type"]).toBe("text/javascript");
    expect(r.headers.vary).toBe("Accept-Encoding");
    expect(r.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(Number(r.headers["content-length"])).toBe(r.body.length);
    expect(r.body.length).toBeLessThan(SCRIPT.length / 10);
    expect(brotliDecompressSync(r.body).toString()).toBe(SCRIPT);
  });

  it("falls back to gzip, and to the plain file without Accept-Encoding", async () => {
    const g = await get("/assets/index-abc.js", { "Accept-Encoding": "gzip" });
    expect(g.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(g.body).toString()).toBe(SCRIPT);
    const plain = await get("/assets/index-abc.js");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body.toString()).toBe(SCRIPT);
    expect(Number(plain.headers["content-length"])).toBe(SCRIPT.length);
  });

  it("compresses the app page and the pose runtime; never images or tiny files", async () => {
    const page = await get("/", { "Accept-Encoding": "br" });
    // The page is under 1 KB here, so it goes plain; the header says it could vary only when compressible.
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["cache-control"]).toBe("no-cache");
    const wasm = await get("/wasm/vision.wasm", { "Accept-Encoding": "br" });
    expect(wasm.headers["content-encoding"]).toBe("br");
    expect(wasm.headers["content-type"]).toBe("application/wasm");
    expect(brotliDecompressSync(wasm.body).equals(WASM)).toBe(true);
    const png = await get("/brand/azm.png", { "Accept-Encoding": "br" });
    expect(png.headers["content-encoding"]).toBeUndefined();
    expect(png.body.equals(PNG)).toBe(true);
    expect(png.headers["cache-control"]).toBe("public, max-age=86400");
    const tiny = await get("/assets/tiny.css", { "Accept-Encoding": "br" });
    expect(tiny.headers["content-encoding"]).toBeUndefined();
  });

  it("HEAD gives the compressed length without a body", async () => {
    const r = await get("/assets/index-abc.js", { "Accept-Encoding": "br" }, "HEAD");
    expect(r.status).toBe(200);
    expect(r.headers["content-encoding"]).toBe("br");
    expect(Number(r.headers["content-length"])).toBeGreaterThan(0);
    expect(r.body.length).toBe(0);
  });

  it("a range request gets the plain bytes", async () => {
    const r = await get("/assets/index-abc.js", { "Accept-Encoding": "br", Range: "bytes=0-9" });
    expect(r.status).toBe(206);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.body.toString()).toBe(SCRIPT.slice(0, 10));
  });

  it("reads Accept-Encoding with q values", () => {
    expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(pickEncoding("br;q=0, gzip;q=0.8")).toBe("gzip");
    expect(pickEncoding("identity")).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
    expect(pickEncoding("*")).toBe("gzip");
  });
});

describe("addresses", () => {
  it("answers a missing file with 404, never with the app page", async () => {
    for (const path of ["/favicon.ico", "/assets/index-old.js", "/brand/missing.png"]) {
      const r = await get(path);
      expect(r.status, path).toBe(404);
      expect(r.headers["content-type"]).toBe("text/plain; charset=utf-8");
    }
  });

  it("answers app addresses with the app page", async () => {
    for (const path of ["/", "/?check=1", "/?example=progress&lang=en", "/results"]) {
      const r = await get(path);
      expect(r.status, path).toBe(200);
      expect(r.body.toString()).toBe(PAGE);
    }
  });

  it("refuses a path outside the folder, and methods other than GET and HEAD", async () => {
    expect((await get("/..%2f..%2fetc%2fpasswd")).status).toBe(403);
    expect((await get("/%E0%A4%A")).status).toBe(400);
    expect((await get("/", {}, "POST")).status).toBe(405);
  });
});
