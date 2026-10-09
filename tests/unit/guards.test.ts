import { describe, expect, it } from "vitest";
import { isRecord, number, optionalText, text, texts } from "../../src/protocol/guards";

describe("wire guards", () => {
  it("knows a record from everything else", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("reads text with a fallback", () => {
    expect(text("a")).toBe("a");
    expect(text(1, "fallback")).toBe("fallback");
    expect(optionalText("a")).toBe("a");
    expect(optionalText(1)).toBeNull();
  });

  it("reads only finite numbers", () => {
    expect(number(3)).toBe(3);
    expect(number(Number.NaN)).toBeNull();
    expect(number("3")).toBeNull();
  });

  it("keeps only the strings of a list", () => {
    expect(texts(["a", 1, "b", null])).toEqual(["a", "b"]);
    expect(texts("not a list")).toEqual([]);
  });
});
