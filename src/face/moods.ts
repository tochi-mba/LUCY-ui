/**
 * What Lucy's face shows, derived from the conversation and nothing else.
 *
 * `moodFor` is a pure function of state the stores already hold; no component tells the face what
 * to do (AGENTS.md, invariant 6). The order of the checks is the order of what matters most to a
 * person looking at the screen: whether anything is connected at all, whether Lucy is waiting on
 * them, whether she is talking, whether she is working, and only then how the last turn ended.
 */
import type { Outcome, TurnStatus } from "../stores/conversation";
import type { StreamState } from "../transport/types";

export type Mood =
  | "asleep"
  | "idle"
  | "attentive"
  | "sent"
  | "thinking"
  | "working"
  | "speaking"
  | "needs_you"
  | "blocked"
  | "done"
  | "failed"
  | "disconnected";

export const MOODS: readonly Mood[] = [
  "asleep",
  "idle",
  "attentive",
  "sent",
  "thinking",
  "working",
  "speaking",
  "needs_you",
  "blocked",
  "done",
  "failed",
  "disconnected",
];

/** How long the face holds a turn's ending before it settles. */
export const OUTCOME_MS = 4000;

export interface MoodInput {
  signedIn: boolean;
  hasSession: boolean;
  stream: StreamState;
  turn: TurnStatus;
  pendingCards: number;
  connectionNeeded: boolean;
  speaking: boolean;
  working: boolean;
  composing: boolean;
  outcome: Outcome | null;
  now: number;
}

const LOST: ReadonlySet<StreamState> = new Set(["reconnecting", "unauthorized", "closed"]);

export function moodFor(input: MoodInput): Mood {
  if (!input.signedIn) return "asleep";
  if (!input.hasSession) return input.composing ? "attentive" : "idle";
  if (LOST.has(input.stream)) return "disconnected";
  if (input.pendingCards > 0 || input.connectionNeeded) return "needs_you";
  if (input.turn === "input_required" || input.turn === "auth_required") return "needs_you";
  if (input.speaking) return "speaking";
  if (input.turn === "queued") return "sent";
  if (input.turn === "running") return input.working ? "working" : "thinking";
  if (input.outcome !== null && input.now - input.outcome.at < OUTCOME_MS) return input.outcome.kind;
  return input.composing ? "attentive" : "idle";
}

/** The sentence a screen reader hears when the face changes. */
export const MOOD_TEXT: Record<Mood, string> = {
  asleep: "Lucy is asleep. Sign in to wake her.",
  idle: "Lucy is listening.",
  attentive: "Lucy is watching you type.",
  sent: "Lucy has your message.",
  thinking: "Lucy is thinking.",
  working: "Lucy is working through what her steps found.",
  speaking: "Lucy is answering.",
  needs_you: "Lucy needs you to decide something.",
  blocked: "Lucy was told no and has stopped there.",
  done: "Lucy has finished.",
  failed: "Lucy could not finish that.",
  disconnected: "Lucy has lost the connection and is trying again.",
};
