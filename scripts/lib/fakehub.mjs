/**
 * The fake hub's whole brain: sessions, items, events, the device flow, and scripted replies.
 *
 * `npm run check` and the e2e suite talk to no real hub and no model (AGENTS.md, invariant 7);
 * this is what they talk to instead. It keeps the real hub's shapes: the one write path with an
 * Idempotency-Key, items with `seq`, events with `sequence_number`, the snapshot-then-deltas
 * stream contract, and RFC 8628's words on the device routes. It is deliberately in-memory and
 * deliberately small; anything it cannot answer is a plain 404.
 *
 * The HTTP wrapper lives in scripts/fake-hub.mjs; everything here is callable directly, which is
 * how the tests hold it to the same bar as the app.
 */

/** Which scripted reply a turn gets, by words in the message and the conversation's title. */
export function fixtureFor(title, fixtures) {
  const lowered = (title ?? "").toLowerCase();
  if (lowered.includes("music") || lowered.includes("play")) return fixtures["music-approval"];
  if (lowered.includes("fail")) return fixtures["failed-turn"];
  if (lowered.includes("connect") || lowered.includes("spotify")) return fixtures["connection-required"];
  return fixtures.greeting;
}

/** A token shaped like keyring's: three dot-joined parts with an exp claim, signed by nobody. */
export function fakeToken(expiresAtMs) {
  const payload = Buffer.from(
    JSON.stringify({ sub: "acct_fake", aud: "lucy-api", exp: Math.round(expiresAtMs / 1000) }),
  ).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.fake`;
}

export class FakeHub {
  /**
   * @param {object} options
   * @param {Record<string, object>} options.fixtures parsed fixture files by name
   * @param {number} [options.approvePolls] device polls before the code self-approves; 0 never
   * @param {(fn: () => void, ms: number) => unknown} [options.schedule] seam for tests
   * @param {() => number} [options.now]
   */
  constructor(options) {
    this.fixtures = options.fixtures;
    this.approvePolls = options.approvePolls ?? 2;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.now = options.now ?? Date.now;
    this.sessions = new Map();
    this.devices = new Map();
    this.idempotent = new Map();
    this.counter = 0;
  }

  #id(prefix) {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }

  // ----- auth -------------------------------------------------------------------------------

  startDevice() {
    const code = {
      device_code: this.#id("dev"),
      user_code: `FAKE-${String(1000 + this.counter)}`,
      polls: 0,
      approved: false,
      denied: false,
    };
    this.devices.set(code.device_code, code);
    return {
      status: 201,
      body: {
        device_code: code.device_code,
        user_code: code.user_code,
        verification_uri: "http://fake/device",
        verification_uri_complete: `http://fake/device?user_code=${code.user_code}`,
        expires_in: 600,
        interval: 1,
      },
    };
  }

  /** `lucy approve CODE`, as the fake: approve or deny by user code. */
  decideDevice(userCode, approve = true) {
    for (const code of this.devices.values()) {
      if (code.user_code === userCode) {
        if (approve) code.approved = true;
        else code.denied = true;
        return { status: 204, body: null };
      }
    }
    return { status: 400, body: { error: "expired_token", error_description: "No such code." } };
  }

  pollDevice(deviceCode) {
    const code = this.devices.get(deviceCode);
    if (code === undefined) return { status: 400, body: { error: "expired_token" } };
    if (code.denied) return { status: 400, body: { error: "access_denied" } };
    code.polls += 1;
    if (!code.approved && this.approvePolls > 0 && code.polls >= this.approvePolls) code.approved = true;
    if (!code.approved) return { status: 400, body: { error: "authorization_pending" } };
    this.devices.delete(deviceCode);
    return { status: 200, body: { access_token: fakeToken(this.now() + 15 * 60 * 1000), token_type: "Bearer" } };
  }

  me() {
    return { status: 200, body: { account_id: "acct_fake", audience: "lucy-api" } };
  }

  // ----- sessions ---------------------------------------------------------------------------

  createSession(body) {
    const id = this.#id("ses");
    const session = {
      row: {
        id,
        profile: "personal",
        title: body?.title ?? "New conversation",
        status: "idle",
        model: "fake:model",
        thinking_config: "default",
        persona: "default",
        harness_version: "fake",
        input_policy: "enqueue",
        durability_mode: "durable",
        permission_mode: body?.permission_mode ?? "ask",
        incognito: false,
        disabled_capabilities: [],
        created_at: this.now() / 1000,
        updated_at: this.now() / 1000,
        archived_at: null,
        input_tokens: 0,
        output_tokens: 0,
        cost_micros: 0,
      },
      items: [],
      events: [],
      subscribers: new Set(),
      pendingCard: null,
      latestTurn: null,
      seq: 0,
      sequence: 0,
    };
    this.sessions.set(id, session);
    return { status: 201, body: session.row };
  }

  listSessions() {
    return {
      status: 200,
      body: {
        data: [...this.sessions.values()].map((session) => session.row),
        has_more: false,
        first_id: null,
        last_id: null,
      },
    };
  }

  updateSession(sessionId, body) {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return { status: 404, body: { title: "Not found", detail: "No such conversation." } };
    if (typeof body?.title === "string") session.row.title = body.title;
    if (body?.archived === true) session.row.archived_at = this.now() / 1000;
    if (body?.archived === false) session.row.archived_at = null;
    session.row.updated_at = this.now() / 1000;
    return { status: 200, body: session.row };
  }

  listItems(sessionId, query = {}) {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return { status: 404, body: { title: "Not found", detail: "No such conversation." } };
    const ordered = query.order === "desc" ? [...session.items].reverse() : [...session.items];
    const after = query.after ? ordered.findIndex((item) => item.id === query.after) : -1;
    if (query.after && after === -1) return { status: 404, body: { title: "Not found", detail: "Stale cursor." } };
    const limit = Number(query.limit ?? 20);
    const selected = ordered.slice(after + 1);
    const data = selected.slice(0, limit);
    return {
      status: 200,
      body: {
        data,
        has_more: selected.length > limit,
        first_id: data[0]?.id ?? null,
        last_id: data.at(-1)?.id ?? null,
      },
    };
  }

  // ----- the write path ---------------------------------------------------------------------

  submitInput(sessionId, body, idempotencyKey) {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return { status: 404, body: { title: "Not found", detail: "No such conversation." } };
    if (!idempotencyKey) return { status: 400, body: { title: "Bad request", detail: "Idempotency-Key is required." } };
    const seen = this.idempotent.get(idempotencyKey);
    if (seen !== undefined) return seen;
    const events = Array.isArray(body?.events) ? body.events : [];
    const first = events[0] ?? {};
    const answer =
      first.type === "input.approval" ? this.#answerApproval(session, first) : this.#startTurn(session, events);
    this.idempotent.set(idempotencyKey, answer);
    return answer;
  }

  #startTurn(session, events) {
    const turnId = this.#id("trn");
    session.latestTurn = { id: turnId, status: "queued" };
    session.row.status = "queued";
    session.row.updated_at = this.now() / 1000;
    for (const event of events) {
      if (event.type === "input.message")
        this.addItem(session.row.id, { type: "message", role: "user", content: event.content }, turnId);
    }
    this.emit(session.row.id, "lucy.turn.created", { input_policy: "enqueue", queued_behind: null }, turnId);
    const said = events.map((event) => (typeof event.content === "string" ? event.content : "")).join(" ");
    this.#play(session, turnId, fixtureFor(`${session.row.title} ${said}`, this.fixtures)?.reply ?? []);
    return { status: 202, body: { id: turnId, session_id: session.row.id, status: "queued" } };
  }

  #answerApproval(session, event) {
    const pending = session.pendingCard;
    if (pending === null || pending.card.approval_id !== event.approval_id) {
      return { status: 404, body: { title: "Not found", detail: "No card is waiting on that id." } };
    }
    session.pendingCard = null;
    const approved = event.approved === true;
    const record = {
      approval_id: pending.card.approval_id,
      approved,
      permission: pending.card.permission,
      lifetime: event.lifetime ?? "once",
      instruction: event.instruction ?? "",
      ...(Array.isArray(event.only) && event.only.length > 0 ? { only: event.only } : {}),
    };
    this.addItem(session.row.id, { type: "approval_response", role: "user", content: record }, pending.turnId);
    this.emit(session.row.id, approved ? "lucy.approval.granted" : "lucy.approval.denied", record, pending.turnId);
    session.latestTurn = { id: pending.turnId, status: "running" };
    session.row.status = "running";
    this.#play(session, pending.turnId, approved ? pending.continuation.approved : pending.continuation.denied);
    return { status: 202, body: { id: pending.turnId, session_id: session.row.id, status: "queued" } };
  }

  cancelTurn(turnId) {
    for (const session of this.sessions.values()) {
      if (session.latestTurn?.id === turnId) {
        session.playing = null;
        session.pendingCard = null;
        session.latestTurn = { id: turnId, status: "cancelled" };
        session.row.status = "idle";
        this.emit(session.row.id, "lucy.turn.cancelled", { was: "running" }, turnId);
        return { status: 200, body: { id: turnId, session_id: session.row.id, status: "cancelled" } };
      }
    }
    return { status: 404, body: { title: "Not found", detail: "No such turn." } };
  }

  // ----- the scripted reply -----------------------------------------------------------------

  #play(session, turnId, steps) {
    const run = { steps: [...steps], turnId };
    session.playing = run;
    const next = () => {
      const step = run.steps.shift();
      if (step === undefined) return;
      this.schedule(() => {
        if (session.playing !== run) return;
        this.#step(session, turnId, step, run);
        next();
      }, step.after_ms ?? 0);
    };
    next();
  }

  #step(session, turnId, step, run) {
    if (step.type === "item") {
      this.addItem(session.row.id, step.item, turnId);
      return;
    }
    if (step.type === "approval") {
      const card = {
        approval_id: this.#id("apr"),
        tool: step.card.tool,
        description: step.card.description,
        arguments: step.card.arguments ?? {},
        reason: step.card.description,
        policy: "ask",
        is_automatic: false,
        permission: step.card.permission ?? step.card.tool,
        ...(step.card.limit ? { limit: step.card.limit } : {}),
      };
      const continuation = run.steps.find((rest) => rest.approved !== undefined) ?? { approved: [], denied: [] };
      run.steps = [];
      session.pendingCard = { card, turnId, continuation };
      session.latestTurn = { id: turnId, status: "input_required" };
      session.row.status = "input_required";
      this.addItem(session.row.id, { type: "approval_request", role: "assistant", content: card }, turnId);
      this.emit(session.row.id, "lucy.approval.requested", card, turnId);
      this.emit(session.row.id, "lucy.turn.input_required", { approval_id: card.approval_id }, turnId);
      return;
    }
    if (step.approved !== undefined) return; // a continuation reached without its card: nothing to do
    if (step.type === "lucy.turn.started") {
      session.latestTurn = { id: turnId, status: "running" };
      session.row.status = "running";
    }
    if (step.type === "lucy.turn.completed" || step.type === "lucy.turn.failed") {
      session.latestTurn = { id: turnId, status: step.type.endsWith("failed") ? "failed" : "completed" };
      session.row.status = "idle";
      session.row.updated_at = this.now() / 1000;
    }
    this.emit(session.row.id, step.type, step.data ?? {}, turnId);
  }

  // ----- items, events, streams -------------------------------------------------------------

  addItem(sessionId, partial, turnId) {
    const session = this.sessions.get(sessionId);
    session.seq += 1;
    const item = {
      id: this.#id("itm"),
      session_id: sessionId,
      seq: session.seq,
      parent_id: null,
      turn_id: turnId ?? null,
      agent_id: null,
      type: partial.type,
      role: partial.role,
      content: partial.content,
      tokens: 0,
      created_at: this.now() / 1000,
    };
    session.items.push(item);
    this.emit(sessionId, "lucy.content.item.added", item, turnId);
    return item;
  }

  emit(sessionId, type, data, turnId) {
    const session = this.sessions.get(sessionId);
    session.sequence += 1;
    const event = {
      type,
      sequence_number: session.sequence,
      event_id: this.#id("evt"),
      session_id: sessionId,
      created_at: this.now() / 1000,
      data,
      ...(turnId ? { turn_id: turnId } : {}),
    };
    session.events.push(event);
    for (const push of session.subscribers) push(event);
    return event;
  }

  /**
   * Follow one conversation: the snapshot, anything missed, then live events.
   * Returns `null` for a conversation that does not exist, else an unsubscribe function.
   */
  subscribe(sessionId, startingAfter, push) {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return null;
    const position = startingAfter ?? session.sequence;
    push({
      type: "lucy.stream.snapshot",
      sequence_number: position,
      event_id: this.#id("evt"),
      session_id: sessionId,
      created_at: this.now() / 1000,
      data: {
        state: {
          id: sessionId,
          title: session.row.title,
          status: session.row.status,
          model: session.row.model,
          input_policy: session.row.input_policy,
          permission_mode: session.row.permission_mode,
          updated_at: session.row.updated_at,
          latest_turn: session.latestTurn,
        },
        sequence_number: session.sequence,
      },
    });
    if (startingAfter !== null && startingAfter !== undefined) {
      for (const event of session.events) if (event.sequence_number > startingAfter) push(event);
    }
    session.subscribers.add(push);
    return () => session.subscribers.delete(push);
  }
}

/** One event as an SSE frame, exactly as the hub encodes it (`stream/sse.py`). */
export function encodeFrame(event) {
  return `id: ${event.sequence_number}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const OPENING = "retry: 3000\n: lucy\n\n";

export function heartbeatFrame(sessionId, now = Date.now) {
  const body = JSON.stringify({ type: "lucy.stream.heartbeat", session_id: sessionId, created_at: now() / 1000 });
  return `event: lucy.stream.heartbeat\ndata: ${body}\n\n`;
}
