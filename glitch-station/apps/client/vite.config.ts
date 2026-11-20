import { defineConfig } from "vite";

// In dev the client talks to `wrangler dev` (port 8787) through this proxy, so
// a phone on the same WiFi only needs the Vite address (shown as "Network").
const worker = "http://127.0.0.1:8787";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: worker.replace("http", "ws"), ws: true },
      "/api": { target: worker },
      "/health": { target: worker },
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1700, // Phaser alone is about 1.2 MB minified.
  },
});
