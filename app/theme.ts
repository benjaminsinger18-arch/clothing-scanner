// Central design tokens for the app. StyleSheet.create call sites reference these
// instead of hardcoding hex/number values — before this file existed, every
// screen/component defined its own inline styles with the same handful of values
// repeated everywhere, which is how a stray SERPAPI label and pure-black-and-white
// "generic dark mode" look crept in undetected across the app.
//
// Palette direction: dark "AI SaaS" / ambient glow, matching
// github.com/cruip/open-react-template — a near-black background (cool undertone,
// not pure #000), a vivid indigo accent for CTAs/highlights/links, and a soft
// glow(alpha) helper (see GlowBackground.tsx) for the template's signature ambient
// light-behind-hero-content effect. Replaces this app's earlier warm "quiet
// luxury" palette (muted gold accent, Playfair Display serif) at the user's
// explicit direction to match this template instead.

export const colors = {
  background: "#08070c",
  surface: "#131219",
  surfaceAlt: "#1c1a24",
  border: "#28262f",
  textPrimary: "#f5f5f7",
  textSecondary: "#96919f",
  accent: "#6366f1",
  /** Semi-transparent overlays derived from `background` — use this instead of a
   * raw rgba(0,0,0,X) so scrims (loading spinner backdrop, barcode-scan
   * instruction/error sheets) don't visually clash with the rest of the palette. */
  overlay: (alpha: number) => `rgba(8, 7, 12, ${alpha})`,
  /** Semi-transparent tints derived from `accent` — the template's ambient glow
   * effect (soft indigo light behind hero content, see GlowBackground.tsx) and
   * subtle indigo-tinted surfaces (e.g. an active tab pill). */
  glow: (alpha: number) => `rgba(99, 102, 241, ${alpha})`,
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 20, pill: 24 } as const;

/** Family name strings must exactly match the keys registered in App.tsx's
 * useFonts() call, or React Native silently falls back to the system font. */
export const fonts = {
  /** Kept as a separate key from `body` (not just an alias) so call sites keep
   * their existing "hero vs. body" semantic split — reserved for a small number
   * of "hero" moments (the Capture screen's title, a price value, an
   * identified-item value), never body copy. Maps to Inter's bolder weights
   * rather than a separate serif family (this app used Playfair Display here
   * before switching to match cruip/open-react-template's Inter-only system). */
  display: {
    semiBold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
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
