import { describe, expect, it } from "vitest";
import { LucyError, Unreachable } from "../../src/transport/errors";
import { HttpTransport, newKey, queryString } from "../../src/transport/http";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function transportWith(answers: (Response | Error)[], options: { token?: string | null } = {}) {
  const seen: Seen[] = [];
  let unauthorized = 0;
  const transport = new HttpTransport({
    token: () => (options.token === undefined ? "tok" : options.token),
    onUnauthorized: () => {
      unauthorized += 1;
    },
    fetch: (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === "string" ? init.body : null,
      });
      const next = answers.shift() ?? new Error("exhausted");
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    sleep: () => Promise.resolve(),
  });
  return { transport, seen, unauthorized: () => unauthorized };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("the HTTP transport", () => {
  it("sends the bearer and asks for JSON", async () => {
    const { transport, seen } = transportWith([ok({ account_id: "acct", audience: "lucy-api" })]);
    await transport.me();
    expect(seen[0]).toMatchObject({
      url: "/v1/me",
      headers: { Authorization: "Bearer tok", Accept: "application/json" },
    });
  });

  it("sends no bearer when signed out, and none on the device routes", async () => {
    const { transport, seen } = transportWith([ok({}), ok({})], { token: null });
    await transport.me();
    await transport.startDevice();
    expect(seen[0]!.headers).not.toHaveProperty("Authorization");
    expect(seen[1]!.headers).not.toHaveProperty("Authorization");
  });

  it("creates a session with an idempotency key and the body as JSON", async () => {
    const { transport, seen } = transportWith([ok({ id: "ses" })]);
    await transport.createSession({ title: "Hello" });
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.headers["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/);
    expect(seen[0]!.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(seen[0]!.body!)).toEqual({ title: "Hello" });
  });

  it("sends input events under the caller's key, so a retry is the same turn", async () => {
    const { transport, seen } = transportWith([ok({ id: "trn" })]);
    await transport.send("ses", [{ type: "input.message", content: "hi" }], "key-1");
    expect(seen[0]).toMatchObject({ url: "/v1/sessions/ses/inputs", method: "POST" });
    expect(seen[0]!.headers["Idempotency-Key"]).toBe("key-1");
  });

  it("escapes ids on the path", async () => {
    const { transport, seen } = transportWith([ok({ data: [] })]);
    await transport.listItems("a/b");
    expect(seen[0]!.url).toBe("/v1/sessions/a%2Fb/items");
  });

  it("drops rows that are not items", async () => {
    const { transport } = transportWith([
      ok({ data: [{ id: "i", seq: 1, type: "message" }, "junk"], has_more: false }),
    ]);
    const page = await transport.listItems("ses");
    expect(page.data).toHaveLength(1);
  });

  it("turns a refusal into a LucyError and tells the auth about a 401", async () => {
    const { transport, unauthorized } = transportWith([
      new Response(JSON.stringify({ detail: "expired" }), { status: 401 }),
    ]);
    await expect(transport.me()).rejects.toMatchObject({ status: 401, message: "expired" });
    expect(unauthorized()).toBe(1);
  });

  it("does not call a 401 on the device poll unauthorized", async () => {
    const { transport, unauthorized } = transportWith([
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }),
    ]);
    await expect(transport.pollDevice("dev")).resolves.toEqual({ status: "pending" });
    expect(unauthorized()).toBe(0);
  });

  it("maps every device-poll answer", async () => {
    const bodies = [
      [200, { access_token: "tok2" }, { status: "approved", token: "tok2" }],
      [400, { error: "slow_down" }, { status: "slow_down" }],
      [400, { error: "access_denied" }, { status: "denied" }],
      [400, { error: "expired_token" }, { status: "expired" }],
      [400, { error: "???" }, { status: "expired" }],
      [400, undefined, { status: "expired" }],
    ] as const;
    for (const [status, body, expected] of bodies) {
      const { transport } = transportWith([new Response(body === undefined ? "{" : JSON.stringify(body), { status })]);
      await expect(transport.pollDevice("dev")).resolves.toEqual(expected);
    }
  });

  it("retries once after the Retry-After of a 503, then reports a second refusal", async () => {
    const retryable = () =>
      new Response(JSON.stringify({ detail: "keyring blipped" }), { status: 503, headers: { "Retry-After": "1" } });
    const { transport, seen } = transportWith([retryable(), ok({ account_id: "a", audience: "x" })]);
    await transport.me();
    expect(seen).toHaveLength(2);
    const twice = transportWith([retryable(), retryable()]);
    await expect(twice.transport.me()).rejects.toBeInstanceOf(LucyError);
  });

  it("reports a 503 with no Retry-After without retrying", async () => {
    const { transport, seen } = transportWith([new Response("{}", { status: 503 })]);
    await expect(transport.me()).rejects.toBeInstanceOf(LucyError);
    expect(seen).toHaveLength(1);
  });

  it("turns a network failure into Unreachable", async () => {
    const { transport } = transportWith([new Error("refused")]);
    await expect(transport.me()).rejects.toBeInstanceOf(Unreachable);
  });

  it("answers undefined for a 204", async () => {
    const { transport } = transportWith([new Response(null, { status: 204 })]);
    await expect(transport.cancelTurn("trn")).resolves.toBeUndefined();
  });

  it("builds query strings only from what was asked", () => {
    expect(queryString({})).toBe("");
    expect(queryString({ order: "desc", limit: 50 })).toBe("?order=desc&limit=50");
    expect(queryString({ after: "" })).toBe("");
  });

  it("lists sessions with the query", async () => {
    const { transport, seen } = transportWith([ok({ data: [] })]);
    await transport.listSessions({ order: "desc" });
    expect(seen[0]!.url).toBe("/v1/sessions?order=desc");
  });

  it("patches a session", async () => {
    const { transport, seen } = transportWith([ok({ id: "ses" })]);
    await transport.updateSession("ses", { archived: true });
    expect(seen[0]).toMatchObject({ url: "/v1/sessions/ses", method: "PATCH" });
  });

  it("follows the events route with the cursor and the stream accept header", async () => {
    const { transport, seen } = transportWith([new Response(null, { status: 404 })]);
    await transport.follow("ses", { onEvent: () => {} }, new AbortController().signal);
    expect(seen[0]!.url).toBe("/v1/sessions/ses/events");
    expect(seen[0]!.headers).toMatchObject({ Accept: "text/event-stream", Authorization: "Bearer tok" });
  });

  it("mints distinct idempotency keys", () => {
    expect(newKey()).not.toBe(newKey());
  });
});
