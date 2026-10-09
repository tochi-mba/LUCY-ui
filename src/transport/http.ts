/**
 * The hub over HTTP, from the browser.
 *
 * Paths are relative to this page's origin: the dev server and scripts/serve.mjs pass them through
 * to the hub, so the hub needs no CORS policy (ADR-0003). The bearer token comes from a provider
 * function rather than a field, so signing in again changes every later request without
 * rebuilding anything.
 */
import { isRecord, optionalText } from "../protocol/guards";
import { asItem, type Item } from "../protocol/items";
import type { CreateSession, Page, PageQuery, Session, Turn, UpdateSession } from "../protocol/sessions";
import { errorFrom, Unreachable } from "./errors";
import { abortableSleep, follow } from "./stream";
import type { DeviceCode, DevicePoll, FollowHandlers, InputEvent, LucyTransport, Me } from "./types";

export interface HttpOptions {
  /** Where the hub's paths are served from. Empty means this page's own origin. */
  baseUrl?: string;
  token: () => string | null;
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Device sign-in is the one place a request carries no token. */
  anonymous?: boolean;
}

const POLL_ERRORS: Record<string, DevicePoll> = {
  authorization_pending: { status: "pending" },
  slow_down: { status: "slow_down" },
  access_denied: { status: "denied" },
  expired_token: { status: "expired" },
};

export class HttpTransport implements LucyTransport {
  readonly #base: string;
  readonly #token: () => string | null;
  readonly #onUnauthorized: () => void;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(options: HttpOptions) {
    this.#base = (options.baseUrl ?? "").replace(/\/$/, "");
    this.#token = options.token;
    this.#onUnauthorized = options.onUnauthorized ?? (() => {});
    // Bound, because a bare `fetch` called as a method of something else throws "Illegal invocation".
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#sleep = options.sleep ?? abortableSleep;
  }

  me(): Promise<Me> {
    return this.#json<Me>("GET", "/v1/me");
  }

  listSessions(query: PageQuery = {}): Promise<Page<Session>> {
    return this.#json<Page<Session>>("GET", `/v1/sessions${queryString(query)}`);
  }

  createSession(body: CreateSession): Promise<Session> {
    return this.#json<Session>("POST", "/v1/sessions", { body, headers: { "Idempotency-Key": newKey() } });
  }

  updateSession(sessionId: string, body: UpdateSession): Promise<Session> {
    return this.#json<Session>("PATCH", `/v1/sessions/${encodeURIComponent(sessionId)}`, { body });
  }

  async listItems(sessionId: string, query: PageQuery = {}): Promise<Page<Item>> {
    const page = await this.#json<Page<unknown>>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/items${queryString(query)}`,
    );
    return { ...page, data: page.data.map(asItem).filter((item): item is Item => item !== null) };
  }

  send(sessionId: string, events: InputEvent[], idempotencyKey: string): Promise<Turn> {
    return this.#json<Turn>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/inputs`, {
      body: { events },
      headers: { "Idempotency-Key": idempotencyKey },
    });
  }

  cancelTurn(turnId: string): Promise<Turn> {
    return this.#json<Turn>("POST", `/v1/turns/${encodeURIComponent(turnId)}/cancel`);
  }

  startDevice(): Promise<DeviceCode> {
    return this.#json<DeviceCode>("POST", "/v1/auth/device", { anonymous: true });
  }

  async pollDevice(deviceCode: string): Promise<DevicePoll> {
    const response = await this.#request("POST", "/v1/auth/device/token", {
      anonymous: true,
      body: { device_code: deviceCode },
    });
    const body: unknown = await response.json().catch(() => null);
    const record = isRecord(body) ? body : {};
    const token = optionalText(record.access_token);
    if (response.ok && token !== null) return { status: "approved", token };
    return POLL_ERRORS[optionalText(record.error) ?? ""] ?? { status: "expired" };
  }

  follow(sessionId: string, handlers: FollowHandlers, signal: AbortSignal): Promise<void> {
    const path = `${this.#base}/v1/sessions/${encodeURIComponent(sessionId)}/events`;
    return follow({
      url: (cursor) => (cursor === null ? path : `${path}?starting_after=${cursor}`),
      headers: () => ({ Accept: "text/event-stream", ...this.#authorization() }),
      fetch: this.#fetch,
      sleep: this.#sleep,
      signal,
      handlers,
      onUnauthorized: this.#onUnauthorized,
    });
  }

  #authorization(): Record<string, string> {
    const token = this.#token();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async #request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options.anonymous ? {} : this.#authorization()),
      ...options.headers,
    };
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    try {
      return await this.#fetch(`${this.#base}${path}`, init);
    } catch {
      throw new Unreachable();
    }
  }

  async #json<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    let response = await this.#request(method, path, options);
    if (response.status === 503) {
      // Keyring's keys could not be fetched; the token is probably fine. The hub says when to
      // come back, once, and a second 503 is reported rather than retried forever.
      const error = await errorFrom(response);
      if (error.retryAfter === null) throw error;
      await this.#sleep(error.retryAfter * 1000, new AbortController().signal);
      response = await this.#request(method, path, options);
    }
    if (!response.ok) {
      const error = await errorFrom(response);
      if (error.status === 401 && !options.anonymous) this.#onUnauthorized();
      throw error;
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

export function queryString(query: PageQuery): string {
  const entries = Object.entries(query).filter(([, value]) => value !== undefined && value !== "");
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
}

export function newKey(): string {
  return crypto.randomUUID();
}
