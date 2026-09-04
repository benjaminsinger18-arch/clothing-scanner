import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { OutfitSuggestionsResult, DataSourceStatus, PriceListing, PriceSearchResult } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { ItemCard } from "../components/ItemCard";
import { ErrorState } from "../components/ErrorState";
import { toErrorInfo } from "../lib/errors";
import { getOutfitSuggestions, searchPrices } from "../services/api";
import { theme } from "../theme";

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
      setPricingError(toErrorInfo(err, "Couldn't load pricing"));
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
      setOutfitsError(toErrorInfo(err, "Couldn't load outfit ideas"));
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

      <ScrollView style={styles.content} contentContainerStyle={{ padding: theme.spacing.md }}>
        {tab === "Overview" && (
          <View>
            <Row label="Garment" value={classification.garmentType} />
            <Row label="Category" value={classification.category} />
            <Row label="Color" value={classification.color} />
            <Row label="Pattern" value={classification.pattern} />
            <Row label="Style" value={classification.style} />
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

            <Pressable
              onPress={() => navigation.navigate("Correction", { classification })}
              style={styles.correctionLink}
            >
              <Text style={styles.correctionLinkText}>Doesn't look right? Suggest a fix</Text>
            </Pressable>

            {classification.source === "correction" && classification.sources && classification.sources.length > 0 && (
              <Text style={styles.note}>
                Verified via: {classification.sources.map((s) => s.title).join(", ")}
              </Text>
            )}

            <PriceRangeSummary pricing={pricing} loading={pricingLoading} />
          </View>
        )}

        {tab === "Price Comparison" && (
          <View>
            <PriceRangeSummary pricing={pricing} loading={pricingLoading} />
            <Text style={styles.note}>Sorted low to high, combining resale and retail listings.</Text>
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
            <Text style={styles.note}>Ratings shown where available — not every item has reviews yet.</Text>
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
            <Text style={styles.note}>Listings from resale and retail sources, with condition noted where known.</Text>
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
              AI-suggested pairings matched against real listings — more a style nudge than a stylist.
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
          <Text style={styles.rangeLabel}>Estimated retail price</Text>
          <Text style={styles.rangeValue}>
            ${newRange.low.toFixed(2)} – ${newRange.high.toFixed(2)}{" "}
            <Text style={styles.rangeMedian}>(median ${newRange.median.toFixed(2)})</Text>
          </Text>
        </View>
      )}
      {resaleRange && (
        <View>
          <Text style={styles.rangeLabel}>Estimated resale value</Text>
          <Text style={styles.rangeValue}>
            ${resaleRange.low.toFixed(2)} – ${resaleRange.high.toFixed(2)}{" "}
            <Text style={styles.rangeMedian}>(median ${resaleRange.median.toFixed(2)})</Text>
          </Text>
        </View>
      )}
      {!newRange && (
        <Text style={styles.rangeCaveat}>No retail listings found — this is likely a resale-only price.</Text>
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
    return <ActivityIndicator color={theme.colors.textPrimary} style={{ marginTop: 24 }} />;
  }
  if (error) {
    return <ErrorState title={error.title} detail={error.detail} onRetry={onRetry} />;
  }
  if (status === "unavailable" || status === null) {
    return <ErrorState title="Couldn't load pricing right now" detail="Give it another moment and try again." onRetry={onRetry} />;
  }
  if (status === "rate_limited") {
    return (
      <ErrorState
        title="We've hit today's limit"
        detail="Try again a little later."
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
    return <ActivityIndicator color={theme.colors.textPrimary} style={{ marginTop: 24 }} />;
  }
  if (error) {
    return <ErrorState title={error.title} detail={error.detail} onRetry={onRetry} />;
  }
  if (!outfits || outfits.status === "unavailable") {
    return <ErrorState title="Couldn't load outfit ideas right now" detail="Give it another moment and try again." onRetry={onRetry} />;
  }
  if (outfits.status === "rate_limited") {
    return (
      <ErrorState
        title="We've hit today's limit"
        detail="Try again a little later."
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
            <Text style={styles.note}>No matching items found right now.</Text>
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
  container: { flex: 1, backgroundColor: theme.colors.background },
  tabBar: { maxHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  tabBarContent: { paddingHorizontal: 12, alignItems: "center", gap: 8 },
  tabButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius.pill },
  tabButtonActive: { backgroundColor: theme.colors.surfaceAlt },
  tabButtonText: { color: theme.colors.textSecondary, fontSize: 13, fontFamily: theme.fonts.body.semiBold },
  tabButtonTextActive: { color: theme.colors.textPrimary },
  content: { flex: 1 },
  correctionLink: { marginBottom: 14 },
  correctionLinkText: { color: theme.colors.textSecondary, fontSize: 13, textDecorationLine: "underline" },
  row: { marginBottom: 14 },
  rowLabel: { color: theme.colors.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: theme.letterSpacing.label },
  rowValue: { color: theme.colors.textPrimary, fontSize: 18, fontFamily: theme.fonts.body.semiBold, marginTop: 2 },
  rowHint: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  note: { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 14, fontStyle: "italic" },
  groupLabel: { color: theme.colors.textPrimary, fontSize: 14, fontFamily: theme.fonts.body.semiBold, marginBottom: 8 },
  scanAgainButton: { margin: theme.spacing.md, backgroundColor: theme.colors.textPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center" },
  scanAgainText: { color: theme.colors.background, fontSize: 16, fontFamily: theme.fonts.body.bold },
  rangeBanner: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: 14 },
  rangeLabel: { color: theme.colors.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: theme.letterSpacing.label, marginBottom: 4 },
  rangeValue: { color: theme.colors.accent, fontSize: 18, fontFamily: theme.fonts.display.bold },
  rangeMedian: { color: theme.colors.textSecondary, fontSize: 13, fontFamily: theme.fonts.body.regular },
  rangeCaveat: { color: theme.colors.textSecondary, fontSize: 12, fontStyle: "italic" },
});
