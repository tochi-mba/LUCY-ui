/**
 * How a conversation driven by Claude Code is told apart from one a person is typing in.
 *
 * The hub's message input has no author field, so the headed script names the conversation
 * instead: every session it starts is titled with this prefix, and the UI labels that session's
 * human side "Claude Code". scripts/lib/headed.mjs imports this file, so the two cannot drift.
 * It has no imports on purpose: Node runs it with type stripping.
 */
export const HEADED_PREFIX = "Claude Code · ";

/** The hub caps a title at 200 characters. */
const TITLE_LIMIT = 200;

export function headedTitle(topic: string): string {
  const named = topic.trim() || "conversation";
  return (HEADED_PREFIX + named).slice(0, TITLE_LIMIT);
}

export function isHeaded(title: string | null | undefined): boolean {
  return typeof title === "string" && title.startsWith(HEADED_PREFIX);
}

/** Who spoke the human side of a conversation, for the label on its messages. */
export function speakerFor(title: string | null | undefined): string {
  return isHeaded(title) ? "Claude Code" : "You";
}
