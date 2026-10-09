// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
// Pre-load the lazy views so a navigation in a test resolves instead of waiting on a transform.
import "../../src/views/HomeView.vue";
import "../../src/views/SessionView.vue";
import "../../src/views/FaceLab.vue";
import { createMemoryHistory, createRouter } from "vue-router";
import App from "../../src/App.vue";
import { CORE } from "../../src/app/context";
import { createAuth } from "../../src/auth/auth";
import type { Page, Session } from "../../src/protocol/sessions";
import { routes } from "../../src/router";
import type { FollowHandlers, LucyTransport } from "../../src/transport/types";

function token(expSeconds: number): string {
  return `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.s`;
}

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
    updated_at: 1,
    archived_at: null,
    input_tokens: 0,
    output_tokens: 0,
    cost_micros: 0,
    ...partial,
  };
}

class FakeTransport implements LucyTransport {
  rows: Session[] = [];
  me = () => Promise.resolve({ account_id: "acct", audience: "lucy-api" });
  listSessions = (): Promise<Page<Session>> =>
    Promise.resolve({ data: this.rows, has_more: false, first_id: null, last_id: null });
  createSession = (body: { title?: string }) => Promise.resolve(session("ses_new", { title: body.title ?? "" }));
  updateSession = (id: string) => Promise.resolve(session(id, { archived_at: 1 }));
  listItems = () => Promise.resolve({ data: [], has_more: false, first_id: null, last_id: null });
  send = () => Promise.reject(new Error("unused"));
  cancelTurn = () => Promise.reject(new Error("unused"));
  startDevice = () => Promise.reject(new Error("unused"));
  pollDevice = () => Promise.reject(new Error("unused"));
  follow = (_: string, __: FollowHandlers, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => signal.addEventListener("abort", () => resolve()));
}

/** Lets a router navigation, and the lazy view it imports, finish. */
async function arrivedAt(router: { currentRoute: { value: { params: Record<string, unknown> } } }, id: string) {
  await vi.waitFor(() => expect(router.currentRoute.value.params.id).toBe(id), { timeout: 5000 });
}

async function mountApp(rows: Session[] = []) {
  const transport = new FakeTransport();
  transport.rows = rows;
  const value = token(4_000_000_000);
  const auth = createAuth({ transport, store: { read: () => value, write: () => {} } });
  auth.restore();
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push("/");
  await router.isReady();
  const wrapper = mount(App, {
    global: {
      plugins: [router],
      provide: { [CORE as symbol]: { transport, auth } },
      stubs: { LucyFace: { props: ["mood"], template: "<div class='face-stub' />" } },
    },
  });
  await flushPromises();
  return { wrapper, router, transport, auth };
}

describe("the shell", () => {
  it("lists conversations, opens one, and closes the phone rail on the way", async () => {
    const { wrapper, router } = await mountApp([session("ses_a", { title: "Music" })]);
    expect(wrapper.find(".rail-title").text()).toBe("Music");
    await wrapper.find(".rail-toggle").trigger("click");
    expect(wrapper.find(".body").attributes("data-rail-open")).toBe("true");
    await wrapper.find(".rail-row").trigger("click");
    await arrivedAt(router, "ses_a");
    expect(wrapper.find(".body").attributes("data-rail-open")).toBe("false");
  });

  it("creates a conversation from the rail and navigates to it", async () => {
    const { wrapper, router } = await mountApp();
    await wrapper.find(".rail-head button").trigger("click");
    await wrapper.find(".rail-new input").setValue("Plans");
    await wrapper.find(".rail-new").trigger("submit");
    await arrivedAt(router, "ses_new");
  });

  it("follows whatever is live, except while the person is busy", async () => {
    const { wrapper, router, transport } = await mountApp([session("quiet")]);
    await wrapper.find(".rail-follow input").setValue(true);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    transport.rows = [session("live_1", { status: "running", updated_at: 9 })];
    const sessions = wrapper.findComponent({ name: "SessionRail" });
    void sessions;
    // The poll is on a timer; refresh through the exposed state by flipping follow off and on.
    await wrapper.find(".rail-follow input").setValue(false);
    await wrapper.find(".rail-follow input").setValue(true);
    await arrivedAt(router, "live_1");
  });

  it("archives a conversation from its row without opening it", async () => {
    const { wrapper, router } = await mountApp([session("ses_a", { title: "Music" })]);
    await wrapper.find(".rail-archive").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(wrapper.find(".rail-row").exists()).toBe(false);
  });

  it("names a nameless new conversation for the person", async () => {
    const { wrapper, transport, router } = await mountApp();
    const created: string[] = [];
    const make = transport.createSession.bind(transport);
    transport.createSession = (body) => {
      created.push(body.title ?? "");
      return make(body);
    };
    await wrapper.find(".rail-head button").trigger("click");
    await wrapper.find(".rail-new").trigger("submit");
    await arrivedAt(router, "ses_new");
    expect(created).toEqual(["New conversation"]);
  });

  it("stays put when the hub refuses a new conversation", async () => {
    const { wrapper, router, transport } = await mountApp();
    transport.createSession = () => Promise.reject(new Error("refused"));
    await wrapper.find(".rail-head button").trigger("click");
    await wrapper.find(".rail-new input").setValue("Plans");
    await wrapper.find(".rail-new").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(wrapper.find(".shell-error").text()).toContain("refused");
  });

  it("shows a listing failure as one strip", async () => {
    const { wrapper, transport } = await mountApp();
    transport.listSessions = () => Promise.reject(new Error("hub away"));
    await wrapper.find(".rail-follow input").setValue(true);
    await flushPromises();
    expect(wrapper.find(".shell-error").text()).toContain("hub away");
  });
});
