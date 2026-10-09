# ADR-0001: The face is Agent Robot Avatar

**Status:** accepted (2026-10-09).

## Context

The owner asked for "one of those programmable faces, something open source on GitHub" to be
Lucy's face. It had to be open source for commercial use, work in Vue without a framework bridge,
respect reduced motion, and express a request's life: waiting, needing the person, success,
failure, a lost connection.

## Decision

[Agent Robot Avatar](https://github.com/CX-ArtLab/agent-robot-avatar) 0.5.x by CX ArtLab. MIT,
zero runtime dependencies, a native custom element drawn in SVG, blinking and pointer-following
on its own, `motion="reduce"`, and actions that map one to one onto a turn's life. It is pinned
to `~0.5.2`: its API is pre-1.0.

The comparison is in [docs/face.md](../face.md). The closest alternative, agentfaces (MIT), has a
richer state set but renders only in React.

## Consequences

- The face has no speaking state; speaking borrows its attentive eyes.
- The character and its visual identity are CX ArtLab's. The README, the site and the licence
  credit them, and nothing here presents the robot as a REX design.
- An API change before 1.0 is absorbed in `src/face/driver.ts` alone.

## What would change our minds

A face with a real speaking state, once replies stream token by token. agentfaces is the
candidate; it would be a second driver ([ADR-0004](0004-web-component-face-behind-a-driver.md)).
