import vue from "@vitejs/plugin-vue";
import { defineConfig, type ProxyOptions } from "vite";
import { vueOptions } from "./vue.options.ts";

// The hub has no CORS policy and the UI does not ask it for one: the browser talks to this origin
// and these paths are passed through to the hub (ADR-0003). LUCY_URL says where the hub is.
const hub = process.env.LUCY_URL ?? "http://127.0.0.1:8000";
const HUB_PATHS = ["/v1", "/healthy", "/ready", "/device"];

const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  HUB_PATHS.map((path) => [path, { target: hub, changeOrigin: false }]),
);

export default defineConfig({
  plugins: [vue(vueOptions)],
  server: { host: "127.0.0.1", port: 5173, proxy },
  preview: { host: "127.0.0.1", port: 4173, proxy },
  build: { target: "es2022", sourcemap: true },
});
