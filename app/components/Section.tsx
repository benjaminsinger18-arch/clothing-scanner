import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

/** A titled card grouping a handful of rows — the "Provider usage this
 * period" / "Your data" grouping shape from SettingsScreen, extracted here so
 * InsightsScreen can reuse the exact same look instead of a second
 * hand-rolled version of the same title+card wrapper. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: theme.spacing.lg },
  sectionTitle: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.label,
    marginBottom: 8,
  },
  sectionBody: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
});
