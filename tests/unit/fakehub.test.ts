import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  accountOf,
  encodeFrame,
  FakeHub,
  fakeToken,
  fixtureFor,
  heartbeatFrame,
  OPENING,
} from "../../scripts/lib/fakehub.mjs";
import { isKnownEvent } from "../../src/protocol/events";
import { expiryOf } from "../../src/protocol/jwt";
import { SseParser } from "../../src/protocol/sse";

const fixturesDir = join(__dirname, "..", "..", "fixtures", "conversations");
const fixtures = Object.fromEntries(
  readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(join(fixturesDir, name), "utf8"))]),
);

/** Runs scripted steps immediately, in order, like a hub with no latency. */
function instantHub(options: Partial<ConstructorParameters<typeof FakeHub>[0]> = {}) {
  const queue: (() => void)[] = [];
  const hub = new FakeHub({
    fixtures,
    schedule: (fn: () => void) => queue.push(fn),
    now: () => 1_000_000,
    ...options,
  });
  const drain = () => {
    while (queue.length) queue.shift()!();
  };
  return { hub, drain };
}

describe("the fixtures themselves", () => {
  it("use only event names the UI knows, in every branch", () => {
    const names = new Set<string>();
    const walk = (steps: unknown[]) => {
      for (const step of steps as Record<string, unknown>[]) {
        if (typeof step.type === "string" && step.type.startsWith("lucy.")) names.add(step.type);
        if (Array.isArray(step.approved)) walk(step.approved);
        if (Array.isArray(step.denied)) walk(step.denied);
      }
    };
    for (const fixture of Object.values(fixtures)) walk((fixture as { reply: unknown[] }).reply);
    expect(names.size).toBeGreaterThan(3);
    for (const name of names) expect(isKnownEvent(name), name).toBe(true);
  });

  it("are picked by words in the title, with greeting as the default", () => {
    expect(fixtureFor("Play some Asake", fixtures)).toBe(fixtures["music-approval"]);
    expect(fixtureFor("watch this fail", fixtures)).toBe(fixtures["failed-turn"]);
    expect(fixtureFor("connect spotify", fixtures)).toBe(fixtures["connection-required"]);
    expect(fixtureFor("anything else", fixtures)).toBe(fixtures.greeting);
    expect(fixtureFor(undefined, fixtures)).toBe(fixtures.greeting);
  });
});

describe("the device flow", () => {
  it("self-approves after the configured number of polls", () => {
    const { hub } = instantHub();
    const started = hub.startDevice();
    expect(started.status).toBe(201);
    const code = (started.body as { device_code: string }).device_code;
    expect(hub.pollDevice(code).body).toMatchObject({ error: "authorization_pending" });
    const approved = hub.pollDevice(code);
    expect(approved.status).toBe(200);
    const token = (approved.body as { access_token: string }).access_token;
    expect(expiryOf(token)).toBe(1_000_000 + 15 * 60 * 1000);
    expect(hub.pollDevice(code).body).toMatchObject({ error: "expired_token" });
  });

  it("is approved or denied by user code, like lucy approve", () => {
    const { hub } = instantHub({ approvePolls: 0 });
    const first = hub.startDevice().body as { device_code: string; user_code: string };
    expect(hub.pollDevice(first.device_code).body).toMatchObject({ error: "authorization_pending" });
    expect(hub.decideDevice(first.user_code).status).toBe(204);
    expect(hub.pollDevice(first.device_code).status).toBe(200);

    const second = hub.startDevice().body as { device_code: string; user_code: string };
    hub.decideDevice(second.user_code, false);
    expect(hub.pollDevice(second.device_code).body).toMatchObject({ error: "access_denied" });
    expect(hub.decideDevice("WRONG-0000").status).toBe(400);
  });

  it("answers who the fake account is", () => {
    const { hub } = instantHub();
    expect(hub.me().body).toEqual({ account_id: "acct_fake", audience: "lucy-api" });
  });
});

describe("sessions and items", () => {
  it("creates, lists, renames and archives", () => {
    const { hub } = instantHub();
    const created = hub.createSession({ title: "Hello" });
    const id = (created.body as { id: string }).id;
    expect((hub.listSessions().body as { data: unknown[] }).data).toHaveLength(1);
    expect((hub.updateSession(id, { title: "Renamed" }).body as { title: string }).title).toBe("Renamed");
    expect((hub.updateSession(id, { archived: true }).body as { archived_at: number }).archived_at).not.toBeNull();
    expect((hub.updateSession(id, { archived: false }).body as { archived_at: null }).archived_at).toBeNull();
    expect(hub.updateSession("ghost", {}).status).toBe(404);
  });

  it("pages items newest-first with a cursor, and refuses a stale one", () => {
    const { hub } = instantHub();
    const id = (hub.createSession({}).body as { id: string }).id;
    for (const n of [1, 2, 3]) hub.addItem(id, { type: "message", role: "user", content: `m${n}` });
    const page = hub.listItems(id, { order: "desc", limit: "2" }).body as {
      data: { content: string }[];
      has_more: boolean;
    };
    expect(page.data.map((item) => item.content)).toEqual(["m3", "m2"]);
    expect(page.has_more).toBe(true);
    const next = hub.listItems(id, { order: "desc", limit: "2", after: (page.data[1] as unknown as { id: string }).id })
      .body as {
      data: { content: string }[];
    };
    expect(next.data.map((item) => item.content)).toEqual(["m1"]);
    expect(hub.listItems(id, { after: "nope" }).status).toBe(404);
    expect(hub.listItems("ghost").status).toBe(404);
    const asc = hub.listItems(id, {}).body as { data: { content: string }[] };
    expect(asc.data[0]!.content).toBe("m1");
  });
});

describe("the write path", () => {
  it("replays the same answer for the same idempotency key", () => {
    const { hub, drain } = instantHub();
    const id = (hub.createSession({}).body as { id: string }).id;
    const events = { events: [{ type: "input.message", content: "hi" }] };
    const first = hub.submitInput(id, events, "key-1");
    const again = hub.submitInput(id, events, "key-1");
    expect(again).toBe(first);
    expect(hub.submitInput(id, events, "").status).toBe(400);
    expect(hub.submitInput("ghost", events, "key-2").status).toBe(404);
    drain();
  });

  it("plays the greeting fixture end to end onto the stream", () => {
    const { hub, drain } = instantHub();
    const id = (hub.createSession({ title: "chat" }).body as { id: string }).id;
    const seen: string[] = [];
    hub.subscribe(id, null, (event: { type: string }) => seen.push(event.type));
    hub.submitInput(id, { events: [{ type: "input.message", content: "hello" }] }, "k1");
    drain();
    expect(seen).toContain("lucy.turn.started");
    expect(seen).toContain("lucy.content.text.delta");
    expect(seen).toContain("lucy.context.status");
    expect(seen.at(-1)).toBe("lucy.turn.completed");
    const items = (hub.listItems(id, {}).body as { data: { type: string }[] }).data;
    expect(items.map((item) => item.type)).toEqual(["message", "message"]);
  });

  it("parks on a card and carries on down the approved branch", () => {
    const { hub, drain } = instantHub();
    const id = (hub.createSession({ title: "play music" }).body as { id: string }).id;
    const seen: { type: string; data: Record<string, unknown> }[] = [];
    hub.subscribe(id, null, (event: { type: string; data: Record<string, unknown> }) => seen.push(event));
    hub.submitInput(id, { events: [{ type: "input.message", content: "play lonely at the top" }] }, "k1");
    drain();
    const card = seen.find((event) => event.type === "lucy.approval.requested")!;
    expect(card.data.description).toContain("music.find");
    expect(seen.at(-1)!.type).toBe("lucy.turn.input_required");

    hub.submitInput(
      id,
      { events: [{ type: "input.approval", approval_id: card.data.approval_id, approved: true, lifetime: "once" }] },
      "k2",
    );
    drain();
    expect(seen.map((event) => event.type)).toContain("lucy.approval.granted");
    const words = seen
      .filter((event) => event.type === "lucy.content.text.delta")
      .map((event) => event.data.delta)
      .join("");
    expect(words).toContain("Lonely At The Top");
    expect(seen.at(-1)!.type).toBe("lucy.turn.completed");
  });

  it("the denied branch stops without playing, and a wrong card id is a 404", () => {
    const { hub, drain } = instantHub();
    const id = (hub.createSession({ title: "play music" }).body as { id: string }).id;
    const seen: { type: string; data: Record<string, unknown> }[] = [];
    hub.subscribe(id, null, (event: { type: string; data: Record<string, unknown> }) => seen.push(event));
    hub.submitInput(id, { events: [{ type: "input.message", content: "play it" }] }, "k1");
    drain();
    const card = seen.find((event) => event.type === "lucy.approval.requested")!;
    expect(
      hub.submitInput(id, { events: [{ type: "input.approval", approval_id: "apr_ghost", approved: false }] }, "k2")
        .status,
    ).toBe(404);
    hub.submitInput(
      id,
      {
        events: [
          {
            type: "input.approval",
            approval_id: card.data.approval_id,
            approved: false,
            instruction: "not now",
            only: ["x"],
          },
        ],
      },
      "k3",
    );
    drain();
    expect(seen.map((event) => event.type)).toContain("lucy.approval.denied");
    const words = seen
      .filter((event) => event.type === "lucy.content.text.delta")
      .map((event) => event.data.delta)
      .join("");
    expect(words).toContain("will not play");
  });

  it("cancelling a turn stops the script where it stands", () => {
    const { hub, drain } = instantHub();
    const id = (hub.createSession({ title: "chat" }).body as { id: string }).id;
    const seen: string[] = [];
    hub.subscribe(id, null, (event: { type: string }) => seen.push(event.type));
    const turn = (
      hub.submitInput(id, { events: [{ type: "input.message", content: "hi" }] }, "k1").body as { id: string }
    ).id;
    expect(hub.cancelTurn(turn).status).toBe(200);
    drain();
    expect(seen).toContain("lucy.turn.cancelled");
    expect(seen).not.toContain("lucy.turn.completed");
    expect(hub.cancelTurn("trn_ghost").status).toBe(404);
  });
});

describe("the stream", () => {
  it("opens with a snapshot at the client's position and replays what was missed", () => {
    const { hub, drain } = instantHub();
    const id = (hub.createSession({ title: "chat" }).body as { id: string }).id;
    hub.submitInput(id, { events: [{ type: "input.message", content: "hello" }] }, "k1");
    drain();
    const fresh: { type: string; sequence_number: number }[] = [];
    hub.subscribe(id, null, (event: never) => fresh.push(event));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.type).toBe("lucy.stream.snapshot");

    const resumed: { type: string }[] = [];
    hub.subscribe(id, 1, (event: never) => resumed.push(event));
    expect(resumed.length).toBeGreaterThan(2);
    expect(resumed[0]!.type).toBe("lucy.stream.snapshot");
    expect(hub.subscribe("ghost", null, () => {})).toBeNull();
  });

  it("an unsubscribed follower hears nothing more", () => {
    const { hub } = instantHub();
    const id = (hub.createSession({}).body as { id: string }).id;
    const seen: string[] = [];
    const unsubscribe = hub.subscribe(id, null, (event: { type: string }) => seen.push(event.type))!;
    unsubscribe();
    hub.emit(id, "lucy.turn.started", {}, "t");
    expect(seen).toEqual(["lucy.stream.snapshot"]);
  });

  it("frames parse with the same parser the app uses", () => {
    const { hub } = instantHub();
    const id = (hub.createSession({}).body as { id: string }).id;
    const event = hub.emit(id, "lucy.turn.started", {}, "trn_1");
    const parser = new SseParser();
    const frames = parser.push(OPENING + encodeFrame(event) + heartbeatFrame(id, () => 2_000_000));
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ id: "1", event: "lucy.turn.started" });
    expect(frames[1]!.event).toBe("lucy.stream.heartbeat");
    expect(frames[1]!.id).toBeUndefined();
  });

  it("mints a token the UI can read the expiry of", () => {
    expect(expiryOf(fakeToken(123_000))).toBe(123_000);
  });
});

describe("odd scripts and odd input", () => {
  const odd = {
    greeting: {
      reply: [
        { type: "lucy.turn.started" },
        { approved: [], denied: [] },
        {
          type: "approval",
          card: { tool: "repos.merge", description: "Merge it?", limit: { field: "repository", values: ["a/b"] } },
        },
      ],
    },
  };

  it("fills a bare card from its tool, carries a limit, and survives a missing continuation", () => {
    const { hub, drain } = instantHub({ fixtures: odd });
    const id = (hub.createSession({}).body as { id: string }).id;
    const seen: { type: string; data: Record<string, unknown> }[] = [];
    hub.subscribe(id, null, (event: { type: string; data: Record<string, unknown> }) => seen.push(event));
    hub.submitInput(
      id,
      { events: [{ type: "input.message", content: { not: "text" } }, { type: "input.other" }] },
      "k1",
    );
    drain();
    const card = seen.find((event) => event.type === "lucy.approval.requested")!;
    expect(card.data).toMatchObject({ permission: "repos.merge", arguments: {}, limit: { field: "repository" } });
    hub.submitInput(
      id,
      { events: [{ type: "input.approval", approval_id: card.data.approval_id, approved: true }] },
      "k2",
    );
    drain();
    expect(seen.map((event) => event.type)).toContain("lucy.approval.granted");
  });

  it("plays the failing fixture to a failed turn", () => {
    const { hub, drain } = instantHub();
    const id = (hub.createSession({ title: "make it fail" }).body as { id: string }).id;
    hub.submitInput(id, { events: [{ type: "input.message", content: "go" }] }, "k1");
    drain();
    const listed = hub.listSessions().body as { data: { status: string }[] };
    expect(listed.data[0]!.status).toBe("idle");
    const resumed: { type: string }[] = [];
    hub.subscribe(id, 0, (event: never) => resumed.push(event));
    expect(resumed.map((event) => event.type)).toContain("lucy.turn.failed");
  });

  it("a hub with no fixtures and an input with no events still makes a turn", () => {
    const { hub, drain } = instantHub({ fixtures: {} });
    const id = (hub.createSession(undefined).body as { id: string; title: string }).id;
    expect(hub.submitInput(id, {}, "k1").status).toBe(202);
    expect(hub.submitInput(id, { events: "nope" }, "k2").status).toBe(202);
    drain();
  });

  it("an empty page has no first or last id", () => {
    const { hub } = instantHub();
    const id = (hub.createSession({}).body as { id: string }).id;
    expect(hub.listItems(id, {}).body).toMatchObject({ data: [], first_id: null, last_id: null });
  });

  it("schedules with real timers and a real clock by default", async () => {
    vi.useFakeTimers();
    try {
      const hub = new FakeHub({ fixtures });
      const id = (hub.createSession({ title: "chat" }).body as { id: string }).id;
      const seen: string[] = [];
      hub.subscribe(id, null, (event: { type: string }) => seen.push(event.type));
      hub.submitInput(id, { events: [{ type: "input.message", content: "hi" }] }, "k1");
      expect(seen).not.toContain("lucy.turn.started");
      await vi.runAllTimersAsync();
      expect(seen.at(-1)).toBe("lucy.turn.completed");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("accounts", () => {
  it("every approved device code is its own account, and sees only its own sessions", () => {
    const { hub } = instantHub({ approvePolls: 1 });
    const mint = () => {
      const code = (hub.startDevice().body as { device_code: string }).device_code;
      return (hub.pollDevice(code).body as { access_token: string }).access_token;
    };
    const first = accountOf(`Bearer ${mint()}`);
    const second = accountOf(`Bearer ${mint()}`);
    expect(first).not.toBe(second);
    hub.createSession({ title: "mine" }, first);
    expect((hub.listSessions(first).body as { data: unknown[] }).data).toHaveLength(1);
    expect((hub.listSessions(second).body as { data: unknown[] }).data).toHaveLength(0);
    expect(hub.me(first).body).toMatchObject({ account_id: first });
  });

  it("a token it did not mint, or none, is the default account", () => {
    expect(accountOf("Bearer tok")).toBe("acct_fake");
    expect(accountOf(undefined)).toBe("acct_fake");
    expect(accountOf(`Bearer h.${Buffer.from("{}").toString("base64url")}.s`)).toBe("acct_fake");
    expect(accountOf(`Bearer ${fakeToken(1, "acct_9")}`)).toBe("acct_9");
  });
});
