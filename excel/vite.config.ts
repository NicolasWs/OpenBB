import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Certificates created by `npm run certs` (office-addin-dev-certs). Office requires
// the add-in to be served over HTTPS, even from localhost.
function devHttps() {
  const dir = join(homedir(), ".office-addin-dev-certs");
  const key = join(dir, "localhost.key");
  const cert = join(dir, "localhost.crt");
  if (existsSync(key) && existsSync(cert)) {
    return { key: readFileSync(key), cert: readFileSync(cert) };
  }
  return undefined;
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    https: command === "serve" ? devHttps() : undefined,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: { taskpane: resolve(__dirname, "taskpane.html") },
    },
  },
}));
