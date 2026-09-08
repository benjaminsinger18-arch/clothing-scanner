// Styles shared across the Results tab components — split out of
// ResultsScreen.tsx's single StyleSheet.create call during the monolith
// breakup. ResultsScreen.tsx itself keeps only the styles for its own shell
// (item selector bar, tab bar, save/scan-again buttons) — see that file's own
// `styles` object.

import { StyleSheet } from "react-native";
import { theme } from "../../theme";

export const resultsStyles = StyleSheet.create({
  overviewHeader: { flexDirection: "row", gap: theme.spacing.md, marginBottom: 4 },
  overviewRows: { flex: 1, minWidth: 0 },
  overviewPhoto: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    flexShrink: 0,
  },
  overviewPhotoPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexShrink: 0,
  },
  correctionLink: { marginBottom: 14 },
  correctionLinkText: { color: theme.colors.accent, fontSize: 13, textDecorationLine: "underline" },
  row: { marginBottom: 14 },
  rowLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.label,
  },
  rowValue: { color: theme.colors.textPrimary, fontSize: 18, fontFamily: theme.fonts.body.semiBold, marginTop: 2 },
  rowHint: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  note: { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 14, fontStyle: "italic" },
  groupLabel: { color: theme.colors.textPrimary, fontSize: 14, fontFamily: theme.fonts.body.semiBold, marginBottom: 8 },
  rangeBanner: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: 14,
    overflow: "hidden",
  },
  rangeLabel: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.label,
    marginBottom: 4,
  },
  rangeValue: { color: theme.colors.accent, fontSize: 18, fontFamily: theme.fonts.display.bold },
  rangeMedian: { color: theme.colors.textSecondary, fontSize: 13, fontFamily: theme.fonts.body.regular },
  resaleBanner: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: 14,
  },
  resaleValue: { color: theme.colors.textPrimary, fontSize: 18, fontFamily: theme.fonts.display.bold },
});
