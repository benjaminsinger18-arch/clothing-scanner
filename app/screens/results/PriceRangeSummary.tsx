import { Text, View } from "react-native";
import type { PriceSearchResult } from "@clothing-scanner/shared-types";
import { GlowBackground } from "../../components/GlowBackground";
import { resultsStyles as styles } from "./styles";

/** Used by both the Overview tab (a quick summary) and the Price Comparison tab
 * (above the full listing list) — split out during the ResultsScreen.tsx
 * monolith breakup rather than duplicated, since both call sites need the
 * exact same retail/resale-range rendering. */
export function PriceRangeSummary({ pricing, loading }: { pricing: PriceSearchResult | null; loading: boolean }) {
  if (loading) return null;
  const newRange = pricing?.estimatedNewRange;
  const resaleRange = pricing?.estimatedResaleRange;
  if (!newRange && !resaleRange) return null;

  // Only meaningful when both ranges are present — a resale-only result (rare,
  // but possible if the retail estimate had to fall back to nothing) has
  // nothing to compare against.
  const resaleSavingsPct =
    newRange && resaleRange && newRange.median > 0
      ? Math.round((1 - resaleRange.median / newRange.median) * 100)
      : null;

  return (
    <View>
      {newRange && (
        <View style={styles.rangeBanner}>
          <GlowBackground />
          <Text style={styles.rangeLabel}>Estimated retail price</Text>
          <Text style={styles.rangeValue}>
            ${newRange.low.toFixed(2)} – ${newRange.high.toFixed(2)}{" "}
            <Text style={styles.rangeMedian}>(median ${newRange.median.toFixed(2)})</Text>
          </Text>
        </View>
      )}
      {resaleRange && (
        <View style={styles.resaleBanner}>
          <Text style={styles.rangeLabel}>Estimated resale value</Text>
          <Text style={styles.resaleValue}>
            ${resaleRange.low.toFixed(2)} – ${resaleRange.high.toFixed(2)}{" "}
            <Text style={styles.rangeMedian}>(median ${resaleRange.median.toFixed(2)})</Text>
          </Text>
          {resaleSavingsPct !== null && resaleSavingsPct > 0 && (
            <Text style={styles.note}>
              Roughly {resaleSavingsPct}% less than buying new, based on secondhand marketplace listings (Poshmark,
              eBay, and similar).
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
