# ADR-0003: Reach the hub through a same-origin proxy

**Status:** accepted (2026-10-09).

## Context

The hub adds no CORS middleware (`api/app.py`). A browser page on another origin cannot call it.
Adding a CORS allow-list to the hub is an attack-surface decision for the hub, not a client.

## Decision

The browser only talks to its own origin. The Vite dev server (`vite.config.ts`) and
`scripts/serve.mjs` pass `/v1`, `/healthy`, `/ready` and `/device` through to `LUCY_URL`,
streaming responses unbuffered so the event stream stays live. Both bind to loopback.

## Consequences

- No hub change was needed for this client.
- The client cannot be hosted on GitHub Pages against a hub on someone's machine; the Pages site
  is a description of the client, not the client.
- The proxy adds no authentication; it must stay on loopback.

## What would change our minds

A hosted client. That would need a `LUCY_UI_ORIGINS` allow-list on the hub, decided there.
