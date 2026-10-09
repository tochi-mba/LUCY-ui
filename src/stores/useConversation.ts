/**
 * One open conversation: follow its stream, load its history, send to it.
 *
 * Opening a conversation follows its event stream first. The stream's first frame is a snapshot,
 * and on every snapshot (the first connect and each reconnect) the newest page of history is
 * loaded. History fetched after the snapshot already includes anything said before it, and the
 * stream carries everything after it, so nothing falls in the gap; overlap is harmless because
 * items are keyed by id.
 *
 * Sending uses the one write path with a fresh idempotency key per message. A network failure is
 * retried with the same key, so the hub sees one message however many times it was posted.
 */
import { onScopeDispose, reactive, type Ref, watch } from "vue";
import { answerFor, type Choice } from "../protocol/approvals";
import { EVENT } from "../protocol/events";
import { describe, Unreachable } from "../transport/errors";
import { newKey } from "../transport/http";
import type { InputEvent, LucyTransport } from "../transport/types";
import { type ConversationState, createConversation, reduce, upsertItems } from "./conversation";

export const PAGE_SIZE = 100;
export const SEND_ATTEMPTS = 3;

export interface ConversationDeps {
  now?: () => number;
  key?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export function useConversation(transport: LucyTransport, sessionId: Ref<string | null>, deps: ConversationDeps = {}) {
  const now = deps.now ?? Date.now;
  const key = deps.key ?? newKey;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const state = reactive(createConversation()) as ConversationState;
  let controller: AbortController | null = null;

  function close(): void {
    controller?.abort();
    controller = null;
  }

  function open(id: string | null): void {
    close();
    Object.assign(state, createConversation(id));
    if (id === null) return;
    const current = new AbortController();
    controller = current;
    void transport.follow(
      id,
      {
        onEvent(event) {
          if (current.signal.aborted) return;
          reduce(state, event, now());
          if (event.type === EVENT.snapshot) void loadLatest(id, current.signal);
        },
        onState(stream) {
          if (!current.signal.aborted) state.stream = stream;
        },
      },
      current.signal,
    );
  }

  async function loadLatest(id: string, signal: AbortSignal): Promise<void> {
    try {
      const page = await transport.listItems(id, { order: "desc", limit: PAGE_SIZE });
      if (signal.aborted) return;
      upsertItems(state, page.data);
      if (!state.loaded) state.hasEarlier = page.has_more;
      state.loaded = true;
    } catch (error) {
      if (!signal.aborted) state.error = describe(error);
    }
  }

  /** The page of history before the oldest item on screen. */
  async function loadEarlier(): Promise<void> {
    const id = state.sessionId;
    const oldest = state.items[0];
    if (id === null || oldest === undefined) return;
    try {
      const page = await transport.listItems(id, { order: "desc", limit: PAGE_SIZE, after: oldest.id });
      upsertItems(state, page.data);
      state.hasEarlier = page.has_more;
    } catch (error) {
      state.error = describe(error);
    }
  }

  async function post(events: InputEvent[]): Promise<boolean> {
    const id = state.sessionId;
    if (id === null) return false;
    const idempotencyKey = key();
    for (let attempt = 1; ; attempt += 1) {
      try {
        await transport.send(id, events, idempotencyKey);
        state.error = null;
        return true;
      } catch (error) {
        if (error instanceof Unreachable && attempt < SEND_ATTEMPTS) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        state.error = describe(error);
        return false;
      }
    }
  }

  function send(text: string): Promise<boolean> {
    const content = text.trim();
    if (!content) return Promise.resolve(false);
    return post([{ type: "input.message", content }]);
  }

  async function answer(approvalId: string, choice: Choice): Promise<boolean> {
    const previous = state.cards[approvalId];
    state.cards[approvalId] = { status: "answering", lifetime: choice.lifetime ?? "once", instruction: "" };
    const sent = await post([answerFor(approvalId, choice)]);
    if (!sent) {
      if (previous === undefined) delete state.cards[approvalId];
      else state.cards[approvalId] = previous;
    }
    return sent;
  }

  async function cancel(): Promise<void> {
    const turn = state.turn.id;
    if (turn === null) return;
    try {
      await transport.cancelTurn(turn);
    } catch (error) {
      state.error = describe(error);
    }
  }

  function dismissError(): void {
    state.error = null;
  }

  watch(sessionId, open, { immediate: true });
  onScopeDispose(close);

  return { state, send, answer, cancel, loadEarlier, dismissError };
}
