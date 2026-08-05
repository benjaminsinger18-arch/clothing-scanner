import { StyleSheet, Text, View } from "react-native";
import type { PriceListing } from "@clothing-scanner/shared-types";

export function ItemCard({ item }: { item: PriceListing }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>
      <View style={styles.row}>
        <Text style={styles.price}>{item.price > 0 ? `$${item.price.toFixed(2)}` : "—"}</Text>
        <Text style={styles.source}>{item.source}</Text>
      </View>
      {typeof item.rating === "number" && (
        <Text style={styles.meta}>
          ★ {item.rating.toFixed(1)} ({item.reviewCount ?? 0})
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1c1c1e",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  title: { color: "#fff", fontSize: 15, fontWeight: "600", marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  price: { color: "#4ade80", fontSize: 16, fontWeight: "700" },
  source: { color: "#8e8e93", fontSize: 12, textTransform: "uppercase" },
  meta: { color: "#8e8e93", fontSize: 12, marginTop: 4 },
});
