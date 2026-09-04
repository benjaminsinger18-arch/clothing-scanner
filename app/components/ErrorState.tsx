import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {onRetry ? (
        <Pressable style={styles.button} onPress={onRetry}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", padding: theme.spacing.lg },
  title: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.semiBold, textAlign: "center" },
  detail: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: 6 },
  button: { marginTop: theme.spacing.md, backgroundColor: theme.colors.surfaceAlt, paddingHorizontal: 20, paddingVertical: 10, borderRadius: theme.radius.sm },
  buttonText: { color: theme.colors.textPrimary, fontFamily: theme.fonts.body.semiBold },
});
