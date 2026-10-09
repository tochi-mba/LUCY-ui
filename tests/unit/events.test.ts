import { describe, expect, it } from "vitest";
import { blockIdOf, EVENT, isKnownEvent, type LucyEvent, parseEvent } from "../../src/protocol/events";

const frame = (data: string) => ({ event: "x", data });

describe("parsing an event envelope", () => {
  it("reads the fields the hub writes, and only the optional ones that apply", () => {
    const event = parseEvent(
      frame(
        JSON.stringify({
          type: "lucy.turn.started",
          sequence_number: 12,
          session_id: "ses_1",
          created_at: 5.5,
          data: { a: 1 },
          turn_id: "trn_1",
        }),
      ),
    );
    expect(event).toEqual({
      type: "lucy.turn.started",
      sequence_number: 12,
      session_id: "ses_1",
      created_at: 5.5,
      data: { a: 1 },
      turn_id: "trn_1",
    });
    expect(event).not.toHaveProperty("agent_id");
  });

  it("keeps an agent id when one applies", () => {
    const event = parseEvent(frame(JSON.stringify({ type: "t", session_id: "s", agent_id: "agt_1" })));
    expect(event?.agent_id).toBe("agt_1");
  });

  it("answers null for bodies that are not events, never an exception", () => {
    expect(parseEvent(frame("not json"))).toBeNull();
    expect(parseEvent(frame('"a string"'))).toBeNull();
    expect(parseEvent(frame(JSON.stringify({ no_type: true })))).toBeNull();
  });

  it("fills missing envelope fields with safe values", () => {
    const event = parseEvent(frame(JSON.stringify({ type: "t", data: "not a record" })));
    expect(event).toEqual({ type: "t", session_id: "", created_at: 0, data: {} });
  });
});

describe("the block a delta belongs to", () => {
  const base: LucyEvent = { type: EVENT.textDelta, session_id: "ses", created_at: 0, data: {} };
  it("prefers the block's own id, then the turn, then the session", () => {
    expect(blockIdOf({ ...base, data: { id: "blk" }, turn_id: "trn" })).toBe("blk");
    expect(blockIdOf({ ...base, turn_id: "trn" })).toBe("trn");
    expect(blockIdOf(base)).toBe("ses");
  });
});

describe("the known-event list", () => {
  it("knows its own vocabulary and nothing else", () => {
    expect(isKnownEvent(EVENT.itemAdded)).toBe(true);
    expect(isKnownEvent("lucy.memory.written")).toBe(false);
  });
});
