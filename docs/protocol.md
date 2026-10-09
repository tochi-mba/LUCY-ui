# What this client reads from the hub

Verified against the hub's source on 2026-10-09. Paths are in `LUCY-assistant/src/lucy_api/`.
When the hub changes one of these, change `src/protocol/events.ts` and this table together.

## Routes

| Route | Use | Hub source |
| --- | --- | --- |
| `GET /v1/me` | Who the token is for, for the chip. | `api/routers/me.py` |
| `POST /v1/auth/device`, `POST /v1/auth/device/token` | Device sign-in; RFC 8628 error words. | `api/routers/device.py`, `auth/device.py` |
| `GET /v1/sessions`, `POST /v1/sessions`, `PATCH /v1/sessions/{id}` | The rail; new conversations; archiving. | `api/routers/sessions.py` |
| `GET /v1/sessions/{id}/items` | History, newest page first; `after` pages back. | `sessions/sql_store.py` `page()` |
| `POST /v1/sessions/{id}/inputs` | The one write path: messages and approval answers. | `api/routers/sessions.py` |
| `POST /v1/turns/{id}/cancel` | Stop the turn. | `api/routers/sessions.py` |
| `GET /v1/sessions/{id}/events` | The native stream. `?starting_after=N` resumes. | `stream/sse.py`, `stream/emitter.py` |

## Events this client has a reading for

| Event | What it changes | Emitted by |
| --- | --- | --- |
| `lucy.stream.snapshot` | Title, status, latest turn; the stream's starting cursor; a history reload. | `stream/emitter.py` `_prologue` |
| `lucy.stream.resumed`, `.heartbeat`, `.done`, `.error` | Connection only. `.error` with `starting_after` sets the resume point. | `stream/emitter.py`, `stream/sse.py` |
| `lucy.content.item.added` | One transcript item, upserted by id. | `sessions/sql_store.py` `item_row` |
| `lucy.content.text.start/delta/end` | A streamed text block. Today the hub sends the whole reply in one delta. | `turn/project.py` |
| `lucy.content.reasoning.*` | A folded "thinking out loud" block, when the person's settings stream it. | `turn/project.py` |
| `lucy.turn.created` | A queued turn (unless it waits behind the one on screen). | `sessions/turns.py` |
| `lucy.turn.started` | Running. | `sessions/sql_store.py` |
| `lucy.turn.input_required`, `.auth_required` | Parked on the person. | `permissions/approvals.py`, `sessions/sql_store.py` |
| `lucy.turn.completed`, `.failed`, `.cancelled`, `.superseded` | The turn's ending, and the face's moment of outcome. | `sessions/sql_store.py`, `sessions/turns.py` |
| `lucy.turn.slow` | "Taking a while" in the side panel. | `turn/supervisor.py` |
| `lucy.approval.requested` | A pending card. | `permissions/approvals.py` `open_approval` |
| `lucy.approval.granted`, `.denied` | The decision and its lifetime. | `permissions/approvals.py` `answer_approval` |
| `lucy.context.status` | The context meter. | `turn/supervisor.py`, `turn/prompt.py` `window_report` |
| `lucy.compaction.applied` | "Older turns were summarised." | `sessions/compact.py` |
| `lucy.connection.required` | A connect prompt in the side panel. | named in `stream/events.py` |
| `lucy.work.finished` | A row of finished work. | `work/wake.py` |

Everything else in the hub's taxonomy is counted as "no view for" in the side panel. Tool events
(`lucy.tool.*`) are named in the taxonomy but not emitted today; plan steps arrive as
`tool_result` items, and the face reads "working" from a running turn whose latest item is one.

## Items

| Kind / role | Shown as |
| --- | --- |
| `message` / `user` | The person's words, labelled "You", or "Claude Code" in a headed conversation. |
| `message` / `assistant` | Lucy's words, as markdown. |
| `tool_result` / `tool` | One plan step: operation, note, status, timing, summary or error. |
| `error` / `assistant` or `tool` | A failure, in the hub's words, with its code. |
| `approval_request` / `assistant` | The card. |
| `approval_response` / `user` | Not shown on its own; it resolves its card. |
| anything else | A collapsed row with its type, role and content. |

## Why not the AI SDK stream

The hub also speaks the Vercel AI SDK UI Message Stream when asked. That projection drops the
card's body (its approval part carries only an id), the items as they land, the context report
and the work events. This client needs all four, so it reads the native stream
([ADR-0002](adr/0002-native-stream-not-ai-sdk.md)).
