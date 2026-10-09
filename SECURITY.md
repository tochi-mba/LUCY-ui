# Security

LUCY-ui is a client. The hub authenticates every request, checks every grant, and re-checks an
approval before anything runs; this client only renders and relays. What it is responsible for:

- **The token.** It is kept in this tab's `sessionStorage` and nowhere else: never
  `localStorage`, never a URL, never a log line. The headed script reads `LUCY_TOKEN` or the CLI's
  saved configuration, puts it in a header, and never prints it.
- **Model text.** Lucy's words are rendered with raw HTML escaped and `javascript:`/`data:` links
  refused. Every link opens in a new tab with `rel="noopener noreferrer"`.
- **What a card asks.** The question on an approval card is the hub's own description of the
  call. A standing yes limited to some values is sent only with a standing lifetime, as the hub
  requires.
- **The proxy.** The dev server and `scripts/serve.mjs` bind to loopback and pass the hub's paths
  through. They add no authentication of their own; do not expose them beyond the machine.

Report a vulnerability through this repository's private vulnerability reporting, or to the
maintainer at the address in the family's
[SECURITY.md](https://github.com/tochi-mba/LUCY-assistant/blob/main/SECURITY.md).
