# ADR-0004: The face is a custom element behind a one-method driver

**Status:** accepted (2026-10-09).

## Context

The face is a third-party custom element whose API is pre-1.0 ([ADR-0001](0001-face-is-agent-robot-avatar.md)).
Calls scattered across components would make every API change a hunt, and would let a component
make the face do something the conversation did not.

## Decision

- `moodFor()` (`src/face/moods.ts`) is a pure function from conversation state to one of twelve
  moods. No component tells the face what to feel.
- `FaceDriver` has one method that matters, `set(mood)`. `AvatarDriver` is the only code that
  calls the element, through the `AvatarElement` interface. It holds short animations for a
  moment and keeps only the latest mood that arrived meanwhile.
- `LucyFace.vue` defines the element on first mount (a dynamic import, so pages without a face
  never load it) and takes the registration and the driver as props, which is the test seam.

## Consequences

- Swapping the face is a second driver and a different tag in `LucyFace.vue`.
- Every rule about which mood wins is a unit test of a pure function.

## What would change our minds

A face that needed continuous input (an audio level for a moving mouth). The driver would grow a
second method for it; moods would stay a pure function.
