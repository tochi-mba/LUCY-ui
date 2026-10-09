import { describe, expect, it } from "vitest";
import { HEADED_PREFIX, headedTitle, isHeaded, speakerFor } from "../../src/protocol/headed";

describe("headed conversations", () => {
  it("titles a headed conversation with the prefix the UI looks for", () => {
    expect(headedTitle("smoke")).toBe("Claude Code · smoke");
    expect(isHeaded(headedTitle("smoke"))).toBe(true);
  });

  it("names an empty topic, and keeps the title inside the hub's cap", () => {
    expect(headedTitle("   ")).toBe(`${HEADED_PREFIX}conversation`);
    expect(headedTitle("x".repeat(400))).toHaveLength(200);
  });

  it("labels the human side by the title", () => {
    expect(speakerFor("Claude Code · smoke")).toBe("Claude Code");
    expect(speakerFor("Music for the evening")).toBe("You");
    expect(speakerFor(null)).toBe("You");
  });
});
