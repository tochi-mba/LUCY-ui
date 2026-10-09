/**
 * What went wrong talking to the hub, in two kinds that call for different things.
 *
 * `LucyError` is the hub answering no: a problem document with a status, a sentence and the
 * request id worth quoting. `Unreachable` is nothing answering at all. The CLI keeps the same
 * distinction (exit 1 against exit 3), because a retry helps one and never the other.
 */
import { isRecord, number, optionalText } from "../protocol/guards";

export class LucyError extends Error {
  readonly status: number;
  readonly problem: string;
  readonly requestId: string | null;
  readonly retryAfter: number | null;

  constructor(
    status: number,
    message: string,
    details: { problem?: string; requestId?: string | null; retryAfter?: number | null } = {},
  ) {
    super(message);
    this.name = "LucyError";
    this.status = status;
    this.problem = details.problem ?? "";
    this.requestId = details.requestId ?? null;
    this.retryAfter = details.retryAfter ?? null;
  }
}

export class Unreachable extends Error {
  constructor(message = "Lucy could not be reached.") {
    super(message);
    this.name = "Unreachable";
  }
}

const FALLBACK: Record<number, string> = {
  401: "Your sign-in was refused or has expired.",
  403: "That is not allowed for this account.",
  404: "That conversation does not exist, or is not yours.",
  409: "Lucy is busy with that conversation; try again in a moment.",
  503: "Something Lucy depends on is unavailable.",
};

/** Read a refused response into a `LucyError`, whatever its body turned out to be. */
export async function errorFrom(response: Response): Promise<LucyError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = isRecord(body) ? body : {};
  const message =
    optionalText(record.detail) ??
    optionalText(record.error_description) ??
    optionalText(record.title) ??
    FALLBACK[response.status] ??
    `Lucy answered ${response.status}.`;
  const retry = number(Number(response.headers.get("Retry-After") ?? Number.NaN));
  return new LucyError(response.status, message, {
    problem: optionalText(record.type) ?? optionalText(record.error) ?? "",
    requestId: optionalText(record.request_id) ?? response.headers.get("X-Request-ID"),
    retryAfter: retry,
  });
}

/** One sentence for a person, whatever was thrown. */
export function describe(error: unknown): string {
  if (error instanceof LucyError || error instanceof Unreachable) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}
