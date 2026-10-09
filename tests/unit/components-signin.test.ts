// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../src/auth/auth";
import type { TokenStore } from "../../src/auth/tokenStore";
import SignInChip from "../../src/components/SignInChip.vue";
import SignInDialog from "../../src/components/SignInDialog.vue";
import type { DevicePoll } from "../../src/transport/types";

function token(expSeconds: number): string {
  return `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.s`;
}

const store = (): TokenStore => {
  let value: string | null = null;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
};

function authWith(
  polls: DevicePoll[] = [],
  me = () => Promise.resolve({ account_id: "acct_1", audience: "lucy-api" }),
) {
  const queue = [...polls];
  return createAuth({
    transport: {
      startDevice: () =>
        Promise.resolve({
          device_code: "dev",
          user_code: "ABCD-EFGH",
          verification_uri: "u",
          verification_uri_complete: "u?c",
          expires_in: 600,
          interval: 1,
        }),
      pollDevice: () => Promise.resolve(queue.shift() ?? { status: "pending" }),
      me,
    },
    store: store(),
    now: () => 1_000_000,
    // Rides the suite's fake timers, so a test can hold the flow at the code and release it.
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SignInDialog", () => {
  it("is absent until asked for, then walks the device flow to the approve command", async () => {
    const auth = authWith([{ status: "approved", token: token(10_000) }]);
    const wrapper = mount(SignInDialog, { props: { auth } });
    expect(wrapper.find(".dialog").exists()).toBe(false);
    auth.requireSignIn();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Wake Lucy up");
    await wrapper.find("button.primary").trigger("click");
    await flushPromises();
    expect(wrapper.find(".user-code").text()).toBe("lucy approve ABCD-EFGH");
    await vi.runAllTimersAsync();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".dialog").exists()).toBe(false);
  });

  it("copies the command, falling back quietly when the clipboard refuses", async () => {
    const auth = authWith();
    auth.state.dialogOpen = true;
    auth.state.phase = "code";
    auth.state.code = {
      device_code: "d",
      user_code: "ABCD-EFGH",
      verification_uri: "u",
      verification_uri_complete: "u?c",
      expires_in: 600,
      interval: 5,
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const wrapper = mount(SignInDialog, { props: { auth } });
    await wrapper.find(".code-row button").trigger("click");
    await wrapper.vm.$nextTick();
    expect(writeText).toHaveBeenCalledWith("lucy approve ABCD-EFGH");
    expect(wrapper.find(".code-row button").text()).toBe("Copied");
    await vi.advanceTimersByTimeAsync(1500);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".code-row button").text()).toBe("Copy");
    writeText.mockRejectedValue(new Error("blocked"));
    await wrapper.find(".code-row button").trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".code-row button").text()).toBe("Copy");
    await wrapper.find("button.ghost").trigger("click");
    expect(auth.state.code).toBeNull();
  });

  it("takes a pasted token and clears the field", async () => {
    const auth = authWith();
    auth.state.dialogOpen = true;
    const wrapper = mount(SignInDialog, { props: { auth } });
    const input = wrapper.find(".dialog-paste input");
    await input.setValue(token(10_000));
    await wrapper.find(".dialog-paste form").trigger("submit");
    await vi.runAllTimersAsync();
    await wrapper.vm.$nextTick();
    expect(auth.state.phase).toBe("signed_in");
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("explains a re-sign-in without losing the page, closable with Not now", async () => {
    const auth = authWith();
    auth.state.phase = "signed_in";
    auth.state.dialogOpen = true;
    auth.state.error = "That sign-in was refused.";
    const wrapper = mount(SignInDialog, { props: { auth } });
    expect(wrapper.text()).toContain("carries on exactly where you are");
    expect(wrapper.find(".dialog-error").text()).toContain("refused");
    await wrapper.find(".dialog-close").trigger("click");
    expect(auth.state.dialogOpen).toBe(false);
  });
});

describe("SignInChip", () => {
  it("offers sign-in when signed out and opens the dialog", async () => {
    const auth = authWith();
    const wrapper = mount(SignInChip, { props: { auth } });
    expect(wrapper.text()).toContain("Sign in");
    expect(wrapper.find(".chip").attributes("data-tone")).toBe("off");
    await wrapper.find(".chip").trigger("click");
    expect(auth.state.dialogOpen).toBe(true);
  });

  it("shows who is signed in and counts the minutes down to amber", async () => {
    vi.setSystemTime(1_000_000);
    const auth = authWith();
    await auth.usePasted(token(1300)); // 1_300_000 ms: 5 minutes left
    const wrapper = mount(SignInChip, { props: { auth } });
    await vi.advanceTimersByTimeAsync(1000);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("acct_1");
    expect(wrapper.find(".chip-clock").text()).toMatch(/^4:5\d$/);
    expect(wrapper.find(".chip").attributes("data-tone")).toBe("on");
    await vi.advanceTimersByTimeAsync(3.5 * 60 * 1000);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".chip").attributes("data-tone")).toBe("amber");
  });

  it("shows no clock for a token that does not say when it ends", async () => {
    const auth = authWith();
    await auth.usePasted("opaque-token");
    const wrapper = mount(SignInChip, { props: { auth } });
    expect(wrapper.find(".chip-clock").exists()).toBe(false);
  });
});
