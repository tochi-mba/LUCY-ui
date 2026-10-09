/** Conversations and turns, as the hub's wire models describe them (`api/schemas/sessions.py`). */

export interface Session {
  id: string;
  profile: string;
  title: string;
  status: string;
  model: string;
  permission_mode: string;
  input_policy: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
}

export interface Turn {
  id: string;
  session_id: string;
  status: string;
}

export interface Page<T> {
  data: T[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
}

/** What a new conversation may say about itself. The hub fills in everything left out. */
export interface CreateSession {
  title?: string;
  profile?: string;
  model?: string;
  permission_mode?: "ask" | "accept_edits" | "plan" | "auto";
}

export interface UpdateSession {
  title?: string;
  archived?: boolean;
}

/** The cursor every collection takes. Never a page number: the log grows while it is read. */
export interface PageQuery {
  limit?: number;
  order?: "asc" | "desc";
  after?: string;
  before?: string;
}

/** A session is live while a turn is queued, running, or parked on the person. */
export const LIVE_STATUSES: ReadonlySet<string> = new Set(["queued", "running", "input_required", "auth_required"]);

export function isLive(session: Pick<Session, "status">): boolean {
  return LIVE_STATUSES.has(session.status);
}

/** Newest activity first. The hub lists by creation time; a person reads by what moved last. */
export function byActivity(sessions: readonly Session[]): Session[] {
  return [...sessions].sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));
}

/** The conversation Follow should be showing: the live one that moved most recently. */
export function liveSession(sessions: readonly Session[]): Session | null {
  return byActivity(sessions.filter((session) => isLive(session) && session.archived_at === null))[0] ?? null;
}
