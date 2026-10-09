/**
 * One conversation's state, and the reducer that keeps it.
 *
 * Two sources feed it. Items are the history (`GET /items`, and `lucy.content.item.added` as each
 * one lands); events are everything in between (text arriving, a turn's life, cards, the window).
 * Three rules hold:
 *
 * - **Items are keyed by id.** History and stream overlap after every (re)connect; an item that
 *   arrives twice is one row.
 * - **Nothing is said twice.** A streamed text block is retired the moment the assistant message
 *   item for its turn arrives, so the words are on screen once, as the durable item.
 * - **Nothing is invented and nothing is dropped.** An event this UI has no reading for is
 *   counted in `unknownEvents`, shown in the side panel, and otherwise left alone.
 *
 * Everything here is plain functions over a plain object, so the composable can make it reactive
 * and the tests can run it without Vue.
 */
import { blockIdOf, EVENT, isKnownEvent, type LucyEvent } from "../protocol/events";
import { isRecord, type JsonRecord, number, optionalText, text, texts } from "../protocol/guards";
import { type ApprovalRequest, approvalRequestOf, approvalResponseOf, type Item, asItem } from "../protocol/items";
import type { StreamState } from "../transport/types";

export type TurnStatus =
  | "idle"
  | "queued"
  | "running"
  | "input_required"
  | "auth_required"
  | "completed"
  | "failed"
  | "cancelled";

const TURN_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "queued",
  "running",
  "input_required",
  "auth_required",
  "completed",
  "failed",
  "cancelled",
]);

export function turnStatusOf(value: unknown): TurnStatus {
  return typeof value === "string" && TURN_STATUSES.has(value) ? (value as TurnStatus) : "idle";
}

/** A turn is live while it can still change what is on screen. */
export function isLiveTurn(status: TurnStatus): boolean {
  return status === "queued" || status === "running" || status === "input_required" || status === "auth_required";
}

/** Text or reasoning arriving in pieces, before (or instead of) a durable item. */
export interface Block {
  key: string;
  id: string;
  kind: "text" | "reasoning";
  turnId: string | null;
  text: string;
  open: boolean;
}

export type CardStatus = "pending" | "answering" | "granted" | "denied" | "expired" | "closed";

export interface CardRecord {
  status: CardStatus;
  lifetime: string;
  instruction: string;
}

export interface WindowReport {
  usedTokens: number;
  windowTokens: number;
  percent: number;
  warnAtPercent: number;
  compactAtPercent: number;
  tokensUntilCompaction: number;
  summarisedTurns: number;
  state: string;
}

export interface WorkRow {
  id: string;
  kind: string;
  role: string;
  state: string;
  elapsedSeconds: number;
  group: string | null;
}

export interface ConnectionPrompt {
  service: string;
  scopes: string[];
  connectUrl: string;
  message: string;
}

/** How the last turn ended, and when; the face shows it for a moment. */
export interface Outcome {
  kind: "done" | "failed" | "blocked";
  at: number;
}

export interface ConversationState {
  sessionId: string | null;
  title: string;
  status: string;
  permissionMode: string;
  items: Item[];
  blocks: Block[];
  cards: Record<string, CardRecord>;
  turn: { id: string | null; status: TurnStatus; slow: boolean };
  window: WindowReport | null;
  work: WorkRow[];
  connections: ConnectionPrompt[];
  compactedAt: number | null;
  unknownEvents: number;
  stream: StreamState;
  outcome: Outcome | null;
  hasEarlier: boolean;
  loaded: boolean;
  error: string | null;
  serial: number;
}

export function createConversation(sessionId: string | null = null): ConversationState {
  return {
    sessionId,
    title: "",
    status: "idle",
    permissionMode: "ask",
    items: [],
    blocks: [],
    cards: {},
    turn: { id: null, status: "idle", slow: false },
    window: null,
    work: [],
    connections: [],
    compactedAt: null,
    unknownEvents: 0,
    stream: "idle",
    outcome: null,
    hasEarlier: false,
    loaded: false,
    error: null,
    serial: 0,
  };
}

/** Apply one event. `now` is when it was handled, for the face's moment of outcome. */
export function reduce(state: ConversationState, event: LucyEvent, now: number): void {
  switch (event.type) {
    case EVENT.snapshot:
      applySnapshot(state, event.data);
      return;
    case EVENT.itemAdded: {
      const item = asItem(event.data);
      if (item !== null) addItem(state, item, true);
      return;
    }
    case EVENT.textStart:
      openBlock(state, event, "text");
      return;
    case EVENT.reasoningStart:
      openBlock(state, event, "reasoning");
      return;
    case EVENT.textDelta:
      appendBlock(state, event, "text");
      return;
    case EVENT.reasoningDelta:
      appendBlock(state, event, "reasoning");
      return;
    case EVENT.textEnd:
      closeBlock(state, event, "text");
      return;
    case EVENT.reasoningEnd:
      closeBlock(state, event, "reasoning");
      return;
    case EVENT.turnCreated:
      turnCreated(state, event);
      return;
    case EVENT.turnStarted:
      state.turn = { id: event.turn_id ?? state.turn.id, status: "running", slow: false };
      state.outcome = null;
      return;
    case EVENT.turnInputRequired:
      parkTurn(state, event, "input_required");
      return;
    case EVENT.turnAuthRequired:
      parkTurn(state, event, "auth_required");
      return;
    case EVENT.turnCompleted:
      finishTurn(state, event, "completed", now);
      return;
    case EVENT.turnFailed:
      finishTurn(state, event, "failed", now);
      return;
    case EVENT.turnCancelled:
    case EVENT.turnSuperseded:
      finishTurn(state, event, "cancelled", now);
      return;
    case EVENT.turnSlow:
      if (isCurrent(state, event)) state.turn.slow = true;
      return;
    case EVENT.approvalRequested: {
      const id = optionalText(event.data.approval_id);
      if (id !== null) state.cards[id] = { status: "pending", lifetime: "once", instruction: "" };
      return;
    }
    case EVENT.approvalGranted:
    case EVENT.approvalDenied: {
      const response = approvalResponseOf(event.data);
      if (response === null) return;
      recordAnswer(state, response);
      if (!response.approved) state.outcome = { kind: "blocked", at: now };
      return;
    }
    case EVENT.approvalExpired: {
      const id = optionalText(event.data.approval_id);
      if (id !== null) state.cards[id] = { status: "expired", lifetime: "once", instruction: "" };
      return;
    }
    case EVENT.contextStatus:
      state.window = windowOf(event.data);
      return;
    case EVENT.compactionApplied:
      state.compactedAt = now;
      return;
    case EVENT.connectionRequired:
      addConnection(state, event.data);
      return;
    case EVENT.workFinished:
      addWork(state, event.data);
      return;
    default:
      if (!isKnownEvent(event.type)) state.unknownEvents += 1;
  }
}

/** Put a page of history in place. Items already on screen are replaced, never doubled. */
export function upsertItems(state: ConversationState, items: readonly Item[]): void {
  for (const item of items) addItem(state, item, false);
}

function applySnapshot(state: ConversationState, data: JsonRecord): void {
  const snapshot = isRecord(data.state) ? data.state : {};
  state.title = text(snapshot.title, state.title);
  state.status = text(snapshot.status, state.status);
  state.permissionMode = text(snapshot.permission_mode, state.permissionMode);
  if (isRecord(snapshot.latest_turn)) {
    state.turn = {
      id: optionalText(snapshot.latest_turn.id),
      status: turnStatusOf(snapshot.latest_turn.status),
      slow: false,
    };
  }
}

function addItem(state: ConversationState, item: Item, live: boolean): void {
  const index = state.items.findIndex((existing) => existing.id === item.id);
  if (index >= 0) {
    state.items[index] = item;
  } else {
    const at = state.items.findIndex((existing) => existing.seq > item.seq);
    if (at === -1) state.items.push(item);
    else state.items.splice(at, 0, item);
  }
  if (item.type === "message" && item.role === "assistant") retireText(state, item.turn_id);
  if (item.type === "approval_response") {
    const response = approvalResponseOf(item.content);
    if (response !== null) recordAnswer(state, response);
  }
  if (live && item.type === "approval_request") {
    const request = approvalRequestOf(item.content);
    if (request !== null && state.cards[request.approval_id] === undefined) {
      state.cards[request.approval_id] = { status: "pending", lifetime: "once", instruction: "" };
    }
  }
}

function retireText(state: ConversationState, turnId: string | null): void {
  const index = state.blocks.findIndex((block) => block.kind === "text" && !block.open && block.turnId === turnId);
  if (index >= 0) state.blocks.splice(index, 1);
}

function recordAnswer(state: ConversationState, response: { approval_id: string; approved: boolean; lifetime: string; instruction: string }): void {
  state.cards[response.approval_id] = {
    status: response.approved ? "granted" : "denied",
    lifetime: response.lifetime,
    instruction: response.instruction,
  };
}

function openBlock(state: ConversationState, event: LucyEvent, kind: Block["kind"]): Block {
  state.serial += 1;
  const block: Block = {
    key: `${kind}-${state.serial}`,
    id: blockIdOf(event),
    kind,
    turnId: event.turn_id ?? null,
    text: "",
    open: true,
  };
  state.blocks.push(block);
  return state.blocks[state.blocks.length - 1]!;
}

function openBlockFor(state: ConversationState, event: LucyEvent, kind: Block["kind"]): Block | undefined {
  const id = blockIdOf(event);
  return state.blocks.findLast((block) => block.open && block.kind === kind && block.id === id);
}

function appendBlock(state: ConversationState, event: LucyEvent, kind: Block["kind"]): void {
  // A delta whose start was missed (the stream opened mid-block) still gets a block to land in.
  const block = openBlockFor(state, event, kind) ?? openBlock(state, event, kind);
  block.text += text(event.data.delta);
}

function closeBlock(state: ConversationState, event: LucyEvent, kind: Block["kind"]): void {
  const block = openBlockFor(state, event, kind);
  if (block) block.open = false;
}

function isCurrent(state: ConversationState, event: LucyEvent): boolean {
  return event.turn_id === undefined || state.turn.id === null || event.turn_id === state.turn.id;
}

function turnCreated(state: ConversationState, event: LucyEvent): void {
  // A message sent while a turn runs waits behind it; the running turn stays the one on screen.
  const behind = optionalText(event.data.queued_behind);
  if (behind !== null && behind === state.turn.id && isLiveTurn(state.turn.status)) return;
  state.turn = { id: event.turn_id ?? null, status: "queued", slow: false };
  state.outcome = null;
  state.connections = [];
}

function parkTurn(state: ConversationState, event: LucyEvent, status: TurnStatus): void {
  if (!isCurrent(state, event)) return;
  state.turn = { id: event.turn_id ?? state.turn.id, status, slow: false };
}

function finishTurn(state: ConversationState, event: LucyEvent, status: TurnStatus, now: number): void {
  if (!isCurrent(state, event)) return;
  const turnId = event.turn_id ?? state.turn.id;
  state.turn = { id: turnId, status, slow: false };
  for (const block of state.blocks) if (block.turnId === turnId) block.open = false;
  state.blocks = state.blocks.filter((block) => !(block.kind === "reasoning" && block.turnId === turnId));
  state.outcome = status === "completed" ? { kind: "done", at: now } : status === "failed" ? { kind: "failed", at: now } : null;
}

function windowOf(data: JsonRecord): WindowReport {
  return {
    usedTokens: number(data.used_tokens) ?? 0,
    windowTokens: number(data.window_tokens) ?? 0,
    percent: number(data.percent) ?? 0,
    warnAtPercent: number(data.warn_at_percent) ?? 0,
    compactAtPercent: number(data.compact_at_percent) ?? 0,
    tokensUntilCompaction: number(data.tokens_until_compaction) ?? 0,
    summarisedTurns: number(data.summarised_turns) ?? 0,
    state: text(data.state, "ok"),
  };
}

function addConnection(state: ConversationState, data: JsonRecord): void {
  const service = optionalText(data.service);
  if (service === null) return;
  const prompt: ConnectionPrompt = {
    service,
    scopes: texts(data.scopes),
    connectUrl: text(data.connect_url),
    message: text(data.message),
  };
  state.connections = [...state.connections.filter((existing) => existing.service !== service), prompt];
}

function addWork(state: ConversationState, data: JsonRecord): void {
  const id = optionalText(data.work_id);
  if (id === null) return;
  const row: WorkRow = {
    id,
    kind: text(data.kind, "work"),
    role: text(data.role),
    state: text(data.state, "finished"),
    elapsedSeconds: number(data.elapsed_seconds) ?? 0,
    group: optionalText(data.group),
  };
  state.work = [row, ...state.work.filter((existing) => existing.id !== id)];
}

/** One approval card, as the transcript and the pinned list show it. */
export interface Card {
  item: Item;
  request: ApprovalRequest;
  status: CardStatus;
  record: CardRecord | null;
}

/**
 * Every card in the conversation. A card the stream has said nothing about (history loaded after a
 * reload) is pending only while its own turn is still parked on the person; otherwise it is closed.
 */
export function cardsOf(state: ConversationState): Card[] {
  const cards: Card[] = [];
  for (const item of state.items) {
    if (item.type !== "approval_request") continue;
    const request = approvalRequestOf(item.content);
    if (request === null) continue;
    const record = state.cards[request.approval_id] ?? null;
    const parked = state.turn.status === "input_required" && item.turn_id === state.turn.id;
    cards.push({ item, request, record, status: record?.status ?? (parked ? "pending" : "closed") });
  }
  return cards;
}

export function pendingCards(state: ConversationState): Card[] {
  return cardsOf(state).filter((card) => card.status === "pending" || card.status === "answering");
}

/** Text is arriving right now. */
export function isSpeaking(state: ConversationState): boolean {
  return state.blocks.some((block) => block.kind === "text" && block.open);
}

/** The running turn has already run steps: Lucy is working through results, not just thinking. */
export function isWorking(state: ConversationState): boolean {
  if (state.turn.status !== "running") return false;
  const last = state.items.findLast((item) => item.turn_id === state.turn.id);
  return last?.type === "tool_result";
}
