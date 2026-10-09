import { describe, expect, it } from "vitest";
import { describe as describeError, errorFrom, LucyError, Unreachable } from "../../src/transport/errors";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? "not json {" : JSON.stringify(body), { status, headers });
}

describe("reading a refusal", () => {
  it("reads a problem document", async () => {
    const error = await errorFrom(
      response(409, { type: "turn-busy", title: "Conflict", detail: "Lucy is busy", request_id: "req_1" }),
    );
    expect(error).toMatchObject({ status: 409, message: "Lucy is busy", problem: "turn-busy", requestId: "req_1" });
  });

  it("reads an OAuth device body, whose vocabulary is different on purpose", async () => {
    const error = await errorFrom(response(400, { error: "access_denied", error_description: "denied by the person" }));
    expect(error.message).toBe("denied by the person");
    expect(error.problem).toBe("access_denied");
  });

  it("falls back to a sentence per status, and reads Retry-After and the header request id", async () => {
    const error = await errorFrom(response(503, {}, { "Retry-After": "5", "X-Request-ID": "req_h" }));
    expect(error.message).toMatch(/unavailable/);
    expect(error.retryAfter).toBe(5);
    expect(error.requestId).toBe("req_h");
  });

  it("survives a body that is not JSON and a status it has no sentence for", async () => {
    const error = await errorFrom(response(418, undefined));
    expect(error.message).toBe("Lucy answered 418.");
    expect(error.retryAfter).toBeNull();
  });

  it("uses the title when there is no detail", async () => {
    expect((await errorFrom(response(400, { title: "Bad request" }))).message).toBe("Bad request");
  });
});

describe("one sentence for a person", () => {
  it("speaks each kind", () => {
    expect(describeError(new LucyError(401, "refused"))).toBe("refused");
    expect(describeError(new Unreachable())).toMatch(/reached/);
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError(new Error(""))).toBe("Something went wrong.");
    expect(describeError("odd")).toBe("Something went wrong.");
  });
});
