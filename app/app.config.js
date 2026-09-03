// Dynamic config layered on top of app.json. Exists solely to read EXPO_API_URL /
// EXPO_APP_SHARED_SECRET (no EXPO_PUBLIC_ prefix) from process.env at build/config
// time and expose them under `extra`, so app code can read them via expo-constants
// instead of Metro's automatic EXPO_PUBLIC_* bundle-inlining.
//
// Note this doesn't change *exposure* — anything under `extra` still ships inside
// the public app/web bundle, same as an EXPO_PUBLIC_ var would (Constants.expoConfig
// is readable by anyone who inspects the built output). This only changes which
// env var names you set in .env / EAS / Vercel and how the app code reads them.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    apiUrl: process.env.EXPO_API_URL ?? null,
    appSharedSecret: process.env.EXPO_APP_SHARED_SECRET ?? null,
  },
});
