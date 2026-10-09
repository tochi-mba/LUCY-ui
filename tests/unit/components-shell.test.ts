// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ContextMeter from "../../src/components/ContextMeter.vue";
import MessageComposer from "../../src/components/MessageComposer.vue";
import SessionRail from "../../src/components/SessionRail.vue";
import SidePanel from "../../src/components/SidePanel.vue";
import type { Session } from "../../src/protocol/sessions";
import { createConversation } from "../../src/stores/conversation";

function session(id: string, partial: Partial<Session> = {}): Session {
  return {
    id,
    profile: "personal",
    title: id,
    status: "idle",
    model: "m",
    permission_mode: "ask",
    input_policy: "enqueue",
    created_at: 0,
    updated_at: Date.now() / 1000,
    archived_at: null,
    input_tokens: 0,
    output_tokens: 0,
    cost_micros: 0,
    ...partial,
  };
}

describe("Composer", () => {
  it("sends a draft on Enter and clears it; Shift+Enter stays a newline", async () => {
    const wrapper = mount(MessageComposer, { props: { turn: "idle" } });
    const input = wrapper.find("textarea");
    await input.setValue("hello");
    expect(wrapper.emitted("composing")?.at(-1)).toEqual([true]);
    await input.trigger("keydown.enter", { shiftKey: true });
    expect(wrapper.emitted("send")).toBeUndefined();
    await input.trigger("keydown.enter");
    expect(wrapper.emitted("send")).toEqual([["hello"]]);
    expect((input.element as HTMLTextAreaElement).value).toBe("");
  });

  it("sends nothing empty, even by button", async () => {
    const wrapper = mount(MessageComposer, { props: { turn: "idle" } });
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("send")).toBeUndefined();
    expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeDefined();
  });

  it("offers Stop while the turn is live, with the right hint", async () => {
    for (const [turn, said] of [
      ["queued", "Queued"],
      ["running", "keep typing"],
      ["input_required", "card above"],
      ["auth_required", "connection"],
    ] as const) {
      const wrapper = mount(MessageComposer, { props: { turn } });
      expect(wrapper.text()).toContain(said);
      await wrapper.find("button.danger").trigger("click");
      expect(wrapper.emitted("cancel")).toHaveLength(1);
    }
    expect(
      mount(MessageComposer, { props: { turn: "completed" } })
        .find("button.danger")
        .exists(),
    ).toBe(false);
  });

  it("is disabled while signed out, and swallows a send then", async () => {
    const wrapper = mount(MessageComposer, { props: { turn: "idle", disabled: true } });
    const input = wrapper.find("textarea");
    expect(input.attributes("disabled")).toBeDefined();
    await input.setValue("x");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("send")).toBeUndefined();
  });
});

describe("ContextMeter", () => {
  const report = {
    usedTokens: 42_000,
    windowTokens: 100_000,
    percent: 42,
    warnAtPercent: 60,
    compactAtPercent: 72,
    tokensUntilCompaction: 30_000,
    summarisedTurns: 0,
    state: "ok",
  };

  it("shows the number the hub acts on", () => {
    const wrapper = mount(ContextMeter, { props: { window: report } });
    expect(wrapper.text()).toContain("42%");
    expect(wrapper.text()).toContain("tokens until Lucy summarises");
    expect(wrapper.find("[role=meter]").attributes("aria-valuenow")).toBe("42");
  });

  it("speaks compaction states and counts summarised turns", () => {
    const compacting = mount(ContextMeter, {
      props: { window: { ...report, state: "compacting", summarisedTurns: 1 } },
    });
    expect(compacting.text()).toContain("Compacting");
    expect(compacting.text()).toContain("1 older turn read as a summary");
    const over = mount(ContextMeter, {
      props: { window: { ...report, state: "over", summarisedTurns: 3, percent: 104 } },
    });
    expect(over.text()).toContain("Over the window");
    expect(over.text()).toContain("3 older turns");
  });
});

describe("SessionRail", () => {
  it("lists conversations with liveness, the Claude Code badge and a current marker", () => {
    vi.setSystemTime(new Date(100_000_000));
    const wrapper = mount(SessionRail, {
      props: {
        sessions: [
          session("a", { title: "Claude Code · smoke", status: "running", updated_at: 100_000_000 / 1000 - 30 }),
          session("b", { title: "Music", status: "input_required", updated_at: 100_000_000 / 1000 - 7200 }),
          session("c", { title: "Old", updated_at: 100_000_000 / 1000 - 200_000 }),
        ],
        currentId: "b",
        follow: false,
        loaded: true,
      },
    });
    const rows = wrapper.findAll(".rail-row");
    expect(rows[0]!.find(".rail-badge").exists()).toBe(true);
    expect(rows[0]!.find(".rail-dot").attributes("data-live")).toBe("true");
    expect(rows[1]!.attributes("aria-current")).toBe("page");
    expect(rows[1]!.find(".rail-dot").attributes("data-waiting")).toBe("true");
    expect(rows[0]!.text()).toContain("now");
    expect(rows[1]!.text()).toContain("2h");
    expect(rows[2]!.text()).toContain("2d");
    vi.useRealTimers();
  });

  it("opens a conversation, toggles follow, and starts a named one", async () => {
    const wrapper = mount(SessionRail, {
      props: {
        sessions: [session("a", { updated_at: Date.now() / 1000 - 90 })],
        currentId: null,
        follow: false,
        loaded: true,
      },
    });
    await wrapper.find(".rail-row").trigger("click");
    expect(wrapper.emitted("open")).toEqual([["a"]]);
    await wrapper.find(".rail-follow input").setValue(true);
    expect(wrapper.emitted("update:follow")).toEqual([[true]]);
    await wrapper.find(".rail-head button").trigger("click");
    await wrapper.find(".rail-new input").setValue("Plans");
    await wrapper.find(".rail-new").trigger("submit");
    expect(wrapper.emitted("create")).toEqual([["Plans"]]);
    expect(wrapper.find(".rail-new").exists()).toBe(false);
  });

  it("says when there is nothing yet", () => {
    expect(
      mount(SessionRail, { props: { sessions: [], currentId: null, follow: false, loaded: true } }).text(),
    ).toContain("No conversations yet");
  });
});

describe("SidePanel", () => {
  it("shows the live turn with a stop button, and stays quiet when idle", async () => {
    const live = createConversation("ses");
    live.turn = { id: "t", status: "running", slow: true };
    live.stream = "open";
    const wrapper = mount(SidePanel, { props: { conversation: live } });
    expect(wrapper.text()).toContain("running");
    expect(wrapper.text()).toContain("taking a while");
    expect(wrapper.text()).toContain("Live");
    await wrapper.find("button.danger").trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);

    const idle = createConversation("ses");
    expect(
      mount(SidePanel, { props: { conversation: idle } })
        .find("button.danger")
        .exists(),
    ).toBe(false);
  });

  it("lists finished work, unknown events and a compaction notice", () => {
    const state = createConversation("ses");
    state.turn = { id: "t", status: "completed", slow: false };
    state.work = [{ id: "w", kind: "job", role: "download", state: "finished", elapsedSeconds: 4, group: null }];
    state.unknownEvents = 2;
    state.compactedAt = 5;
    state.stream = "reconnecting";
    const wrapper = mount(SidePanel, { props: { conversation: state } });
    expect(wrapper.text()).toContain("download");
    expect(wrapper.text()).toContain("2 events this page has no view for");
    expect(wrapper.text()).toContain("summarised");
    expect(wrapper.text()).toContain("retrying");
    expect(wrapper.find("button.danger").exists()).toBe(false);
  });
});
