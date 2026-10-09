/**
 * When a keyring token stops working.
 *
 * The UI never verifies a token; the hub does. It only reads the `exp` claim so it can say how
 * long is left, because a keyring token lives fifteen minutes and a person should see that coming
 * rather than meet it as a refused message. A token that cannot be read has no known expiry.
 */
export function expiryOf(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    const exp = (claims as { exp?: unknown } | null)?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}
