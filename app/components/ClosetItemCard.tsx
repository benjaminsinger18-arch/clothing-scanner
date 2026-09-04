import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { ClassificationResult } from "@clothing-scanner/shared-types";
import type { ClosetItem } from "../lib/closetStorage";
import { theme } from "../theme";

/** Same thumb+text row shape as ItemCard, but sourced from a locally-saved
 * photo thumbnail (see closetStorage.ts) instead of a listing's remote image
 * — falls back to a plain placeholder box for barcode-identified items,
 * which never had a garment photo to begin with. Used both by ClosetScreen
 * (with a Remove action) and ResultsScreen's Outfit Matches "from your
 * closet" section (without one — you can't remove an item from that
 * context). */
export function ClosetItemCard({ item, onRemove }: { item: ClosetItem; onRemove?: () => void }) {
  const { classification, priceRange, photoThumbnail } = item;

  return (
    <View style={styles.card}>
      {photoThumbnail ? (
        <Image source={{ uri: photoThumbnail }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={styles.thumbPlaceholder} />
      )}

      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={2}>
          {describeItem(classification)}
        </Text>
        {classification.brandGuess ? <Text style={styles.meta}>{classification.brandGuess}</Text> : null}
        {priceRange ? (
          <Text style={styles.price}>
            ${priceRange.low.toFixed(2)} – ${priceRange.high.toFixed(2)}
          </Text>
        ) : null}
      </View>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} style={styles.removeButton}>
          <Text style={styles.removeButtonText}>Remove</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function describeItem(c: ClassificationResult): string {
  return [c.color, c.garmentType].filter(Boolean).join(" ");
}

const THUMB_SIZE = 56;

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt, flexShrink: 0 },
  thumbPlaceholder: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt, flexShrink: 0 },
  textCol: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontFamily: theme.fonts.body.semiBold, textTransform: "capitalize" },
  meta: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 },
  price: { color: theme.colors.accent, fontSize: 14, fontFamily: theme.fonts.body.semiBold, marginTop: 4 },
  removeButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt },
  removeButtonText: { color: theme.colors.textSecondary, fontSize: 12, fontFamily: theme.fonts.body.medium },
});
