# Contributing

1. `npm install`, then `npm run check`. It must pass before anything is pushed, and it holds every
   file under `src/` and `scripts/lib/` to 100% coverage.
2. One defect per commit, with a test that names the defect. A feature is a commit per behaviour
   a person could notice.
3. A subject is a plain imperative sentence saying what changed for a person or a caller, with no
   type prefix and no trailing period. The body says why, and what was measured when a
   measurement decided it.
4. Run `npm run test:e2e` when a change touches what a person sees; it needs the Playwright
   browsers (`npx playwright install chromium firefox webkit`).
5. Keep [AGENTS.md](AGENTS.md)'s invariants. A change that has to break one starts with a
   decision record in [docs/adr/](docs/adr/README.md).
