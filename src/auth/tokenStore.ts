/**
 * Where the sign-in is kept: this tab's sessionStorage, and nowhere else.
 *
 * Never localStorage, which outlives the tab and is shared by every tab on the origin, and never
 * a URL, which lands in history and in proxy logs. Storage can be missing or throw (a private
 * window, blocked site data); then the token lives in memory for as long as the page does.
 */
export interface TokenStore {
  read(): string | null;
  write(token: string | null): void;
}

export const TOKEN_KEY = "lucy-ui.token";

export function sessionTokenStore(storage: () => Storage | undefined = () => globalThis.sessionStorage): TokenStore {
  let memory: string | null = null;
  return {
    read() {
      try {
        return storage()?.getItem(TOKEN_KEY) ?? memory;
      } catch {
        return memory;
      }
    },
    write(token) {
      memory = token;
      try {
        const target = storage();
        if (token === null) target?.removeItem(TOKEN_KEY);
        else target?.setItem(TOKEN_KEY, token);
      } catch {
        // Kept in memory; the next tab will sign in again.
      }
    },
  };
}
