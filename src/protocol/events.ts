/**
 * The hub's native event stream, as far as this UI reads it.
 *
 * Names are copied from `src/lucy_api/stream/events.py` and the places that emit them; docs/
 * protocol.md lists each with the hub file it comes from. The UI reads the native stream rather
 * than the negotiated AI SDK projection because the projection drops the approval card's body,
 * the items as they land and the context meter (ADR-0002).
 */
import { isRecord, type JsonRecord, number, optionalText } from "./guards";
import type { SseFrame } from "./sse";

export const EVENT = {
  // Frames the connection invents for itself; never in the session's log.
  snapshot: "lucy.stream.snapshot",
  resumed: "lucy.stream.resumed",
  heartbeat: "lucy.stream.heartbeat",
  streamError: "lucy.stream.error",
  streamDone: "lucy.stream.done",
  // What was said and written.
  itemAdded: "lucy.content.item.added",
  textStart: "lucy.content.text.start",
  textDelta: "lucy.content.text.delta",
  textEnd: "lucy.content.text.end",
  reasoningStart: "lucy.content.reasoning.start",
  reasoningDelta: "lucy.content.reasoning.delta",
  reasoningEnd: "lucy.content.reasoning.end",
  // A turn's life.
  turnCreated: "lucy.turn.created",
  turnStarted: "lucy.turn.started",
  turnInputRequired: "lucy.turn.input_required",
  turnAuthRequired: "lucy.turn.auth_required",
  turnCompleted: "lucy.turn.completed",
  turnFailed: "lucy.turn.failed",
  turnCancelled: "lucy.turn.cancelled",
  turnSuperseded: "lucy.turn.superseded",
  turnCancelRequested: "lucy.turn.cancel_requested",
  turnSlow: "lucy.turn.slow",
  // Approval cards.
  approvalRequested: "lucy.approval.requested",
  approvalGranted: "lucy.approval.granted",
  approvalDenied: "lucy.approval.denied",
  approvalExpired: "lucy.approval.expired",
  // The window, and connections a capability needs.
  contextStatus: "lucy.context.status",
  compactionApplied: "lucy.compaction.applied",
  connectionRequired: "lucy.connection.required",
  // Work that outlives a step.
  workFinished: "lucy.work.finished",
  workWoke: "lucy.work.woke",
  workGroupFinished: "lucy.work.group.finished",
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];

const KNOWN: ReadonlySet<string> = new Set(Object.values(EVENT));

/** Whether this UI has a reading for an event type. Anything else is counted, not dropped. */
export function isKnownEvent(type: string): type is EventName {
  return KNOWN.has(type);
}

/** One event, as the hub's `Event.envelope()` writes it. */
export interface LucyEvent {
  type: string;
  /** Absent on a heartbeat, which is not in the log. */
  sequence_number?: number;
  session_id: string;
  created_at: number;
  data: JsonRecord;
  turn_id?: string;
  agent_id?: string;
}

/** Read one SSE frame's body. A body that is not an event is `null`, never an exception. */
export function parseEvent(frame: SseFrame): LucyEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (!isRecord(body) || typeof body.type !== "string") return null;
  const event: LucyEvent = {
    type: body.type,
    session_id: optionalText(body.session_id) ?? "",
    created_at: number(body.created_at) ?? 0,
    data: isRecord(body.data) ? body.data : {},
  };
  const sequence = number(body.sequence_number);
  if (sequence !== null) event.sequence_number = sequence;
  const turn = optionalText(body.turn_id);
  if (turn !== null) event.turn_id = turn;
  const agent = optionalText(body.agent_id);
  if (agent !== null) event.agent_id = agent;
  return event;
}

/**
 * Which text or reasoning block a delta belongs to. The hub's own AI SDK projection uses the same
 * fallbacks (`stream/ai_sdk.py` `_block_id`): the block's id, else its turn, else the session.
 */
export function blockIdOf(event: LucyEvent): string {
  return optionalText(event.data.id) ?? event.turn_id ?? event.session_id;
}
