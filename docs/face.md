# The face

## Which face, and why

The face is **[Agent Robot Avatar](https://github.com/CX-ArtLab/agent-robot-avatar)** by CX ArtLab:
MIT licensed, zero dependencies, a native Web Component drawn in SVG, with automatic blinking,
eyes that follow the pointer, reduced-motion support, and an action vocabulary that is already a
request lifecycle (`waiting`, `send`, `success`, `failure`, `warning`, `blocked`,
`connection-error`, `sleep`).

| Candidate | Licence | Why not |
| --- | --- | --- |
| agentfaces | MIT | The richest state set (it has `speaking` and `listening`), but its renderer is React only; a Vue port of its component is about 400 lines. The best second face if one is wanted. |
| Emotion Ball (aora-bot) | Community licence | Not open source for commercial use, and its art is for personal study only. |
| TalkingHead | MIT | A 3D avatar with lip sync: three.js, GLB models and a speech engine. Far more than a face. |
| Web-Eye-Animation | MIT | Eyes only, loaded from a CDN script, little activity. |
| tablet-robot-face | MIT | Unmaintained since 2018. |

The MIT licence covers the code. The character and its visual identity are CX ArtLab's; this
project credits them in the README, the site footer and the licence, and never presents the
robot as its own design.

## Moods

`src/face/moods.ts` derives one mood from the conversation, checking in this order:

| Mood | When | The face |
| --- | --- | --- |
| asleep | Signed out. | `sleep()` |
| disconnected | The stream is reconnecting, refused or closed. | `play("connection-error")` |
| needs you | A pending card, a connection prompt, or a parked turn. | `play("warning")` |
| speaking | Text is streaming. | attentive eyes (`input(true)`) |
| sent | The turn is queued. | `play("send")` |
| working | The turn is running and its latest item is a step result. | `startWaiting({ variant: "wrap" })` |
| thinking | The turn is running. | `startWaiting()` |
| done, failed, blocked | For four seconds after a turn completes, fails, or a card is denied. | `play("success")`, `play("failure")`, `play("blocked")` |
| attentive | The person is typing. | `input(true)` |
| idle | Anything else. | `reset()` |

Short moods (sent and the three outcomes) are animations that need a moment to be seen. While one
plays, a newer mood waits; only the latest waiting mood is kept, so the face never replays a
backlog (`src/face/driver.ts`).

The component has no speaking state, so speaking borrows its attentive eyes. The hub sends a
reply's text in one piece today, so speaking is brief; it will matter when replies stream token
by token.

## Swapping the face

Everything this client knows about the face is the `AvatarElement` interface in
`src/face/driver.ts`. A different face is a second `FaceDriver` and a different element in
`LucyFace.vue`; nothing else changes ([ADR-0004](adr/0004-web-component-face-behind-a-driver.md)).
