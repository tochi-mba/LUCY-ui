# LUCY-ui

A REX Technologies product. Site: <https://tochi-mba.github.io/LUCY-ui/>

Lucy's face. A browser client for the [LUCY hub](https://github.com/tochi-mba/LUCY-assistant):
an animated face that follows the conversation, Lucy's words streaming in as she says them, and
her approval cards answered in place. It reads the hub's own event stream and needs no change to
the hub.

```sh
npm install
npm run dev          # http://127.0.0.1:5173, proxied to the hub at LUCY_URL (default :8000)
lucy approve CODE    # in a terminal that is already signed in, with the code the page shows
```

No hub nearby? `npm run dev:fake` serves the same client against a scripted hub: a greeting, a
music request that parks on an approval card, a failing turn and a missing connection, with a
sign-in that approves itself.

## What it shows

| | |
| --- | --- |
| **The face** | Twelve moods, each a pure function of the conversation (`src/face/moods.ts`): asleep, idle, attentive, sent, thinking, working, speaking, needs you, blocked, done, failed, disconnected. `/face` shows them all. |
| **The transcript** | Messages, every plan step with its note and timing, errors, and streamed text that retires into the durable message it becomes. An item kind this client has no view for is shown generically, never dropped. |
| **Approval cards** | The hub's own question and permission, every call on a many-call card, and allow once, for this conversation, for the profile, or always, limited to chosen values when the card names a field. Deny takes two presses and carries a reason. |
| **The side panel** | The turn and a Stop button, connection prompts, the context window in the numbers the hub acts on, finished work, and a count of events this client has no view for. |
| **Sign-in** | The hub's device flow: no password, a code approved from a signed-in terminal. A chip counts down the fifteen minutes a keyring token lives; signing in again keeps the page as it is. |

## Headed mode

A coding agent can drive a conversation while a person watches it here.

```sh
node scripts/headed.mjs new "refactor the parser"     # prints the session id
node scripts/headed.mjs say <session_id> "run the tests"   # prints Lucy's reply
node scripts/headed.mjs watch <session_id>            # tails the event stream
```

Conversations it starts are titled `Claude Code · <topic>`; the client badges them and labels
their human side "Claude Code". Turn on **Follow** in the rail and the screen switches to
whatever is live, except while you are typing or deciding a card. When Lucy parks on a card the
terminal is told it is waiting in the UI, and the person answers it there. See
[docs/headed.md](docs/headed.md).

## Commands

```sh
npm run check        # lint, types, unit tests at 100% coverage, build, site checks: what CI runs
npm run test:e2e     # Playwright against the fake hub: three engines, a phone, reduced motion
npm run serve        # the build, with the hub's paths passed through (production shape)
npm run fake-hub     # the scripted hub alone, on :8765
```

## Layout

| Path | What |
| --- | --- |
| `src/protocol/` | The hub's wire, read defensively: the SSE grammar, the event envelope, items, approval answers, token expiry. |
| `src/transport/` | The one interface the UI asks of a hub, its HTTP implementation, and the resumable stream follower. |
| `src/stores/` | The conversation reducer (events into state, pure), and the composables that wire it to a hub. |
| `src/face/` | The mood function, the driver that turns moods into calls on the face, and the component. |
| `src/components/`, `src/views/` | The screens. |
| `scripts/lib/` | The fake hub, the headed harness's decisions, and the site checker; held to full coverage. |
| `fixtures/conversations/` | The scripted replies the fake hub plays. |
| `docs/` | How it works and why: [architecture](docs/architecture.md), [protocol](docs/protocol.md), [face](docs/face.md), [auth](docs/auth.md), [headed](docs/headed.md), [testing](docs/testing.md), [decisions](docs/adr/README.md). |

## Licence

MIT. The face is [Agent Robot Avatar](https://github.com/CX-ArtLab/agent-robot-avatar) by CX
ArtLab, used under its MIT License; its character and visual identity are CX ArtLab's.
