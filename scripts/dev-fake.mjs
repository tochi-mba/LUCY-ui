/**
 * `npm run dev:fake`: the fake hub and the dev server together, the dev server proxied to it.
 * Ctrl-C stops both. A thin launcher; nothing here decides anything.
 */
import { spawn } from "node:child_process";

const port = process.env.FAKE_HUB_PORT ?? "8765";
const children = [
  spawn(process.execPath, ["scripts/fake-hub.mjs", port], { stdio: "inherit" }),
  spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, LUCY_URL: `http://127.0.0.1:${port}` },
  }),
];

function stop() {
  for (const child of children) child.kill();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", stop);
