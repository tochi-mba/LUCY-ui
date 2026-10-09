# Headed mode: watching another program talk to Lucy

A coding agent (Claude Code, or anything with a shell) can hold a conversation with Lucy from a
terminal while a person watches it, and answers its approval cards, in the browser.

## The recipe

1. Have the hub running and the client open: `npm run dev`, then sign in.
2. Tick **Follow** in the rail.
3. From the terminal:

   ```sh
   SESSION=$(node scripts/headed.mjs new "fix the flaky test")
   node scripts/headed.mjs say "$SESSION" "run the tests and tell me what fails"
   ```

   `new` prints the session id on stdout and nothing else there. `say` prints Lucy's reply on
   stdout when the turn ends and exits 0; a failed or stopped turn exits 1 with the reason on
   stderr; an unreachable hub exits 3, as `lucy` does.
4. The browser switches to the conversation when its turn goes live. Its human side is labelled
   "Claude Code" and the rail badges it.
5. If Lucy parks on an approval card, the terminal prints
   `[Lucy is asking for approval in the UI: ...]` on stderr and keeps waiting. The person answers
   in the browser, and the terminal carries on with the reply.

`node scripts/headed.mjs watch <session_id>` tails a conversation's raw events, one per line.

## Where the token comes from

`LUCY_TOKEN` if it is set, otherwise the token `lucy setup` saved, found by the CLI's own rules:
`LUCY_CONFIG`, then `$XDG_CONFIG_HOME/lucy/config.toml`, then `%APPDATA%\lucy\config.toml` on
Windows, then `~/.config/lucy/config.toml`. The hub is `LUCY_URL`, default
`http://127.0.0.1:8000`. The token is never printed.

## How the label works

The hub's message input has no author field. The headed script titles every conversation it
starts `Claude Code · <topic>` (`src/protocol/headed.ts`, shared by the script and the client),
and the client reads the prefix. A `client` field on the hub's session would be the cleaner
signal; until the hub has one, the title is the contract.

## When Follow moves the page

Follow switches to the most recently active conversation whose turn is queued, running or parked
on the person, polling the list every three seconds. It does not move the page while the person
has a draft in the composer or a card is waiting on the conversation they are looking at.
