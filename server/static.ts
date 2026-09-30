/**
 * The production server's files (`npm start`, server/production.ts): dist/ after `npm run build`.
 *
 * - Text files and the pose runtime (.wasm) go compressed when the browser accepts it: Brotli, else
 *   gzip (acceptance F-4: the app script went 1.3 MB uncompressed, which alone kept the landing's
 *   Lighthouse performance at 56). A file is compressed once and kept in memory, keyed by its size
 *   and time, so a new build is never served from an old copy. Range requests get the plain bytes.
 * - An address that names a file (its last part has an extension) and has none is 404. Everything
 *   else is the app page (index.html), as the app routes with the query string.
 * - /assets, /models and /wasm are content hashed or versioned: cached for a year. The other public
 *   folders for a day. The app page is never cached, so a deploy shows at once.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".task": "application/octet-stream",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Worth compressing: text, and the pose runtime (a third of its size). Images, fonts, audio, video and the model are packed already. */
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".vtt", ".txt", ".wasm"]);
/** Below this a compressed copy saves less than the header costs. */
const MIN_COMPRESS_BYTES = 1024;
/** Brotli's best level is slow on the 11 MB runtime; above this size a faster level is used. */
const BROTLI_BEST_UP_TO = 2 * 1024 * 1024;

export type Encoding = "br" | "gzip";

/** The encoding to send for an Accept-Encoding header: Brotli first, then gzip; q=0 refuses. */
export function pickEncoding(accept: string | string[] | undefined): Encoding | null {
  const header = Array.isArray(accept) ? accept.join(",") : (accept ?? "");
  const allowed = new Set<string>();
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (name && !(q && Number(q.slice(2)) === 0)) allowed.add(name);
  }
  if (allowed.has("br")) return "br";
  if (allowed.has("gzip") || allowed.has("*")) return "gzip";
  return null;
}

async function compress(file: string, size: number, encoding: Encoding): Promise<Buffer> {
  const raw = readFileSync(file);
  if (encoding === "gzip") return gz(raw, { level: 9 });
  return brotli(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: size <= BROTLI_BEST_UP_TO ? 11 : 5,
      [constants.BROTLI_PARAM_SIZE_HINT]: size,
    },
  });
}

export interface StaticHandler {
  (req: IncomingMessage, res: ServerResponse): void;
  /** Compresses the app page and every file under assets/ ahead of the first request. */
  warm(): Promise<void>;
}

export function createStaticHandler(rootDir: string): StaticHandler {
  const root = resolve(rootDir);
  const indexFile = resolve(root, "index.html");
  const cache = new Map<string, Promise<Buffer>>();

  const compressed = (file: string, size: number, mtimeMs: number, encoding: Encoding) => {
    const key = `${encoding}:${file}:${size}:${mtimeMs}`;
    let hit = cache.get(key);
    if (!hit) {
      // A stale copy of the same file (an older build) is dropped.
      for (const k of cache.keys()) if (k.startsWith(`${encoding}:${file}:`)) cache.delete(k);
      hit = compress(file, size, encoding);
      hit.catch(() => cache.delete(key));
      cache.set(key, hit);
    }
    return hit;
  };

  const handler = ((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    let name: string;
    try {
      name = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const target = resolve(root, "." + name);
    if (!target.startsWith(root + sep) && target !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    let file = target;
    if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
    if (!(existsSync(file) && statSync(file).isFile())) {
      // A missing file (/favicon.ico, an old hashed chunk) is not the app page.
      if (extname(name) !== "") {
        res.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : "Not found");
        return;
      }
      file = indexFile;
    }
    const ext = extname(file);
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (file === indexFile) res.setHeader("Cache-Control", "no-cache");
    else if (/^\/(assets|models|wasm)\//.test(name))
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else if (/^\/(cues|fonts|illustrations|brand)\//.test(name))
      res.setHeader("Cache-Control", "public, max-age=86400");
    const stat = statSync(file);
    const size = stat.size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && file !== indexFile) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2])),
        end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
      });
      if (req.method === "HEAD") res.end();
      else createReadStream(file, { start, end }).pipe(res);
      return;
    }
    const compressible = COMPRESSIBLE.has(ext) && size >= MIN_COMPRESS_BYTES;
    if (compressible) res.setHeader("Vary", "Accept-Encoding");
    const encoding = compressible ? pickEncoding(req.headers["accept-encoding"]) : null;
    if (encoding) {
      compressed(file, size, stat.mtimeMs, encoding).then(
        (body) => {
          res.setHeader("Content-Encoding", encoding);
          res.setHeader("Content-Length", body.length);
          res.end(req.method === "HEAD" ? undefined : body);
        },
        () => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        },
      );
      return;
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", size);
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  }) as StaticHandler;

  handler.warm = async () => {
    const files = [indexFile];
    const assets = resolve(root, "assets");
    if (existsSync(assets)) for (const f of readdirSync(assets)) files.push(resolve(assets, f));
    await Promise.all(
      files
        .filter((f) => existsSync(f) && statSync(f).isFile() && COMPRESSIBLE.has(extname(f)))
        .flatMap((f) => {
          const s = statSync(f);
          if (s.size < MIN_COMPRESS_BYTES) return [];
          return (["br", "gzip"] as const).map((e) =>
            compressed(f, s.size, s.mtimeMs, e).catch(() => undefined),
          );
        }),
    );
  };

  return handler;
}
