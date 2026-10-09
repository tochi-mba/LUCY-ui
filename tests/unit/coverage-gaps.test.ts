// @vitest-environment happy-dom
/**
 * Tests for the paths the main suites leave out: the default seams a test usually replaces
 * (real timers, the real fetch binding, the real element import), and the defensive branches
 * that only odd wire data reaches.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { createAuth } from "../../src/auth/auth";
import { sessionTokenStore } from "../../src/auth/tokenStore";
import ApprovalCard from "../../src/components/ApprovalCard.vue";
import GenericItem from "../../src/components/GenericItem.vue";
import SidePanel from "../../src/components/SidePanel.vue";
import SignInChip from "../../src/components/SignInChip.vue";
import StreamingText from "../../src/components/StreamingText.vue";
import { AvatarDriver, type AvatarElement } from "../../src/face/driver";
import { forgetFace, registerFace } from "../../src/face/register";
import type { LucyEvent } from "../../src/protocol/events";
import type { Item } from "../../src/protocol/items";
import { approvalRequestOf } from "../../src/protocol/items";
import type { Page } from "../../src/protocol/sessions";
import { makeRouter } from "../../src/router";
import { createConversation, reduce } from "../../src/stores/conversation";
import { useConversation } from "../../src/stores/useConversation";
import { Unreachable } from "../../src/transport/errors";
import { HttpTransport } from "../../src/transport/http";
import { follow } from "../../src/transport/stream";
import type { FollowHandlers, LucyTransport } from "../../src/transport/types";

function token(expSeconds: number): string {
  return `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.s`;
}

const event = (type: string, data: object = {}, extra: object = {}): LucyEvent => ({
  type,
  session_id: "ses",
  created_at: 0,
  data: data as LucyEvent["data"],
  ...extra,
});

describe("the default seams", () => {
  it("auth without injected clocks signs in through the real sleep", async () => {
    const auth = createAuth({
      transport: {
        startDevice: () =>
          Promise.resolve({
            device_code: "d",
            user_code: "AB-CD",
            verification_uri: "u",
            verification_uri_complete: "u?c",
            expires_in: 600,
            interval: 0.001,
          }),
        pollDevice: () => Promise.resolve({ status: "approved", token: token(4_000_000_000) }),
        me: () => Promise.resolve({ account_id: "acct", audience: "lucy-api" }),
      },
      store: { read: () => null, write: () => {} },
    });
    await auth.startDevice();
    expect(auth.state.phase).toBe("signed_in");
    expect(auth.token()).toContain(".");
  });

  it("a cancel while the poll loop is sleeping abandons it quietly", async () => {
    let release: () => void = () => {};
    const auth = createAuth({
      transport: {
        startDevice: () =>
          Promise.resolve({
            device_code: "d",
            user_code: "AB-CD",
            verification_uri: "u",
            verification_uri_complete: "u?c",
            expires_in: 600,
            interval: 5,
          }),
        pollDevice: () => Promise.reject(new Error("never polled")),
        me: () => Promise.resolve({ account_id: "acct", audience: "lucy-api" }),
      },
      store: { read: () => null, write: () => {} },
      sleep: () => new Promise<void>((resolve) => (release = resolve)),
    });
    const running = auth.startDevice();
    await flushPromises();
    expect(auth.state.phase).toBe("code");
    auth.cancel();
    release();
    await running;
    expect(auth.state.phase).toBe("signed_out");
    expect(auth.state.error).toBeNull();
  });

  it("a pasted expired token while signed in keeps the sign-in", async () => {
    const good = token(4_000_000_000);
    const auth = createAuth({
      transport: {
        startDevice: () => Promise.reject(new Error("unused")),
        pollDevice: () => Promise.reject(new Error("unused")),
        me: () => Promise.resolve({ account_id: "acct", audience: "lucy-api" }),
      },
      store: { read: () => good, write: () => {} },
    });
    auth.restore();
    await flushPromises();
    await auth.usePasted(token(1));
    expect(auth.state.phase).toBe("signed_in");
    expect(auth.state.error).toMatch(/expired/);
  });

  it("the token store reaches this tab's sessionStorage by default", () => {
    const store = sessionTokenStore();
    store.write("tok");
    expect(sessionStorage.getItem("lucy-ui.token")).toBe("tok");
    expect(store.read()).toBe("tok");
    store.write(null);
    expect(sessionStorage.getItem("lucy-ui.token")).toBeNull();
  });

  it("the driver's own timers hold a short animation for real", async () => {
    const calls: string[] = [];
    const face: AvatarElement = {
      play: (action) => void calls.push(action),
      reset: () => void calls.push("reset"),
      sleep: () => {},
      wake: () => {},
      input: () => {},
      startWaiting: () => {},
      stopWaiting: () => {},
    };
    const driver = new AvatarDriver(face);
    driver.set("done");
    driver.set("idle");
    expect(calls).toEqual(["success"]);
    await vi.waitFor(() => expect(calls).toContain("reset"));
    driver.set("failed");
    driver.destroy();
  });

  it("registering the face by default imports the real element", async () => {
    forgetFace();
    await registerFace();
    expect(customElements.get("agent-robot-avatar")).toBeDefined();
    forgetFace();
  });

  it("the real router serves the three screens", async () => {
    const router = makeRouter();
    await router.push("/s/ses_1");
    expect(router.currentRoute.value.name).toBe("session");
    await router.push("/face");
    expect(router.currentRoute.value.name).toBe("face");
    await router.push("/nothing/here");
    expect(router.currentRoute.value.name).toBe("home");
  });

  it("the transport's default fetch and quiet 401 handler work against a stubbed global", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      seen.push(String(input));
      return Promise.resolve(new Response("{}", { status: 401 }));
    });
    try {
      const transport = new HttpTransport({ baseUrl: "http://hub.local", token: () => "tok" });
      await expect(transport.me()).rejects.toMatchObject({ status: 401 });
      expect(seen).toEqual(["http://hub.local/v1/me"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the device flow's races", () => {
  function raceAuth(options: { start?: () => Promise<never>; poll: () => Promise<unknown> }) {
    return createAuth({
      transport: {
        startDevice:
          (options.start as never) ??
          (() =>
            Promise.resolve({
              device_code: "d",
              user_code: "AB-CD",
              verification_uri: "u",
              verification_uri_complete: "u?c",
              expires_in: 600,
              interval: 5,
            })),
        pollDevice: options.poll as never,
        me: () => Promise.resolve({ account_id: "acct", audience: "lucy-api" }),
      },
      store: { read: () => null, write: () => {} },
      sleep: () => Promise.resolve(),
    });
  }

  it("a start that fails after a cancel says nothing", async () => {
    let oppose: (error: Error) => void = () => {};
    const auth = raceAuth({
      start: () => new Promise<never>((_, reject) => (oppose = reject)),
      poll: () => Promise.reject(new Error("unused")),
    });
    const running = auth.startDevice();
    auth.cancel();
    oppose(new Error("down"));
    await running;
    expect(auth.state.error).toBeNull();
  });

  it("a poll that fails after a cancel says nothing", async () => {
    let oppose: (error: Error) => void = () => {};
    const auth = raceAuth({ poll: () => new Promise((_, reject) => (oppose = reject)) });
    const running = auth.startDevice();
    await flushPromises();
    auth.cancel();
    oppose(new Error("cut"));
    await running;
    expect(auth.state.error).toBeNull();
  });

  it("a poll that answers after a cancel is discarded", async () => {
    let settle: (value: unknown) => void = () => {};
    const auth = raceAuth({ poll: () => new Promise((resolve) => (settle = resolve)) });
    const running = auth.startDevice();
    await flushPromises();
    auth.cancel();
    settle({ status: "approved", token: token(4_000_000_000) });
    await running;
    expect(auth.state.phase).toBe("signed_out");
  });
});

describe("stream edges", () => {
  it("stops cleanly when aborted during a failing connect", async () => {
    const controller = new AbortController();
    let calls = 0;
    await follow({
      url: () => "/events",
      headers: () => ({}),
      fetch: () => {
        calls += 1;
        controller.abort();
        return Promise.reject(new Error("down"));
      },
      sleep: () => Promise.resolve(),
      signal: controller.signal,
      handlers: { onEvent: () => {} },
    });
    expect(calls).toBe(1);
  });

  it("stops without reconnecting when the reader itself aborted the follow", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(
          new TextEncoder().encode(
            "event: e\ndata: " +
              JSON.stringify({
                type: "lucy.turn.started",
                sequence_number: 1,
                session_id: "s",
                created_at: 0,
                data: {},
              }) +
              "\n\n",
          ),
        );
        stream.close();
      },
    });
    let calls = 0;
    await follow({
      url: () => "/events",
      headers: () => ({}),
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response(body, { status: 200 }));
      },
      sleep: () => Promise.resolve(),
      signal: controller.signal,
      handlers: { onEvent: () => controller.abort() },
    });
    expect(calls).toBe(1);
  });

  it("handles an event sent without a sequence number without moving the cursor", async () => {
    const controller = new AbortController();
    const frames =
      "event: e\ndata: " +
      JSON.stringify({ type: "lucy.tool.progress", session_id: "s", created_at: 0, data: {} }) +
      "\n\nevent: e\ndata: " +
      JSON.stringify({ type: "lucy.stream.done", session_id: "s", created_at: 0, data: {} }) +
      "\n\n";
    const seen: string[] = [];
    let calls = 0;
    const handled: string[] = [];
    await follow({
      url: (cursor) => (cursor === null ? "/events" : `/events?starting_after=${cursor}`),
      headers: () => ({}),
      fetch: (input) => {
        calls += 1;
        if (calls > 1) {
          controller.abort();
          return Promise.reject(new Error("done"));
        }
        seen.push(String(input));
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new TextEncoder().encode(frames));
            stream.close();
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      },
      sleep: () => Promise.resolve(),
      signal: controller.signal,
      handlers: { onEvent: (seenEvent) => handled.push(seenEvent.type) },
    });
    expect(handled).toEqual(["lucy.tool.progress"]);
    expect(seen).toEqual(["/events"]);
  });

  it("treats an OK response with no body as a drop", async () => {
    const controller = new AbortController();
    const responses = [new Response(null, { status: 200 })];
    let calls = 0;
    await follow({
      url: () => "/events",
      headers: () => ({}),
      fetch: () => {
        calls += 1;
        const next = responses.shift();
        if (next === undefined) {
          controller.abort();
          return Promise.reject(new Error("done"));
        }
        return Promise.resolve(next);
      },
      sleep: () => Promise.resolve(),
      signal: controller.signal,
      handlers: { onEvent: () => {} },
    });
    expect(calls).toBeGreaterThan(1);
  });

  it("resumes with the cursor in the URL after the hub ends a stream", async () => {
    const frame = (body: object) => `id: 5\nevent: e\ndata: ${JSON.stringify(body)}\n\n`;
    const first = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              frame({ type: "lucy.turn.started", sequence_number: 5, session_id: "s", created_at: 0, data: {} }),
            ),
          );
          controller.close();
        },
      }),
      { status: 200 },
    );
    const urls: string[] = [];
    const controller = new AbortController();
    const transport = new HttpTransport({
      token: () => "tok",
      fetch: (input) => {
        urls.push(String(input));
        if (urls.length === 1) return Promise.resolve(first);
        controller.abort();
        return Promise.resolve(new Response(null, { status: 404 }));
      },
      sleep: () => Promise.resolve(),
    });
    await transport.follow("ses", { onEvent: () => {} }, controller.signal);
    expect(urls[1]).toBe("/v1/sessions/ses/events?starting_after=5");
  });
});

describe("streaming text's frame budget", () => {
  function withRaf() {
    const queue: FrameRequestCallback[] = [];
    let cancelled = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      cancelled += 1;
    });
    return {
      run: () => {
        for (const callback of queue.splice(0)) callback(0);
      },
      cancelled: () => cancelled,
    };
  }

  it("renders at most once per frame however many deltas arrive", async () => {
    const raf = withRaf();
    try {
      const block = { key: "k", id: "b", kind: "text" as const, turnId: null, text: "a", open: true };
      const wrapper = mount(StreamingText, { props: { block } });
      await wrapper.setProps({ block: { ...block, text: "ab" } });
      await wrapper.setProps({ block: { ...block, text: "abc" } });
      expect(wrapper.text()).not.toContain("abc");
      raf.run();
      await nextTick();
      expect(wrapper.text()).toContain("abc");
      wrapper.unmount();
      expect(raf.cancelled()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("text pending at unmount is cancelled, not drawn", async () => {
    const raf = withRaf();
    try {
      const block = { key: "k", id: "b", kind: "text" as const, turnId: null, text: "a", open: true };
      const wrapper = mount(StreamingText, { props: { block } });
      await wrapper.setProps({ block: { ...block, text: "ab" } });
      wrapper.unmount();
      expect(raf.cancelled()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the conversation composable's edges", () => {
  function row(id: string, seq: number): Item {
    return { id, seq, type: "message", role: "user", content: "x", turn_id: null, agent_id: null, created_at: 0 };
  }

  class EdgeTransport implements LucyTransport {
    handlers: FollowHandlers | null = null;
    pages: (Page<Item> | (() => Promise<Page<Item>>))[] = [];
    sendAnswers: (Error | null)[] = [];
    sent = 0;
    me = () => Promise.resolve({ account_id: "a", audience: "x" });
    listSessions = () => Promise.reject(new Error("unused"));
    createSession = () => Promise.reject(new Error("unused"));
    updateSession = () => Promise.reject(new Error("unused"));
    startDevice = () => Promise.reject(new Error("unused"));
    pollDevice = () => Promise.reject(new Error("unused"));
    cancelTurn = () => Promise.reject(new Error("unused"));
    listItems(): Promise<Page<Item>> {
      const next = this.pages.shift() ?? { data: [], has_more: false, first_id: null, last_id: null };
      return typeof next === "function" ? next() : Promise.resolve(next);
    }
    send() {
      this.sent += 1;
      const answer = this.sendAnswers.shift() ?? null;
      return answer === null
        ? Promise.resolve({ id: "trn", session_id: "ses", status: "queued" })
        : Promise.reject(answer);
    }
    follow(_: string, handlers: FollowHandlers, signal: AbortSignal): Promise<void> {
      this.handlers = handlers;
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve()));
    }
  }

  const snapshotEvent = event("lucy.stream.snapshot", { state: {} });

  it("with no injected seams, a retried send still goes out under one key", async () => {
    const transport = new EdgeTransport();
    const sessionId = ref<string | null>("ses");
    const scope = effectScope();
    const conversation = scope.run(() => useConversation(transport, sessionId))!;
    transport.sendAnswers = [new Unreachable(), null];
    transport.handlers!.onEvent(snapshotEvent);
    expect(await conversation.send("hi")).toBe(true);
    expect(transport.sent).toBe(2);
    scope.stop();
  }, 15000);

  it("a history page landing after the conversation closed changes nothing", async () => {
    const transport = new EdgeTransport();
    let release: (page: Page<Item>) => void = () => {};
    let oppose: (error: Error) => void = () => {};
    transport.pages = [
      () =>
        new Promise<Page<Item>>((resolve, reject) => {
          release = resolve;
          oppose = reject;
        }),
      () =>
        new Promise<Page<Item>>((_, reject) => {
          oppose = reject;
        }),
    ];
    const sessionId = ref<string | null>("ses");
    const scope = effectScope();
    const conversation = scope.run(() => useConversation(transport, sessionId))!;
    const first = transport.handlers!;
    first.onEvent(snapshotEvent);
    sessionId.value = null;
    await nextTick();
    release({ data: [row("late", 1)], has_more: true, first_id: null, last_id: null });
    await flushPromises();
    expect(conversation.state.items).toHaveLength(0);
    expect(conversation.state.loaded).toBe(false);
    // And a failure after closing is not an error worth telling anyone about.
    sessionId.value = "ses";
    await nextTick();
    const second = transport.handlers!;
    second.onEvent(snapshotEvent);
    sessionId.value = null;
    await nextTick();
    oppose(new Error("late failure"));
    await flushPromises();
    expect(conversation.state.error).toBeNull();
    scope.stop();
  });

  it("a second snapshot refreshes history without resetting how far back it reaches", async () => {
    const transport = new EdgeTransport();
    transport.pages = [
      { data: [row("a", 1)], has_more: true, first_id: null, last_id: null },
      { data: [row("a", 1)], has_more: false, first_id: null, last_id: null },
    ];
    const sessionId = ref<string | null>("ses");
    const scope = effectScope();
    const conversation = scope.run(() => useConversation(transport, sessionId))!;
    transport.handlers!.onEvent(snapshotEvent);
    await flushPromises();
    expect(conversation.state.hasEarlier).toBe(true);
    transport.handlers!.onEvent(snapshotEvent);
    await flushPromises();
    expect(conversation.state.hasEarlier).toBe(true);
    scope.stop();
  });

  it("asking for earlier history with no conversation open is nothing", async () => {
    const transport = new EdgeTransport();
    const sessionId = ref<string | null>(null);
    const scope = effectScope();
    const conversation = scope.run(() => useConversation(transport, sessionId))!;
    conversation.state.items.push(row("ghost", 1));
    await conversation.loadEarlier();
    expect(await conversation.send("words into the void")).toBe(false);
    expect(transport.sent).toBe(0);
    scope.stop();
  });
});

describe("reducer edges", () => {
  it("shrugs at malformed decision and park events", () => {
    const state = createConversation("ses");
    reduce(state, event("lucy.approval.granted", { approved: true }), 0);
    reduce(state, event("lucy.turn.input_required", {}), 0);
    expect(state.turn.status).toBe("input_required");
    reduce(state, event("lucy.turn.started", {}, { turn_id: "t1" }), 0);
    reduce(state, event("lucy.turn.input_required", {}, { turn_id: "t0" }), 0);
    expect(state.turn.status).toBe("running");
  });

  it("a turn created or finished without an id still lands sensibly", () => {
    const state = createConversation("ses");
    reduce(state, event("lucy.turn.created", {}), 0);
    expect(state.turn).toMatchObject({ id: null, status: "queued" });
    reduce(state, event("lucy.turn.completed", {}), 7);
    expect(state.turn.status).toBe("completed");
    expect(state.outcome).toEqual({ kind: "done", at: 7 });
  });

  it("finishing one turn leaves another turn's blocks alone", () => {
    const state = createConversation("ses");
    reduce(state, event("lucy.content.text.start", { id: "other" }, { turn_id: "t0" }), 0);
    reduce(state, event("lucy.turn.started", {}, { turn_id: "t1" }), 0);
    reduce(state, event("lucy.content.reasoning.start", {}, { turn_id: "t1" }), 0);
    reduce(state, event("lucy.turn.failed", {}, { turn_id: "t1" }), 0);
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]!.open).toBe(true);
  });

  it("reads snapshots, decisions, reports and work rows that say less than usual", () => {
    const state = createConversation("ses");
    reduce(state, event("lucy.stream.snapshot", { state: "not a record" }), 0);
    expect(state.title).toBe("");
    reduce(state, event("lucy.turn.started", {}), 0);
    expect(state.turn.status).toBe("running");
    reduce(
      state,
      event("lucy.content.item.added", {
        id: "r",
        seq: 1,
        type: "approval_response",
        role: "user",
        content: "words",
        turn_id: null,
        created_at: 0,
      }),
      0,
    );
    expect(Object.keys(state.cards)).toHaveLength(0);
    reduce(state, event("lucy.context.status", {}), 0);
    expect(state.window).toMatchObject({ usedTokens: 0, windowTokens: 0, percent: 0, state: "ok" });
    reduce(state, event("lucy.work.finished", { work_id: "w" }), 0);
    expect(state.work[0]).toMatchObject({ elapsedSeconds: 0, kind: "work", state: "finished" });
  });

  it("a second service's connection prompt stands beside the first", () => {
    const state = createConversation("ses");
    reduce(state, event("lucy.connection.required", { service: "spotify", connect_url: "a" }), 0);
    reduce(state, event("lucy.connection.required", { service: "github", connect_url: "b" }), 0);
    expect(state.connections.map((prompt) => prompt.service)).toEqual(["spotify", "github"]);
  });
});

describe("component edges", () => {
  it("GenericItem shows literally undefined content as null", () => {
    const wrapper = mount(GenericItem, {
      props: {
        item: {
          id: "i",
          seq: 1,
          type: "odd",
          role: "tool",
          content: undefined,
          turn_id: null,
          agent_id: null,
          created_at: 0,
        },
      },
    });
    expect(wrapper.find("pre").text()).toBe("null");
  });

  it("a step without arguments reads as null arguments", () => {
    const card = approvalRequestOf({ approval_id: "apr", tool: "x", steps: [{ operation: "op", description: "d" }] });
    expect(card?.steps[0]).toMatchObject({ arguments: null, step: "" });
  });

  it("a card keys steps without names and speaks an unknown lifetime as itself", () => {
    const base = {
      item: {
        id: "i",
        seq: 1,
        type: "approval_request",
        role: "assistant",
        content: {},
        turn_id: "t",
        agent_id: null,
        created_at: 0,
      },
      request: {
        approval_id: "apr",
        tool: "x",
        description: "?",
        permission: "x",
        arguments: null,
        limit: null,
        steps: [{ step: "", operation: "op", arguments: null, description: "d" }],
      },
      record: null,
    };
    const pending = mount(ApprovalCard, { props: { card: { ...base, status: "pending" as const } } });
    expect(pending.findAll(".card-steps li")).toHaveLength(1);
    const odd = mount(ApprovalCard, {
      props: {
        card: {
          ...base,
          status: "granted" as const,
          record: { status: "granted" as const, lifetime: "fortnight", instruction: "" },
        },
      },
    });
    expect(odd.text()).toContain("fortnight");
  });

  it("the side panel shows connections, the meter, a nameless work row and one lone unknown event", () => {
    const state = createConversation("ses");
    state.turn = { id: "t", status: "completed", slow: false };
    state.connections = [{ service: "spotify", scopes: [], connectUrl: "", message: "" }];
    state.window = {
      usedTokens: 1,
      windowTokens: 10,
      percent: 10,
      warnAtPercent: 60,
      compactAtPercent: 72,
      tokensUntilCompaction: 6,
      summarisedTurns: 0,
      state: "ok",
    };
    state.work = [{ id: "w9", kind: "job", role: "", state: "finished", elapsedSeconds: 1, group: null }];
    state.unknownEvents = 1;
    const wrapper = mount(SidePanel, { props: { conversation: state } });
    expect(wrapper.text()).toContain("spotify is not connected");
    expect(wrapper.text()).toContain("Context");
    expect(wrapper.text()).toContain("w9");
    expect(wrapper.text()).toContain("1 event this page has no view for.");
  });

  it("the chip says Signed in when the hub never named the account", async () => {
    const good = token(4_000_000_000);
    const auth = createAuth({
      transport: {
        startDevice: () => Promise.reject(new Error("unused")),
        pollDevice: () => Promise.reject(new Error("unused")),
        me: () => Promise.reject(new Error("down")),
      },
      store: { read: () => good, write: () => {} },
    });
    auth.restore();
    await flushPromises();
    const wrapper = mount(SignInChip, { props: { auth } });
    expect(wrapper.find(".chip-who").text()).toBe("Signed in");
  });

  it("the chip's clock stops with the tab", () => {
    const auth = createAuth({
      transport: {
        startDevice: () => Promise.reject(new Error("unused")),
        pollDevice: () => Promise.reject(new Error("unused")),
        me: () => Promise.resolve({ account_id: "acct", audience: "lucy-api" }),
      },
      store: { read: () => null, write: () => {} },
    });
    vi.useFakeTimers();
    const wrapper = mount(SignInChip, { props: { auth } });
    wrapper.unmount();
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });
});
