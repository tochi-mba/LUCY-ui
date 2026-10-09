import { describe, expect, it } from "vitest";
import { byActivity, isLive, liveSession, type Session } from "../../src/protocol/sessions";

function session(id: string, status: string, updatedAt: number, archived = false): Session {
  return {
    id,
    profile: "personal",
    title: id,
    status,
    model: "m",
    permission_mode: "ask",
    input_policy: "enqueue",
    created_at: 0,
    updated_at: updatedAt,
    archived_at: archived ? 1 : null,
    input_tokens: 0,
    output_tokens: 0,
    cost_micros: 0,
  };
}

describe("ordering and liveness", () => {
  it("orders by what moved last, with the id as a stable tiebreak", () => {
    const ordered = byActivity([session("a", "idle", 1), session("c", "idle", 2), session("b", "idle", 2)]);
    expect(ordered.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("calls a session live while a turn is queued, running or parked", () => {
    for (const status of ["queued", "running", "input_required", "auth_required"])
      expect(isLive(session("s", status, 0))).toBe(true);
    expect(isLive(session("s", "idle", 0))).toBe(false);
  });

  it("follows the most recently moved live, unarchived session", () => {
    const live = liveSession([
      session("old", "running", 1),
      session("new", "queued", 5),
      session("hidden", "running", 9, true),
    ]);
    expect(live?.id).toBe("new");
    expect(liveSession([session("a", "idle", 1)])).toBeNull();
  });
});
