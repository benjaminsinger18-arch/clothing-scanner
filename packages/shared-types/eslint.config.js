// Same shape as server/eslint.config.js — see that file's own comment. This
// package has no dependencies at all by design (see src/index.ts's own top
// comment on why: it needs to work unmodified from both the Node backend and
// the Expo/React Native app), so its lint config stays equally minimal.
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
    },
  },
]);
