/**
 * Signing in with the hub's device flow, and knowing when the sign-in runs out.
 *
 * The browser asks the hub for a code (`POST /v1/auth/device`), shows it, and polls. A terminal
 * that is already signed in approves it with `lucy approve CODE`, which hands that terminal's
 * token to this tab. No page asks for a password. A pasted token is the fallback.
 *
 * Keyring tokens live fifteen minutes. The UI cannot extend one, so it says how long is left,
 * warns in the last two minutes, and on the first refusal reopens the dialog without touching
 * the conversation on screen.
 */
import { reactive } from "vue";
import { expiryOf } from "../protocol/jwt";
import { describe } from "../transport/errors";
import type { DeviceCode, LucyTransport } from "../transport/types";
import type { TokenStore } from "./tokenStore";

export const WARN_BEFORE_MS = 2 * 60 * 1000;
export const SLOW_DOWN_MS = 5000;

export type AuthPhase = "signed_out" | "starting" | "code" | "signed_in";

export interface AuthState {
  phase: AuthPhase;
  token: string | null;
  /** When the token stops working, in epoch milliseconds, if it says. */
  expiresAt: number | null;
  account: string | null;
  code: DeviceCode | null;
  codeExpiresAt: number | null;
  error: string | null;
  dialogOpen: boolean;
}

export interface AuthDeps {
  transport: Pick<LucyTransport, "startDevice" | "pollDevice" | "me">;
  store: TokenStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(deps: AuthDeps) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const state = reactive<AuthState>({
    phase: "signed_out",
    token: null,
    expiresAt: null,
    account: null,
    code: null,
    codeExpiresAt: null,
    error: null,
    dialogOpen: false,
  });
  // Each start of the flow gets a number; a poll that finds a newer number has been abandoned.
  let generation = 0;

  function adopt(token: string): boolean {
    const expiresAt = expiryOf(token);
    if (expiresAt !== null && expiresAt <= now()) return false;
    state.token = token;
    state.expiresAt = expiresAt;
    state.phase = "signed_in";
    return true;
  }

  async function identify(): Promise<void> {
    try {
      state.account = (await deps.transport.me()).account_id;
    } catch {
      // Who the token is for is a label on the chip; a failure here is reported by the next
      // request that actually needs the token.
    }
  }

  function restore(): void {
    const saved = deps.store.read();
    if (saved !== null && adopt(saved)) {
      void identify();
      return;
    }
    deps.store.write(null);
    state.dialogOpen = true;
  }

  async function accept(token: string): Promise<void> {
    if (!adopt(token)) {
      fail("That sign-in has already expired. Start again.");
      return;
    }
    deps.store.write(token);
    state.code = null;
    state.codeExpiresAt = null;
    state.error = null;
    state.dialogOpen = false;
    await identify();
  }

  function fail(message: string): void {
    state.phase = state.token === null ? "signed_out" : "signed_in";
    state.code = null;
    state.codeExpiresAt = null;
    state.error = message;
  }

  async function startDevice(): Promise<void> {
    const run = ++generation;
    state.phase = "starting";
    state.error = null;
    let code: DeviceCode;
    try {
      code = await deps.transport.startDevice();
    } catch (error) {
      if (run === generation) fail(describe(error));
      return;
    }
    if (run !== generation) return;
    state.code = code;
    state.codeExpiresAt = now() + code.expires_in * 1000;
    state.phase = "code";
    let interval = code.interval * 1000;
    for (;;) {
      await sleep(interval);
      if (run !== generation) return;
      if (now() >= state.codeExpiresAt) {
        fail("The code expired before it was approved. Start again.");
        return;
      }
      let result: Awaited<ReturnType<LucyTransport["pollDevice"]>>;
      try {
        result = await deps.transport.pollDevice(code.device_code);
      } catch (error) {
        if (run === generation) fail(describe(error));
        return;
      }
      if (run !== generation) return;
      if (result.status === "approved") {
        await accept(result.token);
        return;
      }
      if (result.status === "slow_down") interval += SLOW_DOWN_MS;
      else if (result.status === "denied") {
        fail("That sign-in was refused.");
        return;
      } else if (result.status === "expired") {
        fail("The code expired before it was approved. Start again.");
        return;
      }
    }
  }

  /** Stop waiting on a code. The poll that is in flight finds out at its next step. */
  function cancel(): void {
    generation += 1;
    fail("");
    state.error = null;
  }

  async function usePasted(raw: string): Promise<void> {
    const token = raw.trim();
    if (!token) return;
    generation += 1;
    const previous = { token: state.token, expiresAt: state.expiresAt, phase: state.phase };
    if (!adopt(token)) {
      fail("That token has already expired.");
      return;
    }
    try {
      state.account = (await deps.transport.me()).account_id;
    } catch (error) {
      Object.assign(state, previous);
      fail(`That token was refused: ${describe(error)}`);
      return;
    }
    deps.store.write(token);
    state.code = null;
    state.error = null;
    state.dialogOpen = false;
  }

  function signOut(): void {
    generation += 1;
    deps.store.write(null);
    Object.assign(state, {
      phase: "signed_out",
      token: null,
      expiresAt: null,
      account: null,
      code: null,
      codeExpiresAt: null,
      error: null,
      dialogOpen: true,
    } satisfies AuthState);
  }

  /** The hub refused the token: ask again, keeping everything on screen as it is. */
  function requireSignIn(): void {
    state.dialogOpen = true;
  }

  function openDialog(): void {
    state.dialogOpen = true;
  }

  function closeDialog(): void {
    if (state.phase === "signed_in") state.dialogOpen = false;
  }

  /** Milliseconds of sign-in left at `at`, or `null` when the token does not say. */
  function remaining(at: number): number | null {
    return state.expiresAt === null ? null : Math.max(0, state.expiresAt - at);
  }

  function expiring(at: number): boolean {
    const left = remaining(at);
    return left !== null && left <= WARN_BEFORE_MS;
  }

  return {
    state,
    token: () => state.token,
    restore,
    startDevice,
    cancel,
    usePasted,
    signOut,
    requireSignIn,
    openDialog,
    closeDialog,
    remaining,
    expiring,
  };
}
