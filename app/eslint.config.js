// SPDX-License-Identifier: GPL-3.0-or-later
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist", "playwright-report", "test-results", "src/engine/schema.d.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      // Same rule as the engine's own pages: markup only through React, never raw HTML strings.
      "no-restricted-syntax": ["error",
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "No raw HTML: render with JSX." },
        { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]", message: "No raw HTML." },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "No raw HTML." }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);
