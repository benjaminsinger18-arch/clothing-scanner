import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

export function LoadingOverlay({ message }: { message: string }) {
  return (
    <View style={styles.overlay}>
      <ActivityIndicator size="large" color="#fff" />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  text: { color: "#fff", fontSize: 15, marginTop: 12 },
});
