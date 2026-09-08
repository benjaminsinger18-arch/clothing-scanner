// Flat config (ESLint 9) for a plain Node/TypeScript backend — no React/Expo
// concerns here, so this is deliberately smaller than app/eslint.config.js's
// Expo-provided config, just typescript-eslint's recommended rules. There
// was no lint config anywhere in this repo before this pass.
//
// ESM import (not require) — server/package.json has "type": "module", so a
// plain .js file here is loaded as ESM, same as every other file in src/.
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist/**"]),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // Underscore-prefixed unused args/vars are a deliberate "intentionally
      // unused" marker elsewhere in this codebase's style (e.g. Express
      // handlers' `_req` on routes that don't read the request) — flag every
      // other unused binding, but not that one.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
]);
