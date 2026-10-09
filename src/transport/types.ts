/** Everything the UI asks of a hub. One implementation talks HTTP; tests stub this interface. */
import type { ApprovalInput } from "../protocol/approvals";
import type { LucyEvent } from "../protocol/events";
import type { Item } from "../protocol/items";
import type { CreateSession, Page, PageQuery, Session, Turn, UpdateSession } from "../protocol/sessions";

export interface Me {
  account_id: string;
  audience: string;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/** One poll of a device code, in RFC 8628's words. */
export type DevicePoll =
  | { status: "approved"; token: string }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" };

export interface MessageInput {
  type: "input.message";
  content: string;
}

export type InputEvent = MessageInput | ApprovalInput;

/** Where a followed stream is. The face and the status line both read this. */
export type StreamState = "idle" | "connecting" | "open" | "reconnecting" | "unauthorized" | "closed";

export interface FollowHandlers {
  onEvent(event: LucyEvent): void;
  onState?(state: StreamState): void;
}

export interface LucyTransport {
  me(): Promise<Me>;
  listSessions(query?: PageQuery): Promise<Page<Session>>;
  createSession(body: CreateSession): Promise<Session>;
  updateSession(sessionId: string, body: UpdateSession): Promise<Session>;
  listItems(sessionId: string, query?: PageQuery): Promise<Page<Item>>;
  /** The one write path. A retry with the same key is the same turn, never a second one. */
  send(sessionId: string, events: InputEvent[], idempotencyKey: string): Promise<Turn>;
  cancelTurn(turnId: string): Promise<Turn>;
  startDevice(): Promise<DeviceCode>;
  pollDevice(deviceCode: string): Promise<DevicePoll>;
  /** Follow a conversation until the signal aborts, reconnecting from the last event handled. */
  follow(sessionId: string, handlers: FollowHandlers, signal: AbortSignal): Promise<void>;
}
