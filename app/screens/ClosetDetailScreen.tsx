import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { Gender } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { removeClosetItem } from "../lib/closetStorage";
import { getWearStats, logWear, type WearStats } from "../lib/wearLog";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ClosetDetail">;

const GENDER_LABELS: Record<Gender, string> = { men: "Men's", women: "Women's", unisex: "Unisex" };

/** Read-only detail view of a saved closet entry — the snapshot taken at
 * save time (see closetStorage.ts), not a live re-fetch. Same
 * photo-to-the-right-of-the-rows layout as ResultsScreen's Overview tab,
 * duplicated locally rather than shared since this screen itself has no
 * tabs, no live pricing/outfit fetches, and a Remove action instead of
 * Save. "View Full Results" below hands off to the real ResultsScreen (all
 * five tabs) for that live data, re-fetching pricing/outfits fresh since
 * only the saved-at-the-time priceRange summary — not the full pricing/
 * outfit results — is persisted per closet entry. */
export function ClosetDetailScreen({ route, navigation }: Props) {
  const { item } = route.params;
  const { classification, priceRange, photoThumbnail, savedAt } = item;
  const [removing, setRemoving] = useState(false);
  // null = "haven't loaded yet" — distinct from a real 0-wear WearStats, so
  // the "Mark as worn" button doesn't flash a stale "Never worn" before the
  // real count arrives.
  const [wearStats, setWearStats] = useState<WearStats | null>(null);
  const [loggingWear, setLoggingWear] = useState(false);

  useEffect(() => {
    getWearStats(item.id)
      .then(setWearStats)
      .catch(() => setWearStats({ count: 0, lastWornAt: null }));
  }, [item.id]);

  async function handleMarkWorn() {
    if (loggingWear) return;
    setLoggingWear(true);
    try {
      setWearStats(await logWear(item.id));
    } catch (err) {
      console.warn("[ClosetDetailScreen] Failed to log wear:", err);
    } finally {
      setLoggingWear(false);
    }
  }

  async function handleRemove() {
    if (removing) return;
    setRemoving(true);
    try {
      await removeClosetItem(item.id);
      navigation.goBack();
    } catch (err) {
      console.warn("[ClosetDetailScreen] Failed to remove:", err);
      setRemoving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.rows}>
          <Row label="Garment" value={classification.garmentType} />
          <Row label="Category" value={classification.category} />
          <Row label="Color" value={classification.color} />
          <Row label="Pattern" value={classification.pattern} />
          <Row label="Style" value={classification.style} />
          <Row label="Gender" value={GENDER_LABELS[classification.gender]} />
          <Row
            label="Brand"
            value={classification.brandGuess ?? "Not identified"}
            hint={`confidence: ${classification.brandConfidence}${
              classification.brandSource === "vision-logo"
                ? " (via logo detection)"
                : classification.brandSource === "barcode"
                  ? " (via barcode)"
                  : ""
            }`}
          />
        </View>

        {photoThumbnail ? (
          <Image source={{ uri: photoThumbnail }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder} />
        )}
      </View>

      {priceRange && (
        <View style={styles.rangeBanner}>
          <Text style={styles.rangeLabel}>Estimated retail price (at save time)</Text>
          <Text style={styles.rangeValue}>
            ${priceRange.low.toFixed(2)} – ${priceRange.high.toFixed(2)}{" "}
            <Text style={styles.rangeMedian}>(median ${priceRange.median.toFixed(2)})</Text>
          </Text>
        </View>
      )}

      {wearStats && (
        <View style={styles.wearSection}>
          <View style={styles.wearStatsRow}>
            <Text style={styles.wearStatsText}>
              {wearStats.count === 0 ? "Never worn" : `Worn ${wearStats.count} time${wearStats.count === 1 ? "" : "s"}`}
              {wearStats.lastWornAt ? ` · last ${new Date(wearStats.lastWornAt).toLocaleDateString()}` : ""}
            </Text>
            {priceRange && wearStats.count > 0 && (
              <Text style={styles.costPerWear}>${(priceRange.median / wearStats.count).toFixed(2)} per wear</Text>
            )}
          </View>
          <Pressable
            style={[styles.wearButton, loggingWear && styles.wearButtonDisabled]}
            onPress={handleMarkWorn}
            disabled={loggingWear}
            accessibilityRole="button"
            accessibilityLabel="Mark as worn today"
            accessibilityState={{ disabled: loggingWear }}
          >
            <Text style={styles.wearButtonText}>{loggingWear ? "Logging…" : "Mark as Worn Today"}</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.savedAt}>Saved {new Date(savedAt).toLocaleDateString()}</Text>

      <Pressable
        style={styles.viewResultsButton}
        onPress={() =>
          navigation.navigate("Results", { classifications: [classification], initialIndex: 0, photoThumbnail })
        }
        accessibilityRole="button"
        accessibilityLabel="View full results"
      >
        <Text style={styles.viewResultsButtonText}>View Full Results</Text>
      </Pressable>

      <Pressable
        style={[styles.removeButton, removing && styles.removeButtonDisabled]}
        onPress={handleRemove}
        disabled={removing}
        accessibilityRole="button"
        accessibilityLabel={removing ? "Removing from closet" : "Remove from closet"}
        accessibilityState={{ disabled: removing }}
      >
        <Text style={styles.removeButtonText}>{removing ? "Removing…" : "Remove from Closet"}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md },
  header: { flexDirection: "row", gap: theme.spacing.md, marginBottom: theme.spacing.md },
  rows: { flex: 1, minWidth: 0 },
  photo: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    flexShrink: 0,
  },
  photoPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexShrink: 0,
  },
  row: { marginBottom: 14 },
  rowLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.label,
  },
  rowValue: { color: theme.colors.textPrimary, fontSize: 18, fontFamily: theme.fonts.body.semiBold, marginTop: 2 },
  rowHint: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  rangeBanner: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
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
  wearSection: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  wearStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: theme.spacing.sm,
  },
  wearStatsText: { color: theme.colors.textPrimary, fontSize: 14, fontFamily: theme.fonts.body.medium },
  costPerWear: { color: theme.colors.accent, fontSize: 13, fontFamily: theme.fonts.body.semiBold },
  wearButton: {
    backgroundColor: theme.colors.surfaceAlt,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  wearButtonDisabled: { opacity: 0.6 },
  wearButtonText: { color: theme.colors.textPrimary, fontSize: 14, fontFamily: theme.fonts.body.semiBold },
  savedAt: { color: theme.colors.textSecondary, fontSize: 12, marginBottom: theme.spacing.lg },
  viewResultsButton: {
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
    marginBottom: 12,
  },
  viewResultsButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.bold },
  removeButton: {
    backgroundColor: theme.colors.surfaceAlt,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  removeButtonDisabled: { opacity: 0.6 },
  removeButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.semiBold },
});
