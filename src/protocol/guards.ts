/**
 * Readers for JSON that came over the wire. Nothing the hub sends is trusted to have the shape
 * its documentation promises: a reader returns a fallback rather than throwing, so one odd field
 * costs one odd row on screen and never the whole conversation.
 */

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
