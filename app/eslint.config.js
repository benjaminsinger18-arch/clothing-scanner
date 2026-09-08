// Flat config (ESLint 9) built on Expo's own recommended config for SDK 54
// projects — React/React Native/import rules tuned for Expo, plus TypeScript
// support. There was no lint config anywhere in this repo before this pass;
// `tsc --noEmit` (see package.json's typecheck script) was the only static
// analysis, and it wasn't wired to anything either.
const expoConfig = require("eslint-config-expo/flat");
const { defineConfig, globalIgnores } = require("eslint/config");

module.exports = defineConfig([globalIgnores(["dist/**", "web-build/**", ".expo/**"]), ...expoConfig]);
