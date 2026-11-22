// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// vite preview sends the same security headers as Vercel (vercel.json), so the browser tests run the
// built site under its real Content-Security-Policy.
type VercelHeaders = { headers: { source: string; headers: { key: string; value: string }[] }[] };
const vercel = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as VercelHeaders;
const siteHeaders = Object.fromEntries(
  (vercel.headers.find((h) => h.source === "/(.*)")?.headers ?? []).map((h) => [h.key, h.value]),
);

/**
 * The link preview's picture (index.html's og:image) at the fixed address /og.png that link previews need. It is
 * docs/images/og-home.png, as the data guard allows pictures nowhere else; e2e/og-image.spec.ts makes it.
 */
function linkPreviewPicture(): Plugin {
  return {
    name: "link-preview-picture",
    generateBundle() {
      const source = readFileSync(new URL("../docs/images/og-home.png", import.meta.url));
      this.emitFile({ type: "asset", fileName: "og.png", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), linkPreviewPicture()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version) },
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
  // The gallery shows docs/images itself, outside app/ (the data guard allows pictures nowhere else).
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../docs/images", import.meta.url))] },
  },
  preview: { port: 4173, strictPort: true, headers: siteHeaders },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
