import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import type { Page, Session } from "../../src/protocol/sessions";
import { FAST_MS, SLOW_MS, useSessions } from "../../src/stores/useSessions";

function session(id: string, status = "idle", updatedAt = 1, archived = false): Session {
  return {
    id,
    profile: "personal",
    title: id,
    status,
    model: "m",
    permission_mode: "ask",
    input_policy: "enqueue",
    created_at: 0,
    updated_at: updatedAt,
    archived_at: archived ? 1 : null,
    input_tokens: 0,
    output_tokens: 0,
    cost_micros: 0,
  };
}

const page = (rows: Session[]): Page<Session> => ({ data: rows, has_more: false, first_id: null, last_id: null });

function build(rows: Session[] = []) {
  const calls = { list: 0, create: 0, update: 0 };
  let listAnswer: Page<Session> | Error = page(rows);
  let createAnswer: Session | Error = session("new", "idle", 9);
  const enabled = ref(true);
  const follow = ref(false);
  const scope = effectScope();
  const sessions = scope.run(() =>
    useSessions(
      {
        listSessions: () => {
          calls.list += 1;
          return listAnswer instanceof Error ? Promise.reject(listAnswer) : Promise.resolve(listAnswer);
        },
        createSession: () => {
          calls.create += 1;
          return createAnswer instanceof Error ? Promise.reject(createAnswer) : Promise.resolve(createAnswer);
        },
        updateSession: (id) => {
          calls.update += 1;
          return Promise.resolve(session(id, "idle", 2, true));
        },
      },
      { enabled, follow },
    ),
  )!;
  return {
    sessions,
    calls,
    enabled,
    follow,
    scope,
    setList: (next: Page<Session> | Error) => {
      listAnswer = next;
    },
    setCreate: (next: Session | Error) => {
      createAnswer = next;
    },
  };
}

const settle = async () => {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the session list", () => {
  it("loads at once, ordered by activity", async () => {
    const built = build([session("a", "idle", 1), session("b", "idle", 5)]);
    await settle();
    expect(built.sessions.state.loaded).toBe(true);
    expect(built.sessions.state.sessions.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("polls slowly when idle and fast while something is live or Follow is on", async () => {
    const built = build([session("a", "idle", 1)]);
    await settle();
    expect(built.calls.list).toBe(1);
    await vi.advanceTimersByTimeAsync(SLOW_MS - 1);
    expect(built.calls.list).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(built.calls.list).toBe(2);

    built.setList(page([session("a", "running", 2)]));
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    await settle();
    const after = built.calls.list;
    await vi.advanceTimersByTimeAsync(FAST_MS);
    await settle();
    expect(built.calls.list).toBe(after + 1);
    built.scope.stop();
  });

  it("does nothing while signed out, and starts when the sign-in lands", async () => {
    const built = build();
    built.enabled.value = false;
    await settle();
    const before = built.calls.list;
    await vi.advanceTimersByTimeAsync(SLOW_MS * 3);
    expect(built.calls.list).toBe(before);
    built.enabled.value = true;
    await settle();
    expect(built.calls.list).toBe(before + 1);
    built.scope.stop();
  });

  it("keeps a listing failure as a sentence and keeps going", async () => {
    const built = build();
    built.setList(new Error("down"));
    await built.sessions.refresh();
    expect(built.sessions.state.error).toBe("down");
    built.setList(page([]));
    await built.sessions.refresh();
    expect(built.sessions.state.error).toBeNull();
  });

  it("stops polling when the scope dies", async () => {
    const built = build();
    await settle();
    built.scope.stop();
    const before = built.calls.list;
    await vi.advanceTimersByTimeAsync(SLOW_MS * 3);
    expect(built.calls.list).toBe(before);
  });
});

describe("creating and archiving", () => {
  it("puts a created conversation at the front", async () => {
    const built = build([session("a", "idle", 1)]);
    await settle();
    const created = await built.sessions.create({ title: "New" });
    expect(created?.id).toBe("new");
    expect(built.sessions.state.sessions[0]!.id).toBe("new");
    built.scope.stop();
  });

  it("reports a creation the hub refused", async () => {
    const built = build();
    built.setCreate(new Error("refused"));
    expect(await built.sessions.create({})).toBeNull();
    expect(built.sessions.state.error).toBe("refused");
    built.scope.stop();
  });

  it("archives in place, and hides archived rows unless asked", async () => {
    const built = build([session("a", "idle", 1), session("b", "idle", 2, true)]);
    await settle();
    expect(built.sessions.visible().map((row) => row.id)).toEqual(["a"]);
    built.sessions.state.showArchived = true;
    expect(built.sessions.visible()).toHaveLength(2);
    await built.sessions.archive("a");
    expect(built.sessions.state.sessions.find((row) => row.id === "a")?.archived_at).not.toBeNull();
    built.scope.stop();
  });

  it("reports an archive the hub refused", async () => {
    const built = build([session("a")]);
    await settle();
    const failing = effectScope();
    const sessions = failing.run(() =>
      useSessions(
        {
          listSessions: () => Promise.resolve(page([])),
          createSession: () => Promise.reject(new Error("unused")),
          updateSession: () => Promise.reject(new Error("not yours")),
        },
        { enabled: ref(false), follow: ref(false) },
      ),
    )!;
    await sessions.archive("a");
    expect(sessions.state.error).toBe("not yours");
    failing.stop();
    built.scope.stop();
  });
});
