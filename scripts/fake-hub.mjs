/**
 * The fake hub over HTTP: `node scripts/fake-hub.mjs [port]`.
 *
 * A thin wrapper over scripts/lib/fakehub.mjs, which owns every decision and is the tested part.
 * The e2e suite points the preview server's proxy here; `npm run dev:fake` points the dev server
 * here. `POST /__fake/approve {"user_code": "..."}` plays the part of `lucy approve`, and the
 * device flow also self-approves after two polls so an unattended run signs in by waiting.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFrame, FakeHub, heartbeatFrame, OPENING } from "./lib/fakehub.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "conversations");
const fixtures = Object.fromEntries(
  readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(join(fixturesDir, name), "utf8"))]),
);

const hub = new FakeHub({ fixtures });
const port = Number(process.argv[2] ?? process.env.FAKE_HUB_PORT ?? 8765);

function json(response, answer) {
  response.writeHead(answer.status, { "Content-Type": "application/json" });
  response.end(answer.body === null ? "" : JSON.stringify(answer.body));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const path = url.pathname;
  const method = request.method ?? "GET";

  if (path === "/healthy") return json(response, { status: 200, body: { status: "alive", version: "fake" } });
  if (path === "/ready") return json(response, { status: 200, body: { status: "ok", checks: {} } });
  if (method === "POST" && path === "/v1/auth/device") return json(response, hub.startDevice());
  if (method === "POST" && path === "/v1/auth/device/token")
    return json(response, hub.pollDevice((await body(request)).device_code));
  if (method === "POST" && (path === "/__fake/approve" || path === "/v1/auth/device/authorize")) {
    const asked = await body(request);
    return json(response, hub.decideDevice(asked.user_code, asked.approve !== false));
  }
  if (method === "GET" && path === "/v1/me") return json(response, hub.me());
  if (method === "GET" && path === "/v1/sessions") return json(response, hub.listSessions());
  if (method === "POST" && path === "/v1/sessions") return json(response, hub.createSession(await body(request)));

  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "v1" && parts[1] === "sessions" && parts[2] !== undefined) {
    const sessionId = decodeURIComponent(parts[2]);
    if (method === "PATCH" && parts.length === 3)
      return json(response, hub.updateSession(sessionId, await body(request)));
    if (method === "GET" && parts[3] === "items") {
      return json(response, hub.listItems(sessionId, Object.fromEntries(url.searchParams)));
    }
    if (method === "POST" && parts[3] === "inputs") {
      return json(response, hub.submitInput(sessionId, await body(request), request.headers["idempotency-key"]));
    }
    if (method === "GET" && parts[3] === "events") {
      const startingAfter = url.searchParams.has("starting_after")
        ? Number(url.searchParams.get("starting_after"))
        : null;
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      });
      response.write(OPENING);
      const unsubscribe = hub.subscribe(sessionId, startingAfter, (event) => response.write(encodeFrame(event)));
      if (unsubscribe === null) {
        response.end();
        return;
      }
      const heartbeat = setInterval(() => response.write(heartbeatFrame(sessionId)), 15000);
      request.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }
  }
  if (parts[0] === "v1" && parts[1] === "turns" && parts[3] === "cancel" && method === "POST") {
    return json(response, hub.cancelTurn(decodeURIComponent(parts[2])));
  }
  return json(response, { status: 404, body: { title: "Not found", detail: `The fake hub does not serve ${path}.` } });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake hub listening on http://127.0.0.1:${port} (self-approving device codes)`);
});
