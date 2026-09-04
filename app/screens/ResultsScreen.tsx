import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { OutfitSuggestionsResult, DataSourceStatus, Gender, PriceListing, PriceSearchResult } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { ItemCard } from "../components/ItemCard";
import { ClosetItemCard } from "../components/ClosetItemCard";
import { ErrorState } from "../components/ErrorState";
import { GlowBackground } from "../components/GlowBackground";
import { toErrorInfo } from "../lib/errors";
import { getOutfitSuggestions, searchPrices } from "../services/api";
import { addClosetItem, findClosetMatches, getClosetItems, type ClosetItem } from "../lib/closetStorage";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Results">;

const TABS = ["Overview", "Price Comparison", "Reviews", "Similar Items", "Outfit Matches"] as const;
type Tab = (typeof TABS)[number];

const GENDER_LABELS: Record<Gender, string> = { men: "Men's", women: "Women's", unisex: "Unisex" };

export function ResultsScreen({ route, navigation }: Props) {
  const { classification, prefetchedPricing, prefetchedOutfits } = route.params;
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
    // Prefer an already-in-flight prefetched request (see prefetchResultsData in
    // app/lib/prefetchResults.ts — set by whichever screen navigated here) over
    // starting a fresh one now that we've mounted; falls back to fetchPricing
    // when nothing was prefetched (e.g. hot-reloaded straight onto this screen).
    // Deliberately run once on mount only, not on every fetchPricing identity
    // change — a stale prefetched promise should never be re-awaited on re-render,
    // and the per-tab "Try again" buttons call fetchPricing directly for retries.
    if (prefetchedPricing) {
      setPricingLoading(true);
      setPricingError(null);
      prefetchedPricing
        .then(setPricing)
        .catch((err) => setPricingError(toErrorInfo(err, "Couldn't load pricing")))
        .finally(() => setPricingLoading(false));
    } else {
      fetchPricing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Same prefetch-first pattern as the pricing effect above.
    if (prefetchedOutfits) {
      setOutfitsLoading(true);
      setOutfitsError(null);
      prefetchedOutfits
        .then(setOutfits)
        .catch((err) => setOutfitsError(toErrorInfo(err, "Couldn't load outfit ideas")))
        .finally(() => setOutfitsLoading(false));
    } else {
      fetchOutfits();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // For the Outfit Matches tab's "from your closet" section — a snapshot of
  // what's saved as of this screen loading, not kept live in sync with the
  // Closet screen. A scan is a single, short-lived view; re-reading storage
  // on every render (or subscribing to changes) would be effort spent on a
  // staleness window nobody will notice within one screen visit.
  const [closetItems, setClosetItems] = useState<ClosetItem[]>([]);
  useEffect(() => {
    getClosetItems()
      .then(setClosetItems)
      .catch((err) => console.warn("[ResultsScreen] Failed to load closet:", err));
  }, []);

  const closetMatches = useMemo(() => {
    if (!outfits || outfits.suggestions.length === 0 || closetItems.length === 0) return [];
    const seen = new Set<string>();
    const matches: ClosetItem[] = [];
    for (const suggestion of outfits.suggestions) {
      for (const match of findClosetMatches(closetItems, suggestion.keywords, 3)) {
        if (!seen.has(match.id)) {
          seen.add(match.id);
          matches.push(match);
        }
      }
    }
    return matches.slice(0, 6);
  }, [outfits, closetItems]);

  const [closetSaveState, setClosetSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const handleSaveToCloset = useCallback(async () => {
    if (closetSaveState !== "idle") return;
    setClosetSaveState("saving");
    try {
      await addClosetItem(classification, pricing?.estimatedNewRange);
      setClosetSaveState("saved");
    } catch (err) {
      console.warn("[ResultsScreen] Failed to save to closet:", err);
      setClosetSaveState("idle");
    }
  }, [classification, pricing, closetSaveState]);

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
            <Row icon="👕" label="Garment" value={classification.garmentType} />
            <Row icon="🗂️" label="Category" value={classification.category} />
            <Row icon="🎨" label="Color" value={classification.color} />
            <Row icon="🔷" label="Pattern" value={classification.pattern} />
            <Row icon="✨" label="Style" value={classification.style} />
            <Row icon="🚻" label="Gender" value={GENDER_LABELS[classification.gender]} />
            <Row
              icon="🏷️"
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
            <OutfitBody
              outfits={outfits}
              loading={outfitsLoading}
              error={outfitsError}
              onRetry={fetchOutfits}
              closetMatches={closetMatches}
            />
          </View>
        )}
      </ScrollView>

      <Pressable
        style={[styles.saveClosetButton, closetSaveState !== "idle" && styles.saveClosetButtonDone]}
        onPress={handleSaveToCloset}
        disabled={closetSaveState !== "idle"}
      >
        <Text style={styles.saveClosetText}>
          {closetSaveState === "saved" ? "Saved to Closet ✓" : closetSaveState === "saving" ? "Saving…" : "Save to Closet"}
        </Text>
      </Pressable>

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
              Roughly {resaleSavingsPct}% less than buying new, based on secondhand marketplace listings (Poshmark, eBay, and similar).
            </Text>
          )}
        </View>
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
 * listings underneath where available. Groups with zero items still show (so the
 * suggestion itself is visible) with a small inline note rather than being silently
 * dropped. */
function OutfitBody({
  outfits,
  loading,
  error,
  onRetry,
  closetMatches,
}: {
  outfits: OutfitSuggestionsResult | null;
  loading: boolean;
  error: { title: string; detail?: string } | null;
  onRetry: () => void;
  closetMatches: ClosetItem[];
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
      {/* Closet-sourced matches are additive, not a replacement for the
          AI-guessed shoppable groups below — silently omitted (no empty
          state) when nothing in the closet matches, since an empty closet
          or a genuine no-match is the common case and not worth calling
          out as an error or gap. */}
      {closetMatches.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.groupLabel}>From your closet</Text>
          {closetMatches.map((item) => (
            <ClosetItemCard key={item.id} item={item} />
          ))}
        </View>
      )}
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

function Row({ icon, label, value, hint }: { icon: string; label: string; value: string; hint?: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelRow}>
        <Text style={styles.rowIcon}>{icon}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
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
  tabButtonActive: { backgroundColor: theme.colors.glow(0.18) },
  tabButtonText: { color: theme.colors.textSecondary, fontSize: 13, fontFamily: theme.fonts.body.semiBold },
  tabButtonTextActive: { color: theme.colors.textPrimary },
  content: { flex: 1 },
  correctionLink: { marginBottom: 14 },
  correctionLinkText: { color: theme.colors.accent, fontSize: 13, textDecorationLine: "underline" },
  row: { marginBottom: 14 },
  rowLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowIcon: { fontSize: 13 },
  rowLabel: { color: theme.colors.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: theme.letterSpacing.label },
  rowValue: { color: theme.colors.textPrimary, fontSize: 18, fontFamily: theme.fonts.body.semiBold, marginTop: 2 },
  rowHint: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  note: { color: theme.colors.textSecondary, fontSize: 12, marginBottom: 14, fontStyle: "italic" },
  groupLabel: { color: theme.colors.textPrimary, fontSize: 14, fontFamily: theme.fonts.body.semiBold, marginBottom: 8 },
  scanAgainButton: { marginHorizontal: theme.spacing.md, marginBottom: theme.spacing.md, backgroundColor: theme.colors.accent, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center" },
  scanAgainText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.bold },
  saveClosetButton: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceAlt,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  saveClosetButtonDone: { opacity: 0.6 },
  saveClosetText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.semiBold },
  rangeBanner: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: 14,
    overflow: "hidden",
  },
  rangeLabel: { color: theme.colors.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: theme.letterSpacing.label, marginBottom: 4 },
  rangeValue: { color: theme.colors.accent, fontSize: 18, fontFamily: theme.fonts.display.bold },
  rangeMedian: { color: theme.colors.textSecondary, fontSize: 13, fontFamily: theme.fonts.body.regular },
  resaleBanner: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: 14,
  },
  resaleValue: { color: theme.colors.textPrimary, fontSize: 18, fontFamily: theme.fonts.display.bold },
});
