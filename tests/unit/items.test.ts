import { describe, expect, it } from "vitest";
import {
  approvalRequestOf,
  approvalResponseOf,
  asItem,
  errorOf,
  messageText,
  toolResultOf,
} from "../../src/protocol/items";

describe("reading an item row", () => {
  it("reads the row the hub sends", () => {
    expect(
      asItem({
        id: "itm_1",
        seq: 3,
        type: "message",
        role: "user",
        content: "hi",
        turn_id: "trn",
        agent_id: null,
        created_at: 9,
      }),
    ).toEqual({
      id: "itm_1",
      seq: 3,
      type: "message",
      role: "user",
      content: "hi",
      turn_id: "trn",
      agent_id: null,
      created_at: 9,
    });
  });

  it("refuses a row missing its identity, and fills the rest with safe values", () => {
    expect(asItem({ seq: 1, type: "message" })).toBeNull();
    expect(asItem("not a row")).toBeNull();
    expect(asItem({ id: "i", seq: 1, type: "message" })).toMatchObject({
      role: "assistant",
      content: null,
      created_at: 0,
    });
  });
});

describe("message text", () => {
  it("shows a string as itself, a {text} as its text, and anything else as JSON", () => {
    expect(messageText("hello")).toBe("hello");
    expect(messageText({ text: "wrapped" })).toBe("wrapped");
    expect(messageText({ odd: 1 })).toBe('{\n  "odd": 1\n}');
    expect(messageText(undefined)).toBe("");
  });
});

describe("reading an approval card", () => {
  it("reads a single-call card", () => {
    const card = approvalRequestOf({
      approval_id: "apr_1",
      tool: "music.play",
      description: "Play what music.find found",
      permission: "music.playback",
      arguments: { track: "$found" },
    });
    expect(card).toMatchObject({ approval_id: "apr_1", permission: "music.playback", limit: null, steps: [] });
  });

  it("reads a many-call card with its limit and steps", () => {
    const card = approvalRequestOf({
      approval_id: "apr_2",
      tool: "agents.spawn",
      description: "Start a helper, 2 calls in this plan",
      limit: { field: "repository", values: ["a/b", "c/d"] },
      steps: [{ step: "s1", operation: "agents.spawn", arguments: {}, description: "researcher" }, "not a step"],
    });
    expect(card?.limit).toEqual({ field: "repository", values: ["a/b", "c/d"] });
    expect(card?.steps).toEqual([{ step: "s1", operation: "agents.spawn", arguments: {}, description: "researcher" }]);
    expect(card?.permission).toBe("agents.spawn");
    expect(card?.description).toContain("2 calls");
  });

  it("drops a limit with no values and a card with no id", () => {
    expect(approvalRequestOf({ approval_id: "apr", limit: { field: "x", values: [] } })?.limit).toBeNull();
    expect(approvalRequestOf({ tool: "x" })).toBeNull();
    expect(approvalRequestOf("words")).toBeNull();
  });
});

describe("reading an approval answer", () => {
  it("reads the hub's record of a decision", () => {
    expect(
      approvalResponseOf({ approval_id: "apr", approved: true, lifetime: "profile", instruction: "", only: ["a/b"] }),
    ).toEqual({ approval_id: "apr", approved: true, lifetime: "profile", instruction: "", only: ["a/b"] });
  });

  it("refuses a record without a decision in it", () => {
    expect(approvalResponseOf({ approval_id: "apr" })).toBeNull();
    expect(approvalResponseOf(null)).toBeNull();
  });

  it("defaults the lifetime to once", () => {
    expect(approvalResponseOf({ approval_id: "apr", approved: false })?.lifetime).toBe("once");
  });
});

describe("reading a step and an error", () => {
  it("reads an executed step", () => {
    expect(
      toolResultOf({ operation: "music.find", status: "ok", note: "Find it", summary: "1 track", duration_ms: 42 }),
    ).toMatchObject({
      operation: "music.find",
      status: "ok",
      duration_ms: 42,
    });
  });

  it("gives a step and an error safe shapes whatever arrived", () => {
    expect(toolResultOf(null)).toMatchObject({ operation: "a step", status: "unknown", duration_ms: null });
    expect(errorOf(null)).toEqual({ code: "error", detail: "" });
    expect(errorOf({ code: "bad_plan", detail: "the plan was refused" })).toEqual({
      code: "bad_plan",
      detail: "the plan was refused",
    });
  });
});
