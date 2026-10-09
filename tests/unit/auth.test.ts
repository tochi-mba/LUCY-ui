import { describe, expect, it } from "vitest";
import { createAuth, SLOW_DOWN_MS, WARN_BEFORE_MS } from "../../src/auth/auth";
import type { TokenStore } from "../../src/auth/tokenStore";
import type { DevicePoll } from "../../src/transport/types";

function token(expSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url");
  return `h.${body}.s`;
}

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  return {
    value: initial,
    read() {
      return this.value;
    },
    write(next) {
      this.value = next;
    },
  };
}

interface Options {
  polls?: (DevicePoll | Error)[];
  me?: () => Promise<{ account_id: string; audience: string }>;
  store?: TokenStore;
  startFails?: boolean;
  now?: () => number;
}

function build(options: Options = {}) {
  const sleeps: number[] = [];
  const polls = [...(options.polls ?? [])];
  const auth = createAuth({
    transport: {
      startDevice: () =>
        options.startFails
          ? Promise.reject(new Error("down"))
          : Promise.resolve({
              device_code: "dev",
              user_code: "ABCD-EFGH",
              verification_uri: "u",
              verification_uri_complete: "u?c",
              expires_in: 600,
              interval: 5,
            }),
      pollDevice: () => {
        const next = polls.shift() ?? new Error("poll exhausted");
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
      me: options.me ?? (() => Promise.resolve({ account_id: "acct_1", audience: "lucy-api" })),
    },
    store: options.store ?? memoryStore(),
    now: options.now ?? (() => 1_000_000),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { auth, sleeps };
}

const fresh = token(10_000); // epoch 10_000s = 10_000_000ms, after now()

describe("restoring a saved sign-in", () => {
  it("adopts a saved, unexpired token and asks who it is for", async () => {
    const { auth } = build({ store: memoryStore(fresh) });
    auth.restore();
    expect(auth.state.phase).toBe("signed_in");
    await Promise.resolve();
    await Promise.resolve();
    expect(auth.state.account).toBe("acct_1");
    expect(auth.state.dialogOpen).toBe(false);
  });

  it("discards an expired token and opens the dialog", () => {
    const store = memoryStore(token(1)); // long past
    const { auth } = build({ store });
    auth.restore();
    expect(auth.state.phase).toBe("signed_out");
    expect(store.value).toBeNull();
    expect(auth.state.dialogOpen).toBe(true);
  });

  it("shrugs off a failed identity lookup", async () => {
    const { auth } = build({ store: memoryStore(fresh), me: () => Promise.reject(new Error("down")) });
    auth.restore();
    await Promise.resolve();
    await Promise.resolve();
    expect(auth.state.phase).toBe("signed_in");
    expect(auth.state.account).toBeNull();
  });
});

describe("the device flow", () => {
  it("shows the code, polls, and signs in on approval", async () => {
    const store = memoryStore();
    const { auth, sleeps } = build({ polls: [{ status: "pending" }, { status: "approved", token: fresh }], store });
    const running = auth.startDevice();
    await Promise.resolve();
    expect(auth.state.phase).toBe("code");
    expect(auth.state.code?.user_code).toBe("ABCD-EFGH");
    await running;
    expect(auth.state.phase).toBe("signed_in");
    expect(store.value).toBe(fresh);
    expect(auth.state.dialogOpen).toBe(false);
    expect(sleeps[0]).toBe(5000);
  });

  it("slows down when told to", async () => {
    const { auth, sleeps } = build({ polls: [{ status: "slow_down" }, { status: "approved", token: fresh }] });
    await auth.startDevice();
    expect(sleeps).toEqual([5000, 5000 + SLOW_DOWN_MS]);
    expect(auth.state.phase).toBe("signed_in");
  });

  it("reports a denial and an expired code as their own sentences", async () => {
    const denied = build({ polls: [{ status: "denied" }] });
    await denied.auth.startDevice();
    expect(denied.auth.state.error).toMatch(/refused/);

    const expired = build({ polls: [{ status: "expired" }] });
    await expired.auth.startDevice();
    expect(expired.auth.state.error).toMatch(/expired/);
  });

  it("gives up when the code outlives its clock", async () => {
    let at = 1_000_000;
    const { auth } = build({ polls: [{ status: "pending" }], now: () => at });
    const running = auth.startDevice();
    await Promise.resolve();
    at += 601_000;
    await running;
    expect(auth.state.error).toMatch(/expired/);
  });

  it("reports a hub that cannot start the flow, and a poll that breaks", async () => {
    const broken = build({ startFails: true });
    await broken.auth.startDevice();
    expect(broken.auth.state.phase).toBe("signed_out");
    expect(broken.auth.state.error).toBeTruthy();

    const flaky = build({ polls: [new Error("cut")] });
    await flaky.auth.startDevice();
    expect(flaky.auth.state.error).toBeTruthy();
  });

  it("refuses a token that arrives already expired", async () => {
    const { auth } = build({ polls: [{ status: "approved", token: token(1) }] });
    await auth.startDevice();
    expect(auth.state.phase).toBe("signed_out");
    expect(auth.state.error).toMatch(/expired/);
  });

  it("abandons a cancelled flow quietly, at every later step", async () => {
    const { auth } = build({ polls: [{ status: "approved", token: fresh }] });
    const running = auth.startDevice();
    auth.cancel();
    await running;
    expect(auth.state.phase).toBe("signed_out");
    expect(auth.state.error).toBeNull();
  });
});

describe("a pasted token", () => {
  it("adopts a token the hub recognises", async () => {
    const store = memoryStore();
    const { auth } = build({ store });
    await auth.usePasted(`  ${fresh}  `);
    expect(auth.state.phase).toBe("signed_in");
    expect(store.value).toBe(fresh);
  });

  it("ignores an empty paste, refuses an expired one, and restores on a refused one", async () => {
    const { auth } = build({ me: () => Promise.reject(new Error("401")) });
    await auth.usePasted("   ");
    expect(auth.state.phase).toBe("signed_out");
    await auth.usePasted(token(1));
    expect(auth.state.error).toMatch(/expired/);
    await auth.usePasted(fresh);
    expect(auth.state.phase).toBe("signed_out");
    expect(auth.state.error).toMatch(/refused/);
    expect(auth.state.token).toBeNull();
  });
});

describe("the sign-in's life", () => {
  it("signs out completely and asks again", () => {
    const store = memoryStore(fresh);
    const { auth } = build({ store });
    auth.restore();
    auth.signOut();
    expect(auth.state).toMatchObject({ phase: "signed_out", token: null, account: null, dialogOpen: true });
    expect(store.value).toBeNull();
  });

  it("knows how long is left and when that is worth a warning", () => {
    const { auth } = build({ store: memoryStore(fresh) });
    auth.restore();
    expect(auth.remaining(9_999_000)).toBe(1_000);
    expect(auth.remaining(11_000_000)).toBe(0);
    expect(auth.expiring(10_000_000 - WARN_BEFORE_MS - 1)).toBe(false);
    expect(auth.expiring(10_000_000 - 1000)).toBe(true);
  });

  it("has no expiry to count for a token that does not say", async () => {
    const opaque = "not-a-jwt";
    const { auth } = build({ store: memoryStore(opaque) });
    auth.restore();
    expect(auth.state.phase).toBe("signed_in");
    expect(auth.remaining(0)).toBeNull();
    expect(auth.expiring(0)).toBe(false);
  });

  it("reopens the dialog on demand and closes it only while signed in", () => {
    const { auth } = build({ store: memoryStore(fresh) });
    auth.restore();
    auth.requireSignIn();
    expect(auth.state.dialogOpen).toBe(true);
    auth.closeDialog();
    expect(auth.state.dialogOpen).toBe(false);
    auth.signOut();
    auth.closeDialog();
    expect(auth.state.dialogOpen).toBe(true);
  });
});
