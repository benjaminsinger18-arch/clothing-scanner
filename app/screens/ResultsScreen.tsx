import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { OutfitSuggestionsResult, DataSourceStatus, PriceListing, PriceSearchResult } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { ItemCard } from "../components/ItemCard";
import { ErrorState } from "../components/ErrorState";
import { toErrorInfo } from "../lib/errors";
import { getOutfitSuggestions, searchPrices } from "../services/api";

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
      setPricingError(toErrorInfo(err, "Failed to load pricing"));
    } finally {
      setPricingLoading(false);
    }
  }, [classification]);

  useEffect(() => {
    fetchPricing();
  }, [fetchPricing]);

  const [outfits, setOutfits] = useState<OutfitSuggestionsResult | null>(null);
  const [outfitsLoading, setOutfitsLoading] = useState(true);
  const [outfitsError, setOutfitsError] = useState<{ title: string; detail?: string } | null>(null);

  const fetchOutfits = useCallback(async () => {
    setOutfitsLoading(true);
    setOutfitsError(null);
    try {
      const result = await getOutfitSuggestions(classification);
      setOutfits(result);
    } catch (err) {
      setOutfitsError(toErrorInfo(err, "Failed to load outfit suggestions"));
    } finally {
      setOutfitsLoading(false);
    }
  }, [classification]);

  useEffect(() => {
    fetchOutfits();
  }, [fetchOutfits]);

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
              hint={`confidence: ${classification.brandConfidence}${
                classification.brandSource === "vision-logo"
                  ? " (via logo detection)"
                  : classification.brandSource === "gemini"
                    ? " (via Gemini)"
                    : ""
              }`}
            />
            <PriceRangeSummary pricing={pricing} loading={pricingLoading} />
          </View>
        )}

        {tab === "Price Comparison" && (
          <View>
            <PriceRangeSummary pricing={pricing} loading={pricingLoading} />
            <Text style={styles.note}>Sorted low to high — mix of secondhand (eBay) and new/retail (eBay + Google Shopping).</Text>
            <ProviderDataBody
              items={pricing?.similarItems ?? []}
              status={pricing?.status ?? null}
              loading={pricingLoading}
              error={pricingError}
              onRetry={fetchPricing}
              emptyTitle="No similar listings found"
              emptyDetail="Try a clearer photo or a different angle."
            />
          </View>
        )}

        {tab === "Reviews" && (
          <View>
            <Text style={styles.note}>Ratings sourced from Google Shopping listings where available — not all items have reviews.</Text>
            <ProviderDataBody
              items={pricing?.reviews ?? []}
              status={pricing?.status ?? null}
              loading={pricingLoading}
              error={pricingError}
              onRetry={fetchPricing}
              emptyTitle="No reviews found for this item"
              emptyDetail="This is common for less popular or secondhand items."
            />
          </View>
        )}

        {tab === "Similar Items" && (
          <View>
            <Text style={styles.note}>Combined eBay + Google Shopping listings — condition shown per item where known.</Text>
            <ProviderDataBody
              items={pricing?.similarItems ?? []}
              status={pricing?.status ?? null}
              loading={pricingLoading}
              error={pricingError}
              onRetry={fetchPricing}
              emptyTitle="No similar listings found"
              emptyDetail="Try a clearer photo or a different angle."
            />
          </View>
        )}

        {tab === "Outfit Matches" && (
          <View>
            <Text style={styles.note}>
              AI-suggested pairings (Claude), matched against live eBay listings — a heuristic, not a
              trained styling model.
            </Text>
            <OutfitBody outfits={outfits} loading={outfitsLoading} error={outfitsError} onRetry={fetchOutfits} />
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
  const newRange = pricing?.estimatedNewRange;
  const resaleRange = pricing?.estimatedResaleRange;
  if (!newRange && !resaleRange) return null;

  return (
    <View style={styles.rangeBanner}>
      {newRange && (
        <View style={resaleRange ? { marginBottom: 10 } : undefined}>
          <Text style={styles.rangeLabel}>Estimated new/retail price (eBay new-condition + Google Shopping)</Text>
          <Text style={styles.rangeValue}>
            ${newRange.low.toFixed(2)} – ${newRange.high.toFixed(2)}{" "}
            <Text style={styles.rangeMedian}>(median ${newRange.median.toFixed(2)})</Text>
          </Text>
        </View>
      )}
      {resaleRange && (
        <View>
          <Text style={styles.rangeLabel}>Estimated resale value (secondhand eBay listings)</Text>
          <Text style={styles.rangeValue}>
            ${resaleRange.low.toFixed(2)} – ${resaleRange.high.toFixed(2)}{" "}
            <Text style={styles.rangeMedian}>(median ${resaleRange.median.toFixed(2)})</Text>
          </Text>
        </View>
      )}
      {!newRange && (
        <Text style={styles.rangeCaveat}>No new/retail listings found — this is likely a used-market price only.</Text>
      )}
    </View>
  );
}

/** Shared renderer for any tab backed by a PriceListing[] slice of the /price-search
 * response (Price Comparison, Similar Items, Reviews). `status` covers provider-level
 * failures (rate limited / unavailable); an empty `items` array under an otherwise-ok
 * status is treated as "nothing found for this particular tab" rather than an error. */
function ProviderDataBody({
  items,
  status,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyDetail,
}: {
  items: PriceListing[];
  status: DataSourceStatus | null;
  loading: boolean;
  error: { title: string; detail?: string } | null;
  onRetry: () => void;
  emptyTitle: string;
  emptyDetail: string;
}) {
  if (loading) {
    return <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />;
  }
  if (error) {
    return <ErrorState title={error.title} detail={error.detail} onRetry={onRetry} />;
  }
  if (status === "unavailable" || status === null) {
    return <ErrorState title="Pricing temporarily unavailable" detail="Providers didn't respond — try again." onRetry={onRetry} />;
  }
  if (status === "rate_limited") {
    return (
      <ErrorState
        title="Request limit reached"
        detail="The app proactively throttles to stay under provider quotas — try again later."
        onRetry={onRetry}
      />
    );
  }
  if (items.length === 0) {
    return <ErrorState title={emptyTitle} detail={emptyDetail} onRetry={onRetry} />;
  }
  return (
    <>
      {items.map((item, i) => (
        <ItemCard key={i} item={item} />
      ))}
    </>
  );
}

/** Renders the Outfit Matches tab: Claude-suggested keyword groups, each with real
 * eBay listings underneath. Groups with zero items still show (so the suggestion
 * itself is visible) with a small inline note rather than being silently dropped. */
function OutfitBody({
  outfits,
  loading,
  error,
  onRetry,
}: {
  outfits: OutfitSuggestionsResult | null;
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
  if (!outfits || outfits.status === "unavailable") {
    return <ErrorState title="Outfit suggestions temporarily unavailable" detail="Couldn't reach Claude — try again." onRetry={onRetry} />;
  }
  if (outfits.status === "rate_limited") {
    return (
      <ErrorState
        title="Request limit reached"
        detail="The app proactively throttles to stay under provider quotas — try again later."
        onRetry={onRetry}
      />
    );
  }
  if (outfits.suggestions.length === 0) {
    return <ErrorState title="No outfit suggestions found" detail="Try again, or check back later." onRetry={onRetry} />;
  }
  return (
    <>
      {outfits.suggestions.map((suggestion, i) => (
        <View key={i} style={{ marginBottom: 16 }}>
          <Text style={styles.groupLabel}>Pairs well with: {suggestion.keywords}</Text>
          {suggestion.items.length === 0 ? (
            <Text style={styles.note}>No purchasable items found for this suggestion right now.</Text>
          ) : (
            suggestion.items.map((item, j) => <ItemCard key={j} item={item} />)
          )}
        </View>
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
  rangeCaveat: { color: "#8e8e93", fontSize: 12, fontStyle: "italic" },
});
