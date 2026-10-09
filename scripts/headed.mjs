/**
 * Drive a conversation the UI can watch: the headed harness (docs/headed.md).
 *
 *   node scripts/headed.mjs new "smoke"            -> prints the session id
 *   node scripts/headed.mjs say <session_id> "hi"  -> prints Lucy's reply
 *   node scripts/headed.mjs watch <session_id>     -> tails the event stream
 *
 * Sessions it creates are titled "Claude Code · <topic>", which is how the UI labels their human
 * side. The hub is LUCY_URL (default http://127.0.0.1:8000); the token is LUCY_TOKEN or the one
 * `lucy setup` saved. The token is read, used in a header, and never printed.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { HEADED_PREFIX } from "../src/protocol/headed.ts";
import { SseParser } from "../src/protocol/sse.ts";
import {
  configPath,
  OK,
  parseArgs,
  REFUSED,
  ReplyCollector,
  UNREACHABLE,
  USAGE,
  watchLine,
} from "./lib/headed-core.mjs";

const url = (process.env.LUCY_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

function savedToken() {
  if (process.env.LUCY_TOKEN) return process.env.LUCY_TOKEN;
  try {
    return (
      readFileSync(configPath(process.env, homedir()), "utf8")
        .split(/\r?\n/)
        .map((line) => /^\s*token\s*=\s*"([^"]*)"\s*$/.exec(line))
        .find((match) => match)?.[1] ?? null
    );
  } catch {
    return null;
  }
}

const token = savedToken();
if (!token) {
  console.error("not signed in: set LUCY_TOKEN, or run `lucy setup` so there is a saved token");
  process.exit(REFUSED);
}

async function call(method, path, body, headers = {}) {
  let response;
  try {
    response = await fetch(url + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    console.error(`cannot reach Lucy at ${url}`);
    process.exit(UNREACHABLE);
  }
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(answer.detail ?? answer.title ?? `Lucy answered ${response.status}`);
    process.exit(REFUSED);
  }
  return answer;
}

async function followTurn(sessionId, turnId) {
  const collector = new ReplyCollector(turnId);
  let response;
  try {
    response = await fetch(`${url}/v1/sessions/${encodeURIComponent(sessionId)}/events`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    });
  } catch {
    console.error(`cannot reach Lucy at ${url}`);
    process.exit(UNREACHABLE);
  }
  if (!response.ok || response.body === null) {
    console.error("the event stream was refused");
    process.exit(REFUSED);
  }
  const parser = new SseParser();
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    for (const frame of parser.push(chunk)) {
      let event;
      try {
        event = JSON.parse(frame.data);
      } catch {
        continue;
      }
      while (collector.notices.length) console.error(collector.notices.shift());
      const outcome = collector.feed(event);
      while (collector.notices.length) console.error(collector.notices.shift());
      if (outcome.done) {
        if (outcome.code === OK) console.log(outcome.text);
        else console.error(outcome.text);
        process.exit(outcome.code);
      }
    }
  }
  console.error("the stream ended before the turn did");
  process.exit(REFUSED);
}

const asked = parseArgs(process.argv.slice(2));
if ("error" in asked) {
  console.error(asked.error);
  process.exit(USAGE);
}

if (asked.command === "new") {
  const topic = asked.topic || "conversation";
  const session = await call(
    "POST",
    "/v1/sessions",
    { title: (HEADED_PREFIX + topic).slice(0, 200) },
    { "Idempotency-Key": crypto.randomUUID() },
  );
  console.error(`created "${session.title}"`);
  console.log(session.id);
  process.exit(OK);
}

if (asked.command === "say") {
  const turn = await call(
    "POST",
    `/v1/sessions/${encodeURIComponent(asked.sessionId)}/inputs`,
    { events: [{ type: "input.message", content: asked.text }] },
    { "Idempotency-Key": crypto.randomUUID() },
  );
  await followTurn(asked.sessionId, turn.id);
}

if (asked.command === "watch") {
  const response = await fetch(`${url}/v1/sessions/${encodeURIComponent(asked.sessionId)}/events`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
  }).catch(() => null);
  if (response === null || !response.ok || response.body === null) {
    console.error("the event stream was refused");
    process.exit(REFUSED);
  }
  const parser = new SseParser();
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    for (const frame of parser.push(chunk)) {
      try {
        console.log(watchLine(JSON.parse(frame.data)));
      } catch {
        // a heartbeat comment or a half frame: nothing to say
      }
    }
  }
}
