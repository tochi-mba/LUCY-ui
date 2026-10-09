/**
 * Following one conversation's event stream, and coming back after a drop.
 *
 * The cursor is the sequence number of the last event *handled*, and every reconnect sends it as
 * `?starting_after=`, which the hub prefers over `Last-Event-ID` (`stream/sse.py`). Events at or
 * below the cursor are skipped, so a replay after a reconnect never shows anything twice.
 *
 * Four frames are the connection's own and never move the cursor by themselves: the heartbeat
 * (no id), the snapshot (whose number is a position, adopted once as the starting cursor), the
 * resumed marker, and the stream error that names where to resume from when the reader fell
 * behind. A 401 stops following and says so; a 403 or 404 means the conversation is gone.
 */
import { EVENT, parseEvent } from "../protocol/events";
import { number } from "../protocol/guards";
import { SseParser } from "../protocol/sse";
import type { FollowHandlers, StreamState } from "./types";

export const MAX_BACKOFF_MS = 15_000;

export function backoff(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.max(0, failures - 1));
}

export interface FollowOptions {
  url: (cursor: number | null) => string;
  headers: () => Record<string, string>;
  fetch: typeof fetch;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  handlers: FollowHandlers;
  onUnauthorized?: () => void;
}

/** Why one connection ended, and so what the loop does next. */
type Ending = { kind: "dropped" } | { kind: "resume"; at: number };

export async function follow(options: FollowOptions): Promise<void> {
  const { signal, handlers } = options;
  const state = (value: StreamState) => handlers.onState?.(value);
  const cursor = { value: null as number | null };
  let failures = 0;
  while (!signal.aborted) {
    state(failures === 0 ? "connecting" : "reconnecting");
    let response: Response;
    try {
      response = await options.fetch(options.url(cursor.value), { headers: options.headers(), signal });
    } catch {
      if (signal.aborted) break;
      failures += 1;
      await options.sleep(backoff(failures), signal);
      continue;
    }
    if (response.status === 401) {
      options.onUnauthorized?.();
      state("unauthorized");
      return;
    }
    if (response.status === 403 || response.status === 404) {
      state("closed");
      return;
    }
    if (!response.ok || response.body === null) {
      failures += 1;
      await options.sleep(backoff(failures), signal);
      continue;
    }
    failures = 0;
    state("open");
    const ending = await read(response.body, cursor, handlers);
    if (signal.aborted) break;
    if (ending.kind === "resume") {
      cursor.value = ending.at;
      continue;
    }
    failures += 1;
    state("reconnecting");
    await options.sleep(backoff(failures), signal);
  }
  state("closed");
}

async function read(
  body: ReadableStream<Uint8Array>,
  cursor: { value: number | null },
  handlers: FollowHandlers,
): Promise<Ending> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { kind: "dropped" };
      for (const frame of parser.push(value)) {
        const event = parseEvent(frame);
        if (event === null || event.type === EVENT.heartbeat) continue;
        if (event.type === EVENT.streamError) {
          const at = number(event.data.starting_after);
          if (at !== null) return { kind: "resume", at };
          continue;
        }
        if (event.type === EVENT.streamDone) return { kind: "dropped" };
        if (event.type === EVENT.snapshot || event.type === EVENT.resumed) {
          if (event.type === EVENT.snapshot && cursor.value === null && event.sequence_number !== undefined) {
            cursor.value = event.sequence_number;
          }
          handlers.onEvent(event);
          continue;
        }
        const sequence = event.sequence_number;
        if (sequence !== undefined && cursor.value !== null && sequence <= cursor.value) continue;
        handlers.onEvent(event);
        if (sequence !== undefined) cursor.value = sequence;
      }
    }
  } catch {
    return { kind: "dropped" };
  } finally {
    reader.releaseLock();
  }
}

/** A sleep that an abort cuts short, so closing a conversation never waits out a backoff. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}
