# Testing

## Unit tests (Vitest)

`npm run test` runs `tests/unit/` with coverage held at 100% statements, branches, functions and
lines **per file**, over `src/` and `scripts/lib/`. Only `src/main.ts` and the thin command-line
wrappers in `scripts/` are outside the gate; their decisions live in gated modules.

Logic runs in plain Node. A test file that mounts components says so in its first line with
`// @vitest-environment happy-dom`, so only those pay for a DOM.

| What | How it is tested |
| --- | --- |
| The protocol | Directly: frames split anywhere, envelopes missing fields, cards with odd bodies. |
| The stream follower | Against `Response` objects with hand-built bodies: resume cursors, replays, slow-consumer resume, 401, 404, bodies that break mid-read. |
| The reducer | `reduce()` called with events; no Vue. |
| The composables | In an `effectScope`, against an in-memory `LucyTransport`. |
| Components and views | Mounted with `@vue/test-utils`; the face is stubbed except in its own test. |
| The fake hub, headed harness, site checker | Their libraries in `scripts/lib/`, directly. |

## End-to-end tests (Playwright)

`npm run test:e2e` builds nothing: it serves the existing `dist/` with `vite preview`, proxied to
`scripts/fake-hub.mjs` on port 8765, so run `npm run build` (or `npm run check`) first. Projects:
Chromium, Firefox, WebKit, a Pixel 7, and Chromium with reduced motion. The headed test runs in
Chromium only, because it drives a second process.

Each test signs in with its own device code, and the fake hub makes every approval a new account
with its own conversations, so tests running in parallel never see each other's sessions.

Locally, `PW_CHROMIUM` can point at an already-installed Chromium instead of downloading one.

## The fake hub

`scripts/fake-hub.mjs` keeps the real hub's shapes: the write path with an Idempotency-Key,
snapshot-then-deltas streams with resume, RFC 8628 device words. Replies are scripted in
`fixtures/conversations/` and chosen by words in the message or title:

| Words | Fixture |
| --- | --- |
| music, play | A step result, then a card; allowed plays the track, denied says it will not. |
| fail | An error item and a failed turn. |
| connect, spotify | A connection prompt, then a reply. |
| anything else | A greeting and a context report. |

Device codes approve themselves on the second poll; `POST /__fake/approve {"user_code": ...}`
approves one at once, as `lucy approve` would. A unit test holds every fixture to event names the
client knows.
