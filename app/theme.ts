// Central design tokens for the app. StyleSheet.create call sites reference these
// instead of hardcoding hex/number values — before this file existed, every
// screen/component defined its own inline styles with the same handful of values
// repeated everywhere, which is how a stray SERPAPI label and pure-black-and-white
// "generic dark mode" look crept in undetected across the app.
//
// Palette direction: "quiet luxury / editorial minimalism" — warm near-blacks and
// off-whites instead of pure #000/#fff (softer, less stark), a muted gold accent
// instead of a neon Tailwind green (reads as premium/fashion rather than generic
// tech-app), unified border/divider color instead of two slightly different grays.

export const colors = {
  background: "#0f0e0d",
  surface: "#1a1816",
  surfaceAlt: "#231f1c",
  border: "#332e29",
  textPrimary: "#f5f1ea",
  textSecondary: "#a89d8f",
  accent: "#c9a668",
  /** Semi-transparent overlays derived from `background` (warm black) — use this
   * instead of a raw rgba(0,0,0,X) so scrims (loading spinner backdrop, barcode-
   * scan instruction/error sheets) don't visually clash with the warm palette. */
  overlay: (alpha: number) => `rgba(15, 14, 13, ${alpha})`,
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 24 } as const;

/** Family name strings must exactly match the keys registered in App.tsx's
 * useFonts() call, or React Native silently falls back to the system font. */
export const fonts = {
  /** Playfair Display — reserved for a small number of "hero" moments (the
   * Capture screen's title, a price value, an identified-item value), never body
   * copy. Where a style's current fontWeight maps directly to a loaded weight,
   * that numeric fontWeight is dropped in favor of the specific font file —
   * mixing both is redundant and can conflict across platforms. */
  display: {
    semiBold: "PlayfairDisplay_600SemiBold",
    bold: "PlayfairDisplay_700Bold",
  },
  /** Inter — everything else: buttons, labels, body text, native header titles. */
  body: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semiBold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },
} as const;

/** Applied only to the label-style uppercase text that still exists after this
 * pass (row labels, range labels, the "currently identified as" caption) — not
 * general body copy. */
export const letterSpacing = { label: 0.5 } as const;

export const theme = { colors, spacing, radius, fonts, letterSpacing } as const;
