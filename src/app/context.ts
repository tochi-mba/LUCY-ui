/**
 * What every screen shares: the hub, the sign-in, the list of conversations and Follow.
 *
 * Provided once by main.ts (core) and App.vue (shell), injected where needed. Tests provide fakes
 * under the same keys, which is the whole reason these are injected rather than imported.
 */
import { type InjectionKey, inject, type Ref } from "vue";
import type { Auth } from "../auth/auth";
import type { useSessions } from "../stores/useSessions";
import type { LucyTransport } from "../transport/types";

export interface Core {
  transport: LucyTransport;
  auth: Auth;
}

export interface Shell {
  sessions: ReturnType<typeof useSessions>;
  follow: Ref<boolean>;
  /** Set while the person has a draft or an open card, so Follow does not pull the page away. */
  busy: Ref<boolean>;
}

export const CORE: InjectionKey<Core> = Symbol("lucy-ui core");
export const SHELL: InjectionKey<Shell> = Symbol("lucy-ui shell");

export function useCore(): Core {
  const core = inject(CORE);
  if (!core) throw new Error("LUCY-ui: the core context was not provided");
  return core;
}

export function useShell(): Shell {
  const shell = inject(SHELL);
  if (!shell) throw new Error("LUCY-ui: the shell context was not provided");
  return shell;
}
