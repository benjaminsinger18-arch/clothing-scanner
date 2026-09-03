// Ambient declaration for direct .ttf imports (used in App.tsx to import individual
// font weights from @expo-google-fonts/* packages, bypassing their index.js which
// unconditionally require()s every weight of the family). Metro resolves a font/
// image require to a numeric asset ID at runtime — this just tells TypeScript that
// shape, since neither React Native's nor Expo's bundled types declare it and this
// app had no prior static asset imports to have already needed it.
declare module "*.ttf" {
  const assetId: number;
  export default assetId;
}
