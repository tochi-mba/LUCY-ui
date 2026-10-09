/**
 * Transcript items: the conversation's durable history (`GET /v1/sessions/{id}/items`, and
 * `lucy.content.item.added` as each one lands).
 *
 * The kinds the hub writes today are `message` (user and assistant), `tool_result`, `error`,
 * `approval_request` and `approval_response`; helpers' items carry an `agent_id`. Anything else is
 * still an item and is shown generically, so a kind added to the hub is never invisible here.
 */
import { isRecord, type JsonRecord, number, optionalText, text, texts } from "./guards";

export interface Item {
  id: string;
  seq: number;
  type: string;
  role: string;
  content: unknown;
  turn_id: string | null;
  agent_id: string | null;
  created_at: number;
}

/** An item row, read defensively. `null` when the row is not an item at all. */
export function asItem(value: unknown): Item | null {
  if (!isRecord(value)) return null;
  const id = optionalText(value.id);
  const seq = number(value.seq);
  const type = optionalText(value.type);
  if (id === null || seq === null || type === null) return null;
  return {
    id,
    seq,
    type,
    role: text(value.role, "assistant"),
    content: value.content ?? null,
    turn_id: optionalText(value.turn_id),
    agent_id: optionalText(value.agent_id),
    created_at: number(value.created_at) ?? 0,
  };
}

/** The words of a message item. A message whose content is not text is shown as its JSON. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (isRecord(content) && typeof content.text === "string") return content.text;
  return JSON.stringify(content, null, 2) ?? "";
}

export interface ApprovalStep {
  step: string;
  operation: string;
  arguments: unknown;
  description: string;
}

/** The card the hub parks a turn on (`permissions/approvals.py` `open_approval`). */
export interface ApprovalRequest {
  approval_id: string;
  tool: string;
  description: string;
  permission: string;
  arguments: unknown;
  /** "Always, for these": the field a standing yes may be limited by, and its values. */
  limit: { field: string; values: string[] } | null;
  /** Several calls under one permission are one card. */
  steps: ApprovalStep[];
}

export function approvalRequestOf(content: unknown): ApprovalRequest | null {
  if (!isRecord(content)) return null;
  const id = optionalText(content.approval_id);
  if (id === null) return null;
  const tool = text(content.tool);
  return {
    approval_id: id,
    tool,
    description: text(content.description, tool),
    permission: text(content.permission, tool),
    arguments: content.arguments ?? null,
    limit: limitOf(content.limit),
    steps: Array.isArray(content.steps) ? content.steps.filter(isRecord).map(stepOf) : [],
  };
}

function limitOf(value: unknown): ApprovalRequest["limit"] {
  if (!isRecord(value) || typeof value.field !== "string") return null;
  const values = texts(value.values);
  return values.length ? { field: value.field, values } : null;
}

function stepOf(step: JsonRecord): ApprovalStep {
  return {
    step: text(step.step),
    operation: text(step.operation),
    arguments: step.arguments ?? null,
    description: text(step.description),
  };
}

/** The person's answer to a card, as the hub records it. */
export interface ApprovalResponse {
  approval_id: string;
  approved: boolean;
  lifetime: string;
  instruction: string;
  only: string[];
}

export function approvalResponseOf(content: unknown): ApprovalResponse | null {
  if (!isRecord(content)) return null;
  const id = optionalText(content.approval_id);
  if (id === null || typeof content.approved !== "boolean") return null;
  return {
    approval_id: id,
    approved: content.approved,
    lifetime: text(content.lifetime, "once"),
    instruction: text(content.instruction),
    only: texts(content.only),
  };
}

/** One executed step of a plan (`turn/loop.py` `_item_for`). */
export interface ToolResult {
  operation: string;
  status: string;
  note: string;
  summary: string;
  error: string;
  duration_ms: number | null;
}

export function toolResultOf(content: unknown): ToolResult {
  const body = isRecord(content) ? content : {};
  return {
    operation: text(body.operation, "a step"),
    status: text(body.status, "unknown"),
    note: text(body.note),
    summary: text(body.summary),
    error: text(body.error),
    duration_ms: number(body.duration_ms),
  };
}

/** An `error` item: a code the hub chose and a sentence for the person. */
export function errorOf(content: unknown): { code: string; detail: string } {
  const body = isRecord(content) ? content : {};
  return { code: text(body.code, "error"), detail: text(body.detail) };
}
