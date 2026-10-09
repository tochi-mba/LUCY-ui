import { describe, expect, it } from "vitest";
import { expiryOf } from "../../src/protocol/jwt";

function token(claims: object): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `eyJhbGciOiJSUzI1NiJ9.${body}.signature`;
}

describe("reading a token's expiry", () => {
  it("reads exp as epoch milliseconds", () => {
    expect(expiryOf(token({ exp: 1700000000 }))).toBe(1700000000000);
  });

  it("answers null for a token that does not say, or cannot be read", () => {
    expect(expiryOf(token({ sub: "acct" }))).toBeNull();
    expect(expiryOf(token({ exp: "soon" }))).toBeNull();
    expect(expiryOf("no-dots")).toBeNull();
    expect(expiryOf("a.!!!not-base64!!!.c")).toBeNull();
    expect(expiryOf(`a.${Buffer.from("not json").toString("base64url")}.c`)).toBeNull();
  });
});
