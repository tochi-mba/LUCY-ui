// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TranscriptView from "../../src/components/TranscriptView.vue";
import type { LucyEvent } from "../../src/protocol/events";
import type { Item } from "../../src/protocol/items";
import { createConversation, reduce, upsertItems } from "../../src/stores/conversation";

function item(partial: Partial<Item> & { id: string; seq: number }): Item {
  return { type: "message", role: "assistant", content: "", turn_id: "t", agent_id: null, created_at: 0, ...partial };
}

const event = (type: string, data: object = {}, extra: Partial<LucyEvent> = {}): LucyEvent => ({
  type,
  session_id: "ses",
  created_at: 0,
  data: data as LucyEvent["data"],
  ...extra,
});

function mounted(prepare: (state: ReturnType<typeof createConversation>) => void) {
  const state = createConversation("ses");
  prepare(state);
  state.loaded = true;
  return { state, wrapper: mount(TranscriptView, { props: { conversation: state, speaker: "You" } }) };
}

describe("TranscriptView", () => {
  it("renders each item kind in order, hides answers, and skips cards it cannot read", () => {
    const { wrapper } = mounted((state) => {
      upsertItems(state, [
        item({ id: "m1", seq: 1, role: "user", content: "hi" }),
        item({ id: "s1", seq: 2, type: "tool_result", content: { operation: "music.find", status: "ok" } }),
        item({
          id: "a1",
          seq: 3,
          type: "approval_request",
          content: { approval_id: "apr", tool: "music.play", description: "Play?" },
        }),
        item({ id: "r1", seq: 4, type: "approval_response", content: { approval_id: "apr", approved: true } }),
        item({ id: "e1", seq: 5, type: "error", content: { code: "x", detail: "went wrong" } }),
        item({ id: "g1", seq: 6, type: "oddity", content: {} }),
        item({ id: "bad", seq: 7, type: "approval_request", content: "unreadable" }),
      ]);
      state.cards.apr = { status: "pending", lifetime: "once", instruction: "" };
    });
    expect(wrapper.findAll("[data-kind=message]")).toHaveLength(1);
    expect(wrapper.findAll("[data-kind=tool_result]")).toHaveLength(1);
    expect(wrapper.findAll(".card")).toHaveLength(1);
    expect(wrapper.findAll("[data-kind=error]")).toHaveLength(1);
    expect(wrapper.findAll("[data-kind=generic]")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("unreadable");
  });

  it("relays a card's answer with its approval id", async () => {
    const { wrapper } = mounted((state) => {
      upsertItems(state, [
        item({
          id: "a1",
          seq: 1,
          type: "approval_request",
          content: { approval_id: "apr", tool: "x", description: "?" },
        }),
      ]);
      state.cards.apr = { status: "pending", lifetime: "once", instruction: "" };
    });
    await wrapper.find(".card-actions button").trigger("click");
    const [approvalId, choice] = wrapper.emitted("answer")![0] as [string, object];
    expect(approvalId).toBe("apr");
    expect(choice).toMatchObject({ approved: true, lifetime: "once" });
  });

  it("shows streaming text and open reasoning, and asks for earlier history", async () => {
    const { wrapper } = mounted((state) => {
      state.hasEarlier = true;
      reduce(state, event("lucy.content.text.start", {}, { turn_id: "t" }), 0);
      reduce(state, event("lucy.content.text.delta", { delta: "Hello" }, { turn_id: "t" }), 0);
      reduce(state, event("lucy.content.reasoning.start", {}, { turn_id: "t" }), 0);
      reduce(state, event("lucy.content.reasoning.delta", { delta: "mull" }, { turn_id: "t" }), 0);
    });
    expect(wrapper.find("[data-kind=streaming]").text()).toContain("Hello");
    expect(wrapper.find("[data-kind=reasoning]").text()).toContain("mull");
    await wrapper.find(".transcript-earlier button").trigger("click");
    expect(wrapper.emitted("earlier")).toHaveLength(1);
  });

  it("says when nothing has been said", () => {
    const { wrapper } = mounted(() => {});
    expect(wrapper.text()).toContain("Nothing said yet");
  });

  it("offers the jump pill only after the person scrolls up", async () => {
    const { state, wrapper } = mounted((prepared) => upsertItems(prepared, [item({ id: "m", seq: 1, content: "x" })]));
    expect(wrapper.find(".jump").exists()).toBe(false);
    const scroller = wrapper.find(".transcript");
    Object.defineProperties(scroller.element, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 300 },
      scrollTop: { value: 100, writable: true },
    });
    await scroller.trigger("scroll");
    expect(wrapper.find(".jump").exists()).toBe(true);
    upsertItems(state, [item({ id: "m2", seq: 2, content: "y" })]);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(scroller.element.scrollTop).toBe(100);
    await wrapper.find(".jump").trigger("click");
    expect(wrapper.find(".jump").exists()).toBe(false);
    expect(scroller.element.scrollTop).toBe(1000);
  });
});
