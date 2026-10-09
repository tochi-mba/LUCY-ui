import { describe, expect, it } from "vitest";
import { sessionTokenStore, TOKEN_KEY } from "../../src/auth/tokenStore";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("the token store", () => {
  it("writes and reads the one key, and clears it with null", () => {
    const storage = fakeStorage();
    const store = sessionTokenStore(() => storage);
    store.write("tok");
    expect(storage.getItem(TOKEN_KEY)).toBe("tok");
    expect(store.read()).toBe("tok");
    store.write(null);
    expect(store.read()).toBeNull();
  });

  it("keeps the token in memory when storage is missing or throws", () => {
    const missing = sessionTokenStore(() => undefined);
    missing.write("tok");
    expect(missing.read()).toBe("tok");

    const throwing = sessionTokenStore(() => {
      throw new Error("blocked");
    });
    throwing.write("tok2");
    expect(throwing.read()).toBe("tok2");
    throwing.write(null);
    expect(throwing.read()).toBeNull();
  });
});
