import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { PriceListing } from "@clothing-scanner/shared-types";
import { theme } from "../theme";

export function ItemCard({ item }: { item: PriceListing }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = item.imageUrl;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => {
        Linking.openURL(item.url).catch((err) => console.warn("[ItemCard] Failed to open listing URL:", err));
      }}
    >
      <View style={styles.contentRow}>
        {imageUrl && !imageFailed ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.thumb}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={styles.thumbPlaceholder} />
        )}

        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.row}>
            <Text style={styles.price}>{item.price > 0 ? `$${item.price.toFixed(2)}` : "—"}</Text>
          </View>
          {item.condition ? <Text style={styles.meta}>{item.condition}</Text> : null}
          {typeof item.rating === "number" && (
            <Text style={styles.meta}>
              ★ {item.rating.toFixed(1)} ({item.reviewCount ?? 0})
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const THUMB_SIZE = 64;

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: 10,
  },
  cardPressed: { opacity: 0.7 },
  contentRow: { flexDirection: "row", gap: 12 },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
  },
  thumbPlaceholder: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
    flexShrink: 0,
  },
  textCol: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontFamily: theme.fonts.body.semiBold, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  price: { color: theme.colors.accent, fontSize: 16, fontFamily: theme.fonts.body.bold },
  meta: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 },
});
