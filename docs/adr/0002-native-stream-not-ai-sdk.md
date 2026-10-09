# ADR-0002: Read the native event stream, not the AI SDK projection

**Status:** accepted (2026-10-09).

## Context

The hub's `GET /v1/sessions/{id}/events` speaks two encodings. The default is the native
`lucy.*` stream. With `x-lucy-ui-message-stream: v1` it speaks the Vercel AI SDK UI Message
Stream, which a `useChat` client renders with no adapter.

## Decision

Read the native stream, as `lucy talk` does. The AI SDK projection is, in the hub's own words,
lossy: its approval part carries only an id, not the card's question, permission or calls; it has
no part for an item as it lands, the context report, or finished work. This client needs all of
them, and the native stream is the hub's own contract, resumable by sequence number.

## Consequences

- The client keeps its own event names (`src/protocol/events.ts`), copied from the hub and
  listed with their sources in [docs/protocol.md](../protocol.md).
- Unknown events are counted, never dropped, so a hub that grows new events is visible here
  before this client learns to read them.

## What would change our minds

An AI SDK projection that carried the card's body and items as `data-*` parts, at which point a
stock `useChat` client could replace the reducer.
