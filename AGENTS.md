# Working notes for LUCY-ui

LUCY-ui is a browser client of the LUCY hub (`LUCY-assistant/src/lucy_api`). It renders what the
hub says and sends what the person decides; it decides nothing the hub would have to trust.
[README.md](README.md) is how to use it; [docs/](docs/) is how it works.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/protocol/` | The wire, read defensively. `sse.ts` and `headed.ts` have no imports so Node can run them by type stripping; the scripts import them, so the two clients share one grammar. |
| `src/transport/` | `types.ts` is the only thing screens know about a hub. `http.ts` implements it; `stream.ts` follows a conversation with a resume cursor. |
| `src/stores/conversation.ts` | The reducer: plain functions over a plain object. Everything a screen shows about a conversation is derived here. |
| `src/face/` | `moods.ts` is the pure mood function; `driver.ts` is the only code that touches the face element. |
| `scripts/lib/` | Every decision behind the scripts. The wrappers in `scripts/` only do I/O. |

## Invariants

1. **One write path.** Everything sent goes through `transport.send()` with an Idempotency-Key; a
   retry reuses the key, so the hub sees one message however many times it was posted.
2. **The stream is the truth, items are the history.** The reducer never invents state the hub
   did not emit. An event it has no reading for is counted (`unknownEvents`), never dropped
   silently and never a crash.
3. **Nothing is said twice.** Streamed text retires when the message item for its turn arrives;
   items are keyed by id; the stream skips anything at or below its cursor.
4. **A token is never in a URL, a log, localStorage, or a commit.** `sessionStorage` only. A 401
   reopens the sign-in dialog and keeps everything on screen.
5. **Model text is untrusted.** Markdown renders with raw HTML escaped and unsafe link schemes
   refused; links open in a new tab with no opener. A card's question is the hub's description,
   never a model sentence.
6. **The face follows the conversation.** `moodFor()` is a pure function of store state. No
   component calls the face directly.
7. **`npm run check` talks to no hub and no model.** Unit tests use stubs and the fake hub;
   e2e runs the build against `scripts/fake-hub.mjs`.
8. **Same style as the family.** One defect per commit, a test that names the defect, an
   imperative subject with no type prefix, the why in the body.

## Gates

`npm run check` is lint (Biome), types (vue-tsc), Vitest with 100% statements, branches,
functions and lines **per file** over `src/` and `scripts/lib/`, the production build, and the
site checker. `npm run test:e2e` is Playwright against the fake hub. CI runs both. Run the full
unit suite in the background on this machine; a single file is quick in the foreground.

## The hub's vocabulary changes

Event names, item kinds and payload fields are copied from the hub, and
[docs/protocol.md](docs/protocol.md) names the hub file each comes from. When the hub adds or
renames one, change `src/protocol/events.ts` and the table together, add a fixture step that
uses it, and the fixture test will hold the fake hub to the same vocabulary.
