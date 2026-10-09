# Architecture

Four layers, and data moves one way through them.

```
hub ──SSE──▶ transport ──events──▶ stores (reducer) ──state──▶ components + face
 ▲                                                                   │
 └────────────── transport.send() ◀── the person's decisions ────────┘
```

| Layer | Knows about | Never knows about |
| --- | --- | --- |
| `src/protocol/` | The hub's wire: frames, envelopes, items, cards. | Vue, the DOM, the network. |
| `src/transport/` | HTTP, the stream, retries, the resume cursor. | What any event means. |
| `src/stores/` | What events mean for one conversation, and the list of conversations. | How they arrived. |
| `src/components/`, `src/views/`, `src/face/` | How to show state and collect a decision. | The wire. |

## Opening a conversation

1. `useConversation` follows the session's event stream with no cursor.
2. The first frame is the hub's **snapshot**: the session's title and status, its latest turn,
   and a position. The stream adopts that position as its cursor.
3. On every snapshot (the first and each after a reconnect) the newest page of history is
   loaded. History fetched after the snapshot already holds anything said before it; the stream
   carries everything after. Overlap is harmless: items are keyed by id.
4. Each event goes through `reduce()`, and the cursor moves to its sequence number.
5. A dropped connection reconnects with `?starting_after=<cursor>`. Events at or below the
   cursor are skipped, so a replay never shows anything twice. A `slow_consumer` stream error
   names the cursor to resume from, and the follower uses it.

## Sending

The one write path, `POST /v1/sessions/{id}/inputs`, with an `Idempotency-Key` minted per
message. A network failure is retried with the same key; a refusal from the hub is reported and
not retried. Answering a card is the same route with an `input.approval` event; the card shows
"Sending your answer" until the hub's `approval.granted`/`denied` arrives, and goes back to
pending if the send fails.

## Why the stores are plain functions

`stores/conversation.ts` holds a plain object and plain functions over it. The composable wraps
it in `reactive()`; the tests call `reduce()` directly. Every rule about what the stream means
(text retiring into items, cards resolving, which turn is on screen) is a unit test with no DOM
and no network, which is how the reducer is held to full coverage without mocking Vue.

## The proxy

The browser only ever talks to its own origin. The dev server (`vite.config.ts`) and
`scripts/serve.mjs` pass `/v1`, `/healthy`, `/ready` and `/device` through to `LUCY_URL`. The hub
has no CORS policy and needs none ([ADR-0003](adr/0003-same-origin-proxy-not-cors.md)).
