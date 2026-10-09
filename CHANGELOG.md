# Changelog

## 0.1.0 (2026-10-09)

The first release: Lucy gets a face.

- **A face that follows the conversation.** Twelve moods derived from the hub's event stream,
  drawn by Agent Robot Avatar (CX ArtLab, MIT) behind a one-method driver. `/face` shows them all.
- **A live transcript.** Messages, plan steps with their notes and timings, errors, and streamed
  text that retires into the durable message it becomes. Unknown item kinds are shown, not
  dropped.
- **Approval cards answered in place.** Allow once, for this conversation, for the profile, or
  always; limit a standing yes to the values a card names; deny with a reason.
- **Resumable streaming.** The stream reconnects from the last event handled, follows the hub's
  slow-consumer resume point, and never shows anything twice.
- **Device-flow sign-in.** No password: approve the page's code with `lucy approve`. The chip
  counts down the token's fifteen minutes and signing in again keeps the page as it is.
- **Headed mode.** `scripts/headed.mjs` drives a conversation from a terminal; Follow switches
  the browser to it, labels its human side "Claude Code", and the person answers its cards.
- **A fake hub** for development and tests, with scripted conversations.
