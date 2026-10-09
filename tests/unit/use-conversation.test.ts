import { describe, expect, it } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import type { LucyEvent } from "../../src/protocol/events";
import type { Item } from "../../src/protocol/items";
import type { Page } from "../../src/protocol/sessions";
import { useConversation } from "../../src/stores/useConversation";
import { Unreachable } from "../../src/transport/errors";
import type { FollowHandlers, InputEvent, LucyTransport } from "../../src/transport/types";

function item(partial: Partial<Item> & { id: string; seq: number }): Item {
  return { type: "message", role: "assistant", content: "", turn_id: "trn", agent_id: null, created_at: 0, ...partial };
}

const snapshot: LucyEvent = {
  type: "lucy.stream.snapshot",
  session_id: "ses",
  created_at: 0,
  data: { state: { title: "T" } },
  sequence_number: 0,
};

class FakeTransport implements LucyTransport {
  handlers: FollowHandlers | null = null;
  follows: string[] = [];
  itemPages: (Page<Item> | Error)[] = [];
  itemCalls: { sessionId: string; after?: string }[] = [];
  sent: { sessionId: string; events: InputEvent[]; key: string }[] = [];
  sendAnswers: (Error | null)[] = [];
  cancelled: string[] = [];
  cancelAnswer: Error | null = null;
  aborted = 0;

  me = () => Promise.resolve({ account_id: "acct", audience: "lucy-api" });
  listSessions = () => Promise.resolve({ data: [], has_more: false, first_id: null, last_id: null });
  createSession = () => Promise.reject(new Error("unused"));
  updateSession = () => Promise.reject(new Error("unused"));
  startDevice = () => Promise.reject(new Error("unused"));
  pollDevice = () => Promise.reject(new Error("unused"));

  listItems(sessionId: string, query?: { after?: string }): Promise<Page<Item>> {
    this.itemCalls.push({ sessionId, after: query?.after });
    const next = this.itemPages.shift() ?? { data: [], has_more: false, first_id: null, last_id: null };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }

  send(sessionId: string, events: InputEvent[], key: string) {
    this.sent.push({ sessionId, events, key });
    const answer = this.sendAnswers.shift() ?? null;
    if (answer !== null) return Promise.reject(answer);
    return Promise.resolve({ id: "trn", session_id: sessionId, status: "queued" });
  }

  cancelTurn(turnId: string) {
    this.cancelled.push(turnId);
    if (this.cancelAnswer) return Promise.reject(this.cancelAnswer);
    return Promise.resolve({ id: turnId, session_id: "ses", status: "cancelled" });
  }

  follow(sessionId: string, handlers: FollowHandlers, signal: AbortSignal): Promise<void> {
    this.follows.push(sessionId);
    this.handlers = handlers;
    return new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        this.aborted += 1;
        resolve();
      });
    });
  }
}

function mount(keys: string[] = ["k1", "k2", "k3", "k4"]) {
  const transport = new FakeTransport();
  const sessionId = ref<string | null>("ses");
  const scope = effectScope();
  const queue = [...keys];
  const conversation = scope.run(() =>
    useConversation(transport, sessionId, {
      now: () => 777,
      key: () => queue.shift() ?? "k?",
      sleep: () => Promise.resolve(),
    }),
  )!;
  return { transport, sessionId, scope, conversation };
}

const settle = async () => {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
};

describe("opening a conversation", () => {
  it("follows the stream, and loads the newest history at each snapshot", async () => {
    const { transport, conversation } = mount();
    transport.itemPages.push({ data: [item({ id: "a", seq: 1 })], has_more: true, first_id: "a", last_id: "a" });
    expect(transport.follows).toEqual(["ses"]);
    transport.handlers!.onEvent(snapshot);
    await settle();
    expect(conversation.state.title).toBe("T");
    expect(conversation.state.items.map((row) => row.id)).toEqual(["a"]);
    expect(conversation.state.hasEarlier).toBe(true);
    expect(conversation.state.loaded).toBe(true);
  });

  it("reports stream state, and a history page that could not load", async () => {
    const { transport, conversation } = mount();
    transport.handlers!.onState?.("open");
    expect(conversation.state.stream).toBe("open");
    transport.itemPages.push(new Error("boom"));
    transport.handlers!.onEvent(snapshot);
    await settle();
    expect(conversation.state.error).toBe("boom");
  });

  it("closes the old stream and starts clean when the session changes", async () => {
    const { transport, sessionId, conversation } = mount();
    transport.handlers!.onEvent(snapshot);
    await settle();
    sessionId.value = "ses2";
    await settle();
    expect(transport.aborted).toBe(1);
    expect(transport.follows).toEqual(["ses", "ses2"]);
    expect(conversation.state.title).toBe("");
    sessionId.value = null;
    await settle();
    expect(transport.aborted).toBe(2);
  });

  it("stops everything when the scope dies", async () => {
    const { transport, scope } = mount();
    scope.stop();
    expect(transport.aborted).toBe(1);
  });

  it("a snapshot after the change does not write into the new conversation", async () => {
    const { transport, sessionId, conversation } = mount();
    const oldHandlers = transport.handlers!;
    sessionId.value = "ses2";
    await settle();
    oldHandlers.onEvent(snapshot);
    oldHandlers.onState?.("open");
    await settle();
    expect(conversation.state.title).toBe("");
    expect(conversation.state.stream).not.toBe("open");
  });
});

describe("earlier history", () => {
  it("pages back from the oldest item on screen", async () => {
    const { transport, conversation } = mount();
    transport.itemPages.push({ data: [item({ id: "b", seq: 2 })], has_more: true, first_id: "b", last_id: "b" });
    transport.handlers!.onEvent(snapshot);
    await settle();
    transport.itemPages.push({ data: [item({ id: "a", seq: 1 })], has_more: false, first_id: "a", last_id: "a" });
    await conversation.loadEarlier();
    expect(transport.itemCalls[1]).toMatchObject({ after: "b" });
    expect(conversation.state.items.map((row) => row.id)).toEqual(["a", "b"]);
    expect(conversation.state.hasEarlier).toBe(false);
  });

  it("is quiet with nothing on screen, and reports a failure", async () => {
    const { transport, conversation } = mount();
    await conversation.loadEarlier();
    expect(transport.itemCalls).toHaveLength(0);
    transport.itemPages.push({ data: [item({ id: "a", seq: 1 })], has_more: false, first_id: null, last_id: null });
    transport.handlers!.onEvent(snapshot);
    await settle();
    transport.itemPages.push(new Error("gone"));
    await conversation.loadEarlier();
    expect(conversation.state.error).toBe("gone");
    conversation.dismissError();
    expect(conversation.state.error).toBeNull();
  });
});

describe("sending", () => {
  it("sends trimmed words under one key, and nothing for an empty draft", async () => {
    const { transport, conversation } = mount();
    expect(await conversation.send("  hi there  ")).toBe(true);
    expect(await conversation.send("   ")).toBe(false);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({ key: "k1", events: [{ type: "input.message", content: "hi there" }] });
  });

  it("retries an unreachable hub with the same key, then gives up with a sentence", async () => {
    const { transport, conversation } = mount();
    transport.sendAnswers = [new Unreachable(), null];
    expect(await conversation.send("hello")).toBe(true);
    expect(transport.sent.map((call) => call.key)).toEqual(["k1", "k1"]);

    transport.sendAnswers = [new Unreachable(), new Unreachable(), new Unreachable()];
    expect(await conversation.send("again")).toBe(false);
    expect(conversation.state.error).toMatch(/reached/);
  });

  it("a refusal is reported at once, not retried", async () => {
    const { transport, conversation } = mount();
    transport.sendAnswers = [new Error("409 busy")];
    expect(await conversation.send("hi")).toBe(false);
    expect(transport.sent).toHaveLength(1);
    expect(conversation.state.error).toBe("409 busy");
  });
});

describe("answering a card", () => {
  it("marks the card answering and sends the approval", async () => {
    const { transport, conversation } = mount();
    conversation.state.cards.apr = { status: "pending", lifetime: "once", instruction: "" };
    expect(await conversation.answer("apr", { approved: true, lifetime: "session" })).toBe(true);
    expect(transport.sent[0]!.events[0]).toMatchObject({
      type: "input.approval",
      approval_id: "apr",
      lifetime: "session",
    });
    expect(conversation.state.cards.apr!.status).toBe("answering");
  });

  it("puts the card back as it was when the answer could not be sent", async () => {
    const { transport, conversation } = mount();
    conversation.state.cards.apr = { status: "pending", lifetime: "once", instruction: "" };
    transport.sendAnswers = [new Error("no")];
    expect(await conversation.answer("apr", { approved: false })).toBe(false);
    expect(conversation.state.cards.apr).toMatchObject({ status: "pending" });

    transport.sendAnswers = [new Error("no")];
    expect(await conversation.answer("ghost", { approved: true })).toBe(false);
    expect(conversation.state.cards.ghost).toBeUndefined();
  });
});

describe("cancelling", () => {
  it("cancels the turn on screen, and reports a refusal", async () => {
    const { transport, conversation } = mount();
    await conversation.cancel();
    expect(transport.cancelled).toHaveLength(0);
    conversation.state.turn.id = "trn_9";
    await conversation.cancel();
    expect(transport.cancelled).toEqual(["trn_9"]);
    transport.cancelAnswer = new Error("already over");
    await conversation.cancel();
    expect(conversation.state.error).toBe("already over");
  });
});
