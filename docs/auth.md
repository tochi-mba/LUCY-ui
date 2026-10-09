# Signing in

The client uses the hub's device flow, the same one `lucy setup` uses.

1. **Get a sign-in code** asks the hub for one (`POST /v1/auth/device`). The dialog shows the
   exact command, `lucy approve ABCD-EFGH`, with a copy button.
2. In a terminal already signed in as you, run it. That terminal hands its sign-in to the waiting
   page; no page ever asks for a password.
3. The page polls at the interval the hub gave it, five seconds slower whenever the hub says
   `slow_down`, and stops on `access_denied` or an expired code.

With no signed-in terminal, **Or paste a token** takes a keyring token with audience `lucy-api`.
It is checked against `GET /v1/me` before it is kept.

## Fifteen minutes

A keyring token lives fifteen minutes, and the device flow hands over the approving terminal's
token, so a browser sign-in lasts at most that long. The client cannot extend it. Instead:

- the chip shows who is signed in and counts the time down, turning amber in the last two
  minutes;
- the first request the hub refuses reopens the dialog, titled "Sign in again", with the page
  left exactly as it was;
- an open event stream is not torn down at expiry. If the hub refuses a reconnect, the side panel
  says so and the face shows the lost connection until the person signs in again.

A longer-lived browser sign-in is the hub's and keyring's decision to make, not this client's.

## Where the token lives

In this tab's `sessionStorage`, under `lucy-ui.token`. Never `localStorage`, which every tab on
the origin shares and which outlives the tab; never a URL. If storage is blocked, the token lives
in memory for as long as the page does.
