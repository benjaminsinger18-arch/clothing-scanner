import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

export function LoadingOverlay({ message }: { message: string }) {
  return (
    <View style={styles.overlay}>
      <ActivityIndicator size="large" color={theme.colors.textPrimary} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.overlay(0.75),
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  text: { color: theme.colors.textPrimary, fontSize: 15, marginTop: 12 },
});
