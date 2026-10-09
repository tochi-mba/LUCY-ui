/**
 * The person's conversations, kept fresh.
 *
 * The hub has no stream for the list itself, so it is polled: every few seconds while Follow is on
 * or something is live, and slowly otherwise. Listing is also when the hub archives idle
 * conversations, which is one more reason not to do it in a tight loop.
 */
import { onScopeDispose, type Ref, reactive, watch } from "vue";
import { byActivity, type CreateSession, isLive, type Session } from "../protocol/sessions";
import { describe } from "../transport/errors";
import type { LucyTransport } from "../transport/types";

export const FAST_MS = 3000;
export const SLOW_MS = 15000;

export interface SessionsState {
  sessions: Session[];
  loaded: boolean;
  error: string | null;
  showArchived: boolean;
}

export function useSessions(
  transport: Pick<LucyTransport, "listSessions" | "createSession" | "updateSession">,
  options: { enabled: Ref<boolean>; follow: Ref<boolean> },
) {
  const state = reactive<SessionsState>({ sessions: [], loaded: false, error: null, showArchived: false });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function refresh(): Promise<void> {
    try {
      const page = await transport.listSessions({ order: "desc", limit: 100 });
      state.sessions = byActivity(page.data);
      state.error = null;
    } catch (error) {
      state.error = describe(error);
    }
    state.loaded = true;
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (stopped || !options.enabled.value) return;
    const fast = options.follow.value || state.sessions.some(isLive);
    timer = setTimeout(
      async () => {
        timer = null;
        await refresh();
        schedule();
      },
      fast ? FAST_MS : SLOW_MS,
    );
  }

  async function create(body: CreateSession): Promise<Session | null> {
    try {
      const session = await transport.createSession(body);
      state.sessions = byActivity([session, ...state.sessions.filter((existing) => existing.id !== session.id)]);
      state.error = null;
      schedule();
      return session;
    } catch (error) {
      state.error = describe(error);
      return null;
    }
  }

  async function archive(id: string): Promise<void> {
    try {
      const session = await transport.updateSession(id, { archived: true });
      state.sessions = state.sessions.map((existing) => (existing.id === id ? session : existing));
    } catch (error) {
      state.error = describe(error);
    }
  }

  function visible(): Session[] {
    return state.sessions.filter((session) => state.showArchived || session.archived_at === null);
  }

  watch(
    [options.enabled, options.follow],
    async ([enabled]) => {
      if (enabled) await refresh();
      schedule();
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  });

  return { state, refresh, create, archive, visible };
}
