import { describe, expect, it } from "vitest";
import { answerFor, LIFETIME_LABEL, MAX_INSTRUCTION } from "../../src/protocol/approvals";

describe("building the answer to a card", () => {
  it("builds a one-time yes with nothing extra on it", () => {
    expect(answerFor("apr_1", { approved: true })).toEqual({
      type: "input.approval",
      approval_id: "apr_1",
      approved: true,
      lifetime: "once",
    });
  });

  it("carries a limited standing yes", () => {
    expect(answerFor("apr_1", { approved: true, lifetime: "profile", only: ["a/b"] })).toMatchObject({
      lifetime: "profile",
      only: ["a/b"],
    });
  });

  it("refuses a limit on a one-time yes or a denial, as the hub would", () => {
    expect(() => answerFor("apr_1", { approved: true, only: ["a/b"] })).toThrow(/standing yes/);
    expect(() => answerFor("apr_1", { approved: false, only: ["a/b"] })).toThrow(/standing yes/);
  });

  it("makes every denial a once, whatever lifetime was chosen before the person flipped to deny", () => {
    expect(answerFor("apr_1", { approved: false, lifetime: "account" }).lifetime).toBe("once");
  });

  it("trims and caps the instruction, and drops an empty one", () => {
    expect(answerFor("apr_1", { approved: false, instruction: "  too loud  " }).instruction).toBe("too loud");
    expect(answerFor("apr_1", { approved: false, instruction: "   " })).not.toHaveProperty("instruction");
    const long = answerFor("apr_1", { approved: false, instruction: "x".repeat(MAX_INSTRUCTION + 10) });
    expect(long.instruction).toHaveLength(MAX_INSTRUCTION);
  });

  it("drops empty values from a limit, and an emptied limit entirely", () => {
    expect(answerFor("apr_1", { approved: true, lifetime: "account", only: ["", "a/b"] }).only).toEqual(["a/b"]);
    expect(answerFor("apr_1", { approved: true, only: [""] })).not.toHaveProperty("only");
  });

  it("has a label for every lifetime", () => {
    expect(Object.keys(LIFETIME_LABEL).sort()).toEqual(["account", "once", "profile", "session"]);
  });
});
