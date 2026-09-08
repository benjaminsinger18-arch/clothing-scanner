// expo-sqlite's web implementation (used by app/lib/db.ts for the closet
// store) ships as wa-sqlite, a WebAssembly build of SQLite, and imports its
// .wasm binary directly (see expo-sqlite/web/wa-sqlite/wa-sqlite.wasm).
// Metro doesn't treat .wasm as an asset out of the box — without this it's
// parsed as a JS module and the build fails on the wasm binary's contents.
// The COOP/COEP headers are needed for the SharedArrayBuffer wa-sqlite uses
// for its worker/OPFS-backed storage; without them the site loads but SQLite
// calls fail at runtime instead of failing to build. Metro's dev server only
// — the equivalent headers for the static Vercel export live in vercel.json.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push("wasm");

config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    return middleware(req, res, next);
  };
};

module.exports = config;
