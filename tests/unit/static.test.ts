import { describe, expect, it } from "vitest";
import { cacheFor, encodingFor, typeFor } from "../../scripts/lib/static.mjs";

describe("serving the built app", () => {
  it("keeps a hashed asset for a year and always revalidates the page", () => {
    // The bug, named: nothing was cached, so every load paid the full 285 KB again.
    expect(cacheFor("assets/index-DR-J8bEe.js")).toBe("public, max-age=31536000, immutable");
    expect(cacheFor("/assets/SessionView-C-lti-LI.js")).toBe("public, max-age=31536000, immutable");
    expect(cacheFor("index.html")).toBe("no-cache");
    expect(cacheFor("favicon.svg")).toBe("no-cache");
    expect(cacheFor("assets/unhashed.js")).toBe("no-cache");
  });

  it("compresses text with the best encoding the browser offers, and leaves images and fonts", () => {
    // The bug, named: every asset went out uncompressed.
    expect(encodingFor("gzip, deflate, br, zstd", ".js")).toBe("br");
    expect(encodingFor("gzip", ".css")).toBe("gzip");
    expect(encodingFor("GZIP;q=0.5", ".html")).toBe("gzip");
    expect(encodingFor("br;q=0, gzip", ".js")).toBe("gzip");
    expect(encodingFor("br; q=0.000, gzip;q=0", ".js")).toBeNull();
    expect(encodingFor("deflate", ".js")).toBeNull();
    expect(encodingFor(undefined, ".js")).toBeNull();
    expect(encodingFor("br", ".woff2")).toBeNull();
    expect(encodingFor("br", ".png")).toBeNull();
    expect(encodingFor(",br", ".svg")).toBe("br");
  });

  it("names each type it serves, and anything else as bytes", () => {
    expect(typeFor(".js")).toBe("text/javascript; charset=utf-8");
    expect(typeFor(".woff2")).toBe("font/woff2");
    expect(typeFor(".webmanifest")).toBe("application/manifest+json");
    expect(typeFor(".exe")).toBe("application/octet-stream");
  });
});
