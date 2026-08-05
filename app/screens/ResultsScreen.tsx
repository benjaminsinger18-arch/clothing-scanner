import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { PriceSearchResult } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { ItemCard } from "../components/ItemCard";
import { ErrorState } from "../components/ErrorState";
import { MOCK_OUTFIT_SUGGESTIONS, MOCK_REVIEWS } from "../lib/mockData";
import { ApiError, searchPrices } from "../services/api";

type Props = NativeStackScreenProps<RootStackParamList, "Results">;

const TABS = ["Overview", "Price Comparison", "Reviews", "Similar Items", "Outfit Matches"] as const;
type Tab = (typeof TABS)[number];

export function ResultsScreen({ route, navigation }: Props) {
  const { classification } = route.params;
  const [tab, setTab] = useState<Tab>("Overview");

  const [pricing, setPricing] = useState<PriceSearchResult | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [pricingError, setPricingError] = useState<{ title: string; detail?: string } | null>(null);

  const fetchPricing = useCallback(async () => {
    setPricingLoading(true);
    setPricingError(null);
    try {
      const result = await searchPrices(classification);
      setPricing(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setPricingError({ title: err.message, detail: err.reason });
      } else {
        setPricingError({ title: "Failed to load pricing" });
      }
    } finally {
      setPricingLoading(false);
    }
  }, [classification]);

  useEffect(() => {
    fetchPricing();
  }, [fetchPricing]);

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabButton, tab === t && styles.tabButtonActive]}>
            <Text style={[styles.tabButtonText, tab === t && styles.tabButtonTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: 16 }}>
        {tab === "Overview" && (
          <View>
            <Row label="Garment" value={classification.garmentType} />
            <Row label="Category" value={classification.category} />
            <Row label="Color" value={classification.color} />
            <Row label="Pattern" value={classification.pattern} />
            <Row label="Style" value={classification.style} />
            <Row
              label="Brand guess"
              value={classification.brandGuess ?? "Not confidently identified"}
              hint={`confidence: ${classification.brandConfidence}`}
            />
            <PriceRangeSummary pricing={pricing} loading={pricingLoading} />
            <Text style={styles.note}>
              Reviews and outfit matches below are still placeholder data — real integrations land in
              later phases.
            </Text>
          </View>
        )}

        {tab === "Price Comparison" && (
          <View>
            <PriceRangeSummary pricing={pricing} loading={pricingLoading} />
            <PricingBody pricing={pricing} loading={pricingLoading} error={pricingError} onRetry={fetchPricing} />
          </View>
        )}

        {tab === "Reviews" && (
          <View>
            <MockBanner />
            {MOCK_REVIEWS.map((item, i) => (
              <ItemCard key={i} item={item} />
            ))}
          </View>
        )}

        {tab === "Similar Items" && (
          <View>
            <Text style={styles.note}>
              Live eBay listings — cross-retailer comparison (Google Shopping) lands in Phase 3.
            </Text>
            <PricingBody pricing={pricing} loading={pricingLoading} error={pricingError} onRetry={fetchPricing} />
          </View>
        )}

        {tab === "Outfit Matches" && (
          <View>
            <MockBanner />
            {MOCK_OUTFIT_SUGGESTIONS.map((suggestion, i) => (
              <View key={i} style={{ marginBottom: 16 }}>
                <Text style={styles.groupLabel}>Pairs well with: {suggestion.keywords}</Text>
                {suggestion.items.map((item, j) => (
                  <ItemCard key={j} item={item} />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable style={styles.scanAgainButton} onPress={() => navigation.popToTop()}>
        <Text style={styles.scanAgainText}>Scan another item</Text>
      </Pressable>
    </View>
  );
}

function PriceRangeSummary({ pricing, loading }: { pricing: PriceSearchResult | null; loading: boolean }) {
  if (loading) return null;
  const range = pricing?.estimatedPriceRange;
  if (!range) return null;
  return (
    <View style={styles.rangeBanner}>
      <Text style={styles.rangeLabel}>Estimated price range (from live eBay listings)</Text>
      <Text style={styles.rangeValue}>
        ${range.low.toFixed(2)} – ${range.high.toFixed(2)}{" "}
        <Text style={styles.rangeMedian}>(median ${range.median.toFixed(2)})</Text>
      </Text>
    </View>
  );
}

function PricingBody({
  pricing,
  loading,
  error,
  onRetry,
}: {
  pricing: PriceSearchResult | null;
  loading: boolean;
  error: { title: string; detail?: string } | null;
  onRetry: () => void;
}) {
  if (loading) {
    return <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />;
  }
  if (error) {
    return <ErrorState title={error.title} detail={error.detail} onRetry={onRetry} />;
  }
  if (!pricing || pricing.status === "unavailable") {
    return <ErrorState title="Pricing temporarily unavailable" detail="eBay didn't respond — try again." onRetry={onRetry} />;
  }
  if (pricing.status === "rate_limited") {
    return (
      <ErrorState
        title="eBay request limit reached"
        detail="The app proactively throttles to stay under eBay's daily quota — try again later."
        onRetry={onRetry}
      />
    );
  }
  if (pricing.status === "no_results" || pricing.similarItems.length === 0) {
    return <ErrorState title="No similar listings found" detail="Try a clearer photo or a different angle." onRetry={onRetry} />;
  }
  return (
    <>
      {pricing.similarItems.map((item, i) => (
        <ItemCard key={i} item={item} />
      ))}
    </>
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

function MockBanner() {
  return <Text style={styles.note}>Placeholder data — this tab will use real live data starting a later phase.</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  tabBar: { maxHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#2c2c2e" },
  tabBarContent: { paddingHorizontal: 12, alignItems: "center", gap: 8 },
  tabButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  tabButtonActive: { backgroundColor: "#2c2c2e" },
  tabButtonText: { color: "#8e8e93", fontSize: 13, fontWeight: "600" },
  tabButtonTextActive: { color: "#fff" },
  content: { flex: 1 },
  row: { marginBottom: 14 },
  rowLabel: { color: "#8e8e93", fontSize: 12, textTransform: "uppercase" },
  rowValue: { color: "#fff", fontSize: 18, fontWeight: "600", marginTop: 2 },
  rowHint: { color: "#8e8e93", fontSize: 12, marginTop: 2 },
  note: { color: "#8e8e93", fontSize: 12, marginBottom: 14, fontStyle: "italic" },
  groupLabel: { color: "#fff", fontSize: 14, fontWeight: "600", marginBottom: 8 },
  scanAgainButton: { margin: 16, backgroundColor: "#fff", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  scanAgainText: { color: "#000", fontSize: 16, fontWeight: "700" },
  rangeBanner: { backgroundColor: "#1c1c1e", borderRadius: 10, padding: 12, marginBottom: 14 },
  rangeLabel: { color: "#8e8e93", fontSize: 11, textTransform: "uppercase", marginBottom: 4 },
  rangeValue: { color: "#4ade80", fontSize: 18, fontWeight: "700" },
  rangeMedian: { color: "#8e8e93", fontSize: 13, fontWeight: "400" },
});
