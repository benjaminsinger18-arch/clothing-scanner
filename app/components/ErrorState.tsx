import { Pressable, StyleSheet, Text, View } from "react-native";

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
  container: { alignItems: "center", padding: 24 },
  title: { color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center" },
  detail: { color: "#8e8e93", fontSize: 13, textAlign: "center", marginTop: 6 },
  button: { marginTop: 16, backgroundColor: "#2c2c2e", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  buttonText: { color: "#fff", fontWeight: "600" },
});
