// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { CORE, SHELL, useCore, useShell } from "../../src/app/context";
import { createAuth } from "../../src/auth/auth";
import type { Mood } from "../../src/face/moods";
import type { LucyEvent } from "../../src/protocol/events";
import type { Page, Session } from "../../src/protocol/sessions";
import { routes } from "../../src/router";
import type { FollowHandlers, LucyTransport } from "../../src/transport/types";
import FaceLab from "../../src/views/FaceLab.vue";
import HomeView from "../../src/views/HomeView.vue";
import SessionView from "../../src/views/SessionView.vue";

function token(expSeconds: number): string {
  return `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.s`;
}

function session(id: string, title: string): Session {
  return {
    id,
    profile: "personal",
    title,
    status: "idle",
    model: "m",
    permission_mode: "ask",
    input_policy: "enqueue",
    created_at: 0,
    updated_at: 1,
    archived_at: null,
    input_tokens: 0,
    output_tokens: 0,
    cost_micros: 0,
  };
}

class FakeTransport implements LucyTransport {
  handlers: FollowHandlers | null = null;
  sent: { sessionId: string; events: unknown[] }[] = [];
  created: string[] = [];
  cancelled: string[] = [];
  me = () => Promise.resolve({ account_id: "acct", audience: "lucy-api" });
  listSessions = (): Promise<Page<Session>> =>
    Promise.resolve({ data: [], has_more: false, first_id: null, last_id: null });
  createSession = (body: { title?: string }) => {
    this.created.push(body.title ?? "");
    return Promise.resolve(session("ses_new", body.title ?? ""));
  };
  updateSession = (id: string) => Promise.resolve(session(id, "t"));
  listItems = () => Promise.resolve({ data: [], has_more: false, first_id: null, last_id: null });
  send = (sessionId: string, events: unknown[]) => {
    this.sent.push({ sessionId, events });
    return Promise.resolve({ id: "trn", session_id: sessionId, status: "queued" });
  };
  cancelTurn = (turnId: string) => {
    this.cancelled.push(turnId);
    return Promise.resolve({ id: turnId, session_id: "ses", status: "cancelled" });
  };
  startDevice = () => Promise.reject(new Error("unused"));
  pollDevice = () => Promise.reject(new Error("unused"));
  follow = (_: string, handlers: FollowHandlers, signal: AbortSignal): Promise<void> => {
    this.handlers = handlers;
    return new Promise((resolve) => signal.addEventListener("abort", () => resolve()));
  };
}

function coreWith(transport: FakeTransport, signedIn = true) {
  const value: string | null = signedIn ? token(4_000_000_000) : null;
  const auth = createAuth({ transport, store: { read: () => value, write: () => {} } });
  if (signedIn) auth.restore();
  return { transport, auth };
}

function shellWith(core: ReturnType<typeof coreWith>) {
  return {
    sessions: {
      state: { sessions: [], loaded: true, error: null, showArchived: false },
      refresh: () => Promise.resolve(),
      // Like the real store: a refusal becomes null, never a rejection.
      create: (body: { title?: string }) => core.transport.createSession(body).catch(() => null),
      archive: () => Promise.resolve(),
      visible: () => [],
    } as never,
    follow: ref(false),
    busy: ref(false),
  };
}

describe("the context", () => {
  it("throws a named sentence when a screen mounts outside the app", () => {
    const Orphan = defineComponent({
      setup() {
        expect(() => useCore()).toThrow(/core context/);
        expect(() => useShell()).toThrow(/shell context/);
        return () => h("div");
      },
    });
    mount(Orphan);
  });
});

describe("FaceLab", () => {
  it("shows every mood as a button and names the one chosen", async () => {
    const wrapper = mount(FaceLab, {
      global: {
        stubs: {
          RouterLink: { template: "<a><slot /></a>" },
          LucyFace: { props: ["mood"], template: "<div class='face-stub' :data-mood='mood' />" },
        },
      },
    });
    expect(wrapper.findAll(".lab-moods button").length).toBeGreaterThan(10);
    await wrapper.findAll(".lab-moods button").at(4)!.trigger("click");
    expect(wrapper.find(".lab-now").text()).toContain("thinking");
    expect(wrapper.find(".face-stub").attributes("data-mood")).toBe("thinking");
  });
});

describe("HomeView", () => {
  it("starts a conversation from the first message and sends it", async () => {
    const core = coreWith(new FakeTransport());
    const shell = shellWith(core);
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [router],
        provide: { [CORE as symbol]: core, [SHELL as symbol]: shell },
        stubs: { LucyFace: { props: ["mood"], template: "<div class='face-stub' :data-mood='mood' />" } },
      },
    });
    await wrapper.find("input").setValue("play some asake");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(core.transport.created).toEqual(["play some asake"]);
    expect(core.transport.sent[0]).toMatchObject({ sessionId: "ses_new" });
    expect(router.currentRoute.value.params.id).toBe("ses_new");
  });

  it("swallows an empty start and stays put when the hub refuses one", async () => {
    const core = coreWith(new FakeTransport());
    core.transport.createSession = () => Promise.reject(new Error("refused"));
    const shell = shellWith(core);
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(HomeView, {
      global: {
        plugins: [router],
        provide: { [CORE as symbol]: core, [SHELL as symbol]: shell },
        stubs: { LucyFace: { props: ["mood"], template: "<div class='face-stub' :data-mood='mood' />" } },
      },
    });
    await wrapper.find("form").trigger("submit");
    expect(core.transport.sent).toHaveLength(0);
    await wrapper.find("input").setValue("hello");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(core.transport.sent).toHaveLength(0);
  });

  it("tells a signed-out visitor Lucy is asleep", () => {
    const core = coreWith(new FakeTransport(), false);
    const router = createRouter({ history: createMemoryHistory(), routes });
    const wrapper = mount(HomeView, {
      global: {
        plugins: [router],
        provide: { [CORE as symbol]: core, [SHELL as symbol]: shellWith(core) },
        stubs: { LucyFace: { props: ["mood"], template: "<div class='face-stub' :data-mood='mood' />" } },
      },
    });
    expect(wrapper.text()).toContain("asleep");
    expect(wrapper.find("form").exists()).toBe(false);
  });
});

describe("SessionView", () => {
  function mountSession() {
    const core = coreWith(new FakeTransport());
    const shell = shellWith(core);
    const moods: Mood[] = [];
    const wrapper = mount(SessionView, {
      props: { id: "ses_1" },
      global: {
        provide: { [CORE as symbol]: core, [SHELL as symbol]: shell },
        stubs: {
          LucyFace: {
            props: ["mood"],
            template: "<div class='face-stub' :data-mood='mood' />",
          },
        },
      },
    });
    const emit = (event: LucyEvent) => core.transport.handlers!.onEvent(event);
    return { core, shell, wrapper, moods, emit };
  }

  const event = (type: string, data: object = {}, extra: object = {}): LucyEvent => ({
    type,
    session_id: "ses_1",
    created_at: 0,
    data: data as LucyEvent["data"],
    ...extra,
  });

  it("shows the title from the snapshot and labels a headed conversation", async () => {
    const { wrapper, emit } = mountSession();
    emit(event("lucy.stream.snapshot", { state: { title: "Claude Code · smoke" } }));
    await flushPromises();
    expect(wrapper.find("h1").text()).toBe("Claude Code · smoke");
    expect(wrapper.text()).toContain("Claude Code is driving");
  });

  it("derives the face's mood from the turn, and holds Follow while a card waits", async () => {
    const { wrapper, shell, emit } = mountSession();
    await flushPromises();
    expect(wrapper.find(".face-stub").attributes("data-mood")).toBe("idle");
    emit(event("lucy.turn.started", {}, { turn_id: "t" }));
    await flushPromises();
    expect(wrapper.find(".face-stub").attributes("data-mood")).toBe("thinking");
    emit(event("lucy.approval.requested", { approval_id: "apr" }));
    emit(
      event("lucy.content.item.added", {
        id: "itm",
        seq: 1,
        type: "approval_request",
        role: "assistant",
        content: { approval_id: "apr", tool: "music.play", description: "Play?" },
        turn_id: "t",
        created_at: 0,
      }),
    );
    await flushPromises();
    expect(wrapper.find(".face-stub").attributes("data-mood")).toBe("needs_you");
    expect(shell.busy.value).toBe(true);
  });

  it("sends the composer's words and relays a card's answer and a cancel", async () => {
    const { core, wrapper, emit } = mountSession();
    emit(event("lucy.turn.started", {}, { turn_id: "trn_9" }));
    await flushPromises();
    await wrapper.find(".composer textarea").setValue("hello");
    await wrapper.find(".composer form, form.composer").trigger("submit");
    await flushPromises();
    expect(core.transport.sent[0]!.events[0]).toMatchObject({ type: "input.message", content: "hello" });
    await wrapper.find(".composer .danger, .panel .danger").trigger("click");
    await flushPromises();
    expect(core.transport.cancelled).toContain("trn_9");
  });

  it("answers a card from the transcript, asks for earlier history, and cancels from the panel", async () => {
    const { core, wrapper, emit } = mountSession();
    emit(event("lucy.stream.snapshot", { state: {} }));
    emit(event("lucy.turn.started", {}, { turn_id: "trn_1" }));
    emit(event("lucy.approval.requested", { approval_id: "apr" }));
    emit(
      event("lucy.content.item.added", {
        id: "itm",
        seq: 1,
        type: "approval_request",
        role: "assistant",
        content: { approval_id: "apr", tool: "music.play", description: "Play?" },
        turn_id: "trn_1",
        created_at: 0,
      }),
    );
    await flushPromises();
    await wrapper.find(".card-actions button").trigger("click");
    await flushPromises();
    expect(core.transport.sent[0]!.events[0]).toMatchObject({ type: "input.approval", approval_id: "apr" });
    await wrapper.find(".panel .danger").trigger("click");
    await flushPromises();
    expect(core.transport.cancelled).toContain("trn_1");
    wrapper.unmount();
  });

  it("keeps its clock ticking so a held outcome can lapse", async () => {
    vi.useFakeTimers();
    try {
      const { wrapper, emit } = mountSession();
      emit(event("lucy.stream.snapshot", { state: {} }));
      emit(event("lucy.turn.started", {}, { turn_id: "t" }));
      emit(event("lucy.turn.completed", {}, { turn_id: "t" }));
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".face-stub").attributes("data-mood")).toBe("done");
      await vi.advanceTimersByTimeAsync(5000);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".face-stub").attributes("data-mood")).toBe("idle");
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for the page before the oldest item", async () => {
    const { core, wrapper, emit } = mountSession();
    const calls: { after?: string }[] = [];
    core.transport.listItems = ((_: string, query?: { after?: string }) => {
      calls.push({ after: query?.after });
      return Promise.resolve({
        data: [
          {
            id: "old",
            seq: 1,
            type: "message",
            role: "user",
            content: "hi",
            turn_id: null,
            agent_id: null,
            created_at: 0,
          },
        ],
        has_more: true,
        first_id: "old",
        last_id: "old",
      });
    }) as never;
    emit(event("lucy.stream.snapshot", { state: {} }));
    await flushPromises();
    await wrapper.find(".transcript-earlier button").trigger("click");
    await flushPromises();
    expect(calls.at(-1)).toEqual({ after: "old" });
  });

  it("shows a send failure and lets the person dismiss it", async () => {
    const { core, wrapper } = mountSession();
    core.transport.send = () => Promise.reject(new Error("409 busy"));
    await flushPromises();
    await wrapper.find(".composer textarea").setValue("hi");
    await wrapper.find("form.composer").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".session-error").text()).toContain("409 busy");
    await wrapper.find(".session-error button").trigger("click");
    expect(wrapper.find(".session-error").exists()).toBe(false);
  });
});
