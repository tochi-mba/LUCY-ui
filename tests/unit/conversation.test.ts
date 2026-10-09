import { describe, expect, it } from "vitest";
import type { LucyEvent } from "../../src/protocol/events";
import type { Item } from "../../src/protocol/items";
import {
  type ConversationState,
  cardsOf,
  createConversation,
  isLiveTurn,
  isSpeaking,
  isWorking,
  pendingCards,
  reduce,
  turnStatusOf,
  upsertItems,
} from "../../src/stores/conversation";

const NOW = 50_000;

function event(type: string, data: object = {}, extra: Partial<LucyEvent> = {}): LucyEvent {
  return { type, session_id: "ses", created_at: 0, data: data as LucyEvent["data"], ...extra };
}

function item(partial: Partial<Item> & { id: string; seq: number }): Item {
  return { type: "message", role: "assistant", content: "", turn_id: "trn", agent_id: null, created_at: 0, ...partial };
}

function fresh(events: LucyEvent[] = []): ConversationState {
  const state = createConversation("ses");
  for (const next of events) reduce(state, next, NOW);
  return state;
}

describe("vocabulary helpers", () => {
  it("reads a turn status defensively", () => {
    expect(turnStatusOf("running")).toBe("running");
    expect(turnStatusOf("odd")).toBe("idle");
    expect(turnStatusOf(7)).toBe("idle");
  });
  it("knows which statuses are live", () => {
    expect(isLiveTurn("queued")).toBe(true);
    expect(isLiveTurn("completed")).toBe(false);
  });
});

describe("the snapshot", () => {
  it("fills the header and the latest turn", () => {
    const state = fresh([
      event("lucy.stream.snapshot", {
        state: {
          title: "Music",
          status: "running",
          permission_mode: "ask",
          latest_turn: { id: "trn_1", status: "running" },
        },
      }),
    ]);
    expect(state).toMatchObject({ title: "Music", status: "running", turn: { id: "trn_1", status: "running" } });
  });

  it("keeps what it has when a snapshot says less", () => {
    const state = fresh([event("lucy.stream.snapshot", { state: { title: "Named" } })]);
    reduce(state, event("lucy.stream.snapshot", { state: {} }), NOW);
    expect(state.title).toBe("Named");
    expect(state.turn.status).toBe("idle");
  });
});

describe("items", () => {
  it("orders by seq however they arrive, and an item seen twice is one row", () => {
    const state = fresh();
    reduce(state, event("lucy.content.item.added", item({ id: "b", seq: 2 })), NOW);
    upsertItems(state, [item({ id: "a", seq: 1 }), item({ id: "b", seq: 2 })]);
    expect(state.items.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("drops a row that is not an item", () => {
    const state = fresh([event("lucy.content.item.added", { nonsense: true })]);
    expect(state.items).toHaveLength(0);
  });
});

describe("streamed text", () => {
  const textFlow = [
    event("lucy.content.text.start", {}, { turn_id: "trn" }),
    event("lucy.content.text.delta", { delta: "Hel" }, { turn_id: "trn" }),
    event("lucy.content.text.delta", { delta: "lo" }, { turn_id: "trn" }),
    event("lucy.content.text.end", {}, { turn_id: "trn" }),
  ];

  it("accumulates deltas into one block and closes it", () => {
    const state = fresh(textFlow);
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ text: "Hello", open: false, kind: "text" });
  });

  it("is speaking only while a text block is open", () => {
    const state = fresh(textFlow.slice(0, 2));
    expect(isSpeaking(state)).toBe(true);
    reduce(state, textFlow[3]!, NOW);
    expect(isSpeaking(state)).toBe(false);
  });

  it("retires the closed block when the assistant message item lands, so nothing is said twice", () => {
    const state = fresh(textFlow);
    reduce(
      state,
      event("lucy.content.item.added", item({ id: "m", seq: 1, role: "assistant", content: "Hello" })),
      NOW,
    );
    expect(state.blocks).toHaveLength(0);
    expect(state.items).toHaveLength(1);
  });

  it("gives a delta whose start was missed a block of its own", () => {
    const state = fresh([event("lucy.content.text.delta", { delta: "mid" }, { turn_id: "trn" })]);
    expect(state.blocks[0]).toMatchObject({ text: "mid", open: true });
  });

  it("keeps two blocks with different ids apart", () => {
    const state = fresh([
      event("lucy.content.text.start", { id: "one" }),
      event("lucy.content.text.start", { id: "two" }),
      event("lucy.content.text.delta", { id: "two", delta: "B" }),
      event("lucy.content.text.delta", { id: "one", delta: "A" }),
      event("lucy.content.text.end", { id: "one" }),
    ]);
    expect(state.blocks.map((block) => [block.text, block.open])).toEqual([
      ["A", false],
      ["B", true],
    ]);
  });

  it("collects reasoning separately and drops it when the turn ends", () => {
    const state = fresh([
      event("lucy.content.reasoning.start", {}, { turn_id: "trn" }),
      event("lucy.content.reasoning.delta", { delta: "hmm" }, { turn_id: "trn" }),
      event("lucy.content.reasoning.end", {}, { turn_id: "trn" }),
      event("lucy.turn.completed", {}, { turn_id: "trn" }),
    ]);
    expect(state.blocks).toHaveLength(0);
  });

  it("closing a block that never opened is nothing", () => {
    const state = fresh([event("lucy.content.text.end", { id: "ghost" })]);
    expect(state.blocks).toHaveLength(0);
  });
});

describe("a turn's life", () => {
  it("walks created, started, completed, and holds the outcome for the face", () => {
    const state = fresh([event("lucy.turn.created", {}, { turn_id: "t1" })]);
    expect(state.turn).toMatchObject({ id: "t1", status: "queued" });
    reduce(state, event("lucy.turn.started", {}, { turn_id: "t1" }), NOW);
    expect(state.turn.status).toBe("running");
    reduce(state, event("lucy.turn.completed", {}, { turn_id: "t1" }), NOW);
    expect(state.turn.status).toBe("completed");
    expect(state.outcome).toEqual({ kind: "done", at: NOW });
  });

  it("marks failure and cancellation differently", () => {
    const failed = fresh([
      event("lucy.turn.started", {}, { turn_id: "t" }),
      event("lucy.turn.failed", {}, { turn_id: "t" }),
    ]);
    expect(failed.outcome?.kind).toBe("failed");
    const cancelled = fresh([
      event("lucy.turn.started", {}, { turn_id: "t" }),
      event("lucy.turn.cancelled", {}, { turn_id: "t" }),
    ]);
    expect(cancelled.turn.status).toBe("cancelled");
    expect(cancelled.outcome).toBeNull();
  });

  it("supersession ends the turn the same way as a cancel", () => {
    const state = fresh([
      event("lucy.turn.started", {}, { turn_id: "t" }),
      event("lucy.turn.superseded", {}, { turn_id: "t" }),
    ]);
    expect(state.turn.status).toBe("cancelled");
  });

  it("a message queued behind a live turn does not displace it on screen", () => {
    const state = fresh([
      event("lucy.turn.created", {}, { turn_id: "t1" }),
      event("lucy.turn.started", {}, { turn_id: "t1" }),
      event("lucy.turn.created", { queued_behind: "t1" }, { turn_id: "t2" }),
    ]);
    expect(state.turn.id).toBe("t1");
    reduce(state, event("lucy.turn.completed", {}, { turn_id: "t1" }), NOW);
    reduce(state, event("lucy.turn.created", { queued_behind: null }, { turn_id: "t3" }), NOW);
    expect(state.turn.id).toBe("t3");
  });

  it("an ending for some other turn changes nothing on screen", () => {
    const state = fresh([event("lucy.turn.started", {}, { turn_id: "t1" })]);
    reduce(state, event("lucy.turn.failed", {}, { turn_id: "t0" }), NOW);
    expect(state.turn).toMatchObject({ id: "t1", status: "running" });
  });

  it("parks on the person for approval and for a connection", () => {
    const approval = fresh([
      event("lucy.turn.started", {}, { turn_id: "t" }),
      event("lucy.turn.input_required", {}, { turn_id: "t" }),
    ]);
    expect(approval.turn.status).toBe("input_required");
    const auth = fresh([
      event("lucy.turn.started", {}, { turn_id: "t" }),
      event("lucy.turn.auth_required", {}, { turn_id: "t" }),
    ]);
    expect(auth.turn.status).toBe("auth_required");
  });

  it("notices a slow turn, only for the turn on screen", () => {
    const state = fresh([
      event("lucy.turn.started", {}, { turn_id: "t" }),
      event("lucy.turn.slow", { seconds: 30 }, { turn_id: "t" }),
    ]);
    expect(state.turn.slow).toBe(true);
    reduce(state, event("lucy.turn.slow", {}, { turn_id: "other" }), NOW);
  });
});

describe("approval cards", () => {
  const cardItem = (id: string, seq: number, turn = "t") =>
    event(
      "lucy.content.item.added",
      item({
        id: `itm_${id}`,
        seq,
        type: "approval_request",
        content: { approval_id: id, tool: "music.play", description: "Play it" },
        turn_id: turn,
      }),
    );

  it("a requested card is pending until its answer arrives on the stream", () => {
    const state = fresh([event("lucy.approval.requested", { approval_id: "apr" }), cardItem("apr", 1)]);
    expect(pendingCards(state)).toHaveLength(1);
    reduce(
      state,
      event("lucy.approval.granted", { approval_id: "apr", approved: true, lifetime: "session", instruction: "" }),
      NOW,
    );
    expect(pendingCards(state)).toHaveLength(0);
    expect(cardsOf(state)[0]).toMatchObject({ status: "granted", record: { lifetime: "session" } });
  });

  it("a denial records the no and shows the face a blocked moment", () => {
    const state = fresh([event("lucy.approval.requested", { approval_id: "apr" }), cardItem("apr", 1)]);
    reduce(
      state,
      event("lucy.approval.denied", { approval_id: "apr", approved: false, lifetime: "once", instruction: "too loud" }),
      NOW,
    );
    expect(cardsOf(state)[0]).toMatchObject({ status: "denied", record: { instruction: "too loud" } });
    expect(state.outcome?.kind).toBe("blocked");
  });

  it("an answer item read from history records the decision too", () => {
    const state = fresh([
      cardItem("apr", 1),
      event(
        "lucy.content.item.added",
        item({
          id: "itm_r",
          seq: 2,
          type: "approval_response",
          content: { approval_id: "apr", approved: true, lifetime: "once" },
        }),
      ),
    ]);
    expect(cardsOf(state)[0]!.status).toBe("granted");
  });

  it("a card arriving as a live item while the stream missed the request is still pending", () => {
    const state = fresh([cardItem("apr", 1)]);
    expect(state.cards.apr).toMatchObject({ status: "pending" });
  });

  it("a card from history alone is pending only while its own turn is parked", () => {
    const parked = fresh([event("lucy.turn.input_required", {}, { turn_id: "t" })]);
    upsertItems(parked, [
      item({
        id: "itm_apr",
        seq: 1,
        type: "approval_request",
        content: { approval_id: "apr", tool: "x" },
        turn_id: "t",
      }),
    ]);
    expect(cardsOf(parked)[0]!.status).toBe("pending");

    const done = fresh();
    upsertItems(done, [
      item({
        id: "itm_apr",
        seq: 1,
        type: "approval_request",
        content: { approval_id: "apr", tool: "x" },
        turn_id: "t",
      }),
    ]);
    expect(cardsOf(done)[0]!.status).toBe("closed");
  });

  it("an expired card says so, and malformed card bodies are skipped", () => {
    const state = fresh([event("lucy.approval.expired", { approval_id: "apr" }), event("lucy.approval.expired", {})]);
    expect(state.cards.apr?.status).toBe("expired");
    upsertItems(state, [item({ id: "junk", seq: 9, type: "approval_request", content: "not a card" })]);
    expect(cardsOf(state)).toHaveLength(0);
    reduce(state, event("lucy.approval.granted", { approved: true }), NOW);
    reduce(state, event("lucy.approval.requested", {}), NOW);
  });
});

describe("the window, connections and work", () => {
  it("reads the context report", () => {
    const state = fresh([
      event("lucy.context.status", {
        used_tokens: 10,
        window_tokens: 100,
        percent: 10,
        warn_at_percent: 60,
        compact_at_percent: 72,
        tokens_until_compaction: 62,
        summarised_turns: 2,
        state: "ok",
      }),
    ]);
    expect(state.window).toMatchObject({ percent: 10, compactAtPercent: 72, summarisedTurns: 2, state: "ok" });
    reduce(state, event("lucy.compaction.applied", { trigger: "auto" }), NOW);
    expect(state.compactedAt).toBe(NOW);
  });

  it("keeps one connection prompt per service and clears them on a new turn", () => {
    const state = fresh([
      event("lucy.connection.required", {
        service: "spotify",
        scopes: ["playback"],
        connect_url: "/connect?x",
        message: "Ask the person.",
      }),
      event("lucy.connection.required", {
        service: "spotify",
        scopes: [],
        connect_url: "/connect?y",
        message: "Again.",
      }),
      event("lucy.connection.required", { not_a_service: true }),
    ]);
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0]!.connectUrl).toBe("/connect?y");
    reduce(state, event("lucy.turn.created", {}, { turn_id: "t2" }), NOW);
    expect(state.connections).toHaveLength(0);
  });

  it("keeps finished work newest-first, one row per id, and skips rows with no id", () => {
    const state = fresh([
      event("lucy.work.finished", {
        work_id: "w1",
        kind: "job",
        role: "download",
        state: "finished",
        elapsed_seconds: 4,
      }),
      event("lucy.work.finished", {
        work_id: "w2",
        kind: "agent",
        role: "researcher",
        state: "failed",
        elapsed_seconds: 9,
        group: "team",
      }),
      event("lucy.work.finished", {
        work_id: "w1",
        kind: "job",
        role: "download",
        state: "finished",
        elapsed_seconds: 5,
      }),
      event("lucy.work.finished", {}),
    ]);
    expect(state.work.map((row) => row.id)).toEqual(["w1", "w2"]);
    expect(state.work[1]).toMatchObject({ group: "team" });
  });
});

describe("what is unknown is counted", () => {
  it("counts events this UI has no reading for, and known-but-unhandled ones are quiet", () => {
    const state = fresh([event("lucy.memory.written", {}), event("lucy.stream.resumed", { replayed: 2 })]);
    expect(state.unknownEvents).toBe(1);
  });
});

describe("working", () => {
  it("is working once the running turn has a step result, and not before", () => {
    const state = fresh([event("lucy.turn.started", {}, { turn_id: "t" })]);
    expect(isWorking(state)).toBe(false);
    reduce(state, event("lucy.content.item.added", item({ id: "s", seq: 1, type: "tool_result", turn_id: "t" })), NOW);
    expect(isWorking(state)).toBe(true);
    reduce(state, event("lucy.content.item.added", item({ id: "m", seq: 2, type: "message", turn_id: "t" })), NOW);
    expect(isWorking(state)).toBe(false);
    reduce(state, event("lucy.turn.completed", {}, { turn_id: "t" }), NOW);
    expect(isWorking(state)).toBe(false);
  });
});
