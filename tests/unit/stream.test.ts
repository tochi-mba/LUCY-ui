import { describe, expect, it } from "vitest";
import type { LucyEvent } from "../../src/protocol/events";
import { abortableSleep, backoff, follow, MAX_BACKOFF_MS } from "../../src/transport/stream";
import type { StreamState } from "../../src/transport/types";

function sse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const event = (type: string, sequence: number | null, data: object = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, session_id: "ses", created_at: 0, data, ...(sequence === null ? {} : { sequence_number: sequence }) })}\n\n`;

const snapshot = (position: number) =>
  `event: lucy.stream.snapshot\ndata: ${JSON.stringify({ type: "lucy.stream.snapshot", sequence_number: position, session_id: "ses", created_at: 0, data: { state: {}, sequence_number: position } })}\n\n`;

interface Run {
  urls: string[];
  seen: LucyEvent[];
  states: StreamState[];
  unauthorized: number;
}

async function run(responses: (Response | Error)[], options: { abortAfter?: number } = {}): Promise<Run> {
  const record: Run = { urls: [], seen: [], states: [], unauthorized: 0 };
  const controller = new AbortController();
  let calls = 0;
  await follow({
    url: (cursor) => (cursor === null ? "/events" : `/events?starting_after=${cursor}`),
    headers: () => ({}),
    fetch: (input) => {
      record.urls.push(String(input));
      const next = responses[calls];
      calls += 1;
      // Out of scripted responses: the test is over, so the loop is told to stop before it
      // retries into nothing. A rejected promise alone would spin the microtask queue forever.
      if (next === undefined) {
        controller.abort();
        return Promise.reject(new Error("exhausted"));
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    // After the chosen number of connections, the next pause ends the run instead of waiting.
    sleep: () => {
      if (calls >= (options.abortAfter ?? responses.length)) controller.abort();
      return Promise.resolve();
    },
    signal: controller.signal,
    handlers: {
      onEvent: (seen) => record.seen.push(seen),
      onState: (state) => record.states.push(state),
    },
    onUnauthorized: () => {
      record.unauthorized += 1;
    },
  });
  return record;
}

describe("following a stream", () => {
  it("adopts the snapshot's position and resumes from the last event handled", async () => {
    const result = await run([
      sse([snapshot(4), event("lucy.turn.started", 5)]),
      sse([snapshot(9), event("lucy.turn.completed", 9)]),
    ]);
    expect(result.urls).toEqual(["/events", "/events?starting_after=5"]);
    expect(result.seen.map((e) => e.type)).toEqual([
      "lucy.stream.snapshot",
      "lucy.turn.started",
      "lucy.stream.snapshot",
      "lucy.turn.completed",
    ]);
  });

  it("skips a replayed event at or below the cursor, so nothing is shown twice", async () => {
    const result = await run([
      sse([snapshot(0), event("a", 1), event("b", 2)]),
      sse([snapshot(2), event("b", 2), event("c", 3)]),
    ]);
    expect(result.seen.filter((e) => e.type === "b")).toHaveLength(1);
    expect(result.seen.map((e) => e.type)).toContain("c");
  });

  it("drops heartbeats, and frames that are not events, without moving anything", async () => {
    const result = await run([
      sse([
        "retry: 3000\n: lucy\n\n",
        "event: lucy.stream.heartbeat\ndata: {}\n\n",
        "data: not json\n\n",
        event("a", 1),
      ]),
    ]);
    expect(result.seen.map((e) => e.type)).toEqual(["a"]);
  });

  it("resumes where a slow-consumer error says to", async () => {
    const result = await run([
      sse([snapshot(0), event("lucy.stream.error", null, { reason: "slow_consumer", starting_after: 7 })]),
      sse([snapshot(7)]),
    ]);
    expect(result.urls[1]).toBe("/events?starting_after=7");
  });

  it("reconnects when the hub closes the stream deliberately", async () => {
    const result = await run([sse([snapshot(0), event("lucy.stream.done", null)]), sse([snapshot(0)])]);
    expect(result.urls).toHaveLength(2);
  });

  it("stops and says so on a 401, and closes quietly on a 404", async () => {
    const refused = await run([new Response(null, { status: 401 })]);
    expect(refused.unauthorized).toBe(1);
    expect(refused.states.at(-1)).toBe("unauthorized");
    const gone = await run([new Response(null, { status: 404 })]);
    expect(gone.states.at(-1)).toBe("closed");
    expect(gone.unauthorized).toBe(0);
  });

  it("retries a failed connect and a refused status, and reports reconnecting", async () => {
    const result = await run([new Error("down"), new Response(null, { status: 500 }), sse([snapshot(0)])]);
    expect(result.urls).toHaveLength(3);
    expect(result.states).toContain("reconnecting");
  });

  it("treats a stream error without a resume point as noise", async () => {
    const result = await run([sse([snapshot(0), event("lucy.stream.error", null, { reason: "odd" }), event("a", 1)])]);
    expect(result.seen.map((e) => e.type)).toEqual(["lucy.stream.snapshot", "a"]);
  });

  it("stops at the abort signal", async () => {
    const result = await run([sse([snapshot(0)])], { abortAfter: 1 });
    expect(result.states.at(-1)).toBe("closed");
    expect(result.urls).toHaveLength(1);
  });

  it("survives a body that errors mid-read", async () => {
    const broken = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(event("a", 1)));
          controller.error(new Error("cut"));
        },
      }),
      { status: 200 },
    );
    const result = await run([broken, sse([snapshot(1)])]);
    // Whether the chunk before the error is delivered is the engine's choice; the promise the
    // design makes is that the drop is survived and the stream is followed again.
    expect(result.urls).toHaveLength(2);
    expect(result.seen.map((e) => e.type)).toContain("lucy.stream.snapshot");
  });

  it("keeps a second snapshot from rewinding the cursor it already adopted", async () => {
    const result = await run([sse([snapshot(4), snapshot(0), event("a", 5)])]);
    expect(result.seen.map((e) => e.type)).toEqual(["lucy.stream.snapshot", "lucy.stream.snapshot", "a"]);
  });
});

describe("the backoff", () => {
  it("doubles from half a second and caps at fifteen", () => {
    expect(backoff(1)).toBe(500);
    expect(backoff(2)).toBe(1000);
    expect(backoff(10)).toBe(MAX_BACKOFF_MS);
  });
});

describe("the abortable sleep", () => {
  it("ends early on abort, and at once when already aborted", async () => {
    const controller = new AbortController();
    const sleeping = abortableSleep(60_000, controller.signal);
    controller.abort();
    await sleeping;
    await abortableSleep(60_000, controller.signal);
  });

  it("ends on its own when nothing aborts", async () => {
    await abortableSleep(1, new AbortController().signal);
  });
});
