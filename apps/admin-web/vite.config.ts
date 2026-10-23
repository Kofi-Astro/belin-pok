import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// A plain single-page app: built to static files (dist/) that Caddy serves
// on Railway, with every path falling back to index.html so routes like
// /products/123 survive a reload (see deploy/Caddyfile).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
