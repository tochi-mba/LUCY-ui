import { describe, expect, it } from "vitest";
import { MOOD_TEXT, MOODS, type MoodInput, moodFor, OUTCOME_MS } from "../../src/face/moods";

const base: MoodInput = {
  signedIn: true,
  hasSession: true,
  stream: "open",
  turn: "idle",
  pendingCards: 0,
  connectionNeeded: false,
  speaking: false,
  working: false,
  composing: false,
  outcome: null,
  now: 10_000,
};

describe("what the face shows", () => {
  it("sleeps signed out, whatever else is true", () => {
    expect(moodFor({ ...base, signedIn: false, speaking: true, pendingCards: 3 })).toBe("asleep");
  });

  it("is idle or attentive outside a conversation", () => {
    expect(moodFor({ ...base, hasSession: false })).toBe("idle");
    expect(moodFor({ ...base, hasSession: false, composing: true })).toBe("attentive");
  });

  it("shows a lost connection above everything in the conversation", () => {
    for (const stream of ["reconnecting", "unauthorized", "closed"] as const) {
      expect(moodFor({ ...base, stream, speaking: true, pendingCards: 1 })).toBe("disconnected");
    }
  });

  it("needs the person for a card, a connection, or a parked turn", () => {
    expect(moodFor({ ...base, pendingCards: 1, speaking: true })).toBe("needs_you");
    expect(moodFor({ ...base, connectionNeeded: true })).toBe("needs_you");
    expect(moodFor({ ...base, turn: "input_required" })).toBe("needs_you");
    expect(moodFor({ ...base, turn: "auth_required" })).toBe("needs_you");
  });

  it("speaks while text arrives, over the turn's own status", () => {
    expect(moodFor({ ...base, speaking: true, turn: "running" })).toBe("speaking");
  });

  it("acknowledges a queued message and thinks or works while running", () => {
    expect(moodFor({ ...base, turn: "queued" })).toBe("sent");
    expect(moodFor({ ...base, turn: "running" })).toBe("thinking");
    expect(moodFor({ ...base, turn: "running", working: true })).toBe("working");
  });

  it("holds an ending for a moment, then settles", () => {
    const outcome = { kind: "done" as const, at: 10_000 };
    expect(moodFor({ ...base, turn: "completed", outcome, now: 10_000 + OUTCOME_MS - 1 })).toBe("done");
    expect(moodFor({ ...base, turn: "completed", outcome, now: 10_000 + OUTCOME_MS })).toBe("idle");
    expect(moodFor({ ...base, turn: "failed", outcome: { kind: "failed", at: 10_000 } })).toBe("failed");
    expect(moodFor({ ...base, outcome: { kind: "blocked", at: 10_000 } })).toBe("blocked");
  });

  it("is attentive to a draft when nothing else is happening", () => {
    expect(moodFor({ ...base, composing: true })).toBe("attentive");
    expect(moodFor(base)).toBe("idle");
  });

  it("has a sentence for every mood", () => {
    for (const mood of MOODS) expect(MOOD_TEXT[mood].length).toBeGreaterThan(0);
  });
});
