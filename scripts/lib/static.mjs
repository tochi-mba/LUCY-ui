/**
 * How `scripts/serve.mjs` answers for a built file: its type, how long a browser may keep it,
 * and whether to compress it. Pure, so it is held to full coverage; the server only does I/O.
 *
 * Measured before this existed: every asset went out uncompressed and uncached, 285 KB on a cold
 * load and the same again on the next one.
 */

/** @type {Record<string, string>} */
export const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

/** Text compresses well; images and fonts are compressed already. */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json", ".map", ".webmanifest"]);

/** Vite names every file it builds into `assets/` by its content hash. */
const HASHED = /^\/?assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

/** @param {string} extension */
export function typeFor(extension) {
  return TYPES[extension] ?? "application/octet-stream";
}

/**
 * A hashed asset never changes under its name, so it is kept a year and never revalidated. The
 * page itself is always revalidated, so a new build is picked up on the next load.
 *
 * @param {string} path the request path, relative to the build
 */
export function cacheFor(path) {
  return HASHED.test(path) ? "public, max-age=31536000, immutable" : "no-cache";
}

/**
 * The encoding to send, best first, or `null` to send the file as it is.
 *
 * @param {string | undefined} accept the request's `Accept-Encoding`
 * @param {string} extension
 * @returns {"br" | "gzip" | null}
 */
export function encodingFor(accept, extension) {
  if (!COMPRESSIBLE.has(extension) || accept === undefined) return null;
  const offered = new Set(
    accept
      .split(",")
      .map((part) => part.trim().split(";"))
      .filter(([, quality]) => quality === undefined || !/^\s*q\s*=\s*0(\.0+)?\s*$/.test(quality))
      .map(([name]) => String(name).trim().toLowerCase()),
  );
  if (offered.has("br")) return "br";
  if (offered.has("gzip")) return "gzip";
  return null;
}
