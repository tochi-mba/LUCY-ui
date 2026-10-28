/**
 * Serve the built app and pass the hub's paths through: `node scripts/serve.mjs [dist] [port]`.
 *
 * The same shape as the dev server's proxy (vite.config.ts): the browser talks to this origin
 * only, so the hub never needs a CORS policy. Streams are piped as they arrive; nothing buffers
 * an event stream. LUCY_URL says where the hub is.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as forward } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { createBrotliCompress, createGzip } from "node:zlib";
import { cacheFor, encodingFor, typeFor } from "./lib/static.mjs";

const dist = resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? process.env.PORT ?? 4173);
const hub = new URL(process.env.LUCY_URL ?? "http://127.0.0.1:8000");
const HUB_PATHS = ["/v1/", "/healthy", "/ready", "/device"];

createServer((incoming, outgoing) => {
  const path = new URL(incoming.url, "http://x").pathname;
  if (HUB_PATHS.some((prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix))) {
    const relayed = forward(
      {
        hostname: hub.hostname,
        port: hub.port,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: hub.host },
      },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    relayed.on("error", () => {
      outgoing.writeHead(502, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ title: "Bad gateway", detail: `The hub at ${hub.origin} did not answer.` }));
    });
    incoming.pipe(relayed);
    return;
  }
  // The app: a file when one exists, else index.html so deep links work.
  const safe = normalize(path).replace(/^([/\\])+|\.\./g, "");
  let file = join(dist, safe);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  const extension = extname(file);
  const encoding = encodingFor(incoming.headers["accept-encoding"], extension);
  const headers = {
    "Content-Type": typeFor(extension),
    "Cache-Control": cacheFor(relative(dist, file).replaceAll("\\", "/")),
    Vary: "Accept-Encoding",
  };
  if (encoding !== null) headers["Content-Encoding"] = encoding;
  outgoing.writeHead(200, headers);
  const body = createReadStream(file);
  if (encoding === "br") body.pipe(createBrotliCompress()).pipe(outgoing);
  else if (encoding === "gzip") body.pipe(createGzip()).pipe(outgoing);
  else body.pipe(outgoing);
}).listen(port, "127.0.0.1", () => {
  console.log(`serving ${dist} on http://127.0.0.1:${port}, hub at ${hub.origin}`);
});
