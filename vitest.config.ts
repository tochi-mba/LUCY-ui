import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { vueOptions } from "./vue.options.ts";

// Every module that decides something is held to full coverage, file by file: the protocol, the
// transport, the stores, the face, every component, and the libraries behind the scripts. Only the
// entry point that mounts the app and the thin command-line wrappers in scripts/ are left out; the
// logic they would carry lives in scripts/lib, which is gated.
export default defineConfig({
  plugins: [vue(vueOptions)],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    // Logic runs in plain Node; a test file that mounts components says so in its first line with
    // `// @vitest-environment happy-dom`, so only those pay for a DOM.
    environment: "node",
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,vue}", "scripts/lib/**/*.mjs"],
      exclude: ["src/main.ts", "src/env.d.ts"],
      reporter: ["text-summary", "text", "html", "json"],
      thresholds: { perFile: true, lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
